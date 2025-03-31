import { Parse } from "../../global.js";
import { Plugin } from "../parse.js";
import { Worker } from "worker_threads";

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

// XSS Detection Plugin
// registerPlugin({
//   name: "XSS Payload Detector",
//   execution: "sync", // Security checks should be synchronous
//   stages: {
//     onValue: (element, buffer, context) => {
//       // Only check string values
//       if (typeof element.value === "string") {
//         const value = element.value;
//
//         // Check for common XSS patterns
//         const xssPatterns = [
//           /<script\b[^>]*>/i,
//           /javascript:/i,
//           /on\w+\s*=/i,
//           /eval\s*\(/i,
//           /<img[^>]+src[^>]*=/i,
//           /<iframe[^>]*>/i
//         ];
//
//         for (const pattern of xssPatterns) {
//           if (pattern.test(value)) {
//             console.warn(`Potential XSS payload detected in ${element.tag} (${element.name}): ${value.substring(0, 50)}...`);
//             // Log details, possibly trigger alerts
//
//             // You could also set a flag in the context
//             context.securityIssues = context.securityIssues || [];
//             context.securityIssues.push({
//               type: "XSS",
//               element: element.tag,
//               name: element.name,
//               sample: value.substring(0, 100)
//             });
//           }
//         }
//       }
//     },
//
//     afterParse: (element, buffer, context) => {
//       // Final report on security issues
//       if (context.securityIssues?.length > 0) {
//         console.error(`Found ${context.securityIssues.length} potential security issues in DICOM file`);
//         // Could trigger more comprehensive reporting here
//       }
//     }
//   }
// });
