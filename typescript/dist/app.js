import { cfg, init } from "./init/init.js";
import { write } from "./logging/logQ.js";
import { readDicom } from "./read/read.js";
(async function (cfg) {
    if (cfg.verbose) {
        write(`Starting up...`, "INFO");
    }
    await init();
    try {
        const path = `/Users/chriskennedy/Desktop/aesirax/data/report_structured_report_PI-Contrast.dcm`;
        readDicom(path);
        // walkDicomBuffer(dicomBuffer.buf);
    }
    catch (error) {
        console.log(error.message);
        throw error;
    }
})(cfg);
//# sourceMappingURL=app.js.map