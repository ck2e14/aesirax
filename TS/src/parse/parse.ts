import { ByteLen, DicomErrorType, TagDictByHex, TransferSyntaxUid, VR } from "../globalEnums.js";
import { write } from "../logging/logQ.js";
import { StreamContext } from "../read/read.js";
import { decodeTagNum, TagStr } from "./tagNums.js";
import { isVr } from "./typeGuards.js";
import { decodeValue, decodeVr } from "./valueDecoders.js";
import {
   BufferBoundary,
   DicomError,
   MalformedDicom,
   UndefinedLength,
   Unrecoverable,
} from "../error/errors.js";

export type PartialTag = Buffer | null; // because streaming will guarantee cutting tags up
export type DataSet = Record<string, Element>;
export type Item = DataSet; // items are just datasets contained in sequences
export type Element = {
   tag: TagStr;
   name: string;
   vr: VR;
   length: number;
   items?: Item[];
   value: string | number | Buffer;
   devNote?: string;
};

export const DICOM_HEADER = "DICM";
export const PREAMBLE_LENGTH = 128;
export const DICOM_HEADER_START = PREAMBLE_LENGTH;
export const HEADER_END = PREAMBLE_LENGTH + 4;

/**
 * Parse the elements in a buffer containing a subset of a DICOM file's bytes,
 * Return a buffer containing the truncated tag if the buffer is incomplete.
 * This is used to allow on-the-fly parsing of DICOM files as they are read
 * and stitching together truncated tags that span multiple byteArrays.
 *
 * Implicit VR is not supported yet.
 * TODO implement LIFO stack for nested sequencing
 *
 * @param buffer - Bytes[] from a DICOM file
 * @param ctx - StreamContext
 * @returns PartialTag
 */
export function parse(buffer: Buffer, ctx: StreamContext): PartialTag {
   const cursor = newCursor();
   const newItem = "(fffe,e000)";
   const itemEnd = "(fffe,e00d)";
   const sqEnd = "(fffe,e0dd)";

   ctx.usingLE = useLE(ctx.transferSyntaxUid);

   if (ctx.first) {
      write(`Decoding as ${ctx.usingLE ? "LE" : "BE"} byte order`, "DEBUG");
   }

   let lastTagStart: number = cursor.pos; // for truncation handling of streamed buffers
   let itemDataSet = {}; // ignored if not in a sequence. Items in a sequence all contain
   // their own datasets. Is overwritten freely and at point of needing to write value, we
   // copy by value not pass by reference (using spread operator).
   // WARN because this is scoped here I think its breaking things when we return to streamParse()
   // to stitch buffers?

   if (ctx.inSequence) {
      ctx.dataSet[ctx.currSqTag] ??= newSeqElement(ctx);
   }

   while (cursor.pos < buffer.length) {
      lastTagStart = cursor.pos;
      const el = newElement(); // An element is a tag, VR, length, and value. We decode these in four stages below.

      try {
         // * STAGE 1 - DECODE TAG * //
         decodeTagAndMoveCursor(buffer, cursor, el);

         // * STAGE 1.5 - HANDLE END OF ITEM DATA SET * //
         if (isItemDataSetEnd(ctx, el, itemEnd)) {
            write(`End of itemDataSet: ${el.tag}`, "DEBUG");
            const nextTag = handleEndOfSequence(ctx, cursor, buffer, itemDataSet);

            if (nextTag === (newItem as TagStr)) {
               console.log(`Next tag is a new item: ${nextTag}`);
               continue; // continue to the next while() decode the next tag.
            }

            if (nextTag === (sqEnd as TagStr)) {
               console.log(`Next tag is the end of the sequence: ${nextTag}`);
               ctx.sequenceBytesTraversed = cursor.pos; // for syncing parent cursor positions
               return; // recursive base case for this context - end of sequence.
            }

            throw new MalformedDicom(`Got ${nextTag} but expected ${newItem} or ${sqEnd}`);
         }

         // * STAGE 2 - DECODE VR * //
         console.log(`Decoding VR for tag: ${el.tag} in sequence: ${ctx.inSequence}`);
         decodeVRAndMoveCursor(buffer, cursor, el);

         // * STAGE 3 - DECODE VALUE LENGTH * //
         const wasSeq = decodeValueLengthAndMoveCursor(el, cursor, buffer, ctx);

         // * STAGE 3.5 - HANDLE RETURN FROM SEQUENCE PARSING * //
         if (wasSeq) {
            ctx.inSequence = false; // WARN see comments in decodeValueLengthAndMoveCursor()
            ctx.currSqTag = null;
            ctx.sequenceBytesTraversed = null;
            continue; // continue to decode the next tag (outside of the current sequence)
         }

         // * STAGE 4 - DECODE VALUE * //
         decodeValueAndMoveCursor(buffer, cursor, el, ctx);

         // * STAGE 5 - SAVE ELEMENT * //
         if (ctx.inSequence) {
            itemDataSet[el.tag] = el; // add to the item's dataset.
         } else {
            ctx.dataSet[el.tag] = el; // add to the top level's dataset.
         }

         debugPrint(el);
      } catch (error) {
         console.log(`Error caught in parse(): ${error.message}`);
         return handleErrorPathways(error, buffer, lastTagStart, el.tag);
      }

      if (cursor.pos >= buffer.length) {
         console.log(`End of buffer reached`);
         return;
      }

      if (valueIsTruncated(buffer, cursor.pos, el.length)) {
         const partial = buffer.subarray(lastTagStart, buffer.length);
         console.log(`Returning buffer length: ${partial.length}, inseq: ${ctx.inSequence}`);
         return partial;
      }
   }
}

