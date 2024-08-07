import { BufferBoundaryError, DicomError, UndefinedLength } from "../error/errors.js";
import { ByteLen, DicomErrorType, TagDictByHex, TransferSyntaxUid, VR } from "../globalEnums.js";
import { write } from "../logging/logQ.js";
import { StreamBundle } from "../read/read.js";
import { decodeTagNum, TagStr } from "./tagNums.js";
import { isVr } from "./typeGuards.js";
import { decodeValue, decodeVr } from "./valueDecoders.js";

export type PartialTag = Buffer | null;
export type DataSet = Record<string, Element>;
export type Element = {
   tag: TagStr;
   name: string;
   vr: VR;
   length: number;
   val: string | number | Buffer;
   devNote?: string;
};

export const DICOM_HEADER = "DICM";
export const PREAMBLE_LENGTH = 128;
export const DICOM_HEADER_START = PREAMBLE_LENGTH;
export const DICOM_HEADER_END = PREAMBLE_LENGTH + 4;

/**
 * Walk through a buffer containing a subset of a DICOM file's bytes, and
 * parse the tags.
 *
 * Implicit VR is not supported in this version.
 *
 * Return a buffer containing the truncated tag if the buffer is incomplete.
 * This is used to allow on-the-fly parsing of DICOM files as they are read
 * and stitching together truncated tags that span multiple byteArrays.
 *
 * Note that currently this assumes that the DICOM itself is not malformed.
 * Because currently it just assumes that a handling error signifies the
 * truncation of the buffer which is not realistic. But for testing purposes
 * it's fine because we're working with always perfectly formed DICOMs for now
 *
 * LEARNING NOTES:
 *
 * In DICOM we have two main types of VR:
 *  1. Standard Format VR
 *  2. Extended Format VR
 *
 * As the name suggests Extended Format VRs are for VRs that may store
 * very large amounts of data, like OB VRs for pixel data.
 *
 * When parsing the byte streams of DICOM files' Tags, we need to walk
 * the cursor forward a little differently based on whether its a standard
 * or extended format VR.
 *
 * The byte stream structure for standard VR is like this:
 *   - [2 x ASCII chars (2 bytes) e.g. SH]
 *   - [2 x bytes indicating the subsequent value length]
 *   - [The tag's actual value, of length 0x0000 - 0xFFFF]
 *
 * Given that standard VRs permit a 2-byte hex to specify the length,
 * this means the decimal length of the value can be at most 65,535 (0xFFFF).
 *
 * That doesn't really cut it for the very large tags like pixel data.
 * So the byte stream structure for those extended VRs is like this:
 *   - [2 x ASCII chars (2 bytes) e.g. OB]
 *   - [2 x reserved bytes, always 0x0000 0x0000]
 *   - [The tag's actual value, of length 0x0000 - 0xFFFFFFFF]
 *
 * Given that the extended VRs permit a 4-byte hex to specify the length,
 * which is represented as 0xFFFFFFFF. This means the decimal length of the
 * value can be at most 4,294,967,295 (i.e. about 4GB). Note that in reality
 * some applications are going tell you to GTFO if you pass 4GB in one single
 * tag but it depends what you're dealing with. Ultrasounds are going to be
 * very long in pixel data tags, for example.
 *
 * Note as well that for futureproofing the DICOM spec demands that there are
 * 2 reserved bytes in the extended format VRs, which aren't yet implemented
 * in the spec as anything, but are still always present (as 0x0000), so we need
 * to know about these so we can walk the cursor forward by the right amount.
 *
 * Note that this function assumes you've chekced 0-128 bytes for the preamble,
 * and 128-132 bytes for 'DICM' header.
 *
 * Note that SQ items may not have a length specified, and instead have a length
 * of 0xFFFFFFFF. This is a special case and is not yet supported in this version.
 * When I say special case I mean it's a shocking design decision by the DICOM
 * committee but one that is far too deeply ingrained as legacy code to remove.
 *
 * @param buffer
 * @param elements
 * @returns PartialTag
 */
