import { write } from "../logging/logQ.js";
import { DicomError } from "../error/dicomError.js";

// WARN this file is currently ALWAYS assuming little endian byte order.
// This is common but can't really be assumed. But it's a learning project,
// and we'll backfill accomodating this later. Since we're using standard library
// methods to read this anyways as little endian, it's actually going to be
// pretty straightforward to fix this - we just need to determine the byte order
// and then call Big Endian or Little Endian methods accordingly rather than blindly
// calling the LE methods as we are now. S'all good.

// WARN we're also not handling SQ (sequence) tags yet. To do this we'll want
// to recursively walk the bufer and parse those tags in sequence. Let's not
// touch that for now :)

// WARN we're also assuming explicit VR here. It's fairly unusual to see implicit
// VR in the wild but it's possible. Again we can worry about that another time.

// WARN we're also not handling special cases

/**
 * Walk through a DICOM buffer and log the
 * tags, VRs, lengths, and values.
 *
 * In DICOM we have two main formats of VR:
 * 1. Standard Format VR
 * 2. Extended Format VR
 *
 * As the names suggest, Ext Format VRs are for VRs that need to store
 * potentially very large amount of data, like OB for pixel data.
 *
 * When parsing the byte streams of DICOM files' Tags, we need to walk
 * the cursor forward a little differently based on whether its a standard
 * or extended format VR.
 *
 * The byte stream structure for standard VR is like this:
 *    - [2 x ASCII chars (2 bytes) e.g. SH]
 *    - [2 x bytes indicating the subsequent value length]
 *    - [The tag's actual value, of length 0000 - 0xFFFF]
 *
 * Given that standard VRs permit a 2-byte hex to specify the length,
 * this means the decimal length of the value can be at most 65,535 (0xFFFF).
 *
 * That doesn't really cut it for the very large tags like pixel data.
 * So the byte stream structure for those extended VRs is like this:
 *    - [2 x ASCII chars (2 bytes) e.g. OB]
 *    - [2 x reserved bytes, always 0x0000 0x0000]
 *    - [The tag's actual value, of length 0x0000 - 0xFFFFFFFF]
 *
 * Given that the extended VRs permit a 4-byte hex to specify the length,
 * which is represented as 0xFFFFFFFF. This means the decimal length of the
 * value can be at most 4,294,967,295 or about 4GB. Also note that in reality
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
 * @param buf
 * @returns void
 * @throws Error
 */
export function walkDicomBuffer(buf: Buffer) {
   let cursor = 132; // Skip preamble + "DICM" prefix

   while (cursor < buf.length) {
      const groupNumber = buf //
         .readUInt16LE(cursor) // group nums are always 2 bytes
         .toString(16) // convert to hex representation (base 16)
         .padStart(4, "0"); // pad with 0s to make it 4 chars long

      const elementNumber = buf
         .readUInt16LE(cursor + 2)
         .toString(16)
         .padStart(4, "0");

      const tag = `(${groupNumber},${elementNumber})`;
      cursor += 4;

      const vr = buf.toString("ascii", cursor, cursor + 2);
      cursor += 2;

      let length: number;
      if (isExtendedFormatVr(vr)) {
         cursor += 2; // skip 2 reserved bytes
         length = buf.readUInt32LE(cursor); // we know ext VRs' lengths are 4 bytes, and we can use the std lib's method for this
         cursor += 4; // then walk the cursor past these bytes now we've read them
      } else {
         length = buf.readUInt16LE(cursor); // we know std VRs' lengths are 2 bytes, and we can use the std lib's method for this
         cursor += 2; // then walk the cursor past these bytes now we've read them
      }

      const value = buf.subarray(cursor, cursor + length);
      const decodedValue = decodeValue(vr, value);

      write(`Tag: ${tag}, VR: ${vr}, Length: ${length}, Value: ${decodedValue}`, "DEBUG");

      cursor += length;
   }
}

/**
 * Determine if a VR should be decoded as UTF-8.
 * Note that this is not yet exhaustive.
 * Note that others can be decoded as UTF-8 for non
 * visual representations but this is intended for
 * human readable strings at the moment.
 * @param vr
 * @returns
 */
function shouldDecodeAsUtf8(vr: string) {
   const pattern = /^AE|AS|CS|DA|DS|DT|IS|LO|LT|PN|SH|ST|TM|UC|UI|UR|UT$/;
   return pattern.test(vr);
}

/**
 * Determine if a VR is in the extended format.
 * Has implications for how the cursor is walked.
 * See comments in walkDicomBuffer for more info.
 * @param vr
 * @returns
 */
function isExtendedFormatVr(vr: string) {
   const pattern = /^OB|OW|OF|SQ|UT|UN$/;
   return pattern.test(vr);
}

/**
 * Decode a value based on the VR. The appropriate
 * handling is derived from the NEMA DICOM specification.
 * https://www.dicomstandard.org/current/
 * @param vr
 * @param value
 * @returns string
 */
function decodeValue(vr: string, value: Buffer): string {
   switch (true) {
      case shouldDecodeAsUtf8(vr):
         const decoded = value //
            .toString("utf8")
            .replace(/\0+$/, ""); // remove null byte padding

         countNullBytes(value); // debugging
         return decoded;

      case vr === "FL":
         return value.readFloatLE(0).toString();

      case vr === "FD":
         return value.readDoubleLE(0).toString();

      case vr === "SL":
         return value.readInt32LE(0).toString();

      case vr === "SS":
         return value.readInt16LE(0).toString();

      case vr === "UL":
         return value.readUInt32LE(0).toString();

      case vr === "US":
         return value.readUInt16LE(0).toString();

      default:
         return value.toString("hex");
   }
}

/**
 * Count the number of null bytes at the end of a buffer.
 * This is common in DICOM files where the actual value
 * is less than the fixed byte length required by the VR.
 * This is how we support variable length values and when
 * handling the values we should trim these null bytes out.
 * This is just a debug function to help understand the
 * literal values in the DICOM file versus the actual
 * values we should be using.
 * @param value
 * @returns void
 * @throws DicomError
 */
function countNullBytes(value: Buffer) {
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