type NextTag = string;
function isItemDataSetEnd(ctx: StreamContext, el: Element, itemEnd: string) {
   return ctx.inSequence && el.tag === (itemEnd as TagStr);
}

/**
 * Handle the end of an item data set in a sequence. This function is called
 * when the parser encounters the delimiter tag for the end of an item data set.
 * It saves the item data set to the sequence's items array and then peeks the
 * next tag to determine what to do next.
 * @param ctx
 * @param cursor
 * @param buffer
 * @param itemDataSet
 * @returns NextTag - string
 */
function handleEndOfSequence(
   ctx: StreamContext,
   cursor: Cursor,
   buffer: Buffer,
   itemDataSet: DataSet
): NextTag {
   write(`Reached item delimiter; saving item dataset to SQ: ${ctx.currSqTag}'s items`, "DEBUG");
   cursor.walk(4); // walk past & ignore this VR, its always 00000000H on item delimitation tags
   ctx.dataSet[ctx.currSqTag].items.push({
      // must copy this object's value -  not pass it by reference - otherwise each previously
      // added item data set will equal the last item in the sequence's dataset. LIFO stack in
      // future for nested sequences to add to the correct SQ's items array.
      ...itemDataSet,
   });

   // now we should peek the next tag to determine what to do next.
   const nextTagBytes = buffer.subarray(cursor.pos, cursor.pos + 4);
   const nextTag = decodeTagNum(nextTagBytes);

   cursor.walk(ByteLen.UINT_32); // walk past the tag string we just decoded
   cursor.walk(ByteLen.UINT_32); // walk past the sqEnd's length bytes (00000000H) - can ignore it

   return nextTag;
}

/**
 * Create a new sequence element object.
 * @param ctx
 * @returns Element
 */
function newSeqElement(ctx: StreamContext): Element {
   const name =
      TagDictByHex[ctx.currSqTag?.toUpperCase()]?.["name"] ?? "Private or Unrecognised Tag";

   return {
      tag: ctx.currSqTag as TagStr,
      name,
      vr: VR.SQ,
      length: null, // TODO tally while parsing for undefined length SQs
      value: null,
      items: [],
   };
}

/**
 * Create a cursor object to track the current position in the buffer.
 * @returns Cursor
 */
