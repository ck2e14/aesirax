import { Fragments, ITEM_START_TAG, saveElement, Element, SQ_END_TAG } from "../parse.js";
import { BufferBoundary, Malformed } from "../../error/errors.js";
import { valueIsTruncated } from "../validation.js";
import { Ctx } from "../../reading/ctx.js";
import { Cursor } from "../cursor.js";
import { Bytes } from "../../enums.js";
import { decodeTag } from "../decode.js";

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
  const offsetLen = ctx.usingLE
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
