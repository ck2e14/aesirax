import dotenv from "dotenv";
dotenv.config();
export function config() {
    const env = process.env;
    const config = {
        verbose: env.VERBOSE === "1",
        printToStdOut: env.PRINT_TO_STDOUT === "1",
        debug: env.DEBUG === "1",
        panic: env.PANIC === "1", // TODO implement panic mode
        logDir: env.LOG_DIR,
        logName: env.LOG_NAME,
        targetDir: null,
    };
    return config;
}
//# sourceMappingURL=loadConfig.js.map