type Cursor = {
   pos: number;
   walk: (n: number) => void;
   retreat: (n: number) => void;
};
function newCursor(pos = 0): Cursor {
   return {
      pos,

      walk: function (n: number) {
         this.pos += n;
      },

      retreat: function (n: number) {
         this.pos -= n;
      },
   };
}

/**
 * Handle errors that occur during the parsing of a DICOM file. If the error
 * is unrecoverable then throw it, otherwise return the partialled tag in bytes
 * to be stitched to the next buffer. Partialled is for handling stitching across
 * streamed buffers' boundaries, parsing error is for when the parser is unable
 * to handle for some other reason.
 * @param error
 * @param buffer
 * @param lastTagStart
 * @throws Error
 * @returns PartialTag
 */
function handleErrorPathways(
   error: any,
   buffer: Buffer,
   lastTagStart: number,
   tag?: TagStr
): PartialTag {
   const partialled = [BufferBoundary, DicomError]; // can refine
   const isUndefinedLength = error instanceof UndefinedLength;
   const parsingError = partialled.every(ex => !(error instanceof ex));

   if (parsingError && !isUndefinedLength) {
      throw error;
   }

   if (error instanceof BufferBoundary) {
      write(`Tag is split across buffer boundary ${tag ?? ""}`, "DEBUG");
      return buffer.subarray(lastTagStart, buffer.length);
   }
}

/**
 * Print an element to the console.
 * @param Element
 * @returns void
 */
function debugPrint(el: Element) {
   const unfuckingSupported = [VR.OB, VR.UN, VR.OW];

   if (unfuckingSupported.includes(el.vr)) {
      el.devNote = UNIMPLEMENTED_VR_PARSING(el.vr);
      printMinusValue(el);
   } else {
      printElement(el);
   }
}

/**
 * Decode the current element's value and move the cursor forwards.
 * @param buffer
 * @param cursor
 * @param el
 * @param StreamContext
 * @returns void
 */
function decodeValueAndMoveCursor(
   buffer: Buffer,
   cursor: Cursor,
   el: Element,
   StreamContext: StreamContext
): void {
   if (valueIsTruncated(buffer, cursor.pos, el.length)) {
      throw new BufferBoundary(
         `Tag ${el.tag} is split across buffer boundary.\n  This is much more likely to just be the end\n  of the currently streamed buffer than it is\n  a malformed DICOM image, but an error nonetheless.\n  Just a calm and expected one. :)`
      );
   }

   const start = cursor.pos;
   const end = cursor.pos + el.length;
   const valueBuffer = buffer.subarray(start, end);

   el.value = decodeValue(el.vr, valueBuffer, StreamContext);
   cursor.walk(el.length); // to get to the start of the next tag
}

/**
 * This handles recursive parsing of nested items and their datasets according to
 * the DICOM specification for the byte structures of sequenced VRs.
 * Note that I don't think it currently handles more than one level of nesting
 * because it would overwrite the shared context sequence properties but we can use
 * a LIFO stack structure to easily handle this by pushing and popping the sequence
 * properties as we enter and exit nested sequences. Not going to be too hard.
 * dicom.nema.org/medical/dicom/current/output/chtml/part05/sect_7.5.html
 * @param seqBuffer
 * @param ctx
 * @param seqTag
 */
