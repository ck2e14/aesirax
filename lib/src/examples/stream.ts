import { createReadStream } from "fs";
import { dataSetLength } from "../utils.js";
import { write } from "../logging/logQ.js";
import { DicomError, UnsupportedTSN } from "../errors.js";
import { Cfg, Parse } from "../global.js";
import { parse } from "../parsing/parse.js";
import { Ctx, ctxFactory } from "../parsing/ctx.js";
import { DicomErrorType } from "../enums.js";
import { detectMisalignment, isSupportedTSN } from "../parsing/validation.js";
import { validateHeader, validatePreamble } from "../parsing/validate.js";

export const SMALL_BUF_THRESHOLD = 1024;
export const SMALL_BUF_ADVISORY = `PER_BUF_MAX is less than ${SMALL_BUF_THRESHOLD} bytes. This will work but isn't ideal for I/O efficiency`;
export const HEADER_END = 132;

/**
 * StreamParse() streams according to config and runs parsing logic 
 * against whatever bytes it gets per buffered chunk. 
 *
 * Note that sitching happens when elements are truncated. So, while 
 * a highwatermark is set, the actual max size of each buffer handled 
 * is not currently governed. This means that you're in effect governed 
 * by the largest element's size in bytes. So if you have an absolutely 
 * massive echo image for example where pixel data is colossal, you're 
 * going to see a pretty large amount of stitching if the watermark is 
 * very low, and a big performance hit. 
 *
 * @param path
 * @returns Promise<Element[]>
 * @throws DicomError
 */
export function streamParse(
  path: string,
  cfg: Cfg = null,
  skipPixelData = true
): Promise<Parse.DataSet> {
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

  return new Promise<Parse.DataSet>((resolve, reject) => {
    const stream = createReadStream(path, { highWaterMark: ctx.bufWatermark });

    stream.on("data", async (currBytes: Buffer) => {
      write(`Streamed ${currBytes.length} bytes to memory from ${path}`, "DEBUG");
      ctx.nByteArray++;
      ctx.totalStreamedBytes += currBytes.length;
      ctx.truncatedBuffer = await handleDicomBytes(ctx, currBytes);
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
export async function handleDicomBytes(ctx: Ctx, currBytes: Buffer): Promise<Parse.PartialEl> {
  write(`Reading buffer (#${ctx.nByteArray} - ${currBytes.length} bytes) (${ctx.path})`, "DEBUG");
  return ctx.first
    ? handleFirstBuffer(ctx, currBytes)
    : await parse(stitchBytes(ctx, currBytes), ctx);
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
async function handleFirstBuffer(ctx: Ctx, buffer: Buffer): Promise<Parse.PartialEl> {
  validatePreamble(buffer); // throws if not void return 
  validateHeader(buffer); //   throws if not void return 

  const parseResponse = await parse(buffer.subarray(HEADER_END, buffer.length), ctx); // window the buffer beyond 'DICM' HEADER to start at File Meta Info section
  const tsn = getElementValue<string | void>("(0002,0010)", ctx.dataSet);

  if (typeof tsn !== 'undefined' && !isSupportedTSN(tsn)) {
    throw new UnsupportedTSN(`TSN: ${tsn} is unsupported.`);
  }

  if (isSupportedTSN(tsn)) {
    ctx.transferSyntaxUid = tsn // ?? TransferSyntaxUid.ExplicitVRLittleEndian; // commented out because I dont believe we should optimisitically fallback on even a default syntax. For predictability would rather fail if undetermined from header
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
 * that the value is of the type we expect. 
 * @param tag
 * @param elements
 * @returns T
 */
function getElementValue<T = unknown>(tag: Parse.TagStr, elements: Parse.DataSet): T {
  return (elements[tag]?.value ?? "NOT FOUND") as T;
}


