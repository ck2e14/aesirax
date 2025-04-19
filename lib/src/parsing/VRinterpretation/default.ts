import { Cursor } from "../cursor.js";
import { decodeValueBytes } from "../decode.js";
import { BufferBoundary } from "../../errors.js";
import { Parse } from "../../global.js";
import { Ctx } from "../ctx.js";
import { valueIsTruncated } from "../validate.js";

/**
 * Handle parsing the current element's value by 
 * decoding and moving the cursor forwards.
 * @param buffer
 * @param cursor
 * @param el
 * @param Ctx
 */
export function parseValueDefault(buffer: Buffer, cursor: Cursor, el: Parse.Element, ctx: Ctx) {
  if (valueIsTruncated(buffer, cursor, el.length)) {
    throw new BufferBoundary(`Tag ${el.tag} is split across buffer boundary`);
  }

  const start = cursor.pos;
  const end = cursor.pos + el.length;
  const valueBuffer = buffer.subarray(start, end);

  el.value = decodeValueBytes(el.vr, valueBuffer, ctx);
  cursor.walk(el.length, ctx, buffer); // to get to the start of the next tag
}


