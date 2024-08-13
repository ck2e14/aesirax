import { write } from "../logging/logQ.js";
import { DicomErrorType, TransferSyntaxUid } from "../globalEnums.js";
import { createReadStream } from "fs";
import { TagStr } from "../parse/tagNums.js";
import { DicomError, UnsupportedTSN } from "../error/errors.js";
import {
   DataSet,
   HEADER_END,
   TruncatedBuffer,
   validateHeader,
   validatePreamble,
   parse,
} from "../parse/parse.js";

export type Ctx = {
   first: boolean;
   dataSet: DataSet;
   dataSetStack: DataSet[];
   truncatedBuffer: Buffer;
   bufWatermark: number;
   lastTagStart: number;
   totalBytes: number;
   path: string;
   nByteArray: number;
   skipPixelData: boolean;
   transferSyntaxUid: TransferSyntaxUid;
   usingLE: boolean;
   inSequence?: boolean;
   currSqTag?: string;
   currSqLen?: number;
   sequenceBytesTraversed?: number; // TODO make sure we are resetting this at the end of each SQ parse.
};

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
export function streamParse(
   path: string,
   cfg: Global.Cfg = null,
   skipPixelData = true
): Promise<DataSet> {
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
function isSupportedTSN(uid: string): uid is TransferSyntaxUid {
   return Object.values(TransferSyntaxUid).includes(uid as TransferSyntaxUid);
}

/**
 * handleDicomBytes() is a helper function for streamParse()
 * to handle the logic of reading a new buffer from disk, and
 * stitching it to the previous bytes where required.
 * @param ctx
 * @param currBytes
 * @returns TruncatedBuffer (byte[])
 */
export function handleDicomBytes(
   ctx: Ctx,
   currBytes: Buffer
): {
   returnReason: string;
   truncatedBuffer: TruncatedBuffer;
} {
   const { path, nByteArray } = ctx;

   write(`Reading buffer (#${nByteArray} - ${currBytes.length} bytes) (${path})`, "DEBUG");

   if (ctx.first) {
      return handleFirstBuffer(ctx, currBytes);
   } else {
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
function handleFirstBuffer(
   ctx: Ctx,
   buffer: Buffer
): {
   returnReason: string;
   truncatedBuffer: TruncatedBuffer;
} {
   validatePreamble(buffer); // throws if not void
   validateHeader(buffer); // throws if not void

   buffer = buffer.subarray(HEADER_END, buffer.length); // window the buffer beyond 'DICM' header
   const parseResponse = parse(buffer, ctx);
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

/**
 * ctxFactory() is a factory function for creating a Ctx
 * with default values for the first buffer read from disk.
 * @param path
 * @param skipPixels
 * @returns Ctx
 */
export function ctxFactory(
   path: string,
   cfg = null,
   assumeDefaults = true,
   skipPixels = true
): Ctx {
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
   } else {
      return {
         ...cfg,
         path,
      };
   }
}
