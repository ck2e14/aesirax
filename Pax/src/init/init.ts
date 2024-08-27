import { createPool } from "../db/pool";
import { loadConfig } from "./loadConfig";

export async function init() {
   const cfg = loadConfig();
   const pool = await createPool(cfg);
   console.log("Application config: ", cfg);
   console.log("Connected to database: ", !!pool);
   return { cfg, pool };
}

// TODO start logging queue
