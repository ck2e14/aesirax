import { write } from "../logging/logQ.js";

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
         // Append the original stack trace if it exists
         this.stack = `${this.stack}\nCaused by: ${originalStack}`;
      }
      write(`Error: ${this.name} - ${message} - ${this.stack}`, "ERROR");
   }

   public static from(error: Error): InitError {
      if (error instanceof InitError) return error;
      return new InitError(error.message, error.stack);
   }
}
