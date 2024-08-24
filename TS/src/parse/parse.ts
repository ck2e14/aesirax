import { BufferBoundary, DicomError, Malformed, UndefinedLength } from "../error/errors.js";
import { parseLength, decodeTag, parseValue, parseVR, TagStr } from "./parsers.js";
import { ByteLen, DicomErrorType, TagDictByName, VR } from "../enums.js";
import { cPos, getTagName, json, logElement, printSqCtx } from "../utils.js";
import { newCursor, Cursor } from "./cursor.js";
import { write } from "../logging/logQ.js";
import { Ctx } from "../read/read.js";

export type ParseResult = { truncated: true | null; buf: PartialEl };
export type PartialEl = Buffer | null; // because streaming
export type DataSet = Record<string, Element>;
export type Item = DataSet; // items are dataset aliases, in sequences
export type Fragments = Record<number, { value: string; length: number }>;
export type Element = {
   tag: TagStr;
   name: string;
   vr: VR;
   length: number;
   items?: Item[];
   value?: string | number | Buffer;
   fragments?: Fragments;
   devNote?: string;
};
export const MAX_UINT16 = 65_535;
export const MAX_UINT32 = 4_294_967_295;
export const PREAMBLE_LEN = 128;
export const HEADER = "DICM";
export const HEADER_START = PREAMBLE_LEN;
export const HEADER_END = PREAMBLE_LEN + HEADER.length;
export const FRAG_START_TAG = TagDictByName.ItemStart.tag; // (fffe,e000)
export const ITEM_START_TAG = TagDictByName.ItemStart.tag; // (fffe,e000)
export const ITEM_END_TAG = TagDictByName.ItemEnd.tag; //     (fffe,e00d)
export const SQ_END_TAG = TagDictByName.SequenceEnd.tag; //   (fffe,e0dd)

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
 * @returns PartialEl
 */
export function parse(buffer: Buffer, ctx: Ctx): PartialEl {
   ctx.depth++;
   let cursor: Cursor;
   let lastTagStart: number;

   if (ctx.outerCursor == null) {
      cursor = newCursor(0, ctx, buffer, true);
      ctx.outerCursor = cursor;
   } else {
      cursor = newCursor(0, ctx);
   }

   while (cursor.pos < buffer.length) {
      const el = newElement();
      const sq = stacks(ctx).sq;

      lastTagStart = cursor.pos;

      try {
         // ----- Defined len SQ basecase -----
         if (detectDefLenSqEnd(ctx, el)) {
            // Note that this *must* be the first action in the loop because when
            // we return from nested recursion via parseSQ() below, we will 'continue'
            // on to the next iteration of this loop because the end of an SQ = the start
            // of the next element to decode. However, defined length SQs rely on tracking
            // the number of traversed bytes compared to the stated length of the SQ before
            // we began recursing (via stacks), so before we try to parse any next element's
            // tag, we have to determine if the element should belong to the SQ or if we
            // need to exit that recursive depth and pop from the sequences stack.
            // In other words; this check handles instances where the end of one SQ's last
            // element's value represents the end of 1 or more parent SQ's last element value,
            // as well as instances where an SQ is not terminated by the termination of one
            // of its children SQs. Mindbender.
            cursor.disposedOf = true;
            ctx.depth--;
            return;
         }

         // ------ Parse Tag (gggg,eeee) ------
         parseTag(buffer, cursor, el, ctx);

         // ---- Handle defined length next item control flow ----
         if (detectStartOfNewDefinedLengthSqItem(ctx, el)) {
            sq.items.push({});
            cursor.walk(ByteLen.LENGTH, ctx, buffer);
            continue;
         }

         // ------- Handle SQ control flow -------
         if (detectEndOfUndefinedLengthSqItem(ctx, el)) {
            const next = tagAfterEndOfItem(ctx, cursor, buffer);

            if (next === ITEM_START_TAG) {
               sq.items.push({});
               continue;
            }

            if (next === SQ_END_TAG) {
               write(`End of SQ ${sq.tag} ${sq.name}`, "DEBUG");
               stacks(ctx).sq.length = stacks(ctx).bytes;
               cursor.disposedOf = true;
               ctx.depth--;
               return; // basecase for undefined length SQs
            }

            throw new Malformed(`Got ${next}, expected ${ITEM_END_TAG}/${SQ_END_TAG}`);
         }

         // ----------- Parse VR -------------
         parseVR(buffer, cursor, el, ctx);

         // --------- Parse Length -----------
         parseLength(el, cursor, buffer, ctx);

         // -------- Parse OB Value ----------
         if (el.vr === VR.OB && el.length === MAX_UINT32) {
            parseUndefLenOB(ctx, el, cursor, buffer);
            continue;
         }

         // -------- Parse OW Value ----------
         if (el.vr === VR.OW) {
            parseOW(ctx, el, cursor, buffer);
            continue;
         }

         // -------- Parse SQ Value ----------
         if (el.vr === VR.SQ) {
            parseSQ(buffer, ctx, el, cursor); // recurse with ctx flags
            continue;
         }

         // ------ Parse other VR Values ------
         parseValue(buffer, cursor, el, ctx);
         saveElement(ctx, el, cursor, buffer);
      } catch (error) {
         console.log(`caught at depth: ${ctx.depth}`);
         // Note that stitching works whilst detecting truncation errors
         // because it is thrown by a child depth but caught at the depth
         // above, where the 'lastTagStart' is the start of the SQ. So we
         // return the bytes from the start of the SQ that had the truncated
         // element, not from the truncated element inside the SQ.
         cursor.disposedOf = true;
         ctx.depth--;
         return handleParserErrors(error, buffer, lastTagStart, el.tag);
      }
   }

   cursor.disposedOf = true;
   ctx.depth--;

   if (ctx.depth > 0) {
      return buffer.subarray(lastTagStart, buffer.length); // don't fucking remove this line.
   }
}

