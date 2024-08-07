import { parentPort } from "worker_threads";
import { streamParse } from "./read/read.js";

parentPort.on("message", async (msg: { filepath: string }) => {
   if (msg.filepath?.length) {
      const data = await streamParse(msg.filepath);

      parentPort.postMessage({
         data: JSON.stringify({
            filepath: msg.filepath,
            data,
            // data: mapToObj(data), // if using the Map data structure in the streamBundle inside streamParse()
         }),
      });
   }
});
