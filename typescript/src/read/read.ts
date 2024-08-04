import { DicomError } from "../error/dicomError.js";
import { write } from "../logging/logQ.js";
import { ByteLen, DicomErrorType } from "../globalEnums.js";
import { createReadStream } from "fs";
import { decodeTagNum } from "../parse/tagNums.js";
import { decodeValue, decodeVr } from "../parse/valueDecoders.js";
import { isVr } from "../parse/typeGuards.js";
import { isExtendedFormatVr, throwUnrecognisedVr } from "../parse/parse.js";

type ReadDicom = { buf: Buffer; len: Number };
type ReadDicomPromise = Promise<ReadDicom>;
type TruncatedTag = Buffer | null;

const MAGIC_WORD = "DICM",
   PREAMBLE_LENGTH = 128,
   MAGIC_WORD_START = PREAMBLE_LENGTH,
   MAGIC_WORD_END = PREAMBLE_LENGTH + 4;

/**
 * Read a DICOM file into memory asynchronously and return a promise.
 * The promise resolves to an object containing the buffer and length.
 * Note that this function is somewhat redundant in its use of streams
 * because it only begins processing the data once the whole stream
 * has ended. So we might as well just use fs.readFile() in this case.
 * It was a starting point however for the streamParse() function which
 * is why it bothers with streams to achieve the same thing that fs.readFile()
 * would achieve.
 *
 * @param path
 * @returns Promise<ReadDicom>
 * @throws DicomError
 */
export function readDicom(path: string): ReadDicomPromise {
   let firstChunk = true;

   return new Promise<ReadDicom>((resolve, reject) => {
      const readStream = createReadStream(path);
      const bufs: Buffer[] = [];
      const res = {
         buf: Buffer.alloc(0),
         len: 0,
      };

      readStream.on("data", (chunk: Buffer) => {
         write(`Read ${chunk.length} bytes from ${path}`, "DEBUG");

         if (firstChunk) {
            validateDicomHeader(chunk);
            firstChunk = false;
         }

         bufs.push(chunk);
         res.len += chunk.length;
      });

      readStream.on("error", error => {
         reject(DicomError.from(error, DicomErrorType.READ));
      });

      readStream.on("close", () => {
         write(`Read a total of ${res.len} bytes from ${path}`, "DEBUG");
         res.buf = Buffer.concat(bufs);
         resolve(res);
      });
   });
}

/**
 * Unlike readDicom() this takes advantage of the behaviour of
 * streams in a way that doesn't require the conclusion of the
 * stream before beginning to work on it. It immediately begins
 * parsing each buffered chunk of the file from disk, and stitches
 * truncated DICOM tags together for the next invocation of the 'data'
 * callback to work with.
 */
export function streamParse(path: string) {
   let firstChunk = true;

   return new Promise<void>((resolve, reject) => {
      const readStream = createReadStream(path, {
         highWaterMark: 1024, // a small 1KB buffer to enforce multiple reads to test truncation logic
      });

      let len = 0;
      let truncatedPrevTag: TruncatedTag = null;

      readStream.on("data", (chunk: Buffer) => {
         write(`Read ${chunk.length} bytes from ${path}`, "DEBUG");
         len += chunk.length;

         if (firstChunk) {
            validateDicomHeader(chunk);
            chunk = chunk.subarray(132, chunk.length); // _walk() expects removal of non-tag byte structure
            firstChunk = false;
         }

         if (!truncatedPrevTag) {
            // if nothing to stitch, then walk the chunk as-is, and
            // assign the return value to truncatedPrevTag which will
            // either be null, or a buffer representing the truncated tag.
            truncatedPrevTag = _walk(chunk);
            write(`newTruncatedPrevTag: ${truncatedPrevTag}`, "DEBUG");
         } else {
            // but if there is something to stitch, then we need to
            // make a new buffer with that prefixed to the current chunk
            // before we can pass it to _walk(). Then we need to clear truncatedPrevTag
            // which we can do by assigning it the return value of _walk() which
            // is either a truncatedTag buffer or null.
            write(
               `Stitching previous tag to current chunk: ${truncatedPrevTag.length} + ${chunk.length} bytes`,
               "DEBUG"
            );
            truncatedPrevTag = _walk(Buffer.concat([truncatedPrevTag, chunk]));
         }
      });

      readStream.on("error", error => {
         reject(DicomError.from(error, DicomErrorType.READ));
      });

      readStream.on("close", () => {
         write(`Read a total of ${len} bytes from ${path}`, "DEBUG");
         resolve();
      });
   });
}

