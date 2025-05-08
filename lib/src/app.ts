import { printMemoryUsage, safeJSON } from "./utils.js";
import { syncParse } from "./examples/syncReadParse.js";
import { writeFile } from "fs/promises";
import { write } from "./logging/logQ.js";

(async function CLI() {
  const filepath = process.argv
    .slice(2)
    .find(arg => arg.startsWith("--filepath="))
    ?.slice(11);

  if (!filepath.length) {
    return;
  }

  writeFile(`${filepath}.json`, safeJSON(await syncParse(filepath)));
  write(`Saved JSON serialiation to ${filepath}.json`, "INFO");
  setTimeout(() => { process.exit(0) }, 100);
})();
