import { Bytes, DicomErrorType, VR } from "../../enums.js";
import { Cursor } from "../cursor.js";
import { Parse } from "../../global.js";
import { Ctx } from "../ctx.js";
import { BufferBoundary, DicomError } from "../../errors.js";
import { isVr } from "../../utils.js";

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


/**
 * Pass in a 2 byte buffer and get back the VR as a string
 * else throw a DicomError if unrecognised.
 * @param buf
 * @returns Global.VR
 * @throws DicomError
 */
export function decodeVrBytes(buf: Buffer): VR {
  if (buf.length !== Bytes.VR) {
    throw new BufferBoundary(`decodeVrBytes() expected 2 bytes, got ${buf.length}`);
  }

  const decodedVr = buf.toString("ascii", 0, Bytes.VR);
  if (!isVr(decodedVr)) {
    throwUnrecognisedVr(decodedVr, buf);
  }

  return decodedVr as VR
}

/**
 * Throw an error if an unrecognised VR is encountered.
 * @param vr
 * @param vrBuf
 * @throws DicomError
 */
export function throwUnrecognisedVr(vr: string, vrBuffer: Buffer): never {
  throw new DicomError({
    errorType: DicomErrorType.PARSING,
    message: `Unrecognised VR: ${vr}`,
    buffer: vrBuffer,
  });
}
