import { write } from "../logging/logQ.js";
import { Ctx } from "../read/read.js";
import { decodeTagNum, TagStr } from "./tagNums.js";
import { decodeValue, decodeVr } from "./valueDecoders.js";
import { BufferBoundary, DicomError, MalformedDicom, UndefinedLength } from "../error/errors.js";
import {
   debugPrint,
   json,
   printElement,
   printMinusValue,
   UNIMPLEMENTED_VR_PARSING,
} from "../utilts.js";
import {
   ByteLen,
   DicomErrorType,
   TagDictByHex,
   TagDictByName,
   TransferSyntaxUid,
   VR,
} from "../globalEnums.js";
import { newCursor, Cursor } from "./cursor.js";

export type TruncEl = Buffer | null; // because streaming will guarantee cutting tags up
export type ParseResult = { truncated: true | null; buf: TruncEl };
export type DataSet = Record<string, Element>;
export type Item = DataSet; // items are just datasets contained in sequences
export type Element = {
   tag: TagStr;
   name: string;
   vr: VR;
   length: number;
   items?: Item[];
   value?: string | number | Buffer;
   devNote?: string;
};

export const maxUint16 = 65_535;
export const maxUint32 = 4_294_967_295;

export const premableLen = 128;
export const header = "DICM";
export const headerStart = premableLen;
export const headerEnd = premableLen + 4;

export const itemStartTag = TagDictByName.ItemStart.tag; // (fffe,e000)
export const itemEndTag = TagDictByName.ItemEnd.tag; // (fffe,e00d)
export const sqEndTag = TagDictByName.SequenceEnd.tag; // (fffe,e0dd)
export const fragStartTag = "(fffe,e000)";

/**
 * Decode and serialise elements contained in a buffered subset
 * of a DICOM file.
 *
 * Return a buffer windowed from the start of the last started
 * element, if the end of the buffer truncates it, to support
 * stitching in consuming code (streams, network sockets etc).
 *
 * Each parse() call, and by extension each loop iteration,
 * must be for a new element starting at the first byte of the
 * tag number.
 *
 * @param buffer
 * @param ctx
 * @returns TruncEl
 */
export function parse(buffer: Buffer, ctx: Ctx): TruncEl {
   const cursor = newCursor(0);

   while (cursor.pos < buffer.length) {
      const el = newElement();
      const { sq, lastSqItem } = stacks(ctx);
      let lastTagStart = cursor.pos;

      try {
         decodeTagAndMoveCursor(buffer, cursor, el, ctx);

         if (inSequence(ctx) && isEndOfItem(ctx, el)) {
            const next = peekNextTag(ctx, cursor, buffer);
            if (next === itemStartTag) {
               sq.items.push({});
               continue;
            } else if (next === sqEndTag) {
               return; // basecase for undef len SQs, which use SQ delimiters.
            }
            throw new MalformedDicom(`Got ${next} but expected ${itemEndTag} or ${sqEndTag}`);
         }

         decodeVRAndMoveCursor(buffer, cursor, el, ctx);

         const cont = decodeLenMoveAndCursor(el, cursor, buffer, ctx); // may or may not cause SQ recursion. May want to refactor this.
         if (cont) {
            continue; // there are cases where we need to move onto the
            // next element because decodeLenMoveAndCursor() has managed
            // things like recursive SQs or OW pixel data, and now control
            // is returned to this parent frame and we need to continue
         }

         decodeValueAndMoveCursor(buffer, cursor, el, ctx);
         debugPrint(el, cursor, buffer);
         saveElement(ctx, lastSqItem, el);

         if (detectDefLenSqEnd(ctx, el)) {
            return; // basecase
         }

         if (valueIsTruncated(buffer, cursor, el.length)) {
            return buffer.subarray(lastTagStart, buffer.length);
         }
      } catch (error) {
         return errorPathway(error, buffer, lastTagStart, el.tag);
      }
   }
}

/**
 * Save the current element to the appropriate dataset.
 * @param ctx
 * @param lastSqItem
 * @param el
 */
function saveElement(ctx: Ctx, lastSqItem: DataSet, el: Element) {
   if (inSequence(ctx)) {
      lastSqItem[el.tag] = el;
   } else {
      ctx.dataSet[el.tag] = el;
   }
}

/**
 * Determine if the current tag is the delimiter for the end of a defined
 * length sequence. This is a base case for the parse() function.
 * @param ctx
 */