export function walk(buffer: Buffer, streamBundle: StreamBundle): PartialTag {
   let cursor = 0;
   let lastTagStartPosition: number = cursor;

   const useLE =
      streamBundle.transferSyntaxUid === TransferSyntaxUid.ExplicitVRLittleEndian ||
      streamBundle.transferSyntaxUid === TransferSyntaxUid.ImplicitVRLittleEndian;

   // This loop works by walking a cursor forward by the appropriate
   // number of bytes after each decode. The amount to walk forward by
   // is governed primarily by the DICOM specification and datatype sizes.

   while (cursor < buffer.length) {
      const el = newElement();
      lastTagStartPosition = cursor;

      try {
         // Group & Element Number decoding
         const tagBuffer = buffer.subarray(cursor, cursor + ByteLen.TAG_NUM);
         el.tag = decodeTagNum(tagBuffer);
         el.name = TagDictByHex[el.tag.toUpperCase()]?.["name"] ?? "Private or Unrecognised Tag";
         cursor += ByteLen.TAG_NUM;

         // VR decoding
         const vrBuffer = buffer.subarray(cursor, cursor + ByteLen.VR);
         el.vr = decodeVr(vrBuffer);
         cursor += ByteLen.VR;

         if (!isVr(el.vr)) {
            throwUnrecognisedVr(el.vr, vrBuffer);
         }

         el.length = 0;
         const isExtVr = isExtendedFormatVr(el.vr);

         if (isExtVr) {
            cursor += ByteLen.EXT_VR_RESERVED; // 2 reserved bytes can be ignored
            el.length = useLE ? buffer.readUInt32LE(cursor) : buffer.readUInt32BE(cursor); // Extended VR tags' lengths are 4 bytes, may be enormous

            const isUndefinedLength = el.length === 4_294_967_295; // see notes in UndefinedLength class
            if (isUndefinedLength) {
               throw new UndefinedLength(`${el.tag} => SQ of undefined length - unsupported ATM.`);
            }

            cursor += ByteLen.UINT_32;
         }

         if (!isExtVr) {
            el.length = useLE ? buffer.readUInt16LE(cursor) : buffer.readUInt16BE(cursor); // Standard VR tags' lengths are 2 bytes, so max length is 65,535
            cursor += ByteLen.UINT_16;
         }

         // Value decoding
         if (valueIsTruncated(buffer, cursor, el.length)) {
            throw new BufferBoundaryError(`Tag ${el.tag} is truncated, will try to stitch...`);
         }
         const valueBuffer = buffer.subarray(cursor, cursor + el.length);
         el.val = decodeValue(el.vr, valueBuffer, streamBundle);

         // Debug printing
         const longAsFuck = [VR.SQ, VR.OB, VR.UN];
         if (longAsFuck.includes(el.vr)) {
            el.devNote = UNIMPLEMENTED_VR_PARSING(el.vr);
            printMinusValue(el);
         } else {
            printElement(el);
         }

         streamBundle.dataSet[el.tag] = el; // Store fully parsed elements only
         cursor += el.length; // Move cursor to the start of next tag
      } catch (error) {
         const boundaryErr = [BufferBoundaryError, DicomError]; // can refine DicomError here because a bit broad but does work atm.
         const presumedNotTruncationError = boundaryErr.every(ex => !(error instanceof ex));

         if (presumedNotTruncationError) {
            throw error; // halt parsing, unrecoverable error
         }

         return buffer.subarray(lastTagStartPosition, buffer.length);
         // break; // else buffer stitching
      }
   }
}

/**
 * Assess whether there are any bytes left in the buffer
 * in relation to the current cursor position.
 * @param buffer
 * @param cursor
 * @returns number
 */
function bytesLeft(buffer: Buffer, cursor: number): number {
   return buffer.length - cursor;
}

/**
 * Assess whether there are enough bytes left in the buffer to
 * decode the next tag. If not, return the truncated tag. Saves
 * redundant work and allows early return in walk() to pass back
 * a buffer to be stitched to the next streamed buffer.
 * @param buffer
 * @param cursor
 * @param expectedLength
 * @returns boolean
 */
function valueIsTruncated(buffer: Buffer, cursor: number, expectedLength: number): boolean {
   return expectedLength > bytesLeft(buffer, cursor);
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
 * Determine if a VR is in the extended format.
 * Has implications for how the cursor is walked.
 * See comments in walkEntireDicomFileAsBuffer for more info.
 * @param vr
 * @returns boolean
 */
export function isExtendedFormatVr(vr: Global.VR): boolean {
   const extVrPattern = /^OB|OW|OF|SQ|UT|UN$/;
   return extVrPattern.test(vr);
}

/**
 * Validate the DICOM preamble by checking that the
 * first 128 bytes are all 0x00. This is a security
 * design choice by me to prevent the execution of
 * arbitrary code within the preamble. See spec notes.
 * @param buffer
 * @throws DicomError
 */
export function validateDicomPreamble(buffer: Buffer): void | never {
   // TODO work out what quarantining really entails and how to do it
   const preamble = buffer.subarray(0, PREAMBLE_LENGTH);

   if (!preamble.every(byte => byte === 0x00)) {
      throw new DicomError({
         errorType: DicomErrorType.VALIDATE,
         message: `DICOM file must beging with contain 128 bytes of 0x00 for security reasons. Quarantining this file`,
      });
   }
}

/**
 * Validate the DICOM header by checking for the 'magic word'.
 * A DICOM file should contain the 'magic word' "DICM" at bytes 128-132.
 * Preamble is 128 bytes of 0x00, followed by the 'magic word' "DICM".
 * Preamble may not be used to determine that the file is DICOM.
 * @param byteArray
 * @throws DicomError
 */
export function validateDicomHeader(buffer: Buffer): void | never {
   const strAtHeaderPosition = buffer //
      .subarray(DICOM_HEADER_START, DICOM_HEADER_END)
      .toString();

   if (strAtHeaderPosition !== DICOM_HEADER) {
      throw new DicomError({
         errorType: DicomErrorType.VALIDATE,
         message: `DICOM file does not contain 'DICM' at bytes 128-132. Found: ${strAtHeaderPosition}`,
         buffer: buffer,
      });
   }
}

/**
 * Print an element to the console.
 * @param el
 */
export function printElement(el: Element): void {
   let str = `Tag: ${el.tag}, Name: ${el.name}, VR: ${el.vr}, Length: ${el.length}, Value: ${el.val}`;
   if (el.devNote) str += ` DevNote: ${el.devNote}`;
   write(str, "DEBUG");
}

/**
 * Print an element to the console.
 * @param el
 */
export function printMinusValue(el: Element): void {
   const str = `Tag: ${el.tag}, Name: ${el.name}, VR: ${el.vr}, Length: ${el.length} DevNote: ${el.devNote}`;
   write(str, "DEBUG");
}

/**
 * Return a new empty element object.
 * @returns Element
 */
export function newElement(): Element {
   return {
      vr: null,
      tag: null,
      val: null,
      name: null,
      length: null,
   };
}

/**
 * Placeholder for implementation
 */
export function UNIMPLEMENTED_VR_PARSING(vr: Global.VR) {
   return `Byte parsing support for VR: ${vr} is unimplemeted in this version`;
}
