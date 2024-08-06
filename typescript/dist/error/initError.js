import { write } from "../logging/logQ.js";
/**
 * InitError is a custom error class to reflect errors that occur
 * during the initialization of the application.
 * @param message
 * @param originalStack
 */
export class InitError extends Error {
    constructor(message, originalStack) {
        super(message);
        this.name = "InitError";
        if (originalStack) {
            this.stack = `${this.stack}\nCaused by: ${originalStack}`;
        }
        write(`Error: ${this.name} - ${message} - ${this.stack}`, "ERROR");
    }
    static from(error) {
        if (error instanceof InitError)
            return error;
        return new InitError(error.message, error.stack);
    }
}
//# sourceMappingURL=initError.js.map