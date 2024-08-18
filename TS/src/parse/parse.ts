import { write } from "../logging/logQ.js";
import { Ctx } from "../read/read.js";
import { BufferBoundary, DicomError, MalformedDicom, UndefinedLength } from "../error/errors.js";
import { getTagName, logElement, printSqCtx } from "../utils.js";
import { ByteLen, DicomErrorType, TagDictByName, VR } from "../globalEnums.js";
import { newCursor, Cursor } from "./cursor.js";
import { parseLength, decodeTag, parseValue, parseVR, TagStr } from "./parsers.js";
import { ByteAccessTracker } from "../byteTrace/byteTrace.js";
import { writeFileSync } from "fs";

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
 * TODO for really long values like pixel data where we have to re-enter
 * parse() a lot for stitching when using small highwatermarks we
 * should basically keep a note of how far we got before stitching
 * so we can go immediately to that point to avoid re-walking over
 * the whole thing again
 * I think this is also why our 'revistited bytes' logic only works for one
 * split because it doesn't need to maintain context from previous positions?
 *
 * @param buffer
 * @param ctx
 * @returns TruncEl
 */
export function parse(buffer: Buffer, ctx: Ctx): TruncEl {
   let cursor: Cursor;
   let lastTagStart: number;

   if (ctx.outerCursor == null) {
      cursor = newCursor(0, buffer, new ByteAccessTracker(buffer.length), true);
      ctx.outerCursor = cursor;
   } else {
      cursor = newCursor(0);
   }

   while (cursor.pos < buffer.length) {
      const el = newElement();
      const sq = stacks(ctx).sq;

      lastTagStart = cursor.pos;

      try {
         // ----- Parse tag to (gggg,eeee) -----
         parseTag(buffer, cursor, el, ctx);

         // ----- Handle in-SQ control flow -----
         if (inSQ(ctx) && isEndOfItem(ctx, el)) {
            const next = peekNextTag(ctx, cursor, buffer);
            if (next === itemStartTag) {
               sq.items.push({});
               continue;
            }
            if (next === sqEndTag) {
               write(`End of SQ ${sq.tag} ${sq.name}`, "DEBUG");
               return; // basecase for undef len SQs
            }
            throw new MalformedDicom(`Got ${next} but expected ${itemEndTag} or ${sqEndTag}`);
         }

         // ----- Parse VR and Length -----
         parseVR(buffer, cursor, el, ctx);
         parseLength(el, cursor, buffer, ctx); // may or may not recurse

         // ----- Parse OW Values Separately ------
         if (el.vr == VR.OW) {
            parseOW(ctx, el, cursor, buffer);
            continue;
         }

         //  ----- Parse SQ Values Separately ------
         if (el.vr === VR.SQ) {
            parseSQ(buffer, ctx, el, cursor); // recurse with context flags
            continue;
         }

         // ---- Parse other VR Elements ----
         parseValue(buffer, cursor, el, ctx);

         // ---- Persist to dataset ----
         saveElement(ctx, el);
         logElement(el, cursor, buffer);

         if (detectDefLenSqEnd(ctx, el)) return; // basecase for defined length SQs
         if (valueIsTruncated(buffer, cursor, el.length)) {
            return buffer.subarray(lastTagStart, buffer.length);
         }
      } catch (error) {
         return handleParserErrors(error, buffer, lastTagStart, cursor, ctx, el.tag);
      }
   }
}

/**
 * Save the current element to the appropriate dataset.
 * @param ctx
 * @param lastSqItem
 * @param el
 */
