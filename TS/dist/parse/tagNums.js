import { BufferBoundary, DicomError } from "../error/errors.js";
import { DicomErrorType } from "../globalEnums.js";
/**
 * Pass in a 4 byte buffer and get back the tag as a string
 * else throw a DicomError if unrecognised. It's the caller's
 * responsibility to pass in the subarray that they determine
 * to be the 4 bytes representing the tag (via cursor walking).
 * @param buf
 * @returns string
 */
export function decodeTagNum(buf) {
    if (buf.length !== 4) {
        throw new BufferBoundary(`decodeTagNum() expected 4 bytes, got ${buf.length}`);
    }
    const decode = (offset) => {
        return buf
            .readUInt16LE(offset) // group nums are always 2 bytes
            .toString(16) // hexes are base 16 so pass radix 16
            .padStart(4, "0"); // pad with 0s to make it 4 chars long
    };
    const isHexStr = (str) => /^[0-9a-fA-F]{4}$/.test(str); // DICOM tags are always 4 hex chars
    const [grp, el] = [0, 2].map(decode); // group starts at byte offset 0, element at byte offset 2
    if (!isHexStr(grp) || !isHexStr(el)) {
        return throwBadHexPattern(buf, `(${grp},${el})`);
    }
    return `(${grp},${el})`;
}
/**
 * Throw an error if the buffer did not decode to a 4 hex character string.
 * @param buf
 */
function throwBadHexPattern(buf, str) {
    throw new DicomError({
        errorType: DicomErrorType.PARSING,
        message: `decodeTag() decoded to an unexpected hexPattern: ${str}`,
        buffer: buf,
    });
}
//# sourceMappingURL=tagNums.js.map