import { cfg, init } from "./init/init.js";
import { write } from "./logging/logQ.js";
import { singleTheaded } from "./singlethreaded.js";
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
    const testDirs = {
        noNestedSQ_multipleItemsInsideSQ_undefinedLengthSQ_undefinedLengthItems: "../data/with_1-depthSQ_multiple_items_undefined_SQlen_undefinedItemLen", // working atm
        noNestedSQ_singleItemsInsideSQ_undefinedLengthSQ_undefinedLengthItems: "../data/with_1-depth_sequences_undefinedSQlen_undefinedItemlen", // working atm
        nestedSQ_singleItemsInsideSQ_definedLengthSQ_definedLengthItems: "../data/Pi", // not working because haven't implemented handling for SQ's with defined lengths
    };
    cfg.targetDir = testDirs.noNestedSQ_multipleItemsInsideSQ_undefinedLengthSQ_undefinedLengthItems;
    await init();
    // await multiThreaded(cfg);
    await singleTheaded(cfg);
    setTimeout(() => {
        if (cfg.verbose) {
            write(`Completed work - shutting down.`, "INFO");
        }
        process.exit();
    }, 2000); // Wait for logs to finish writing
})(cfg);
//# sourceMappingURL=app.js.map