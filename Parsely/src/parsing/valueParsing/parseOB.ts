import { isNonSQ, isSQ, saveElement } from "../parse.js";
import { ITEM_START_TAG, SQ_END_TAG } from "../constants.js";
import { valueIsTruncated } from "../validation.js";
import { Ctx } from "../../reading/ctx.js";
import { Cursor } from "../cursor.js";
import { Bytes, DicomErrorType } from "../../enums.js";
import { BufferBoundary, DicomError, Malformed } from "../../errors.js";
import { decodeTag } from "../parseTag.js";
import { Parse } from "../../global.js";

/**
 * Handle the OB ('Other Byte') Pixel Data VR.
 * Checks for offset table but ignores it if exists, maybe
 * will support in future. It will save fragments individually,
 * optionally skipping the pixel data.
 * WARN does this properly handle non-fragment pixel data?? TODO
 * @param ctx
 * @param el
 * @param cursor
 * @param buffer
 */
export function parseUndefLenOB(ctx: Ctx, el: Parse.ElementInProgress, cursor: Cursor, buffer: Buffer) {
  if (!('length' in el)) {
    throw new DicomError({
      message: `parseUndefLenOB expects elements to have a length value by now.`,
      errorType: DicomErrorType.PARSING
    })
  }

  const itemTagBytes = buffer.subarray(cursor.pos, cursor.pos + Bytes.TAG_NUM);
  const itemTag = decodeTag(itemTagBytes, ctx);
  console.log({itemTag})
  if (itemTag !== ITEM_START_TAG) {
    throw new Malformed(`Expected an item start tag in undefined len ${el.tag} but got ${itemTag}`);
  } else {
    cursor.walk(Bytes.TAG_NUM, ctx, buffer);
  }

  // -- Seek offset table. If it exists, walk past it & ignore.
  const offsetLenBytes = buffer.subarray(cursor.pos, cursor.pos + Bytes.LENGTH);
  const offsetLen = ctx.usingLE
    ? offsetLenBytes.readUint32LE(0)
    : offsetLenBytes.readUint32BE(0);

  cursor.walk(Bytes.LENGTH, ctx, buffer);
  cursor.walk(offsetLen, ctx, buffer);

  el.length = 24 + offsetLen; // I.e. all the fixed length bytes that we walked and then whatever was the size of the offset as well.
  el.fragments = {}

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
      ? buffer.subarray(cursor.pos, cursor.pos + Bytes.LENGTH).readUInt32LE(0)
      : buffer.subarray(cursor.pos, cursor.pos + Bytes.LENGTH).readUInt32BE(0);

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
