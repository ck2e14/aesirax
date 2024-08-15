import { cfg, init } from "./init/init.js";
import { write } from "./logging/logQ.js";
import { singleTheaded } from "./singlethreaded.js";
import { readdirSync } from "node:fs";
const testDirs = {
    // no nested SQs
    noNestedSQ_multipleItemsInsideSQ_undefinedLengthSQ_undefinedLengthItems: "../data/with_1-depthSQ_multiple_items_undefined_SQlen_undefinedItemLen", // 102 elements
    noNestedSQ_singleItemsInsideSQ_undefinedLengthSQ_undefinedLengthItems: "../data/with_1-depth_sequences_undefinedSQlen_undefinedItemlen", // 130 elements
    // nested SQs
    nestedSQ_singleItemsInsideSQ_definedLengthSQ_definedLengthItems: "../data/Pi", //42 elements. (misplacing elements atm because of nested sequences, see sitrep note below)
    nestedSQ_undefinedLens_multipleItems: "/Users/chriskennedy/Desktop/SWE/aesirax/data/QUANTREDEUSIX",
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
async function main(cfg) {
    if (cfg.verbose) {
        write(`Starting up...`, "INFO");
    }
    await init();
    // cfg.targetDir = `/Users/chriskennedy/Desktop/SWE/aesirax/data/JonathanSnowMR/isolate`
    cfg.targetDir = testDirs.nestedSQ_undefinedLens_multipleItems;
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
}
main(cfg);
//# sourceMappingURL=app.js.map