/**
 * Detect the start of a new defined length SQ's item.
 * @param ctx
 * @param el
 * @returns
 */
export function detectStartOfNewDefinedLengthSqItem(ctx: Ctx, el: Element) {
   return el.length < MAX_UINT32 && el.tag === ITEM_START_TAG;
}

/**
 * Detect the end of an undefined length SQ's item.
 * @param ctx
 * @param el
 * @returns
 */
export function detectEndOfUndefinedLengthSqItem(ctx: Ctx, el: Element) {
   return inSQ(ctx) && el.tag === ITEM_END_TAG;
}

/**
 * Save the current element to the appropriate dataset.
 * @param ctx
 * @param lastSqItem
 * @param el
 */
function saveElement(ctx: Ctx, el: Element, cursor: Cursor, buffer: Buffer, print = true) {
   if (print) logElement(el, cursor, buffer, ctx);
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
      len !== MAX_UINT32 &&
      len === bytes + 8; // +8 because we walked 8 bytes (see parentCursor.walk() in parseSQ())before pushing sq traversal onto the stack

   if (ctx.depth === 0 && isEnd) {
      throw new DicomError({
         errorType: DicomErrorType.PARSING,
         message:
            `End of defined length SQ ${sq.tag} ${sq.name} detected but depth is 0. ` +
            `Depth whilst inside and detecting the end of a SQ must always be 1 or greater.` +
            `0 represents the outermost level of the DICOM file. ` +
            `THIS IS A BUG! ` +
            `Depth: ${ctx.depth}. ` +
            `Stacks: ${printSqCtx(ctx)}. `,
      });
   }

   if (!isEnd) return false;

   if (bytes > sq.length) {
      throw new Malformed(
         `Traversed more bytes than the defined length of the SQ. ` +
            `This is a bug or malformed DICOM. ` +
            `SQ: ${sq} - ` +
            `Expected SQ length: ${sq}` +
            `Traversed: ${bytes} - `
      );
   }

   write(`End of defined length SQ: ${sq.name}.`, "DEBUG");

   return isEnd;
}

/**
 * Determine if the current tag is the start of an item data set in a sequence.
 * @param ctx
 * @param tag
 * @returns boolean
 */
