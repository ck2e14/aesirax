import { BufferBoundary, DicomError, Malformed, UndefinedLength } from "../error/errors.js";
import { parseLength, decodeTag, parseValue, parseVR, TagStr } from "./parsers.js";
import { Bytes, DicomErrorType, TagDictByName, VR } from "../enums.js";
import { cPos, getTagName, logElement, printSqCtx } from "../utils.js";
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
export const EOI_TAG = "(5e9f,d9ff)" as TagStr;

/**
 * Decode and serialise elements contained in a buffered subset
 * of a DICOM file.
 * Return a buffer windowed from the start of the last started
 * element, if the end of the buffer truncates it, to support
 * stitching in consuming code (streams, network sockets etc).
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

   let cursor: Cursor = newCursor(ctx);
   let lastTagStart: number;

   while (cursor.pos < buffer.length) {
      lastTagStart = cursor.pos;
      const el = newElement();
      const sq = stacks(ctx).sq;

      try {
         if (isDefLenSqEnd(ctx, el)) {
            exitParse(ctx, cursor);
            return; // def len sq basecase
         }

         parseTag(buffer, cursor, el, ctx);

         if (isDefLenItemStartTag(ctx, el)) {
            sq.items.push({});
            cursor.walk(Bytes.LENGTH, ctx, buffer);
            continue;
         }

         if (isItemEndUndefLenSq(ctx, el)) {
            const next = nextUndefLenSqTag(ctx, cursor, buffer);
            if (next === ITEM_START_TAG) {
               write(`Start of new item in SQ ${sq.tag} ${sq.name}`, "DEBUG");
               sq.items.push({});
               continue;
            }
            if (next === SQ_END_TAG) {
               write(`End of SQ ${sq.tag} ${sq.name}`, "DEBUG");
               stacks(ctx).sq.length = stacks(ctx).bytes;
               exitParse(ctx, cursor);
               return; // undef len sq basecase
            }
            throw new Malformed(`Got ${next}, expected ${ITEM_END_TAG}/${SQ_END_TAG}`);
         }

         parseVR(buffer, cursor, el, ctx);
         parseLength(el, cursor, buffer, ctx);

         switch (true) {
            case el.vr === VR.SQ:
               parseSQ(buffer, ctx, el, cursor); // ctx-aware recurse
               continue;

            case el.vr === VR.OW:
               parseOW(ctx, el, cursor, buffer);
               continue;

            case el.vr === VR.OB && el.length === MAX_UINT32:
               parseUndefLenOB(ctx, el, cursor, buffer);
               continue;

            default:
               parseValue(buffer, cursor, el, ctx);
               saveElement(ctx, el, cursor, buffer);
               continue;
         }
      } catch (error) {
         exitParse(ctx, cursor);
         return handleEx(error, buffer, lastTagStart, el.tag);
      }
   }

   exitParse(ctx, cursor);
   return buffer.subarray(lastTagStart, buffer.length);
}

/**
 * Must be called in all return points from parse() to ensure
 * that the cursor is disposed of and the depth is decremented.
 * @param ctx
 * @param cursor
 */
function exitParse(ctx: Ctx, cursor: Cursor) {
   ctx.depth--;
   cursor.dispose();
}

/**
 * Detect the start of a new defined length SQ's item.
 * @param ctx
 * @param el
 * @returns
 */
export function isDefLenItemStartTag(ctx: Ctx, el: Element) {
   return el.length < MAX_UINT32 && el.tag === ITEM_START_TAG;
}

/**
 * Detect the end of an undefined length SQ's item.
 * @param ctx
 * @param el
 * @returns
 */
