import { printSqCtx } from "../../utils.js";
import { parse, exitParse } from "../parse.js";
import { Cursor } from "../cursor.js";
import { write } from "../../logging/logQ.js";
import { Bytes, DicomErrorType, VR } from "../../enums.js";
import { BufferBoundary, DicomError, Malformed } from "../../errors.js";
import { ITEM_END_TAG, ITEM_START_TAG, MAX_UINT32, SQ_END_TAG } from "../constants.js";
import { Parse } from "../../global.js";
import { Ctx } from "../ctx.js";
import { decodeTag } from "../TLV/tag.js";
import { saveElement } from "../element.js";

/**
 * Manage parsing of an encountered sequence element. Does so by 
 * recursively entering parse() from the first item (dataset). 
 * Control flow inside parse() continues to walk, using a new child 
 * cursor, until base case(s) are met (truncation or sequence end). 
 * Then sync cursors and return control to the parse() frame that
 * detected the outermost SQ.
 *
 * TODO check whether depth == cq stack .length, if not throw.
 *
 * @param seqBuffer
 * @param ctx
 * @param seqTag
 */
export async function parseSQ(
  buffer: Buffer,
  ctx: Ctx,
  el: Parse.Element,
  parentCursor: Cursor
) {
  logEntryToSQ(ctx, el, parentCursor);

  // -- Convert & save SQ, and prepare to write all subsequent elements 
  //    to this nested dataset in the serialisation until the SQ's end.
  el = convertElToSq(el);
  saveElement(ctx, el, parentCursor, buffer, false);

  // -- 0-Length, Defined length SQs: handle no-op (ctx reversal)
  if (isEmptyDefLenSQ(el)) {
    el.items.pop(); // init'd with an empty dataset obj, so remove it
    return; // detect and return before walking to avoid need to retreat
  }

  // -- Decode first tag (should be item start tag if !empty)
  const tagBuffer = buffer.subarray(parentCursor.pos, parentCursor.pos + Bytes.TAG_NUM);
  const tag = decodeTag(tagBuffer, ctx);

  parentCursor.walk(Bytes.TAG_NUM, ctx, buffer); // walk past tag bytes
  parentCursor.walk(Bytes.VR + Bytes.EXT_VR_RESERVED, ctx, buffer); // walk past VR bytes -  item tags have no VR

  // -- 0-Length, undefined length SQs: handle no-op. Empty undef vs empty def len SQs 
  //    are detected at different byte positions hence their separation by cursor walks.
  if (isEmptyUndefinedLengthSQ(el, tag)) {
    write(`Saving undefined length empty SQ ${el.tag} ${el.name}.`, "DEBUG");
    el.length = 0;
    el.items.pop();
    return;
  }

  // -- Stack SQ properties to maintain recursion-independent context
  trackSQ(ctx, el);

  // -- Recurse to parse entire SQ, from the first item, which itself is a dataset.
  //    All new datasets always require a new call to parse().
  const firstItem = buffer.subarray(parentCursor.pos, buffer.length);
  const partial = await parse(firstItem, ctx); // parse returns 0 length buffer if no elem was truncated

  // -- Add traversed bytes & LIFO pop
  parentCursor.sync(ctx, buffer);
  removeSqFromStack(ctx);
  write(`Current stacks: ${printSqCtx(ctx)}, Depth: ${ctx.depth}`, "DEBUG");

  // -- Trigger stitching
  // FIXME: this is control flow not an exception really so maybe change to command pattern
  if (partial?.length > 0) {
    throw new BufferBoundary(`SQ ${stacks(ctx)?.sq?.name} is split across buffer boundary`);
  }
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
 * @returns Parse.TagStr
 */
function nextUndefLenSqTag(ctx: Ctx, cursor: Cursor, buffer: Buffer): Parse.TagStr {
  write(`Handling end of a dataSet item in SQ ${stacks(ctx).sq.tag} ${stacks(ctx).sq.name}`, "DEBUG");
  cursor.walk(Bytes.LENGTH, ctx, buffer); // ignore this length, its always 0x0 for item delims

  const nextTagBytes = buffer.subarray(cursor.pos, cursor.pos + Bytes.TAG_NUM);
  const nextTag = decodeTag(nextTagBytes, ctx);

  cursor.walk(Bytes.TAG_NUM, ctx, buffer);
  cursor.walk(Bytes.LENGTH, ctx, buffer); // ignore SQ_END_TAG's length bytes (always 0x0)

  return nextTag;
}

/** 
 * Called in the parse loop right after the tag number 
 * has been read; which can change states and inform 
 * decisions particularly within sequences. 
 *
 * Each iteration of the loop represents the start 
 * of a new DICOM Parse.Element parse (the cursor rests on the 
 * start byte of the TLV element). 
 *
 * Some special detections have to take place specifically 
 * right after the tag is parsed and the current element is 
 * known. That's because some 'special' elements play 
 * indicator roles and have atypical TLV structure. In 
 * these special cases, a new parse loop is required because
 * the next encoding is a new element, or a recursive 
 * frame needs to be returned from (end of a nested SQ) etc.
 */
type ParseLoopFlowCommand = 'exit-recursion' | 'next-element' | void

export function manageSqRecursion(
  buffer: Buffer,
  cursor: Cursor,
  el: Parse.Element,
  ctx: Ctx,
): ParseLoopFlowCommand {
  const sq = stacks(ctx).sq

  if (isDefLenItemStartTag(el)) {
    sq.items.push({});
    cursor.walk(Bytes.LENGTH, ctx, buffer);
    return 'next-element'
  }

  if (isUndefLenItemEndTag(ctx, el)) {
    const next = nextUndefLenSqTag(ctx, cursor, buffer);

    if (next === ITEM_START_TAG) {
      write(`Start of new item in SQ ${sq.tag} ${sq.name}`, "DEBUG");
      console.log('yes')
      sq.items.push({});
      return 'next-element'
    }

    if (next === SQ_END_TAG) {
      write(`End of SQ ${sq.tag} ${sq.name}`, "DEBUG");
      stacks(ctx).sq.length = stacks(ctx).bytes;
      exitParse(ctx, cursor);
      return 'exit-recursion'; // undef length sequences' completion basecase
    }

    throw new Malformed(`Got ${next}, expected ${ITEM_END_TAG}/${SQ_END_TAG}`);
  }
}

/**
 * Primarily this fn determines if the current tag represents having walked all 
 * the bytes to have arrived at the end of a defined length sequence element, 
 * which doesn't have a distinct delimiting element, it just relies on checking 
 * the number of tarversed bytes since encountering the first relevant byte of 
 * the sequence against the length that the SQ instructed us to expect.
 *
 * This is the recursive base case detection for use within parse().
 *
 * !! GOTCHA: Note that this has to be the first action in each parse loop because 
 * this type of SQ doesn't have a delimiter tag to indicate the end of the sequence.
 * It relies on tracking the number of walked bytes and comparing against the
 * stated Uint32 length from the beginning of the sequence. This can only
 * be reached after each loop iteration because each loop represents the total TLV 
 * parsing of a single distinct element (including recursion), i.e. after the 
 * decoding of the last sq element's value.
 *
 * ***It needs to go first***
 * Because the recursive end of a child sq's last element value can also represent 
 * the end of 1 or more parent sqs. For which all of those are a recursive depth, 
 * to be returned from. Which is why this fn returns a bool that we use for parse() 
 * loop flow control, to exit all terminated parents without anything else occuring. 
 * Without this, new elements will be serialised as existing within sequences that 
 * actually have terminated. 
 *
 * So if we return from parseSQ() recursion and hit the 'continue' to begin the next 
 * while iteration, the next action needs to be this detection. That way we can handle 
 * the termination of n sequences where the last element value was nested more than 
 * once.
 *
 * In other words; the specific 'first action' placement of this check handles instances 
 * where the end of one SQ's last element's value represents the end of 1 or more parent 
 * SQ's last element value, as well as instances where an SQ is not terminated by the 
 * termination of one of its children SQs. 
 *
 * This caused a mindbending bug before it was placed as the first action(!)
 *
 * @param ctx
 * @param cursor 
 */
export function exitDefLenSqRecursion(ctx: Ctx, cursor: Cursor): boolean {
  if (!inSQ(ctx)) {
    return false;
  }

  const { sq, len, bytes } = stacks(ctx);
  const isEnd = sq
    && len !== MAX_UINT32
    && len === bytes + 8; // +8 because we walked 8 bytes (parentCursor.walk() - parseSQ()) before pushing sq to stack

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

  if (!isEnd) {
    return false
  }

  if (bytes > sq.length) {
    throw new Malformed(
      `Traversed more bytes than the defined length of the SQ. ` +
      `This is a bug or malformed DICOM. ` +
      `SQ: ${sq} - ` +
      `Expected SQ length: ${sq}` +
      `Traversed: ${bytes} - `
    );
  }

  write(`Reached the end of a defined length SQ: ${sq.name}.`, "DEBUG");
  exitParse(ctx, cursor)
  return true
}


/**
 * Detect the start of a new defined length SQ's item.
 * @param ctx
 * @param el
 * @returns
 */
export function isDefLenItemStartTag(el: Parse.Element) {
  return el.length < MAX_UINT32 && el.tag === ITEM_START_TAG;
}

/**
 * Detect the end of an undefined length SQ's item.
 * @param ctx
 * @param el
 * @returns
 */
export function isUndefLenItemEndTag(ctx: Ctx, el: Parse.Element) {
  write(`End of undefined length sequence item ${el.tag} ${el.name}`, "DEBUG");
  return inSQ(ctx) && el.tag === ITEM_END_TAG;
}

/**
 * QoL helper to help guide control flow inside 
 * parsing logic - particularly in the parse() 
 * while loop.
 */
export function inSQ(ctx: Ctx): boolean {
  return stacks(ctx).len > 0;
}

/**
 * LIFO-stack getters (sequence element recursion contexts)
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
function convertElToSq(el: Parse.Element): Parse.Element {
  const newSq = { ...el, items: [{}] };
  delete newSq.value;
  return newSq;
}

/**
 * QoL helper to guide control flow in parse()'s while loop.
 */
function isEmptyDefLenSQ(el: Parse.Element) {
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
function isEmptyUndefinedLengthSQ(el: Parse.Element, tag: Parse.TagStr) {
  return (
    el.vr === VR.SQ && //
    el.length === MAX_UINT32 &&
    tag === SQ_END_TAG
  );
}

/**
 * Push onto the three context stacks required to maintain
 * awareness, across functions and recursive frames, of the
 * state of sequence traversal.
 * @param ctx
 * @param el
 * @param newSq
 */
function trackSQ(ctx: Ctx, el: Parse.Element) {
  ctx.sqLens.push(el.length);
  ctx.sqStack.push(el);
  ctx.sqBytesStack.push(0);
}

function logEntryToSQ(ctx: Ctx, el: Parse.Element, parentCursor: Cursor) {
  const printLen = el.length === MAX_UINT32 ? "undef len" : el.length;
  if (inSQ(ctx)) {
    write(`Parsing nested SQ ${el.tag}, ${el.name}, len: ${printLen}, parentCursor: ${parentCursor.pos}`, "DEBUG");
  } else {
    write(`Parsing SQ ${el.tag}, ${el.name}, len: ${printLen}, parentCursor: ${parentCursor.pos}`, "DEBUG");
  }
}

