import { ByteLen, DicomErrorType, TagDictByHex, TransferSyntaxUid, VR } from "../globalEnums.js";
import { Element, maxUint32, valueIsTruncated } from "./parse.js";
import { BufferBoundary, DicomError } from "../error/errors.js";
import { isExtVr, isVr } from "../utils.js";
import { Cursor } from "./cursor.js";
import { write } from "../logging/logQ.js";
import { Ctx } from "../read/read.js";

export type Decoder = (value: Buffer) => string;
export type DecoderMap = Record<Global.VR | "default", Decoder>;
export type TagStr = keyof typeof TagDictByHex; // 'keyof' gets the keys of an object type. So this is the union type of all the keys of TagDictByHex

const decodersLE: Partial<DecoderMap> = {
   // partial because will add VRs incrementally.
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

const decodersBE: Partial<DecoderMap> = {
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
   FL: (val: Buffer) => val.readFloatBE(0).toString(10),
   FD: (val: Buffer) => val.readDoubleBE(0).toString(10),
   SL: (val: Buffer) => val.readInt32BE(0).toString(10),
   SS: (val: Buffer) => val.readInt16BE(0).toString(10),
   UL: (val: Buffer) => val.readUInt32BE(0).toString(10),
   US: (val: Buffer) => val.readUInt16BE(0).toString(10),
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
export function decodeValueBytes(
   vr: string,
   value: Buffer,
   Ctx: Ctx,
   checkNullPadding = false // debugging
): string {
   if (checkNullPadding) {
      countNullBytes(value);
   }

   const decoders =
      Ctx.transferSyntaxUid === TransferSyntaxUid.ExplicitVRLittleEndian ? decodersLE : decodersBE;

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
   if (buf.length !== ByteLen.VR) {
      throw new BufferBoundary(`decodeVrBytes() expected 2 bytes, got ${buf.length}`);
   }

   const decodedVr = buf.toString("ascii", 0, ByteLen.VR);
   const isRecognisedVr = Object.values(VR).includes(decodedVr as VR);

   if (isRecognisedVr) {
      return decodedVr as VR;
   }
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
   }
}

/**
 * Decode the current element's value and move the cursor forwards.
 * @param buffer
 * @param cursor
 * @param el
 * @param Ctx
 */
export function parseValue(buffer: Buffer, cursor: Cursor, el: Element, ctx: Ctx) {
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
 * Decode the current element's VR and walk the cursor
 * @param buffer
 * @param cursor
 * @param el
 * @throws DicomError
 */
export function parseVR(buffer: Buffer, cursor: Cursor, el: Element, ctx: Ctx) {
   const start = cursor.pos;
   const end = cursor.pos + ByteLen.VR;
   const vrBuffer = buffer.subarray(start, end);

   el.vr = decodeVrBytes(vrBuffer);
   cursor.walk(ByteLen.VR, ctx, buffer);

   if (!isVr(el.vr)) {
      throwUnrecognisedVr(el.vr, vrBuffer);
   }
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
export function decodeLenMoveAndCursor(el: Element, cursor: Cursor, buffer: Buffer, ctx: Ctx) {
   // ----  Standard VR ----
   if (!isExtVr(el.vr)) {
      decodeValueBytesLength(el, buffer, cursor, ctx);
      cursor.walk(ByteLen.UINT_16, ctx, buffer);
      return false;
   }

   // ----- Extended VR ------
   cursor.walk(ByteLen.EXT_VR_RESERVED, ctx, buffer); // 2 unused bytes on all ext VRs - can ignore
   decodeValueBytesLength(el, buffer, cursor, ctx); // lens < 4 bytes, (4,294,967,295)
   cursor.walk(ByteLen.UINT_32, ctx, buffer);

   const unsupported =
      el.vr === VR.OB && //
      el.name !== "FileMetaInformationVersion" &&
      el.length === maxUint32;

   if (unsupported) {
      throw new DicomError({
         errorType: DicomErrorType.PARSING,
         message: `OB VR of undefined length is not supported in this version of the parser`,
      });
   }
}

/**
 * Helper function; decode the current element's value.
 * @param el
 * @param buffer
 * @param cursor
 * @param ctx
 */
function decodeValueBytesLength(el: Element, buffer: Buffer, cursor: Cursor, ctx: Ctx) {
   if (isExtVr(el.vr)) {
      el.length = ctx.usingLE //
         ? buffer.readUInt32LE(cursor.pos)
         : buffer.readUInt32BE(cursor.pos); // len < 4 bytes, (4,294,967,295)
   } else {
      el.length = ctx.usingLE //
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
export function decodeTagNum(buf: Buffer): TagStr {
   if (buf.length !== 4) {
      throw new BufferBoundary(`decodeTagNum() expected 4 bytes, got ${buf.length}`);
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
