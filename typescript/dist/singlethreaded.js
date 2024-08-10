import { writeFileSync } from "fs";
import { write } from "./logging/logQ.js";
import { streamParse } from "./read/read.js";
import { findDICOM } from "./utilts.js";
/**
 * Parse DICOM files using a single thread
 * @param cfg
 * @returns void
 */
export async function singleTheaded(cfg) {
    const start = performance.now();
    const paths = findDICOM(cfg.targetDir);
    const dataSets = [];
    for (let i = 0; i < paths.length; i++) {
        const elements = await streamParse(paths[i], cfg);
        dataSets.push(elements);
    }
    const end = performance.now();
    // console.log(dataSets);
    // const [x] = dataSets.map((data, i) => `Dataset ${i + 1}: ${JSON.stringify(data, null, 3)}`);
    writeFileSync("./___output.json", JSON.stringify(dataSets[0], null, 3));
    write(`Parsed ${dataSets.length} datasets`, "INFO");
    write(`Time elapsed: ${end - start} ms`, "INFO");
}
//# sourceMappingURL=singlethreaded.js.map