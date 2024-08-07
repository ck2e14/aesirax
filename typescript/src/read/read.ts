import { write } from "../logging/logQ.js";
import { DicomErrorType, TransferSyntaxUid } from "../globalEnums.js";
import { createReadStream } from "fs";
import { TagStr } from "../parse/tagNums.js";
import { DicomError, UnsupportedTSN } from "../error/errors.js";
import {
   DataSet,
   HEADER_END,
   PartialTag,
   validateHeader,
   validatePreamble,
   parse,
} from "../parse/parse.js";

export type StreamBundle = {
   firstBytes: boolean;
   dataSet: DataSet;
   partialTag: Buffer;
   perBufMax: number;
   totalBytes: number;
   path: string;
   nByteArray: number;
   skipPixelData: boolean;
   transferSyntaxUid: TransferSyntaxUid;
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
export function streamParse(path: string, skipPixelData = true): Promise<DataSet> {
   const bundle = bundleFactory(path, null, true, skipPixelData);

   if (bundle.perBufMax < HEADER_END + 1) {
      throw new DicomError({
         message: `PER_BUF_MAX must be at least ${HEADER_END + 1} bytes.`,
         errorType: DicomErrorType.BUNDLE_CONFIG,
      });
   }

   if (bundle.perBufMax < SMALL_BUF_THRESHOLD) {
      write(SMALL_BUF_ADVISORY, "WARN");
   }

   return new Promise<DataSet>((resolve, reject) => {
      const stream = createReadStream(path, {
         highWaterMark: bundle.perBufMax,
      });

      stream.on("data", (currBytes: Buffer) => {
         write(`Received ${currBytes.length} bytes from ${path}`, "DEBUG");
         bundle.nByteArray = bundle.nByteArray + 1;
         bundle.totalBytes = bundle.totalBytes + currBytes.length;
         bundle.partialTag = handleDicomBytes(bundle, currBytes); // update partialTag with any partially read tag from current buffer
      });

      stream.on("end", () => {
         write(`Finished: read a total of ${bundle.totalBytes} bytes from ${path}`, "DEBUG");
         write(`Parsed ${Object.keys(bundle.dataSet).length} elements from ${path}`, "DEBUG");
         resolve(bundle.dataSet);
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
 * @param bundle
 * @param currBytes
 * @returns PartialTag (byte[])
 */
export function handleDicomBytes(bundle: StreamBundle, currBytes: Buffer): PartialTag {
   const { path, nByteArray } = bundle;

   write(`Reading buffer (#${nByteArray} - ${currBytes.length} bytes) (${path})`, "DEBUG");

   if (bundle.firstBytes) {
      return handleFirstBuffer(bundle, currBytes);
   } else {
      const stichedBuffer = stitchBytes(bundle, currBytes);
      return parse(stichedBuffer, bundle);
   }
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
 * @returns PartialTag (byte[])
 */
function handleFirstBuffer(bundle: StreamBundle, buffer: Buffer): PartialTag {
   validatePreamble(buffer); // throws if not void
   validateHeader(buffer); // throws if not void

   // window the buffer beyond 'DICM' header
   buffer = buffer.subarray(HEADER_END, buffer.length);

   const partialElement = parse(buffer, bundle);
   const tsn = getElementValue<string>("(0002,0010)", bundle.dataSet);
   // no need to accomodate TSN not present in the first buffer because put a
   // a hard-lock on the min size of buffers to avoid unnecessary complexity

   if (tsn && !isSupportedTSN(tsn)) {
      throw new UnsupportedTSN(`TSN: ${tsn} is unsupported.`);
   } else if (isSupportedTSN(tsn)) {
      bundle.transferSyntaxUid = tsn ?? TransferSyntaxUid.ExplicitVRLittleEndian;
      bundle.firstBytes = false;
      return partialElement;
   }
}

/**
 * stitchBytes() is a helper function for handleDicomBytes()
 * to concatenate the partial tag bytes with the current bytes
 * @param partialTag
 * @param currBytes
 * @returns Buffer
 */
function stitchBytes(bundle: StreamBundle, currBytes: Buffer): Buffer {
   const { partialTag, path } = bundle;
   write(`Stitching ${partialTag.length} + ${currBytes.length} bytes (${path})`, "DEBUG");
   return Buffer.concat([partialTag, currBytes]);
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
function getElementValue<T = unknown>(tag: TagStr, elements: DataSet): T {
   return (elements[tag]?.value ?? "NOT FOUND") as T;
}

/**
 * bundleFactory() is a factory function for creating a StreamBundle
 * with default values for the first buffer read from disk.
 * @param path
 * @param skipPixels
 * @returns
 */
function bundleFactory(
   path: string,
   opts = null,
   assumeDefaults = true,
   skipPixels = true
): StreamBundle {
   if (assumeDefaults) {
      return {
         firstBytes: true,
         dataSet: {},
         partialTag: Buffer.alloc(0),
         perBufMax: Number(process.env.PER_BUF_MAX ?? 1024 * 12),
         totalBytes: 0,
         path,
         nByteArray: 0,
         skipPixelData: skipPixels,
         transferSyntaxUid: TransferSyntaxUid.ExplicitVRLittleEndian,
      };
   } else {
      return {
         ...opts,
         path,
      };
   }
}
