import { tursoFromEnv } from "./client.ts";
import { tursoMigrate } from "./migrate.ts";

const db = tursoFromEnv();
if (!db) {
  console.error("Missing MEMDB_TURSO_URL or MEMDB_TURSO_TOKEN.");
  Deno.exit(2);
}

await tursoMigrate(db);
console.log(JSON.stringify({ ok: true, migrated: true }));
