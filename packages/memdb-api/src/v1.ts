import {
  dbRoot,
  exists,
  mkdirp,
  pjoin,
  readJson,
  readText,
  writeJson,
  writeText,
  listFilesRec,
} from "@memdb/core/lib/fs.ts";
import type { Edge, Entity, Event, Ref, Tags, Content, VectorItem } from "@memdb/core/lib/model.ts";
import { makeId } from "@memdb/core/lib/ids.ts";
import { nowIso, isActiveAt } from "@memdb/core/lib/time.ts";
import { entityPropsPath, eventJsonPath, edgeJsonPath, edgeCurrentPtrPath } from "@memdb/core/lib/paths.ts";
import { upsertPointer, adjReplaceEdge, adjAllAppend, timelineAppend, loadPointers } from "@memdb/core/lib/indexes.ts";
import { tursoQueryCanonicalNeighbors, tursoUpsertCanonicalEdges } from "@memdb/turso/sync.ts";
import { getTurso, tursoFlags } from "./turso.ts";
import { edgeKeyOf, sha256Hex } from "@memdb/core/lib/hash.ts";
import { loadPack } from "@memdb/core/lib/packs.ts";
import { addDefaultRetention, inferSensitiveTags } from "@memdb/core/lib/governance.ts";
import { validateEntityAgainstPack, validateEventAgainstPack, validateEdgeAgainstPack } from "@memdb/core/lib/validate.ts";
import { appendDelta } from "@memdb/core/lib/deltas.ts";
import { upsertCurrentViewEdge } from "@memdb/core/lib/views.ts";
import { currentAdjEdges, edgeById, timelineEventIds, eventById } from "@memdb/core/lib/plan.ts";
import { edgesAsOfForEntity } from "@memdb/core/lib/asof.ts";
import { putContent, getContent, listContents } from "@memdb/core/lib/content.ts";
import { upsertVector, searchVectors } from "@memdb/core/lib/vectors.ts";
import { searchEntities, searchContents, searchFacts } from "@memdb/core/lib/search.ts";
import { resolveEntity, persistResolution } from "@memdb/core/lib/resolver.ts";
import { relLink } from "@memdb/core/lib/rel.ts";
import { compile, render } from "@memdb/core/lib/render.ts";
import { scanEntities, scanEdges, scanEvents } from "@memdb/core/lib/scan.ts";

export type ApiError = Readonly<{ error: string; details?: unknown }>;

const die = (msg: string, details?: unknown): never => {
  const e = new Error(msg);
  // @ts-ignore attach details
  (e as any).details = details;
  throw e;
};

const normalizeTags = (tags: unknown): Tags => {
  if (!tags || typeof tags !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tags as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
    else if (v === null || v === undefined) continue;
    else out[k] = String(v);
  }
  return out;
};

const normalizeRefs = (refs: unknown): readonly Ref[] => {
  if (!Array.isArray(refs)) return [];
  return refs.map((r) => {
    const kind = String((r as any)?.kind ?? "");
    const id = String((r as any)?.id ?? "");
    if (!kind || !id) die("Invalid ref: expected { kind, id }", r);
    return { kind, id } as Ref;
  });
};

// Deterministic entity ids (useful for shared coordination primitives like work pools).
// This avoids duplicate entities when different agents independently create the same logical object.
const deterministicEntityId = async (pack: string, type: string, key: string): Promise<string> =>
  `ent_${(await sha256Hex(`${pack}:${type}:${key}`)).slice(0, 26)}`;

const normTopic = (s: string): string => s.trim().replace(/\s+/g, " ");

const ensureEntityDet = async (
  packName: string,
  type: string,
  key: string,
  tagsExtra: Tags,
): Promise<Readonly<{ id: string; entity: Entity; created: boolean }>> => {
  const id = await deterministicEntityId(packName, type, key);

  const p = entityPropsPath(type, id);
  if (await exists(p)) {
    const entity = await readJson<Entity>(p);
    return { id, entity, created: false };
  }

  const tags0 = { ...normalizeTags(tagsExtra), pack: packName };
  const pack = await loadPack(packName);
  const tags1 = addDefaultRetention(pack, inferSensitiveTags(pack, type, tags0));
  const errs = validateEntityAgainstPack(pack, type, tags1);
  if (errs.length) die("Entity validation failed", errs);

  const entity: Entity = { id, type, key, createdAt: nowIso(), tags: tags1 };
  await writeJson(p, entity);
  await upsertPointer("entity", id, `entities/${type}/${id}/props.json`);
  await writeText(pjoin(dbRoot(), "kv", "entity_current", `${id}.txt`), `entities/${type}/${id}/props.json\n`);
  return { id, entity, created: true };
};

const loadEdgeCurrentId = async (edgeKey: string): Promise<string | null> => {
  const p = edgeCurrentPtrPath(edgeKey);
  if (!(await exists(p))) return null;
  const s = (await readText(p)).trim();
  return s ? s.split(/\s+/)[0] : null;
};

const listEntityIds = async (): Promise<readonly string[]> => {
  const manDir = pjoin(dbRoot(), "kv", "manifests");
  if (!(await exists(manDir))) return [];
  const ids: string[] = [];
  for await (const e of Deno.readDir(manDir)) {
    if (e.isFile && e.name.endsWith(".json")) ids.push(e.name.replace(/\.json$/, ""));
  }
  ids.sort();
  return ids;
};

