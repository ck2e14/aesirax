import { cfg, init } from "./init/init.js";
import { write } from "./logging/logQ.js";
import { walkEntireDicomFileAsBuffer } from "./parse/parse.js";
import { readDicom, streamParse } from "./read/read.js";
(async function (cfg) {
    if (cfg.verbose) {
        write(`Starting up...`, "INFO");
    }
    await init();
    const path = `/Users/chriskennedy/Desktop/aesirax/data/brokenSiemensCT/DICOM/24070314/34580000/40809056`;
    try {
        // // 1. Entire DICOM file as buffer version (memory-inefficient)
        const dicomBuffer = await readDicom(path);
        walkEntireDicomFileAsBuffer(dicomBuffer.buf);
        // // 2. Stream-parsing version (memory-efficient)
        streamParse(path);
    }
    catch (error) {
        console.log(error.message);
        throw error;
    }
})(cfg);
//# sourceMappingURL=app.js.map