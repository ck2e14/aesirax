import { Worker } from "worker_threads";
import { cpus } from "os";
import { write } from "./logging/logQ.js";
import { findDICOM } from "./utilts.js";

/**
 * Parse DICOM files using multiple threads
 * @param cfg
 * @returns promised worker threads' completion (void)
 */
export async function multiThreaded(cfg: Global.Config) {
   const start = performance.now();
   const workerPromises = [];

   const dicomFiles = findDICOM(`../data/CUMINSMARJORIE`);
   const dataSets = [];

   write(`Spawning ${cpus().length} workers`, "INFO");
   write(`Found ${dicomFiles.length} DICOM files`, "INFO");

   for (let i = 0; i < cpus().length; i++) {
      const worker = createWork(dataSets, dicomFiles);
      workerPromises.push(worker);
   }

   await Promise.all(workerPromises);
   const end = performance.now();

   write(`Time elapsed: ${end - start} ms`, "INFO");
   write(`Parsed ${dataSets.length} datasets`, "INFO");

   dataSets.forEach((data, i) => console.log(`Dataset ${i + 1}: ${data}`));

   return workerPromises;
}

/**
 * Create a worker thread to parse DICOM files
 * @param dataSets
 * @param dicomFiles
 * @returns promised worker thread's completion (void)
 */
function createWork(dataSets: any[], dicomFiles: string[]) {
   const worker = new Worker("./dist/worker.js");
   const workerPromise = new Promise<void>((resolve, reject) => {
      worker.on("message", (msg: any) => {
         dataSets.push(msg.data);

         if (dicomFiles.length > 0) {
            worker.postMessage({ filepath: dicomFiles.pop() });
            return;
         }

         worker.terminate();
         resolve();
      });

      worker.on("error", error => {
         reject(error);
      });

      worker.on("exit", code => {
         if (code !== 0) {
            reject(new Error(`Worker stopped with exit code ${code}`));
         }
      });
   });

   worker.postMessage({ filepath: dicomFiles.pop() });
   return workerPromise;
}