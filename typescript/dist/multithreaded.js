import { Worker } from "worker_threads";
import { cpus } from "os";
import { write } from "./logging/logQ.js";
import { findDICOM } from "./utilts.js";
/**
 * Parse DICOM files using multiple threads
 * @param cfg
 * @returns promised worker threads' completion (void)
 */
export async function multiThreaded(cfg) {
    const start = performance.now();
    const workerPromises = [];
    const dicomFiles = findDICOM(cfg.targetDir ?? `/Users/chriskennedy/Desktop/aesirax/data/CUMINSMARJORIE/isolate`);
    const dataSets = [];
    write(`Spawning ${cpus().length} workers`, "INFO");
    write(`Found ${dicomFiles.length} DICOM files`, "INFO");
    for (let i = 0; i < 1; i++) {
        const worker = createWork(dataSets, dicomFiles);
        workerPromises.push(worker);
    }
    await Promise.all(workerPromises);
    const end = performance.now();
    dataSets.forEach((data, i) => write(`Dataset ${i + 1}: ${data}`, "INFO"));
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
function createWork(dataSets, dicomFiles) {
    const worker = new Worker("./dist/worker.js");
    return new Promise((resolve, reject) => {
        addEvents(worker, dataSets, dicomFiles, resolve, reject);
        worker.postMessage({ filepath: dicomFiles.pop() });
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
function addEvents(worker, dataSets, dicomFiles, resolve, reject) {
    worker.on("message", (msg) => {
        dataSets.push(msg.data);
        if (dicomFiles.length > 0) {
            worker.postMessage({ filepath: dicomFiles.pop() });
        }
        else {
            worker.terminate();
            resolve();
        }
    });
    worker.on("error", error => {
        console.log("!!! Unhandled error", error);
        reject(error);
    });
    worker.on("exit", code => {
        if (code !== 0) {
            reject(new Error(`Worker stopped with exit code ${code}`));
        }
    });
}
//# sourceMappingURL=multithreaded.js.map