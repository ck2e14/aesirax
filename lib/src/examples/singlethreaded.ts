import { writeFile } from "fs/promises";
import { findDICOM } from "../utils.js";
import { write } from "../logging/logQ.js";
import { Cfg, Parse } from "../global.js";
import { syncParse } from "./syncReadParse.js";
import { streamParse } from "./streamParse.js";

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
    write(`No DICOM files were discovered at ${cfg.targetDir}. Doing nothing.`, "INFO")
    return;
  }

  for (let i = 0; i < paths.length; i++) {
    // serialisedDataSet is one DICOM instance's entire set of elements
    const serialisedDataSet: Parse.DataSet = cfg.streamOrWhole === 'whole'
      ? await syncParse(paths[i], cfg)
      : await streamParse(paths[i], cfg)

    parsedFiles.push(serialisedDataSet);
  }

  const end = performance.now();
  write(`Parsed ${parsedFiles.length} file(s)`, "INFO");

  for (const imageData of parsedFiles) {
    const studyUid = imageData["(0020,000d)"]?.value ?? "UNKNOWN STUDY UID";
    const imageUid = imageData["(0008,0018)"]?.value ?? "UNKNOWN IMAGE UID";
    const writePath = writeTo ? `${writeTo}/${studyUid}-${imageUid}.json` : `./output.json`;
    writeFile(writePath, JSON.stringify(parsedFiles[0], null, 3));
  }

  write(`Time elapsed including finding images in dir, streaming, and parsing: ${end - start} ms`, "INFO");
  return parsedFiles;
}
