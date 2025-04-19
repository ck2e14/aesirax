import { parentPort } from "worker_threads";
import { writeFileSync } from "fs";
import { streamParse } from "./streamParse.js";

parentPort.on("message", async (msg: { filepath: string; writeDir: string }) => {
  if (msg.filepath?.length) {
    const data = await streamParse(msg.filepath, null); // TODO get config from main thread
    const writePath = msg.writeDir + "/" + msg.filepath.split("/").pop() + ".json";

    writeFileSync(writePath, JSON.stringify(data, null, 2));
    // TODO we should stream this back to the main thread
    // as binary data because its expensive to JSON.stringify
    // large datasets but only noticable on pixel data DICOM.
    // not critical for this project in early stages.
    parentPort.postMessage({
      data: JSON.stringify({ filepath: msg.filepath, data }),
    });
  }
});

process.on("uncaughtException", error => {
  console.error("Uncaught Exception:", error);
  parentPort.postMessage({ error: error.message });
});
