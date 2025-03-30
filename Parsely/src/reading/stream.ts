import { DataSet, parse, PartialEl } from "../parsing/parse.js";
import { DicomError, UnsupportedTSN } from "../error/errors.js";
import { DicomErrorType, TransferSyntaxUid } from "../enums.js";
import { detectMisalignment, isSupportedTSN } from "./validation.js";
import { validateHeader, validatePreamble } from "../parsing/validation.js";
import { createReadStream } from "fs";
import { dataSetLength } from "../utils.js";
import { Ctx, ctxFactory } from "./ctx.js";
import { write } from "../logging/logQ.js";
import { TagStr } from "../parsing/decode.js";

export const SMALL_BUF_THRESHOLD = 1024;
export const SMALL_BUF_ADVISORY = `PER_BUF_MAX is less than ${SMALL_BUF_THRESHOLD} bytes. This will work but isn't ideal for I/O efficiency`;
export const HEADER_END = 132;

/**
 * StreamParse() does what it sounds like, it streams according 
 * to config and runs parsing logic against whatever bytes it 
 * gets per buffered chunk. 
 *
 * Note that sitching happens when elements are truncated. So,
 * while a highwatermark is set, the actual max size of each buffer
 * handled is not currently governed. This means that you're in
 * effect governed by the largest element's size in bytes. So if
 * you have an absolutely massive echo image for example where
 * pixel data is colossal, you're going to see a pretty large
 * amount of stitching if the watermark is very low, and a
 * relatively large performance hit. Stitching exists to support 
 * very memory-constrained environments and there is probably a 
 * variable sweetspot for performance when it comes to watermark 
 * that depends on factors that I can't be arsed to test properly.
 *
 * @param path
 * @returns Promise<Element[]>
 * @throws DicomError
 */
export function streamParse(path: string, cfg: Global.Cfg = null, skipPixelData = true): Promise<DataSet> {
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

  return new Promise<DataSet>((resolve, reject) => {
    const stream = createReadStream(path, {
      highWaterMark: ctx.bufWatermark,
    });

    stream.on("data", (currBytes: Buffer) => {
      write(`Streamed ${currBytes.length} bytes to memory from ${path}`, "DEBUG");
      ctx.nByteArray++;
      ctx.totalStreamedBytes += currBytes.length;
      ctx.truncatedBuffer = handleDicomBytes(ctx, currBytes);
    });

    stream.on("end", () => {
      detectMisalignment(ctx);
      write(`Stream end: Parsed ${dataSetLength(ctx.dataSet)} outer datatset elements ${path}`, "DEBUG");
      resolve(ctx.dataSet);
      stream.close();
    });

    stream.on("error", error => {
      reject(DicomError.from(error, DicomErrorType.READ));
      stream.close();
    });
  });
}

/**
 * handleDicomBytes() is a helper function for streamParse()
 * to handle the logic of reading a new buffer from disk, and
 * stitching it to the previous bytes where required.
 * @param ctx
 * @param currBytes
 * @returns TruncatedBuffer (byte[])
 */
export function handleDicomBytes(ctx: Ctx, currBytes: Buffer): PartialEl {
  write(`Reading buffer (#${ctx.nByteArray} - ${currBytes.length} bytes) (${ctx.path})`, "DEBUG");
  return ctx.first 
    ? handleFirstBuffer(ctx, currBytes)
    : parse(stitchBytes(ctx, currBytes), ctx);
}

/**
 * handleFirstBuffer() is a helper function for handleDicomBytes()
 * to handle the first buffer read from disk, which contains the
 * DICOM preamble and HEADER. Note that in all DICOM the File Meta
 * Information which will be encoded as Explicit VR Little Endian.
 * @param ctx
 * @param buffer
 * @throws DicomError
 * @returns TruncatedBuffer (byte[])
 */
function handleFirstBuffer(ctx: Ctx, buffer: Buffer): PartialEl {
  validatePreamble(buffer); // throws if not void
  validateHeader(buffer); // throws if not void

  const parseResponse = parse(buffer.subarray(HEADER_END, buffer.length), ctx); // window the buffer beyond 'DICM' HEADER to start at File Meta Info section
  const tsn = getElementValue<string>("(0002,0010)", ctx.dataSet);

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
function stitchBytes(ctx: Ctx, currBytes: Buffer): Buffer {
  const { truncatedBuffer, path } = ctx;
  write(`Stitching ${truncatedBuffer.length} + ${currBytes.length} bytes (${path})`, "DEBUG");
  return Buffer.concat([truncatedBuffer, currBytes]);
}

/**
 * Get the value of an element from an array of elements. Note that without
 * accepting a callback for runtime type checking we can't actually guarantee
 * that the value is of the type we expect. This is a limitation of type erasure
 * in TypeScript. A flimsy aspect of compile-time-only generics and one
 * that would incur expensive runtime type checking to replicate proper type safety
 * which I guess we could do but I'd rather jump out the window than do that.
 * In Java or Golang you'd use the reflection API to check the type at runtime.
 * @param tag
 * @param elements
 * @returns T
 */
function getElementValue<T = unknown>(tag: TagStr, elements: DataSet): T {
  return (elements[tag]?.value ?? "NOT FOUND") as T;
}


