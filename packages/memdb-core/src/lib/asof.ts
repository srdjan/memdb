import { isActiveAt } from "./time.ts";
import type { Edge, AsOfSnapshot, SnapshotEntry, TimestampCheckpoint, DeltaRecord } from "./model.ts";
import { adjAllPath, loadPointers } from "./indexes.ts";
import { dbRoot, exists, pjoin, readText, readJson } from "./fs.ts";
import { loadAsOfSnapshot, asOfDir } from "./views_asof.ts";
import { loadCheckpointByFile, checkpointPath } from "./checkpoints.ts";
import { loadManifest } from "./manifest.ts";
import { readDeltasForDay, readDeltasFromFile } from "./deltas.ts";

const ymdUtc = (iso: string): string => {
  const d = new Date(iso);
  const yyyy = String(d.getUTCFullYear());
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

const readIdx = async (filePath: string): Promise<string[]> => {
  if (!(await exists(filePath))) return [];
  const s = (await readText(filePath)).trim();
  if (!s) return [];
  return s.split(/\r?\n/g).map((x) => x.trim()).filter(Boolean);
};

export const edgeByIdFast = async (edgeId: string): Promise<Edge | null> => {
  const ptr = await loadPointers();
  const rel = ptr.edge[edgeId];
  if (!rel) return null;
  const abs = pjoin(dbRoot(), rel);
  if (!(await exists(abs))) return null;
  return await readJson<Edge>(abs);
};

const snapshotToState = async (snap: AsOfSnapshot): Promise<Map<string, string>> => {
  const st = new Map<string, string>();
  if (snap.entries && snap.entries.length) {
    for (const e of snap.entries) st.set(e.edgeKey, e.edgeId);
    return st;
  }
  const ids = snap.edges ?? [];
  for (const id of ids) {
    const e = await edgeByIdFast(id);
    if (!e) continue;
    st.set(e.edgeKey, e.id);
  }
  return st;
};

const checkpointToState = (cp: TimestampCheckpoint): Map<string, string> => {
  const st = new Map<string, string>();
  for (const e of cp.entries) st.set(e.edgeKey, e.edgeId);
  return st;
};

const findNearestTimestampCheckpoint = async (
  packKey: string,
  entityId: string,
  asOfIso: string,
): Promise<TimestampCheckpoint | null> => {
  const m = await loadManifest(entityId);
  if (!m) return null;

  const list = m.checkpointsByPack[packKey] ?? [];
  if (!list.length) return null;

  const t = Date.parse(asOfIso);
  // list sorted asc; scan from end
  for (let i = list.length - 1; i >= 0; i--) {
    if (Date.parse(list[i]) <= t) {
      const abs = checkpointPath(packKey, entityId, list[i]);
      return await loadCheckpointByFile(abs);
    }
  }
  return null;
};


const findNearestDailyCheckpoint = async (
  packKey: string,
  entityId: string,
  targetDay: string,
): Promise<AsOfSnapshot | null> => {
  const dir = asOfDir(packKey, entityId);
  if (!(await exists(dir))) return null;

  const days: string[] = [];
  for await (const e of Deno.readDir(dir)) {
    if (!e.isFile) continue;
    if (!e.name.endsWith(".json")) continue;
    const base = e.name.replace(/\.json$/, "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(base)) continue;
    days.push(base);
  }
  days.sort();

  let best: string | null = null;
  for (const d of days) {
    if (d <= targetDay) best = d;
  }
  if (!best) return null;
  return await loadAsOfSnapshot(packKey, entityId, best);
};

// P8 fallback: scan adj_all + select latest version per edgeKey as-of
const edgesAsOfFallback = async (entityId: string, asOfIso: string, pack: string | null): Promise<readonly Edge[]> => {
  const ids = await readIdx(adjAllPath(entityId));
  const t = Date.parse(asOfIso);

  const best = new Map<string, Edge>();
  for (const id of ids) {
    const e = await edgeByIdFast(id);
    if (!e) continue;
    if (pack && e.pack !== pack) continue;
    if (e.s !== entityId && e.o !== entityId) continue;

    const rec = Date.parse(e.recordedAt);
    if (rec > t) continue;

    const cur = best.get(e.edgeKey);
    if (!cur) best.set(e.edgeKey, e);
    else if (rec > Date.parse(cur.recordedAt)) best.set(e.edgeKey, e);
  }

  return Array.from(best.values()).filter((e) => isActiveAt(e.validFrom, e.validTo, asOfIso));
};

const replayRecords = (state: Map<string, string>, recs: readonly DeltaRecord[]): void => {
  for (const r of recs) {
    // remove then add (edgeKey is authoritative)
    if (r.removeEdgeId) {
      const cur = state.get(r.edgeKey);
      if (cur === r.removeEdgeId) state.delete(r.edgeKey);
    }
    state.set(r.edgeKey, r.addEdgeId);
  }
};

const daysBetween = (fromDay: string, toDay: string): readonly string[] => {
  const out: string[] = [];
  const f = new Date(fromDay + "T00:00:00Z");
  const t = new Date(toDay + "T00:00:00Z");
  for (let d = new Date(f); d.getTime() <= t.getTime(); d = new Date(d.getTime() + 24 * 3600 * 1000)) {
    const yyyy = String(d.getUTCFullYear());
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    out.push(`${yyyy}-${mm}-${dd}`);
  }
  return out;
};

const loadDeltasInRange = async (
  entityId: string,
  pack: string | null,
  fromDay: string,
  toDay: string,
  asOfIso: string,
): Promise<readonly DeltaRecord[]> => {
  const t = Date.parse(asOfIso);
  const out: DeltaRecord[] = [];

  const covered = new Set<string>();

  const m = await loadManifest(entityId);
  const segs = m?.segments ?? [];

  // Prefer segments where available
  for (const s of segs) {
    if (s.endDay < fromDay) continue;
    if (s.startDay > toDay) break;
    const abs = pjoin(dbRoot(), "kv", "deltas", entityId, "segments", `${s.startDay}_${s.endDay}.ndjson`);
    const recs = await readDeltasFromFile(abs);
    for (const r of recs) {
      if (Date.parse(r.ts) > t) continue;
      if (pack && r.pack !== pack) continue;
      out.push(r);
    }
    for (const day of daysBetween(s.startDay, s.endDay)) covered.add(day);
  }

  // Remaining daily logs
  for (const day of daysBetween(fromDay, toDay)) {
    if (covered.has(day)) continue;
    const recs = await readDeltasForDay(entityId, day);
    for (const r of recs) {
      if (Date.parse(r.ts) > t) continue;
      if (pack && r.pack !== pack) continue;
      out.push(r);
    }
  }

  out.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  return out;
};

export const edgesAsOfForEntity = async (entityId: string, asOfIso: string, pack: string | null): Promise<readonly Edge[]> => {
  const packKey = pack ?? "all";
  const targetDay = ymdUtc(asOfIso);

  // Prefer timestamp checkpoint
  const tsCp = await findNearestTimestampCheckpoint(packKey, entityId, asOfIso);
  if (tsCp) {
    const state = checkpointToState(tsCp);
    const fromDay = ymdUtc(tsCp.checkpointAt);
    const toDay = targetDay;
    const recs = await loadDeltasInRange(entityId, pack, fromDay, toDay, asOfIso);

    // Only apply records strictly after checkpointAt (otherwise we'd double-apply)
    const cpt = Date.parse(tsCp.checkpointAt);
    replayRecords(state, recs.filter((r) => Date.parse(r.ts) > cpt));

    return await edgesFromState(entityId, asOfIso, pack, state);
  }

  // Fallback to daily checkpoint
  const dayCp = await findNearestDailyCheckpoint(packKey, entityId, targetDay);
  if (dayCp) {
    const state = await snapshotToState(dayCp);
    const fromDay = dayCp.asOfDate;
    const toDay = targetDay;
    const recs = await loadDeltasInRange(entityId, pack, fromDay, toDay, asOfIso);

    const cpt = Date.parse(dayCp.asOf);
    replayRecords(state, recs.filter((r) => Date.parse(r.ts) > cpt));

    return await edgesFromState(entityId, asOfIso, pack, state);
  }

  // Cold start fallback
  return await edgesAsOfFallback(entityId, asOfIso, pack);
};

const edgesFromState = async (entityId: string, asOfIso: string, pack: string | null, state: Map<string, string>): Promise<readonly Edge[]> => {
  const out: Edge[] = [];
  for (const edgeId of state.values()) {
    const e = await edgeByIdFast(edgeId);
    if (!e) continue;
    if (pack && e.pack !== pack) continue;
    if (e.s !== entityId && e.o !== entityId) continue;
    if (!isActiveAt(e.validFrom, e.validTo, asOfIso)) continue;
    out.push(e);
  }
  out.sort((a, b) => a.edgeKey.localeCompare(b.edgeKey));
  return out;
};

export const computeSnapshotForEntity = async (
  entityId: string,
  asOfIso: string,
  pack: string | null,
): Promise<{ day: string; entries: readonly SnapshotEntry[]; edges: readonly Edge[] }> => {
  const day = ymdUtc(asOfIso);
  const edges = await edgesAsOfFallback(entityId, asOfIso, pack);
  const entries: SnapshotEntry[] = edges.map((e) => ({ edgeKey: e.edgeKey, edgeId: e.id }));
  entries.sort((a, b) => a.edgeKey.localeCompare(b.edgeKey));
  return { day, entries, edges };
};
