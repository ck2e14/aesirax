import { Parse } from "../../global.js";
import { write } from "../../logging/logQ.js";

export const decodersLE: Partial<Parse.DecoderMap> = {
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

export const decodersBE: Partial<Parse.DecoderMap> = {
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

// This probs is a bad place for this function, if you ever get round to writing it at all
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

