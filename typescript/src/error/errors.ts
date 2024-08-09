import { DicomErrorType } from "../globalEnums.js";
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
export class BufferBoundaryError extends Error {
   constructor(message: string) {
      super(message);
      this.name = "BufferBoundaryError";
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
 * during the initialization of the application.
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
   // Some SQs don't define a length (fucking stupid) so this misparses.
   // There is probably a better way to reliably detect this but so far
   // I've discovered that it parses to max 32-bit integer. These types of
   // SQ rely on ItemDelimitationItems for parsers to infer the end of the
   // sequence. I'm not going to handle that right now, we can stretch for
   // that in future.

   // Note that the DICOM committee has met to consider removing this feature
   // because it's the brainchild of a mental patient and stupid but it's
   // now hella fucking legacy code and would invalidate an asbolute shitload
   // of DICOM. I can't explain why modern image generation is still leaning
   // on it though, that's absolutely ridiculous for devs writing parsing code.

   // When i do inevitably fucking implement this, the approach will be:
   //  - Check for the undefined length value (i.e. max 32 bit int size)
   //  - If encountered, start parsing items within the sequence
   //  - Continue until you reach a Sequence Delimitation Item (tag (FFFE,E0DD))

   // alright i implemented it :) only thing left to do on it is to use a stack
   // so i can support 1-n nested sequences within sequences. Currently overwriting
   // the shared context vars so it persists whatever the deepest sequence is as
   // one level deep (so the recursion works fine just not the storage, LIFO to fix).
   constructor(message: string) {
      super(message);
      this.name = "UndefinedLength";
   }
}

export class MalformedDicomError extends Error {
   constructor(message: string) {
      super(message);
      this.name = "MalformedDicomError";
   }
}
