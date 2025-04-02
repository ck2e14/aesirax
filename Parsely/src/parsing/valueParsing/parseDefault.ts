import { Cursor } from "../cursor.js";
import { decodeValueBytes } from "../decode.js";
import { valueIsTruncated } from "../validation.js";
import { Ctx } from "../../reading/ctx.js";
import { BufferBoundary, DicomError } from "../../errors.js";
import { Parse } from "../../global.js";
import { DicomErrorType, VR } from "../../enums.js";
import { saveElement } from "../parse.js";

/**
 * Handle parsing the current element's value by 
 * decoding and moving the cursor forwards.
 * @param buffer
 * @param cursor
 * @param el
 * @param Ctx
 */
export function parseValueDefault(buffer: Buffer, cursor: Cursor, el: Parse.ElementInProgress, ctx: Ctx) {
  if (el.length == null || !('value' in el)) {
    throw new DicomError({
      message: `parseOW requires an element length, and according to TLV sequence, should have been determined already`,
      errorType: DicomErrorType.PARSING
    })
  }

  if (valueIsTruncated(buffer, cursor, el.length)) {
    throw new BufferBoundary(`Tag ${el.tag} is split across buffer boundary`);
  }

  const start = cursor.pos;
  const end = cursor.pos + el.length;
  const valueBuffer = buffer.subarray(start, end);

  el.value = decodeValueBytes(el.vr as VR, valueBuffer, ctx); // safe type assertion
  cursor.walk(el.length, ctx, buffer); // to get to the start of the next tag 
  console.log('0000000000000000', el, { pos: cursor.pos })
}


