import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { setTestDb, type DB } from "@/db";
import * as schema from "@/db/schema";
import { resetEnvCache } from "@/lib/env";

/** Fresh in-memory Postgres with the real migrations applied. No network, no Neon. */
export async function freshDb(): Promise<DB> {
  Object.assign(process.env, {
    APP_ENV: "test", DATA_MODE: "case_study", EMAIL_MODE: "simulate", DAILY_SPEND_CAP_USD: "1", MONTHLY_SPEND_CAP_USD: "15",
    DAILY_MODEL_CALL_CAP: "800", OPENROUTER_API_KEY: "", PORTKEY_API_KEY: "", LANGFUSE_PUBLIC_KEY: "", TAVILY_API_KEY: "", RESEND_API_KEY: "", CALENDLY_PAT: "",
  });
  resetEnvCache();
  const pg = new PGlite();
  const dir = path.resolve(__dirname, "../drizzle");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    for (const stmt of fs.readFileSync(path.join(dir, f), "utf8").split("--> statement-breakpoint")) {
      if (stmt.trim()) await pg.exec(stmt);
    }
  }
  const d = drizzle({ client: pg, schema, casing: "snake_case" }) as unknown as DB;
  setTestDb(d);
  return d;
}

export const actor = (role: string, id: string | null = null) => ({ id, role });