function handleUndefinedLengthSQ(seqBuffer: Buffer, ctx: StreamContext, seqTag: string) {
   const itemTag: TagStr = "(fffe,e000)" as TagStr;
   const seqCursor = newCursor(0);

   // In SQs we expect the first tag to be an item tag, if not we throw.
   const tagBuffer = seqBuffer.subarray(seqCursor.pos, seqCursor.pos + ByteLen.TAG_NUM);
   const tag = decodeTagNum(tagBuffer);
   const name = getTagName(tag);
   const confirmedAsItem = tag === itemTag && name === "Item";

   seqCursor.walk(ByteLen.TAG_NUM); // walk past the tag we just decoded

   if (!confirmedAsItem) {
      throw new MalformedDicom(`Expected ${itemTag} but got ${tag}, in sequence: ${seqTag})`);
   }

   // Now we decode the length. This is the length of the item's dataset, not the item itself.
   // items may be undefined length. We currently are handling this, but not defined length items.
   // The spec does say that you can mix and match items of defined and undefined length in the
   // same sequence but i highly doubt this is likely in the wild, very edge casey. Also unhinged.
   const length = ctx.usingLE //
      ? seqBuffer.readUInt32LE(seqCursor.pos)
      : seqBuffer.readUInt32BE(seqCursor.pos);

   seqCursor.walk(ByteLen.UINT_32); // walk past the length bytes up to the start of the item's dataset

   // Now we're going to recurse into parse() with some added context so that different behaviour
   // and basecases can be followed. Return case is detecting an end of sequence tag.
   // WARN_1: the context should include that we're in an undef length SQ, because parse() will need
   // to behave differently once we implement defined length SQ handling logic.
   if (length === 4_294_967_295) {
      // WARN_2: here, our recursive call may return
      // because of a truncated buffer rather than finishing the sequence, i.e. there are two base
      // cases and we need to differentiate so that we can correctly instruct the parent parse()
      // call, which is the one that deals with streamParse() and stitching, otherwise when it tries
      // to stitch the ctx.inSeq vars are fucked up.
      ctx.currSqTag = seqTag;
      ctx.inSequence = true;
      parse(seqBuffer.subarray(seqCursor.pos), ctx);
   } else {
      throw new Unrecoverable(
         `Defined length items, in undefined length SQs, are not yet supported. Sequence tag: ${seqTag}`
      );
   }
}

/**
 * Get the plain text tag name from the Tag Dictionary
 * @param tag
 * @returns
 */
function getTagName(tag: string) {
   return (
      TagDictByHex[tag?.toUpperCase()]?.["name"] ?? //
      "Private or Unrecognised Tag"
   );
}

/**
 * Decode the current element's value length, and move the cursor forward
 * by either the 2 or 4 decoded bytes depending on the VR type (std/ext).
 * @param el
 * @param cursor
 * @param buffer
 */
type LeftSQ = boolean | void;

function decodeValueLengthAndMoveCursor(
   el: Element,
   cursor: Cursor,
   buffer: Buffer,
   ctx: StreamContext
): LeftSQ {
   const isExtVr = isExtendedFormatVr(el.vr);

   if (!isExtVr) {
      el.length = ctx.usingLE //
         ? buffer.readUInt16LE(cursor.pos)
         : buffer.readUInt16BE(cursor.pos); // Standard VR tags' lengths are 2 bytes, so max length is 65,535
      cursor.walk(ByteLen.UINT_16);
      return false;
   } else {
      cursor.walk(ByteLen.EXT_VR_RESERVED); // 2 reserved bytes can be ignored
      _decodeValueLength(el, buffer, cursor, ctx); // Extended VR tags' lengths are 4 bytes, may be enormous
      cursor.walk(ByteLen.UINT_32);
   }

   const definedLength = el.vr === VR.SQ && el.length !== 0 && el.length !== 4_294_967_295;
   if (isExtVr && definedLength) {
      // if SQ, where the length is specified, handle recursive call
      // to parse() with the appropriate ctx flags set.
      throw new Error("Defined length SQs are not yet supported");
   }

   const definedLengthButZero = el.vr === VR.SQ && el.length === 0;
   if (isExtVr && definedLengthButZero) {
      // if SQ, & length is specified, but its 0, we don't need to handle it
      // and have no further walking to do. We can just return early.
      return true;
   }

   const undefinedLength = el.vr === VR.SQ && el.length === 4_294_967_295;
   if (isExtVr && undefinedLength) {
      write(`Encountered an undefined length SQ (${el.tag}) at cursor pos ${cursor.pos}`, "DEBUG");
      // First, isolate (subarray) the bytes from the start of the first item in the sequence.
      // We don't know where the end is, but we don't need to because either parse() will find
      // the end of the sequence via delimiter tag, or it will hit the end the end of the buffer
      // and return the partialled tag to be stitched to the next buffer.
      const seqBuffer = buffer.subarray(cursor.pos, buffer.length);

      // Now create a context-led recursion into parse() - which does its own cursor walking with
      // a new cursor. We need to keep track of how many bytes that recursive parsing walks through
      // so we can pick up again in this 'parent' cursor from the right place.
      handleUndefinedLengthSQ(seqBuffer, ctx, el.tag);

      // Once we return from the recursion, we need to walk the cursor past the sequence's bytes
      // honestly cant work out why 8. When we peek before returning from recursion its at the
      // right position, but then here its 8 bytes behind and back to the sequence delimiter tag..?
      cursor.walk(ctx.sequenceBytesTraversed + 8);

      // WARN TODO we can't return true if we don't know why our recurse (which is managed
      // by handleUndefinedLengthSQ) returned. It has two base cases - one where the sequence is
      // determined to have finished and another where the value is truncated. If the value was
      // truncated then we need to signal (or i think we can just throw a BufferBoundary error)
      // that the control flow in parse()'s 'wasSeq' can't blindly unset ctx.inSeq & ctx.currSeq.
      return true;
   }
}

