import { ByteLen, DicomErrorType, TagDictByHex, TransferSyntaxUid, VR } from "../globalEnums.js";
import { write } from "../logging/logQ.js";
import { StreamContext } from "../read/read.js";
import { decodeTagNum, TagStr } from "./tagNums.js";
import { isVr } from "./typeGuards.js";
import { decodeValue, decodeVr } from "./valueDecoders.js";
import {
   BufferBoundaryError,
   DicomError,
   MalformedDicomError,
   UndefinedLength,
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
 * Walk through a buffer containing a subset of a DICOM file's bytes, and
 * parse the tags.
 *
 * Implicit VR is not supported in this version.
 *
 * Return a buffer containing the truncated tag if the buffer is incomplete.
 * This is used to allow on-the-fly parsing of DICOM files as they are read
 * and stitching together truncated tags that span multiple byteArrays.
 *
 * Note that currently this assumes that the DICOM itself is not malformed.
 * Because currently it just assumes that a handling error signifies the
 * truncation of the buffer which is not realistic. But for testing purposes
 * it's fine because we're working with always perfectly formed DICOMs for now
 *
 * LEARNING NOTES:
 *
 * In DICOM we have two main types of VR:
 *  1. Standard Format VR
 *  2. Extended Format VR
 *
 * As the name suggests Extended Format VRs are for VRs that may store
 * very large amounts of data, like OB VRs for pixel data.
 *
 * When parsing the byte streams of DICOM files' Tags, we need to parse
 * the cursor forward a little differently based on whether its a standard
 * or extended format VR.
 *
 * The byte stream structure for standard VR is like this:
 *   - [2 x ASCII chars (2 bytes) e.g. SH]
 *   - [2 x bytes indicating the subsequent value length]
 *   - [The tag's actual value, of length 0x0000 - 0xFFFF]
 *
 * Given that standard VRs permit a 2-byte hex to specify the length,
 * this means the decimal length of the value can be at most 65,535 (0xFFFF).
 *
 * That doesn't really cut it for the very large tags like pixel data.
 * So the byte stream structure for those extended VRs is like this:
 *   - [2 x ASCII chars (2 bytes) e.g. OB]
 *   - [2 x reserved bytes, always 0x0000 0x0000]
 *   - [The tag's actual value, of length 0x0000 - 0xFFFFFFFF]
 *
 * Given that the extended VRs permit a 4-byte hex to specify the length,
 * which is represented as 0xFFFFFFFF. This means the decimal length of the
 * value can be at most 4,294,967,295 (i.e. about 4GB). Note that in reality
 * some applications are going tell you to GTFO if you pass 4GB in one single
 * tag but it depends what you're dealing with. Ultrasounds are going to be
 * very long in pixel data tags, for example.
 *
 * Note as well that for futureproofing the DICOM spec demands that there are
 * 2 reserved bytes in the extended format VRs, which aren't yet implemented
 * in the spec as anything, but are still always present (as 0x0000), so we need
 * to know about these so we can parse the cursor forward by the right amount.
 *
 * Note that this function assumes you've chekced 0-128 bytes for the preamble,
 * and 128-132 bytes for 'DICM' header.
 *
 * Note that SQ items may not have a length specified, and instead have a length
 * of 0xFFFFFFFF. This is currently supported but not all SQs are supported yet.
 * See notes in the function for more info.
 *
 * WARN currently with massive pixel data values we're still loading it all into
 * memory based on our 'is trunated? return and concat' approach. Okay for now.
 * Can do a discard approach where it's still streamed into memory, which is
 * pretty much unavoidable, but then instead of returning the buffer we just
 * return a Buffer.alloc(0) which will fit into the existing strcuture I think.
 *
 * @param buffer
 * @param elements
 * @returns PartialTag
 */
export function parse(buffer: Buffer, ctx: StreamContext): PartialTag {
   ctx.usingLE = useLE(ctx.transferSyntaxUid);

   if (ctx.first) {
      write(`Decoding as ${ctx.usingLE ? "LE" : "BE"} byte order`, "DEBUG");
   }

   // TODO implement LIFO stack for nested sequencing

   const cursor = newCursor(),
      newItem = "(fffe,e000)",
      itemEnd = "(fffe,e00d)",
      sqEnd = "(fffe,e0dd)";

   let lastTagStart: number = cursor.pos; // for truncation handling of streamed buffers
   let itemDataSet = {}; // ignored if not in a sequence. Items in a sequence all contain
   // their own datasets. Is overwritten freely and at point of needing to write value, we
   // copy by value not pass by reference (using spread operator)

   if (ctx.inSequence) {
      ctx.dataSet[ctx.currSqTag] ??= newSeqElement(ctx);
   }

   while (cursor.pos < buffer.length) {
      lastTagStart = cursor.pos;
      const el = newElement();

      try {
         decodeTagAndMoveCursor(buffer, cursor, el);

         const reachedSqEnd = ctx.inSequence && el.tag === (itemEnd as TagStr);
         if (reachedSqEnd) {
            write(
               `Reached item delimiter: ${el.tag}, there will be no more elements to place inside this item's dataSet. ` +
                  `Copying the dataset to the current sequence element's (${ctx.currSqTag}) items array`,
               "DEBUG"
            );

            cursor.walk(4); // walk past & ignore VR, its 00000000H on itemEnd tags per the spec

            ctx.dataSet[ctx.currSqTag].items.push({
               ...itemDataSet, // must copy this object's value -  not pass it by reference - otherwise each previously
               // added item data set will equal the last item in the sequence's dataset. LIFO stack in future for nested
               // sequences to add to correct SQ's items[]
            });

            // now we should peek the next tag to determine what to do next.
            const nextTagBytes = buffer.subarray(cursor.pos, cursor.pos + 4);
            const nextTag = decodeTagNum(nextTagBytes);
            cursor.walk(ByteLen.UINT_32); // walk past the tag string we just decoded
            cursor.walk(ByteLen.UINT_32); // walk past the sqEnds' length (0) - can ignore it

            // (A) the next tag is a new start of item tag. So we just want
            // to continue to the next while() decode the next tag.
            if (nextTag === (newItem as TagStr)) {
               continue;
            }

            // (B) the next tag is the sqEnd tag, at which point we should return from the recursion.
            // For sequences nested inside other sequences, need to LIFO .pop() a stack of sequences?
            if (nextTag === (sqEnd as TagStr)) {
               ctx.sequenceBytesTraversed = cursor.pos; // for syncing cursor byte position up the call stack to parent cursor.
               return;
            }

            throw new MalformedDicomError(
               `Detected the end of an item's dataset but then saw neither a new item nor a sequence delimiter`
            );
         }

         decodeVRAndMoveCursor(buffer, cursor, el);

         const wasSeq = decodeValueLengthAndMoveCursor(el, cursor, buffer, ctx);
         if (wasSeq) {
            ctx.inSequence = false;
            ctx.currSqTag = null;
            ctx.sequenceBytesTraversed = null;
            continue; // continue to decode the next tag (outside of the current sequence)
         } else {
            decodeValueAndMoveCursor(buffer, cursor, el, ctx);
         }

         if (ctx.inSequence) itemDataSet[el.tag] = el;
         else ctx.dataSet[el.tag] = el; // if not in a sequence add to the top level dataset.

         debugPrint(el);
      } catch (error) {
         return handleErrorPathways(error, buffer, lastTagStart, el.tag);
      }

      if (valueIsTruncated(buffer, cursor.pos, el.length)) {
         // this condition is met if we didnt hit a decode error based on unexpectedly
         // short bytes for decoding, say, a tag num where 4 bytes was required but the
         // buffer only had 3 left. The 'value' part of a tag needs to be detected for
         // truncation via comparing expected length to number of bytes between cursor
         // and the end of the buffer.
         return buffer.subarray(lastTagStart, buffer.length);
      }
   }
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
      length: null, // TODO for undefined len SQ
      value: null,
      items: [],
   };
}

/**
 * Create a cursor object to track the current position in the buffer.
 * @returns Cursor
 */
function newCursor(pos = 0) {
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
   const partialled = [BufferBoundaryError, DicomError]; // can refine
   const isUndefinedLength = error instanceof UndefinedLength;
   const parsingError = partialled.every(ex => !(error instanceof ex));

   if (parsingError && !isUndefinedLength) {
      throw error;
   }

   if (error instanceof BufferBoundaryError) {
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
   cursor: { pos: number; walk: (n: number) => void },
   el: Element,
   StreamContext: StreamContext
): void {
   if (valueIsTruncated(buffer, cursor.pos, el.length)) {
      throw new BufferBoundaryError(
         `\n  Tag ${el.tag} is split across buffer boundary.\n  This is much more likely to just be the end\n  of the currently streamed buffer than it is\n  a malformed DICOM image, but an error nonetheless.\n  Just a calm and expected one. :)`
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
 * properties as we enter and exit nested sequences. Not going to be too hard to implement.

 * Implemented following SQ DICOM spec:
 * dicom.nema.org/medical/dicom/current/output/chtml/part05/sect_7.5.html
 *
 * @param seqBuffer
 * @param context
 * @param seqTag
 */
function handleUndefinedLengthSQ(seqBuffer: Buffer, ctx: StreamContext, seqTag: string) {
   const seqCursor = newCursor(); // fresh cursor from pos 0 in the sequence buffer
   const itemTag: TagStr = "(fffe,e000)" as TagStr;

   // read the tag just to make sure it's as expected - a new itemTag. Could just assume a
   // nd walk past this but useful to have seen it for myself to help learn the byte structure.
   const tagBuffer = seqBuffer.subarray(seqCursor.pos, seqCursor.pos + ByteLen.TAG_NUM),
      tag = decodeTagNum(tagBuffer),
      name = TagDictByHex[tag?.toUpperCase()]?.["name"] ?? "Private or Unrecognised Tag",
      confirmedAsItem = tag === itemTag && name === "Item";

   if (confirmedAsItem) {
      seqCursor.walk(ByteLen.TAG_NUM);
   } else {
      throw new MalformedDicomError(`Expected ${itemTag} but got ${tag}, in sequence: ${seqTag})`);
   }

   // now we decode the length. Per spec, SQ's with a max UInt32 signifiy 'undefined' length. This
   // type of SQ depends on presence of item start, item end, and sequence end delimitation tags.
   const length = ctx.usingLE //
      ? seqBuffer.readUInt32LE(seqCursor.pos)
      : seqBuffer.readUInt32BE(seqCursor.pos);

   // walk the cursor past the UInt32 we just decoded (4bytes) so we are now at the start of the
   // first tag in the item's dataset.
   seqCursor.walk(ByteLen.UINT_32);

   // now we're going to recurse into parse() with some added context so that different behaviour
   // and basecases can be followed. Return case is detecting an end of sequence tag.
   if (length === 4_294_967_295) {
      ctx.currSqTag = seqTag;
      ctx.inSequence = true; // WARN: the context should include that we're in an undef length SQ, because parse() will need to behave differently once we implement defined length SQ handling logic.
      parse(seqBuffer.subarray(seqCursor.pos), ctx);
   }
}

/**
 * Decode the current element's value length
 * and parse the cursor forward appropriately.
 * @param el
 * @param cursor
 * @param buffer
 */
type ExitedSequence = boolean | void;
function decodeValueLengthAndMoveCursor(
   el: Element,
   cursor: { pos: number; walk: (n: number) => void },
   buffer: Buffer,
   context: StreamContext
): ExitedSequence {
   const isExtVr = isExtendedFormatVr(el.vr);

   if (!isExtVr) {
      el.length = context.usingLE
         ? buffer.readUInt16LE(cursor.pos)
         : buffer.readUInt16BE(cursor.pos); // Standard VR tags' lengths are 2 bytes, so max length is 65,535
      cursor.walk(ByteLen.UINT_16);
      return false;
   }

   if (isExtVr) {
      cursor.walk(ByteLen.EXT_VR_RESERVED); // 2 reserved bytes can be ignored
      _decodeValueLength(el, buffer, cursor, context); // Extended VR tags' lengths are 4 bytes, may be enormous
      cursor.walk(ByteLen.UINT_32);
   }

   const definedLength = el.vr === VR.SQ && el.length !== 0 && el.length !== 4_294_967_295;
   if (isExtVr && definedLength) {
      // if SQ, length is defined, and its not 0, parse it according to table:
      // https://dicom.nema.org/medical/dicom/current/output/chtml/part05/sect_7.5.2.html#table_7.5-1
      // TODO
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
      write(
         `Encountered an SQ at cursor pos ${cursor.pos} - will recursively parse. SQ tag: ` +
            el.tag,
         "DEBUG"
      );
      // if SQ, & length is undefined, parse it according to table:
      // https://dicom.nema.org/medical/dicom/current/output/chtml/part05/sect_7.5.2.html#table_7.5-3
      // First, we want to isolate the bytes from the start of the first item in the sequence.
      // we don't know where the end is, or even if the current buffer is long enough to contain
      // the entire sequence. So we'll pass all bytes, even if that's beyond the end of the sequence,
      // to our sequence parsing logic. We've amended parse() so that it knows when to return early
      // from this based on detecting sequence's end via byte decoding - so its fine to pass too many.
      const seqBuffer = buffer.subarray(cursor.pos, buffer.length);
      // note that we are about to start a recursive branch, which does its own cursor walking. We
      // need to keep track of how many bytes that recursive parsing walks through so we can pick up
      // again in this 'parent' cursor from the right place.
      handleUndefinedLengthSQ(seqBuffer, context, el.tag);
      cursor.walk(context.sequenceBytesTraversed + 8); // honestly cant work out why 8. When we peek before returning from recursion its at the right position, but then here its 8 bytes behind and back to the sequence delimiter tag, confusing as fuck;
      return true;
   }
}

/**
 * Helper function, not a public interface. Decode
 * the current element's value.
 * @param el
 * @param buffer
 * @param cursor
 * @param context
 * @returns void
 */
function _decodeValueLength(
   el: Element,
   buffer: Buffer,
   cursor: { pos: number },
   context: StreamContext
): void {
   el.length = context.usingLE //
      ? buffer.readUInt32LE(cursor.pos)
      : buffer.readUInt32BE(cursor.pos);
}

/**
 * Decode the current element's VR and
 * parse the cursor forward appropriately.
 * @param buffer
 * @param cursor
 * @param el
 * @returns void
 */
function decodeVRAndMoveCursor(
   buffer: Buffer,
   cursor: { pos: number; walk: (n: number) => void },
   el: Element
): void {
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
function decodeTagAndMoveCursor(
   buffer: Buffer,
   cursor: { pos: number; walk: (n: number) => void },
   el: Element
) {
   const start = cursor.pos;
   const end = cursor.pos + ByteLen.TAG_NUM;
   const tagBuffer = buffer.subarray(start, end);

   el.tag = decodeTagNum(tagBuffer);
   el.name = TagDictByHex[el.tag.toUpperCase()]?.["name"] ?? "Private or Unrecognised Tag";

   cursor.walk(ByteLen.TAG_NUM);
}

/**
 * Assess whether there are any bytes left in the buffer
 * in relation to the current cursor position.
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
 * Validate the DICOM preamble by checking that the
 * first 128 bytes are all 0x00. This is a security
 * design choice by me to prevent the execution of
 * arbitrary code within the preamble. See spec notes.
 * TODO work out what quarantining really entails
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
 */
export function UNIMPLEMENTED_VR_PARSING(vr: Global.VR) {
   return `Byte parsing support for VR: ${vr} is unimplemeted in this version`;
}

/**
 * Determine whether to use Little Endian byte order
 * based on the Transfer Syntax UID.
 * @param tsn
 * @returns
 */
function useLE(tsn: TransferSyntaxUid): boolean {
   return [
      TransferSyntaxUid.ExplicitVRLittleEndian,
      TransferSyntaxUid.ImplicitVRLittleEndian,
      TransferSyntaxUid.JPEG2000Lossless,
      TransferSyntaxUid.DeflatedExplicitVRLittleEndian,
   ].includes(tsn);
}
