import { cfg, init } from "./init/init.js";
import { write } from "./logging/logQ.js";
import { multiThreaded } from "./multithreaded.js";
import { singleTheaded } from "./singlethreaded.js";
import { readdirSync } from "node:fs";

const testDirs = {
   // no nested SQs
   noNestedSQ_multipleItemsInsideSQ_undefinedLengthSQ_undefinedLengthItems:
      "../data/with_1-depthSQ_multiple_items_undefined_SQlen_undefinedItemLen", // 102 elements
   noNestedSQ_singleItemsInsideSQ_undefinedLengthSQ_undefinedLengthItems:
      "../data/with_1-depth_sequences_undefinedSQlen_undefinedItemlen", // 130 elements

   // nested SQs
   nestedSQ_singleItemsInsideSQ_definedLengthSQ_definedLengthItems: "../data/Pi",
   nestedSQ_undefinedLens_multipleItems:
      "/Users/chriskennedy/Desktop/SWE/aesirax/data/QUANTREDEUSIX", // 111
   nestedSQ_undefinedLens_multipleItems2:
      "/Users/chriskennedy/Desktop/SWE/aesirax/data/CUMMINSMARJORIE",

   // other
   x: "../data/x", // 115 elements
   turkey: "../data/turkey", // 51 elements
};

/**
 * Main entry point for the application.
 * Initializes the application, runs the
 * multi-threaded and/or single-threaded
 * DICOM parsing, and shuts down the application.
 *
 * @param cfg
 * @returns void
 */
async function main(cfg: Global.Cfg) {
   if (cfg.verbose) {
      write(`Starting up...`, "INFO");
   }

   await init();

   // cfg.targetDir = testDirs.nestedSQ_undefinedLens_multipleItems;
   cfg.targetDir = testDirs.nestedSQ_undefinedLens_multipleItems;
   // cfg.targetDir = '/Users/chriskennedy/Desktop/SWE/aesirax/data/STANWORTHLORNAMISS/SER00001'
   const fileCount = readdirSync(cfg.targetDir).length;

   if (fileCount === 0) {
      write(`No files found in target directory. Exiting...`, "ERROR");
      process.exit();
   }

   if (fileCount > 1) {
      await multiThreaded(cfg);
   }

   if (fileCount === 1) {
      await singleTheaded(cfg);
   }

   setTimeout(() => {
      if (cfg.verbose) {
         write(`Completed work - shutting down.`, "INFO");
      }
      process.exit(); // make this robust but its basically always fine but better to check q length
   }, 2_000); // Wait for logs to finish writing
}

main(cfg);
