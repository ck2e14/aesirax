import { Worker } from "worker_threads";
import { cpus } from "os";
import { write } from "./logging/logQ.js";
import { findDICOM } from "./utilts.js";
import { writeFileSync } from "fs";

/**
 * Parse DICOM files using multiple threads
 * @param cfg
 * @returns promised worker threads' completion (void)
 */
export async function multiThreaded(cfg: Global.Config) {
   const start = performance.now();

   const dicomFiles = findDICOM(cfg.targetDir);
   const nWorkers = cpus().length > dicomFiles.length ? dicomFiles.length : cpus().length; // this could be refined because one massive file also benefits from multiple workers but currently doing 1 file per worker. Future improvement.
   const workerPromises = [];
   const dataSets = [];

   write(`Spawning ${nWorkers} workers to read ${dicomFiles.length} DICOM files`, "INFO");

   for (let i = 0; i < nWorkers; i++) {
      const worker = createWork(dataSets, dicomFiles, cfg);
      workerPromises.push(worker);
   }

   await Promise.all(workerPromises);
   const end = performance.now();

   write(`Parsed ${dataSets.length} datasets`, "INFO");
   write(`Time elapsed (minus end printing): ${end - start} ms`, "INFO");

   return workerPromises;
}

/**
 * Create a worker thread to parse DICOM files
 * @param dataSets
 * @param dicomFiles
 * @returns promised worker thread's completion (void)
 */
function createWork(dataSets: any[], dicomFiles: string[], cfg: Global.Config) {
   const worker = new Worker("./dist/worker.js");

   return new Promise<void>((resolve, reject) => {
      addEvents(worker, dataSets, dicomFiles, resolve, reject, cfg);
      worker.postMessage({
         filepath: dicomFiles.pop(),
         writeDir: cfg.writeDir,
      });
   });
}

/**
 * Add event listeners to the worker thread
 * @param worker
 * @param dataSets
 * @param dicomFiles
 * @param resolve
 * @param reject
 * @returns void
 */
function addEvents(
   worker: Worker,
   dataSets: any[],
   dicomFiles: string[],
   resolve,
   reject,
   cfg: Global.Config
) {
   worker.on("message", (msg: any) => {
      dataSets.push(msg.data);

      if (dicomFiles.length > 0) {
         return worker.postMessage({
            filepath: dicomFiles.pop(),
            writeDir: cfg.writeDir,
         });
      }

      worker.terminate();
      resolve();
   });

   worker.on("error", error => {
      console.log(`error handler reached`);
      reject(error);
   });

   worker.on("exit", code => {
      if (code !== 0) {
         console.log(`exit handler reached`);
         reject(new Error(`Worker stopped with exit code ${code}`));
      }
   });
}