function detectDefLenSqEnd(ctx: Ctx, el: Element) {
   const { sq, len, bytes } = stacks(ctx);
   const isEnd =
      sq && //
      len !== maxUint32 &&
      len === bytes;

   if (isEnd) {
      handleDefLenSqEnd(ctx, el);
      return true;
   }

   return false;
}

/**
 * Determine if the current tag is the delimiter for the end of a
 * defined length sequence and persist the completed item dataSet
 * to the sequence's items array.
 * @param ctx
 * @param el
 * @param itemDataSet
 */
function handleDefLenSqEnd(ctx: Ctx, el: Element) {
   const { sq, bytes } = stacks(ctx);
   if (bytes > sq.length) {
      throw new MalformedDicom(
         `Traversed more bytes than the defined length of the SQ. ` +
            `This is a bug or malformed DICOM. ` +
            `SQ: ${sq} - ` +
            `Expected SQ length: ${sq}` +
            `Traversed: ${bytes} - `
      );
   }

   write(
      `End of defined length SQ: ${sq.name}. Final element decoded was ${el.tag} - ${el.name} - "${el.value}"`,
      "DEBUG"
   );
}

/**
 * Determine if the current tag is the delimiter for the end of an item data set.
 * @param el
 * @returns boolean
 */
function isEndOfItem(ctx: Ctx, el: Element): boolean {
   return inSequence(ctx) && el.tag === itemEndTag;
}

/**
 * Determine if the current tag is the delimiter for the end of a sequence.
 * @param ctx
 * @param el
 * @returns boolean
 */
function isSeqEnd(ctx: Ctx, tag: TagStr): boolean {
   return inSequence(ctx) && tag === sqEndTag;
}

/**
 * Determine if the current tag is the start of an item data set in a sequence.
 * @param ctx
 * @param tag
 * @returns boolean
 */
function isItemStart(ctx: Ctx, tag: TagStr): boolean {
   return inSequence(ctx) && tag === itemStartTag;
}

/**
 * Called when the parser encounters the end of an item data set in a sequence.
 * Required because the next tag controls the flow of the parser; undefined length
 * SQs will just start a new item or end the sequence. Note that this is intended
 * for use for undefined length SQs. Defined length SQs do not rely on peeking the
 * next tag to determine what to do next.
 * @param ctx
 * @param cursor
 * @param buffer
 * @param itemDataSet
 * @returns NextTag - string
 */
type NextTag = TagStr;
function peekNextTag(ctx: Ctx, cursor: Cursor, buffer: Buffer): NextTag {
   write(`Handling end of a dataSet item in SQ: ${stacks(ctx).sq.name}. `, "DEBUG");

   // walk past & ignore this length, its always 0x00000000 for item delim tags.
   cursor.walk(ByteLen.UINT_32, ctx, buffer);

   // now we should peek the next tag to determine what to do next.
   const nextTagBytes = buffer.subarray(cursor.pos, cursor.pos + 4);
   const nextTag = decodeTagNum(nextTagBytes);

   cursor.walk(ByteLen.UINT_32, ctx, buffer); // walk past the tag string we just decoded
   cursor.walk(ByteLen.UINT_32, ctx, buffer); // walk past the sqEndTag's length bytes (always 0x00) - ignore it

   return nextTag;
}

/**
 * Handle errors that occur during the parsing of a DICOM file. If the error
 * is unrecoverable then throw it, otherwise return the partialled tag in bytes
 * to be stitched to the next buffer. Partialled is for handling stitching across
 * streamed buffers' boundaries, parsing error is for when the parser is unable
 * to handle for some other reason.
 * Used in parse().
 * @param error
 * @param buffer
 * @param lastTagStart
 * @throws Error
 * @returns TruncEl
 */
function errorPathway(error: any, buffer: Buffer, lastTagStart: number, tag?: TagStr): TruncEl {
   const partialled = [BufferBoundary, RangeError];
   const isUndefinedLength = error instanceof UndefinedLength;
   const parsingError = partialled.every(ex => !(error instanceof ex)); // not a truncation error but some unanticipated parsing error

   if (parsingError && !isUndefinedLength) {
      write(`Error parsing tag ${tag ?? ""}: ${error.message}`, "ERROR");
      throw error;
   }

   if (error instanceof BufferBoundary || error instanceof RangeError) {
      write(`Tag is split across buffer boundary ${tag ?? ""}`, "DEBUG");
      return buffer.subarray(lastTagStart, buffer.length);
   }
}

/**
 * Type guard for VRs
 * @param vr
 */
export const isVr = (vr: string): vr is Global.VR => {
   return vr in VR;
};

/**
 * Decode the current element's value and move the cursor forwards.
 * @param buffer
 * @param cursor
 * @param el
 * @param Ctx
 */
