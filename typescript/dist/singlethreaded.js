import { write } from "./logging/logQ.js";
import { streamParse } from "./read/read.js";
import { findDICOM, prettyPrintMap } from "./utilts.js";
/**
 * Parse DICOM files using a single thread
 * @param cfg
 * @returns void
 */
export async function singleTheaded(cfg) {
    const start = performance.now();
    const dir = `../data/CUMINSMARJORIE`;
    const paths = findDICOM(dir);
    const dataSets = [];
    for (let i = 0; i < paths.length; i++) {
        const elements = await streamParse(paths[i]);
        dataSets.push(prettyPrintMap(elements));
    }
    const end = performance.now();
    dataSets.forEach((data, i) => console.log(`Dataset ${i + 1}: ${data}`, "DEBUG"));
    write(`Parsed ${dataSets.length} datasets`, "INFO");
    write(`Time elapsed: ${end - start} ms`, "INFO");
}
//# sourceMappingURL=singlethreaded.js.map