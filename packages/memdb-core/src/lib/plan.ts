import { dbRoot, exists, pjoin, readJson } from "./fs.ts";
import { loadPointers, adjGet, timelinePath } from "./indexes.ts";
import { loadCurrentView } from "./views.ts";
import type { Edge, Event } from "./model.ts";

export const edgeById = async (edgeId: string): Promise<Edge | null> => {
  const ptr = await loadPointers();
  const rel = ptr.edge[edgeId];
  if (rel) {
    const abs = pjoin(dbRoot(), rel);
    if (await exists(abs)) return await readJson<Edge>(abs);
  }
  return null;
};

export const eventById = async (eventId: string): Promise<Event | null> => {
  const ptr = await loadPointers();
  const rel = ptr.event[eventId];
  if (rel) {
    const abs = pjoin(dbRoot(), rel);
    if (await exists(abs)) return await readJson<Event>(abs);
  }
  return null;
};

export const currentAdjEdges = async (entityId: string): Promise<readonly string[]> => {
  const v = await loadCurrentView(entityId);
  if (v) return v.edges;
  return Array.from(await adjGet(entityId));
};

export const timelineEventIds = async (entityId: string): Promise<readonly string[]> => {
  const p = timelinePath(entityId);
  if (!(await exists(p))) return [];
  const s = (await Deno.readTextFile(p)).trim();
  if (!s) return [];
  return s.split(/\r?\n/g).map((x) => x.trim()).filter(Boolean);
};
