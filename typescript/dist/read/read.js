import { DicomError } from "../error/dicomError.js";
import { write } from "../logging/logQ.js";
import { ByteLen, DicomErrorType, VR } from "../globalEnums.js";
import { createReadStream } from "fs";
import { decodeTagNum } from "../parse/tagNums.js";
import { decodeValue, decodeVr } from "../parse/valueDecoders.js";
import { isVr } from "../parse/typeGuards.js";
import { isExtendedFormatVr, throwUnrecognisedVr } from "../parse/parse.js";
const DICOM_HEADER = "DICM";
const PREAMBLE_LENGTH = 128;
const DICOM_HEADER_START = PREAMBLE_LENGTH;
const DICOM_HEADER_END = PREAMBLE_LENGTH + 4;
const UNIMPLEMENTED_VR_PARSING = (vr) => `Byte parsing support for VR: ${vr} is unimplemeted in this version`;
/**
 * Unlike readDicom() this takes advantage of the behaviour of
 * streams in a way that doesn't require the conclusion of the
 * stream before beginning to work on it. It immediately begins
 * parsing each buffered byteArray of the file from disk, and stitches
 * truncated DICOM tags together for the next invocation of the 'data'
 * callback to work with.
 *
 * @param path
 * @returns Promise<Elements>
 * @throws DicomError
 */
export function streamParse(path) {
    const elements = [];
    const streamOpts = { highWaterMark: 1024 }; // small buffer to enforce multiple byteArrays to test truncation logic
    const dicomStream = createReadStream(path, streamOpts);
    let firstByteArray = true;
    return new Promise((resolve, reject) => {
        let n = 0;
        let totalLen = 0;
        let partialTagBuf = null;
        dicomStream.on("data", (byteArray) => {
            n++;
            totalLen += byteArray.length;
            write(`Reading #${n} byteArray, ${byteArray.length} bytes (${path})`, "DEBUG");
            if (firstByteArray) {
                validateDicomHeader(byteArray);
                byteArray = byteArray.subarray(DICOM_HEADER_END, byteArray.length); // walk() expects removal of preamble + header
                firstByteArray = false;
            }
            // if there's nothing to stitch, walk the byte array &
            // assign null or a subset of bytes to truncated.
            // else stitch to the current byte array before walking.
            if (!partialTagBuf) {
                partialTagBuf = walk(byteArray, elements);
                return;
            }
            else {
                write(`Stitch: ${partialTagBuf.length} + ${byteArray.length} bytes ${path}`, "DEBUG");
                const stitchedBytes = Buffer.concat([partialTagBuf, byteArray]);
                partialTagBuf = walk(stitchedBytes, elements);
            }
        });
        dicomStream.on("error", error => {
            reject(DicomError.from(error, DicomErrorType.READ));
        });
        dicomStream.on("close", () => {
            write(`Read a total of ${totalLen} bytes from ${path}`, "DEBUG");
            resolve(elements);
        });
    });
}
/**
 * Walk a buffer containing a subset of a DICOM file and parse the tags.
 * Return a buffer containing the truncated tag if the buffer is incomplete.
 * This is used to allow on-the-fly parsing of DICOM files as they are read
 * and stitching together truncated tags that span multiple byteArrays.
 *
 * Note that currently this assumes that the DICOM itself is not malformed.
 * Because currently it just assumes that a handling error signifies the
 * truncation of the buffer which is not realistic. But for testing purposes
 * it's fine because we're working with always perfectly formed DICOMs for now
 *
 * @param buf
 * @param elements
 * @returns PartialTag
 */
