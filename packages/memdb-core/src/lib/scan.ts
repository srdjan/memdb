import { listFilesRec, pjoin, dbRoot, readJson } from "./fs.ts";
import type { Entity, Edge, Event } from "./model.ts";

export type EntityIndex = Readonly<Record<string, { type: string; dir: string }>>; // id -> (type, absolute dir)

export const scanEntities = async (): Promise<{ entities: EntityIndex; entityDocs: Record<string, Entity> }> => {
  const root = dbRoot();
  const entRoot = pjoin(root, "entities");
  const files = await listFilesRec(entRoot);
  const idx: Record<string, { type: string; dir: string }> = {};
  const docs: Record<string, Entity> = {};
  for (const f of files) {
    if (!f.endsWith("props.json")) continue;
    const ent = await readJson<Entity>(f);
    // entities/<type>/<id>/props.json
    const parts = f.split(/[\\/]/);
    const i = parts.lastIndexOf("entities");
    const type = parts[i + 1];
    const id = parts[i + 2];
    const dir = parts.slice(0, -1).join("/");
    idx[id] = { type, dir };
    docs[id] = ent;
  }
  return { entities: idx, entityDocs: docs };
};

export const scanEdges = async (): Promise<Record<string, Edge>> => {
  const root = dbRoot();
  const edgesRoot = pjoin(root, "edges");
  const files = await listFilesRec(edgesRoot);
  const byId: Record<string, Edge> = {};
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const edge = await readJson<Edge>(f);
    byId[edge.id] = edge;
  }
  return byId;
};

export const scanEvents = async (): Promise<Record<string, Event>> => {
  const root = dbRoot();
  const evRoot = pjoin(root, "events");
  const files = await listFilesRec(evRoot);
  const byId: Record<string, Event> = {};
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const evt = await readJson<Event>(f);
    byId[evt.id] = evt;
  }
  return byId;
};
