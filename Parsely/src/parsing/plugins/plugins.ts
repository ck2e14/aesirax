import { Parse } from "../../global.js";
import { Worker } from "worker_threads";

export type Plugin<R = unknown> = {
  name: string,
  sync: 'async' | 'sync',
  fn: (elementAsBytes: Buffer, el: Parse.Element) => R;
}

//// ------------------- < UNDER CONSTRUCTION >
// TODO change Buffer to a wrapper class we use that creates a read only view into a SharedArrayBuffer?
// Here's an example plugin to demonstrate the kind of flexibility this can offer. 
export const _exp_XSS_SHIELD: Plugin<null> = (() => {
  // The plugin will do its work off the main thread to promote nonblocking of the parse loop. 
  // To keep it simple in the example we'll use a single extra worker thread.

  // All we'll ask of the main thread is that it passes messages and/or SharedArrayBuffers (inlcudign 
  // window start/end ints) to our plugin logic, which is contained in /plugins/demoPlugin.ts.
  const worker = new Worker('./plugins/demoPlugin.js')

  worker.on('message', (msg: any) => {
    console.log(`[PLUGIN:-DEMO]: THREAD MSG: (ID: ${worker.threadId}) -> ${JSON.stringify(msg, null, 3)}`)
  })
  worker.on('error', (err) => {
    console.log(`[PLUGIN:-DEMO]: THREAD ERROR: (ID: ${worker.threadId})\n${err.name} -> ${err.message}`)
  })

  // return the plugin with some config & metadata for the parse() loop to execute appropriately.
  return {
    name: 'demo plugin',
    sync: 'async',
    fn: (elementAsBytes: Buffer, el: Parse.Element) => {
      worker.postMessage({ elementAsBytes, el })
      return null
    }
  }
})();
// IIFE is to closure and privatise the worker pool for just this plugin.
//// ------------------ </ UNDER CONSTRUCTION >
