import { parentPort } from "worker_threads";
import { streamParse } from "./read/read.js";

parentPort.on("message", async (msg: { filepath: string }) => {
   if (msg.filepath?.length) {
      const data = await streamParse(msg.filepath);

      // TODO we should stream this back to the main thread
      // as binary data because its expensive to JSON.stringify
      // large datasets but only noticable on pixel data DICOM.
      // not critical for this project in early stages.

      parentPort.postMessage({
         data: JSON.stringify({
            filepath: msg.filepath,
            data,
         }),
      });
   }
});

process.on("uncaughtException", error => {
   console.error("Uncaught Exception22222222:", error);
   parentPort.postMessage({ error: error.message });
});
