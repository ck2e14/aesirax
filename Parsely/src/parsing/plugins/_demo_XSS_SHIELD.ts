import { isMainThread, parentPort, threadId } from "worker_threads";
import { appendFileSync } from "fs";
import { Plugin } from "./plugins.js";
import { Worker } from "worker_threads";
import { Parse } from "../../global.js";




// Here's a random example plugin. It recieves each completely parsed DICOM element 
// as bytes and as serialised obj. It scans the element value for XSS & SQLi payloads.

// You don't need to do what's in this example other than export a Plugin<R> object and 
// pass that to calls to parse().




//   -- Main thread 
// -----------------------------------------------------------------------------------------------

// Step 1: Export a Plugin<R> object. In this case with a closured reference to a worker 
// thread that'll be doing the work.
export const exp_SHIELD: Plugin<null> = (() => {
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
    // This fn is the actually 'plugged in' interface to all the rest of your plugin logic. 
    // It's the method that gets called inside the core parse() loop as the last action of 
    // each element's handling before the cursor is moved to the start of the next element. 
    fn: (elementAsBytes: Buffer, el: Parse.Element) => {
      worker.postMessage({ elementAsBytes, el })
      return null
    }
  }
})();



//   -- Worker 
// -----------------------------------------------------------------------------------------------

!isMainThread && (() => {
  parentPort.on("message", async (msg: any) => {
    // would normally await fs/promises appendFile() here but seems to behave badly on sigint when a worker thread, not sure why
    appendFileSync(`./${threadId}-combined.log`, `[PLUGIN:-DEMO]: Message from main thread -> ${JSON.stringify(msg, null, 3)}\n`)
  });

  process.on("uncaughtException", error => {
    console.error("Uncaught Exception:", error);
    parentPort.postMessage({ error: error.message });
  });

  parentPort.postMessage({ msg: "i am rdy :)" })
})();
