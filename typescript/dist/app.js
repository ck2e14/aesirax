import { cfg, init } from "./init/init.js";
import { write } from "./logging/logQ.js";
import { streamParse } from "./read/read.js";
(async function (cfg) {
    if (cfg.verbose)
        write(`Starting up...`, "INFO");
    await init();
    try {
        const path = `../data/report_structured_report_PI-Contrast.dcm`;
        // const path = `/Users/chriskennedy/Desktop/aesirax/data/IMG00001.dcm`;
        // const path =`/Users/chriskennedy/Desktop/aesirax/data/brokenSiemensCT/DICOM/24070314/34580002/40820056`
        const elements = await streamParse(path);
        console.log(elements);
    }
    catch (error) {
        console.log(error.message);
        throw error;
    }
})(cfg);
//# sourceMappingURL=app.js.map