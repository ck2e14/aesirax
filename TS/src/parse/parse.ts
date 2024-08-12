import { write } from "../logging/logQ.js";
import { Ctx } from "../read/read.js";
import { decodeTagNum, TagStr } from "./tagNums.js";
import { decodeValue, decodeVr } from "./valueDecoders.js";
import { BufferBoundary, DicomError, MalformedDicom, UndefinedLength } from "../error/errors.js";
import {
   ByteLen,
   DicomErrorType,
   TagDictByHex,
   TagDictByName,
   TransferSyntaxUid,
   VR,
} from "../globalEnums.js";

export type TruncatedBuffer = Buffer | null; // because streaming will guarantee cutting tags up
export type ParsingResult = { returnReason: string | null; truncatedBuffer: TruncatedBuffer };
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

export const ITEM_START_TAG = TagDictByName.ItemStart.tag; // (fffe,e000)
export const ITEM_END_TAG = TagDictByName.ItemEnd.tag; // (fffe,e00d)
export const SEQ_END_TAG = TagDictByName.SequenceEnd.tag; // (fffe,e0dd)

/**
 * Parse the elements in a buffer containing a subset of a DICOM file's bytes,
 * Return a buffer containing the truncated tag if the buffer is incomplete.
 * This is used to allow on-the-fly parsing of DICOM files as they are read
 * and stitching together truncated tags that span multiple byteArrays.
 *
 * Implicit VR is unsupported.
 * TODO implement LIFO stack for nested sequencing
 *
 * @param buffer - Bytes[] from a DICOM file
 * @param ctx - Ctx
 * @returns TruncatedBuffer
 */
export function parse(buffer: Buffer, ctx: Ctx): ParsingResult {
   const cursor = newCursor(0);
   let itemDataSet = null;

   if (ctx.first) {
      ctx.usingLE = useLE(ctx.transferSyntaxUid);
      write(`Decoding as ${ctx.usingLE ? "LE" : "BE"} byte order`, "DEBUG");
   }

   if (ctx.inSequence) {
      ctx.dataSet[ctx.currSqTag] ??= newSeqElement(ctx); // stackedDataSets.at(-1) will be req'd here when handling nested SQs
      itemDataSet = {};
   }

   let lastTagStart: number = cursor.pos;

   while (cursor.pos < buffer.length) {
      lastTagStart = cursor.pos; // For stitch handling
      const el = newElement(); // An element is a tag, VR, length, and value. We decode these in four stages below.

      try {
         // [DECODING] STAGE 1:TAG (grp num & el num)
         decodeTagAndMoveCursor(buffer, cursor, el, ctx);

         // [CTRL FLOW] STAGE 2: handle end of item dataSet & possibly end of SQ
         if (isEndOfItem(ctx, el)) {
            write(`End of item in SQ: ${ctx.currSqTag}`, "DEBUG");
            const next = handleEndOfItem(ctx, cursor, buffer, itemDataSet);

            if (next === ITEM_START_TAG) {
               write(`Starting a new item in SQ: ${ctx.currSqTag}`, "DEBUG");
               continue; // Move parser's focus to the next item dataSet and its first element
            }

            if (next === SEQ_END_TAG) {
               write(`End of sequence: ${ctx.currSqTag}`, "DEBUG");
               ctx.sequenceBytesTraversed = cursor.pos; // to sync recursive cursor with parent cursor
               return; // recursive base case
            }

            throw new MalformedDicom(`Got ${next} but expected ${ITEM_END_TAG} or ${SEQ_END_TAG}`);
         }

         // [DECODING] STAGE 2: VR
         decodeVRAndMoveCursor(buffer, cursor, el, ctx);

         // [DECODING] STAGE 3: LENGTH
         const wasUndefinedLengthSqRecursion = decodeLenMoveAndCursor(el, cursor, buffer, ctx); // may or may not trigger recursion

         // [CTRL FLOW] STAGE 3.5: Move parser focus to the next tag after SQ
         if (wasUndefinedLengthSqRecursion) {
            continue; // otherwise will try to decode a VR below in a byte position where a VR isn't.
         }

         // [DECODING] STAGE 4: VALUE
         decodeValueAndMoveCursor(buffer, cursor, el, ctx);

         // [DEBUGGING] STAGE 5: Logging
         debugPrint(el);

         // [DECODING] STAGE 6: Persist element to dataSet
         if (ctx.inSequence) {
            console.log(`Adding ${el.tag} to itemDataSet: ${JSON.stringify(itemDataSet, null, 3)}`);
            itemDataSet[el.tag] = el;
         } else {
            ctx.dataSet[el.tag] = el; // top level dataset
         }

         // [CTRL FLOW] STAGE 7: Handle if we've reached the end of a defined length SQ
         if (
            ctx.inSequence &&
            ctx.currSqLen !== 4_294_967_295 &&
            ctx.sequenceBytesTraversed === ctx.currSqLen
         ) {
            handleDefLenSqEnd(ctx, el, itemDataSet);
            return; // recursive base case
         }
      } catch (error) {
         return errorPathway(error, buffer, lastTagStart, el.tag);
      }

      if (valueIsTruncated(buffer, cursor.pos, el.length)) {
         return {
            returnReason: "truncation",
            truncatedBuffer: buffer.subarray(lastTagStart, buffer.length),
         };
      }
   }
}

