import { createLogFile, processQ, write } from "../logging/logQ.js";
import { monitorDropbox } from "../dropbox/dropbox.js";
import { config } from "./loadConfig.js";
import { InitError } from "../errors.js";

export const cfg = config();

export async function init() {
  try {
    // TODO move this to a better place
    // TODO panic if cfg.panic
    process.on("uncaughtException", error => {
      console.log("uncaughtException", error);
      setTimeout(() => process.exit(1), 1000); // let the logQ finish writing
    });

    process.on("unhandledRejection", error => {
      console.log("unhandledRejection", error);
      setTimeout(() => process.exit(1), 1000); // let the logQ finish writing
    });

    await createLogFile();
    processQ();
    monitorDropbox(cfg)
    setInterval(() => { }, 5_000)

    write(`Configuration loaded: ${JSON.stringify(cfg)}`, "DEBUG");
    write(`App initialised.`, "INFO");
  } catch (error) {
    throw InitError.from(error);
  }
}
