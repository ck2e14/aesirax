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
    const paths = findDICOM(cfg.targetDir ?? `/Users/chriskennedy/Desktop/aesirax/data/isolat`);
    // const paths = findDICOM(cfg.targetDir ?? `/Users/chriskennedy/Desktop/aesirax/data/Pi`);
    const dataSets = [];
    for (let i = 0; i < paths.length; i++) {
        const elements = await streamParse(paths[i]);
        dataSets.push(elements);
    }
    const end = performance.now();
    // console.log(dataSets);
    dataSets.forEach((data, i) => console.log(`Dataset ${i + 1}: ${JSON.stringify(data, null, 3)}`, "DEBUG"));
    write(`Parsed ${dataSets.length} datasets`, "INFO");
    write(`Time elapsed: ${end - start} ms`, "INFO");
}
//# sourceMappingURL=singlethreaded.js.map