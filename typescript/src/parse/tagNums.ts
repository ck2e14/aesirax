import { DicomError } from "../error/dicomError.js";

export function decodeTagNum(buf: Buffer): `(${string},${string})` {
   if (buf.length !== 4) {
      throw new DicomError({
         errorType: Errors.DicomErrorType.PARSING,
         message: `decodeTag() expects a 4byte buffer`,
         buffer: buf,
      });
   }

   const groupNumber = buf //
      .readUInt16LE(0) // group nums are always 2 bytes
      .toString(16) // convert to hex representation (base 16)
      .padStart(4, "0"); // pad with 0s to make it 4 chars long

   const elementNumber = buf //
      .readUInt16LE(2)
      .toString(16)
      .padStart(4, "0");

   return `(${groupNumber},${elementNumber})`;
}
