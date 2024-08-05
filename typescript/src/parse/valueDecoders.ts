import { DicomError } from "../error/dicomError.js";
import { ByteLen, DicomErrorType, VR } from "../globalEnums.js";
import { write } from "../logging/logQ.js";

type Decoder = (value: Buffer) => string;
type DecoderMap = Record<Global.VR | "default", Decoder>;

const decoders: Partial<DecoderMap> = {
   // partial because will add VRs incrementally
   // currently only support numbers to base 10.
   AE: (val: Buffer) => utf8Decoder(val),
   AS: (val: Buffer) => utf8Decoder(val),
   CS: (val: Buffer) => utf8Decoder(val),
   DA: (val: Buffer) => utf8Decoder(val),
   DS: (val: Buffer) => utf8Decoder(val),
   DT: (val: Buffer) => utf8Decoder(val),
   IS: (val: Buffer) => utf8Decoder(val),
   LO: (val: Buffer) => utf8Decoder(val),
   LT: (val: Buffer) => utf8Decoder(val),
   PN: (val: Buffer) => utf8Decoder(val),
   SH: (val: Buffer) => utf8Decoder(val),
   ST: (val: Buffer) => utf8Decoder(val),
   TM: (val: Buffer) => utf8Decoder(val),
   UC: (val: Buffer) => utf8Decoder(val),
   UI: (val: Buffer) => utf8Decoder(val),
   UR: (val: Buffer) => utf8Decoder(val),
   UT: (val: Buffer) => utf8Decoder(val),
   FL: (val: Buffer) => val.readFloatLE(0).toString(10),
   FD: (val: Buffer) => val.readDoubleLE(0).toString(10),
   SL: (val: Buffer) => val.readInt32LE(0).toString(10),
   SS: (val: Buffer) => val.readInt16LE(0).toString(10),
   UL: (val: Buffer) => val.readUInt32LE(0).toString(10),
   US: (val: Buffer) => val.readUInt16LE(0).toString(10),
   default: (val: Buffer) => val.toString("hex"),
} as const;

/**
 * Pass in a DICOM tag's VR and a buffer containing the bytes
 * representing the tag's value and get back an appropriately
 * decoded string. Nums will be coerced to strings, using base10
 * @param vr
 * @param value
 * @returns string
 */
export function decodeValue(vr: string, value: Buffer, checkNullPadding = false): string {
   if (checkNullPadding) {
      try {
         countNullBytes(value);
      } catch (error) {
         // swallow here because already logged in
         // countNullBytes and don't want to rethrow
      }
   }

   if (decoders.hasOwnProperty(vr)) {
      return decoders[vr](value);
   } else {
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
export function decodeVr(buf: Buffer): Global.VR {
   if (buf.length !== ByteLen.VR) {
      return throwBadVrByteLength(buf);
   }

   const decodedVr = buf.toString("ascii", 0, ByteLen.VR);
   const isRecognisedVr = Object.values(VR).includes(decodedVr as VR);

   if (isRecognisedVr) {
      return decodedVr as VR;
   }

   return throwUnrecognisedVr(decodedVr, buf);
}

/**
 * Throw an error if an unrecognised VR is encountered.
 * @param vr
 * @param vrBuf
 * @throws DicomError
 */
function throwUnrecognisedVr(vr: string, vrBuf: Buffer): never {
   throw new DicomError({
      errorType: DicomErrorType.PARSING,
      message: `Unrecognised VR: ${vr}`,
      buffer: vrBuf,
   });
}

/**
 * Throw an error if the buffer length is not 2 bytes.
 * @param buf
 */
function throwBadVrByteLength(buf: Buffer): never {
   throw new DicomError({
      errorType: DicomErrorType.PARSING,
      message: `decodeVr() expects a 2byte buffer`,
      buffer: buf,
   });
}

/**
 * Decode a buffer to UTF-8 string and remove any null byte padding
 * @param value
 * @returns string
 */
function utf8Decoder(value: Buffer): string {
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
      throw DicomError.from(error);
   }
}
