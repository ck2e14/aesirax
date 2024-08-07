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
}
