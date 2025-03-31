import { write } from "./logging/logQ.js";
import { readdirSync } from "node:fs";
import { cfg, init } from "./init/init.js";
import { singleTheaded } from "./parsing/orchestration/singlethreaded.js";
import { multiThreaded } from "./parsing/orchestration/multithreaded.js";
import { Cfg } from "./global.js";

// WARN need to workout why, when stitching, last cursor isn't
// disposedOf - despite the parsing and persistence working? 
// CK @MARCH'25 - is this still an issue? cant remember!)

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
main(cfg);
async function main(cfg: Cfg) {
  console.clear();

  if (cfg.verbose) {
    write(`Starting up...`, "INFO");
  }

  await init();

  // cfg.targetDir = `../data/brokenSiemensCT/isolate`; 
  // cfg.targetDir = `../data/QUANTREDEUSIX`; 
  cfg.targetDir = `../data/JonathanSnowMR/isolate`;
  // cfg.targetDir = `/Users/chriskennedy/Desktop/SWE/aesirax/data/STANWORTHLORNAMISS/SER00001`;
  // cfg.targetDir = `../data/FELIX/isolate`;// FELIX images are breaking atm on pixel data, i think its expecting JPEG EOI for an img that doesn't use that

  if (!cfg.targetDir || !cfg.targetDir.length) {
    write(`No targetdir. Doing nothing.`, "INFO");
    return;
  }

  const fileCount = readdirSync(cfg.targetDir)
    .filter(filename => filename !== ".DS_Store")
    .length;

  if (fileCount > 1) {
    await multiThreaded(cfg);
  }

  if (fileCount === 1) {
    await singleTheaded(cfg);
  }

  if (fileCount === 0) {
    write(`No files found in target directory. Exiting...`, "ERROR");
    process.exit();
  }

  setTimeout(() => {
    if (cfg.verbose) write(`Completed current parsing work`, "INFO");
    process.exit(); // make this robust but its basically always fine but better to check q length
  }, 300); // Wait for logs to finish writing
}