export const v1 = {
  init: async (): Promise<Readonly<{ ok: true }>> => {
    // mimic CLI init (directories)
    const root = dbRoot();
    await mkdirp(pjoin(root, "entities"));
    await mkdirp(pjoin(root, "edges"));
    await mkdirp(pjoin(root, "events"));
    await mkdirp(pjoin(root, "deltas"));
    await mkdirp(pjoin(root, "segments"));
    await mkdirp(pjoin(root, "views", "current"));
    await mkdirp(pjoin(root, "views", "asof"));
    await mkdirp(pjoin(root, "kv", "adj_current"));
    await mkdirp(pjoin(root, "kv", "adj_all"));
    await mkdirp(pjoin(root, "kv", "edge_current"));
    await mkdirp(pjoin(root, "kv", "entity_current"));
    await mkdirp(pjoin(root, "kv", "manifests"));
    await mkdirp(pjoin(root, "kv", "auth"));
    // packs are loaded from repo or db; nothing required here
    return { ok: true };
  },

  // Entities
  createEntity: async (body: unknown): Promise<Readonly<{ id: string; entity: Entity }>> => {
    const packName = String((body as any)?.pack ?? "");
    const type = String((body as any)?.type ?? "");
    const key = String((body as any)?.key ?? "");
    if (!packName) die("Missing pack");
    if (!type) die("Missing type");
    if (!key) die("Missing key");

    const tags0 = normalizeTags((body as any)?.tags);
    tags0["pack"] = packName;

    const pack = await loadPack(packName);
    const tags1 = addDefaultRetention(pack, inferSensitiveTags(pack, type, tags0));
    const errs = validateEntityAgainstPack(pack, type, tags1);
    if (errs.length) die("Entity validation failed", errs);

    const id = makeId("ent");
    const ent: Entity = { id, type, key, createdAt: nowIso(), tags: tags1 };

    await writeJson(entityPropsPath(type, id), ent);
    await upsertPointer("entity", id, `entities/${type}/${id}/props.json`);
    await writeText(pjoin(dbRoot(), "kv", "entity_current", `${id}.txt`), `entities/${type}/${id}/props.json\n`);

    return { id, entity: ent };
  },

  getEntityById: async (id: string): Promise<Entity | null> => {
    const ptr = await loadPointers();
    const rel = ptr.entity[id];
    if (!rel) return null;
    const abs = pjoin(dbRoot(), rel);
    if (!(await exists(abs))) return null;
    return await readJson<Entity>(abs);
  },

  listEntities: async (pack: string | null): Promise<readonly Entity[]> => {
    // best-effort listing via pointers (may be large in real usage)
    const ptr = await loadPointers();
    const out: Entity[] = [];
    for (const [id, rel] of Object.entries(ptr.entity ?? {})) {
      const abs = pjoin(dbRoot(), rel);
      if (!(await exists(abs))) continue;
      const ent = await readJson<Entity>(abs);
      if (pack && ent.tags?.pack !== pack && (ent as any).pack !== pack) continue;
      out.push(ent);
    }
    out.sort((a, b) => a.key.localeCompare(b.key));
    return out;
  },

  // Events
  createEvent: async (body: unknown): Promise<Readonly<{ id: string; event: Event }>> => {
    const packName = String((body as any)?.pack ?? "");
    const kind = String((body as any)?.kind ?? "");
    const agentId = String((body as any)?.agentId ?? "agent_01");
    if (!packName) die("Missing pack");
    if (!kind) die("Missing kind");

    const refs = normalizeRefs((body as any)?.refs);
    const tags0 = normalizeTags((body as any)?.tags);
    tags0["pack"] = packName;

    const pack = await loadPack(packName);
    const tags1 = addDefaultRetention(pack, inferSensitiveTags(pack, kind, tags0));
    const errs = validateEventAgainstPack(pack, kind, tags1);
    if (errs.length) die("Event validation failed", errs);

    const id = makeId("evt");
    const recordedAt = nowIso();
    const evt: Event = { id, agentId, kind, recordedAt, pack: packName, tags: tags1, refs };

    await writeJson(eventJsonPath(recordedAt, id), evt);
    // pointer rel path mirrors CLI's yyyy/mm/dd layout
    const d = new Date(recordedAt);
    const yyyy = String(d.getUTCFullYear());
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    await upsertPointer("event", id, `events/${yyyy}/${mm}/${dd}/${id}.json`);

    for (const r of refs) if (r.kind === "entity") await timelineAppend(r.id, id);
    return { id, event: evt };
  },

  // Edges
  createEdge: async (body: unknown): Promise<Readonly<{ id: string; edge: Edge }>> => {
    const packName = String((body as any)?.pack ?? "");
    const predicate = String((body as any)?.predicate ?? "");
    const s = String((body as any)?.s ?? "");
    const o = String((body as any)?.o ?? "");
    const sourceEventId = String((body as any)?.sourceEventId ?? "");
    const validFrom = String((body as any)?.validFrom ?? nowIso());
    const confidence = Number((body as any)?.confidence ?? 1.0);

    if (!packName) die("Missing pack");
    if (!predicate) die("Missing predicate");
    if (!s) die("Missing s");
    if (!o) die("Missing o");
    if (!sourceEventId) die("Missing sourceEventId");
    if (!(confidence >= 0 && confidence <= 1)) die("confidence must be 0..1");

    const tags0 = normalizeTags((body as any)?.tags);
    tags0["pack"] = packName;

    const pack = await loadPack(packName);
    const tags1 = addDefaultRetention(pack, inferSensitiveTags(pack, predicate, tags0));
    const errs = validateEdgeAgainstPack(pack, predicate, tags1);
    if (errs.length) die("Edge validation failed", errs);

    // Optional pack policy: auto-close conflicting intervals in the observed lane.
    const status = String((tags1 as any)?.status ?? "observed");
    const cps = (pack.policy as any)?.conflictPolicies as readonly any[] | undefined;
    const cp = cps?.find((x) => String(x?.predicate ?? "") === predicate && String(x?.uniqueness ?? "") === "one_per_subject");
    if (cp && status !== "canonical" && status !== "synthesized") {
      const lane = String(cp?.lane ?? "observed");
      // observed lane by default: do not auto-close canonical facts
      const active = await edgesAsOfForEntity(s, validFrom, packName);
      const conflicts = active.filter((e) =>
        e.predicate === predicate &&
        e.s === s &&
        e.o !== o &&
        (lane === "all" ? true : String((e.tags as any)?.status ?? "observed") !== "canonical") &&
        String((e.tags as any)?.status ?? "observed") !== "synthesized"
      );
      if (conflicts.length) {
        const evt = await v1.createEvent({
          pack: "core",
          kind: "sys/auto_retract",
          agentId: "memdb",
          refs: [{ kind: "entity", id: s }],
          tags: { predicate, subject: s, object: o, pack: packName, reason: "conflict_auto_close" },
        });
        for (const c of conflicts) {
          await v1.retractEdge({
            pack: packName,
            predicate,
            s: c.s,
            o: c.o,
            sourceEventId: evt.id,
            validTo: validFrom,
            confidence: 1.0,
            tags: { status: String((c.tags as any)?.status ?? "observed"), reason: "auto_conflict_close" },
          });
        }
      }
    }

    const edgeKey = await edgeKeyOf(predicate, s, o);
    const prior = await loadEdgeCurrentId(edgeKey);

    const id = makeId("edge");
    const edge: Edge = {
      id,
      edgeKey,
      predicate,
      s,
      o,
      validFrom,
      validTo: null,
      recordedAt: nowIso(),
      confidence,
      sourceEventId,
      supersedes: prior,
      pack: packName,
      tags: tags1,
    };

    await writeJson(edgeJsonPath(predicate, id), edge);
    await upsertPointer("edge", id, `edges/${predicate}/${id}.json`);

    // update adjacency and deltas for both endpoints
    await adjReplaceEdge(s, prior, id);
    await adjReplaceEdge(o, prior, id);
    await adjAllAppend(s, id);
    await adjAllAppend(o, id);

    await appendDelta({ ts: edge.recordedAt, entityId: s, pack: packName, edgeKey, addEdgeId: id, removeEdgeId: prior });
    await appendDelta({ ts: edge.recordedAt, entityId: o, pack: packName, edgeKey, addEdgeId: id, removeEdgeId: prior });

    await upsertCurrentViewEdge(s, prior, id, nowIso());
    await upsertCurrentViewEdge(o, prior, id, nowIso());

    await writeText(edgeCurrentPtrPath(edgeKey), `${id}\n`);

    return { id, edge };
  },

  retractEdge: async (body: unknown): Promise<Readonly<{ id: string; edge: Edge }>> => {
    const packName = String((body as any)?.pack ?? "");
    const predicate = String((body as any)?.predicate ?? "");
    const s = String((body as any)?.s ?? "");
    const o = String((body as any)?.o ?? "");
    const sourceEventId = String((body as any)?.sourceEventId ?? "");
    const validTo = String((body as any)?.validTo ?? "");
    const confidence = Number((body as any)?.confidence ?? 1.0);

    if (!packName) die("Missing pack");
    if (!predicate) die("Missing predicate");
    if (!s) die("Missing s");
    if (!o) die("Missing o");
    if (!sourceEventId) die("Missing sourceEventId");
    if (!validTo) die("Missing validTo");
    if (!(confidence >= 0 && confidence <= 1)) die("confidence must be 0..1");

    const tags0 = normalizeTags((body as any)?.tags);
    tags0["pack"] = packName;

    const pack = await loadPack(packName);
    const tags1 = addDefaultRetention(pack, inferSensitiveTags(pack, predicate, tags0));
    const errs = validateEdgeAgainstPack(pack, predicate, tags1);
    if (errs.length) die("Edge validation failed", errs);

    // Optional pack policy: auto-close conflicting intervals in the observed lane.
    const status = String((tags1 as any)?.status ?? "observed");
    const cps = (pack.policy as any)?.conflictPolicies as readonly any[] | undefined;
    const cp = cps?.find((x) => String(x?.predicate ?? "") === predicate && String(x?.uniqueness ?? "") === "one_per_subject");
    if (cp && status !== "canonical" && status !== "synthesized") {
      const lane = String(cp?.lane ?? "observed");
      // observed lane by default: do not auto-close canonical facts
      const active = await edgesAsOfForEntity(s, validFrom, packName);
      const conflicts = active.filter((e) =>
        e.predicate === predicate &&
        e.s === s &&
        e.o !== o &&
        (lane === "all" ? true : String((e.tags as any)?.status ?? "observed") !== "canonical") &&
        String((e.tags as any)?.status ?? "observed") !== "synthesized"
      );
      if (conflicts.length) {
        const evt = await v1.createEvent({
          pack: "core",
          kind: "sys/auto_retract",
          agentId: "memdb",
          refs: [{ kind: "entity", id: s }],
          tags: { predicate, subject: s, object: o, pack: packName, reason: "conflict_auto_close" },
        });
        for (const c of conflicts) {
          await v1.retractEdge({
            pack: packName,
            predicate,
            s: c.s,
            o: c.o,
            sourceEventId: evt.id,
            validTo: validFrom,
            confidence: 1.0,
            tags: { status: String((c.tags as any)?.status ?? "observed"), reason: "auto_conflict_close" },
          });
        }
      }
    }

    const edgeKey = await edgeKeyOf(predicate, s, o);
    const currentId = await loadEdgeCurrentId(edgeKey);
    if (!currentId) die("No current edge for (p,s,o)", { edgeKey });

    const current = await edgeById(currentId);
    if (!current) die("Current edge not found", { currentId });

    const id = makeId("edge");
    const edge: Edge = {
      ...current,
      id,
      validTo,
      recordedAt: nowIso(),
      confidence,
      sourceEventId,
      supersedes: currentId,
      pack: packName,
      tags: tags1,
    };

    await writeJson(edgeJsonPath(predicate, id), edge);
    await upsertPointer("edge", id, `edges/${predicate}/${id}.json`);

    // update adjacency: replace current with new, but do not keep as "current" since validTo ends it
    await adjReplaceEdge(s, currentId, id);
    await adjReplaceEdge(o, currentId, id);
    await adjAllAppend(s, id);
    await adjAllAppend(o, id);

    await appendDelta({ ts: edge.recordedAt, entityId: s, pack: packName, edgeKey, addEdgeId: id, removeEdgeId: currentId });
    await appendDelta({ ts: edge.recordedAt, entityId: o, pack: packName, edgeKey, addEdgeId: id, removeEdgeId: currentId });

    await upsertCurrentViewEdge(s, currentId, id, nowIso());
    await upsertCurrentViewEdge(o, currentId, id, nowIso());

    // current ptr updated to this id (even though it is retracted by validTo; clients should check activeAt)
    await writeText(edgeCurrentPtrPath(edgeKey), `${id}\n`);

    return { id, edge };
  },

  // Queries
  neighbors: async (entityId: string, asOfIso: string, pack: string | null): Promise<readonly Edge[]> => {
    // if asOf is provided: compute as-of via deltas/segments/checkpoints
    if (asOfIso) return await edgesAsOfForEntity(entityId, asOfIso, pack);
    // else current view fast path (still filtered by activeAt at now)
    const now = nowIso();
    const ids = await currentAdjEdges(entityId);
    const edges: Edge[] = [];
    for (const id of ids) {
      const e = await edgeById(id);
      if (!e) continue;
      if (pack && e.pack !== pack) continue;
      if (!isActiveAt(e.validFrom, e.validTo, now)) continue;
      edges.push(e);
    }
    return edges;
  },

  path: async (from: string, to: string, asOfIso: string, pack: string | null, maxDepth: number): Promise<Readonly<{ nodes: readonly string[]; steps: readonly { edgeId: string; predicate: string; from: string; to: string }[] }>> => {
    const asOf = asOfIso || nowIso();
    const loadNeighbors = async (id: string): Promise<readonly { other: string; edge: Edge }[]> => {
      const edges = await edgesAsOfForEntity(id, asOf, pack);
      const out: { other: string; edge: Edge }[] = [];
      for (const e of edges) {
        if (!isActiveAt(e.validFrom, e.validTo, asOf)) continue;
        const other = e.s === id ? e.o : e.s;
        out.push({ other, edge: e });
      }
      return out;
    };

    type Step = { via: Edge; to: string };
    type Node = { id: string; path: readonly Step[] };

    const seen = new Set<string>([from]);
    const q: Node[] = [{ id: from, path: [] }];

    while (q.length) {
      const cur = q.shift()!;
      if (cur.id === to) {
        const nodes = [from, ...cur.path.map((s) => s.to)];
        const steps = cur.path.map((s, idx) => ({
          edgeId: s.via.id,
          predicate: s.via.predicate,
          from: idx === 0 ? from : cur.path[idx - 1].to,
          to: s.to,
        }));
        return { nodes, steps };
      }
      if (cur.path.length >= maxDepth) continue;

      for (const n of await loadNeighbors(cur.id)) {
        if (seen.has(n.other)) continue;
        seen.add(n.other);
        q.push({ id: n.other, path: [...cur.path, { via: n.edge, to: n.other }] });
      }
    }

    die("No path found", { from, to, maxDepth });
  },

  timeline: async (entityId: string): Promise<Readonly<{ entityId: string; eventIds: readonly string[] }>> => {
    const ids = await timelineEventIds(entityId);
    return { entityId, eventIds: ids };
  },

  getEvent: async (id: string): Promise<Event | null> => await eventById(id),

  // small helper for dashboards: list entity ids known via manifests
  listEntityIds: async (): Promise<readonly string[]> => await listEntityIds(),
// Packs (agent memory templates / schemas)
listPacks: async (): Promise<readonly string[]> => {
  const dir = pjoin(dbRoot(), "packs");
  const out: string[] = [];
  if (await exists(dir)) {
    for await (const e of Deno.readDir(dir)) {
      if (e.isFile && e.name.endsWith(".json")) out.push(e.name.replace(/\.json$/, ""));
    }
  }
  out.sort();
  return out;
},

getPack: async (name: string): Promise<unknown | null> => {
  const fp = pjoin(dbRoot(), "packs", `${name}.json`);
  if (!(await exists(fp))) return null;
  return await readJson<unknown>(fp);
},

createPack: async (body: unknown): Promise<Readonly<{ name: string; pack: unknown }>> => {
  const name = String((body as any)?.name ?? "");
  const template = String((body as any)?.template ?? "");
  const packObj = (body as any)?.pack;

  if (!name) die("Missing name");

  const dir = pjoin(dbRoot(), "packs");
  await mkdirp(dir);

  const fp = pjoin(dir, `${name}.json`);
  if (await exists(fp)) die("Pack already exists", { name });

  const templates: Record<string, unknown> = {
    "coding_assistant": {
      "name": name,
      "kind": "pack",
      "version": 1,
      "description": "Memory pack for coding assistant agent",
      "defaults": { "retention": { "keepDailyDays": 7, "maxReplayHours": 24, "rollupEveryHours": 6 } },
      "entityTypes": ["file", "symbol", "repo", "issue", "pr", "doc", "message", "content"],
      "predicates": ["depends_on", "references", "implements", "fixes", "belongs_to", "mentions"],
      "eventKinds": ["observed", "commit", "review", "chat", "note", "fact_resolution", "fact_synthesized"],
      "rules": { "sensitiveTagKeys": ["pii", "secret", "credential"] }
    },
    "identity_verifier": {
      "name": name,
      "kind": "pack",
      "version": 1,
      "description": "Memory pack for identity verifier agent",
      "defaults": { "retention": { "keepDailyDays": 14, "maxReplayHours": 12, "rollupEveryHours": 3 } },
      "entityTypes": ["subject", "evidence", "credential", "claim", "policy", "session", "content"],
      "predicates": ["asserts", "verified_by", "issued_by", "revoked_by", "satisfies", "derived_from"],
      "eventKinds": ["evidence_started", "evidence_completed", "assurance_raised", "credential_issued", "credential_revoked", "fact_resolution", "fact_synthesized"],
      "rules": { "sensitiveTagKeys": ["pii", "biometric", "government_id"] }
    }
  };

  const pack = packObj ?? (template ? templates[template] : null);
  if (!pack) die("Missing pack or unknown template", { template, known: Object.keys(templates) });

  await writeJson(fp, pack);
  return { name, pack };
},

// Ops endpoints (REST parity with former CLI)
index: async (): Promise<Readonly<{ ok: true }>> => {
  const root = dbRoot();

  const { entities, entityDocs } = await scanEntities();
  const edgesById = await scanEdges();
  const eventsById = await scanEvents();

  // Rebuild pointers + adjacency + timeline deterministically (same semantics as old CLI index)
  const ptrEntity: Record<string, string> = {};
  const ptrEdge: Record<string, string> = {};
  const ptrEvent: Record<string, string> = {};

  // reset adj/timeline dirs
  const adjDir = pjoin(root, "kv", "adj_current");
  const tlDir = pjoin(root, "kv", "timeline");
  await mkdirp(adjDir);
  await mkdirp(tlDir);
  for await (const e of Deno.readDir(adjDir)) if (e.isFile) await Deno.remove(pjoin(adjDir, e.name));
  for await (const e of Deno.readDir(tlDir)) if (e.isFile) await Deno.remove(pjoin(tlDir, e.name));

  // entity pointers
  for (const [id, hit] of Object.entries(entities)) {
    ptrEntity[id] = `entities/${hit.type}/${id}/props.json`;
  }

  // edge pointers
  for (const e of Object.values(edgesById)) {
    ptrEdge[e.id] = `edges/${e.predicate}/${e.id}.json`;
  }

  // event pointers by scanning the events tree to recover dated paths
  const evRoot = pjoin(root, "events");
  if (await exists(evRoot)) {
    const evFiles = await listFilesRec(evRoot);
    for (const f of evFiles) {
      if (!f.endsWith(".json")) continue;
      const evt = await readJson<Event>(f);
      const rel = f.startsWith(root) ? f.slice(root.length).replace(/^\//, "").split(Deno.build.os === "windows" ? "\\" : "/").join("/") : f;
      ptrEvent[evt.id] = rel;

      // timeline: append to each referenced entity
      for (const r of evt.refs) {
        if (r.kind !== "entity") continue;
        const p = pjoin(tlDir, `${r.id}.idx`);
        const prev = (await exists(p)) ? (await readText(p)).trim().split(/\r?\n/g).filter(Boolean) : [];
        prev.push(evt.id);
        const uniq = Array.from(new Set(prev)).sort();
        await writeText(p, uniq.join("\n") + (uniq.length ? "\n" : ""));
      }
    }
  }

  // Rebuild delta logs (replay source) from edges in recordedAt order
  const deltasRoot = pjoin(root, "kv", "deltas");
  await mkdirp(deltasRoot);
  // clear existing deltas
  for await (const e of Deno.readDir(deltasRoot)) {
    if (e.isDirectory) await Deno.remove(pjoin(deltasRoot, e.name), { recursive: true });
  }

  const edgesSorted = Object.values(edgesById).slice().sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
  const ymdOf = (iso: string): string => {
    const d = new Date(iso);
    const yyyy = String(d.getUTCFullYear());
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };

  for (const e of edgesSorted) {
    const day = ymdOf(e.recordedAt);
    const rec = (entityId: string) => ({
      ts: e.recordedAt,
      entityId,
      pack: e.pack,
      edgeKey: e.edgeKey,
      addEdgeId: e.id,
      removeEdgeId: e.supersedes ?? null,
    });
    const endpoints = [e.s, e.o];
    for (const entId of endpoints) {
      const dir = pjoin(deltasRoot, entId);
      await mkdirp(dir);
      const fp = pjoin(dir, `${day}.ndjson`);
      await writeText(fp, JSON.stringify(rec(entId)) + "\n", { append: true });
    }
  }

  // adjacency: use edge_current pointers and wire to endpoints
  const ptrDir = pjoin(root, "kv", "edge_current");
  if (await exists(ptrDir)) {
    for await (const e of Deno.readDir(ptrDir)) {
      if (!e.isFile) continue;
      const id = (await readText(pjoin(ptrDir, e.name))).trim();
      if (!id) continue;
      const edge = edgesById[id] ?? await readJson<Edge>(pjoin(root, ptrEdge[id]));
      const ends = [edge.s, edge.o];
      for (const entId of ends) {
        const p = pjoin(adjDir, `${entId}.idx`);
        const prev = (await exists(p)) ? (await readText(p)).trim().split(/\r?\n/g).filter(Boolean) : [];
        prev.push(edge.id);
        const uniq = Array.from(new Set(prev)).sort();
        await writeText(p, uniq.join("\n") + (uniq.length ? "\n" : ""));
      }
    }
  }

  // Save pointers.json
  await (await import("@memdb/core/lib/indexes.ts")).savePointers({
      entity: ptrEntity,
      edge: ptrEdge,
      event: ptrEvent,
      content: (await (await import("@memdb/core/lib/indexes.ts")).loadPointers()).content ?? {},
      vector: (await (await import("@memdb/core/lib/indexes.ts")).loadPointers()).vector ?? {},
    });

  // Generate markdown views + tag indexes (same intent as old CLI "index")
  const tBase = new URL("../../memdb-core/templates/", import.meta.url);
  const tEntityRaw = await Deno.readTextFile(new URL("./entity.md.tmpl", tBase));
  const tEdgeRaw = await Deno.readTextFile(new URL("./edge.md.tmpl", tBase));
  const tEventRaw = await Deno.readTextFile(new URL("./event.md.tmpl", tBase));
  const tViewRaw = await Deno.readTextFile(new URL("./view_current_entity.md.tmpl", tBase));

  const tEntity = compile(tEntityRaw);
  const tEdge = compile(tEdgeRaw);
  const tEvent = compile(tEventRaw);
  const tView = compile(tViewRaw);

  const entityViewAbs = (entityId: string): string => {
    const hit = (entities as any)[entityId];
    if (!hit) return pjoin(root, "entities", "UNKNOWN", entityId, "entity.md");
    return pjoin(hit.dir, "entity.md");
  };

  // current edges from edge_current pointers
  const curEdges: Edge[] = [];
  if (await exists(ptrDir)) {
    for await (const e of Deno.readDir(ptrDir)) {
      if (!e.isFile) continue;
      const id = (await readText(pjoin(ptrDir, e.name))).trim();
      if (!id) continue;
      const edge = edgesById[id] ?? await readJson<Edge>(pjoin(root, ptrEdge[id]));
      curEdges.push(edge);
    }
  }

  await mkdirp(pjoin(root, "views", "current"));

  const tagIndex: Record<string, Record<string, string[]>> = {};
  const addTagRef = (tags: Record<string, string> | undefined, viewPathAbs: string) => {
    if (!tags) return;
    const viewRel = viewPathAbs.startsWith(root) ? viewPathAbs.slice(root.length).replace(/^\//, "").split(Deno.build.os === "windows" ? "\\" : "/").join("/") : viewPathAbs;
    for (const [k, v] of Object.entries(tags)) {
      tagIndex[k] ??= {};
      tagIndex[k][v] ??= [];
      tagIndex[k][v].push(viewRel);
    }
  };

  // Entities: write entity.md + current snapshots
  for (const [id, ent] of Object.entries(entityDocs)) {
    const viewAbs = entityViewAbs(id);
    const currentJsonAbs = pjoin(root, "views", "current", `${id}.json`);
    const currentMdAbs = pjoin(root, "views", "current", `${id}.md`);

    const neigh = curEdges.filter((e) => (e.s === id || e.o === id) && isActiveAt(e.validFrom, e.validTo, nowIso()));
    await writeJson(currentJsonAbs, { entityId: id, asOf: nowIso(), edges: neigh });

    const entityLink = relLink(currentMdAbs, viewAbs);
    const neighborsMd = neigh.map((e) => {
      const edgeAbs = pjoin(root, "edges", e.predicate, `${e.id}.md`);
      const edgeLink = relLink(currentMdAbs, edgeAbs);
      const other = e.s === id ? e.o : e.s;
      return `- [${e.predicate} ${e.id}](${edgeLink}) -> \`${other}\``;
    }).join("\n") || "- (none)";

    await writeText(currentMdAbs, render(tView, {
      entityId: id,
      entityLink,
      asOf: nowIso(),
      neighbors: neighborsMd,
    }));

    const tagsMd = Object.entries((ent as any).tags ?? {}).map(([k, v]) => `- ${k}: \`${String(v)}\``).join("\n") || "- (none)";
    const currentViewLink = relLink(viewAbs, currentMdAbs);
    await writeText(viewAbs, render(tEntity, {
      id: (ent as any).id,
      type: (ent as any).type,
      key: (ent as any).key,
      createdAt: (ent as any).createdAt,
      pack: (ent as any).tags?.pack ?? "",
      tags: tagsMd,
      currentViewLink,
    }));

    const notesAbs = pjoin(viewAbs.replace(/\/entity\.md$/, ""), "notes.md");
    if (!(await exists(notesAbs))) await writeText(notesAbs, `# Notes\n\n`);

    addTagRef((ent as any).tags, viewAbs);
  }

  // Edges: write edge markdown files
  for (const e of Object.values(edgesById)) {
    const edgeMdAbs = pjoin(root, "edges", e.predicate, `${e.id}.md`);
    const sAbs = entityViewAbs(e.s);
    const oAbs = entityViewAbs(e.o);
    const sLink = relLink(edgeMdAbs, sAbs);
    const oLink = relLink(edgeMdAbs, oAbs);

    await writeText(edgeMdAbs, render(tEdge, {
      id: e.id,
      edgeKey: e.edgeKey,
      predicate: e.predicate,
      validFrom: e.validFrom,
      validTo: e.validTo ?? "null",
      recordedAt: e.recordedAt,
      confidence: String(e.confidence),
      pack: e.pack,
      s: e.s,
      o: e.o,
      sLink,
      oLink,
      sourceEventId: e.sourceEventId,
      supersedes: e.supersedes ?? "null",
    }));

    addTagRef(e.tags, edgeMdAbs);
  }

  // Events: write event markdown next to its json
  if (await exists(evRoot)) {
    const files = await listFilesRec(evRoot);
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      const evt = await readJson<Event>(f);
      const mdAbs = f.replace(/\.json$/, ".md");

      const refsMd = evt.refs.map((r) => {
        if (r.kind === "entity") {
          const link = relLink(mdAbs, entityViewAbs(r.id));
          return `- entity: [${r.id}](${link})`;
        }
        if (r.kind === "edge") {
          const ed = edgesById[r.id];
          const linkAbs = ed ? pjoin(root, "edges", ed.predicate, `${ed.id}.md`) : pjoin(root, "edges", "UNKNOWN", `${r.id}.md`);
          const link = relLink(mdAbs, linkAbs);
          return `- edge: [${r.id}](${link})`;
        }
        const blobAbs = pjoin(root, "blobs", r.id);
        const link = relLink(mdAbs, blobAbs);
        return `- blob: [${r.id}](${link})`;
      }).join("\n") || "- (none)";

      await writeText(mdAbs, render(tEvent, {
        id: evt.id,
        agentId: evt.agentId,
        kind: evt.kind,
        recordedAt: evt.recordedAt,
        pack: evt.pack,
        refs: refsMd,
      }));

      addTagRef(evt.tags ?? { pack: evt.pack } as any, mdAbs);
    }
  }

  // Tag index files (kv/tags/<k>/<v>.idx)
  for (const [k, vs] of Object.entries(tagIndex)) {
    for (const [v, refs] of Object.entries(vs)) {
      const idxAbs = pjoin(root, "kv", "tags", k, `${v}.idx`);
      const uniq = Array.from(new Set(refs)).sort();
      await writeText(idxAbs, uniq.join("\n") + "\n");
    }
  }

  return { ok: true };
},


health: async (entityId: string, pack: string | null, asOf: string): Promise<unknown> => {
  const mod = await import("@memdb/core/lib/maintenance.ts");
  if (typeof (mod as any).health !== "function") die("core maintenance missing health()");
  return await (mod as any).health(entityId, pack, asOf);
},

maintain: async (entityId: string, pack: string | null, asOf: string): Promise<unknown> => {
  const mod = await import("@memdb/core/lib/maintenance.ts");
  if (typeof (mod as any).maintain !== "function") die("core maintenance missing maintain()");
  return await (mod as any).maintain(entityId, pack, asOf);
},

maintainAll: async (body: unknown): Promise<unknown> => {
  const pack = String((body as any)?.pack ?? "");
  const allPacks = Boolean((body as any)?.allPacks ?? false);
  const asOf = String((body as any)?.asOf ?? new Date().toISOString());

  const mod = await import("@memdb/core/lib/maintenance.ts");
  if (typeof (mod as any).maintain !== "function") die("core maintenance missing maintain()");

  const manDir = pjoin(dbRoot(), "kv", "manifests");
  const entities: string[] = [];
  if (await exists(manDir)) {
    for await (const e of Deno.readDir(manDir)) {
      if (!e.isFile) continue;
      if (!e.name.endsWith(".json")) continue;
      entities.push(e.name.replace(/\.json$/, ""));
    }
  }
  entities.sort();

  const results: any[] = [];
  for (const entId of entities) {
    try {
      if (!allPacks) {
        const r = await (mod as any).maintain(entId, pack ? pack : null, asOf);
        results.push({ entityId: entId, ok: true, pack: pack || "all", ...r });
      } else {
        const mp = pjoin(manDir, `${entId}.json`);
        const m = (await exists(mp)) ? await readJson<any>(mp) : null;
        const keys = Object.keys(m?.checkpointsByPack ?? {});
        const packKeys = keys.length ? keys : ["all"];
        const packsOut: any[] = [];
        for (const pk of packKeys) {
          const r = await (mod as any).maintain(entId, pk === "all" ? null : pk, asOf);
          packsOut.push({ pack: pk, ...r });
        }
        results.push({ entityId: entId, ok: true, packs: packsOut });
      }
    } catch (e) {
      results.push({ entityId: entId, ok: false, error: String((e as any)?.message ?? e) });
    }
  }

  return { asOf, pack: pack || "all", allPacks, entities: entities.length, results };
},

report: async (body: unknown): Promise<unknown> => {
  const pack = String((body as any)?.pack ?? "");
  const allPacks = Boolean((body as any)?.allPacks ?? false);
  const asOf = String((body as any)?.asOf ?? new Date().toISOString());
  const format = String((body as any)?.format ?? "json").toLowerCase();

  const maint = await import("@memdb/core/lib/maintenance.ts");
  const rep = await import("@memdb/core/lib/report.ts");

  if (typeof (maint as any).health !== "function") die("core maintenance missing health()");
  if (typeof (rep as any).computeStats !== "function") die("core report missing computeStats()");

  const manDir = pjoin(dbRoot(), "kv", "manifests");
  const entities: string[] = [];
  if (await exists(manDir)) {
    for await (const e of Deno.readDir(manDir)) {
      if (e.isFile && e.name.endsWith(".json")) entities.push(e.name.replace(/\.json$/, ""));
    }
  }
  entities.sort();

  const packKeys = allPacks
    ? (() => {
        const ks = new Set<string>();
        for (const entId of entities) {
          // best-effort
          // eslint-disable-next-line no-await-in-loop
          const mp = pjoin(manDir, `${entId}.json`);
          // eslint-disable-next-line no-await-in-loop
          const m = (await exists(mp)) ? await readJson<any>(mp) : null;
          for (const k of Object.keys(m?.checkpointsByPack ?? {})) ks.add(k);
        }
        if (!ks.size) ks.add("all");
        return Array.from(ks).sort();
      })()
    : [pack || "all"];

  const perPack: Record<string, any> = {};
  for (const pk of packKeys) {
    const reports: any[] = [];
    for (const entId of entities) {
      // eslint-disable-next-line no-await-in-loop
      const r = await (maint as any).health(entId, pk === "all" ? null : pk, asOf);
      reports.push(r);
    }
    const stats = (rep as any).computeStats(reports);
    const worst = reports
      .slice()
      .sort((a: any, b: any) => (b.replayHours ?? -1) - (a.replayHours ?? -1))
      .slice(0, 15);

    if (format === "md" || format === "markdown") {
      if (typeof (rep as any).toMarkdown !== "function") die("core report missing toMarkdown()");
      perPack[pk] = (rep as any).toMarkdown(pk, asOf, stats, worst);
    } else {
      perPack[pk] = { stats, worst };
    }
  }

  if (format === "md" || format === "markdown") {
    // concatenate markdown
    const chunks: string[] = [];
    for (const [pk, md] of Object.entries(perPack)) {
      chunks.push(String(md));
      chunks.push("
---
");
    }
    return { asOf, packs: packKeys, entities: entities.length, markdown: chunks.join("
") };
  }

  return { asOf, packs: packKeys, entities: entities.length, perPack };
},

// Content (immutable evidence layer)
createContent: async (body: unknown): Promise<Readonly<{ content: Content }>> => {
  const packName = String((body as any)?.pack ?? "");
  const mime = (body as any)?.mime ? String((body as any)?.mime) : undefined;
  const source = (body as any)?.source ? String((body as any)?.source) : undefined;
  const uri = (body as any)?.uri ? String((body as any)?.uri) : undefined;
  const tags = normalizeTags((body as any)?.tags);
  if (packName) tags["pack"] = packName;

  // payload can be text or base64
  const text = (body as any)?.text;
  const b64 = (body as any)?.base64;

  let bytes: Uint8Array | undefined = undefined;
  let excerpt: string | undefined = undefined;

  if (typeof text === "string") {
    bytes = new TextEncoder().encode(text);
    excerpt = text.slice(0, 2000);
  } else if (typeof b64 === "string") {
    const raw = atob(b64);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    bytes = arr;
    excerpt = (body as any)?.excerpt ? String((body as any)?.excerpt) : undefined;
  } else {
    excerpt = (body as any)?.excerpt ? String((body as any)?.excerpt) : undefined;
  }

  const content = await putContent({ mime, bytes, source, uri, excerpt, tags });
  return { content };
},

getContent: async (id: string): Promise<Content | null> => await getContent(id),

listContents: async (pack: string | null): Promise<readonly Content[]> => {
  const all = await listContents();
  if (!pack) return all;
  return all.filter((c) => c.tags?.pack === pack);
},

// Search
search: async (q: string, kind: string, pack: string | null): Promise<unknown> => {
  if (!q) return [];
  if (kind === "entities") return await searchEntities(q, pack);
  if (kind === "facts") return await searchFacts(q, pack);
  if (kind === "content") return await searchContents(q, pack);
  die("Unknown search kind", { kind });
},


// Hybrid search (vector + text + recency)
hybridSearch: async (body: unknown): Promise<unknown> => {
  const kind = String((body as any)?.kind ?? "entities");
  const q = String((body as any)?.q ?? "");
  const pack = (body as any)?.pack ? String((body as any)?.pack) : null;
  const status = (body as any)?.status ? String((body as any)?.status) : null; // edges only
  const asOf = String((body as any)?.asOf ?? new Date().toISOString());
  const limit = Math.max(1, Math.min(50, Number((body as any)?.limit ?? 10)));
  const vector = Array.isArray((body as any)?.vector) ? (body as any).vector.map((x: any) => Number(x)) : null;

  const alphaIn = (body as any)?.alpha;
  const betaIn = (body as any)?.beta;
  const gammaIn = (body as any)?.gamma;
  const halfLifeDays = Math.max(1, Number((body as any)?.halfLifeDays ?? 30));

  const filterTags: Record<string, string> | null =
    (body as any)?.filterTags && typeof (body as any).filterTags === "object" ? (body as any).filterTags : null;

  const hasVec = !!(vector && vector.length > 0);
  const hasQ = !!q;

  // defaults that "do the right thing" depending on which inputs you provide
  const alpha = Number.isFinite(alphaIn) ? Number(alphaIn) : (hasVec ? 0.7 : 0.0);
  const beta = Number.isFinite(betaIn) ? Number(betaIn) : (hasQ ? (hasVec ? 0.2 : 0.8) : 0.0);
  const gamma = Number.isFinite(gammaIn) ? Number(gammaIn) : (hasVec || hasQ ? 0.1 : 0.0);

  const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
  const toEpoch = (iso: string): number => {
    const t = Date.parse(iso);
    return Number.isFinite(t) ? t : Date.now();
  };
  const recencyScore = (tsIso: string): number => {
    const dt = Math.max(0, toEpoch(asOf) - toEpoch(tsIso));
    const half = halfLifeDays * 24 * 60 * 60 * 1000;
    // exp decay: score=0.5 at dt=halfLife
    return clamp01(Math.exp(-Math.LN2 * (dt / half)));
  };

  const toks = (s: string): readonly string[] =>
    s.toLowerCase().split(/[^a-z0-9_:\-]+/g).map((x) => x.trim()).filter((x) => x.length >= 2);

  const textScoreOf = (hay: readonly string[], qq: string): number => {
    const tt = toks(qq);
    if (tt.length === 0) return 0;
    const h = hay.join(" ").toLowerCase();
    let hit = 0;
    for (const t of tt) if (h.includes(t)) hit++;
    return clamp01(hit / tt.length);
  };

  const tagsOk = (tags: Tags | undefined): boolean => {
    if (!filterTags) return true;
    const t = tags ?? {};
    for (const [k, v] of Object.entries(filterTags)) {
      if (String((t as any)[k] ?? "") !== String(v)) return false;
    }
    return true;
  };

  const readEdgeById = async (id: string): Promise<Edge | null> => {
    const ptr = await loadPointers();
    const rel = (ptr as any).edge?.[id];
    if (!rel) return null;
    const abs = pjoin(dbRoot(), rel);
    if (!(await exists(abs))) return null;
    return await readJson<Edge>(abs);
  };

  type Cand = {
    id: string;
    kind: string;
    record: any;
    scoreText: number;
    scoreVec: number;
    scoreRecency: number;
    score: number;
  };

  const cands = new Map<string, Cand>();

  // 1) vector candidates
  if (hasVec) {
    const vk = kind === "facts" ? "edge" : (kind === "content" ? "content" : "entity");
    const vres = await searchVectors({
      query: vector!,
      topK: Math.max(limit * 5, 50),
      filter: { pack: pack ?? undefined, kind: vk as any },
    });

    for (const r of vres) {
      // cosine in [-1,1] -> [0,1]
      const scoreVec = clamp01((r.score + 1) / 2);
      let rec: any = null;
      if (vk === "entity") rec = await v1.getEntityById(r.id);
      else if (vk === "content") rec = await getContent(r.id);
      else if (vk === "edge") rec = await readEdgeById(r.id);

      if (!rec) continue;
      if (pack && (rec.tags?.pack ?? rec.pack ?? null) !== pack) continue;
      if (!tagsOk(rec.tags ?? rec.tags)) continue;
      if (vk === "edge" && status && String(rec.tags?.status ?? "") !== status) continue;

      const ts = rec.createdAt ?? rec.capturedAt ?? rec.recordedAt ?? rec.validFrom ?? nowIso();
      const scoreRec = recencyScore(String(ts));
      const scoreT = hasQ ? textScoreOf([
        rec.key ?? "",
        rec.type ?? "",
        rec.predicate ?? "",
        rec.edgeKey ?? "",
        rec.uri ?? "",
        rec.excerpt ?? "",
        ...Object.entries(rec.tags ?? {}).map(([k, v]: any) => `${k}:${v}`),
      ], q) : 0;

      const score = alpha * scoreVec + beta * scoreT + gamma * scoreRec;
      cands.set(r.id, { id: r.id, kind, record: rec, scoreText: scoreT, scoreVec, scoreRecency: scoreRec, score });
    }
  }

  // 2) text candidates
  if (hasQ) {
    let tres: any[] = [];
    if (kind === "entities") tres = await searchEntities(q, pack);
    else if (kind === "facts") tres = await searchFacts(q, pack);
    else if (kind === "content") tres = await searchContents(q, pack);
    else die("Unknown search kind", { kind });

    // cap to avoid huge scans
    const cap = Math.max(limit * 20, 200);
    tres = tres.slice(0, cap);

    for (const rec of tres) {
      if (pack && (rec.tags?.pack ?? rec.pack ?? null) !== pack) continue;
      if (!tagsOk(rec.tags ?? rec.tags)) continue;
      if (kind === "facts" && status && String(rec.tags?.status ?? "") !== status) continue;

      const ts = rec.createdAt ?? rec.capturedAt ?? rec.recordedAt ?? rec.validFrom ?? nowIso();
      const scoreRec = recencyScore(String(ts));
      const scoreVec = cands.get(rec.id)?.scoreVec ?? 0;
      const scoreT = textScoreOf([
        rec.key ?? "",
        rec.type ?? "",
        rec.predicate ?? "",
        rec.edgeKey ?? "",
        rec.uri ?? "",
        rec.excerpt ?? "",
        ...Object.entries(rec.tags ?? {}).map(([k, v]: any) => `${k}:${v}`),
      ], q);

      const score = alpha * scoreVec + beta * scoreT + gamma * scoreRec;
      cands.set(rec.id, { id: rec.id, kind, record: rec, scoreText: scoreT, scoreVec, scoreRecency: scoreRec, score });
    }
  }

  const out = Array.from(cands.values());
  out.sort((a, b) => b.score - a.score);

  return {
    kind,
    pack,
    status,
    asOf,
    weights: { alpha, beta, gamma, halfLifeDays },
    count: out.length,
    items: out.slice(0, limit).map((x) => ({
      id: x.id,
      score: x.score,
      scoreBreakdown: { vector: x.scoreVec, text: x.scoreText, recency: x.scoreRecency },
      record: x.record,
    })),
  };
},
// Hybrid search constrained to a canonical (or observed) subgraph around an anchor entity.
//
// This is the "agent-grade" retrieval primitive:
//  1) expand a small canonical neighborhood (BFS by depth)
//  2) score candidates inside that neighborhood using vector + text + recency
//
// Why: agents rarely need the entire database—just "what's relevant around X right now".
searchAround: async (body: unknown): Promise<unknown> => {
  const kind = String((body as any)?.kind ?? "facts"); // entities|facts|content
  const rootEntityId = String((body as any)?.rootEntityId ?? "");
  if (!rootEntityId) throw new Error("rootEntityId is required");

  const pack = (body as any)?.pack ? String((body as any).pack) : null;
  const asOf = String((body as any)?.asOf ?? new Date().toISOString());
  const depth = Math.max(0, Math.min(4, Number((body as any)?.depth ?? 2)));
  const limit = Math.max(1, Math.min(50, Number((body as any)?.limit ?? 10)));

  // canonical by default (for facts); entities/content ignore status unless you use tags filters
  const status = (body as any)?.status ? String((body as any).status) : (kind === "facts" ? "canonical" : null);

  const q = String((body as any)?.q ?? "");
  const vector = Array.isArray((body as any)?.vector) ? (body as any).vector.map((x: any) => Number(x)) : null;

  const alphaIn = (body as any)?.alpha;
  const betaIn = (body as any)?.beta;
  const gammaIn = (body as any)?.gamma;
  const halfLifeDays = Math.max(1, Number((body as any)?.halfLifeDays ?? 30));

  const filterTags: Record<string, string> | null =
    (body as any)?.filterTags && typeof (body as any).filterTags === "object" ? (body as any).filterTags : null;

  const maxNodes = Math.max(50, Math.min(5000, Number((body as any)?.maxNodes ?? 1000)));
  const maxEdges = Math.max(100, Math.min(20000, Number((body as any)?.maxEdges ?? 5000)));

  const hasVec = !!(vector && vector.length > 0);
  const hasQ = !!q;

  const alpha = Number.isFinite(alphaIn) ? Number(alphaIn) : (hasVec ? 0.7 : 0.0);
  const beta = Number.isFinite(betaIn) ? Number(betaIn) : (hasQ ? (hasVec ? 0.2 : 0.8) : 0.0);
  const gamma = Number.isFinite(gammaIn) ? Number(gammaIn) : (hasVec || hasQ ? 0.1 : 0.0);

  const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
  const toEpoch = (iso: string): number => {
    const t = Date.parse(iso);
    return Number.isFinite(t) ? t : Date.now();
  };
  const recencyScore = (tsIso: string): number => {
    const dt = Math.max(0, toEpoch(asOf) - toEpoch(tsIso));
    const half = halfLifeDays * 24 * 60 * 60 * 1000;
    return clamp01(Math.exp(-Math.LN2 * (dt / half)));
  };

  const toks = (s: string): readonly string[] =>
    s.toLowerCase().split(/[^a-z0-9_:\-]+/g).map((x) => x.trim()).filter((x) => x.length >= 2);

  const textScoreOf = (hay: readonly string[], qq: string): number => {
    const tt = toks(qq);
    if (tt.length === 0) return 0;
    const h = hay.join(" ").toLowerCase();
    let hit = 0;
    for (const t of tt) if (h.includes(t)) hit++;
    return clamp01(hit / tt.length);
  };

  const tagsOk = (tags: Tags | undefined): boolean => {
    if (!filterTags) return true;
    const t = tags ?? {};
    for (const [k, v] of Object.entries(filterTags)) {
      if (String((t as any)[k] ?? "") !== String(v)) return false;
    }
    return true;
  };

  // --- 1) expand subgraph (BFS) ---
  const visited = new Set<string>();
  const edgeMap = new Map<string, Edge>();

  let frontier: readonly string[] = [rootEntityId];
  visited.add(rootEntityId);

  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const eid of frontier) {
      if (edgeMap.size >= maxEdges || visited.size >= maxNodes) break;
      const edges = await edgesAsOfForEntity(eid, asOf, pack);
      for (const e of edges) {
        if (edgeMap.size >= maxEdges) break;
        if (status && kind === "facts") {
          const st = String((e.tags as any)?.status ?? "");
          if (st !== status) continue;
        }
        if (!tagsOk(e.tags)) continue;
        edgeMap.set(e.id, e);

        const a = e.s;
        const b = e.o;
        for (const n of [a, b]) {
          if (visited.size >= maxNodes) break;
          if (!visited.has(n)) {
            visited.add(n);
            next.push(n);
          }
        }
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }

  // --- 2) candidates within subgraph ---
  type Cand = {
    id: string;
    kind: "entity" | "edge" | "content";
    pack: string;
    tags?: Tags;
    tsIso: string;
    hay: readonly string[];
    record: unknown;
  };

  const cands: Cand[] = [];

  if (kind === "entities") {
    for (const id of visited) {
      const ent = await v1.getEntityById(id);
      if (!ent) continue;
      if (pack && ent.pack !== pack) continue;
      if (!tagsOk(ent.tags)) continue;
      cands.push({
        id,
        kind: "entity",
        pack: ent.pack,
        tags: ent.tags,
        tsIso: ent.createdAt,
        hay: [ent.id, ent.type, ent.key, ...Object.entries(ent.tags ?? {}).map(([k, v]) => `${k}:${v}`)],
        record: ent,
      });
    }
  } else if (kind === "facts") {
    for (const e of edgeMap.values()) {
      if (pack && e.pack !== pack) continue;
      // status already filtered in BFS; keep for safety
      if (status) {
        const st = String((e.tags as any)?.status ?? "");
        if (st !== status) continue;
      }
      if (!tagsOk(e.tags)) continue;
      cands.push({
        id: e.id,
        kind: "edge",
        pack: e.pack,
        tags: e.tags,
        tsIso: e.recordedAt ?? e.validFrom,
        hay: [e.id, e.edgeKey, e.predicate, e.s, e.o, ...Object.entries(e.tags ?? {}).map(([k, v]) => `${k}:${v}`)],
        record: e,
      });
    }
  } else if (kind === "content") {
    // Pull content referenced by source events of edges in the neighborhood.
    const contentIds = new Set<string>();
    for (const e of edgeMap.values()) {
      const ev = await v1.getEvent(e.sourceEventId);
      if (!ev) continue;
      for (const r of (ev.refs ?? [])) {
        if ((r as any).kind === "content") contentIds.add(String((r as any).id));
      }
    }
    for (const id of contentIds) {
      const c = await v1.getContent(id);
      if (!c) continue;
      if (pack && c.pack !== pack) continue;
      if (!tagsOk(c.tags)) continue;
      const text = String((c as any).text ?? "");
      cands.push({
        id,
        kind: "content",
        pack: c.pack,
        tags: c.tags,
        tsIso: c.createdAt,
        hay: [c.id, c.mime, (c as any).uri ?? "", ...Object.entries(c.tags ?? {}).map(([k, v]) => `${k}:${v}`), text.slice(0, 2000)],
        record: c,
      });
    }
  } else {
    throw new Error(`Unknown kind: ${kind}`);
  }

  // --- 3) vector scores (optional) ---
  const vecScores = new Map<string, number>();
  if (hasVec && cands.length > 0) {
    const vk = kind === "facts" ? "edge" : (kind === "content" ? "content" : "entity");
    const candIds = new Set(cands.map((c) => c.id));

    const vres = await searchVectors({
      query: vector!,
      topK: Math.max(limit * 20, 200),
      filter: { pack: pack ?? undefined, kind: vk as any },
    });

    for (const r of vres) {
      if (!candIds.has(r.id)) continue;
      // cosine in [-1,1] -> [0,1]
      vecScores.set(r.id, clamp01((r.score + 1) / 2));
    }
  }

  // --- 4) final scoring ---
  const scored = cands.map((c) => {
    const sVec = hasVec ? (vecScores.get(c.id) ?? 0) : 0;
    const sTxt = hasQ ? textScoreOf(c.hay, q) : 0;
    const sRec = (gamma > 0) ? recencyScore(c.tsIso) : 0;
    const score = alpha * sVec + beta * sTxt + gamma * sRec;
    return {
      id: c.id,
      kind: c.kind,
      pack: c.pack,
      score,
      scoreBreakdown: { vector: sVec, text: sTxt, recency: sRec, alpha, beta, gamma, halfLifeDays },
      record: c.record,
    };
  }).sort((a, b) => b.score - a.score);

  return {
    kind,
    rootEntityId,
    asOf,
    pack,
    depth,
    status,
    limit,
    neighborhood: { nodeCount: visited.size, edgeCount: edgeMap.size },
    results: scored.slice(0, limit),
  };
},


// Resolver (skeleton)
resolve: async (body: unknown): Promise<unknown> => {
  const entityId = String((body as any)?.entityId ?? "");
  const asOf = String((body as any)?.asOf ?? new Date().toISOString());
  const pack = String((body as any)?.pack ?? "");
  const persist = Boolean((body as any)?.persist ?? false);

  if (!entityId) die("Missing entityId");

  const run = await resolveEntity(entityId, asOf, pack);
  if (!persist) return run;
  const saved = await persistResolution(run as any);
  return { ...run, saved };
},

  // Apply resolution: emit canonical and synthesized facts, then let state-clock endpoints read only canonical.
  resolveApply: async (body: unknown): Promise<unknown> => {
    const entityId = String((body as any)?.entityId ?? "");
    const asOf = String((body as any)?.asOf ?? new Date().toISOString());
    const pack = String((body as any)?.pack ?? "");
    const emitSynthesized = Boolean((body as any)?.emitSynthesized ?? true);

    if (!entityId) die("Missing entityId");

    const run = await resolveEntity(entityId, asOf, pack);
    const saved = await persistResolution(run as any);

    // One system event per apply run (kept in core pack)
    const resEvt = await v1.createEvent({
      pack: "core",
      kind: "sys/fact_resolution_applied",
      agentId: String((body as any)?.agentId ?? "memdb"),
      refs: [{ kind: "entity", id: entityId }],
      tags: {
        targetPack: pack ?? "all",
        asOf,
        runCreatedAt: (run as any).createdAt ?? "",
      },
    });

    const createdCanonical: { proposalEdgeKey: string; newEdgeId: string; fromEdgeId: string }[] = [];
    const createdSynth: { newEdgeId: string; predicate: string; s: string; o: string; fromEdgeIds: string[] }[] = [];

    const mergeIntervals = (ivs: readonly { from: string; to: string | null }[]): readonly { from: string; to: string | null }[] => {
      const sorted = [...ivs].sort((a, b) => a.from.localeCompare(b.from));
      const out: { from: string; to: string | null }[] = [];
      for (const iv of sorted) {
        const last = out[out.length - 1];
        if (!last) {
          out.push({ ...iv });
          continue;
        }
        const lastTo = last.to ?? "9999-12-31T23:59:59.999Z";
        const curTo = iv.to ?? "9999-12-31T23:59:59.999Z";
        if (iv.from <= lastTo) {
          last.to = (curTo > lastTo) ? (iv.to ?? null) : last.to;
        } else out.push({ ...iv });
      }
      return out;
    };

    // For synthesized facts, group by predicate+s+o+pack using the canonical edge (representative).
    const synthGroups = new Map<string, { rep: Edge; edgeIds: string[]; ivs: { from: string; to: string | null }[] }>();

    for (const p of (run as any).proposals ?? []) {
      const canonicalId = String(p.canonicalEdgeId ?? "");
      if (!canonicalId) continue;

      const rep = await edgeById(canonicalId);
      if (!rep) continue;

      // If current already canonical+active, skip emitting another canonical edge.
      let currentId: string | null = null;
      try {
        const curPtr = edgeCurrentPtrPath(rep.edgeKey);
        if (await exists(curPtr)) {
          currentId = (await readText(curPtr)).trim().split(/\r?\n/g)[0]?.trim() ?? null;
        }
      } catch {
        currentId = null;
      }

      if (currentId) {
        const cur = await edgeById(currentId);
        const st = String((cur?.tags as any)?.status ?? "");
        if (cur && st === "canonical" && isActiveAt(cur.validFrom, cur.validTo, asOf)) {
          if (emitSynthesized) {
            const key = `${rep.pack}::${rep.predicate}::${rep.s}::${rep.o}`;
            const g = synthGroups.get(key) ?? { rep, edgeIds: [], ivs: [] };
            for (const c of p.candidates ?? []) {
              g.edgeIds.push(String(c.id));
              g.ivs.push({ from: String(c.validFrom), to: (c.validTo === null ? null : String(c.validTo)) });
            }
            synthGroups.set(key, g);
          }
          continue;
        }
      }

      const tags = { ...(rep.tags ?? {}), status: "canonical", derivedFromEdgeId: rep.id, resolutionRunAt: String((run as any).createdAt ?? "") };
      const created = await v1.createEdge({
        pack: rep.pack,
        predicate: rep.predicate,
        s: rep.s,
        o: rep.o,
        sourceEventId: resEvt.id,
        validFrom: rep.validFrom,
        confidence: rep.confidence,
        tags,
      });

      createdCanonical.push({ proposalEdgeKey: String(p.edgeKey ?? rep.edgeKey), newEdgeId: (created as any).id, fromEdgeId: rep.id });

      if (emitSynthesized) {
        const key = `${rep.pack}::${rep.predicate}::${rep.s}::${rep.o}`;
        const g = synthGroups.get(key) ?? { rep, edgeIds: [], ivs: [] };
        for (const c of p.candidates ?? []) {
          g.edgeIds.push(String(c.id));
          g.ivs.push({ from: String(c.validFrom), to: (c.validTo === null ? null : String(c.validTo)) });
        }
        synthGroups.set(key, g);
      }
    }

    if (emitSynthesized) {
      for (const g of synthGroups.values()) {
        const merged = mergeIntervals(g.ivs);
        const uniqIds = Array.from(new Set(g.edgeIds)).sort();
        for (const iv of merged) {
          const tags = { ...(g.rep.tags ?? {}), status: "synthesized", derivedFromEdgeIds: uniqIds.join(","), resolutionRunAt: String((run as any).createdAt ?? "") };
          const created = await v1.createEdge({
            pack: g.rep.pack,
            predicate: `synth/${g.rep.predicate}`,
            s: g.rep.s,
            o: g.rep.o,
            sourceEventId: resEvt.id,
            validFrom: iv.from,
            confidence: g.rep.confidence,
            tags,
          });
          createdSynth.push({ newEdgeId: (created as any).id, predicate: `synth/${g.rep.predicate}`, s: g.rep.s, o: g.rep.o, fromEdgeIds: uniqIds });
        }
      }
    }

// Optional OLTP spine: write-through canonical facts to Turso/libSQL.
const tdb = getTurso();
if (tdb) {
  try {
    const allEdges = await edgesAsOfForEntity(entityId, asOf, pack || null);
    const canonEdges = allEdges.filter((e) => String((e.tags as any)?.status ?? "") === "canonical");
    await tursoUpsertCanonicalEdges(tdb, canonEdges);
  } catch (err) {
    console.warn("turso write-through failed:", err);
  }
}

    return {
      ok: true,
      entityId,
      asOf,
      pack,
      run,
      saved,
      resolutionEventId: (resEvt as any).id,
      createdCanonical,
      createdSynth,
    };
  },

  // State-clock: read only canonical facts (status=canonical) active at asOf.
  stateNeighbors: async (entityId: string, asOf: string, pack: string | null): Promise<unknown> => {
    const tdb = getTurso();
    const tf = tursoFlags();

    if (tdb && tf.canonicalReads) {
      const edges = await tursoQueryCanonicalNeighbors(tdb, entityId, asOf, pack);
      return { entityId, asOf, pack, edges };
    }

    const edges = await edgesAsOfForEntity(entityId, asOf, pack);
    const canon = edges.filter((e) => String((e.tags as any)?.status ?? "") === "canonical");
    return { entityId, asOf, pack, edges: canon };
  },


resolveEnqueue: async (body: unknown): Promise<unknown> => {
  const entityId = String((body as any)?.entityId ?? "");
  const pack = String((body as any)?.pack ?? "");
  const priority = Number((body as any)?.priority ?? 0);
  const reason = String((body as any)?.reason ?? "manual");
  const asOf = String((body as any)?.asOf ?? new Date().toISOString());
  if (!entityId) die("Missing entityId");

  const entry = {
    id: crypto.randomUUID(),
    entityId,
    pack,
    priority,
    reason,
    asOf,
    requestedAt: nowIso(),
    attempts: 0,
  };

  const root = dbRoot();
  const q = pjoin(root, "kv", "queue", "resolution.jsonl");
  await writeText(q, JSON.stringify(entry) + "
", { append: true });

  return { enqueued: true, entry };
},

resolveQueue: async (): Promise<unknown> => {
  const root = dbRoot();
  const q = pjoin(root, "kv", "queue", "resolution.jsonl");
  if (!(await exists(q))) return { queue: [] as unknown[] };
  const raw = await readText(q);
  const lines = raw.split(/
?
/).filter((l) => l.trim().length);
  const items = lines.map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return { parseError: true, raw: l };
    }
  });
  return { queue: items };
},

stateDiff: async (entityId: string, t1: string, t2: string, pack: string | null): Promise<unknown> => {
  if (!entityId) die("Missing entityId");
  if (!t1) die("Missing t1");
  if (!t2) die("Missing t2");

  const a = await v1.stateNeighbors(entityId, t1, pack) as any;
  const b = await v1.stateNeighbors(entityId, t2, pack) as any;
  const aKeys = new Map<string, any>();
  const bKeys = new Map<string, any>();
  for (const e of (a.edges ?? [])) aKeys.set(String(e.edgeKey ?? `${e.predicate}|${e.s}|${e.o}`), e);
  for (const e of (b.edges ?? [])) bKeys.set(String(e.edgeKey ?? `${e.predicate}|${e.s}|${e.o}`), e);

  const added: any[] = [];
  const removed: any[] = [];
  const unchanged: any[] = [];
  for (const [k, e] of bKeys) {
    if (!aKeys.has(k)) added.push(e);
    else unchanged.push(e);
  }
  for (const [k, e] of aKeys) if (!bKeys.has(k)) removed.push(e);

  return { entityId, pack, t1, t2, added, removed, unchanged };
},

stateSubgraph: async (rootEntityId: string, asOf: string, pack: string | null, depth: number, maxEdges: number): Promise<unknown> => {
  if (!rootEntityId) die("Missing rootEntityId");
  const d = Number.isFinite(depth) ? Math.max(0, Math.min(6, depth)) : 2;
  const limit = Number.isFinite(maxEdges) ? Math.max(10, Math.min(5000, maxEdges)) : 500;

  const nodes = new Map<string, Entity>();
  const edgesOut: any[] = [];

  const q: Array<{ id: string; level: number }> = [{ id: rootEntityId, level: 0 }];
  const seen = new Set<string>([rootEntityId]);

  while (q.length) {
    const { id, level } = q.shift()!;
    const ent = await entityById(id);
    if (ent) nodes.set(id, ent);
    if (level >= d) continue;

    const res = await v1.stateNeighbors(id, asOf, pack) as any;
    for (const e of (res.edges ?? []) as any[]) {
      if (edgesOut.length >= limit) break;
      edgesOut.push(e);
      const other = e.s === id ? e.o : e.s;
      if (!seen.has(other)) {
        seen.add(other);
        q.push({ id: other, level: level + 1 });
      }
    }
    if (edgesOut.length >= limit) break;
  }

  return {
    rootEntityId,
    asOf,
    pack,
    depth: d,
    maxEdges: limit,
    nodes: Array.from(nodes.values()),
    edges: edgesOut,
  };
},

  // Helper: one call to write content + event + derived observed facts.
  traceDecision: async (body: unknown): Promise<unknown> => {
    const pack = String((body as any)?.pack ?? "");
    const kind = String((body as any)?.kind ?? "decision_recorded");
    const agentId = String((body as any)?.agentId ?? "agent");
    const tags = normalizeTags((body as any)?.tags);

    if (!pack) die("Missing pack");

    const content = (body as any)?.content ?? null;
    if (!content) die("Missing content");

    const contentRes = await v1.createContent({
      pack,
      ...(content as any),
    });

    const evt = await v1.createEvent({
      pack,
      kind,
      agentId,
      tags,
      refs: [{ kind: "content", id: (contentRes as any).id }],
    });

    const toEntityId = async (x: any): Promise<string> => {
      if (!x) die("Missing entity ref");
      if (typeof x === "string") return x;
      if (typeof x === "object" && typeof x.id === "string") return x.id;
      if (typeof x === "object" && typeof x.type === "string" && typeof x.key === "string") {
        const created = await v1.createEntity({ pack, type: x.type, key: x.key, tags: x.tags ?? {} });
        return (created as any).id;
      }
      die("Invalid entity ref; expected string id, {id}, or {type,key}");
      return "";
    };

    const edgesOut: unknown[] = [];
    const claims = Array.isArray((body as any)?.claims) ? (body as any).claims : [];
    for (const c of claims) {
      const predicate = String(c?.predicate ?? "");
      if (!predicate) die("Missing claim.predicate");
      const s = await toEntityId(c?.s);
      const o = await toEntityId(c?.o);
      const confidence = Number(c?.confidence ?? 1.0);
      const validFrom = String(c?.validFrom ?? (evt as any).event.recordedAt);
      const tagsE = { ...normalizeTags(c?.tags), status: "observed" };

      const e = await v1.createEdge({
        pack,
        predicate,
        s,
        o,
        sourceEventId: (evt as any).id,
        validFrom,
        confidence,
        tags: tagsE,
      });
      edgesOut.push(e);
    }

    return { ok: true, content: contentRes, event: evt, edges: edgesOut };
  },

  // --- Pool Coordinator (shared work graph) ---
  // Inspired by pool-style coordination (e.g., "claude-cognitive"), but expressed as facts.
  // Goal: many agents (Claude Code, Codex, custom agents) can share a small, queryable state surface.

  poolPost: async (body: unknown): Promise<unknown> => {
    const pack = String((body as any)?.pack ?? "");
    const instanceId = String((body as any)?.instanceId ?? "");
    const action = String((body as any)?.action ?? "update"); // start|update|complete|block|unblock
    const topicRaw = String((body as any)?.topic ?? "");
    const summary = (body as any)?.summary ? String((body as any).summary) : "";
    const applyResolution = (body as any)?.applyResolution === undefined ? true : Boolean((body as any)?.applyResolution);
    const confidence = Number((body as any)?.confidence ?? 1.0);
    const tags = normalizeTags((body as any)?.tags);

    const affectsIn = Array.isArray((body as any)?.affects) ? (body as any).affects : [];
    const affectsKeys: string[] = affectsIn.map((x: any) => (typeof x === "string" ? x : String(x?.key ?? ""))).filter((x: string) => x.length);

    if (!pack) die("Missing pack");
    if (!instanceId) die("Missing instanceId");
    if (!topicRaw) die("Missing topic");
    if (!(confidence >= 0 && confidence <= 1)) die("confidence must be 0..1");

    const topic = normTopic(topicRaw);
    const workKey = `topic:${topic.toLowerCase()}`;

    // Entities
    const agent = await ensureEntityDet(pack, "AgentInstance", instanceId, { role: "agent_instance" });
    const work = await ensureEntityDet(pack, "WorkItem", workKey, { topic, kind: "work" });

    const statusKey = (() => {
      if (action === "start" || action === "unblock") return "in_progress";
      if (action === "complete") return "done";
      if (action === "block") return "blocked";
      return "in_progress";
    })();
    const statusEnt = await ensureEntityDet(pack, "WorkStatus", statusKey, { kind: "work_status" });

    const artifactEnts: { key: string; id: string }[] = [];
    for (const k of affectsKeys) {
      // eslint-disable-next-line no-await-in-loop
      const a = await ensureEntityDet(pack, "Artifact", k, { kind: "artifact" });
      artifactEnts.push({ key: k, id: a.id });
    }

    // Evidence (content)
    let contentId: string | null = null;
    if (summary) {
      const c = await v1.createContent({ pack, mime: "text/markdown", text: summary, tags: { ...tags, kind: "pool_summary", topic } }) as any;
      contentId = String(c?.content?.id ?? "");
    }

    // Event
    const refs: Ref[] = [
      { kind: "entity", id: work.id },
      { kind: "entity", id: agent.id },
      ...artifactEnts.map((a) => ({ kind: "entity", id: a.id } as Ref)),
    ];
    if (contentId) refs.push({ kind: "content", id: contentId });

    const evt = await v1.createEvent({
      pack,
      kind: "pool/post",
      agentId: instanceId,
      refs,
      tags: { ...tags, action, topic, statusKey },
    }) as any;

    // Facts
    const edges: unknown[] = [];

    edges.push(await v1.createEdge({ pack, predicate: "work_by", s: work.id, o: agent.id, sourceEventId: evt.id, validFrom: evt.event.recordedAt, confidence, tags: { status: "observed" } }));
    edges.push(await v1.createEdge({ pack, predicate: "work_action", s: work.id, o: statusEnt.id, sourceEventId: evt.id, validFrom: evt.event.recordedAt, confidence, tags: { status: "observed", action } }));

    for (const a of artifactEnts) {
      // eslint-disable-next-line no-await-in-loop
      edges.push(await v1.createEdge({ pack, predicate: "work_affects", s: work.id, o: a.id, sourceEventId: evt.id, validFrom: evt.event.recordedAt, confidence: 1.0, tags: { status: "observed" } }));
    }

    // Turn observed updates into canonical state facts for the state-clock.
    let applied: unknown = null;
    let enqueued: unknown = null;
    if (applyResolution) {
      applied = await v1.resolveApply({ pack, entityId: work.id, asOf: evt.event.recordedAt, emitSynthesized: true, agentId: "memdb/pool" });
    } else {
      enqueued = await v1.resolveEnqueue({ pack, entityId: work.id, asOf: evt.event.recordedAt, priority: 10, reason: "pool_post" });
    }

    return { ok: true, pack, workItemId: work.id, agentInstanceId: agent.id, topic, statusKey, eventId: evt.id, contentId, edges, applied, enqueued };
  },

  poolClaim: async (body: unknown): Promise<unknown> => {
    const pack = String((body as any)?.pack ?? "");
    const instanceId = String((body as any)?.instanceId ?? "");
    const workItemId = String((body as any)?.workItemId ?? "");
    const topic = (body as any)?.topic ? normTopic(String((body as any)?.topic)) : "";
    const ttlSeconds = Math.max(10, Math.min(24 * 3600, Number((body as any)?.ttlSeconds ?? 600)));
    const applyResolution = (body as any)?.applyResolution === undefined ? true : Boolean((body as any)?.applyResolution);

    if (!pack) die("Missing pack");
    if (!instanceId) die("Missing instanceId");
    if (!workItemId && !topic) die("Missing workItemId or topic");

    const agent = await ensureEntityDet(pack, "AgentInstance", instanceId, { role: "agent_instance" });

    const wId = workItemId || (await deterministicEntityId(pack, "WorkItem", `topic:${topic.toLowerCase()}`));
    // If it doesn't exist yet, create it (pool users often claim before posting a full update).
    if (!(await exists(entityPropsPath("WorkItem", wId)))) {
      await ensureEntityDet(pack, "WorkItem", `topic:${topic.toLowerCase()}`, { topic, kind: "work" });
    }

    const leaseUntil = new Date(Date.now() + ttlSeconds * 1000).toISOString();

    const evt = await v1.createEvent({
      pack,
      kind: "pool/claim",
      agentId: instanceId,
      refs: [{ kind: "entity", id: wId }, { kind: "entity", id: agent.id }],
      tags: { leaseUntil, ttlSeconds: String(ttlSeconds) },
    }) as any;

    const edge = await v1.createEdge({
      pack,
      predicate: "work_claimed_by",
      s: wId,
      o: agent.id,
      sourceEventId: evt.id,
      validFrom: evt.event.recordedAt,
      confidence: 1.0,
      tags: { status: "observed", leaseUntil },
    });

    let applied: unknown = null;
    let enqueued: unknown = null;
    if (applyResolution) applied = await v1.resolveApply({ pack, entityId: wId, asOf: evt.event.recordedAt, agentId: "memdb/pool" });
    else enqueued = await v1.resolveEnqueue({ pack, entityId: wId, asOf: evt.event.recordedAt, priority: 5, reason: "pool_claim" });

    return { ok: true, pack, workItemId: wId, instanceId, leaseUntil, eventId: evt.id, edge, applied, enqueued };
  },

  poolRelease: async (body: unknown): Promise<unknown> => {
    const pack = String((body as any)?.pack ?? "");
    const instanceId = String((body as any)?.instanceId ?? "");
    const workItemId = String((body as any)?.workItemId ?? "");
    const applyResolution = (body as any)?.applyResolution === undefined ? true : Boolean((body as any)?.applyResolution);
    if (!pack) die("Missing pack");
    if (!instanceId) die("Missing instanceId");
    if (!workItemId) die("Missing workItemId");

    const agent = await ensureEntityDet(pack, "AgentInstance", instanceId, { role: "agent_instance" });
    const asOf = nowIso();

    const active = await edgesAsOfForEntity(workItemId, asOf, pack);
    const current = active.find((e) => e.predicate === "work_claimed_by" && e.s === workItemId && isActiveAt(e.validFrom, e.validTo, asOf));
    if (!current) return { ok: true, released: false, reason: "no_active_claim" };

    const evt = await v1.createEvent({
      pack,
      kind: "pool/release",
      agentId: instanceId,
      refs: [{ kind: "entity", id: workItemId }, { kind: "entity", id: agent.id }],
      tags: { released: "true" },
    }) as any;

    const retracted = await v1.retractEdge({
      pack,
      predicate: "work_claimed_by",
      s: workItemId,
      o: current.o,
      sourceEventId: evt.id,
      validTo: asOf,
      confidence: 1.0,
      tags: { status: String((current.tags as any)?.status ?? "observed"), reason: "pool_release" },
    });

    let applied: unknown = null;
    let enqueued: unknown = null;
    if (applyResolution) applied = await v1.resolveApply({ pack, entityId: workItemId, asOf, agentId: "memdb/pool" });
    else enqueued = await v1.resolveEnqueue({ pack, entityId: workItemId, asOf, priority: 3, reason: "pool_release" });

    return { ok: true, released: true, eventId: evt.id, retracted, applied, enqueued };
  },

  poolSnapshot: async (body: unknown): Promise<unknown> => {
    const pack = String((body as any)?.pack ?? "");
    const asOf = String((body as any)?.asOf ?? new Date().toISOString());
    const statusFilter = String((body as any)?.status ?? "open"); // open|blocked|done|all
    const limit = Math.max(1, Math.min(200, Number((body as any)?.limit ?? 50)));

    if (!pack) die("Missing pack");

    const { entities } = await scanEntities();
    const workIds: string[] = [];
    for (const [id, hit] of Object.entries(entities)) {
      if (hit.type !== "WorkItem") continue;
      const ent = await v1.getEntityById(id);
      if (!ent) continue;
      if (pack && (ent.tags as any)?.pack !== pack) continue;
      workIds.push(id);
    }
    workIds.sort();

    const statusLabel = async (statusEntId: string): Promise<string> => {
      const e = await v1.getEntityById(statusEntId);
      return e ? e.key : statusEntId;
    };

    const items: any[] = [];
    for (const wid of workIds.slice(0, limit)) {
      // eslint-disable-next-line no-await-in-loop
      const ent = await v1.getEntityById(wid);
      if (!ent) continue;

      // canonical state facts
      // eslint-disable-next-line no-await-in-loop
      const st = await v1.stateNeighbors(wid, asOf, pack) as any;
      const edges = Array.isArray(st?.edges) ? st.edges : [];

      const actionEdge = edges.find((e: any) => String(e.predicate) === "work_action");
      const claimEdge = edges.find((e: any) => String(e.predicate) === "work_claimed_by");
      const affects = edges.filter((e: any) => String(e.predicate) === "work_affects");

      const action = actionEdge ? await statusLabel(String(actionEdge.o)) : "unknown";
      const isBlocked = action === "blocked";
      const isDone = action === "done";
      const isOpen = !isDone;

      if (statusFilter === "blocked" && !isBlocked) continue;
      if (statusFilter === "done" && !isDone) continue;
      if (statusFilter === "open" && !isOpen) continue;

      // latest summary from timeline
      let lastSummary: string | null = null;
      let lastEventId: string | null = null;
      try {
        // eslint-disable-next-line no-await-in-loop
        const evIds = await timelineEventIds(wid);
        const last = evIds.slice().reverse().find((x) => !!x);
        if (last) {
          // eslint-disable-next-line no-await-in-loop
          const ev = await eventById(last);
          if (ev) {
            lastEventId = ev.id;
            const cRef = (ev.refs ?? []).find((r) => r.kind === "content");
            if (cRef) {
              // eslint-disable-next-line no-await-in-loop
              const c = await getContent(cRef.id);
              lastSummary = (c?.excerpt ?? null) as any;
            }
          }
        }
      } catch {
        // ignore
      }

      items.push({
        workItemId: wid,
        topic: String((ent.tags as any)?.topic ?? ent.key),
        action,
        claimedBy: claimEdge ? String(claimEdge.o) : null,
        leaseUntil: claimEdge ? String((claimEdge.tags as any)?.leaseUntil ?? "") : null,
        affects: affects.map((e: any) => String(e.o)),
        lastEventId,
        lastSummary,
      });
    }

    return { ok: true, pack, asOf, count: items.length, items };
  },

  // Bootstrap an agent pack with a minimal "entity spine" (for demos and quick starts).
  bootstrap: async (body: unknown): Promise<unknown> => {
    const pack = String((body as any)?.pack ?? "");
    const template = String((body as any)?.template ?? pack);
    if (!pack) die("Missing pack");

    if (template === "coding_assistant") {
      const repoKey = String((body as any)?.repoKey ?? "repo");
      const branchKey = String((body as any)?.branchKey ?? "main");
      const files: string[] = Array.isArray((body as any)?.files) ? (body as any).files.map(String) : [];
      const repo = await v1.createEntity({ pack, type: "Repo", key: repoKey, tags: { role: "spine" } });
      const branch = await v1.createEntity({ pack, type: "Branch", key: branchKey, tags: { role: "spine" } });

      const evt = await v1.createEvent({
        pack,
        kind: "sys/bootstrap",
        agentId: "memdb",
        refs: [{ kind: "entity", id: (repo as any).id }, { kind: "entity", id: (branch as any).id }],
        tags: { template, repoKey, branchKey },
      });

      const edges: unknown[] = [];
      edges.push(await v1.createEdge({ pack, predicate: "contains", s: (repo as any).id, o: (branch as any).id, sourceEventId: (evt as any).id, validFrom: (evt as any).event.recordedAt, confidence: 1.0, tags: { status: "canonical" } }));

      for (const f of files) {
        const fileEnt = await v1.createEntity({ pack, type: "File", key: f, tags: { role: "spine" } });
        edges.push(await v1.createEdge({ pack, predicate: "contains", s: (repo as any).id, o: (fileEnt as any).id, sourceEventId: (evt as any).id, validFrom: (evt as any).event.recordedAt, confidence: 1.0, tags: { status: "canonical" } }));
      }

      return { ok: true, template, repo, branch, edges };
    }

    if (template === "identity_verifier") {
      const issuerKey = String((body as any)?.issuerKey ?? "issuer");
      const verifierKey = String((body as any)?.verifierKey ?? "verifier");
      const policyKey = String((body as any)?.policyKey ?? "default-policy");

      const issuer = await v1.createEntity({ pack, type: "Issuer", key: issuerKey, tags: { role: "spine" } });
      const verifier = await v1.createEntity({ pack, type: "Verifier", key: verifierKey, tags: { role: "spine" } });
      const policy = await v1.createEntity({ pack, type: "Policy", key: policyKey, tags: { role: "spine" } });

      const evt = await v1.createEvent({
        pack,
        kind: "sys/bootstrap",
        agentId: "memdb",
        refs: [{ kind: "entity", id: (issuer as any).id }, { kind: "entity", id: (verifier as any).id }, { kind: "entity", id: (policy as any).id }],
        tags: { template, issuerKey, verifierKey, policyKey },
      });

      const edges: unknown[] = [];
      edges.push(await v1.createEdge({ pack, predicate: "governed_by", s: (verifier as any).id, o: (policy as any).id, sourceEventId: (evt as any).id, validFrom: (evt as any).event.recordedAt, confidence: 1.0, tags: { status: "canonical" } }));
      edges.push(await v1.createEdge({ pack, predicate: "derived_from", s: (policy as any).id, o: (issuer as any).id, sourceEventId: (evt as any).id, validFrom: (evt as any).event.recordedAt, confidence: 0.7, tags: { status: "canonical" } }));

      return { ok: true, template, issuer, verifier, policy, edges };
    }

    // Default: no-op
    return { ok: true, template, msg: "No bootstrap template applied." };
  }



// Pattern query (canonical-first). JSON-based, anchored joins.
queryPattern: async (body: unknown): Promise<unknown> => {
  const asOf = String((body as any)?.asOf ?? new Date().toISOString());
  const pack = ((body as any)?.pack === null || (body as any)?.pack === undefined) ? null : String((body as any)?.pack);
  const status = String((body as any)?.status ?? "canonical"); // canonical | observed | any
  const limit = Number((body as any)?.limit ?? 50);
  const clauses = (body as any)?.clauses as any[] | undefined;
  const ret = ((body as any)?.return ?? []) as any[];
  const explain = Boolean((body as any)?.explain ?? false);

  if (!Array.isArray(clauses) || clauses.length === 0) die("Missing clauses[]");
  const maxLimit = Math.max(1, Math.min(500, Number.isFinite(limit) ? limit : 50));

  type Bindings = Record<string, string>;
  const out: Array<{ bindings: Bindings; matches: any[] }> = [];
  let envs: Array<{ b: Bindings; matches: any[] }> = [{ b: {}, matches: [] }];

  const stats: any[] = [];
  const matchStatus = (e: Edge): boolean => {
    const st = String((e.tags as any)?.status ?? "");
    if (status === "any") return true;
    if (status === "canonical") return st === "canonical";
    if (status === "observed") return st === "observed" || st === "";
    return true;
  };
  const hasTags = (e: Edge, want: any): boolean => {
    if (!want || typeof want !== "object") return true;
    const t = (e.tags ?? {}) as any;
    for (const [k, v] of Object.entries(want)) {
      if (String(t[k] ?? "") !== String(v)) return false;
    }
    return true;
  };

  const getBound = (b: Bindings, key: any): string | null => {
    if (typeof key !== "string") return null;
    if (key.startsWith("$")) return b[key.slice(1)] ?? null;
    return key;
  };

  for (let i = 0; i < clauses.length; i++) {
    const c = clauses[i] ?? {};
    const p = String(c.predicate ?? c.p ?? "");
    if (!p) die("Clause missing predicate", c);

    const sConst = c.s ? String(c.s) : null;
    const oConst = c.o ? String(c.o) : null;
    const sVar = c.sVar ? String(c.sVar) : null;
    const oVar = c.oVar ? String(c.oVar) : null;
    const oType = c.oType ? String(c.oType) : null;
    const sType = c.sType ? String(c.sType) : null;
    const tags = c.tags ?? null;

    const before = envs.length;
    const next: Array<{ b: Bindings; matches: any[] }> = [];

    // For each environment, anchor on a concrete/bound side to avoid full scans.
    for (const env of envs) {
      const b = env.b;

      const sBound = sConst ?? (sVar ? (b[sVar] ?? null) : null);
      const oBound = oConst ?? (oVar ? (b[oVar] ?? null) : null);

      // Require at least one side bound for now (keeps it fast + deterministic).
      if (!sBound && !oBound) {
        die("Unanchored clause: provide s/sVar or o/oVar bound earlier", c);
      }

      // If both sides bound, we can just test by scanning neighbors of sBound.
      const scanSubjects = sBound ? [sBound] : [];
      // If only o is bound, we need reverse lookup; we don't have that index yet,
      // so we scan neighbors of oBound and treat as subject anchor if edge direction matches.
      // This is less ideal; recommend anchoring on subject in client.
      const scanAsSubjects = scanSubjects.length ? scanSubjects : [oBound!];

      for (const sid of scanAsSubjects) {
        const edges = await edgesAsOfForEntity(sid, asOf, pack);
        for (const e of edges) {
          if (e.predicate !== p) continue;
          if (!matchStatus(e)) continue;
          if (!hasTags(e, tags)) continue;
          if (sBound && e.s !== sBound) continue;
          if (oBound && e.o !== oBound) continue;

          // type filters (optional)
          if (sType) {
            const se = await entityById(e.s).catch(() => null);
            if (!se || String(se.type) !== sType) continue;
          }
          if (oType) {
            const oe = await entityById(e.o).catch(() => null);
            if (!oe || String(oe.type) !== oType) continue;
          }

          const nb: Bindings = { ...b };
          if (sVar) nb[sVar] = e.s;
          if (oVar) nb[oVar] = e.o;

          next.push({ b: nb, matches: env.matches.concat([e]) });
          if (next.length >= maxLimit) break;
        }
        if (next.length >= maxLimit) break;
      }
      if (next.length >= maxLimit) break;
    }

    envs = next;
    stats.push({ clauseIndex: i, predicate: p, in: before, out: envs.length });
    if (envs.length === 0) break;
  }

  // Project
  for (const env of envs.slice(0, maxLimit)) {
    const bindings: Bindings = {};
    if (Array.isArray(ret) && ret.length) {
      for (const k of ret) bindings[String(k)] = env.b[String(k)] ?? "";
    } else {
      Object.assign(bindings, env.b);
    }
    out.push({ bindings, matches: env.matches });
  }

  return explain ? { results: out, explain: { asOf, pack, status, stats } } : { results: out };
},

// Vectors (sidecar index). Caller supplies embeddings.
upsertVector: async (body: unknown): Promise<Readonly<{ item: VectorItem }>> => {
  const id = String((body as any)?.id ?? "");
  const kind = String((body as any)?.kind ?? "custom") as any;
  const pack = (body as any)?.pack ? String((body as any)?.pack) : undefined;
  const embedding = (body as any)?.embedding as number[];
  const tags = normalizeTags((body as any)?.tags);

  if (!id) die("Missing id");
  if (!Array.isArray(embedding) || embedding.some((x) => typeof x !== "number")) die("embedding must be number[]");

  const item = await upsertVector({ id, kind, pack, embedding, tags });
  return { item };
},

searchVectors: async (body: unknown): Promise<unknown> => {
  const query = (body as any)?.query as number[];
  const topK = Number((body as any)?.topK ?? 10);
  const filterPack = (body as any)?.filter?.pack ? String((body as any)?.filter?.pack) : undefined;
  const filterKind = (body as any)?.filter?.kind ? String((body as any)?.filter?.kind) : undefined;

  if (!Array.isArray(query) || query.some((x) => typeof x !== "number")) die("query must be number[]");

  return await searchVectors({ query, topK, filter: { pack: filterPack, kind: filterKind as any } });
},

};
