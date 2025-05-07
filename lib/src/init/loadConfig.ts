import * as dotenv from "dotenv";
import { Cfg } from "../global.js";
import { InitError } from "../errors.js";
dotenv.config();

// runtimeEndOverride is for optional deviating from the default/env config opts
export function config(runtimeEndOverride?: { [key: string]: string | boolean }): Cfg {
  const env = process.env;
  const config: Cfg = {
    lazy: env.LAZY === "1",
    verbose: env.VERBOSE === "1",
    printToStdOut: env.PRINT_TO_STDOUT === "1",
    debug: env.DEBUG === "1",
    panic: env.PANIC === "1", // TODO implement panic mode
    logDir: env.LOG_DIR,
    logName: env.LOG_NAME,
    writeDir: env.WRITE_DIR ?? "../data/dicomDumps",
    targetDir: env.TARGET_DIR,
    bufWatermark: parseInt(env.BUF_WATERMARK) || 10_000,
    streamOrWhole: env.STREAM_OR_WHOLE === "whole" ? "whole" : "stream",
  };

  if (!config.targetDir) {
    throw new InitError("Must set TARGET_DIR env variable");
  }

  if (config.bufWatermark < 10_000) {
    // less than 10kb causes a bunch of nasty and hard to debug issues
    // and more importantly you'd never want to set it any lower anyways.
    // Ideally you'd set it higher than 10kb as well but the point
    // of this learning project is to learn how to handle such low
    // buffer sizes when stitching & parsing complex binary data structures,
    // but you reach a point where it's just not worth it, and I was encountering
    // real challenges with anything underneath 10kb while 10kb was making integration
    // tests pass.
    throw new InitError("Buffer watermark must be at least 10kb.");
  }

  if (runtimeEndOverride) {
    for (const [key, value] of Object.entries(runtimeEndOverride)) {
      config[key] = value;
    }
  }

  return config;
}
