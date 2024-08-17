import { write } from "../logging/logQ.js";
import { Ctx } from "../read/read.js";
import { BufferBoundary, DicomError, MalformedDicom, UndefinedLength } from "../error/errors.js";
import { debugPrint, getTagName } from "../utils.js";
import { ByteLen, DicomErrorType, TagDictByName, VR } from "../globalEnums.js";
import { newCursor, Cursor } from "./cursor.js";
import {
   decodeLenMoveAndCursor,
   decodeTagNum,
   decodeValueAndMoveCursor,
   decodeVRAndMoveCursor,
   TagStr,
} from "./decoders.js";
import { ByteAccessTracker } from "../byteTrace/byteTrace.js";

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
let start: DOMHighResTimeStamp;
export function parse(buffer: Buffer, ctx: Ctx): TruncEl {
   const tracker = new ByteAccessTracker(buffer.length);
   let cursor: Cursor;
   start ??= performance.now();

   if (ctx.outerCursor == null) {
      cursor = newCursor(0, buffer, tracker);
      ctx.outerCursor = cursor;
   } else {
      cursor = newCursor(0);
   }

   while (cursor.pos < buffer.length) {
      const el = newElement();
      const { sq, lastSqItem } = stacks(ctx);
      let lastTagStart = cursor.pos;

      try {
         decodeTagAndMoveCursor(buffer, cursor, el, ctx);

         if (inSQ(ctx) && isEndOfItem(ctx, el)) {
            const next = peekNextTag(ctx, cursor, buffer);

            if (next === itemStartTag) {
               sq.items.push({});
               continue;
            }

            if (next === sqEndTag) {
               return; // basecase for undef len SQs
            }

            throw new MalformedDicom(`Got ${next} but expected ${itemEndTag} or ${sqEndTag}`);
         }

         decodeVRAndMoveCursor(buffer, cursor, el, ctx);

         const cont = decodeLenMoveAndCursor(el, cursor, buffer, ctx); // may or may not recurse
         if (cont) {
            // there are cases where we need to move onto the
            // next element because decodeLenMoveAndCursor() has managed
            // things like recursive SQs or OW pixel data, and now control
            // is returned to this parent frame and we need to continue
            continue;
         }

         decodeValueAndMoveCursor(buffer, cursor, el, ctx);
         debugPrint(el, cursor, buffer);
         saveElement(ctx, lastSqItem, el);

         if (detectDefLenSqEnd(ctx, el)) {
            return; // recursive basecase
         }

         if (valueIsTruncated(buffer, cursor, el.length)) {
            return buffer.subarray(lastTagStart, buffer.length);
         }
      } catch (error) {
         return handleParserErrors(error, buffer, lastTagStart, el.tag);
      }
   }

   console.log(`PARSE TOOK: ${performance.now() - start}`); // this is correctly the first parse() only because
   // recursive calls to parse hit base cases above this. Try it and see, it logs only once despite parse() being
   // called 1-n times.
}

/**
 * Save the current element to the appropriate dataset.
 * @param ctx
 * @param lastSqItem
 * @param el
 */
function saveElement(ctx: Ctx, lastSqItem: DataSet, el: Element) {
   if (inSQ(ctx)) {
      lastSqItem[el.tag] = el;
   } else {
      ctx.dataSet[el.tag] = el;
   }
}

/**
 * Determine if the current tag is the delimiter for the end of a defined
 * length sequence. This is base case detection for use within parse().
 * @param ctx
 */
function detectDefLenSqEnd(ctx: Ctx, el: Element) {
   const { sq, len, bytes } = stacks(ctx);
   const isEnd =
      sq && //
      len !== maxUint32 &&
      len === bytes;

   if (isEnd) {
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

      write(`End of defined length SQ: ${sq.name}. Final element decoded was ${el.tag}"`, "DEBUG");
   }

   return isEnd;
}

/**
 * Determine if the current tag is the delimiter for the end of an item data set.
 * @param el
 * @returns boolean
 */
function isEndOfItem(ctx: Ctx, el: Element): boolean {
   return inSQ(ctx) && el.tag === itemEndTag;
}

