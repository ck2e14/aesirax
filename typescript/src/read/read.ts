import { write } from "../logging/logQ.js";
import { DicomErrorType, TransferSyntaxUid } from "../globalEnums.js";
import { createReadStream, readFileSync } from "fs";
import {
   DICOM_HEADER_END,
   Element,
   Elements,
   PartialTag,
   validateDicomHeader,
   validateDicomPreamble,
   walk,
} from "../parse/parse.js";
import { TagStr } from "../parse/tagNums.js";
import { DicomError, UnsupportedTSN } from "../error/errors.js";

type DataSet = Record<string, Element>;

export type StreamBundle = {
   firstBytes: boolean;
   dataSet: Elements;
   _dataSet: Record<string, Element>;
   partialTag: Buffer;
   perBufMax: number;
   totalBytes: number;
   path: string;
   nByteArray: number;
   skipPixelData: boolean;
   transferSyntaxUid: string;
};

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
   const bundle: StreamBundle = {
      dataSet: new Map<TagStr, Element>(),
      _dataSet: {}, // undecided whether map or obj is better, obj is more compatible with JSON and IPC but Map is more efficient for access
      partialTag: Buffer.alloc(0),
      perBufMax: Number(process.env.PER_BUF_MAX ?? 1024 * 12), // default to 12KB
      firstBytes: true,
      path: path,
      nByteArray: 0,
      totalBytes: 0,
      skipPixelData, // TODO
      transferSyntaxUid: TransferSyntaxUid.ExplicitVRLittleEndian, // file meta info always in this TSN and we update it if we find a different one
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
         write(`Parsed ${bundle.dataSet.size} elements from ${path}`, "DEBUG");
         resolve(bundle._dataSet);
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
      return walk(stichedBuffer, bundle);
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
   validateDicomPreamble(buffer); // throws if not void
   validateDicomHeader(buffer); // throws if not void

   buffer = buffer.subarray(DICOM_HEADER_END, buffer.length); // window the buffer beyond 'DICM' header

   const truncatedElement = walk(buffer, bundle);
   const tsn = getElementValue<string>("(0002,0010)", bundle.dataSet);

   if (tsn && !isSupportedTSN(tsn)) {
      // no need to accomodate this not being the first buffer because we're going to put
      // a hard-lock on the miniumum size of the first buffer to avoid unnecessary complexity
      throw new UnsupportedTSN(`TSN: ${tsn} is unsupported.`);
   }

   bundle.transferSyntaxUid = tsn ?? TransferSyntaxUid.ExplicitVRLittleEndian;
   bundle.firstBytes = false;

   return truncatedElement;
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
function getElementValue<T = unknown>(tag: TagStr, elements: Elements): T {
   return elements.get(tag).val as T;
}
