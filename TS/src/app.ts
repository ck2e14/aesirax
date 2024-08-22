import { cfg, init } from "./init/init.js";
import { write } from "./logging/logQ.js";
import { multiThreaded } from "./multithreaded.js";
import { singleTheaded } from "./singlethreaded.js";
import { readdirSync } from "node:fs";

const testDirs = {
  // no nested SQs
  noNestedSQ_multipleItemsInsideSQ_undefinedLengthSQ_undefinedLengthItems:
    "../data/with_1-depthSQ_multiple_items_undefined_SQlen_undefinedItemLen", // 103 elements
  noNestedSQ_singleItemsInsideSQ_undefinedLengthSQ_undefinedLengthItems:
    "../data/with_1-depth_sequences_undefinedSQlen_undefinedItemlen", // 130 elements

  // nested SQs
  nestedSQ_singleItemsInsideSQ_definedLengthSQ_definedLengthItems: "../data/Pi",
  nestedSQ_undefinedLens_multipleItems:
    "/Users/chriskennedy/Desktop/SWE/aesirax/data/QUANTREDEUSIX", // 111
  nestedSQ_undefinedLens_multipleItems2:
    "/Users/chriskennedy/Desktop/SWE/aesirax/data/CUMMINSMARJORIE", // 150 elements

  // other
  x: "../data/x", // 115 elements
  turkey: "../data/turkey", // 51 elements
};

/**
 * Main entry point for the application.
 * Initializes the application, runs the
 * multi-threaded and/or single-threaded
 * DICOM parsing, and shuts down targetDirhe application.
 *
 * @param cfg
 * @returns void
 */
async function main(cfg: Global.Cfg) {
  if (cfg.verbose) {
    write(`Starting up...`, "INFO");
  }

  await init();

  // FELIX images are breaking atm on pixel data. 
  //cfg.targetDir = '/Users/chriskennedy/Desktop/aesiraxDropbox'
  // alright you have an issue in defined length (think only def len,not undef len but possible you havent hit such a case in undef sqs yet,
  // need to test this) 
  // But basically, where you have a detected end of an sq that ends MORE THAN ITSELF i.e. the end of a nested SQ represents the end element
// of more than 1 sq, you are only ever popping one sq off the stack. 
  // so you need to think about how to check whether the sq's stated length has been reached yet (possibly need to do a sync up a la cursor sync)
  // here? i.e. add our current traversed bytes to the parent traversed bytes?
  // note that this is an issue in the persistence logic rather than the actual parsing byte alignment logic. It's the reason why your byte alingment
  // never actually fails and the entire file gets properly logged out, but we dont exit enough nestings in the stacks, so the final output is putting
  // tags into a sequence that has actually ended. 
  // So its a problem with the creating of representative objects in javascript land rather than cursor walking (which is because your syncign works, 
  // we just dont check after that sync to see if another sq has been ended)
  //
  // in other words your defined length sq end detection needs to detect more than just the end of the current sq because the end of the current sq may 
  // representmore than just the end of itself, it could be the end of multiple. 
  if(!cfg.targetDir || !cfg.targetDir.length){
    write(`No targetdir. Doing nothing.`, "INFO")
    return
  }

  const fileCount = readdirSync(cfg.targetDir)?.length;

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
      //write(`Completed current parsing work`, "INFO");
    }
    //process.exit(); // make this robust but its basically always fine but better to check q length
  }, 100); // Wait for logs to finish writing
}

main(cfg);
