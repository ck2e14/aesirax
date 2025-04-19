import { DicomError } from "../errors.js";
import { HEADER_START, PREAMBLE_LEN, PREFIX, PREFIX_END } from './constants.js'
import { DicomErrorType } from "../enums.js";
import { Cursor } from "./cursor.js";


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

