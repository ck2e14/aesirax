import { Ctx } from "../reading/ctx.js";
import { Cursor } from "./cursor.js";
import { Element } from './parse.js'
import { Bytes } from "../enums.js";
import { decodeTag } from "./decode.js";
import { getTagName } from "../utils.js";

/**
 * Decode the current element's tag and
 * parse the cursor forward appropriately.
 * @param buffer
 * @param cursor
 * @param el
 */
export function parseTag(buffer: Buffer, cursor: Cursor, el: Element, ctx: Ctx) {
  const start = cursor.pos;
  const end = cursor.pos + Bytes.TAG_NUM;
  const tagBuffer = buffer.subarray(start, end);

  el.tag = decodeTag(tagBuffer, ctx);
  el.name = getTagName(el.tag);

  cursor.walk(Bytes.TAG_NUM, ctx, buffer);
}
