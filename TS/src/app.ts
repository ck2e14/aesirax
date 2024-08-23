import { singleTheaded } from "./singlethreaded.js";
import { multiThreaded } from "./multithreaded.js";
import { readdirSync } from "node:fs";
import { cfg, init } from "./init/init.js";
import { write } from "./logging/logQ.js";

const testDirs = {
   undefinedLengthSQs: {
      withNesting: ["../data/x", "../data/QUANTREDEUSIX"],
      withoutNesting: ["../data/turkey", "../data/Aidence", "../data/CUMMINSMARJORIE"],
   } as const,

   definedLengthSQs: {
      withNesting: ["../data/pi"],
      withoutNesting: [""],
   } as const,
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

   cfg.targetDir = `../data/Pi`;
   // FELIX images are breaking atm on pixel data. are they still? TODO
   //ok so you fixed the bug where defined length sequences need to detect more than just the curretn sq end (because could be the end
   //of traversing the stated length of bytes of the parent sqs.) However now the byte tracker seems to be cooked lols.

   if (!cfg.targetDir || !cfg.targetDir.length) {
      write(`No targetdir. Doing nothing.`, "INFO");
      return;
   }

   const fileCount = readdirSync(cfg.targetDir).filter(
      filename => filename !== ".DS_Store"
   )?.length;

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
