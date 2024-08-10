import test from "node:test";
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

   const testDirs = {
      noNestedSQ_multipleItemsInsideSQ_undefinedLengthSQ_undefinedLengthItems:
         "../data/with_1-depthSQ_multiple_items_undefined_SQlen_undefinedItemLen",

      noNestedSQ_singleItemsInsideSQ_undefinedLengthSQ_undefinedLengthItems:
         "../data/with_1-depth_sequences_undefinedSQlen_undefinedItemlen",

      nestedSQ_singleItemsInsideSQ_definedLengthSQ_definedLengthItems: "../data/Pi", // not working because haven't implemented handling for SQ's with defined lengths
   };

   cfg.targetDir = testDirs.noNestedSQ_multipleItemsInsideSQ_undefinedLengthSQ_undefinedLengthItems; // erroring with out of bounds :
   // uncaughtException RangeError [ERR_OUT_OF_RANGE]: The value of "offset" is out of range. It must be >= 0 and <= 464. Received 470
   // at boundsError (node:internal/buffer:88:9)
   // at Buffer.readUInt32LE (node:internal/buffer:222:5)
   // at _decodeValueLength (file:///Users/chriskennedy/Desktop/SWE/aesirax/TS/dist/parse/parse.js:321:18)
   // at decodeValueLengthAndMoveCursor (file:///Users/chriskennedy/Desktop/SWE/aesirax/TS/dist/parse/parse.js:270:9)

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
