import { cfg, init } from "./init/init.js";
import { write } from "./logging/logQ.js";
import { streamParse } from "./read/read.js";
(async function (cfg) {
    if (cfg.verbose) {
        write(`Starting up...`, "INFO");
    }
    await init();
    // const path = `/Users/chriskennedy/Desktop/aesirax/data/brokenSiemensCT/DICOM/24070314/34580000/40809056`;
    const path = `/Users/chriskennedy/Desktop/aesirax/data/report_structured_report_PI-Contrast.dcm`;
    try {
        // // 1. Entire DICOM file as buffer version (memory-inefficient)
        // const dicomBuffer = await readDicom(path);
        // walkEntireDicomFileAsBuffer(dicomBuffer.buf);
        // // 2. Stream-parsing version (memory-efficient)
        const elements = await streamParse(path);
        console.log(elements);
    }
    catch (error) {
        console.log(error.message);
        throw error;
    }
})(cfg);
//# sourceMappingURL=app.js.map