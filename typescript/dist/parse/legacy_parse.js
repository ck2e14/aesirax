import { DicomError } from "../error/dicomError.js";
import { ByteLen, DicomErrorType } from "../globalEnums.js";
import { write } from "../logging/logQ.js";
import { decodeTagNum } from "./tagNums.js";
import { isVr } from "./typeGuards.js";
import { decodeVr, decodeValue } from "./valueDecoders.js";
/**
 * WARN - this function expects THE ENTIRE DICOM FILE IN A SINGLE BUFFER!
 *        see streamParse() for chunked processing of the file.
 *
 * This is for learning - NOT PRODUCTION!
 *
 * Walk through a DICOM buffer and log the tags, VRs, lengths, and values.
 *
 * In DICOM we have two main formats of VR:
 * 1. Standard Format VR
 * 2. Extended Format VR
 *
 * As the name suggests Extended Format VRs are for VRs that may store
 * very large amounts of data, like OB VRs for pixel data.
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
 * value can be at most 4,294,967,295 (i.e. about 4GB). Also note that in reality
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
export function walkEntireDicomFileAsBuffer(buf) {
    let cursor = ByteLen.PREAMBLE + ByteLen.HEADER;
    while (cursor < buf.length) {
        const tagBuf = buf.subarray(cursor, cursor + ByteLen.TAG_NUM);
        const tag = decodeTagNum(tagBuf);
        cursor += ByteLen.TAG_NUM;
        const vrBuf = buf.subarray(cursor, cursor + ByteLen.VR);
        const vr = decodeVr(vrBuf);
        cursor += ByteLen.VR;
        if (!isVr(vr)) {
            throwUnrecognisedVr(vr, vrBuf);
        }
        const isExtVr = isExtendedFormatVr(vr);
        let valueLength = 0;
        if (isExtVr) {
            cursor += ByteLen.EXT_VR_RESERVED; // 2 reserved bytes can be ignored
            valueLength = buf.readUInt32LE(cursor); // Extended VR tags' lengths are 4 bytes because they can be huge
            cursor += ByteLen.UINT_32;
        }
        if (!isExtVr) {
            valueLength = buf.readUInt16LE(cursor); // Standard VR tags' lengths are 2 bytes, so max length is 0xFFFF
            cursor += ByteLen.UINT_16;
        }
        const valueBuffer = buf.subarray(cursor, cursor + valueLength);
        const decodedValue = decodeValue(vr, valueBuffer);
        write(`Tag: ${tag}, VR: ${vr}, Length: ${valueLength}, Value: ${decodedValue}`, "DEBUG");
        cursor += valueLength;
    }
}
/**
 * Throw an error if an unrecognised VR is encountered.
 * @param vr
 * @param vrBuf
 * @throws DicomError
 */
export function throwUnrecognisedVr(vr, vrBuf) {
    throw new DicomError({
        errorType: DicomErrorType.PARSING,
        message: `Unrecognised VR: ${vr}`,
        buffer: vrBuf,
    });
}
/**
 * Determine if a VR is in the extended format.
 * Has implications for how the cursor is walked.
 * See comments in walkEntireDicomFileAsBuffer for more info.
 * @param vr
 * @returns boolean
 */
export function isExtendedFormatVr(vr) {
    const extVrPattern = /^OB|OW|OF|SQ|UT|UN$/;
    return extVrPattern.test(vr);
}
//# sourceMappingURL=legacy_parse.js.map