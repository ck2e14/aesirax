import { readFile } from "fs/promises";
import { ctxFactory } from "../parsing/ctx.js";
import { parse } from "../parsing/parse.js";
import { HEADER_END } from "./streamParse.js";
import { Parse } from "../global.js";

/**
 * An awaitable asynchronous function (only async to support nonblocking file i/o) 
 * that reads a file from disk and parses it into a DataSet. It loads the entire 
 * bytestream into memory unlike streamParse() which stitches across boundaries to 
 * support incremental loading of data. 
 *
 * I.e. this is the simple sync version of streamParse().
 *
 * @param path
 * @param cfg
 * @returns DataSet
 */
export async function syncParse(path: string, cfg = null, skipPixelData = true): Promise<Parse.DataSet> {
  const ctx = ctxFactory(path, cfg, true, skipPixelData);
  const buf = (await readFile(path)).subarray(HEADER_END);
  await parse(buf, ctx);
  return ctx.dataSet;
}