/**
 * Helper function; decode the current element's value.
 * @param el
 * @param buffer
 * @param cursor
 * @param ctx
 * @returns void
 */
function _decodeValueLength(el: Element, buffer: Buffer, cursor: Cursor, ctx: StreamContext): void {
   el.length = ctx.usingLE //
      ? buffer.readUInt32LE(cursor.pos)
      : buffer.readUInt32BE(cursor.pos);
}

/**
 * Decode the current element's VR and walk the cursor forward appropriately.
 * @param buffer
 * @param cursor
 * @param el
 * @returns void
 */
function decodeVRAndMoveCursor(buffer: Buffer, cursor: Cursor, el: Element): void {
   const start = cursor.pos;
   const end = cursor.pos + ByteLen.VR;
   const vrBuffer = buffer.subarray(start, end);

   el.vr = decodeVr(vrBuffer);
   cursor.walk(ByteLen.VR);

   if (!isVr(el.vr)) {
      throwUnrecognisedVr(el.vr, vrBuffer);
   }
}

/**
 * Decode the current element's tag and
 * parse the cursor forward appropriately.
 * @param buffer
 * @param cursor
 * @param el
 * @returns void
 */
function decodeTagAndMoveCursor(buffer: Buffer, cursor: Cursor, el: Element) {
   const start = cursor.pos;
   const end = cursor.pos + ByteLen.TAG_NUM;
   const tagBuffer = buffer.subarray(start, end);

   el.tag = decodeTagNum(tagBuffer);
   el.name = TagDictByHex[el.tag.toUpperCase()]?.["name"] ?? "Private or Unrecognised Tag";

   cursor.walk(ByteLen.TAG_NUM);
}

/**
 * Assess whether there are any bytes left in the buffer in relation
 * to the current cursor position.
 * @param buffer
 * @param cursor
 * @returns number
 */
function bytesLeft(buffer: Buffer, cursor: number): number {
   return buffer.length - cursor;
}

/**
 * Assess whether there are enough bytes left in the buffer to
 * decode the next tag. If not, return the truncated tag. Saves
 * redundant work and allows early return in parse() to pass back
 * a buffer to be stitched to the next streamed buffer.
 * @param buffer
 * @param cursor
 * @param expectedLength
 * @returns boolean
 */
function valueIsTruncated(buffer: Buffer, cursor: number, expectedLength: number): boolean {
   return expectedLength > bytesLeft(buffer, cursor);
}

/**
 * Throw an error if an unrecognised VR is encountered.
 * @param vr
 * @param vrBuf
 * @throws DicomError
 */
