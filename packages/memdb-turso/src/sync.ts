import type { TursoClient } from "./client.ts";
import type { DeltaRecord, Edge } from "@memdb/core/lib/model.ts";
import { scanEntities } from "@memdb/core/lib/scan.ts";
import { loadPointers } from "@memdb/core/lib/indexes.ts";
import { listDeltaDays, readDeltasForDay } from "@memdb/core/lib/deltas.ts";
import { dbRoot, pjoin, readJson, exists } from "@memdb/core/lib/fs.ts";

const getCheckpoint = async (db: TursoClient, entityId: string, pack: string): Promise<string | null> => {
  const r = await db.execute(
    "SELECT last_ts FROM memdb_checkpoints WHERE entity_id = ? AND pack = ? LIMIT 1",
    [entityId, pack],
  );
  const rows = (r.rows ?? []) as any[];
  if (!rows.length) return null;
  return String(rows[0]?.[0] ?? "");
};

const setCheckpoint = async (db: TursoClient, entityId: string, pack: string, lastTs: string): Promise<void> => {
  await db.execute(
    "INSERT OR REPLACE INTO memdb_checkpoints (entity_id, pack, last_ts) VALUES (?, ?, ?)",
    [entityId, pack, lastTs],
  );
};

const isCanonical = (e: Edge): boolean => String((e.tags as any)?.status ?? "") === "canonical";

const readEdgeById = async (edgeId: string, relPath: string | undefined): Promise<Edge | null> => {
  if (!relPath) return null;
  const abs = pjoin(dbRoot(), relPath);
  if (!(await exists(abs))) return null;
  return await readJson<Edge>(abs);
};

const upsertCanonical = async (db: TursoClient, e: Edge): Promise<void> => {
  await db.execute(
    `INSERT OR REPLACE INTO facts_canonical
     (id, edge_key, pack, predicate, s, o, valid_from, valid_to, recorded_at, confidence, source_event_id, supersedes, tags_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      e.id,
      e.edgeKey,
      e.pack,
      e.predicate,
      e.s,
      e.o,
      e.validFrom,
      e.validTo,
      e.recordedAt,
      e.confidence,
      e.sourceEventId,
      e.supersedes,
      JSON.stringify(e.tags ?? {}),
    ],
  );
};

const deleteCanonical = async (db: TursoClient, edgeId: string): Promise<void> => {
  await db.execute("DELETE FROM facts_canonical WHERE id = ?", [edgeId]);
};

export type TursoSyncOptions = Readonly<{
  /** If provided, only sync deltas that belong to this pack. Otherwise sync all packs. */
  pack?: string;
  /** Optional hard cap for number of entities to scan (for tests/dev). */
  limitEntities?: number;
}>;

export const tursoSyncOnce = async (db: TursoClient, opt: TursoSyncOptions = {}): Promise<Readonly<{ syncedEntities: number; applied: number }>> => {
  const { entities } = await scanEntities();
  const entityIds = Object.keys(entities).sort();
  const toScan = opt.limitEntities ? entityIds.slice(0, opt.limitEntities) : entityIds;

  const ptr = await loadPointers();
  let syncedEntities = 0;
  let applied = 0;

  for (const entityId of toScan) {
    // Skip if no delta dir exists
    const deltaDir = pjoin(dbRoot(), "kv", "deltas", entityId);
    if (!(await exists(deltaDir))) continue;

    const days = await listDeltaDays(entityId);
    if (days.length === 0) continue;

    syncedEntities++;

    // We maintain checkpoints per pack encountered.
    const lastByPack = new Map<string, string>();
    const getLast = async (pack: string): Promise<string> => {
      if (lastByPack.has(pack)) return lastByPack.get(pack)!;
      const v = await getCheckpoint(db, entityId, pack);
      const vv = v ?? "";
      lastByPack.set(pack, vv);
      return vv;
    };

    const bumpLast = (pack: string, ts: string): void => {
      const cur = lastByPack.get(pack) ?? "";
      if (!cur || ts > cur) lastByPack.set(pack, ts);
    };

    const process = async (rec: DeltaRecord): Promise<void> => {
      if (opt.pack && rec.pack !== opt.pack) return;
      const last = await getLast(rec.pack);
      if (last && rec.ts <= last) return;

      // remove first (old current)
      if (rec.removeEdgeId) {
        const oldEdge = await readEdgeById(rec.removeEdgeId, ptr.edge[rec.removeEdgeId]);
        if (oldEdge && isCanonical(oldEdge)) {
          await deleteCanonical(db, rec.removeEdgeId);
          applied++;
        }
      }

      // then add
      const newEdge = await readEdgeById(rec.addEdgeId, ptr.edge[rec.addEdgeId]);
      if (newEdge && isCanonical(newEdge)) {
        await upsertCanonical(db, newEdge);
        applied++;
      }

      bumpLast(rec.pack, rec.ts);
    };

    for (const day of days) {
      const recs = await readDeltasForDay(entityId, day);
      for (const rec of recs) await process(rec);
    }

    // Persist checkpoints.
    for (const [pack, lastTs] of lastByPack.entries()) {
      if (!lastTs) continue;
      if (opt.pack && pack !== opt.pack) continue;
      await setCheckpoint(db, entityId, pack, lastTs);
    }
  }

  return { syncedEntities, applied };
};

export const tursoUpsertCanonicalEdges = async (db: TursoClient, edges: readonly Edge[]): Promise<void> => {
  for (const e of edges) {
    if (!isCanonical(e)) continue;
    await upsertCanonical(db, e);
  }
};

/**
 * Read canonical neighbors for a subject at a point in time.
 * This is the "state clock" read path.
 */
export const tursoQueryCanonicalNeighbors = async (
  db: TursoClient,
  subjectId: string,
  asOfIso: string,
  pack: string | null,
): Promise<readonly Edge[]> => {
  const asOf = asOfIso && asOfIso.trim() ? asOfIso : new Date().toISOString();
  const args: unknown[] = [subjectId, asOf, asOf];

  const wherePack = pack ? "AND pack = ?" : "";
  if (pack) args.push(pack);

  const r = await db.execute(
    `SELECT id, edge_key, pack, predicate, s, o, valid_from, valid_to, recorded_at, confidence, source_event_id, supersedes, tags_json
     FROM facts_canonical
     WHERE s = ?
       AND valid_from <= ?
       AND (valid_to IS NULL OR valid_to > ?)
       ${wherePack}
     ORDER BY recorded_at DESC
     LIMIT 500`,
    args,
  );

  const rows = (r.rows ?? []) as any[];
  const out: Edge[] = [];
  for (const row of rows) {
    // row is array-typed
    const [
      id,
      edge_key,
      row_pack,
      predicate,
      s,
      o,
      valid_from,
      valid_to,
      recorded_at,
      confidence,
      source_event_id,
      supersedes,
      tags_json,
    ] = row;

    let tags: any = {};
    try {
      tags = JSON.parse(String(tags_json ?? "{}"));
    } catch {
      tags = {};
    }

    out.push({
      id: String(id),
      edgeKey: String(edge_key),
      pack: String(row_pack),
      predicate: String(predicate),
      s: String(s),
      o: String(o),
      validFrom: String(valid_from),
      validTo: valid_to === null || valid_to === undefined ? null : String(valid_to),
      recordedAt: String(recorded_at),
      confidence: Number(confidence ?? 0),
      sourceEventId: String(source_event_id),
      supersedes: supersedes === null || supersedes === undefined ? null : String(supersedes),
      tags,
    });
  }
  return out;
};
