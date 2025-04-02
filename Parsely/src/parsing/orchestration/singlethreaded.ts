import { writeFileSync } from "fs";
import { streamParse } from "../../reading/stream.js";
import { syncParse } from "./syncReadParse.js";
import { Cfg, Parse } from "../../global.js";
import { write } from "../../logging/logQ.js";
import { writeFile } from "fs/promises";
import { findDICOM } from "../../utils.js";
import { getValue } from "../parse.js";

/**
 * Parse DICOM files using a single thread
 * @param cfg
 * @returns void
 */
export async function singleTheaded(cfg: Cfg, writeTo?: string) {
  const start = performance.now();
  const paths = findDICOM(cfg.targetDir);
  const parsedFiles: Parse.DataSet[] = [];

  if (!paths.length) {
    return;
  }

  for (let i = 0; i < paths.length; i++) {
    if (cfg.streamOrWhole === "whole") {
      parsedFiles.push(await syncParse(paths[i]));
    }
    if (cfg.streamOrWhole === "stream") {
      parsedFiles.push(await streamParse(paths[i], cfg));
    }
  }

  const end = performance.now();
  write(`Parsed ${parsedFiles.length} file(s)`, "INFO");
  await writeFile("./check-output.json", JSON.stringify(parsedFiles[0], null, 3));


  for (const imageDataset of parsedFiles) {
    const sUid = getValue(imageDataset["(0020,000d)"]) ?? "UNKNOWN STUDY UID";
    const iUid = getValue(imageDataset["(0008,0018)"]) ?? "UNKNOWN INSTANCE UID";
    const writePath = writeTo ? `${writeTo}/${sUid}-${iUid}.json` : `./output.json`;
    writeFileSync(writePath, JSON.stringify(parsedFiles[0], null, 3));
  }

  write(`Time elapsed including finding images in dir, streaming, and parsing: ${end - start} ms`, "INFO");
  return parsedFiles;
}
