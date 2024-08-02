import { InitError } from "../error/initError.js";
import { createLogFile, processQ, write } from "../logging/logQ.js";
import { config } from "./loadConfig.js";
export const cfg = config();
export async function init() {
    try {
        await createLogFile();
        processQ();
        write(`Configuration loaded: ${JSON.stringify(cfg)}`, "DEBUG");
        write(`App initialized.`, "INFO");
    }
    catch (error) {
        throw InitError.from(error);
    }
}
//# sourceMappingURL=init.js.map