function isItemStart(tag: TagStr): boolean {
   return tag === ITEM_START_TAG;
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
 * @returns TagStr
 */
function tagAfterEndOfItem(ctx: Ctx, cursor: Cursor, buffer: Buffer): TagStr {
   const { sq } = stacks(ctx);
   write(`Handling end of a dataSet item in SQ ${sq.tag} ${sq.name}`, "DEBUG");

   cursor.walk(ByteLen.UINT_32, ctx, buffer); // ignore  length, its always 0x00000000 for item delims

   const nextTagBytes = buffer.subarray(cursor.pos, cursor.pos + 4);
   const nextTag = decodeTag(nextTagBytes);

   cursor.walk(ByteLen.UINT_32, ctx, buffer); // walk past the tag string we just decoded
   cursor.walk(ByteLen.UINT_32, ctx, buffer); // walk past the SQ_END_TAG's length bytes (always 0x00) - ignore it

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
 * @returns PartialEl
 */
function handleParserErrors(error: any, buffer: Buffer, lastTagStart: number, tag?: TagStr): PartialEl {
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
   ctx.sqBytesStack.pop();
}

/**
 * Convert an element to a sequence element with an empty items array.
 * @param el
 */
function convertElToSq(el: Element): Element {
   const newSq = { ...el, items: [{}] };
   delete newSq.value;
   return newSq;
}

function isEmptyDefinedLengthSQ(el: Element) {
   return el.vr === VR.SQ && el.length === 0;
}

/**
 * Determine if the current tag is the delimiter for the end of a sequence.
 * WARN this currently assumes use in sequences but turns out this tag
 * is also used in things like pixel data tags. So would need to think about
 * removing the inSQ(ctx) condition below, but consider the places where it's
 * currently used and the effects that that might have.
 * @param ctx
 * @param el
 * @returns boolean
 */
function isEmptyUndefinedLengthSQ(el: Element, tag: TagStr) {
   return el.vr === VR.SQ && el.length === MAX_UINT32 && tag === SQ_END_TAG;
}

/**
 * Manage parsing of sequence elements. Does so by recursively
 * entering parse() from the first item (dataset). Control flow
 * inside parse() continues to walk, using a new child cursor,
 * until base case(s) are met (truncation or sequence end). Then
 * sync cursors and return control to the parse() frame that
 * detected the outermost SQ.
 *
 * TODO put in a check to see whether depth == cq stack .length otherwise
 * shit has gone wrong
 * @param seqBuffer
 * @param ctx
 * @param seqTag
 */
export function parseSQ(buffer: Buffer, ctx: Ctx, el: Element, parentCursor: Cursor) {
   logEntryToSQ(ctx, el, parentCursor);

   // ---- Convert element to SQ & save to appropriate dataset (top level or nested)
   const newSq = convertElToSq(el);
   saveElement(ctx, newSq, parentCursor, buffer, false);

   // ---- 0-Length, Defined length SQs
   if (isEmptyDefinedLengthSQ(el)) {
      newSq.items.pop(); // init'd with an empty dataset obj, so remove it
      return; // Detect this here before walking cursor for further SQ handling to avoid needing to retreat
   }
   // ---- Decode the first tag (should always item start tag if !empty)
   const tagBuffer = buffer.subarray(parentCursor.pos, parentCursor.pos + ByteLen.TAG_NUM);
   const tag = decodeTag(tagBuffer);

   parentCursor.walk(ByteLen.TAG_NUM, ctx, buffer); // walk past tag bytes
   parentCursor.walk(ByteLen.VR + ByteLen.EXT_VR_RESERVED, ctx, buffer); // walk past VR bytes - no interest in these bytes: item tags have no VR

   if (isEmptyUndefinedLengthSQ(el, tag)) {
      write(`Saving undefined length empty SQ ${el.tag} ${el.name}.`, "DEBUG");
      newSq.length = 0;
      newSq.items.pop();
      return;
   }

   // ---- Window from the first item, a dataset, ready to give to parse()
   const firstItemDataSet = buffer.subarray(parentCursor.pos, buffer.length);

   // ---- Track the sequence's state by pushing properties to context stacks
   trackSequenceElement(ctx, el, newSq);

   // ---- Begin recursive parsing of SQ items
   const partialEl = parse(firstItemDataSet, ctx);

   // ---- Sync parent cursor with the recursive child cursor's progress
   parentCursor.sync(ctx, buffer);

   // ---- Remove the sequence from the context stacks
   // WARN atm we are popping from stack even when we return from parse() after not hitting
   // a truncated element exception, e.g. if buffer perfectly aligns with end of an element,
   // but that end of element is not the end of the sequence.
   // So we have two options:
   // 1) try to determine whether or not to actually pop from the stack
   // 2) partialEl should only be updated inside parse() if, whilst inside a sequence, we
   // encounter a new sequence. If at depth 0 though it can be whatever the last tag was.
   // Right? This is less parser-efficient though if we keep truncating an element where
   // previous elements in the same sequence would need to be re-read.
   removeSqFromStack(ctx);
   write(`__Current stacks: ${printSqCtx(ctx)}, Depth: ${ctx.depth}`, "DEBUG");

   // ---- Trigger buffer stitching
   if (partialEl?.length > 0) {
      throw new BufferBoundary(`SQ ${stacks(ctx)?.sq?.name} is split across buffer boundary`);
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
   ctx.sqBytesStack.push(0);
}

export function parseUndefLenOB(ctx: Ctx, el: Element, cursor: Cursor, buffer: Buffer) {
   const itemTagBytes = buffer.subarray(cursor.pos, cursor.pos + ByteLen.TAG_NUM);
   const itemTag = decodeTag(itemTagBytes);
   if (itemTag !== ITEM_START_TAG) {
      throw new Malformed(`Expeted an item start tag in undefined len ${el.tag} but got ${itemTag}`);
   } else {
      cursor.walk(ByteLen.TAG_NUM, ctx, buffer);
   }

   // ---- Seek offset table - if it exists. Walk past it, idgaf about that.
   const offsetLenBytes = buffer.subarray(cursor.pos, cursor.pos + ByteLen.LENGTH);
   const offsetLen = offsetLenBytes.readUint32LE(0); // note we are assuming LE here for speed of prototyping

   cursor.walk(ByteLen.LENGTH, ctx, buffer);
   cursor.walk(offsetLen, ctx, buffer);

   let i = 0;
   el.length = 24 + offsetLen; // I.e. all the fixed length bytes that we walked and then whatever was the size of the offset as well.
   el.fragments = {} as Fragments;

   while (1) {
      const tagBytes = buffer.subarray(cursor.pos, cursor.pos + ByteLen.TAG_NUM);
      const tag = decodeTag(tagBytes);
      cursor.walk(ByteLen.TAG_NUM, ctx, buffer);

      if (tag === SQ_END_TAG) {
         cursor.walk(ByteLen.LENGTH, ctx, buffer);
         break;
      }

      const fragLen = buffer.subarray(cursor.pos, cursor.pos + ByteLen.LENGTH).readUInt32LE(0);
      cursor.walk(ByteLen.LENGTH, ctx, buffer);

      el.length += fragLen;

      if (valueIsTruncated(buffer, cursor, fragLen)) {
         throw new BufferBoundary(`${el.name} is truncated`);
      }

      const pixels = buffer.subarray(cursor.pos, cursor.pos + fragLen);
      cursor.walk(fragLen, ctx, buffer);

      if (ctx.skipPixelData) {
         el.fragments[i] = { length: fragLen, value: "SKIPPED PIXEL DATA" };
      } else {
         el.fragments[i] = { length: fragLen, value: pixels.toString("hex") };
      }
   }

   saveElement(ctx, el, cursor, buffer);
   i++;
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
   write(`parsing ow, using cursor: ${cursor.id}. All cursors: ${cPos(ctx)}`, "DEBUG");

   const isDefinedLength = el.length > 0 && el.length < MAX_UINT32;
   if (isDefinedLength) {
      write(`OW element ${el.tag} has a defined length.`, "DEBUG");
      parseValue(buffer, cursor, el, ctx);
      saveElement(ctx, el, cursor, buffer);
      write(`Finished parsing ow, using cursor: ${cursor.id}. All cursors: ${cPos(ctx, 1)}`, "DEBUG");
      return;
   }

   // ---- Parse the first tag (could be fragment start tag)
   const tagBytes = buffer.subarray(cursor.pos, cursor.pos + ByteLen.TAG_NUM);
   const tag = decodeTag(tagBytes);
   if (tag === FRAG_START_TAG) {
      write(`Detected a fragment in ${el.tag} (${el.vr}). Inspecting offset table...`, "DEBUG");
   }

   cursor.walk(ByteLen.TAG_NUM, ctx, buffer);

   // ---- Parse offset table length
   const offSetTableLen = buffer //
      .subarray(cursor.pos, cursor.pos + ByteLen.TAG_NUM)
      .readUint32LE(0);

   // ---- If nonzero, parse the length and walk past it
   if (offSetTableLen > 0) {
      cursor.walk(offSetTableLen, ctx, buffer);
      const offset = buffer.readUInt32LE(cursor.pos);
      cursor.walk(ByteLen.UINT_32 + offset, ctx, buffer);
   }

   // ---- Expect next tag to be the start of the pixel data
   const nextTag = decodeTag(buffer.subarray(cursor.pos, cursor.pos + ByteLen.TAG_NUM));
   if (nextTag !== ITEM_START_TAG) {
      throw new Malformed(`Expected ${ITEM_START_TAG} but got ${nextTag}, in OW: ${el.tag})`);
   } else {
      cursor.walk(ByteLen.TAG_NUM, ctx, buffer);
   }

   // ---- Parse the fragment length
   const fragLen = buffer //
      .subarray(cursor.pos, cursor.pos + ByteLen.TAG_NUM)
      .readUint32LE(0);

   // ---- Check for truncation, trigger stitching
   if (valueIsTruncated(buffer, cursor, fragLen)) {
      throw new BufferBoundary(`Fragmented OW tag is split across buffer boundary`);
   }

   // ---- Parse the fragment
   el.value = ctx.skipPixelData
      ? "SKIPPED PIXEL DATA"
      : buffer //
           .subarray(cursor.pos, fragLen)
           .toString("hex");

   // ---- Persist element to dataset
   saveElement(ctx, el, cursor, buffer);

   // ---- Place cursor 1 byte past frag
   cursor.walk(fragLen, ctx, buffer);

   // ---- Seek JPEG EOI tag
   const eoiBytes = buffer.subarray(cursor.pos, cursor.pos + ByteLen.TAG_NUM);
   const eoi = decodeTag(eoiBytes);
   if (eoi !== ("(5e9f,d9ff)" as TagStr)) {
      throw new Malformed(`Expected JPEG EOI but got ${eoi}`);
   } else {
      cursor.walk(ByteLen.TAG_NUM, ctx, buffer); // past EOI tag
   }

   // ---- Seek SQ end tag
   const sqDelim = decodeTag(buffer.subarray(cursor.pos, cursor.pos + ByteLen.TAG_NUM));
   if (sqDelim !== SQ_END_TAG) {
      throw new Malformed(`Expected sq delim but got ${sqDelim}`);
   } else {
      cursor.walk(ByteLen.TAG_NUM + ByteLen.LENGTH, ctx, buffer); // len always 0x00, can ignore
   }

   logElement(el, cursor, buffer, ctx);
   write(`Finished parsing ow, using cursor: ${cursor.id}. All cursors: ${cPos(ctx)}`, "DEBUG");
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
      bytes: ctx.sqBytesStack.at(-1),
      allBytes: ctx.sqBytesStack,
      allBytesN: () => ctx.sqBytesStack.reduce((a, b) => a + b, 0),
      lastSqItem: ctx.sqStack.at(-1)?.items?.at(-1),
      len: ctx.sqLens.at(-1),
      sq: ctx.sqStack.at(-1),
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
   // if(elementLen === MAX_UINT32) return false; kinda think this is required but havent got time to test it right now
   return elementLen > bytesLeft(buffer, cursor.pos);
}

/**
 * Validate the DICOM preamble by checking that the first 128 bytes
 * are all 0x00. This is a security design choice to prevent
 * the execution of arbitrary code within the preamble. See spec notes.
 * @param buffer
 * @throws DicomError
 */
export function validatePreamble(buffer: Buffer): void | never {
   const start = 0;
   const end = PREAMBLE_LEN;
   const preamble = buffer.subarray(start, end);

   if (!preamble.every(byte => byte === 0x00)) {
      throw new DicomError({
         errorType: DicomErrorType.VALIDATE,
         message: `DICOM file must begin with contain 128 bytes of 0x00 for security reasons. Quarantining this file`,
      });
   }
}

/**
 * Validate the DICOM HEADER by checking for the 'magic word'.
 * A DICOM file should contain the 'magic word' "DICM" at bytes 128-132.
 * Preamble is 128 bytes of 0x00, followed by the 'magic word' "DICM".
 * Preamble may not be used to determine that the file is DICOM.
 * @param byteArray
 * @throws DicomError
 */
export function validateHeader(buffer: Buffer): void | never {
   const strAtHeaderPosition = buffer //
      .subarray(HEADER_START, HEADER_END)
      .toString();

   if (strAtHeaderPosition !== HEADER) {
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
   const printLen = el.length === MAX_UINT32 ? "undef len" : el.length;
   if (inSQ(ctx)) {
      write(`Parsing nested SQ ${el.tag}, ${el.name}, len: ${printLen}, parentCursor: ${parentCursor.pos}`, "DEBUG");
   } else {
      write(`Parsing SQ ${el.tag}, ${el.name}, len: ${printLen}, parentCursor: ${parentCursor.pos}`, "DEBUG");
   }
}
