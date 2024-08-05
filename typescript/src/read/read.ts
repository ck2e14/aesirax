import { DicomError } from "../error/dicomError.js";
import { write } from "../logging/logQ.js";
import { ByteLen, DicomErrorType, VR } from "../globalEnums.js";
import { createReadStream } from "fs";
import { decodeTagNum } from "../parse/tagNums.js";
import { decodeValue, decodeVr } from "../parse/valueDecoders.js";
import { isVr } from "../parse/typeGuards.js";
import {
   DICOM_HEADER_END,
   Elements,
   PartialTag,
   validateDicomHeader,
   walk,
} from "../parse/parse.js";

type ReadDicom = {
   buf: Buffer;
   len: Number;
};

/**
 * Unlike readDicom() this takes advantage of the behaviour of
 * streams in a way that doesn't require the conclusion of the
 * stream before beginning to work on it. It immediately begins
 * parsing each buffered byteArray of the file from disk, and stitches
 * truncated DICOM tags together for the next invocation of the 'data'
 * callback to work with.
 *
 * @param path
 * @returns Promise<Elements>
 * @throws DicomError
 */
export function streamParse(path: string): Promise<Elements> {
   const elements: Elements = [];
   const streamOpts = { highWaterMark: 1024 }; // small buffer to enforce multiple byteArrays to test truncation logic
   const dicomStream = createReadStream(path, streamOpts);

   let firstByteArray = true;

   return new Promise<Elements>((resolve, reject) => {
      let n = 0;
      let totalLen = 0;
      let partialTagBuf: PartialTag = null;

      dicomStream.on("data", (byteArray: Buffer) => {
         n++;
         totalLen += byteArray.length;

         write(`Reading #${n} byteArray, ${byteArray.length} bytes (${path})`, "DEBUG");

         if (firstByteArray) {
            validateDicomHeader(byteArray);
            byteArray = byteArray.subarray(DICOM_HEADER_END, byteArray.length); // walk() expects removal of preamble + header
            firstByteArray = false;
         }

         // if there's nothing to stitch, walk the byte array &
         // assign null or a subset of bytes to truncated.
         // else stitch to the current byte array before walking.
         if (!partialTagBuf) {
            partialTagBuf = walk(byteArray, elements);
            return;
         } else {
            write(`Stitch: ${partialTagBuf.length} + ${byteArray.length} bytes ${path}`, "DEBUG");
            const stitchedBytes = Buffer.concat([partialTagBuf, byteArray]);
            partialTagBuf = walk(stitchedBytes, elements);
         }
      });

      dicomStream.on("error", error => {
         reject(DicomError.from(error, DicomErrorType.READ));
      });

      dicomStream.on("close", () => {
         write(`Read a total of ${totalLen} bytes from ${path}`, "DEBUG");
         resolve(elements);
      });
   });
}