export function isItemEndUndefLenSq(ctx: Ctx, el: Element) {
   write(`End of undefined length sequence item ${el.tag} ${el.name}`, "DEBUG");
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
 *
 * Note that this has to be the first action in each parse loop because this
 * type of SQ doesn't have a delimiter tag to indicate the end of the sequence.
 * It relies on tracking the number of walked bytes and comparing against the
 * stated Uint32 length from the beginning of the sequence. This can only
 * be reached after each loop iteration, i.e. after the decoding of the last
 * sq element's value. It needs to go first, not after running the switch
 * statement that parses values, because the recursive end of a child sq's
 * last element value can also be the end of 1-n parent sqs. So if we return
 * from parseSQ() recursion and hit the 'continue', the next action needs
 * to be this detection. That way we can handle the termination of 1-n sequences
 * where the last actual element value was deeply nested.
 *
 * In other words; this check handles instances where the end of one SQ's last
 * element's value represents the end of 1 or more parent SQ's last element value,
 * as well as instances where an SQ is not terminated by the termination of one
 * of its children SQs. This caused a mindbending bug(!)
 * @param ctx
 */
function isDefLenSqEnd(ctx: Ctx, el: Element) {
   if (!inSQ(ctx)) return false;

   const { sq, len, bytes } = stacks(ctx);
   const isEnd =
      sq && //
      len !== MAX_UINT32 &&
      len === bytes + 8; // +8 because we walked 8 bytes (parentCursor.walk() - parseSQ()) before pushing sq to stack

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
function nextUndefLenSqTag(ctx: Ctx, cursor: Cursor, buffer: Buffer): TagStr {
   const { sq } = stacks(ctx);
   write(`Handling end of a dataSet item in SQ ${sq.tag} ${sq.name}`, "DEBUG");
   cursor.walk(Bytes.LENGTH, ctx, buffer); // ignore this length, its always 0x0 for item delims

   const nextTagBytes = buffer.subarray(cursor.pos, cursor.pos + Bytes.TAG_NUM);
   const nextTag = decodeTag(nextTagBytes, ctx);

   cursor.walk(Bytes.TAG_NUM, ctx, buffer);
   cursor.walk(Bytes.LENGTH, ctx, buffer); // ignore SQ_END_TAG's length bytes (always 0x0)

   return nextTag;
}

/**
 * Handle errors that occur during the parsing of a DICOM file. If
 * the error is unrecoverable then throw it, otherwise return the
 * partialled tag in bytes to be stitched to the next buffer.
 *
 * 'Partialled' is for handling stitching across streamed buffers'
 * boundaries, parsing error is for when the parser is unable to
 * handle for some other reason.
 *
 * Truncated SQ stitching works by throwing in the child depth
 * and catching in the parent. So we pop() & pass buffer back to
 * read() from the start of the SQ.
 *
 * @param error
 * @param buffer
 * @param lastTagStart
 * @throws Error
 * @returns PartialEl
 */
function handleEx(error: any, buffer: Buffer, lastTagStart: number, tag?: TagStr): PartialEl {
   const isUndefinedLength = error instanceof UndefinedLength;
   const parsingError = [BufferBoundary, RangeError].every(ex => !(error instanceof ex)); // i.e. not a buffer truncation error

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

function isEmptyDefLenSQ(el: Element) {
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
   return (
      el.vr === VR.SQ && //
      el.length === MAX_UINT32 &&
      tag === SQ_END_TAG
   );
}

/**
 * Manage parsing of sequence elements. Does so by recursively
 * entering parse() from the first item (dataset). Control flow
 * inside parse() continues to walk, using a new child cursor,
 * until base case(s) are met (truncation or sequence end). Then
 * sync cursors and return control to the parse() frame that
 * detected the outermost SQ.
 * TODO check whether depth == cq stack .length, if not throw
 * @param seqBuffer
 * @param ctx
 * @param seqTag
 */
export function parseSQ(buffer: Buffer, ctx: Ctx, el: Element, parentCursor: Cursor) {
   logEntryToSQ(ctx, el, parentCursor);

   // -- Convert & save as SQ
   el = convertElToSq(el);
   saveElement(ctx, el, parentCursor, buffer, false);

   // -- 0-Length, Defined length SQs
   if (isEmptyDefLenSQ(el)) {
      el.items.pop(); // init'd with an empty dataset obj, so remove it
      return; // detect and return before walking to avoid need to retreat
   }

   // -- Decode first tag (should be item start tag if !empty)
   const tagBuffer = buffer.subarray(parentCursor.pos, parentCursor.pos + Bytes.TAG_NUM);
   const tag = decodeTag(tagBuffer, ctx);

   parentCursor.walk(Bytes.TAG_NUM, ctx, buffer); // walk past tag bytes
   parentCursor.walk(Bytes.VR + Bytes.EXT_VR_RESERVED, ctx, buffer); // walk past VR bytes -  item tags have no VR

   if (isEmptyUndefinedLengthSQ(el, tag)) {
      write(`Saving undefined length empty SQ ${el.tag} ${el.name}.`, "DEBUG");
      el.length = 0;
      el.items.pop();
      return;
   }

   // -- Stack SQ props
   trackSQ(ctx, el, el);

   // -- Recurse to parse entire SQ, from the first item (dataset)
   const item1 = buffer.subarray(parentCursor.pos, buffer.length);
   const partial = parse(item1, ctx);

   // -- Add traversed bytes & LIFO pop
   parentCursor.sync(ctx, buffer);
   removeSqFromStack(ctx);

   write(`Current stacks: ${printSqCtx(ctx)}, Depth: ${ctx.depth}`, "DEBUG");

   // -- Trigger stitching
   if (partial?.length > 0) {
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
function trackSQ(ctx: Ctx, el: Element, newSq: Element) {
   ctx.sqLens.push(el.length);
   ctx.sqStack.push(newSq);
   ctx.sqBytesStack.push(0);
}

/**
 * Handle the OB ('Other Byte') Pixel Data VR.
 * Checks for offset table but ignores it if exists, maybe
 * will support in future. It will save fragments individually,
 * optionally skipping the pixel data.
 * WARN does this properly handle non-fragment pixel data??
 * @param ctx
 * @param el
 * @param cursor
 * @param buffer
 */
export function parseUndefLenOB(ctx: Ctx, el: Element, cursor: Cursor, buffer: Buffer) {
   const itemTagBytes = buffer.subarray(cursor.pos, cursor.pos + Bytes.TAG_NUM);
   const itemTag = decodeTag(itemTagBytes, ctx);
   if (itemTag !== ITEM_START_TAG) {
      throw new Malformed(`Expeted an item start tag in undefined len ${el.tag} but got ${itemTag}`);
   } else {
      cursor.walk(Bytes.TAG_NUM, ctx, buffer);
   }

   // -- Seek offset table. If it exists, walk past it & ignore.
   const offsetLenBytes = buffer.subarray(cursor.pos, cursor.pos + Bytes.LENGTH);
   const offsetLen = ctx.usingLE //
      ? offsetLenBytes.readUint32LE(0)
      : offsetLenBytes.readUint32BE(0);

   cursor.walk(Bytes.LENGTH, ctx, buffer);
   cursor.walk(offsetLen, ctx, buffer);

   el.length = 24 + offsetLen; // I.e. all the fixed length bytes that we walked and then whatever was the size of the offset as well.
   el.fragments = {} as Fragments;

   let i = 0;
   while (true) {
      const tagBytes = buffer.subarray(cursor.pos, cursor.pos + Bytes.TAG_NUM);
      const tag = decodeTag(tagBytes, ctx);
      cursor.walk(Bytes.TAG_NUM, ctx, buffer);

      if (tag === SQ_END_TAG) {
         cursor.walk(Bytes.LENGTH, ctx, buffer);
         break;
      }

      const fragLen = ctx.usingLE
         ? buffer //
              .subarray(cursor.pos, cursor.pos + Bytes.LENGTH)
              .readUInt32LE(0)
         : buffer //
              .subarray(cursor.pos, cursor.pos + Bytes.LENGTH)
              .readUInt32BE(0);

      el.length += fragLen;
      cursor.walk(Bytes.LENGTH, ctx, buffer);

      if (valueIsTruncated(buffer, cursor, fragLen)) {
         throw new BufferBoundary(`${el.name} is truncated`);
      }

      const pixelBytes = buffer.subarray(cursor.pos, cursor.pos + fragLen);
      cursor.walk(fragLen, ctx, buffer);

      if (ctx.skipPixelData) {
         el.fragments[i] = { length: fragLen, value: "SKIPPED PIXEL DATA" };
      } else {
         el.fragments[i] = { length: fragLen, value: pixelBytes.toString("hex") };
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

   // -- Parse the first tag (could be fragment start tag)
   const firstTagBytes = buffer.subarray(cursor.pos, cursor.pos + Bytes.TAG_NUM);
   const firstTag = decodeTag(firstTagBytes, ctx);
   if (firstTag === FRAG_START_TAG) {
      write(`Detected a fragment in ${el.tag} (${el.vr}). Inspecting offset table...`, "DEBUG");
   }
   cursor.walk(Bytes.TAG_NUM, ctx, buffer);

   // -- Parse offset table length
   const offSetTableLen = ctx.usingLE
      ? buffer //
           .subarray(cursor.pos, cursor.pos + Bytes.TAG_NUM)
           .readUint32LE(0)
      : buffer //
           .subarray(cursor.pos, cursor.pos + Bytes.TAG_NUM)
           .readUint32BE(0);

   // -- If nonzero, walk the entire table, not supporting this atm
   if (offSetTableLen > 0) {
      cursor.walk(offSetTableLen, ctx, buffer);
      const offset = ctx.usingLE //
         ? buffer.readUInt32LE(cursor.pos)
         : buffer.readUInt32BE(cursor.pos);
      cursor.walk(Bytes.UINT_32 + offset, ctx, buffer); // is this correct?
   }

   // -- Expect next tag to be the start of the pixel data
   const nextTagBytes = buffer.subarray(cursor.pos, cursor.pos + Bytes.TAG_NUM);
   const nextTag = decodeTag(nextTagBytes, ctx);
   if (nextTag === ITEM_START_TAG) {
      cursor.walk(Bytes.TAG_NUM, ctx, buffer);
   } else {
      throw new Malformed(`Expected ${ITEM_START_TAG} but got ${nextTag}, in OW: ${el.tag})`);
   }

   // -- Parse the fragment length
   const fragLen = ctx.usingLE
      ? buffer //
           .subarray(cursor.pos, cursor.pos + Bytes.TAG_NUM)
           .readUint32LE(0)
      : buffer //
           .subarray(cursor.pos, cursor.pos + Bytes.TAG_NUM)
           .readUint32BE(0);

   // -- Check for truncation, trigger stitching
   if (valueIsTruncated(buffer, cursor, fragLen)) {
      throw new BufferBoundary(`Fragmented OW tag is split across buffer boundary`);
   }

   // -- Parse the fragment
   el.value = ctx.skipPixelData //
      ? "SKIPPED PIXEL DATA"
      : buffer.subarray(cursor.pos, fragLen).toString("hex");

   cursor.walk(fragLen, ctx, buffer);
   saveElement(ctx, el, cursor, buffer);

   // -- Seek JPEG EOI tag
   const eoiBytes = buffer.subarray(cursor.pos, cursor.pos + Bytes.TAG_NUM);
   const eoi = decodeTag(eoiBytes, ctx);
   if (eoi === EOI_TAG) {
      cursor.walk(Bytes.TAG_NUM, ctx, buffer); // past EOI tag
   } else {
      throw new Malformed(`Expected JPEG EOI but got ${eoi}`);
   }

   // -- Seek SQ end tag
   const sqDelimTagBytes = buffer.subarray(cursor.pos, cursor.pos + Bytes.TAG_NUM);
   const sqDelim = decodeTag(sqDelimTagBytes, ctx);
   if (sqDelim !== SQ_END_TAG) {
      throw new Malformed(`Expected sq delim but got ${sqDelim}`);
   } else {
      cursor.walk(Bytes.TAG_NUM + Bytes.LENGTH, ctx, buffer); // len always 0x00, can ignore
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
      len: ctx.sqLens.at(-1),
      sq: ctx.sqStack.at(-1),
      bytes: ctx.sqBytesStack.at(-1),
      allBytes: ctx.sqBytesStack,
      lastSqItem: ctx.sqStack.at(-1)?.items?.at(-1),
      allBytesN: () => ctx.sqBytesStack.reduce((a, b) => a + b, 0),
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
   const end = cursor.pos + Bytes.TAG_NUM;
   const tagBuffer = buffer.subarray(start, end);

   el.tag = decodeTag(tagBuffer, ctx);
   el.name = getTagName(el.tag);

   cursor.walk(Bytes.TAG_NUM, ctx, buffer);
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
   return { vr: null, tag: null, value: null, name: null, length: null };
}

function logEntryToSQ(ctx: Ctx, el: Element, parentCursor: Cursor) {
   const printLen = el.length === MAX_UINT32 ? "undef len" : el.length;
   if (inSQ(ctx)) {
      write(`Parsing nested SQ ${el.tag}, ${el.name}, len: ${printLen}, parentCursor: ${parentCursor.pos}`, "DEBUG");
   } else {
      write(`Parsing SQ ${el.tag}, ${el.name}, len: ${printLen}, parentCursor: ${parentCursor.pos}`, "DEBUG");
   }
}
