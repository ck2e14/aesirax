import { write } from "../logging/logQ.js";
import { DicomErrorType, TransferSyntaxUid } from "../globalEnums.js";
import { createReadStream } from "fs";
import { DicomError, UnsupportedTSN } from "../error/errors.js";
import { HEADER_END, validateHeader, validatePreamble, parse, } from "../parse/parse.js";
const SMALL_BUF_THRESHOLD = 1024;
const SMALL_BUF_ADVISORY = `PER_BUF_MAX is less than ${SMALL_BUF_THRESHOLD} bytes. This will work but isn't ideal for I/O efficiency`;
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
export function streamParse(path, cfg = null, skipPixelData = true) {
    const ctx = ctxFactory(path, cfg, true, skipPixelData);
    if (ctx.bufWatermark < HEADER_END + 1) {
        throw new DicomError({
            message: `PER_BUF_MAX must be at least ${HEADER_END + 1} bytes.`,
            errorType: DicomErrorType.BUNDLE_CONFIG,
        });
    }
    if (ctx.bufWatermark < SMALL_BUF_THRESHOLD) {
        write(SMALL_BUF_ADVISORY, "WARN");
    }
    return new Promise((resolve, reject) => {
        const stream = createReadStream(path, {
            highWaterMark: ctx.bufWatermark,
        });
        stream.on("data", (currBytes) => {
            write(`Received ${currBytes.length} bytes from ${path}`, "DEBUG");
            ctx.nByteArray = ctx.nByteArray + 1;
            ctx.totalBytes = ctx.totalBytes + currBytes.length;
            ctx.truncatedBuffer = handleDicomBytes(ctx, currBytes)?.truncatedBuffer; // update TruncatedBuffer with any partially read tag from current buffer
        });
        stream.on("end", () => {
            write(`Finished: read a total of ${ctx.totalBytes} bytes from ${path}`, "DEBUG");
            write(`Parsed ${Object.keys(ctx.dataSet).length} elements from ${path}`, "DEBUG");
            resolve(ctx.dataSet);
            stream.close();
            3;
        });
        stream.on("error", error => {
            reject(DicomError.from(error, DicomErrorType.READ));
            stream.close();
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
 * @param ctx
 * @param currBytes
 * @returns TruncatedBuffer (byte[])
 */
export function handleDicomBytes(ctx, currBytes) {
    const { path, nByteArray } = ctx;
    write(`Reading buffer (#${nByteArray} - ${currBytes.length} bytes) (${path})`, "DEBUG");
    if (ctx.first) {
        return handleFirstBuffer(ctx, currBytes);
    }
    else {
        const stichedBuffer = stitchBytes(ctx, currBytes);
        return parse(stichedBuffer, ctx);
    }
}
/**
 * handleFirstBuffer() is a helper function for handleDicomBytes()
 * to handle the first buffer read from disk, which contains the
 * DICOM preamble and header. It walks the buffer like in handleDicomBytes()
 * but it also validates the DICOM preamble and header.
 *
 * Note that in all DICOM regardless of the transfer syntax, the File
 * Meta Information which, in the byte stream, precedes the Data Set,
 * will be encoded as the Explicit VR Little Endian Transfer Syntax.
 *
 * @param ctx
 * @param buffer
 * @throws DicomError
 * @returns TruncatedBuffer (byte[])
 */
function handleFirstBuffer(ctx, buffer) {
    validatePreamble(buffer); // throws if not void
    validateHeader(buffer); // throws if not void
    buffer = buffer.subarray(HEADER_END, buffer.length); // window the buffer beyond 'DICM' header
    const parseResponse = parse(buffer, ctx);
    const tsn = getElementValue("(0002,0010)", ctx.dataSet);
    if (tsn && !isSupportedTSN(tsn)) {
        throw new UnsupportedTSN(`TSN: ${tsn} is unsupported.`);
    }
    if (isSupportedTSN(tsn)) {
        ctx.transferSyntaxUid = tsn ?? TransferSyntaxUid.ExplicitVRLittleEndian;
        ctx.first = false;
        return parseResponse;
    }
}
/**
 * stitchBytes() is a helper function for handleDicomBytes()
 * to concatenate the partial tag bytes with the current bytes
 * @param TruncatedBuffer
 * @param currBytes
 * @returns Buffer
 */
function stitchBytes(ctx, currBytes) {
    const { truncatedBuffer, path } = ctx;
    write(`Stitching ${truncatedBuffer.length} + ${currBytes.length} bytes (${path})`, "DEBUG");
    return Buffer.concat([truncatedBuffer, currBytes]);
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
    return (elements[tag]?.value ?? "NOT FOUND");
}
/**
 * ctxFactory() is a factory function for creating a StreamContext
 * with default values for the first buffer read from disk.
 * @param path
 * @param skipPixels
 * @returns
 */
function ctxFactory(path, cfg = null, assumeDefaults = true, skipPixels = true) {
    if (assumeDefaults) {
        return {
            first: true,
            dataSet: {},
            dataSetStack: [],
            truncatedBuffer: Buffer.alloc(0),
            bufWatermark: cfg?.bufWatermark ?? 1024 * 1024,
            totalBytes: 0,
            lastTagStart: 0,
            path,
            nByteArray: 0,
            skipPixelData: skipPixels,
            transferSyntaxUid: TransferSyntaxUid.ExplicitVRLittleEndian,
            usingLE: true,
            inSequence: false,
            currSqTag: null,
            sequenceBytesTraversed: null,
        };
    }
    else {
        return {
            ...cfg,
            path,
        };
    }
}
//# sourceMappingURL=read.js.map