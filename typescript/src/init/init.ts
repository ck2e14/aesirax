import { InitError } from "../error/errors.js";
import { createLogFile, processQ, write } from "../logging/logQ.js";
import { config } from "./loadConfig.js";

export const cfg = config();

export async function init() {
   try {
      // TODO move this to a better place
      // TODO panic if cfg.panic
      process.on("uncaughtException", error => {
         console.log("uncaughtException", error);

         setTimeout(() => process.exit(1), 1000); // let the logQ finish writing
      });

      process.on("unhandledRejection", error => {
         console.log("unhandledRejection", error);

         setTimeout(() => process.exit(1), 1000); // let the logQ finish writing
      });

      await createLogFile();
      processQ();

      write(`Configuration loaded: ${JSON.stringify(cfg)}`, "DEBUG");
      write(`App initialized.`, "INFO");
   } catch (error) {
      throw InitError.from(error);
   }
}