/**
 * Walk a buffer containing a subset of a DICOM file and parse the tags.
 * Return a buffer containing the truncated tag if the buffer is incomplete.
 * This is used to allow on-the-fly parsing of DICOM files as they are read
 * and stitching together truncated tags that span multiple chunks.
 *
 * TODO return datasets so we can compile the outputs into a single object
 * to be retained in memory whilst the garbage collector discards the buffers.
 *
 * WARN - don't pass this the preamble & header - just pass it where it can
 * immediately begin parsing tag values i.e. 132-byte offset.
 *
 * Note that currently this assumes that the DICOM itself is not malformed.
 * Because currently it just assumes that a handling error signifies the
 * truncation of the buffer which is not realistic. But for testing purposes
 * it's fine because we're working with always perfectly formed DICOMs - for now..
 *
 * @param buf
 * @returns
 */
function _walk(buf: Buffer): TruncatedTag {
   let cursor = 0;
   let lastStartedTagCursorPosition: number = null;

   while (cursor < buf.length) {
      try {
         lastStartedTagCursorPosition = cursor;

         const tagBuf = buf.subarray(cursor, cursor + ByteLen.TAG_NUM);
         const tag = decodeTagNum(tagBuf);

         cursor += ByteLen.TAG_NUM;

         const vrBuf = buf.subarray(cursor, cursor + ByteLen.VR);
         const vr = decodeVr(vrBuf);

         cursor += ByteLen.VR;

         if (!isVr(vr)) {
            throwUnrecognisedVr(vr, vrBuf);
         }

         const isExtVr = isExtendedFormatVr(vr);
         let valueLength = 0;

         if (isExtVr) {
            cursor += ByteLen.EXT_VR_RESERVED; // 2 reserved bytes can be ignored
            valueLength = buf.readUInt32LE(cursor); // Extended VR tags' lengths are 4 bytes because they can be huge
            cursor += ByteLen.UINT_32;
         }

         if (!isExtVr) {
            valueLength = buf.readUInt16LE(cursor); // Standard VR tags' lengths are 2 bytes, so max length is 0xFFFF
            cursor += ByteLen.UINT_16;
         }

         const valueBuffer = buf.subarray(cursor, cursor + valueLength);
         const decodedValue = decodeValue(vr, valueBuffer);

         if (vr !== "SQ" && vr !== "OB") {
            write(
               `Tag: ${tag}, VR: ${vr}, Length: ${valueLength}, Value: ${decodedValue}`,
               "DEBUG"
            );
         } else {
            write(`Tag: ${tag}, VR: ${vr}, Length: ${valueLength}`, "DEBUG");
         }

         cursor += valueLength;
      } catch (error) {
         // if we're here, it's because we encountered a parsing error where the byte stream
         // was truncated in the middle of a group num, or a VR, etc. So we want to return to the stream
         // handler a buffer representing the truncated tag so that it can be stitched to the next chunk.
         // We're assuming at this point in development that the error represents truncation - in reality
         // the DICOM could be malformed and the error could be a legit one but we'll handle that later.
         const remainingBytes = buf.length - lastStartedTagCursorPosition;

         if (remainingBytes === 0) {
            write(`Returning null: ${remainingBytes} tag bytes`, "DEBUG");
            return null;
         } else {
            write(`Returning truncated: ${remainingBytes} tag bytes`, "DEBUG");
            return buf.subarray(lastStartedTagCursorPosition, buf.length);
         }
      }
   }

   // if we reached here its because we didn't hit a parse error which either means:
   // (A) we truncated in the middle of a tag's VALUE (far more likely)
   // (B) we coincidentally had the end of a tag's contiguous bytes be the actual end of the current chunk
   const remainingBytes = buf.length - lastStartedTagCursorPosition;

   if (remainingBytes === 0) {
      write(`Returning null: ${remainingBytes} tag bytes`, "DEBUG");
      return null;
   } else {
      write(`Returning truncated: ${remainingBytes} tag bytes`, "DEBUG");
      return buf.subarray(lastStartedTagCursorPosition, buf.length);
   }
}

/**
 * Validate the DICOM header by checking for the magic word.
 * A DICOM file should contain the magic word "DICM" at bytes 128-132.
 * Preamble is 128 bytes of 0x00, followed by the magic word "DICM".
 * Preamble cannot be used to determine that the file is DICOM, per the spec.
 *
 * http://dicom.nema.org/medical/dicom/current/output/chtml/part10/chapter_7.html
 *
 * @param chunk
 * @throws DicomError
 */
function validateDicomHeader(chunk: Buffer): void | never {
   const expectedWordLocation = chunk //
      .subarray(MAGIC_WORD_START, MAGIC_WORD_END)
      .toString();

   if (expectedWordLocation !== MAGIC_WORD) {
      throw new DicomError({
         errorType: DicomErrorType.VALIDATE,
         message: `DICOM file does not contain magic word: ${MAGIC_WORD} at bytes 128-132. Found: ${expectedWordLocation}`,
         buffer: chunk,
      });
   }
}
