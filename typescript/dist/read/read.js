import fs from "fs";
import { DicomError } from "../error/dicomError.js";
import { write } from "../logging/logQ.js";
const PREAMBLE_LENGTH = 128;
const MAGIC_WORD = "DICM";
const MAGIC_WORD_START = PREAMBLE_LENGTH;
const MAGIC_WORD_END = PREAMBLE_LENGTH + 4; // "DICM" is 4 characters
/**
 * Read a DICOM file into memory.
 * @param path
 * @returns Promise<ReadDicom>
 * @throws DicomError
 */
export function readDicom(path) {
    let firstChunk = true;
    return new Promise((resolve, reject) => {
        const readStream = fs.createReadStream(path);
        const bufs = [];
        const res = {
            buf: Buffer.alloc(0),
            len: 0,
        };
        readStream.on("data", (chunk) => {
            write(`Read ${chunk.length} bytes from ${path}`, "DEBUG");
            if (firstChunk) {
                validateDicomHeader(chunk);
                firstChunk = false;
            }
            bufs.push(chunk);
            res.len += chunk.length;
        });
        readStream.on("error", error => {
            reject(new DicomError({
                errorType: Errors.DicomErrorType.READ,
                message: error.message,
            }));
        });
        readStream.on("close", () => {
            write(`Read ${res.len} bytes from ${path}`, "DEBUG");
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
 * http://dicom.nema.org/medical/dicom/current/output/chtml/part10/chapter_7.html
 * @param chunk
 * @returns true | never
 * @throws DicomError
 */
function validateDicomHeader(chunk) {
    if (chunk.subarray(MAGIC_WORD_START, MAGIC_WORD_END).toString() !== MAGIC_WORD) {
        throw new DicomError({
            errorType: Errors.DicomErrorType.VALIDATE,
            message: `DICOM file does not contain magic word: ${MAGIC_WORD} at bytes 128-132`,
            buffer: chunk,
        });
    }
    return true;
}
//# sourceMappingURL=read.js.map