/**
 * Determine if the current tag is the delimiter for the end of a defined length sequence
 * and persist the completed item dataSet to the sequence's items array.
 * @param ctx
 * @param el
 * @param itemDataSet
 * @returns
 */
function handleDefLenSqEnd(ctx: Ctx, el: Element, itemDataSet: DataSet): void {
   if (ctx.sequenceBytesTraversed > ctx.currSqLen) {
      throw new MalformedDicom(
         `Somehow, while ctx.inSequence = true, we've traversed more bytes than the defined length of the SQ. ` +
            `This is a bug or malformed DICOM. ` +
            `SQ: ${ctx.currSqTag} - ` +
            `Expected SQ length: ${ctx.currSqLen}` +
            `Traversed: ${ctx.sequenceBytesTraversed} - `
      );
   }

   write(
      `End of defined length SQ: ${ctx.currSqTag}, ${ctx.currSqLen}. Final element decoded was ${el.tag} - ${el.name} - "${el.value}"`,
      "DEBUG"
   );

   ctx.dataSet[ctx.currSqTag].items.push({
      // copy, don't pass by ref - otherwise previous items will be overwritten unless a new object
      // was created in between, e.g. if the the buffer was truncated and we had to stitch it and
      // re-parse the tag with the requisite bytes.
      ...itemDataSet,
   });

   resetSqCtx(ctx);
}

/**
 * Determine if the current tag is the delimiter for the end of an item data set.
 * WARN OK here detection needs to work for defined length SQs as well
 * which means we need to:
 *    1 - have saved the SQ length to ctx when that was detected before the recursion
 *    2 - in this function, check for whether we've reached it which I think would be
 *        ctx.seqBytesTraversed === sq length?? maybe sq length -8?
 * @param ctx
 * @param el
 * @returns boolean
 */
function isEndOfItem(ctx: Ctx, el: Element) {
   return ctx.inSequence && el.tag === ITEM_END_TAG;
}

/**
 * Determine if the current tag is the delimiter for the end of a sequence.
 * @param ctx
 * @param el
 * @returns boolean
 */
function isSeqEnd(ctx: Ctx, tag: TagStr) {
   return ctx.inSequence && tag === SEQ_END_TAG;
}

/**
 * Determine if the current tag is the start of an item data set in a sequence.
 * @param ctx
 * @param tag
 * @returns boolean
 */
function isItemStart(ctx: Ctx, tag: TagStr) {
   return ctx.inSequence && tag === ITEM_START_TAG;
}

/**
 * Handle the end of an item data set in a sequence. This function is called
 * when the parser encounters the delimiter tag for the end of an item data set.
 * It saves the item data set to the sequence's items array and then peeks the
 * next tag to determine what to do next.
 *
 * Note that this is for use in SQs that DID have something inside them. Empty
 * SQs are being handled earlier, in handleSQ.
 * @param ctx
 * @param cursor
 * @param buffer
 * @param itemDataSet
 * @returns NextTag - string
 */
