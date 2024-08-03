import { DicomError } from "../error/dicomError.js";
import { DicomErrorType } from "../globalEnums.js";

/**
 * Pass in a 4 byte buffer and get back the tag as a string
 * else throw a DicomError if unrecognised. It's the caller's
 * responsibility to pass in the subarray that they determine
 * to be the 4 bytes representing the tag (via cursor walking).
 * @param buf
 * @returns string `(${string},${string})`
 */
export function decodeTagNum(buf: Buffer): `(${string},${string})` {
   if (buf.length !== 4) {
      throw new DicomError({
         errorType: DicomErrorType.PARSING,
         message: `decodeTagNum() expects a 4byte buffer`,
         buffer: buf,
      });
   }

   const decode = (cursor: number): string =>
      buf
         .readUInt16LE(cursor) // group nums are always 2 bytes
         .toString(16) // hexes are base 16 so pass radix 16
         .padStart(4, "0"); // pad with 0s to make it 4 chars long

   const grp = decode(0);
   const el = decode(2);
   const syntax = /^[0-9a-fA-F]{4}$/;

   if (!syntax.test(grp) || !syntax.test(el)) {
      throw new DicomError({
         errorType: DicomErrorType.PARSING,
         message: `decodeTag() decoded to an unexpected syntax:(${grp},${el})`,
         buffer: buf,
      });
   }

   return `(${grp},${el})`;
}
