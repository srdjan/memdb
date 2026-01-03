import { dbRoot, exists, pjoin, readJson, writeJson, readText, writeText, mkdirp } from "./fs.ts";

export type Pointers = Readonly<{
  entity: Record<string, string>;
  edge: Record<string, string>;
  event: Record<string, string>;
  content: Record<string, string>;
  vector: Record<string, string>;
}>;

const pointersPath = (): string => pjoin(dbRoot(), "kv", "pointers.json");

export const loadPointers = async (): Promise<Pointers> => {
  const p = pointersPath();
  if (!(await exists(p))) return { entity: {}, edge: {}, event: {}, content: {}, vector: {} };
  const v = await readJson<Partial<Pointers>>(p);
  return {
    entity: v.entity ?? {},
    edge: v.edge ?? {},
    event: v.event ?? {},
    content: (v as any).content ?? {},
    vector: (v as any).vector ?? {},
  };
};

export const savePointers = async (ptr: Pointers): Promise<void> => {
  await writeJson(pointersPath(), ptr);
};

export const upsertPointer = async (kind: "entity" | "edge" | "event", id: string, relPath: string): Promise<void> => {
  const p = await loadPointers();
  const next: Pointers = {
    entity: { ...p.entity },
    edge: { ...p.edge },
    event: { ...p.event },
  };
  next[kind][id] = relPath;
  await savePointers(next);
};

const adjDir = (): string => pjoin(dbRoot(), "kv", "adj_current");
const adjAllDir = (): string => pjoin(dbRoot(), "kv", "adj_all");
const timelineDir = (): string => pjoin(dbRoot(), "kv", "timeline");

export const adjPath = (entityId: string): string => pjoin(adjDir(), `${entityId}.idx`);
export const adjAllPath = (entityId: string): string => pjoin(adjAllDir(), `${entityId}.idx`);
export const timelinePath = (entityId: string): string => pjoin(timelineDir(), `${entityId}.idx`);

const readIdxLines = async (filePath: string): Promise<string[]> => {
  if (!(await exists(filePath))) return [];
  const s = (await readText(filePath)).trim();
  if (!s) return [];
  return s.split(/\r?\n/g).map((x) => x.trim()).filter(Boolean);
};

const writeIdxLines = async (filePath: string, lines: readonly string[]): Promise<void> => {
  await mkdirp(pjoin(dbRoot(), "kv"));
  await mkdirp(adjDir());
  await mkdirp(adjAllDir());
  await mkdirp(timelineDir());
  const uniq = Array.from(new Set(lines)).sort(); // deterministic
  await writeText(filePath, uniq.join("\n") + (uniq.length ? "\n" : ""));
};

export const adjGet = async (entityId: string): Promise<Set<string>> =>
  new Set(await readIdxLines(adjPath(entityId)));

export const adjReplaceEdge = async (entityId: string, removeId: string | null, addId: string): Promise<void> => {
  const s = await adjGet(entityId);
  if (removeId) s.delete(removeId);
  s.add(addId);
  await writeIdxLines(adjPath(entityId), Array.from(s));
};

export const timelineAppend = async (entityId: string, eventId: string): Promise<void> => {
  const lines = await readIdxLines(timelinePath(entityId));
  lines.push(eventId);
  await writeIdxLines(timelinePath(entityId), lines);
};

export const adjAllGet = async (entityId: string): Promise<Set<string>> =>
  new Set(await readIdxLines(adjAllPath(entityId)));

export const adjAllAppend = async (entityId: string, edgeId: string): Promise<void> => {
  const s = await adjAllGet(entityId);
  s.add(edgeId);
  await writeIdxLines(adjAllPath(entityId), Array.from(s));
};
