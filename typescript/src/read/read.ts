import { DicomError } from "../error/dicomError.js";
import { write } from "../logging/logQ.js";
import { DicomErrorType } from "../globalEnums.js";
import { createReadStream } from "fs";
import {
   DICOM_HEADER_END,
   Element,
   PartialTag,
   validateDicomHeader,
   walk,
} from "../parse/parse.js";

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
export function streamParse(path: string): Promise<Element[]> {
   const dataset: Element[] = [];
   const streamOpts = { highWaterMark: 512 }; // small buffer to enforce multiple bytess to test truncation logic
   const dicomStream = createReadStream(path, streamOpts);

   let n = 0;
   let totalLen = 0;
   let firstBytes = true;
   let partialTag: PartialTag = Buffer.alloc(0);

   return new Promise<Element[]>((resolve, reject) => {
      dicomStream.on("data", (bytes: Buffer) => {
         totalLen += bytes.length;
         partialTag = handleNewbytes(++n, bytes, path, partialTag, dataset, firstBytes); // update partialTag with any unfinished tag from walk()'s last invocation
         firstBytes = false;
      });

      dicomStream.on("error", error => {
         reject(DicomError.from(error, DicomErrorType.READ));
      });

      dicomStream.on("close", () => {
         write(`Read a total of ${totalLen} bytes from ${path}`, "DEBUG");
         resolve(dataset);
      });
   });
}

/**
 * handleNewbytes() is a helper function for streamParse()
 * to handle the logic of reading a new bytes from disk, and
 * stitching it to the previous bytes where required.
 *
 * @param n
 * @param bytes
 * @param path
 * @param partialTag
 * @param dataset
 * @param firstBytes
 * @returns
 */
function handleNewbytes(
   n: number,
   bytes: Buffer,
   path: string,
   partialTag: Buffer,
   dataset: Element[],
   firstBytes = false
): PartialTag {
   write(`Reading next stream buffer (#${n} - ${bytes.length} bytes) (${path})`, "DEBUG");

   if (firstBytes) {
      validateDicomHeader(bytes);
      bytes = bytes.subarray(DICOM_HEADER_END, bytes.length); // window beyond the DICOM header
   }

   if (partialTag.length > 0) {
      write(`Stitching: ${partialTag.length} + ${bytes.length} bytes ${path}`, "DEBUG");
   }

   // if there are partial tag bytes, stich them in front
   // of the current bytes. We initialise it as a 0-length
   // buffer, so it will not stictch any data on 1st invocation.
   const stitchedBytes = Buffer.concat([partialTag, bytes]);
   const partialTagOrNull = walk(stitchedBytes, dataset);

   return partialTagOrNull;
}
