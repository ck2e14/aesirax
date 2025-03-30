import { Bytes } from "../../enums.js";
import { BufferBoundary, Malformed } from "../../error/errors.js";
import { write } from "../../logging/logQ.js";
import { Ctx } from "../../reading/ctx.js";
import { cPos, logElement } from "../../utils.js";
import { Cursor } from "../cursor.js";
import { decodeTag } from "../decode.js";
import { saveElement, Element } from "../parse.js";
import { EOI_TAG, FRAG_START_TAG, ITEM_START_TAG, MAX_UINT32, SQ_END_TAG } from "../parse.js";
import { valueIsTruncated } from "../validation.js";
import { parseValueDefault } from "./parseDefault.js";

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
    parseValueDefault(buffer, cursor, el, ctx);
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
    ? buffer.subarray(cursor.pos, cursor.pos + Bytes.TAG_NUM).readUint32LE(0)
    : buffer.subarray(cursor.pos, cursor.pos + Bytes.TAG_NUM).readUint32BE(0);

  // -- If nonzero, walk the entire table, not supporting this atm
  if (offSetTableLen > 0) {
    cursor.walk(offSetTableLen, ctx, buffer);
    const offset = ctx.usingLE
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
    ? buffer.subarray(cursor.pos, cursor.pos + Bytes.TAG_NUM).readUint32LE(0)
    : buffer.subarray(cursor.pos, cursor.pos + Bytes.TAG_NUM).readUint32BE(0);

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