function decodeValueAndMoveCursor(buffer: Buffer, cursor: Cursor, el: Element, ctx: Ctx) {
   if (valueIsTruncated(buffer, cursor, el.length)) {
      throw new BufferBoundary(`Tag ${el.tag} is split across buffer boundary`);
   }

   const start = cursor.pos;
   const end = cursor.pos + el.length;
   const valueBuffer = buffer.subarray(start, end);

   el.value = decodeValue(el.vr, valueBuffer, ctx);
   cursor.walk(el.length, ctx, buffer); // to get to the start of the next tag
}

/**
 * Remove the last SQ from each of the stack (must happen together)
 * @param ctx
 */
function removeSqFromStack(ctx: Ctx) {
   ctx.sqLens.pop();
   ctx.sqStack.pop();
   ctx.sqBytesTraversed.pop();
}

/**
 * Handle the case where an SQ has an undefined length and no items.
 * Reset our context flags and push an empty sequence element to the
 * parent dataset (LIFO unimplemented).
 * @param ctx
 * @param seqBuffer
 * @param seqCursor
 */
function handleEmptyUndefinedLengthSQ(ctx: Ctx, el: Element, seqBuffer: Buffer, seqCursor: Cursor) {
   throw new Error("Function not implemented.");
   removeSqFromStack(ctx); // TODO this has broken since implementing LIFO stacking

   const lengthBuffer = seqBuffer.subarray(seqCursor.pos, seqCursor.pos + ByteLen.LENGTH);
   const lengthInt = lengthBuffer.readUInt32LE(0);

   // if (lengthInt !== 0) {
   //    throw new MalformedDicom(`Expected 0x00000000 but got ${lengthInt} in SQ: ${ctx.currSqTag})`);
   // }
}

/**
 * Convert an element to a sequence element with an empty items array.
 * @param el
 */
function convertElToSq(el: Element): Element {
   const newSq = {
      ...el,
      length: undefined,
      items: [{}],
   };
   delete newSq.value;
   return newSq;
}

/**
 * This handles recursive parsing of nested items and their datasets according
 * to the DICOM specification for the byte structures of sequenced VRs.
 * @param seqBuffer
 * @param ctx
 * @param seqTag
 */
function handleSQ(buffer: Buffer, ctx: Ctx, el: Element, parentCursor: Cursor) {
   write(
      `Encountered a new SQ element ${el.tag}, ${el.name} at cursor pos ${parentCursor.pos}`,
      "DEBUG"
   );

   if (el.length === 0) {
      //   *defined* len SQ's easy case handling
      if (inSequence(ctx)) {
         ctx.dataSet[el.tag] = convertElToSq(el);
      } else {
         stacks(ctx).lastSqItem[el.tag] = convertElToSq(el);
      }

      removeSqFromStack(ctx);

      return true;
   }

   initNewSqEl(el, ctx);

   const seqCursor = newCursor(0); // window the buffer from the known start of the SQ & create a new cursor to walk it
   const seqBuffer = buffer.subarray(parentCursor.pos, buffer.length);

   const tagBuffer = seqBuffer.subarray(seqCursor.pos, seqCursor.pos + ByteLen.TAG_NUM);
   const tag = decodeTagNum(tagBuffer);

   seqCursor.walk(ByteLen.TAG_NUM, ctx, seqBuffer); // walk past the tag bytes

   // 0 len, undefined length SQ
   if (isSeqEnd(ctx, tag)) {
      seqCursor.walk(ByteLen.VR + ByteLen.EXT_VR_RESERVED, ctx, seqBuffer); // no interest in these bytes
      stacks(ctx).sq.items.pop(); // remove empty item dataset from when init'd the SQ
      parentCursor.sync(ctx, buffer);
      return;
   } else if (!isItemStart(ctx, tag)) {
      throw new MalformedDicom(`Expected ${itemStartTag} but got ${tag}, in SQ: ${el.tag})`);
   }

   seqCursor.walk(ByteLen.VR + ByteLen.EXT_VR_RESERVED, ctx, seqBuffer); // no interest in these bytes

   const firstItemDataSet = seqBuffer.subarray(seqCursor.pos, seqBuffer.length);
   const bufferTrunc = parse(firstItemDataSet, ctx);

   parentCursor.sync(ctx, buffer);

   if (bufferTrunc?.length > 0) {
      const { sq } = stacks(ctx);
      removeSqFromStack(ctx); // pop stack here because its the SQ's start bytes that gets restarted from
      throw new BufferBoundary(`SQ ${sq.name} is split across buffer boundary`); // trigger stitching
   }
}

