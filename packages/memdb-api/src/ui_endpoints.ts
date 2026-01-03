import { dbRoot, exists, pjoin, readJson } from "@memdb/core/lib/fs.ts";
import type { Entity } from "@memdb/core/lib/model.ts";

type EntityRow = Readonly<{ id: string; type: string; key: string; pack: string }>;

export const listPacks = async (): Promise<readonly string[]> => {
  const root = dbRoot();
  const asof = pjoin(root, "views", "asof");
  const packs = new Set<string>(["all"]);
  if (await exists(asof)) {
    for await (const e of Deno.readDir(asof)) {
      if (e.isDirectory) packs.add(e.name);
    }
  }
  return Array.from(packs).sort();
};

export const listEntities = async (pack: string | null): Promise<readonly EntityRow[]> => {
  const root = dbRoot();
  const ptrPath = pjoin(root, "kv", "pointers.json");
  if (!(await exists(ptrPath))) return [];
  const ptr = await readJson<{ entity: Record<string, string> }>(ptrPath);

  const out: EntityRow[] = [];
  for (const [id, rel] of Object.entries(ptr.entity ?? {})) {
    const abs = pjoin(root, rel);
    if (!(await exists(abs))) continue;
    const ent = await readJson<Entity>(abs);
    if (pack && ent.pack !== pack) continue;
    out.push({ id: ent.id, type: ent.type, key: ent.key, pack: ent.pack });
  }
  out.sort((a, b) => a.key.localeCompare(b.key));
  return out;
};

export const getEntity = async (id: string): Promise<Entity | null> => {
  const root = dbRoot();
  const ptrPath = pjoin(root, "kv", "pointers.json");
  if (!(await exists(ptrPath))) return null;
  const ptr = await readJson<{ entity: Record<string, string> }>(ptrPath);
  const rel = ptr.entity?.[id];
  if (!rel) return null;
  const abs = pjoin(root, rel);
  if (!(await exists(abs))) return null;
  return await readJson<Entity>(abs);
};
