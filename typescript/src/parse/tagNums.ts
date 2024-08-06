import { DicomError } from "../error/dicomError.js";
import { DicomErrorType, TagDictByHex } from "../globalEnums.js";

export type TagStr = keyof typeof TagDictByHex; // 'keyof' gets the keys of an object type. So this is the union type of all the keys of TagDictByHex

/**
 * Pass in a 4 byte buffer and get back the tag as a string
 * else throw a DicomError if unrecognised. It's the caller's
 * responsibility to pass in the subarray that they determine
 * to be the 4 bytes representing the tag (via cursor walking).
 * @param buf
 * @returns string
 */
export function decodeTagNum(buf: Buffer): TagStr {
   if (buf.length !== 4) {
      return throwBadBufferLength(buf);
   }

   const decode = (offset: number): string => {
      return buf
         .readUInt16LE(offset) // group nums are always 2 bytes
         .toString(16) // hexes are base 16 so pass radix 16
         .padStart(4, "0"); // pad with 0s to make it 4 chars long
   };

   const isHexStr = (str: string): boolean => /^[0-9a-fA-F]{4}$/.test(str); // DICOM tags are always 4 hex chars
   const [grp, el] = [0, 2].map(decode); // group starts at byte offset 0, element at byte offset 2

   if (!isHexStr(grp) || !isHexStr(el)) {
      return throwBadHexPattern(buf, `(${grp},${el})`);
   }

   // if (isDicomTag(`(${grp},${el})`)) {
   //    return `(${grp},${el})` as TagStr;
   // }

   // this is overly militant because we can easily just not know about a tag
   // basically all private tags in the world will trigger this error. Disabling
   // until a better strat is th
   // throw new DicomError({
   //    errorType: DicomErrorType.PARSING,
   //    message: `decodeTagNum() could not decode tag: (${grp},${el})`,
   //    buffer: buf,
   // });

   return `(${grp},${el})` as TagStr;
}

function isDicomTag(tagStr: string): tagStr is TagStr {
   return TagDictByHex.hasOwnProperty(tagStr.toUpperCase());
}

/**
 * Throw an error if the buffer length is not 4 bytes.
 * @param buf
 */
function throwBadBufferLength(buf: Buffer): never {
   throw new DicomError({
      errorType: DicomErrorType.PARSING,
      message: `decodeTagNum() expects a 4byte buffer`,
      buffer: buf,
   });
}

/**
 * Throw an error if the buffer did not decode to a 4 hex character string.
 * @param buf
 */
function throwBadHexPattern(buf: Buffer, str: string): never {
   throw new DicomError({
      errorType: DicomErrorType.PARSING,
      message: `decodeTag() decoded to an unexpected hexPattern: ${str}`,
      buffer: buf,
   });
}
