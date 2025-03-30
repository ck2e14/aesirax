import { Bytes, DicomErrorType, TagDictByHex, TransferSyntaxUid, VR } from "../enums.js";
import { BufferBoundary, DicomError } from "../error/errors.js";
import { isExtVr, isVr } from "../utils.js";
import { Cursor } from "./cursor.js";
import { write } from "../logging/logQ.js";
import { Element } from "./parse.js";
import { Ctx } from "../reading/ctx.js";

export type Decoder = (value: Buffer) => string;
export type DecoderMap = Record<Global.VR | "default", Decoder>;
export type TagStr = keyof typeof TagDictByHex; // 'keyof' gets the keys of an object type. So this is the union type of all the keys of TagDictByHex
type _ParityCheck = Global.KeysParity<typeof decodersLE, typeof decodersBE>
//                                              ^?

const decodersLE: Partial<DecoderMap> = {
  // partial because will add VRs incrementally.
  // currently only support numbers to base 10.
  AE: (subarray: Buffer) => utf8Decoder(subarray),
  AS: (subarray: Buffer) => utf8Decoder(subarray),
  CS: (subarray: Buffer) => utf8Decoder(subarray),
  DA: (subarray: Buffer) => utf8Decoder(subarray),
  DS: (subarray: Buffer) => utf8Decoder(subarray),
  DT: (subarray: Buffer) => utf8Decoder(subarray),
  IS: (subarray: Buffer) => utf8Decoder(subarray),
  LO: (subarray: Buffer) => utf8Decoder(subarray),
  LT: (subarray: Buffer) => utf8Decoder(subarray),
  PN: (subarray: Buffer) => utf8Decoder(subarray),
  SH: (subarray: Buffer) => utf8Decoder(subarray),
  ST: (subarray: Buffer) => utf8Decoder(subarray),
  TM: (subarray: Buffer) => utf8Decoder(subarray),
  UC: (subarray: Buffer) => utf8Decoder(subarray),
  UI: (subarray: Buffer) => utf8Decoder(subarray),
  UR: (subarray: Buffer) => utf8Decoder(subarray),
  UT: (subarray: Buffer) => utf8Decoder(subarray),
  FL: (subarray: Buffer) => subarray.readFloatLE(0).toString(10),
  FD: (subarray: Buffer) => subarray.readDoubleLE(0).toString(10),
  SL: (subarray: Buffer) => subarray.readInt32LE(0).toString(10),
  AT: (subarray: Buffer) => subarray.readInt32LE(0).toString(10), // WARN check this is correct
  SS: (subarray: Buffer) => subarray.readInt16LE(0).toString(10),
  UL: (subarray: Buffer) => BigInt(subarray.readUInt32LE(0)).toString(),
  US: (subarray: Buffer) => subarray.readUInt16LE(0).toString(10),
  default: (subarray: Buffer) => subarray.toString("hex"),
} as const;

const decodersBE: Partial<DecoderMap> = {
  // partial because will add VRs incrementally
  // currently only support numbers to base 10.
  AE: (subarray: Buffer) => utf8Decoder(subarray),
  AS: (subarray: Buffer) => utf8Decoder(subarray),
  CS: (subarray: Buffer) => utf8Decoder(subarray),
  DA: (subarray: Buffer) => utf8Decoder(subarray),
  DS: (subarray: Buffer) => utf8Decoder(subarray),
  DT: (subarray: Buffer) => utf8Decoder(subarray),
  IS: (subarray: Buffer) => utf8Decoder(subarray),
  LO: (subarray: Buffer) => utf8Decoder(subarray),
  LT: (subarray: Buffer) => utf8Decoder(subarray),
  PN: (subarray: Buffer) => utf8Decoder(subarray),
  SH: (subarray: Buffer) => utf8Decoder(subarray),
  ST: (subarray: Buffer) => utf8Decoder(subarray),
  TM: (subarray: Buffer) => utf8Decoder(subarray),
  UC: (subarray: Buffer) => utf8Decoder(subarray),
  UI: (subarray: Buffer) => utf8Decoder(subarray),
  UR: (subarray: Buffer) => utf8Decoder(subarray),
  UT: (subarray: Buffer) => utf8Decoder(subarray),
  FL: (subarray: Buffer) => subarray.readFloatBE(0).toString(10),
  FD: (subarray: Buffer) => subarray.readDoubleBE(0).toString(10),
  SL: (subarray: Buffer) => subarray.readInt32BE(0).toString(10),
  SS: (subarray: Buffer) => subarray.readInt16BE(0).toString(10),
  UL: (subarray: Buffer) => BigInt(subarray.readUInt32BE(0)).toString(),
  US: (subarray: Buffer) => subarray.readUInt16BE(0).toString(10),
  default: (subarray: Buffer) => subarray.toString("hex"),
} as const;

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

