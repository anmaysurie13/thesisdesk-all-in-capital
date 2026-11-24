import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "./schema";

export type DB = NeonDatabase<typeof schema>;

neonConfig.webSocketConstructor = ws;

let instance: DB | null = null;
let override: DB | null = null;

function connectionString(): string {
  const appEnv = process.env.APP_ENV ?? "test";
  const url = appEnv === "test" ? process.env.DATABASE_URL_TEST || process.env.DATABASE_URL : process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured.");
  return url;
}

/** One pooled client per process. Test and live point at different Neon branches. */
export function db(): DB {
  if (override) return override;
  if (!instance) {
    const pool = new Pool({ connectionString: connectionString(), max: 5 });
    instance = drizzle({ client: pool, schema, casing: "snake_case" });
  }
  return instance;
}

/** Tests inject a PGlite-backed database with the same API. */
export function setTestDb(d: DB | null) {
  override = d;
}

export { schema };
