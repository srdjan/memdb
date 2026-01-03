import { dbRoot, exists, mkdirp, pjoin, readJson, writeJson } from "./fs.ts";
import type { VectorItem, Tags } from "./model.ts";
import { nowIso } from "./time.ts";
import { vectorItemPath } from "./vector_paths.ts";
import { loadPointers, savePointers } from "./indexes.ts";

export type UpsertVectorInput = Readonly<{
  id: string;
  kind: VectorItem["kind"];
  pack?: string;
  embedding: readonly number[];
  tags?: Tags;
}>;

const dot = (a: readonly number[], b: readonly number[]): number => {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
};

const norm = (a: readonly number[]): number => Math.sqrt(dot(a, a));

const cosine = (a: readonly number[], b: readonly number[]): number => {
  const d = dot(a, b);
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) return 0;
  return d / (na * nb);
};

export const upsertVector = async (inp: UpsertVectorInput): Promise<VectorItem> => {
  const item: VectorItem = {
    id: inp.id,
    kind: inp.kind,
    pack: inp.pack,
    dims: inp.embedding.length,
    embedding: inp.embedding,
    recordedAt: nowIso(),
    tags: inp.tags,
  };

  const p = vectorItemPath(inp.id);
  await mkdirp(pjoin(dbRoot(), "kv", "vectors", "items"));
  await writeJson(p, item);

  const ptr = await loadPointers();
  await savePointers({
    ...ptr,
    vector: { ...ptr.vector, [inp.id]: p.startsWith(dbRoot()) ? p.slice(dbRoot().length + 1) : p },
  });

  return item;
};

export type VectorSearchInput = Readonly<{
  query: readonly number[];
  topK: number;
  filter?: Readonly<{ pack?: string; kind?: VectorItem["kind"] }>;
}>;

export const searchVectors = async (inp: VectorSearchInput): Promise<readonly Readonly<{ id: string; score: number; item: VectorItem }>[]> => {
  const ptr = await loadPointers();
  const out: Array<{ id: string; score: number; item: VectorItem }> = [];

  for (const [id, rel] of Object.entries(ptr.vector ?? {})) {
    const abs = pjoin(dbRoot(), rel);
    if (!(await exists(abs))) continue;
    const item = await readJson<VectorItem>(abs);
    if (inp.filter?.pack && item.pack !== inp.filter.pack) continue;
    if (inp.filter?.kind && item.kind !== inp.filter.kind) continue;
    if (item.dims !== inp.query.length) continue;

    const score = cosine(inp.query, item.embedding);
    out.push({ id, score, item });
  }

  out.sort((a, b) => b.score - a.score);
  return out.slice(0, Math.max(1, inp.topK));
};