function saveElement(ctx: Ctx, el: Element) {
   if (inSQ(ctx)) {
      const { lastSqItem } = stacks(ctx);
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
   return tag === itemStartTag;
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
   const nextTag = decodeTag(nextTagBytes);

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
   cursor: Cursor,
   ctx: Ctx,
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
      write(`Last tag was at cursor position: ${lastTagStart}`, "DEBUG");
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
   console.log(printSqCtx(ctx));
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
 * Manage parsing of sequence elements. Does so by recursively
 * entering parse() from the first item (dataset). Control flow
 * inside parse() continues to walk, using a new child cursor,
 * until base case(s) are met (truncation or sequence end). Then
 * sync cursors and return control to the parse() frame that
 * detected the outermost SQ.
 * @param seqBuffer
 * @param ctx
 * @param seqTag
 */
export function parseSQ(buffer: Buffer, ctx: Ctx, el: Element, parentCursor: Cursor) {
   logEntryToSQ(ctx, el, parentCursor);

   // ---- Convert element to SQ & save to appropriate dataset (top level or nested)
   const newSq = convertElToSq(el);
   saveElement(ctx, newSq);

   // ---- 0-Length, Defined length SQs ----
   if (el.length === 0) {
      write(`SQ ${el.tag} is empty (0 length, defined). Saving empty SQ element.`, "DEBUG");
      return;
   }

   // ---- Decode the first tag (should always item start tag if !empty)
   const tagBuffer = buffer.subarray(parentCursor.pos, parentCursor.pos + ByteLen.TAG_NUM);
   const tag = decodeTag(tagBuffer);

   parentCursor.walk(ByteLen.TAG_NUM, ctx, buffer); // walk past tag bytes
   parentCursor.walk(ByteLen.VR + ByteLen.EXT_VR_RESERVED, ctx, buffer); // walk past VR bytes - no interest in these bytes: item tags have no VR

   // ---- 0 length, defined length SQ ----
   if (isSeqEnd(ctx, tag)) {
      newSq.items.pop(); // init'd with an empty dataset obj, so remove it
      parentCursor.walk(ByteLen.VR + ByteLen.EXT_VR_RESERVED, ctx, buffer); // ignore SeqEnd tag special case null byte VR
      return;
   }

   // --- if !empty, must be item start tag ---
   if (!isItemStart(ctx, tag)) {
      throw new MalformedDicom(`Expected ${itemStartTag} but got ${tag}, in SQ: ${el.tag})`);
   }

   // ---- Walk up to the first item, a dataset, ready to give to parse() ----
   const firstItemDataSet = buffer.subarray(parentCursor.pos, buffer.length);

   // --- Track the sequence's state by pushing properties to context stacks
   trackSequenceElement(ctx, el, newSq);

   // ---- Begin recursive parsing of SQ items ----
   const bufferTrunc = parse(firstItemDataSet, ctx);

   // ---- Sync parent cursor with the recursive child cursor's progress
   parentCursor.sync(ctx, buffer);
   removeSqFromStack(ctx);

   // ---- Trigger buffer stitching ----
   if (bufferTrunc?.length > 0) {
      throw new BufferBoundary(`SQ ${stacks(ctx).sq.name} is split across buffer boundary`);
   }
}

/**
 * Push onto the three context stacks required to maintain
 * awareness, across functions and recursive frames, of the
 * state of sequence traversal.
 * @param ctx
 * @param el
 * @param newSq
 */
function trackSequenceElement(ctx: Ctx, el: Element, newSq: Element) {
   ctx.sqLens.push(el.length);
   ctx.sqStack.push(newSq);
   ctx.sqBytesTraversed.push(0);
}

/**
 * Handle the OW ('Other Word') Pixel Data VR.
 * WARN currently assumes 1 fragment only.
 * WARN not supporting non fragmented OB (e.g. in file meta info)
 * @param ctx
 * @param el
 * @param cursor
 * @param buffer
 */
export function parseOW(ctx: Ctx, el: Element, cursor: Cursor, buffer: Buffer) {
   const tagBytes = buffer.subarray(cursor.pos, cursor.pos + ByteLen.TAG_NUM);
   const tag = decodeTag(tagBytes);
   if (tag !== fragStartTag) {
      throw new MalformedDicom(`Expected ${fragStartTag} but got ${tag}, in OW: ${el.tag})`);
   }
   cursor.walk(ByteLen.TAG_NUM, ctx, buffer);

   const offSetTableLen = buffer.subarray(cursor.pos, cursor.pos + ByteLen.TAG_NUM).readUint32LE(0);
   if (offSetTableLen > 0) {
      cursor.walk(offSetTableLen, ctx, buffer);
      const offset = buffer.readUInt32LE(cursor.pos);
      cursor.walk(ByteLen.UINT_32 + offset, ctx, buffer);
   }

   const nextTag = decodeTag(buffer.subarray(cursor.pos, cursor.pos + ByteLen.TAG_NUM));
   if (nextTag !== itemStartTag) {
      throw new MalformedDicom(`Expected ${itemStartTag} but got ${nextTag}, in OW: ${el.tag})`);
   }

   cursor.walk(ByteLen.TAG_NUM, ctx, buffer);

   const fragLen = buffer //
      .subarray(cursor.pos, cursor.pos + ByteLen.TAG_NUM)
      .readUint32LE(0);

   if (valueIsTruncated(buffer, cursor, fragLen)) {
      throw new BufferBoundary(`Fragmented OW tag is split across buffer boundary`);
   }

   el.value = ctx.skipPixelData
      ? "SKIPPED PIXEL DATA"
      : buffer.subarray(cursor.pos, fragLen).toString("hex");

   saveElement(ctx, el);
   cursor.walk(fragLen, ctx, buffer);

   // seek JPEG EOI
   const eoiBytes = buffer.subarray(cursor.pos, cursor.pos + ByteLen.TAG_NUM);
   const eoi = decodeTag(eoiBytes);
   if (eoi !== ("(5e9f,d9ff)" as TagStr)) {
      throw new MalformedDicom(`Expected JPEG EOI but got ${eoi}`);
   }
   cursor.walk(ByteLen.TAG_NUM, ctx, buffer); // past EOI tag

   const sqDelim = decodeTag(buffer.subarray(cursor.pos, cursor.pos + ByteLen.TAG_NUM));
   if (sqDelim !== sqEndTag) {
      throw new MalformedDicom(`Expected sq delim but got ${sqDelim}`);
   }
   cursor.walk(ByteLen.TAG_NUM + ByteLen.LENGTH, ctx, buffer); // len always 0x00, can ignore
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
export function stacks(ctx: Ctx) {
   return {
      len: ctx.sqLens.at(-1),
      sq: ctx.sqStack.at(-1),
      lastSqItem: ctx.sqStack.at(-1)?.items?.at(-1),
      bytes: ctx.sqBytesTraversed.at(-1),
      allBytesN: () => ctx.sqBytesTraversed.reduce((a, b) => a + b, 0),
      allBytes: ctx.sqBytesTraversed,
   };
}

/**
 * Decode the current element's tag and
 * parse the cursor forward appropriately.
 * @param buffer
 * @param cursor
 * @param el
 */
function parseTag(buffer: Buffer, cursor: Cursor, el: Element, ctx: Ctx) {
   const start = cursor.pos;
   const end = cursor.pos + ByteLen.TAG_NUM;
   const tagBuffer = buffer.subarray(start, end);

   el.tag = decodeTag(tagBuffer);
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

function logEntryToSQ(ctx: Ctx, el: Element, parentCursor: Cursor) {
   if (inSQ(ctx)) {
      write(`Parsing nested SQ ${el.tag}, ${el.name}, parentCursor: ${parentCursor.pos}`, "DEBUG");
   } else {
      write(`Parsing SQ ${el.tag}, ${el.name}, parentCursor: ${parentCursor.pos}`, "DEBUG");
   }
}