type NextTag = TagStr;
function handleEndOfItem(ctx: Ctx, cursor: Cursor, buffer: Buffer, itemDataSet: DataSet): NextTag {
   const nTags = Object.keys(itemDataSet).length;

   write(`Handling end of a dataSet item in SQ: ${ctx.currSqTag}. Storing ${nTags} items`, "DEBUG");

   ctx.dataSet[ctx.currSqTag].items.push({
      // important to copy by value not reference here else the next item, unless stitching coincidentally
      // causes a new parse() call to create a new object, will overwrite the previous item.
      ...itemDataSet,
   });

   // walk past & ignore this length, its always 0x00000000 for item delim tags.
   cursor.walk(ByteLen.UINT_32, ctx, buffer);

   // now we should peek the next tag to determine what to do next.
   const nextTagBytes = buffer.subarray(cursor.pos, cursor.pos + 4);
   const nextTag = decodeTagNum(nextTagBytes);

   cursor.walk(ByteLen.UINT_32, ctx, buffer); // walk past the tag string we just decoded
   cursor.walk(ByteLen.UINT_32, ctx, buffer); // walk past the SEQ_END_TAG's length bytes (always 0x00000000) - ignore it

   return nextTag;
}

/**
 * Create a new sequence element object.
 * @param ctx
 * @returns Element
 */
