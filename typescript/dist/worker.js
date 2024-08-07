import { parentPort } from "worker_threads";
import { streamParse } from "./read/read.js";
import { prettyPrintMap } from "./utilts.js";
parentPort.on("message", async (msg) => {
    if (msg.filepath?.length) {
        const data = await streamParse(msg.filepath);
        parentPort.postMessage({
            data: JSON.stringify({
                filepath: msg.filepath,
                data: prettyPrintMap(data),
            }),
        });
    }
});
//# sourceMappingURL=worker.js.map