/**
 * Add a new SQ to the appopriate dataset and push
 * needed things onto the stack.
 * @param el
 * @param ctx
 */
function initNewSqEl(el: Element, ctx: Ctx): Element {
   const newSq = convertElToSq(el);

   if (inSequence(ctx)) {
      stacks(ctx).lastSqItem[newSq.tag] = newSq; // else add new SQ to last item of current SQ nesting
   } else {
      ctx.dataSet[newSq.tag] = newSq; // add SQ to top level
   }

   ctx.sqLens.push(el.length);
   ctx.sqStack.push(newSq);
   ctx.sqBytesTraversed.push(0);

   return newSq;
}

function printSqCtx(ctx: Ctx) {
   const printObj = {
      sqLens: ctx.sqLens,
      sqStack: ctx.sqStack.map(sq => sq.name).join(" > "),
      sqBytesTraversed: ctx.sqBytesTraversed,
   };
   return `SQ Context: ${json(printObj)}`;
}

/**
 * Get the plain text tag name from the Tag Dictionary
 * @param tag
 * @returns string
 */
function getTagName(tag: string) {
   return (
      TagDictByHex[tag?.toUpperCase()]?.["name"] ?? //
      "Private or Unrecognised Tag"
   );
}

/**
 * Handle the OW ('Other Word') Pixel Data VR.
 * WARN currently assumes 1 fragment only.
 * @param ctx
 * @param el
 * @param cursor
 * @param buffer
 */
function handleOW(ctx: Ctx, el: Element, cursor: Cursor, buffer: Buffer) {
   const tagBytes = buffer.subarray(cursor.pos, cursor.pos + ByteLen.TAG_NUM);
   const tag = decodeTagNum(tagBytes);

   if (tag === fragStartTag) {
      cursor.walk(ByteLen.TAG_NUM, ctx, buffer);
   } else {
      throw new MalformedDicom(`Expected ${fragStartTag} but got ${tag}, in OW: ${el.tag})`);
   }

   const offSetTableLen = buffer.subarray(cursor.pos, cursor.pos + ByteLen.TAG_NUM).readUint32LE(0);

   if (offSetTableLen > 0) {
      cursor.walk(offSetTableLen, ctx, buffer);
      const offset = buffer.readUInt32LE(cursor.pos);
      cursor.walk(ByteLen.UINT_32 + offset, ctx, buffer);
   }

   const nextTag = decodeTagNum(buffer.subarray(cursor.pos, cursor.pos + ByteLen.TAG_NUM));

   if (nextTag !== itemStartTag) {
      throw new MalformedDicom(`Expected ${itemStartTag} but got ${nextTag}, in OW: ${el.tag})`);
   } else {
      cursor.walk(ByteLen.TAG_NUM, ctx, buffer);
   }

   const fragLen = buffer //
      .subarray(cursor.pos, cursor.pos + ByteLen.TAG_NUM)
      .readUint32LE(0);

   if (valueIsTruncated(buffer, cursor, fragLen)) {
      throw new BufferBoundary(`Fragmented OW tag is split across buffer boundary`);
   }

   if (ctx.skipPixelData) {
      el.value = "SKIPPED PIXEL DATA PER CONFIGURATION OPTION";
   } else {
      el.value = buffer.subarray(cursor.pos, fragLen).toString("hex");
   }

   if (inSequence(ctx)) {
      const { lastSqItem } = stacks(ctx);
      lastSqItem[el.tag] = el;
   } else {
      ctx.dataSet[el.tag] = el;
   }

   cursor.walk(fragLen, ctx, buffer);

   //  check for JPEG EOI
   const eoiBytes = buffer.subarray(cursor.pos, cursor.pos + ByteLen.TAG_NUM);
   const eoi = decodeTagNum(eoiBytes);

   if (eoi !== ("(5e9f,d9ff)" as TagStr)) {
      throw new MalformedDicom(`Expected JPEG EOI but got ${eoi}`);
   } else {
      cursor.walk(ByteLen.TAG_NUM, ctx, buffer);
   }

   const sqDelim = decodeTagNum(buffer.subarray(cursor.pos, cursor.pos + ByteLen.TAG_NUM));
   if (sqDelim !== sqEndTag) {
      throw new MalformedDicom(`Expected sq delim but got ${sqDelim}`);
   } else {
      cursor.walk(ByteLen.TAG_NUM + ByteLen.LENGTH, ctx, buffer); // len always 0x00, can ignore
   }

   return true;
}

