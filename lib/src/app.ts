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

  // TODO you probably need to make sure thast your serialisation 
  // to JSON accurately implements the DICOM JSON module spec in 
  // the NEMA docs
  // https://dicom.nema.org/medical/dicom/current/output/chtml/part18/sect_F.2.2.html
  // or rather, you should have an option to enforce it. Because it 
  // seems to have weird opinions on what not to include, e.g. 
  // "Group Length (gggg,0000) attributes shall not be included in a DICOM JSON Model object."
  // and that elements should be lexicographic order (alphabet) for some reason. 
  // 
  // TODO optimisations:
  //  - change Element & Cursor for a class to help v8 JIT
  //  - for string element values uses numerical representation with lazy conversion to utf8
  //  - run node with --inspect for GC trace etc
  //  - possibly full-on lazy eval but could be challenging given buffer truncation?

  console.clear();
  await init();

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
