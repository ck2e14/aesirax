import { parentPort } from "worker_threads";

parentPort.on("message", async (msg: any) => {
  // ...
});

process.on("uncaughtException", error => {
  console.error("Uncaught Exception:", error);
  parentPort.postMessage({ error: error.message });
});


parentPort.postMessage({ msg: "i am rdy" })
