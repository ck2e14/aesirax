import { cfg, init } from "./init/init.js";
import { write } from "./logging/logQ.js";
import { streamParse } from "./read/read.js";

(async function (cfg: Global.Config) {
   if (cfg.verbose) write(`Starting up...`, "INFO");

   await init();

   try {
      const path = `../data/report_structured_report_PI-Contrast.dcm`;
      const elements = await streamParse(path);
      console.log(elements);
   } catch (error) {
      console.log(error.message);
      throw error;
   }
})(cfg);
