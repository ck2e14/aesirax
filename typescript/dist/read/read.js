import { DicomError } from "../error/dicomError.js";
import { write } from "../logging/logQ.js";
import { DicomErrorType } from "../globalEnums.js";
import { createReadStream } from "fs";
const MAGIC_WORD = "DICM";
const PREAMBLE_LENGTH = 128;
const MAGIC_WORD_START = PREAMBLE_LENGTH;
const MAGIC_WORD_END = PREAMBLE_LENGTH + 4;
/**
 * Read a DICOM file into memory asynchronously and return a promise.
 * The promise resolves to an object containing the buffer and length.
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
//# sourceMappingURL=read.js.map