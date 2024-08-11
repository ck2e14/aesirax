import * as dotenv from "dotenv";
dotenv.config();

export function config(runtimeEndOverride?: { [key: string]: string | boolean }): Global.Config {
   const env = process.env;

   const config: Global.Config = {
      verbose: env.VERBOSE === "1",
      printToStdOut: env.PRINT_TO_STDOUT === "1",
      debug: env.DEBUG === "1",
      panic: env.PANIC === "1", // TODO implement panic mode
      logDir: env.LOG_DIR,
      logName: env.LOG_NAME,
      writeDir: env.WRITE_DIR ?? "../data/dicomDumps",
      targetDir: null,
      bufWatermark: parseInt(env.BUF_WATERMARK) || 1024,
   };

   if (runtimeEndOverride) {
      for (const [key, value] of Object.entries(runtimeEndOverride)) {
         config[key] = value;
      }
   }

   return config;
}
