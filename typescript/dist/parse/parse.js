import { DicomError } from "../error/dicomError.js";
import { ByteLen, DicomErrorType, VR } from "../globalEnums.js";
import { write } from "../logging/logQ.js";
import { decodeTagNum } from "./tagNums.js";
import { isVr } from "./typeGuards.js";
import { decodeValue, decodeVr } from "./valueDecoders.js";
export const UNIMPLEMENTED_VR_PARSING = (vr) => `Byte parsing support for VR: ${vr} is unimplemeted in this version`;
export const DICOM_HEADER = "DICM";
export const PREAMBLE_LENGTH = 128;
export const DICOM_HEADER_START = PREAMBLE_LENGTH;
export const DICOM_HEADER_END = PREAMBLE_LENGTH + 4;
/**
 * Walk through a buffer containing a subset of a DICOM file's bytes, and
 * parse the tags.
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
 * @param buffer
 * @param elements
 * @returns PartialTag
 */
export function walk(buffer, streamBundle) {
    let cursor = 0;
    let lastTagStartPosition = cursor;
    // This loop works by walking a cursor forward by the appropriate
    // number of bytes after each decode. The amount to walk forward by
    // is governed primarily by the DICOM specification and datatype sizes.
    while (cursor < buffer.length) {
        try {
            const el = newElement();
            lastTagStartPosition = cursor;
            const tagBuffer = buffer.subarray(cursor, cursor + ByteLen.TAG_NUM);
            el.tag = decodeTagNum(tagBuffer);
            cursor += ByteLen.TAG_NUM;
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
                el.length = buffer.readUInt32LE(cursor); // Extended VR tags' lengths are 4 bytes because they can be huge
                cursor += ByteLen.UINT_32;
            }
            if (!isExtVr) {
                el.length = buffer.readUInt16LE(cursor); // Standard VR tags' lengths are 2 bytes, so max length is 65,535
                cursor += ByteLen.UINT_16;
            }
            const valueBuffer = buffer.subarray(cursor, cursor + el.length);
            el.val = decodeValue(el.vr, valueBuffer, streamBundle);
            if (el.vr !== VR.SQ && el.vr !== VR.OB) {
                printElement(el);
            }
            else {
                el.devNote = UNIMPLEMENTED_VR_PARSING(el.vr);
                printMinusValue(el);
            }
            streamBundle.dataset.push(el); // only fully parsed elements, discard truncated elements
            cursor += el.length;
        }
        catch (error) {
            // assumes errors caught here are indicative of a truncated buffer midway
            // through a tag - not malformed DICOM. In reality this can't be assumed but
            // for testing purposes it's fine. We can easily adapt this by checking for
            // things like instanceof or other custom properties that signify truncation.
            break;
        }
    }
    const bytesLeft = buffer.length - lastTagStartPosition;
    if (bytesLeft > 0) {
        write(`Returning truncated: ${bytesLeft} tag bytes`, "DEBUG");
        return buffer.subarray(lastTagStartPosition, buffer.length);
    }
    else {
        write(`Nothing to return for stitching; returning null`, "DEBUG");
        return null;
    }
}
/**
 * Throw an error if an unrecognised VR is encountered.
 * @param vr
 * @param vrBuf
 * @throws DicomError
 */
export function throwUnrecognisedVr(vr, vrBuffer) {
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
export function isExtendedFormatVr(vr) {
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
export function validateDicomPreamble(buffer) {
    // TODO work out what quarantining really means and how to do it appropriately.
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
export function validateDicomHeader(buffer) {
    const strAtHeaderPosition = buffer //
        .subarray(DICOM_HEADER_START, DICOM_HEADER_END)
        .toString();
    if (strAtHeaderPosition !== DICOM_HEADER) {
        throw new DicomError({
            errorType: DicomErrorType.VALIDATE,
            message: `DICOM file does not contain 'magic word': ${DICOM_HEADER} at bytes 128-132. Found: ${strAtHeaderPosition}`,
            buffer: buffer,
        });
    }
}
/**
 * Print an element to the console.
 * @param el
 */
export function printElement(el) {
    let str = `Tag: ${el.tag}, VR: ${el.vr}, Length: ${el.length}, Value: ${el.val}`;
    if (el.devNote)
        str += ` DevNote: ${el.devNote}`;
    write(str, "DEBUG");
}
/**
 * Print an element to the console.
 * @param el
 */
export function printMinusValue(el) {
    const str = `Tag: ${el.tag}, VR: ${el.vr}, Length: ${el.length} DevNote: ${el.devNote}`;
    write(str, "DEBUG");
}
/**
 * Return a new empty element object.
 * @returns Element
 */
export function newElement() {
    return {
        vr: null,
        tag: "TODO",
        val: null,
        name: null,
        length: null,
    };
}
//# sourceMappingURL=parse.js.map