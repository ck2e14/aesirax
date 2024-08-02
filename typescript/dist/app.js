import { cfg, init } from "./init/init.js";
import { write } from "./logging/logQ.js";
(async function (cfg) {
    if (cfg.verbose) {
        write(`Starting up...`, "INFO");
    }
    await init();
    // some test code here, won't be actual app code in the final version
    // try {
    //    const dcmPath = `/Users/chriskennedy/Desktop/aesirax/data/IMG00001.dcm`;
    //    const dicomBuffer = await readDicom(dcmPath);
    //    console.log(dcmPath, dicomBuffer);
    // } catch (error) {
    //    console.log(error.message);
    //    throw error;
    // }
})(cfg);
//# sourceMappingURL=app.js.map