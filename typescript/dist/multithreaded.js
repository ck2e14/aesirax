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
    dataSets.forEach((data, i) => console.log(`Dataset ${i + 1}: ${data}`));
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
    const workerPromise = new Promise((resolve, reject) => {
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
            reject(error);
        });
        worker.on("exit", code => {
            if (code !== 0) {
                reject(new Error(`Worker stopped with exit code ${code}`));
            }
        });
        worker.postMessage({ filepath: dicomFiles.pop() });
    });
    return workerPromise;
}
//# sourceMappingURL=multithreaded.js.map