/**
 * Determine if the current tag is the delimiter for the end of a sequence.
 * @param ctx
 * @param el
 * @returns boolean
 */
function isSeqEnd(ctx: Ctx, tag: TagStr): boolean {
   return inSQ(ctx) && tag === sqEndTag;
}

/**
 * Determine if the current tag is the start of an item data set in a sequence.
 * @param ctx
 * @param tag
 * @returns boolean
 */
function isItemStart(ctx: Ctx, tag: TagStr): boolean {
   return inSQ(ctx) && tag === itemStartTag;
}

/**
 * Called when the parser encounters the end of an item data set in a sequence.
 * Required because the next tag controls the flow of the parser; undefined length
 * SQs will just start a new item or end the sequence. Note that this is intended
 * for use for undefined length SQs. Defined length SQs do not rely on peeking the
 * next tag to determine what to do next.
 * 'Peek' arguably wrong name for this because we do walk the cursor that's passed in
 * but whatever.
 * @param ctx
 * @param cursor
 * @param buffer
 * @param itemDataSet
 * @returns NextTag - string
 */
type NextTag = TagStr;
function peekNextTag(ctx: Ctx, cursor: Cursor, buffer: Buffer): NextTag {
   const { sq } = stacks(ctx);
   write(`Handling end of a dataSet item in SQ ${sq.tag} ${sq.name}. `, "DEBUG");

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
function handleParserErrors(
   error: any,
   buffer: Buffer,
   lastTagStart: number,
   tag?: TagStr
): TruncEl {
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
 * Remove the last SQ from each of the stack (must happen together)
 * @param ctx
 */
export function removeSqFromStack(ctx: Ctx) {
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

   // const lengthBuffer = seqBuffer.subarray(seqCursor.pos, seqCursor.pos + ByteLen.LENGTH);
   // const lengthInt = lengthBuffer.readUInt32LE(0);

   // // if (lengthInt !== 0) {
   // //    throw new MalformedDicom(`Expected 0x00000000 but got ${lengthInt} in SQ: ${ctx.currSqTag})`);
   // // }
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
export function parseSQ(buffer: Buffer, ctx: Ctx, el: Element, parentCursor: Cursor) {
   write(`Parsing new SQ element ${el.tag}, ${el.name}`, "DEBUG");

   // *defined* len SQ's. Simpler case handling:
   // just save empty SQ, pop back off the stack,
   // and continue parsing the parent dataset
   if (el.length === 0) {
      if (inSQ(ctx)) {
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

   // 0 len, undefined length SQ TODO can move this higher and remove need to sync parent cursor?
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

   parentCursor.sync(ctx, buffer); // must be called before LIFO pop(), which happens below if truncated buffer or in decoders.decodeLenMoveAndCursor()

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

   if (inSQ(ctx)) {
      stacks(ctx).lastSqItem[newSq.tag] = newSq; // else add new SQ to last item of current SQ nesting
   } else {
      ctx.dataSet[newSq.tag] = newSq; // add SQ to top level
   }

   ctx.sqLens.push(el.length);
   ctx.sqStack.push(newSq);
   ctx.sqBytesTraversed.push(0);

   return newSq;
}

/**
 * Handle the OW ('Other Word') Pixel Data VR.
 * WARN currently assumes 1 fragment only.
 * @param ctx
 * @param el
 * @param cursor
 * @param buffer
 */
export function parseOW(ctx: Ctx, el: Element, cursor: Cursor, buffer: Buffer) {
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

   if (inSQ(ctx)) {
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

export function inSQ(ctx: Ctx): boolean {
   return stacks(ctx).len > 0;
}

/**
 * Get the LIFO stacks' last-added elements.
 * WARN this must not be used to set values, only to get them.
 * Can call prototype methods on the returned objects, just don't
 * assign values to these because they will not reflect in the
 * actual stacks.
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
export function valueIsTruncated(buffer: Buffer, cursor: Cursor, elementLen: number): boolean {
   return elementLen > bytesLeft(buffer, cursor.pos);
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
