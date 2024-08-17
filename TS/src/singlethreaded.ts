import { writeFileSync } from "fs";
import { write } from "./logging/logQ.js";
import { streamParse } from "./read/read.js";
import { findDICOM, prettyPrintMap } from "./utils.js";

/**
 * Parse DICOM files using a single thread
 * @param cfg
 * @returns void
 */

export async function singleTheaded(cfg: Global.Cfg) {
   const start = performance.now();
   const paths = findDICOM(cfg.targetDir);
   const dataSets = [];

   for (let i = 0; i < paths.length; i++) {
      const elements = await streamParse(paths[i], cfg);
      dataSets.push(elements);
   }

   const end = performance.now();

   writeFileSync("./___output.json", JSON.stringify(dataSets[0], null, 3));
   write(`Parsed ${dataSets.length} datasets`, "INFO");
   write(
      `Time elapsed including finding images in dir, streaming, and parsing: ${end - start} ms`,
      "INFO"
   );

   console.log(
      `Time elapsed including finding images in dir, streaming, and parsing: ${end - start} ms`
   );

   return dataSets;
}
