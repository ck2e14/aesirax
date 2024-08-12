import { cfg, init } from "./init/init.js";
import { write } from "./logging/logQ.js";
import { multiThreaded } from "./multithreaded.js";
import { singleTheaded } from "./singlethreaded.js";
import { readdirSync } from "node:fs";

const testDirs = {
   noNestedSQ_multipleItemsInsideSQ_undefinedLengthSQ_undefinedLengthItems:
      "../data/with_1-depthSQ_multiple_items_undefined_SQlen_undefinedItemLen", // 102 elements

   turkey: "../data/turkey", // 51 elements

   noNestedSQ_singleItemsInsideSQ_undefinedLengthSQ_undefinedLengthItems:
      "../data/with_1-depth_sequences_undefinedSQlen_undefinedItemlen", // 130 elements

   nestedSQ_singleItemsInsideSQ_definedLengthSQ_definedLengthItems: "../data/Pi", //42 elements. (misplacing elements atm because of nested sequences, see sitrep note below)

   x: "../data/x", // 115 elements
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
async function main(cfg: Global.Config) {
   if (cfg.verbose) {
      write(`Starting up...`, "INFO");
   }

   await init();

   cfg.targetDir = testDirs.x; // TODO when back from dogwalk - detect the end of defined length SQs that don't use sequence delmiters to end their sequences.

   const fileCount = readdirSync(cfg.targetDir).length;

   // alright sitrep
   // think we are now supporting undefined and defined length SQs properly.
   // however - we are not yet supporting LIFO stacking which is how we can
   // handle nested SQs. For example the Pi SR has 2 defined length SQs in the top-most dataset.
   // Both are properly traversed, but only the first one actually persists the data properly because
   // it doesn't have a SQ nested within itself. The second one, ContentSequence(x0040a730), has a nested
   // SQ in it, which trips the parser up and it puts it in the top-level dataset. Incidentally this overwrites
   // the correctly handled first SQ because it is also a ContentSequence(x0040a730), and they end up sharing a key
   // so it overwrites it :P
   // handling nested sequencing is going to be the final piece of this SQ parsing puzzle. Fuck yeah!

   // await multiThreaded(cfg);
   await singleTheaded(cfg);

   // if (fileCount === 0) {
   //    write(`No files found in target directory. Exiting...`, "ERROR");
   //    process.exit();
   // }

   // if (fileCount > 1) {
   //    await multiThreaded(cfg);
   // }

   // if (fileCount === 1) {
   //    await singleTheaded(cfg);
   // }

   setTimeout(() => {
      if (cfg.verbose) {
         write(`Completed work - shutting down.`, "INFO");
      }
      process.exit(); // make this robust but its basically always fine but better to check q length
   }, 2_000); // Wait for logs to finish writing
}

main(cfg);
