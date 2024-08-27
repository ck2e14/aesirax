import pg from "pg";
import { query } from "./query";

export async function createPool(cfg: Global.Cfg): Promise<pg.Pool> {
   const pool = new pg.Pool({
      user: cfg.dbUser,
      host: cfg.dbHost,
      database: cfg.dbName,
      password: cfg.dbPassword,
      port: cfg.dbPort,
      max: cfg.dbMax,
   });

   pool.on("acquire", event => console.log("Pool has connected to the database.", "DEBUG"));

   pool.on("error", async (err, _client) => {
      console.log("pool.on('error'): Postgres Client Error -> " + err.message, "ERROR");
      const pgClientLoss = "Connection terminated unexpectedly";
      if (err.message === pgClientLoss) console.log("Lost pg client");
   });

   // test a query to check all's good
   const dummyWorkflowQuery = await query(pool, "SELECT * FROM workflows WHERE id = $1", "TX123", [1]);
   console.log(dummyWorkflowQuery.rows);

   if (dummyWorkflowQuery.rows.length === 0) {
      throw new Error("Init test query was unsuccessful. Exiting.");
   }

   return pool;
}
