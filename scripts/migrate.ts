/** Applies drizzle/ migrations to the database for APP_ENV (test → DATABASE_URL_TEST, live → DATABASE_URL). */
import { config } from "dotenv";
config({ path: ".env.local" });
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import { db } from "../src/db";

async function main() {
  const target = process.argv.includes("--live") ? "live" : "test";
  process.env.APP_ENV = target;
  console.log(`Migrating ${target} database…`);
  await migrate(db(), { migrationsFolder: "drizzle" });
  console.log("Migrations applied.");
  process.exit(0);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
