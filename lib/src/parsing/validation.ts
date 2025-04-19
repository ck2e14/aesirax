import { DicomError } from "../errors.js";
import { HEADER_START, PREAMBLE_LEN, PREFIX, PREFIX_END } from './constants.js'
import { DicomErrorType } from "../enums.js";
import { Cursor } from "./cursor.js";
import { TransferSyntaxUid } from "../enums.js";
import { write } from "../logging/logQ.js";
import { Ctx } from "../parsing/ctx.js";
import { cPos } from "../utils.js";

// This file is for validating file i/o interactions only - not 
// to carry out interactions itself. E.g. check cursor walking 
// performed faultlessly through the various parsing/*.ts modules.

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
export function detectMisalignment(ctx: Ctx) {
  const fileLenMinus = ctx.totalStreamedBytes - 132; // minus preamble + HEADER
  const fileLenMinusStr = fileLenMinus.toLocaleString();
  const outerCursorPosStr = ctx.outerCursor.pos.toLocaleString();
  const notDisposedOf = Object.entries(ctx.cursors).filter(([_, cursor]) => !cursor.disposedOf)

  if (notDisposedOf.length) {
    write(`Cursors not disposed of: ${notDisposedOf.map(([id, _cursor]) => id).join(", ")}`, "WARN");
  }

  if (ctx.nByteArray > 1) {
    return;
  }

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
export function isSupportedTSN(uid: string): uid is TransferSyntaxUid {
  return Object.values(TransferSyntaxUid).includes(uid as TransferSyntaxUid);
}

/**
 * True if there are walkable bytes left in the buffer
 * @param buffer
 * @param cursor
 * @returns number
 */
function bytesLeft(buffer: Buffer, cursor: number): number {
  return buffer.length - cursor;
}

/**
 * Assess whether there are enough bytes left in the buffer to
 * decode the next tag. If not, return the truncated tag. Saves
 * redundant work and allows early return in parse() to pass back
 * a buffer to be stitched to the next streamed buffer.
 * @param buffer
 * @param cursor
 * @param elementLen
 * @returns boolean
 */
export function valueIsTruncated(buffer: Buffer, cursor: Cursor, elementLen: number): boolean {
  // if(elementLen === MAX_UINT32) return false; kinda think this is
  // required but havent got time to test it right now
  return elementLen > bytesLeft(buffer, cursor.pos);
}

/**
 * Validate the DICOM preamble by checking that the first 128 bytes
 * are all 0x00. This is a security design choice to prevent
 * the execution of arbitrary code within the preamble. See spec notes.
 * @param buffer
 * @throws DicomError
 */
export function validatePreamble(buffer: Buffer): void | never {
  const start = 0;
  const end = PREAMBLE_LEN;
  const preamble = buffer.subarray(start, end);

  if (!preamble.every(byte => byte === 0x00)) {
    throw new DicomError({
      errorType: DicomErrorType.VALIDATE,
      message: `DICOM file must begin with contain 128 bytes of 0x00 for security reasons. Quarantining this file`,
    });
  }
}

/**
 * Validate the DICOM PRFEFIX by checking for the 'magic word'.
 * A DICOM file should contain the 'magic word' "DICM" at bytes 128-132.
 * Preamble is 128 bytes of 0x00, followed by the 'magic word' "DICM".
 * Preamble may not be used to determine that the file is DICOM.
 * @param byteArray
 * @throws DicomError
 */
export function validateHeader(buffer: Buffer): void | never {
  const strAtHeaderPosition = buffer //
    .subarray(HEADER_START, PREFIX_END)
    .toString();

  if (strAtHeaderPosition !== PREFIX) {
    throw new DicomError({
      errorType: DicomErrorType.VALIDATE,
      message: `DICOM file does not contain 'DICM' at bytes 128-132. Found: ${strAtHeaderPosition}`,
      buffer: buffer,
    });
  }
}
