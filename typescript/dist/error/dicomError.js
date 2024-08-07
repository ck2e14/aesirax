import { write } from "../logging/logQ.js";
/**
 * DicomError is a custom error class for handling errors
 * that occur during the reading, parsing, and validation
 * of DICOM files.
 * @param errorType
 * @param message
 * @param buffer
 */
export class DicomError extends Error {
    constructor({ errorType, message, buffer, originalStack }) {
        super(message);
        this.name = `DicomError: ${errorType}`;
        this.buffer = buffer;
        if (originalStack) {
            this.stack = `${this.stack}\nCaused by: ${originalStack}`;
        }
        write(`Error: ${this.name} - ${message} - ${this.stack}`, "ERROR");
    }
}
//# sourceMappingURL=dicomError.js.map