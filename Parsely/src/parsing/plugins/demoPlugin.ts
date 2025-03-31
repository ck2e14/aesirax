
import { parentPort } from "worker_threads";

parentPort.on("message", async (msg: any) => {
  console.log(`[PLUGIN:-DEMO]: Message from main thread -> ${JSON.stringify(msg, null, 3)}`)
});

process.on("uncaughtException", error => {
  console.error("Uncaught Exception:", error);
  parentPort.postMessage({ error: error.message });
});


parentPort.postMessage({ msg: "i am rdy" })
