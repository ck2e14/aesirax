import { write } from "./logging/logQ.js";
import { readdirSync } from "fs";
import { cfg, init } from "./init/init.js";
import { Cfg } from "./global.js";
import { multiThreaded } from "./examples/multithreaded.js";
import { singleTheaded } from "./examples/singlethreaded.js";

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

  // TODO need to workout why, when stitching, last cursor isn't
  // disposedOf - despite the parsing and persistence working? 
  // CK @MARCH'25 - is this still an issue? cant remember!)

  console.clear();

  if (cfg.verbose) {
    write(`Starting up...`, "INFO");
  }

  await init();

  
  cfg.targetDir = `../data/JonathanSnowMR/isolate`
  // cfg.targetDir = `/Users/chriskennedy/Desktop/SWE/Aesirax/data/Aidence/GSPS`
  // cfg.targetDir = `/Users/chriskennedy/Desktop/CIMAR/Software/services/GSPSPurge/t1/1.3.6.1.4.1.34692.6.775415760679.2530.1734372408504/images`
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

  if (fileCount >= 2) {
    write(`Running multithreaded parse on files`, "INFO")
    await multiThreaded(cfg);
  }

  if (fileCount === 1) {
    write(`Running singlethreaded parse on single file`, "INFO")
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
