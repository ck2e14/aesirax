import { cfg, init } from "./init/init.js";
import { write } from "./logging/logQ.js";
import { walkDicomBuffer } from "./parse/parse.js";
import { readDicom } from "./read/read.js";

(async function (cfg: Global.Config) {
   if (cfg.verbose) {
      write(`Starting up...`, "INFO");
   }

   await init();

   // some test code here, won't be actual app code in the final version
   try {
      const dcmPath =
         "/Users/chriskennedy/Desktop/aesirax/data/report_structured_report_PI-Contrast.dcm";
      const dicomBuffer = await readDicom(dcmPath);

      walkDicomBuffer(dicomBuffer.buf);
   } catch (error) {
      console.log(error.message);
      throw error;
   }
})(cfg);
