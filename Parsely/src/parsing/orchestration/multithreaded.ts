import { appendFileSync, writeFileSync } from "fs";
import { write } from "../../logging/logQ.js";
import { findDICOM } from "../../utils.js";
import { Worker } from "worker_threads";
import { cpus } from "os";
import { Cfg } from "../../global.js";

/**
 * Parse DICOM files using multiple threads
 * @param cfg
 * @returns promised worker threads' completion (void)
 */
export async function multiThreaded(cfg: Cfg) {
  const start = performance.now();
  const dicomFiles = findDICOM(cfg.targetDir);
  const nWorkers = cpus().length > dicomFiles.length ? dicomFiles.length : cpus().length;
  const workerPromises = [];
  const parsedFiles = [];

  write(`Spawning ${nWorkers} workers to read ${dicomFiles.length} DICOM files`, "INFO");

  for (let i = 0; i < nWorkers; i++) {
    const worker = createWork(parsedFiles, dicomFiles, cfg);
    workerPromises.push(worker);
  }

  await Promise.all(workerPromises);
  const end = performance.now();

  write(`Parsed ${parsedFiles.length} parsedFiles`, "INFO");
  write(`Time elapsed (minus end printing): ${end - start} ms`, "INFO");
  writeFileSync(`${cfg.writeDir}/parsedFiles.json`, "");

  for (let i = 0; i < parsedFiles.length; i++) {
    appendFileSync(`${cfg.writeDir}/parsedFiles.json`, parsedFiles[i]);
  }

  return workerPromises;
}

/**
 * Create a worker thread to parse DICOM files
 * @param parsedFiles
 * @param dicomFiles
 * @returns promised worker thread's completion (void)
 */
function createWork(parsedFiles: any[], dicomFiles: string[], cfg: Cfg) {
  const worker = new Worker("./dist/worker.js");

  return new Promise<void>((resolve, reject) => {
    addEvents(worker, parsedFiles, dicomFiles, resolve, reject, cfg);
    worker.postMessage({
      filepath: dicomFiles.pop(),
      writeDir: cfg.writeDir,
    });
  });
}

/**
 * Add event listeners to the worker thread
 * @param worker
 * @param parsedFiles
 * @param dicomFiles
 * @param resolve
 * @param reject
 * @returns void
 */
function addEvents(
  worker: Worker,
  parsedFiles: any[],
  dicomFiles: string[],
  resolve,
  reject,
  cfg: Cfg
) {
  worker.on("message", (msg: any) => {
    parsedFiles.push(msg.data);

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
