import { tursoFromEnv } from "./client.ts";
import { tursoMigrate } from "./migrate.ts";
import { tursoSyncOnce } from "./sync.ts";

const db = tursoFromEnv();
if (!db) {
  console.error("Missing MEMDB_TURSO_URL or MEMDB_TURSO_TOKEN.");
  Deno.exit(2);
}

const pack = Deno.env.get("MEMDB_TURSO_SYNC_PACK") ?? undefined;
const loop = (Deno.env.get("MEMDB_TURSO_SYNC_LOOP") ?? "").toLowerCase() === "true";
const intervalMs = Number(Deno.env.get("MEMDB_TURSO_SYNC_INTERVAL_MS") ?? "5000");

await tursoMigrate(db);

const runOnce = async () => {
  const r = await tursoSyncOnce(db, { pack });
  console.log(JSON.stringify({ ok: true, ...r }));
};

if (!loop) {
  await runOnce();
  Deno.exit(0);
}

console.log(JSON.stringify({ ok: true, loop: true, intervalMs, pack: pack ?? null }));

while (true) {
  await runOnce();
  await new Promise((r) => setTimeout(r, intervalMs));
}
