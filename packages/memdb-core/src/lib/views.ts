import { dbRoot, exists, pjoin, readJson, writeJson } from "./fs.ts";
import type { CurrentEntityView } from "./model.ts";

export const currentViewPath = (entityId: string): string =>
  pjoin(dbRoot(), "views", "current", `${entityId}.json`);

export const loadCurrentView = async (entityId: string): Promise<CurrentEntityView | null> => {
  const p = currentViewPath(entityId);
  if (!(await exists(p))) return null;
  return await readJson<CurrentEntityView>(p);
};

export const saveCurrentView = async (v: CurrentEntityView): Promise<void> => {
  await writeJson(currentViewPath(v.entityId), v);
};

export const upsertCurrentViewEdge = async (entityId: string, removeEdgeId: string | null, addEdgeId: string, asOfIso: string): Promise<void> => {
  const cur = await loadCurrentView(entityId);
  const edges = new Set<string>(cur?.edges ?? []);
  if (removeEdgeId) edges.delete(removeEdgeId);
  edges.add(addEdgeId);
  await saveCurrentView({
    entityId,
    asOf: asOfIso,
    edges: Array.from(edges).sort(),
  });
};
