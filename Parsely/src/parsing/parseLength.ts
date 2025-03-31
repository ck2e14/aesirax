import { Bytes } from "../enums.js";
import { Parse } from "../global.js";
import { Ctx } from "../reading/ctx.js";
import { isExtVr } from "../utils.js";
import { Cursor } from "./cursor.js";

/**
 * Decode the current element's value length, and move the cursor forward
 * by either the 2 or 4 decoded bytes depending on the VR type (std/ext).
 * It's used in the parse() function to decode the length of the current
 * but also to determine control flow (continue or not). This may be
 * refactored for better SRP.
 * @param el
 * @param cursor
 * @param buffer
 * @returns Continue
 */
export function parseLength(buffer: Buffer, cursor: Cursor, el: Parse.Element, ctx: Ctx) {
  // ----  Standard VR ----
  if (!isExtVr(el.vr)) {
    decodeLength(el, buffer, cursor, ctx);
    cursor.walk(Bytes.UINT_16, ctx, buffer);
    return false;
  }

  // ----- Extended VR ------
  cursor.walk(Bytes.EXT_VR_RESERVED, ctx, buffer); // 2 unused bytes on all ext VRs - can ignore
  decodeLength(el, buffer, cursor, ctx); // lens < 4 bytes, (4,294,967,295)
  cursor.walk(Bytes.UINT_32, ctx, buffer);
}

/**
 * Helper function; decode the current element's value.
 * @param el
 * @param buffer
 * @param cursor
 * @param ctx
 */
export function decodeLength(el: Parse.Element, buffer: Buffer, cursor: Cursor, ctx: Ctx) {
  if (isExtVr(el.vr)) {
    el.length = ctx.usingLE
      ? buffer.readUInt32LE(cursor.pos)
      : buffer.readUInt32BE(cursor.pos); // len < 4 bytes, (4,294,967,295)
  } else {
    el.length = ctx.usingLE
      ? buffer.readUInt16LE(cursor.pos)
      : buffer.readUInt16BE(cursor.pos); // len < 2 bytes, (65,535)
  }
}