/**
 * Decode the current element's value length, and move the cursor forward
 * by either the 2 or 4 decoded bytes depending on the VR type (std/ext).
 * @param el
 * @param cursor
 * @param buffer
 * @returns DidRecurse
 */
type Continue = boolean | void;
function decodeLenMoveAndCursor(el: Element, cursor: Cursor, buffer: Buffer, ctx: Ctx): Continue {
   // Check if a standard VR, wich is the simple case: save len, walk cursor, return control to parse()
   if (!isExtVr(el.vr)) {
      el.length = ctx.usingLE //
         ? buffer.readUInt16LE(cursor.pos)
         : buffer.readUInt16BE(cursor.pos); // len < 2 bytes, (65,535)
      cursor.walk(ByteLen.UINT_16, ctx, buffer);
      return false;
   }

   // ----- Else handle the extended VR tags ------

   cursor.walk(ByteLen.EXT_VR_RESERVED, ctx, buffer); // 2 unused bytes on all ext VRs - can ignore
   decodeValueLength(el, buffer, cursor, ctx); // lens < 4 bytes, (4,294,967,295)
   cursor.walk(ByteLen.UINT_32, ctx, buffer);

   if (el.vr === VR.OB) {
      throw new DicomError({
         errorType: DicomErrorType.PARSING,
         message: `OB VR is not supported in this version of the parser.`,
      });
   }

   // ----- Handle OW ('Other Word') Pixel Data ------
   // WARN currently assumes 1 fragment only. WARN not supporting non fragmented OB (e.g. in file meta info)
   if (el.vr == VR.OW) {
      handleOW(ctx, el, cursor, buffer);
      return true;
   }

   // ----- SEQUENCE ELEMENT HANDLING BELOW -----
   if (el.vr === VR.SQ) {
      handleSQ(buffer, ctx, el, cursor); // recurse with context flags
      removeSqFromStack(ctx);
      return true;
   }

   return false;
}

export function inSequence(ctx: Ctx): boolean {
   return ctx.sqStack.length > 0;
}

/**
 * Get the LIFO stacks' last-added elements.
 * WARN this must not be used to set values, only to get them.
 * @param ctx
 */
function stacks(ctx: Ctx) {
   return {
      len: ctx.sqLens.at(-1),
      sq: ctx.sqStack.at(-1),
      lastSqItem: ctx.sqStack.at(-1)?.items?.at(-1),
      bytes: ctx.sqBytesTraversed.at(-1),
   };
}

/**
 * Helper function; decode the current element's value.
 * @param el
 * @param buffer
 * @param cursor
 * @param ctx
 * @returns void
 */
function decodeValueLength(el: Element, buffer: Buffer, cursor: Cursor, ctx: Ctx) {
   el.length = ctx.usingLE //
      ? buffer.readUInt32LE(cursor.pos)
      : buffer.readUInt32BE(cursor.pos);
}

/**
 * Decode the current element's VR and walk the cursor
 * @param buffer
 * @param cursor
 * @param el
 * @throws DicomError
 */
function decodeVRAndMoveCursor(buffer: Buffer, cursor: Cursor, el: Element, ctx: Ctx) {
   const start = cursor.pos;
   const end = cursor.pos + ByteLen.VR;
   const vrBuffer = buffer.subarray(start, end);

   el.vr = decodeVr(vrBuffer);
   cursor.walk(ByteLen.VR, ctx, buffer);

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
 */
function decodeTagAndMoveCursor(buffer: Buffer, cursor: Cursor, el: Element, ctx: Ctx) {
   const start = cursor.pos;
   const end = cursor.pos + ByteLen.TAG_NUM;
   const tagBuffer = buffer.subarray(start, end);

   el.tag = decodeTagNum(tagBuffer);
   el.name = getTagName(el.tag);

   cursor.walk(ByteLen.TAG_NUM, ctx, buffer);
}

/**
 * True is there are walkable bytes left in the buffer
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
 * @param elementLen
 * @returns boolean
 */
function valueIsTruncated(buffer: Buffer, cursor: Cursor, elementLen: number): boolean {
   return elementLen > bytesLeft(buffer, cursor.pos);
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
export function isExtVr(vr: Global.VR): boolean {
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
   const end = premableLen;
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
      .subarray(headerStart, headerEnd)
      .toString();

   if (strAtHeaderPosition !== header) {
      throw new DicomError({
         errorType: DicomErrorType.VALIDATE,
         message: `DICOM file does not contain 'DICM' at bytes 128-132. Found: ${strAtHeaderPosition}`,
         buffer: buffer,
      });
   }
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
