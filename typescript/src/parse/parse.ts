import { write } from "../logging/logQ.js";
import { decodeTagNum } from "./tagNums.js";
import { decodeValue } from "./valueDecoders.js";

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
 *    - [The tag's actual value, of length 0x0000 - 0xFFFF]
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
   const PREAMBLE_LEN = 128;
   const HEADER_LEN = 4;

   let cursor = PREAMBLE_LEN + HEADER_LEN;

   while (cursor < buf.length) {
      const tag = decodeTagNum(buf.subarray(132, 132 + 4));
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
export function shouldDecodeAsUtf8(vr: string) {
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