export function throwUnrecognisedVr(vr: string, vrBuffer: Buffer): never {
   throw new DicomError({
      errorType: DicomErrorType.PARSING,
      message: `Unrecognised VR: ${vr}`,
      buffer: vrBuffer,
   });
}

/**
 * Determine if a VR is in the extended format.
 * Has implications for how the cursor is walked.
 * See comments in walkEntireDicomFileAsBuffer for more info.
 * @param vr
 * @returns boolean
 */
export function isExtendedFormatVr(vr: Global.VR): boolean {
   const extVrPattern = /^OB|OW|OF|SQ|UT|UN$/;
   return extVrPattern.test(vr);
}

/**
 * Validate the DICOM preamble by checking that the first 128 bytes
 * are all 0x00. This is a security design choice by me to prevent
 * the execution of arbitrary code within the preamble. See spec notes.
 * TODO work out what quarantining really entails.
 * @param buffer
 * @throws DicomError
 */
export function validatePreamble(buffer: Buffer): void | never {
   const start = 0;
   const end = PREAMBLE_LENGTH;
   const preamble = buffer.subarray(start, end);

   if (!preamble.every(byte => byte === 0x00)) {
      throw new DicomError({
         errorType: DicomErrorType.VALIDATE,
         message: `DICOM file must begin with contain 128 bytes of 0x00 for security reasons. Quarantining this file`,
      });
   }
}

/**
 * Validate the DICOM header by checking for the 'magic word'.
 * A DICOM file should contain the 'magic word' "DICM" at bytes 128-132.
 * Preamble is 128 bytes of 0x00, followed by the 'magic word' "DICM".
 * Preamble may not be used to determine that the file is DICOM.
 * @param byteArray
 * @throws DicomError
 */
export function validateHeader(buffer: Buffer): void | never {
   const strAtHeaderPosition = buffer //
      .subarray(DICOM_HEADER_START, HEADER_END)
      .toString();

   if (strAtHeaderPosition !== DICOM_HEADER) {
      throw new DicomError({
         errorType: DicomErrorType.VALIDATE,
         message: `DICOM file does not contain 'DICM' at bytes 128-132. Found: ${strAtHeaderPosition}`,
         buffer: buffer,
      });
   }
}

/**
 * Print an element to the console.
 * @param el
 */
export function printElement(el: Element): void {
   let str = `Tag: ${el.tag}, Name: ${el.name}, VR: ${el.vr}, Length: ${el.length}, Value: ${el.value}`;

   if (el.devNote) {
      str += ` DevNote: ${el.devNote}`;
   }

   write(str, "DEBUG");
}

/**
 * Print an element to the console.
 * @param el
 */
export function printMinusValue(el: Element): void {
   const str = `Tag: ${el.tag}, Name: ${el.name}, VR: ${el.vr}, Length: ${el.length} DevNote: ${el.devNote}`;
   write(str, "DEBUG");
}

/**
 * Return a new empty element object.
 * @returns Element
 */
export function newElement(): Element {
   return {
      vr: null,
      tag: null,
      value: null,
      name: null,
      length: null,
   };
}

/**
 * Placeholder for implementation of future VR parsing.
 * @param vr
 * @returns string
 */
export function UNIMPLEMENTED_VR_PARSING(vr: Global.VR): string {
   return `Byte parsing support for VR: ${vr} is unimplemeted in this version`;
}

/**
 * Determine whether to use Little Endian byte order based on Transfer Syntax UID.
 * @param tsn
 * @returns boolean
 */
function useLE(tsn: TransferSyntaxUid): boolean {
   return [
      TransferSyntaxUid.ExplicitVRLittleEndian,
      TransferSyntaxUid.ImplicitVRLittleEndian,
      TransferSyntaxUid.JPEG2000Lossless,
      TransferSyntaxUid.DeflatedExplicitVRLittleEndian,
   ].includes(tsn);
}