/**
 * Pass in a 2 byte buffer and get back the VR as a string
 * else throw a DicomError if unrecognised.
 * @param buf
 * @returns Global.VR
 * @throws DicomError
 */
export function decodeVrBytes(buf: Buffer): Global.VR {
  if (buf.length !== Bytes.VR) {
    throw new BufferBoundary(`decodeVrBytes() expected 2 bytes, got ${buf.length}`);
  }
  const decodedVr = buf.toString("ascii", 0, Bytes.VR);
  if (!isVr(decodedVr)) {
    throwUnrecognisedVr(decodedVr, buf);
  }
  return decodedVr;
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

/**
 * Decode a buffer to UTF-8 string and remove any null byte padding
 * @param value
 * @returns string
 */
export function utf8Decoder(value: Buffer): string {
  return value //
    .toString("utf8")
    .replace(/\0+$/, "");
}

/**
 * Count the number of null bytes at the end of a buffer.
 * This is common in DICOM files where the actual value
 * is less than the fixed byte length required by the VR.
 * This is how we support variable length values, and when
 * handling the values we should trim these null bytes out.
 * @param value
 * @returns void
 * @throws DicomError
 */
export function countNullBytes(value: Buffer): void {
  try {
    const str = value.toString("utf8");
    const nullBytesFromString = str.match(/\0+$/g)?.length;

    if (nullBytesFromString) {
      write(`Counted ${nullBytesFromString} null bytes from value: ${str}`, "DEBUG");
    } else {
      write(`There is no null byte padding on value: ${str}`, "DEBUG");
    }
  } catch (error) {
    write(`Error counting null bytes from value: ${value}`, "ERROR");
  }
}

function detectRepeatsForRepeatableElements(el: Element, buffer: Buffer) {
  // TODO fucking need some hench exhaustive list of all elements that permit repeats. This isn't
  // done by VR and is going to be a pain the neck to compile robustly, and it does matter because
  // elements that don't permit VRs can legitimately include backslashes as content, cus they aren't
  // reserved chars in that context. So I'm gonna say fuck it for now. This does unfortunately mean that
  // for literally anything that isn't a VR deocded into a utf8 string, we're going to only get the
  // first of the repeats, e.g. floats, but that's just how it is for now.
  // this function should basically take in the element object and the buffer containing the value
  // it should check to see whether its in a list of permissible repeated tags.
  // if so, read as a string, regardless of VR. Then seek backslashes.
  // if backslashes===1 then decode according to the VR, otherwise lets leave it as a string, even if
  // its floats, and add a element.devNote to explain the design decision. Users can split and typecast if they need to.
  //
}

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
export function parseLength(buffer: Buffer, cursor: Cursor, el: Element, ctx: Ctx) {
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
export function decodeLength(el: Element, buffer: Buffer, cursor: Cursor, ctx: Ctx) {
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

/**
 * Pass in a 4 byte buffer and get back the tag as a string
 * else throw a DicomError if unrecognised. It's the caller's
 * responsibility to pass in the subarray that they determine
 * to be the 4 bytes representing the tag (via cursor walking).
 * @param buf
 * @returns string
 */
export function decodeTag(buf: Buffer, ctx: Ctx): TagStr {
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

  return `(${grp},${el})` as TagStr;
}

/**
 * Throw an error if the buffer did not decode to a 4 hex character string.
 * @param buf
 * @throws DicomError
 */
function throwBadHexPattern(buf: Buffer, str: string): never {
  throw new DicomError({
    errorType: DicomErrorType.PARSING,
    message: `decodeTag() decoded to an unexpected hexPattern: ${str}`,
    buffer: buf,
  });
}