function walk(buf, elements) {
    let cursor = 0;
    let lastStartedTagCursorPosition = cursor;
    while (cursor < buf.length) {
        try {
            const el = emptyElement();
            lastStartedTagCursorPosition = cursor;
            const tagBuf = buf.subarray(cursor, cursor + ByteLen.TAG_NUM);
            el.tag = decodeTagNum(tagBuf);
            cursor += ByteLen.TAG_NUM;
            const vrBuf = buf.subarray(cursor, cursor + ByteLen.VR);
            el.vr = decodeVr(vrBuf);
            cursor += ByteLen.VR;
            if (!isVr(el.vr)) {
                throwUnrecognisedVr(el.vr, vrBuf);
            }
            el.length = 0;
            const isExtVr = isExtendedFormatVr(el.vr);
            if (isExtVr) {
                cursor += ByteLen.EXT_VR_RESERVED; // 2 reserved bytes can be ignored
                el.length = buf.readUInt32LE(cursor); // Extended VR tags' lengths are 4 bytes because they can be huge
                cursor += ByteLen.UINT_32;
            }
            if (!isExtVr) {
                el.length = buf.readUInt16LE(cursor); // Standard VR tags' lengths are 2 bytes, so max length is 65,535
                cursor += ByteLen.UINT_16;
            }
            const valueBuf = buf.subarray(cursor, cursor + el.length);
            el.val = decodeValue(el.vr, valueBuf);
            if (el.vr !== VR.SQ && el.vr !== VR.OB) {
                printElement(el);
            }
            else {
                el.devNote = UNIMPLEMENTED_VR_PARSING(el.vr);
                printMinusValue(el);
            }
            elements.push(el); // only push fully parsed elements
            cursor += el.length;
        }
        catch (error) {
            break;
            // currently errors are assumed to be truncated tags
            // because we're working with perfect DICOMs in testing.
            // But in reality DICOM may be malformed, which would
            // wrongly trigger this swallow + break approach.
        }
    }
    // if here we didn't hit a parse error which either means
    //  - we truncated in the middle of a tag's VALUE (far more likely)
    //  - coincidentally the end of a tag's bytes is the end of the byte array
    const bytesLeft = buf.length - lastStartedTagCursorPosition;
    if (bytesLeft > 0) {
        write(`Returning truncated: ${bytesLeft} tag bytes`, "DEBUG");
        return buf.subarray(lastStartedTagCursorPosition, buf.length);
    }
    else {
        write(`Nothing to return for stitching; returning null`, "DEBUG");
        return null;
    }
}
/**
 * Validate the DICOM header by checking for the 'magic word'.
 * A DICOM file should contain the 'magic word' "DICM" at bytes 128-132.
 * Preamble is 128 bytes of 0x00, followed by the 'magic word' "DICM".
 * Preamble may not be used to determine that the file is DICOM.
 *
 * @param byteArray
 * @throws DicomError
 */
function validateDicomHeader(byteArray) {
    const strAtHeaderPosition = byteArray //
        .subarray(DICOM_HEADER_START, DICOM_HEADER_END)
        .toString();
    if (strAtHeaderPosition !== DICOM_HEADER) {
        throw new DicomError({
            errorType: DicomErrorType.VALIDATE,
            message: `DICOM file does not contain 'magic word': ${DICOM_HEADER} at bytes 128-132. Found: ${strAtHeaderPosition}`,
            buffer: byteArray,
        });
    }
}
/**
 * Print an element to the console.
 * @param el
 */
function printElement(el) {
    let str = `Tag: ${el.tag}, VR: ${el.vr}, Length: ${el.length}, Value: ${el.val}`;
    if (el.devNote)
        str += ` DevNote: ${el.devNote}`;
    write(str, "DEBUG");
}
/**
 * Print an element to the console.
 * @param el
 */
function printMinusValue(el) {
    const str = `Tag: ${el.tag}, VR: ${el.vr}, Length: ${el.length} DevNote: ${el.devNote}`;
    write(str, "DEBUG");
}
/**
 * Return a new empty element object.
 * @returns Element
 */
function emptyElement() {
    return {
        vr: null,
        tag: null,
        val: null,
        name: null,
        length: null,
    };
}
//# sourceMappingURL=read.js.map