function newSeqElement(ctx: Ctx): Element {
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
 * Create a stateful cursor object to track where we're at in the buffer.
 * @returns Cursor
 */
type Cursor = {
   pos: number;
   walk: (n: number, ctx: Ctx, buffer?: Buffer) => void;
   retreat: (n: number) => void;
};
function newCursor(pos = 0): Cursor {
   return {
      pos: pos,

      walk: function (n: number, ctx: Ctx, buffer?: Buffer) {
         if (buffer && this.pos + n > buffer.length) {
            throw new BufferBoundary(`Cursor walk would exceed buffer length`);
         }

         if (ctx.inSequence) {
            ctx.sequenceBytesTraversed += n;
         }

         this.pos += n;
      },

      retreat: function (n: number) {
         if (this.pos - n < 0) {
            throw new BufferBoundary(`Cursor retreat would go below buffer length`);
         }

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
 * Used in parse().
 *
 * @param error
 * @param buffer
 * @param lastTagStart
 * @throws Error
 * @returns TruncatedBuffer
 */
function errorPathway(
   error: any,
   buffer: Buffer,
   lastTagStart: number,
   tag?: TagStr
): {
   returnReason: string | null;
   truncatedBuffer: Buffer;
} {
   // catching range errors so we don't need to write a 'safe parse'
   // function which would throw a BufferBoundary error anyways. So
   // just added it to the list of partialled errors.

   const partialled = [BufferBoundary, RangeError];
   const isUndefinedLength = error instanceof UndefinedLength;
   const parsingError = partialled.every(ex => !(error instanceof ex)); // not a truncation error but some unanticipated parsing error

   if (parsingError && !isUndefinedLength) {
      throw error;
   }

   if (error instanceof BufferBoundary || error instanceof RangeError) {
      write(`Tag is split across buffer boundary ${tag ?? ""}`, "DEBUG");
      return {
         returnReason: "truncation",
         truncatedBuffer: buffer.subarray(lastTagStart, buffer.length),
      };
   }
}

export const isVr = (vr: string): vr is Global.VR => {
   return vr in VR;
};

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
 * @param Ctx
 * @returns void
 */
function decodeValueAndMoveCursor(buffer: Buffer, cursor: Cursor, el: Element, ctx: Ctx): void {
   if (valueIsTruncated(buffer, cursor.pos, el.length)) {
      throw new BufferBoundary(`Tag ${el.tag} is split across buffer boundary`);
   }

   const start = cursor.pos;
   const end = cursor.pos + el.length;
   const valueBuffer = buffer.subarray(start, end);

   el.value = decodeValue(el.vr, valueBuffer, ctx);
   cursor.walk(el.length, ctx, buffer); // to get to the start of the next tag
}

/**
 * Reset context object's SQ vars. Used mostly when reaching the
 * end of a sequence so that parse's conditionals are not unintentionally
 * triggered when parsing the next tags.
 * @param ctx
 * @returns void
 */
function resetSqCtx(ctx: Ctx): void {
   ctx.inSequence = false;
   ctx.currSqTag = null;
   ctx.sequenceBytesTraversed = 0;
   ctx.currSqLen = undefined; // important to make this undefined until we start supporting nested SQ
}

/**
 * Handle the case where an SQ has an undefined length and no items.
 * Reset our context flags and push an empty sequence element to the
 * parent dataset (LIFO unimplemented).
 * @param ctx
 * @param seqBuffer
 * @param seqCursor
 * @returns void
 */
function handleEmptyUndefinedLengthSQ(ctx: Ctx, seqBuffer: Buffer, seqCursor: Cursor): void {
   ctx.dataSet[ctx.currSqTag] = newSeqElement(ctx);
   resetSqCtx(ctx);

   // this UInt32 read is a bit superfluous because it will always be 0x00000000 but
   // an opportunity to check for malformed DICOM I guess. Could just walk and assume.
   // dont ned to walk the seqCursor after because it's disposed of after this function.
   const lengthInt = seqBuffer.subarray(seqCursor.pos, seqCursor.pos + 4).readUInt32LE(0);
   if (lengthInt !== 0) {
      throw new MalformedDicom(`Expected 0x00000000 but got ${lengthInt} in SQ: ${ctx.currSqTag})`);
   }
}

/**
 * This handles recursive parsing of nested items and their datasets according
 * to the DICOM specification for the byte structures of sequenced VRs.
 *
 * WARN LIFO stack (for nesting SQs) unimplemented atm.
 *
 * dicom.nema.org/medical/dicom/current/output/chtml/part05/sect_7.5.html
 * @param seqBuffer
 * @param ctx
 * @param seqTag
 * @returns void
 */
function handleSQ(buffer: Buffer, ctx: Ctx, el: Element, parentCursor: Cursor): void {
   ctx.inSequence = true;
   ctx.currSqTag = el.tag;
   ctx.currSqLen ??= el.length; // use nullish assignment atm because we aren't yet supporting nested sequences and we need the currSqLen to remain at the 1-depth SQ's length.

   write(
      `Encountered a new SQ element ${el.tag}, ${el.name} at cursor pos ${parentCursor.pos}`,
      "DEBUG"
   );

   const seqCursor = newCursor(0);
   const seqBuffer = buffer.subarray(parentCursor.pos, buffer.length);
   const tagBuffer = seqBuffer.subarray(seqCursor.pos, seqCursor.pos + ByteLen.TAG_NUM);
   const tag = decodeTagNum(tagBuffer);

   seqCursor.walk(ByteLen.TAG_NUM, ctx, seqBuffer); // walk past the decoded tag bytes

   if (isSeqEnd(ctx, tag)) {
      write(`0 items in this undefined-length SQ, adding empty SQ and resetting ctx`, "DEBUG");
      return handleEmptyUndefinedLengthSQ(ctx, seqBuffer, seqCursor);
   }

   // All SQs should start with an item tag, check for conformity:
   if (!isItemStart(ctx, tag)) {
      throw new MalformedDicom(
         `Expected ${ITEM_START_TAG} but got ${tag}, in sequence: ${el.tag})`
      );
   }

   // Length bytes of the item are irrelevant as we're going to handle using
   // delimiter tags for defined and undefined length items. So just walk past.
   seqCursor.walk(ByteLen.UINT_32, ctx, seqBuffer);

   // Recurse into parse(), with context flags set to indicate we're in a SQ. Start with the
   // first item's dataset and let parse() continue until one of two bases cases are hit:
   //  (1) the seqBuffer is truncated
   //  (2) the sequence has been fully parsed
   const firstItemDataSet = seqBuffer.subarray(seqCursor.pos, seqBuffer.length);

   if (parse(firstItemDataSet, ctx)?.returnReason === "truncation") {
      write(`SQ ${ctx.currSqTag} is split across buffer boundary`, "DEBUG");
      ctx.dataSet[ctx.currSqTag].items.pop(); // pop to avoid duplication when re-entering parse() after stitching
      throw new BufferBoundary(`SQ is split across buffer boundary`); // trigger stitching
   }
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
 * Decode the current element's value length, and move the cursor forward
 * by either the 2 or 4 decoded bytes depending on the VR type (std/ext).
 * @param el
 * @param cursor
 * @param buffer
 */
type LeftSQ = boolean | void;
function decodeLenMoveAndCursor(el: Element, cursor: Cursor, buffer: Buffer, ctx: Ctx): LeftSQ {
   // Check if a standard VR, wich is the simple case: save len, walk cursor, return control to parse()
   if (!isExtVr(el.vr)) {
      el.length = ctx.usingLE //
         ? buffer.readUInt16LE(cursor.pos)
         : buffer.readUInt16BE(cursor.pos); // Std VR tag value lengths are represented as 2 bytes (i.e. max len 65,535)
      cursor.walk(ByteLen.UINT_16, ctx, buffer);
      return false;
   }

   // Else handle the extended VR tags
   cursor.walk(ByteLen.EXT_VR_RESERVED, ctx, buffer); // 2 reserved bytes can be ignored
   _decodeValueLength(el, buffer, cursor, ctx); // Extended VR tags' lengths are 4 bytes, may be enormous
   cursor.walk(ByteLen.UINT_32, ctx, buffer);

   if (el.vr !== VR.SQ) {
      return false;
   }

   // -- SQ-ONLY HANDLING BELOW --

   // If the SQ has a defined length but its zero, just add the emtpy SQ to the dataset
   // and return false to parse(), indicating we didn't return from SQ recursion.
   if (el.length === 0) {
      ctx.dataSet[ctx.currSqTag] = newSeqElement(ctx);
      resetSqCtx(ctx);
      return false;
   }

   // If the SQ is defined length > 0, or has an undefined length, call handleSQ to
   // init a context-aware recurse into parse(). Then sync cursors and reset context.
   if (el.vr === VR.SQ) {
      handleSQ(buffer, ctx, el, cursor); // recursive call
      cursor.walk(ctx.sequenceBytesTraversed + 8, ctx, buffer); // sync cursor with the recursive cursor. TODO work out why +8 made this work, feels like a sq delimitation tag of 4bytes tag and 4bytes length but I thought I had accounted for that already when setting sequenceBytesTraversed inside the recursion so idk :shrug:
      resetSqCtx(ctx);
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
function _decodeValueLength(el: Element, buffer: Buffer, cursor: Cursor, ctx: Ctx): void {
   el.length = ctx.usingLE //
      ? buffer.readUInt32LE(cursor.pos)
      : buffer.readUInt32BE(cursor.pos);
}

/**
 * Decode the current element's VR and walk the cursor
 * @param buffer
 * @param cursor
 * @param el
 * @throws DicomError TODO parsing errors should have their own class.
 * @returns void
 */
function decodeVRAndMoveCursor(buffer: Buffer, cursor: Cursor, el: Element, ctx: Ctx): void {
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
 * @returns void
 */
function decodeTagAndMoveCursor(buffer: Buffer, cursor: Cursor, el: Element, ctx: Ctx) {
   const start = cursor.pos;
   const end = cursor.pos + ByteLen.TAG_NUM;
   const tagBuffer = buffer.subarray(start, end);

   el.tag = decodeTagNum(tagBuffer);
   el.name = TagDictByHex[el.tag.toUpperCase()]?.["name"] ?? "Private or Unrecognised Tag";

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
   if (vr === VR.UN) {
      return `Byte parsing support for VR: ${vr} is unimplemeted in this version but attempted to decode to string as it doesn't harm the parse process`;
   } else {
      return `Byte parsing support for VR: ${vr} is unimplemeted in this version`;
   }
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
