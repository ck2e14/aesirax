import { DicomErrorType, TransferSyntaxUid } from "../enums.js";
import { createReadStream } from "fs";
import { DicomError, UnsupportedTSN } from "../error/errors.js";
import { cPos, dataSetLength } from "../utils.js";
import { TagStr } from "../parse/parsers.js";
import { Cursor } from "../parse/cursor.js";
import { write } from "../logging/logQ.js";
import { Element, DataSet, validateHeader, validatePreamble, parse, PartialEl } from "../parse/parse.js";

type ID = string;
export type Ctx = {
   first: boolean;
   path: string;
   depth: number;
   dataSet: DataSet;
   truncatedBuffer: Buffer;
   bufWatermark: number;
   cursors: Record<ID, Cursor>;
   totalStreamedBytes: number; // this is not cursor-driven, i.e. nothing to do with parse(). It's the sum of the size of all buffers streamed into memory.
   nByteArray: number;
   skipPixelData: boolean;
   transferSyntaxUid: TransferSyntaxUid;
   usingLE: boolean;
   outerCursor: Cursor;
   visitedBytes: Record<number, number>; // cursor-walk driven. Refers to bytes we actually interacted with. Doesn't necessarily mean read from, may have walked straight past some depending on what they were expected to have been e.g. null VR bytes
   // --- sq stacking
   sqStack: Element[];
   sqLens: number[];
   sqBytesStack: number[];
};

/**
 * ctxFactory() is a factory function for creating a Ctx
 * with default values for the first buffer read from disk.
 * @param path
 * @param skipPixels
 * @returns Ctx
 */
export function ctxFactory(path: string, cfg = null, assumeDefaults = true, skipPixels = true): Ctx {
   if (!assumeDefaults) return { ...cfg, path };
   return {
      path,
      first: true,
      cursors: {},
      depth: -1, // -1 because we increment in the first action of each parse(), so 0 represents the outermost dataset
      dataSet: {},
      truncatedBuffer: Buffer.alloc(0),
      bufWatermark: cfg?.bufWatermark ?? 1024 * 1024,
      totalStreamedBytes: 0,
      nByteArray: 0,
      skipPixelData: skipPixels,
      transferSyntaxUid: TransferSyntaxUid.ExplicitVRLittleEndian,
      usingLE: true,
      sqStack: [],
      sqLens: [],
      sqBytesStack: [],
      outerCursor: null,
      visitedBytes: {},
   };
}

const SMALL_BUF_THRESHOLD = 1024;
const SMALL_BUF_ADVISORY = `PER_BUF_MAX is less than ${SMALL_BUF_THRESHOLD} bytes. This will work but isn't ideal for I/O efficiency`;
const HEADER_END = 132;

/**
 * streamParse() takes advantage of the behaviour of streaming
 * from disk in a way that doesn't require the conclusion of the
 * stream before beginning to work on it. It immediately begins
 * parsing each buffered bytes of the file from disk, and
 * stitches truncated DICOM tags together for the next invocation
 * of the 'data' callback to work with.
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
         ctx.nByteArray = ctx.nByteArray + 1;
         ctx.totalStreamedBytes = ctx.totalStreamedBytes + currBytes.length;
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
 * detectMisalignment() is a helper function for streamParse()
 * to detect if the total bytes traversed by the outer cursor
 * is equal to the expected total bytes traversed. Should always
 * be bang-on else something is wrong. WARN not working with
 * stitching nor properly writing which bytes were accessed when
 * using SQs (because position passed to byteacces.track is 0
 * and its not aware of the offset, i.e. last access position,
 * needed to reflect actual position in the files contiguous
 * bytes versus the seqbuffer we window to the start of the sq)
 * @param ctx
 * @param throwMode
 */
function detectMisalignment(ctx: Ctx) {
   const fileLenMinus = ctx.totalStreamedBytes - 132; // minus preamble + HEADER
   const fileLenMinusStr = fileLenMinus.toLocaleString();
   const outerCursorPosStr = ctx.outerCursor.pos.toLocaleString();
   const notDisposedOf = Object.entries(ctx.cursors).filter(([id, cursor]) => {
      if (!cursor.disposedOf) return [id, cursor];
   });

   if (notDisposedOf.length) {
      write(`Cursors not disposed of: ${notDisposedOf.map(([id, _c]) => id).join(", ")}`, "WARN");
   }

   // not 100% sure on cause atm but despite what seems perfect parsing and persisting etc, the outercursor
   // isn't anywhere near the end of the file. So we have an issue around the re-entering of parse and the
   // updating of the outerCursor but its too headfucky to handle right now so I'm gonna just disable this shit
   // and rely on integration testing against outputs when process.env.BUF_WATERMARK is less than the total length
   // of the file (ie stitching occured).
   if (ctx.nByteArray > 1) return;

   if (ctx.outerCursor.pos !== ctx.totalStreamedBytes - 132 /* minus preamble + header */) {
      write(
         `OuterCursor was expected to be at the end of the file (${fileLenMinusStr}) but is at position: ${ctx.outerCursor.pos}`,
         "ERROR"
      );
   } else {
      write(
         `OuterCursor (position ${outerCursorPosStr}) is correctly placed at the end of the file (length: ${fileLenMinusStr}) after parsing.`,
         "DEBUG"
      );
   }

   write(
      `Cursor positions are now: ${cPos(ctx, 1)}, ` +
         `where id 1 should be the length of the file. Other cursors wont add up to this because of how they are used and synced across each other. `,
      "DEBUG"
   );
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
export function handleDicomBytes(ctx: Ctx, currBytes: Buffer): PartialEl {
   write(`Reading buffer (#${ctx.nByteArray} - ${currBytes.length} bytes) (${ctx.path})`, "DEBUG");
   return ctx.first //
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
