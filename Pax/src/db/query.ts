import pg from "pg";

export async function query<T = any>(
   pool: pg.Pool,
   query: string,
   txID: string,
   params: any[] = []
): Promise<pg.QueryResult<T>> {
   let client: pg.PoolClient;
   console.log(`Running SQL query: ${query}\n ... with params:` + JSON.stringify(params), "DEBUG");

   try {
      client = await pool.connect();

      await client.query("BEGIN");
      const result = await client.query(query, params);
      await client.query("COMMIT");

      console.log(`SQL Query Result: ${result.rowCount} rows returned`, "DEBUG");

      result.rows = result.rows.map(toCamelCase);
      return result;
   } catch (error) {
      await client.query("ROLLBACK");
      console.log(`Error running SQL query: ${query}\n ... with params:` + JSON.stringify(params), "ERROR");
      throw error;
   } finally {
      client.release();
   }
}

function toCamelCase(obj: Record<string, any>): Record<string, any> {
   return Object.entries(obj).reduce((acc, [key, value]) => {
      const camelKey = key.replace(/(_\w)/g, k => k[1].toUpperCase());
      acc[camelKey] = value;
      return acc;
   }, {} as Record<string, any>);
}
