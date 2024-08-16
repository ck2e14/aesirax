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
   nestedSQ_singleItemsInsideSQ_definedLengthSQ_definedLengthItems: "../data/Pi", //42 elements. (misplacing elements atm because of nested sequences, see sitrep note below)
   // working
   nestedSQ_undefinedLens_multipleItems:
      "/Users/chriskennedy/Desktop/SWE/aesirax/data/QUANTREDEUSIX",
   // working except for 0 len undef sq (empty item not zero len i think)
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
   // cfg.targetDir = `/Users/chriskennedy/Desktop/SWE/aesirax/data/JonathanSnowMR/isolate`
   cfg.targetDir = testDirs.nestedSQ_undefinedLens_multipleItems;

   // WARN after implementing the LIFO nested SQ support I've broken sitching. Need to address this. Until then use very large high watermarkt

   // alright i got recursive, nested, stacked and multiple item SQs working for example in Quantredeusix
   // but in defined len nested, like Pi, we're struggling, but brain is tired. I got close, see Untitled file,
   // but then in the final SQ it seemed to misunderstand where the cursor was at. Noted that in this SR the
   // last SQ had an item after the nested SQ item, and that may have contributed to cooking detecting the
   // end of the parent SQ. Then it miscalculated the valueIsTruncated despite having a massive buffer watermark
   // and triggered stitching but obvs never returns to parse() because no further data. Tempted to chuck in
   // something to streamRead that recalls parse if it gets anything non zero length back? WOuld be hacky but
   // potentially would work. Would rather make it logically sound though. But time for bed, brain tired. LIFO stacking
   // on undefined len undefined item lens has been implemented.

   // also PatientClinicalTrialParticipationSequence(x00380502) : length=0 (-1); VR=SQ; for example, a zero length,
   // but actually appears has item but empty item, in an undefined length SQ, is breaking in:
   // "/Users/chriskennedy/Desktop/SWE/aesirax/data/CUMMINSMARJORIE",

   const fileCount = readdirSync(cfg.targetDir).length;

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
