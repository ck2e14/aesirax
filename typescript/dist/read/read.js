import { DicomError } from "../error/dicomError.js";
import { write } from "../logging/logQ.js";
import { ByteLen, DicomErrorType, VR } from "../globalEnums.js";
import { createReadStream } from "fs";
import { decodeTagNum } from "../parse/tagNums.js";
import { decodeValue, decodeVr } from "../parse/valueDecoders.js";
import { isVr } from "../parse/typeGuards.js";
import { isExtendedFormatVr, throwUnrecognisedVr } from "../parse/parse.js";
const DICOM_HEADER = "DICM", PREAMBLE_LENGTH = 128, DICOM_HEADER_START = PREAMBLE_LENGTH, DICOM_HEADER_END = PREAMBLE_LENGTH + 4;
/**
 * Read a DICOM file into memory asynchronously and return a promise.
 * The promise resolves to an object containing the buffer and length.
 * Note that this function is somewhat redundant in its use of streams
 * because it only begins processing the data once the whole stream
 * has ended. So we might as well just use fs.readFile() in this case.
 * It was a starting point however for the streamParse() function which
 * is why it bothers with streams to achieve the same thing that fs.readFile()
 * would achieve.
 *
 * @param path
 * @returns Promise<ReadDicom>
 * @throws DicomError
 */
export function readDicom(path) {
    let firstChunk = true;
    return new Promise((resolve, reject) => {
        const readStream = createReadStream(path);
        const bufs = [];
        const res = { buf: Buffer.alloc(0), len: 0 };
        readStream.on("data", (byteArray) => {
            write(`Read ${byteArray.length} bytes from ${path}`, "DEBUG");
            if (firstChunk) {
                validateDicomHeader(byteArray);
                firstChunk = false;
            }
            bufs.push(byteArray);
            res.len += byteArray.length;
        });
        readStream.on("error", error => {
            reject(DicomError.from(error, DicomErrorType.READ));
        });
        readStream.on("close", () => {
            write(`Read a total of ${res.len} bytes from ${path}`, "DEBUG");
            res.buf = Buffer.concat(bufs);
            resolve(res);
        });
    });
}
/**
 * Unlike readDicom() this takes advantage of the behaviour of
 * streams in a way that doesn't require the conclusion of the
 * stream before beginning to work on it. It immediately begins
 * parsing each buffered byteArray of the file from disk, and stitches
 * truncated DICOM tags together for the next invocation of the 'data'
 * callback to work with.
 */
export function streamParse(path) {
    const elements = [];
    const streamOpts = { highWaterMark: 1024 }; // deliberately small (1KB) buffer to enforce multiple chunks to test truncation logic
    const readStream = createReadStream(path, streamOpts);
    let firstChunk = true;
    return new Promise((resolve, reject) => {
        let len = 0;
        let truncatedPrevTag = null;
        readStream.on("data", (byteArray) => {
            write(`Read ${byteArray.length} bytes from ${path}`, "DEBUG");
            len += byteArray.length;
            if (firstChunk) {
                validateDicomHeader(byteArray);
                byteArray = byteArray.subarray(DICOM_HEADER_END, byteArray.length); // walk() expects removal of preamble + header
                firstChunk = false;
            }
            if (!truncatedPrevTag) {
                truncatedPrevTag = walk(byteArray, elements); // walk the byte array & assign null or a subset of bytes to truncatedPrevTag
                write(`newTruncatedPrevTag: ${truncatedPrevTag}`, "DEBUG");
                return;
            }
            write(`Stitching: ${truncatedPrevTag.length} + ${byteArray.length} bytes`, "DEBUG");
            // else stitch truncatedPrevTag to the current byte array before walking.
            const stitchedChunk = Buffer.concat([truncatedPrevTag, byteArray]);
            truncatedPrevTag = walk(stitchedChunk, elements);
            write(`newTruncatedPrevTag: ${truncatedPrevTag}`, "DEBUG");
        });
        readStream.on("error", error => {
            reject(DicomError.from(error, DicomErrorType.READ));
        });
        readStream.on("close", () => {
            write(`Read a total of ${len} bytes from ${path}`, "DEBUG");
            resolve(elements);
        });
    });
}
/**
 * Walk a buffer containing a subset of a DICOM file and parse the tags.
 * Return a buffer containing the truncated tag if the buffer is incomplete.
 * This is used to allow on-the-fly parsing of DICOM files as they are read
 * and stitching together truncated tags that span multiple chunks.
 *
 * Note that currently this assumes that the DICOM itself is not malformed.
 * Because currently it just assumes that a handling error signifies the
 * truncation of the buffer which is not realistic. But for testing purposes
 * it's fine because we're working with always perfectly formed DICOMs - for now..
 *
 * @param buf
 * @returns
 */
function walk(buf, elements) {
    let cursor = 0;
    let lastStartedTagCursorPosition = null;
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
            const valBuf = buf.subarray(cursor, cursor + el.length);
            el.val = decodeValue(el.vr, valBuf);
            if (el.vr !== VR.SQ && el.vr !== VR.OB) {
                printElement(el);
            }
            else {
                el.devNote = `Support for VR: ${el.vr} is TBC`;
                printMinusValue(el);
            }
            elements.push(el); // only push fully parsed elements
            cursor += el.length;
        }
        catch (error) {
            // currently, errors are assumed to be truncated tags
            // because we're working with perfect DICOMs in testing.
            // But in reality DICOM may be malformed, which would
            // wrongly trigger this swallow + break approach.
            break;
        }
    }
    // if we reached here its because we didn't hit a parse error which either means:
    //   (A) we truncated in the middle of a tag's VALUE (far more likely)
    //   (B) coincidentally the end of a tag's bytes is the end of the byte array
    const remainingBytes = buf.length - lastStartedTagCursorPosition;
    if (remainingBytes > 0) {
        write(`Returning truncated: ${remainingBytes} tag bytes`, "DEBUG");
        return buf.subarray(lastStartedTagCursorPosition, buf.length);
    }
    write(`Nothing to return for stitching, returning null`, "DEBUG");
    return null;
}
function printElement(el) {
    write(`Tag: ${el.tag}, VR: ${el.vr}, Length: ${el.length}, Value: ${el.val}`, "DEBUG");
}
function printMinusValue(el) {
    write(`Tag: ${el.tag}, VR: ${el.vr}, Length: ${el.length}`, "DEBUG");
}
function emptyElement() {
    return {
        tag: null,
        length: null,
        vr: null,
        val: null,
        name: null,
    };
}
/**
 * Validate the DICOM header by checking for the 'magic word'.
 * A DICOM file should contain the 'magic word' "DICM" at bytes 128-132.
 * Preamble is 128 bytes of 0x00, followed by the 'magic word' "DICM".
 * Preamble cannot be used to determine that the file is DICOM, per the spec.
 *
 * http://dicom.nema.org/medical/dicom/current/output/chtml/part10/chapter_7.html
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
//# sourceMappingURL=read.js.map