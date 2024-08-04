import { cfg, init } from "./init/init.js";
import { write } from "./logging/logQ.js";
import { walkDicomBuffer } from "./parse/parse.js";
import { readDicom } from "./read/read.js";

(async function (cfg: Global.Config) {
   if (cfg.verbose) {
      write(`Starting up...`, "INFO");
   }

   await init();

   try {
      const path = `/Users/chriskennedy/Desktop/aesirax/data/brokenSiemensCT/DICOM/24070314/34580000/40809056`;
      const dicomBuffer = await readDicom(path);
      walkDicomBuffer(dicomBuffer.buf);
   } catch (error) {
      console.log(error.message);
      throw error;
   }
})(cfg);
