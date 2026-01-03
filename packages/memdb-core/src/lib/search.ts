import { dbRoot, exists, pjoin, readJson } from "./fs.ts";
import type { Content, Edge, Entity } from "./model.ts";
import { loadPointers } from "./indexes.ts";

const norm = (s: string): string => s.toLowerCase();

const matchAny = (hay: readonly string[], q: string): boolean => {
  const qq = norm(q);
  return hay.some((x) => norm(x).includes(qq));
};

export const searchEntities = async (q: string, pack: string | null): Promise<readonly Entity[]> => {
  const ptr = await loadPointers();
  const out: Entity[] = [];
  for (const [id, rel] of Object.entries(ptr.entity ?? {})) {
    const abs = pjoin(dbRoot(), rel);
    if (!(await exists(abs))) continue;
    const ent = await readJson<Entity>(abs);
    if (pack && ent.tags?.pack !== pack) continue;
    const tags = Object.entries(ent.tags ?? {}).map(([k, v]) => `${k}:${v}`);
    if (matchAny([ent.key, ent.type, ...tags], q)) out.push(ent);
  }
  out.sort((a, b) => a.key.localeCompare(b.key));
  return out;
};

export const searchContents = async (q: string, pack: string | null): Promise<readonly Content[]> => {
  const ptr = await loadPointers();
  const out: Content[] = [];
  for (const [id, rel] of Object.entries(ptr.content ?? {})) {
    const abs = pjoin(dbRoot(), rel);
    if (!(await exists(abs))) continue;
    const c = await readJson<Content>(abs);
    if (pack && c.tags?.pack !== pack) continue;
    const tags = Object.entries(c.tags ?? {}).map(([k, v]) => `${k}:${v}`);
    if (matchAny([c.uri ?? "", c.source ?? "", c.mime ?? "", c.excerpt ?? "", ...tags], q)) out.push(c);
  }
  out.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  return out;
};

export const searchFacts = async (q: string, pack: string | null): Promise<readonly Edge[]> => {
  const ptr = await loadPointers();
  const out: Edge[] = [];
  for (const [id, rel] of Object.entries(ptr.edge ?? {})) {
    const abs = pjoin(dbRoot(), rel);
    if (!(await exists(abs))) continue;
    const e = await readJson<Edge>(abs);
    if (pack && e.pack !== pack) continue;
    const tags = Object.entries(e.tags ?? {}).map(([k, v]) => `${k}:${v}`);
    if (matchAny([e.predicate, e.s, e.o, e.edgeKey, ...tags], q)) out.push(e);
  }
  out.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  return out;
};
