import type { TursoClient } from "./client.ts";
import { schemaStatements, schemaVersion } from "./schema.ts";

const getMeta = async (db: TursoClient, k: string): Promise<string | null> => {
  const r = await db.execute("SELECT v FROM memdb_meta WHERE k = ? LIMIT 1", [k]);
  const rows = (r.rows ?? []) as any[];
  if (!rows.length) return null;
  // rows are arrays by default
  const v = rows[0]?.[0];
  return typeof v === "string" ? v : String(v ?? "");
};

const setMeta = async (db: TursoClient, k: string, v: string): Promise<void> => {
  await db.execute("INSERT OR REPLACE INTO memdb_meta (k, v) VALUES (?, ?)", [k, v]);
};

export const tursoMigrate = async (db: TursoClient): Promise<void> => {
  // create base tables
  await db.execMany(schemaStatements().map((sql) => ({ sql })));

  const cur = await getMeta(db, "schema_version");
  const curN = cur ? Number(cur) : 0;

  // future-proof: handle migrations if schemaVersion bumps later.
  if (!Number.isFinite(curN) || curN < schemaVersion) {
    await setMeta(db, "schema_version", String(schemaVersion));
  }
};
