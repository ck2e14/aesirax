import { isMainThread, parentPort, threadId } from "worker_threads";
import { appendFileSync } from "fs";
import { Plugin } from "./plugins.js";
import { Worker } from "worker_threads";
import { Parse } from "../../global.js";
import { VR } from "../../enums.js";

// Here's a random example plugin. It recieves each completely parsed DICOM element 
// as bytes and as serialised obj. It scans the element value for XSS & SQLi payloads.

// You don't need to do what's in this example other than export a Plugin<R> object and 
// pass that to calls to parse().

//   -- Main thread 
// -----------------------------------------------------------------------------------------------
// Step 1: Export a Plugin object. In this case with a closured reference to a worker 
// thread that'll be doing the work. Since we are colocating worker/main thread code in 
// the same file, use a ternary to avoid an unlimited recursive thread spawning script :P
export const exp_SHIELD: Plugin = isMainThread ? (() => {
  const worker = new Worker('./dist/parsing/plugins/_demo_XSS_SHIELD.js');
  const id = worker.threadId;

  worker.on('message', (msg: any) => {
    console.log(`[PLUGIN:-DEMO]: THREAD MSG: (ID: ${id}) -> ${JSON.stringify(msg, null, 3)}`)
  })
  worker.on('error', (err) => {
    console.log(`[PLUGIN:-DEMO]: THREAD ERROR: (ID: ${id})\n${err.name} -> ${err.message}`)
  })

  // return the plugin with some config & metadata for the parse() loop to execute appropriately.
  return {
    name: 'exp_SHIELD',
    sync: 'async',
    // This fn is is the method that gets called inside the core parse() loop as the last 
    // action of each element's handling before the cursor reaches the start of the next element. 
    fn: (elementAsBytes: Buffer, el: Parse.Element) => {
      worker.postMessage({ elementAsBytes, el })
    }
  }
})() : null;


//   -- Worker 
// -----------------------------------------------------------------------------------------------
if (!isMainThread) {
  const logPath = `./[SHIELD]-${threadId}-combined.log`

  parentPort.on("message", async (msg: { elementAsBytes: Buffer, el: Parse.Element, id: string }) => {
    appendFileSync(logPath, `[PLUGIN:-DEMO]: Message from main thread -> ${JSON.stringify(msg.el, null, 3)}\n`) // would normally await fs/promises appendFile() here but seems to behave badly on sigint when a worker thread, not sure why

    // ... do XSS and SQLi screening here ...
    if ('elementAsBytes' in msg) {
      if (msg.el.vr === VR.SQ) {
        appendFileSync(logPath, `[PLUGIN:-DEMO]: ooh an SQ. i don't know how to xss screen that yet - wait!\n`)
      } else {
        appendFileSync(logPath, `[PLUGIN:-DEMO]: screening value: ${msg.el.value}\n`)
        // msg.el.
      }
    }

    // main thread expects to be told when the task is completed 
    parentPort.postMessage({ completedId: msg.id })
  });

  process.on("uncaughtException", error => {
    console.error("Uncaught Exception:", error);
    parentPort.postMessage({ error: error.message });
  });

  parentPort.postMessage({ msg: "i am rdy :)" })
}
