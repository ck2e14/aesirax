import { cfg } from "../app.js";
import fs from "fs";
function logQueue() {
    const q = [];
    let active = false;
    setInterval(async () => {
        if (!q.length) {
            return;
        }
        if (active) {
            return;
        }
        try {
        }
        catch (error) {
            //
        }
        finally {
            active = false;
        }
    }, 250);
}
export function print(message) {
    if (cfg.verbose) {
        console.log(message);
    }
    //TODO
}
function logExists(path = "./logs/log.log") {
    if (!path.length) {
        throw new Error(`Path is empty.`);
    }
    return fs.existsSync(path);
}
//# sourceMappingURL=write.js.map