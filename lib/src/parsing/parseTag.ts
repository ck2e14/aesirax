import { Ctx } from "../reading/ctx.js";
import { Cursor } from "./cursor.js";
import { Bytes } from "../enums.js";
import { getTagName } from "../utils.js";
import { BufferBoundary, throwBadHexPattern } from "../errors.js";
import { Parse } from "../global.js";

/**
 * Decode the current element's tag and
 * parse the cursor forward appropriately.
 * @param buffer
 * @param cursor
 * @param el
 */
export function parseTag(buffer: Buffer, cursor: Cursor, el: Parse.Element, ctx: Ctx) {
  const start = cursor.pos;
  const end = cursor.pos + Bytes.TAG_NUM;
  const tagBuffer = buffer.subarray(start, end);

  el.tag = decodeTag(tagBuffer, ctx);
  el.name = getTagName(el.tag);

  cursor.walk(Bytes.TAG_NUM, ctx, buffer);
}

/**
 * Pass in a 4 byte buffer and get back the tag as a string
 * else throw a DicomError if unrecognised. It's the caller's
 * responsibility to pass in the subarray that they determine
 * to be the 4 bytes representing the tag (via cursor walking).
 * @param buf
 * @returns string
 */
export function decodeTag(buf: Buffer, ctx: Ctx): Parse.TagStr {
  if (buf.length !== 4) {
    throw new BufferBoundary(`decodeTag() expected 4 bytes, got ${buf.length}`);
  }

  const decode = (offset: number): string => {
    return ctx.usingLE
      ? buf.readUInt16LE(offset).toString(16).padStart(4, "0")
      : buf.readUInt16BE(offset).toString(16).padStart(4, "0"); // hexes are base 16 so pass radix 16. pad with 0s to make it 4 chars long if not already.
  };

  const isHexStr = (str: string): boolean => /^[0-9a-fA-F]{4}$/.test(str); // DICOM tags are always 4 hex chars
  const [grp, el] = [0, 2].map(decode); // group starts at byte offset 0, element at byte offset 2

  if (!isHexStr(grp) || !isHexStr(el)) {
    return throwBadHexPattern(buf, `(${grp},${el})`);
  }

  return `(${grp},${el})` as Parse.TagStr;
}


