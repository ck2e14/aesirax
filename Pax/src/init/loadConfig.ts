import dotenv from "dotenv";
dotenv.config();

export function loadConfig(runtimeEndOverride?: { [key: string]: string | boolean }): Global.Cfg {
   const env = process.env;

   const config: Global.Cfg = {
      dbHost: env.DB_HOST ?? "",
      dbPort: Number(env.DB_PORT ?? 5432),
      dbUser: env.DB_USER ?? "postgres",
      dbPassword: env.DB_PW ?? "",
      dbName: env.DB_NAME ?? "postgres",
      dbMax: 6,
   };

   if (
      !config.dbHost?.length ||
      !config.dbPort ||
      !config.dbUser?.length ||
      !config.dbPassword?.length ||
      !config.dbName?.length
   ) {
      throw new Error("Missing database configuration");
   }

   if (runtimeEndOverride) {
      for (const [key, value] of Object.entries(runtimeEndOverride)) {
         config[key] = value;
      }
   }

   return config;
}
