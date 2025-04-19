import { existsSync, mkdirSync } from "fs";
import { appendFile } from "fs/promises";
import { cfg } from "../init/init.js";
import { InitError } from "../errors.js";

const q = [];

export function processQ() {
  const path = constructLogFilePath();
  let active = false;

  setInterval(async () => {
    if (!q.length) return;
    if (active) return;
    else active = true;

    try {
      await appendFile(path, q.join("\n") + "\n");
      q.length = 0;
    } catch (error) {
      console.log(error); // should write to a separate error log file and maybe notify someone
    } finally {
      active = false;
    }
  }, 250);
}

/**
 * Append a message to the log queue.
 * @param message
 * @param level
 */
export function write(message: string, level: "INFO" | "DEBUG" | "ERROR" | "WARN") {
  if (level === "DEBUG" && !cfg.debug) {
    return;
  }

  // make uniform length for cleaner log output
  const _level = level === "INFO" || level === "WARN"
    ? `[${level}] `
    : `[${level}]`;

  message = `${new Date().toISOString()} ${_level} ${message}`;

  if (cfg.printToStdOut) console.log(message);
  q.push(message);
}

/**
 * Create the log path if it doesn't exist.
 * @param path
 * @param depth
 * @throws {InitError}
 */
export async function createLogFile(depth = 0) {
  const path = constructLogFilePath();

  if (depth > 3) {
    throw new InitError(`Failed to create log path after 3 attempts`);
  }

  if (!path.length) {
    throw new InitError(`Passed a 0-length string as the log path`);
  }

  if (!existsSync(path)) {
    const dir = path
      .split("/") // split the path into an array of directories
      .slice(0, -1)
      .join("/");

    mkdirSync(dir, { recursive: true });
    await appendFile(path, "testing");
    createLogFile(depth + 1);
  }
}

function constructLogFilePath() {
  let dir = cfg.logDir ?? "./logs/";
  const name = cfg.logName ?? "log.txt";

  if (!dir.endsWith("/")) {
    dir += "/";
  }

  return dir + name;
}
