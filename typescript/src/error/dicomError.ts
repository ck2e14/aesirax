import { write } from "../logging/logQ.js";

type Args = {
   errorType: Errors.DicomErrorType;
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
    * within which errors should be classified as DicomErrors.
    * @param error
    * @returns {DicomError}
    */
   public static from(error: Error, errorType?: Errors.DicomErrorType): DicomError {
      if (error instanceof DicomError) return error;
      return new DicomError({
         errorType: Errors.DicomErrorType.UNKNOWN,
         message: error.message,
         originalStack: error.stack,
      });
   }
}
