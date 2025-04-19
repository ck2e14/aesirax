import { Cursor } from "../cursor.js";
import { BufferBoundary } from "../../errors.js";
import { Parse } from "../../global.js";
import { Ctx } from "../ctx.js";
import { valueIsTruncated } from "../validation.js";
import { countNullBytes, decodersBE, decodersLE } from "./decoders.js";
import { TransferSyntaxUid, VR } from "../../enums.js";

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

/**
 * Pass in a DICOM tag's VR and a buffer containing the bytes
 * representing the tag's value and get back an appropriately
 * decoded string. Nums will be coerced to strings, using base10
 * @param vr
 * @param value
 * @returns string
 */
export function decodeValueBytes(
  vr: string,
  value: Buffer,
  ctx: Ctx,
  checkNullPadding = false // for debugging
): string {

  if (checkNullPadding) {
    countNullBytes(value);
  }

  const decoders = ctx.transferSyntaxUid === TransferSyntaxUid.ExplicitVRLittleEndian
    ? decodersLE
    : decodersBE;

  try {
    if (decoders.hasOwnProperty(vr)) {
      return decoders[vr](value);
    }

    if (vr === VR.OB || vr === VR.OW || vr === VR.OF) {
      return `Binary data (${vr}): ${value.length} bytes`;
    }

    if (value.length > 1024) {
      return "Assumed to be binary data, not supported for decoding/display";
    }

    return value.toString();
  } catch (error) {
    return decoders.default(value);
  }
}


