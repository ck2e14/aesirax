import { readFile } from "fs/promises";
import { ctxFactory } from "../parsing/ctx.js";
import { parse } from "../parsing/parse.js";
import { HEADER_END } from "./streamParse.js";
import { Parse } from "../global.js";
import { write } from "../logging/logQ.js";
import { safeJSON } from "../utils.js";

/**
 * An awaitable asynchronous function that reads a file from disk and parses it into 
 * a JS object representation of a DICOM Dataset. 
 * 
 * It loads the entire binary into memory unlike streamParse() which stitches across 
 * boundaries to support incremental loading of data. This fn call will not allow any
 * data processing to begin until the whole file has been read into memory. 
 *
 * Probably makes sense for the majority of imaging that's under a couple hundred MB.
 *
 * @param path
 * @param cfg
 * @returns DataSet
 */
export async function syncParse(path: string, cfg = null, skipPixelData = true): Promise<Parse.DataSet> {
  const ctx = ctxFactory(path, cfg, true, skipPixelData);
  const ioStart = performance.now();
  const buf = (await readFile(path)).subarray(HEADER_END);

  const parseStart = performance.now();
  await parse(buf, ctx, null);
  const end = performance.now();

  // WARN on syncParse, unlike stream parse, at no point do you take the TSN derived from the 
  // meta part of the dataset and check if its in the list of supported TSNs. THis needs to 
  // change because you can't accept any old JPEG TSN for example - you may need special 
  // handling for different cases. 

  write(`Parsed DICOM Instance: ${ctx.dataSet["(0008,0018)"].value} \n` + safeJSON({
    sop_class: ctx.dataSet["(0008,0016)"].value,
    instance_uid: ctx.dataSet["(0008,0018)"].value,
    series_description: ctx.dataSet["(0008,103e)"]?.value ?? "not found",
    [`miliseconds including file i/o`]: end - ioStart,
    [`miliseconds excluding file i/o`]: end - parseStart,
  }), "INFO");

  return ctx.dataSet;
}
