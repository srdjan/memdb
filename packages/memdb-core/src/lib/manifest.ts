import { dbRoot, exists, mkdirp, pjoin, readJson, writeJson } from "./fs.ts";
import type { EntityManifest, SegmentRange, HealthMetrics } from "./model.ts";

const manifestDir = (): string => pjoin(dbRoot(), "kv", "manifests");
export const manifestPath = (entityId: string): string => pjoin(manifestDir(), `${entityId}.json`);

const nowIso = (): string => new Date().toISOString();

const normalizeSegments = (segs: readonly SegmentRange[]): readonly SegmentRange[] => {
  const sorted = segs.slice().sort((a, b) => a.startDay.localeCompare(b.startDay));
  const out: SegmentRange[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (!last) { out.push(s); continue; }
    // if overlapping or adjacent, merge
    if (s.startDay <= last.endDay) {
      out[out.length - 1] = { startDay: last.startDay, endDay: s.endDay > last.endDay ? s.endDay : last.endDay };
    } else {
      out.push(s);
    }
  }
  return out;
};

export const loadManifest = async (entityId: string): Promise<EntityManifest | null> => {
  const p = manifestPath(entityId);
  if (!(await exists(p))) return null;
  return await readJson<EntityManifest>(p);
};

export const saveManifest = async (m: EntityManifest): Promise<void> => {
  await mkdirp(manifestDir());
  await writeJson(manifestPath(m.entityId), m);
};

export const ensureManifest = async (entityId: string): Promise<EntityManifest> => {
  const m = await loadManifest(entityId);
  if (m) return m;
  return { entityId, updatedAt: nowIso(), checkpointsByPack: {}, segments: [], healthByPack: {} };
};

export const addCheckpointToManifest = async (entityId: string, packKey: string, checkpointAtIso: string): Promise<void> => {
  const m = await ensureManifest(entityId);
  const prev = m.checkpointsByPack[packKey] ?? [];
  const set = new Set(prev);
  set.add(checkpointAtIso);
  const next: EntityManifest = {
    ...m,
    updatedAt: nowIso(),
    checkpointsByPack: { ...m.checkpointsByPack, [packKey]: Array.from(set).sort() },
  };
  await saveManifest(next);
};

export const addSegmentToManifest = async (entityId: string, range: SegmentRange): Promise<void> => {
  const m = await ensureManifest(entityId);
  const nextSegs = normalizeSegments([...m.segments, range]);
  const next: EntityManifest = {
    ...m,
    updatedAt: nowIso(),
    segments: nextSegs,
  };
  await saveManifest(next);
};

export const rebuildManifest = async (entityId: string, checkpointsByPack: Record<string, readonly string[]>, segments: readonly SegmentRange[]): Promise<void> => {
  const next: EntityManifest = {
    entityId,
    updatedAt: nowIso(),
    checkpointsByPack: Object.fromEntries(Object.entries(checkpointsByPack).map(([k, v]) => [k, Array.from(new Set(v)).sort()])),
    segments: normalizeSegments(segments),
  };
  await saveManifest(next);
};

export const setHealthInManifest = async (entityId: string, packKey: string, metrics: HealthMetrics): Promise<void> => {
  const m = await ensureManifest(entityId);
  const next: EntityManifest = {
    ...m,
    updatedAt: nowIso(),
    healthByPack: { ...(m.healthByPack ?? {}), [packKey]: metrics },
  };
  await saveManifest(next);
};
