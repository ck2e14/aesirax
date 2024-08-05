import { DicomError } from "../error/dicomError.js";
import { write } from "../logging/logQ.js";
import { DicomErrorType } from "../globalEnums.js";
import { createReadStream } from "fs";
import { DICOM_HEADER_END, validateDicomHeader, walk, } from "../parse/parse.js";
/**
 * streamParse() takes advantage of the behaviour of streaming
 * from disk in a way that doesn't require the conclusion of the
 * stream before beginning to work on it. It immediately begins
 * parsing each buffered byteArray of the file from disk, and
 * stitches truncated DICOM tags together for the next invocation
 * of the 'data' callback to work with.
 *
 * @param path
 * @returns Promise<Elements>
 * @throws DicomError
 */
export function streamParse(path) {
    const dataset = [];
    const streamOpts = { highWaterMark: 512 }; // small buffer to enforce multiple byteArrays to test truncation logic
    const dicomStream = createReadStream(path, streamOpts);
    let firstByteArray = true;
    return new Promise((resolve, reject) => {
        let n = 0;
        let totalLen = 0;
        let partialTagBytes = null;
        dicomStream.on("data", (byteArray) => {
            totalLen += byteArray.length;
            partialTagBytes = handleNewByteArray(byteArray, ++n, path, partialTagBytes, dataset, firstByteArray);
            firstByteArray = false;
        });
        dicomStream.on("error", error => {
            reject(DicomError.from(error, DicomErrorType.READ));
        });
        dicomStream.on("close", () => {
            write(`Read a total of ${totalLen} bytes from ${path}`, "DEBUG");
            resolve(dataset);
        });
    });
}
/**
 * handleNewByteArray() is a helper function for streamParse() that
 * handles the logic of reading a new byteArray from disk, and
 * stitching it to the previous byteArray where required.
 *
 * @param byteArray
 * @param n
 * @param path
 * @param partialTagBytes
 * @param dataset
 * @param firstByteArray
 * @returns
 */
function handleNewByteArray(byteArray, n, path, partialTagBytes, dataset, firstByteArray = false) {
    write(`Reading #${n} byteArray, ${byteArray.length} bytes (${path})`, "DEBUG");
    if (firstByteArray) {
        validateDicomHeader(byteArray);
        byteArray = byteArray.subarray(DICOM_HEADER_END, byteArray.length); // window beyond 132 bytes
    }
    // if there's nothing to stitch, walk the byte array &
    // assign null or a subset of bytes to truncated.
    if (!partialTagBytes) {
        return walk(byteArray, dataset);
    }
    // else stitch to the current byte array before walking.
    write(`Stitch: ${partialTagBytes.length} + ${byteArray.length} bytes ${path}`, "DEBUG");
    const stitchedBytes = Buffer.concat([partialTagBytes, byteArray]);
    return walk(stitchedBytes, dataset);
}
//# sourceMappingURL=read.js.map