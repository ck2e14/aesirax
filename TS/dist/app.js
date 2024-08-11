import { cfg, init } from "./init/init.js";
import { write } from "./logging/logQ.js";
import { singleTheaded } from "./singlethreaded.js";
import { readdirSync } from "node:fs";
const testDirs = {
    noNestedSQ_multipleItemsInsideSQ_undefinedLengthSQ_undefinedLengthItems: "../data/with_1-depthSQ_multiple_items_undefined_SQlen_undefinedItemLen",
    turkey: "../data/turkey",
    noNestedSQ_singleItemsInsideSQ_undefinedLengthSQ_undefinedLengthItems: "../data/with_1-depth_sequences_undefinedSQlen_undefinedItemlen",
    nestedSQ_singleItemsInsideSQ_definedLengthSQ_definedLengthItems: "../data/Pi", // not working because haven't implemented handling for SQ's with defined lengths
    x: "../data/x",
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
(async function main(cfg) {
    if (cfg.verbose) {
        write(`Starting up...`, "INFO");
    }
    await init();
    cfg.targetDir = testDirs.nestedSQ_singleItemsInsideSQ_definedLengthSQ_definedLengthItems; // TODO when back from dogwalk - detect the end of defined length SQs that don't use sequence delmiters to end their sequences. 
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
    }, 2000); // Wait for logs to finish writing
})(cfg);
//# sourceMappingURL=app.js.map