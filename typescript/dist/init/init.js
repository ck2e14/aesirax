import { InitError } from "../error/initError.js";
import { createLogFile, processQ, write } from "../logging/logQ.js";
import { config } from "./loadConfig.js";
export const cfg = config();
export async function init() {
    try {
        // TODO move this to a better place
        process.on("uncaughtException", error => {
            console.log("uncaughtException", error);
            setTimeout(() => process.exit(1), 1000); // let the logQ finish writing
            // TODO panic if cfg.panic
        });
        process.on("unhandledRejection", error => {
            console.log("unhandledRejection", error);
            setTimeout(() => process.exit(1), 1000); // let the logQ finish writing
            // TODO panic if cfg.panic
        });
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