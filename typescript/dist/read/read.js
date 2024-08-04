import { DicomError } from "../error/dicomError.js";
import { write } from "../logging/logQ.js";
import { ByteLen, DicomErrorType } from "../globalEnums.js";
import { createReadStream } from "fs";
import { decodeTagNum } from "../parse/tagNums.js";
import { isVr } from "../parse/typeGuards.js";
import { decodeVr, decodeValue } from "../parse/valueDecoders.js";
import { throwUnrecognisedVr, isExtendedFormatVr } from "../parse/parse.js";
const MAGIC_WORD = "DICM";
const PREAMBLE_LENGTH = 128;
const MAGIC_WORD_START = PREAMBLE_LENGTH;
const MAGIC_WORD_END = PREAMBLE_LENGTH + 4;
/**
 * Read a DICOM file into memory asynchronously and return a promise.
 * The promise resolves to an object containing the buffer and length.
 */
export function readDicom(path) {
    let firstChunk = true;
    return new Promise((resolve, reject) => {
        const readStream = createReadStream(path, {
            highWaterMark: 1024,
        });
        const bufs = [];
        const res = {
            buf: Buffer.alloc(0),
            len: 0,
        };
        let truncatedPrevTag = null;
        readStream.on("data", (chunk) => {
            write(`Read ${chunk.length} bytes from ${path}`, "DEBUG");
            if (firstChunk) {
                validateDicomHeader(chunk);
                chunk = chunk.subarray(132, chunk.length); // _walk() expects removal of non-tag byte structure
                firstChunk = false;
            }
            if (!truncatedPrevTag) {
                // if nothing to stitch then walk the current chunk
                // and if _walk() returns a truncated tag buffer then
                // assign it to truncatedPrevTag else null (which is
                // what _walk() returns).
                const newTruncatedPrevTag = _walk(chunk);
                write(`newTruncatedPrevTag: ${newTruncatedPrevTag}`, "DEBUG");
                truncatedPrevTag = newTruncatedPrevTag ? newTruncatedPrevTag : null;
            }
            else {
                // but if there is something to stitch, then we need to
                // make a new buffer with that prefixed to the current chunk
                // before we can pass it to _walk(). Then we need to clear truncatedPrevTag
                // which we can do by assigning it the return value of _walk() which
                // is either a truncatedTag buffer or null.
                write(`Stitching previous tag to current chunk: ${truncatedPrevTag.length} bytes, ${truncatedPrevTag.toString()}`, "DEBUG");
                const stitchedBuf = Buffer.concat([truncatedPrevTag, chunk]);
                _walk(stitchedBuf);
            }
            bufs.push(chunk);
            res.len += chunk.length;
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
 * Validate the DICOM header by checking for the magic word.
 * A DICOM file should contain the magic word "DICM" at bytes 128-132.
 * Preamble is 128 bytes of 0x00, followed by the magic word "DICM".
 * Preamble cannot be used to determine that the file is DICOM, per the spec.
 *
 * http://dicom.nema.org/medical/dicom/current/output/chtml/part10/chapter_7.html
 *
 * @param chunk
 * @throws DicomError
 */
function validateDicomHeader(chunk) {
    const expectedWordLocation = chunk //
        .subarray(MAGIC_WORD_START, MAGIC_WORD_END)
        .toString();
    if (expectedWordLocation !== MAGIC_WORD) {
        throw new DicomError({
            errorType: DicomErrorType.VALIDATE,
            message: `DICOM file does not contain magic word: ${MAGIC_WORD} at bytes 128-132. Found: ${expectedWordLocation}`,
            buffer: chunk,
        });
    }
}
// dont pass this the preamble & header - just pass
// it where it can immediately begin parsing tag values
// i.e. 132-byte offset.
function _walk(buf) {
    let cursor = 0;
    let lastStartedTagCursorPosition = null;
    while (cursor < buf.length) {
        try {
            lastStartedTagCursorPosition = cursor;
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
        catch (error) {
            console.log(`Error parsing tag at cursor position ${cursor}: ${error.message}`);
            return buf.subarray(lastStartedTagCursorPosition, buf.length);
        }
    }
    return null; // this probably needs refining but if we reach here i think its because the end of the tag
    // coincidentally happens to be the end of the buffer as well so we should return null so its easy to run an 'if' in
    // the calling code
}
//# sourceMappingURL=read.js.map