import { readFileSync, writeFileSync } from "fs";
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
   const parsedFiles = [];

   for (let i = 0; i < paths.length; i++) {
      const debugLen = readFileSync(paths[i]);
      const elements = await streamParse(paths[i], cfg);
      parsedFiles.push(elements);
   }

   const end = performance.now();

   writeFileSync("./output.json", JSON.stringify(parsedFiles[0], null, 3));
   write(`Parsed ${parsedFiles.length} file(s)`, "INFO");
   write(
      `Time elapsed including finding images in dir, streaming, and parsing: ${end - start} ms`,
      "INFO"
   );

   return parsedFiles;
}
