import sanitizeHtml from 'sanitize-html';
import { isMainThread, parentPort, threadId } from "worker_threads";
import { appendFileSync } from "fs";
import { Plugin } from "./plugins.js";
import { Worker } from "worker_threads";
import { Parse } from "../../global.js";
import { VR } from "../../enums.js";

// Here's an example plugin. It recieves each completely parsed DICOM element as bytes and as 
// serialised obj. It detects HTML XSS, and SQLi payloads. 

// You don't need to do what's in this example other than export a Plugin<R> object and pass 
// that to calls to parse().


// -- Main thread 
// -----------------------------------------------------------------------------------------------

// Step 1: Export a Plugin object. In this case with a closured reference to a worker 
// thread that'll be doing the work. Since we are co-locating worker/main thread code in 
// the same file, I'll use a ternary to make main thread logic only runs on the main thread.

export const exp_SHIELD: Plugin = !isMainThread
  ? null
  : (function() {
    const worker = new Worker('./dist/parsing/plugins/_demo_XSS_SHIELD.js');
    const id = worker.threadId;

    worker.on('message', (msg: any) => {
      log(`THREAD MSG: (ID: ${id}) -> ${JSON.stringify(msg, null, 3)}`)
    })

    worker.on('error', (err) => {
      log(`THREAD ERROR: (ID: ${id})\n${err.name} -> ${err.message}`)
    })

    // this Plugin return object is the point of interface with the TLV parsing loop
    return {
      name: 'exp_SHIELD',
      sync: 'async', // toggle to optionally block moving to parse next TLV until plugin promise 
      handleParsedElement: (
        // resolves This fn is is the method that gets called inside the core parse() loop as the 
        // last action of each el's handling before the cursor reaches the start of the next element.
        elementAsBytes: Buffer,
        el: Parse.Element,
        study
      ) => {
        worker.postMessage({ elementAsBytes, el, study })
      },
      teardown: async () => { worker.terminate() }
    }
  })();


// -- Worker 
// -----------------------------------------------------------------------------------------------
if (!isMainThread) {
  parentPort.on("message", async (msg: {
    elementAsBytes: Buffer,
    el: Parse.Element,
    study: { studyUid: string, instanceUid: string }
  }) => {
    // can skip SQ, no need to manually traverse - you get 
    // its elements passed to the plugin anyway.
    if (!('elementAsBytes' in msg) || msg.el.vr === VR.SQ) {
      return
    } else {
      screenXSS(msg.el)
    }
  });

  process.on("uncaughtException", error => {
    log(`Uncaught Exception: ${error?.toString() ?? error}`);
    parentPort.postMessage({ error: error.message });
  });
}

function log(msg: string) {
  const logPath = `./[SHIELD]-${threadId}-combined.log`
  appendFileSync(logPath, `[PLUGIN:-DEMO]: ${msg}\n`)
}

function screenXSS(el: Parse.Element) {
  switch (typeof el.value) {
    case 'string':
      if ([VR.OW, VR.OB].includes(el.vr)) {
        break
      }

      log(`Screening tag ${el.tag} - ${el.vr} - ${el.name}...`)

      const sanitised = sanitizeHtml(el.value)
      if (sanitised !== el.value) {
        log(`Possible XSS detection in el ${el.tag}`)
        log(el.value)
      } else {
        log(`No XSS detection in string el: ${el.tag}`)
      }

      break;

    case 'object':
      if ([VR.OW, VR.OB].includes(el.vr)) {
        break
      }

      log(`Screening tag ${el.tag} - ${el.vr} - ${el.name}...`)

      if (Buffer.isBuffer(el.value)) {
        const str = el.value.toString('utf8')
        const san = sanitizeHtml(str)

        if (str !== san) {
          log(`Possible XSS detection in el ${el.tag} (converted buffer to UTF-8)`)
        } else {
          log(`No XSS detection in buffer el: ${el.tag}`)
        }
      }

    default:
      break;
  }
}
