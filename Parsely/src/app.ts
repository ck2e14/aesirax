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
 *
 * Initialises the application, runs the
 * multi-threaded and/or single-threaded
 * DICOM parsing, and shuts down.
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

  cfg.targetDir = `../data/JonathanSnowMR/isolate`;
  // cfg.targetDir = `../data/brokenSiemensCT/isolate`; 
  // cfg.targetDir = `../data/QUANTREDEUSIX`; 
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

  if (cfg.verbose) {
    write(`Completed current parsing work`, "INFO");
  }

  write(`Manually exit when plugins are ready - this will be automated in future.`, "INFO")
  setInterval(() => { }, 5_000) // this is a hack to keep the process alive whilst i work out
  // a non-annoying or stupid way to make sure plugins are ready for the parent thread to exit 
  // which is required because plugins are likely to be using worker threads that don't stay alive 
  // if the parent's got no more event loop work. Probs just a counter or an awaitable promise idk.

  // setTimeout(() => {
  //   // process.exit(); // make this robust but its basically always fine but better to check q length
  // }, 0); // Wait for logs to finish writing
  //

}
