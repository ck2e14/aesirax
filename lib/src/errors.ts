import { DicomErrorType } from "./enums.js";
import { Parse } from "./global.js";
import { write } from "./logging/logQ.js";

type Args = {
  errorType: DicomErrorType;
  message: string;
  buffer?: Buffer;
  originalStack?: string;
};

/**
 * DicomError is a custom error class for handling errors
 * that occur during the reading, parsing, and validation
 * of DICOM files.
 * @param errorType
 * @param message
 * @param buffer
 */
export class DicomError extends Error {
  public readonly buffer?: Buffer;

  constructor({ errorType, message, buffer, originalStack }: Args) {
    super(message);
    this.name = `DicomError: ${errorType}`;
    this.buffer = buffer;

    if (originalStack) {
      this.stack = `${this.stack}\nCaused by: ${originalStack}`;
    }

    write(`Error: ${this.name} - ${message} - ${this.stack}`, "ERROR");
  }

  /**
   * Use this in catch blocks where we aren't sure what instance
   * type is being thrown but we want to establish a boundary
   * within which all errors should be classified as DicomErrors.
   * @param error
   * @returns {DicomError}
   */
  public static from(error: Error, errorType?: DicomErrorType): DicomError {
    if (error instanceof DicomError) return error;
    return new DicomError({
      errorType: DicomErrorType.UNKNOWN,
      message: error.message,
      originalStack: error.stack,
    });
  }
}

/**
 * Error thrown when a boundary is assumed to be reached.
 * It is possible that this is not always the case but
 * if we expect say 4 bytes and only get 2, then the possible
 * reasons are that the current buffer is truncated or that
 * the entire DICOM file is truncated. So we should test whether
 * there are any further expected buffers to come and if not then
 * this is not the correct error to throw.
 * @param message
 */
export class BufferBoundary extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BufferBoundary";
  }
}

export class UnrecognisedVR extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnrecognisedVR";
  }
}

export class Unrecoverable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Unrecoverable";
  }
}

/**
 * InitError is a custom error class to reflect errors that occur
 * during the initialisation of the application.
 * @param message
 * @param originalStack
 */
export class InitError extends Error {
  constructor(message: string, originalStack?: string) {
    super(message);
    this.name = "InitError";
    if (originalStack) {
      this.stack = `${this.stack}\nCaused by: ${originalStack}`;
    }
    write(`Error: ${this.name} - ${message} - ${this.stack}`, "ERROR");
  }

  public static from(error: Error): InitError {
    if (error instanceof InitError) return error;
    return new InitError(error.message, error.stack);
  }
}

export class UnsupportedTSN extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedTSN";
  }
}

export class UndefinedLength extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UndefinedLength";
  }
}

export class Malformed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Malformed";
  }
}

/**
 * Throw an error if the buffer did not decode to a 4 hex character string.
 * @param buf
 * @throws DicomError
 */
export function throwBadHexPattern(buf: Buffer, str: string): never {
  throw new DicomError({
    errorType: DicomErrorType.PARSING,
    message: `decodeTag() decoded to an unexpected hexPattern: ${str}`,
    buffer: buf,
  });
}

/**
 * Handle errors that occur during the parsing of a DICOM file. If
 * the error is unrecoverable then throw it, otherwise return the
 * partialled tag in bytes to be stitched to the next buffer.
 *
 * 'Partialled' is for handling stitching across streamed buffers'
 * boundaries, parsing error is for when the parser is unable to
 * handle for some other reason.
 *
 * Truncated SQ stitching works by throwing in the child depth
 * and catching in the parent. So we pop() & pass buffer back to
 * read() from the start of the SQ.
 *
 * @param error
 * @param buffer
 * @param lastTagStart
 * @throws Error
 * @returns PartialEl
 */
export function handleEx(
  error: any,
  buffer: Buffer,
  lastTagStart: number,
  tag?: Parse.TagStr
): Parse.PartialEl {

  const isUndefinedLength = error instanceof UndefinedLength;
  const parsingError = [BufferBoundary, RangeError].every(errType => !(error instanceof errType)); // i.e. not a buffer truncation error

  if (parsingError && !isUndefinedLength) {
    write(`Error parsing tag ${tag ?? ""}: ${error.message}`, "ERROR");
    throw error;
  }

  if (error instanceof BufferBoundary || error instanceof RangeError) {
    write(`Tag is split across buffer boundary ${tag ?? ""}`, "DEBUG");
    write(`Last tag was at cursor position: ${lastTagStart}`, "DEBUG");
    return buffer.subarray(lastTagStart, buffer.length);
  }
}


