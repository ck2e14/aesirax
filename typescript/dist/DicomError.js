export class DicomError extends Error {
    constructor({ errorType, message, buffer }) {
        super(message);
        this.name = `DicomError: ${errorType}`;
        this.stack = new Error(message).stack;
        this.buffer = buffer;
        console.log(this);
    }
}
//# sourceMappingURL=dicomError.js.map