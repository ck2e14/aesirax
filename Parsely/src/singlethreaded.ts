import { readFileSync, writeFileSync } from "fs";
import { write } from "./logging/logQ.js";
import { parseFile, streamParse } from "./read/read.js";
import { findDICOM, prettyPrintMap } from "./utils.js";
import { DataSet } from "./parse/parse.js";

/**
 * Parse DICOM files using a single thread
 * @param cfg
 * @returns void
 */
export async function singleTheaded(cfg: Global.Cfg, writeTo?: string) {
   const start = performance.now();
   const paths = findDICOM(cfg.targetDir);
   const parsedFiles: DataSet[] = [];
   if (!paths.length) {
      return;
   }

   for (let i = 0; i < paths.length; i++) {
      let elements;

      if (cfg.streamOrWhole === "whole") {
         elements = parseFile(paths[i], cfg);
      } else {
         elements = await streamParse(paths[i], cfg);
      }

      parsedFiles.push(elements);
   }

   const end = performance.now();
   write(`Parsed ${parsedFiles.length} file(s)`, "INFO");
   writeFileSync("./check-output.json", JSON.stringify(parsedFiles[0], null, 3));

   for (const imageData of parsedFiles) {
      const studyUid = imageData["(0020,000d)"].value ?? "UNKNOWN STUDY UID";
      const imageUid = imageData["(0008,0018)"].value ?? "UNKNOWN IMAGE UID";
      const writePath = writeTo ? `${writeTo}/${studyUid}-${imageUid}.json` : `./output.json`;
      writeFileSync(writePath, JSON.stringify(parsedFiles[0], null, 3));
   }

   write(`Time elapsed including finding images in dir, streaming, and parsing: ${end - start} ms`, "INFO");

   return parsedFiles;
}
