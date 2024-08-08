import { cfg, init } from "./init/init.js";
import { write } from "./logging/logQ.js";
import { multiThreaded } from "./multithreaded.js";
import { singleTheaded } from "./singlethreaded.js";

/**
 * Main entry point for the application.
 * Initializes the application, runs the
 * multi-threaded and/or single-threaded
 * DICOM parsing, and shuts down the application.
 *
 * @param cfg
 * @returns void
 */
(async function main(cfg: Global.Config) {
   if (cfg.verbose) {
      write(`Starting up...`, "INFO");
   }

   cfg.targetDir = "/Users/chriskennedy/Desktop/aesirax/data/isolat";

   await init();
   // await multiThreaded(cfg);
   await singleTheaded(cfg);

   setTimeout(() => {
      if (cfg.verbose) {
         write(`Completed work - shutting down.`, "INFO");
      }
      process.exit();
   }, 2_000); // Wait for logs to finish writing
})(cfg);
