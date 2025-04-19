import { Bytes } from "../enums.js";
import { Cursor } from "./cursor.js";
import { Ctx } from "../reading/ctx.js";
import { decodeVrBytes } from "./decode.js";
import { Parse } from "../global.js";

/**
 * Decode the current element's VR and walk the cursor
 * @param buffer
 * @param cursor
 * @param el
 * @throws DicomError
 */
export function parseVR(buffer: Buffer, cursor: Cursor, el: Parse.Element, ctx: Ctx) {
  const start = cursor.pos;
  const end = cursor.pos + Bytes.VR;
  const vrBuffer = buffer.subarray(start, end);

  el.vr = decodeVrBytes(vrBuffer);
  cursor.walk(Bytes.VR, ctx, buffer);
}

