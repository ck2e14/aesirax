import { DicomErrorType } from "../enums.js";
import { write } from "../logging/logQ.js";

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
