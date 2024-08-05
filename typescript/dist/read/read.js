import { DicomError } from "../error/dicomError.js";
import { write } from "../logging/logQ.js";
import { DicomErrorType } from "../globalEnums.js";
import { createReadStream } from "fs";
import { DICOM_HEADER_END, validateDicomHeader, validateDicomPreamble, walk, } from "../parse/parse.js";
var TagDictionary;
(function (TagDictionary) {
    TagDictionary["TransferSyntaxUID"] = "(0002,0010)";
})(TagDictionary || (TagDictionary = {}));
var TransferSyntaxUid;
(function (TransferSyntaxUid) {
    TransferSyntaxUid["ImplicitVRLittleEndian"] = "1.2.840.10008.1.2";
    TransferSyntaxUid["ExplicitVRLittleEndian"] = "1.2.840.10008.1.2.1";
})(TransferSyntaxUid || (TransferSyntaxUid = {}));
// TODO we want to change the DataSet to be a hashmap of tags, so we can easily access them by their tag
// for now lets just .find() in an array - can easily be changed later.
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
        dataset: [],
        partialTag: Buffer.alloc(0),
        perBufMax: Number(process.env.PER_BUF_MAX ?? 512),
        firstBytes: true,
        path: path,
        nByteArray: 0,
        totalBytes: 0,
        skipPixelData,
        transferSyntaxUid: null,
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
            resolve(bundle.dataset);
        });
        stream.on("error", error => {
            stream.close();
            reject(DicomError.from(error, DicomErrorType.READ));
        });
    });
}
/**
 * isTransferSyntax() is a type guard for TransferSyntaxUids
 * @param uid
 * @returns boolean
 */
function isTransferSyntax(uid) {
    return Object.values(TransferSyntaxUid).includes(uid);
}
/**
 * handleDicomBytes() is a helper function for streamParse()
 * to handle the logic of reading a new bytes from disk, and
 * stitching it to the previous bytes where required.
 * @param bundle
 * @param currBytes
 * @returns PartialTag (byte[])
 */
export function handleDicomBytes(bundle, currBytes) {
    const { path, nByteArray } = bundle;
    write(`Reading buffer (#${nByteArray} - ${currBytes.length} bytes) (${path})`, "DEBUG");
    if (bundle.firstBytes) {
        // Note that in all DICOM regardless of the transfer syntax, the File Meta Information
        // which, in the byte stream, precedes the Data Set, will be encoded as the Explicit VR
        // Little Endian Transfer Syntax, as laid out in the DICOM spec at PS3.5
        // https://dicom.nema.org/medical/dicom/current/output/chtml/part05/PS3.5.html
        validateDicomPreamble(currBytes);
        validateDicomHeader(currBytes);
        currBytes = currBytes.subarray(DICOM_HEADER_END, currBytes.length); // go beyond 'DICM' header
        const truncatedElement = walk(currBytes, bundle.dataset);
        const tsn = getElementValue(TagDictionary.TransferSyntaxUID, bundle.dataset);
        if (!isTransferSyntax(tsn)) {
            throw new DicomError({
                message: `Transfer Syntax UID ${tsn} is unsupported.`,
                errorType: DicomErrorType.PARSING,
            });
        }
        bundle.firstBytes = false;
        return truncatedElement;
    }
    const s = stitchBytes(bundle, currBytes);
    return walk(s, bundle.dataset);
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
    // check for even length (achieved through null byte padding where required)
}
function validateFileMetaInformation() {
    // the File Meta Information is the section of the DICOM file format that precedes
    // the DICOM Data Set. All tags in this section are in the 0x0002 group.
}
/**
 * Get the value of an element from an array of elements. Note that without
 * accepting a callback for runtime type checking we can't actually guarantee
 * that the value is of the type we expect. This is a limitation of type erasure
 * in TypeScript. Such a flimsy aspect of compile-time-only generics and one
 * that would incur expensive runtime type checking to replicate proper type safety
 * which I guess we could do but I'd raher jump out the window than do that.
 * In Java or Golang you'd use the reflection API to check the type at runtime JS is
 * dynamically typed.
 * @param tag
 * @param elements
 * @returns T
 */
function getElementValue(tag, elements) {
    return elements.find(e => e.tag === tag).val;
}
//# sourceMappingURL=read.js.map