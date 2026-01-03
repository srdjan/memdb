import { tursoFromEnv, type TursoClient } from "@memdb/turso/client.ts";
import { tursoMigrate } from "@memdb/turso/migrate.ts";
import { tursoSyncOnce } from "@memdb/turso/sync.ts";

let cached: TursoClient | null | undefined = undefined;

export const getTurso = (): TursoClient | null => {
  if (cached !== undefined) return cached;
  cached = tursoFromEnv();
  return cached;
};

const envBool = (k: string, def = false): boolean => {
  const v = (Deno.env.get(k) ?? "").trim().toLowerCase();
  if (!v) return def;
  return v === "1" || v === "true" || v === "yes" || v === "on";
};

export const tursoFlags = (): Readonly<{
  enabled: boolean;
  canonicalReads: boolean;
  migrateOnBoot: boolean;
  syncOnBoot: boolean;
  syncIntervalMs: number;
  syncPack: string | undefined;
}> => {
  const enabled = !!getTurso();
  return {
    enabled,
    canonicalReads: envBool("MEMDB_TURSO_CANONICAL_READS", false),
    migrateOnBoot: envBool("MEMDB_TURSO_MIGRATE", true),
    syncOnBoot: envBool("MEMDB_TURSO_SYNC", false),
    syncIntervalMs: Number(Deno.env.get("MEMDB_TURSO_SYNC_INTERVAL_MS") ?? "5000"),
    syncPack: (Deno.env.get("MEMDB_TURSO_SYNC_PACK") ?? "").trim() || undefined,
  };
};

export const initTurso = async (): Promise<void> => {
  const db = getTurso();
  if (!db) return;
  const f = tursoFlags();

  if (f.migrateOnBoot) {
    await tursoMigrate(db);
  }

  if (f.syncOnBoot) {
    const tick = async () => {
      try {
        await tursoSyncOnce(db, { pack: f.syncPack });
      } catch (err) {
        console.warn("turso sync failed:", err);
      }
    };
    // run immediately, then interval
    tick();
    setInterval(tick, f.syncIntervalMs);
  }
};
