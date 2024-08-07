import { DicomError } from "../error/dicomError.js";
import { write } from "../logging/logQ.js";
import { DicomErrorType, TransferSyntaxUid } from "../globalEnums.js";
import { createReadStream } from "fs";
import { DICOM_HEADER_END, validateDicomHeader, validateDicomPreamble, walk, } from "../parse/parse.js";
// TODO in a future implementation I might consider writing a tranform stream
// to emit elements as they are parsed from the buffer, which we can then handle
// as they are emitted, rather than a dataset at the end. But not particularly key
// and definitely not part of the MVP. This would be for SPEED EFFICIENCY while my
// current implementation is for MEMORY EFFICIENCY (i.e. not loading 100% into memory)
// E.g. for a custom DICOMweb serer it would be better to stream the elements outwards
// as they are parsed by the readStream parser, but for use cases where we need the entire
// dataset represented in memory, the current approach is more applicable. So it would not
// be a replacement, it would be an option to plug into the readStream parser (hence being
// a transform stream).
/**
 * streamParse() takes advantage of the behaviour of streaming
 * from disk in a way that doesn't require the conclusion of the
 * stream before beginning to work on it. It immediately begins
 * parsing each buffered bytes of the file from disk, and
 * stitches truncated DICOM tags together for the next invocation
 * of the 'data' callback to work with.
 *
 * @param path
 * @returns Promise<Element[]>
 * @throws DicomError
 */
export function streamParse(path, skipPixelData = true) {
    const bundle = {
        dataSet: new Map(),
        partialTag: Buffer.alloc(0),
        perBufMax: Number(process.env.PER_BUF_MAX ?? 1024 * 1024 * 2), // default to 2MB
        firstBytes: true,
        path: path,
        nByteArray: 0,
        totalBytes: 0,
        skipPixelData,
        transferSyntaxUid: TransferSyntaxUid.ExplicitVRLittleEndian, // default to Explicit VR Little Endian
    };
    if (bundle.perBufMax < DICOM_HEADER_END + 1) {
        throw new DicomError({
            message: `PER_BUF_MAX must be at least ${DICOM_HEADER_END + 1} bytes.`,
            errorType: DicomErrorType.READ,
        });
    }
    if (bundle.perBufMax < 1024) {
        write(`PER_BUF_MAX is ${bundle.perBufMax} bytes. This will work but isn't ideal.`, "WARN");
    }
    return new Promise((resolve, reject) => {
        const stream = createReadStream(path, {
            highWaterMark: bundle.perBufMax,
        });
        stream.on("data", (currBytes) => {
            bundle.nByteArray = bundle.nByteArray + 1;
            bundle.totalBytes = bundle.totalBytes + currBytes.length;
            bundle.partialTag = handleDicomBytes(bundle, currBytes); // update partialTag with any partially read tag from current buffer
        });
        stream.on("close", () => {
            write(`Finished: read a total of ${bundle.totalBytes} bytes from ${path}`, "DEBUG");
            write(`Parsed ${bundle.dataSet.size} elements from ${path}`, "DEBUG");
            resolve(bundle.dataSet);
        });
        stream.on("error", error => {
            stream.close();
            reject(DicomError.from(error, DicomErrorType.READ));
        });
    });
}
/**
 * isSupportedTSN() is a type guard for TransferSyntaxUids
 * @param uid
 * @returns boolean
 */
function isSupportedTSN(uid) {
    return Object.values(TransferSyntaxUid).includes(uid);
}
/**
 * handleDicomBytes() is a helper function for streamParse()
 * to handle the logic of reading a new buffer from disk, and
 * stitching it to the previous bytes where required.
 * @param bundle
 * @param currBytes
 * @returns PartialTag (byte[])
 */
export function handleDicomBytes(bundle, currBytes) {
    const { path, nByteArray } = bundle;
    write(`Reading buffer (#${nByteArray} - ${currBytes.length} bytes) (${path})`, "DEBUG");
    if (bundle.firstBytes) {
        return handleFirstBuffer(bundle, currBytes);
    }
    const s = stitchBytes(bundle, currBytes);
    return walk(s, bundle);
}
/**
 * handleFirstBuffer() is a helper function for handleDicomBytes()
 * to handle the first buffer read from disk, which contains the
 * DICOM preamble and header. It walks the buffer like in handleDicomBytes()
 * but it also validates the DICOM preamble and header.
 *
 * Note that in all DICOM regardless of the transfer syntax, the File Meta Information
 * which, in the byte stream, precedes the Data Set, will be encoded as the Explicit VR
 * Little Endian Transfer Syntax, as laid out in the DICOM spec at PS3.5
 * https://dicom.nema.org/medical/dicom/current/output/chtml/part05/PS3.5.html
 *
 * @param bundle
 * @param buffer
 * @throws DicomError
 * @returns
 */
function handleFirstBuffer(bundle, buffer) {
    validateDicomPreamble(buffer); // throws if not void
    validateDicomHeader(buffer); // throws if not void
    buffer = buffer.subarray(DICOM_HEADER_END, buffer.length); // window the buffer beyond 'DICM' header
    const truncatedElement = walk(buffer, bundle);
    const tsn = getElementValue("(0002,0010)", bundle.dataSet);
    if (!isSupportedTSN(tsn)) {
        throw new DicomError({
            message: `Transfer Syntax UID ${tsn} is unsupported.`,
            errorType: DicomErrorType.PARSING,
        });
    }
    bundle.transferSyntaxUid = tsn;
    bundle.firstBytes = false;
    return truncatedElement;
}
/**
 * stitchBytes() is a helper function for handleDicomBytes()
 * to concatenate the partial tag bytes with the current bytes
 * @param partialTag
 * @param currBytes
 * @returns
 */
function stitchBytes(bundle, currBytes) {
    const { partialTag, path } = bundle;
    write(`Stitching ${partialTag.length} + ${currBytes.length} bytes (${path})`, "DEBUG");
    return Buffer.concat([partialTag, currBytes]);
}
function validateLittleEndianness() {
    // TODO
    // check for even length (achieved through null byte padding where required)
}
function validateFileMetaInformation() {
    // TODO
    // the File Meta Information is the section of the DICOM file format that precedes
    // the DICOM Data Set. All tags in this section are in the 0x0002 group.
}
/**
 * Get the value of an element from an array of elements. Note that without
 * accepting a callback for runtime type checking we can't actually guarantee
 * that the value is of the type we expect. This is a limitation of type erasure
 * in TypeScript. Such a flimsy aspect of compile-time-only generics and one
 * that would incur expensive runtime type checking to replicate proper type safety
 * which I guess we could do but I'd rather jump out the window than do that.
 * In Java or Golang you'd use the reflection API to check the type at runtime.
 * @param tag
 * @param elements
 * @returns T
 */
function getElementValue(tag, elements) {
    return elements.get(tag).val;
}
//# sourceMappingURL=read.js.map