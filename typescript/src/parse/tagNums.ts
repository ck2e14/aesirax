import { DicomError } from "../error/dicomError.js";

/**
 * Pass in a 4 byte buffer and get back the tag as a string
 * else throw a DicomError if unrecognised
 * @param buf
 * @returns
 */
export function decodeTagNum(buf: Buffer): `(${string},${string})` {
   if (buf.length !== 4) {
      throw new DicomError({
         errorType: Errors.DicomErrorType.PARSING,
         message: `decodeTag() expects a 4byte buffer`,
         buffer: buf,
      });
   }

   const groupNumber = buf
      .readUInt16LE(0) // group nums are always 2 bytes
      .toString(16) // hexes are base 16 so pass radix 16
      .padStart(4, "0"); // pad with 0s to make it 4 chars long

   const elementNumber = buf //
      .readUInt16LE(2) // we read the first 2 bytes so offset by those 2
      .toString(16)
      .padStart(4, "0");

   const isPermissibleSyntax = /^[0-9a-fA-F]{4}$/;

   if (!isPermissibleSyntax.test(groupNumber) || !isPermissibleSyntax.test(elementNumber)) {
      throw new DicomError({
         errorType: Errors.DicomErrorType.PARSING,
         message: `decodeTag() expects a valid tag, got ${groupNumber},${elementNumber}`,
         buffer: buf,
      });
   }

   return `(${groupNumber},${elementNumber})`;
}
