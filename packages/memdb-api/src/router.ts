import { v1 } from "./v1.ts";
import { authorize, enforcePackAccess } from "./auth.ts";
import { inc, renderProm, setGauge } from "./metrics.ts";
import { listPacks, listEntities, getEntity } from "./ui_endpoints.ts";

const jsonRes = (v: unknown, status = 200, extraHeaders: HeadersInit = {}) =>
  new Response(JSON.stringify(v, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });

const textRes = (s: string, status = 200, extraHeaders: HeadersInit = {}) =>
  new Response(s, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      ...extraHeaders,
    },
  });

const cors = (req: Request): HeadersInit => {
  const origin = req.headers.get("origin") ?? "*";
  return {
    "access-control-allow-origin": origin === "null" ? "*" : origin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization,x-api-key",
    "access-control-max-age": "600",
    "vary": "origin",
  };
};

export const router = async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const cid = req.headers.get("x-correlation-id") ?? crypto.randomUUID();
  const h = { ...cors(req), "x-correlation-id": cid } as HeadersInit;
  inc("memdb_requests_total", { method: req.method, path: url.pathname });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });

  if (req.method === "GET" && url.pathname === "/healthz") {
    return jsonRes({ ok: true }, 200, h);
  }


  // auth (optional, but strongly recommended)
  const auth = await authorize(req, url);
  if (auth.kind === "deny") return auth.res;
  void auth;

if (req.method === "GET" && url.pathname === "/metrics") {
  if (!auth.scopes.includes("ops")) return textRes("Forbidden", 403, h);
  try {
    const q = await v1.resolveQueue() as any;
    const n = Array.isArray(q?.queue) ? q.queue.length : 0;
    setGauge("memdb_resolution_queue_length", {}, n);
  } catch {
    // ignore
  }
  return new Response(renderProm(), {
    status: 200,
    headers: { ...h, "content-type": "text/plain; version=0.0.4; charset=utf-8" },
  });
}


const enforcePack = (pack: string | null | undefined) => {
  if (!pack) return;
  if (pack === "all") return;
  enforcePackAccess(auth, pack);
};

// v1 REST endpoints (preferred for new consumers)
if (req.method === "POST" && url.pathname === "/v1/init") {
  const res = await v1.init();
  return jsonRes(res, 200, h);
}

// bootstrap (seed entity spine)
if (req.method === "POST" && url.pathname === "/v1/bootstrap") {
  const body = await req.json().catch(() => ({}));
  enforcePack(String((body as any)?.pack ?? ""));
  try {
    const res = await v1.bootstrap(body);
    return jsonRes(res, 200, h);
  } catch (e) {
    return jsonRes({ error: String((e as any)?.message ?? e), details: (e as any)?.details }, 400, h);
  }
}

if (req.method === "POST" && url.pathname === "/v1/entities") {
  const body = await req.json().catch(() => null);
  try {
    const res = await v1.createEntity(body);
    return jsonRes(res, 200, h);
  } catch (e) {
    return jsonRes({ error: String((e as any)?.message ?? e), details: (e as any)?.details }, 400, h);
  }
}

if (req.method === "GET" && url.pathname === "/v1/entities") {
  const pack = url.searchParams.get("pack");
  enforcePack(pack && pack !== "all" ? pack : null);
  const res = await v1.listEntities(pack && pack !== "all" ? pack : null);
  return jsonRes(res, 200, h);
}

const entV1 = url.pathname.match(/^\/v1\/entities\/(?<id>[^/]+)$/);
if (req.method === "GET" && entV1) {
  const id = entV1.groups?.id ?? "";
  const ent = await v1.getEntityById(id);
  if (!ent) // index (rebuild pointers/adjacency/timeline/tag indexes)
if (req.method === "POST" && url.pathname === "/v1/index") {
  const res = await v1.index();
  return jsonRes(res, 200, h);
}


// health (maintenance inspection)
if (req.method === "GET" && url.pathname === "/v1/health") {
  const entityId = url.searchParams.get("entityId") ?? "";
  const asOf = url.searchParams.get("asOf") ?? new Date().toISOString();
  const pack = url.searchParams.get("pack");
  enforcePack(pack && pack !== "all" ? pack : null);
  const res = await v1.health(entityId, pack && pack !== "all" ? pack : null, asOf);
  return jsonRes(res, 200, h);
}


// maintain-all (batch maintenance)
if (req.method === "POST" && url.pathname === "/v1/maintain-all") {
  const body = await req.json().catch(() => ({}));
  const pack = String((body as any)?.pack ?? "");
  if (pack) enforcePack(pack);
  const res = await v1.maintainAll(body);
  return jsonRes(res, 200, h);
}


// maintain (rebuild per-entity adjacency/current pointers)
if (req.method === "POST" && url.pathname === "/v1/maintain") {
  const body = await req.json().catch(() => ({}));
  const entityId = String((body as any)?.entityId ?? "");
  const asOf = String((body as any)?.asOf ?? new Date().toISOString());
  const pack = (body as any)?.pack ? String((body as any)?.pack) : null;
  enforcePack(pack);
  const res = await v1.maintain(entityId, pack, asOf);
  return jsonRes(res, 200, h);
}


// report (stats)
if (req.method === "POST" && url.pathname === "/v1/report") {
  const body = await req.json().catch(() => ({}));
  const pack = String((body as any)?.pack ?? "");
  if (pack) enforcePack(pack);
  const res = await v1.report(body);
  return jsonRes(res, 200, h);
}


return jsonRes({ error: "not found" }, 404, h);
  return jsonRes(ent, 200, h);
}

if (req.method === "POST" && url.pathname === "/v1/events") {
  const body = await req.json().catch(() => null);
  try {
    const res = await v1.createEvent(body);
    return jsonRes(res, 200, h);
  } catch (e) {
    return jsonRes({ error: String((e as any)?.message ?? e), details: (e as any)?.details }, 400, h);
  }
}

const evtV1 = url.pathname.match(/^\/v1\/events\/(?<id>[^/]+)$/);
if (req.method === "GET" && evtV1) {
  const id = evtV1.groups?.id ?? "";
  const evt = await v1.getEvent(id);
  if (!evt) return jsonRes({ error: "not found" }, 404, h);
  return jsonRes(evt, 200, h);
}

if (req.method === "POST" && url.pathname === "/v1/edges") {
  const body = await req.json().catch(() => null);
  try {
    const res = await v1.createEdge(body);
    return jsonRes(res, 200, h);
  } catch (e) {
    return jsonRes({ error: String((e as any)?.message ?? e), details: (e as any)?.details }, 400, h);
  }
}

if (req.method === "POST" && url.pathname === "/v1/edges/retract") {
  const body = await req.json().catch(() => null);
  try {
    const res = await v1.retractEdge(body);
    return jsonRes(res, 200, h);
  } catch (e) {
    return jsonRes({ error: String((e as any)?.message ?? e), details: (e as any)?.details }, 400, h);
  }
}

// decision trace helper (content + event + observed facts)
if (req.method === "POST" && url.pathname === "/v1/trace/decision") {
  const body = await req.json().catch(() => ({}));
  enforcePack(String((body as any)?.pack ?? ""));
  try {
    const res = await v1.traceDecision(body);
    return jsonRes(res, 200, h);
  } catch (e) {
    return jsonRes({ error: String((e as any)?.message ?? e), details: (e as any)?.details }, 400, h);
  }
}

if (req.method === "GET" && url.pathname === "/v1/neighbors") {
  const entityId = url.searchParams.get("entityId") ?? "";
  if (!entityId) return jsonRes({ error: "missing entityId" }, 400, h);
  const asOf = url.searchParams.get("asOf") ?? new Date().toISOString();
  const pack = url.searchParams.get("pack");
  enforcePack(pack && pack !== "all" ? pack : null);
  const res = await v1.neighbors(entityId, asOf, pack && pack !== "all" ? pack : null);
  return jsonRes(res, 200, h);
}

// state-clock neighbors (canonical facts only)
if (req.method === "GET" && url.pathname === "/v1/state/neighbors") {
  const entityId = url.searchParams.get("entityId") ?? "";
  const asOf = url.searchParams.get("asOf") ?? new Date().toISOString();
  const pack = url.searchParams.get("pack");
  enforcePack(pack && pack !== "all" ? pack : null);
  try {
    const res = await v1.stateNeighbors(entityId, asOf, pack && pack !== "all" ? pack : null);
    return jsonRes(res, 200, h);
  } catch (e) {
    return jsonRes({ error: String((e as any)?.message ?? e), details: (e as any)?.details }, 400, h);
  }
}

// state diff (canonical edges)
if (req.method === "GET" && url.pathname === "/v1/state/diff") {
  const entityId = url.searchParams.get("entityId") ?? "";
  const t1 = url.searchParams.get("t1") ?? "";
  const t2 = url.searchParams.get("t2") ?? "";
  const pack = url.searchParams.get("pack");
  if (pack) enforcePackAccess(auth, pack);
  try {
    const res = await v1.stateDiff(entityId, t1, t2, pack && pack !== "all" ? pack : null);
    return jsonRes(res, 200, h);
  } catch (e) {
    inc("memdb_errors_total", { path: url.pathname });
    return jsonRes({ error: String((e as any)?.message ?? e), details: (e as any)?.details }, 400, h);
  }
}

// state subgraph snapshot (canonical edges)
if (req.method === "GET" && url.pathname === "/v1/state/subgraph") {
  const rootEntityId = url.searchParams.get("rootEntityId") ?? "";
  const asOf = url.searchParams.get("asOf") ?? new Date().toISOString();
  const pack = url.searchParams.get("pack");
  const depth = Number(url.searchParams.get("depth") ?? "2");
  const maxEdges = Number(url.searchParams.get("maxEdges") ?? "500");
  if (pack) enforcePackAccess(auth, pack);
  try {
    const res = await v1.stateSubgraph(rootEntityId, asOf, pack && pack !== "all" ? pack : null, depth, maxEdges);
    return jsonRes(res, 200, h);
  } catch (e) {
    inc("memdb_errors_total", { path: url.pathname });
    return jsonRes({ error: String((e as any)?.message ?? e), details: (e as any)?.details }, 400, h);
  }
}

if (req.method === "GET" && url.pathname === "/v1/path") {
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (!from || !to) return jsonRes({ error: "missing from/to" }, 400, h);
  const asOf = url.searchParams.get("asOf") ?? new Date().toISOString();
  const pack = url.searchParams.get("pack");
  enforcePack(pack && pack !== "all" ? pack : null);
  const maxDepth = Number(url.searchParams.get("maxDepth") ?? "6");
  try {
    const res = await v1.path(from, to, asOf, pack && pack !== "all" ? pack : null, maxDepth);
    return jsonRes(res, 200, h);
  } catch (e) {
    return jsonRes({ error: String((e as any)?.message ?? e), details: (e as any)?.details }, 404, h);
  }
}

// pattern query (JSON body)
if (req.method === "POST" && url.pathname === "/v1/query/pattern") {
  const body = await req.json().catch(() => ({}));
  enforcePack(String((body as any)?.pack ?? ""));
  try {
    const res = await v1.queryPattern(body);
    return jsonRes(res, 200, h);
  } catch (e) {
    inc("memdb_errors_total", { path: url.pathname });
    return jsonRes({ error: String((e as any)?.message ?? e), details: (e as any)?.details }, 400, h);
  }
}

if (req.method === "GET" && url.pathname === "/v1/timeline") {
  const entityId = url.searchParams.get("entityId") ?? "";
  if (!entityId) return jsonRes({ error: "missing entityId" }, 400, h);
  const res = await v1.timeline(entityId);
  return jsonRes(res, 200, h);
}

if (req.method === "GET" && url.pathname === "/v1/entity-ids") {
  const res = await v1.listEntityIds();
  return jsonRes(res, 200, h);
}

// content
if (req.method === "POST" && url.pathname === "/v1/content") {
  const body = await req.json().catch(() => null);
  enforcePack(String((body as any)?.pack ?? ""));
  try {
    const res = await v1.createContent(body);
    return jsonRes(res, 200, h);
  } catch (e) {
    return jsonRes({ error: String((e as any)?.message ?? e), details: (e as any)?.details }, 400, h);
  }
}

if (req.method === "GET" && url.pathname === "/v1/content") {
  const pack = url.searchParams.get("pack");
  enforcePack(pack && pack !== "all" ? pack : null);
  const res = await v1.listContents(pack && pack !== "all" ? pack : null);
  return jsonRes(res, 200, h);
}

const contentGet = url.pathname.match(/^\/v1\/content\/(?<id>[^/]+)$/);
if (req.method === "GET" && contentGet) {
  const id = contentGet.groups?.id ?? "";
  const c = await v1.getContent(id);
  if (!c) return jsonRes({ error: "not found" }, 404, h);
  return jsonRes(c, 200, h);
}

// search (simple text)
if (req.method === "GET" && url.pathname === "/v1/search") {
  const q = url.searchParams.get("q") ?? "";
  const kind = url.searchParams.get("kind") ?? "entities";
  const pack = url.searchParams.get("pack");
  enforcePack(pack && pack !== "all" ? pack : null);
  const res = await v1.search(q, kind, pack && pack !== "all" ? pack : null);
  return jsonRes(res, 200, h);
}

// search (hybrid: vector + text + recency)
if (req.method === "POST" && url.pathname === "/v1/search/hybrid") {
  const body = await req.json().catch(() => null);
  const pack = (body as any)?.pack ? String((body as any).pack) : null;
  enforcePack(pack && pack !== "all" ? pack : null);
  try {
    const res = await v1.hybridSearch(body);
    return jsonRes(res, 200, h);
  } catch (e) {
    return jsonRes({ error: String((e as any)?.message ?? e), details: (e as any)?.details }, 400, h);
  }
}

if (req.method === "POST" && url.pathname === "/v1/search/around") {
  const body = await req.json().catch(() => null);
  const pack = (body as any)?.pack ? String((body as any).pack) : null;
  enforcePack(pack && pack !== "all" ? pack : null);
  try {
    const res = await v1.searchAround(body);
    return jsonRes(res, 200, h);
  } catch (e) {
    return jsonRes({ error: String((e as any)?.message ?? e), details: (e as any)?.details }, 400, h);
  }
}

// pool coordinator
if (req.method === "POST" && url.pathname === "/v1/pool/post") {
  const body = await req.json().catch(() => null);
  const pack = (body as any)?.pack ? String((body as any).pack) : null;
  enforcePack(pack && pack !== "all" ? pack : null);
  try {
    const res = await v1.poolPost(body);
    return jsonRes(res, 200, h);
  } catch (e) {
    return jsonRes({ error: String((e as any)?.message ?? e), details: (e as any)?.details }, 400, h);
  }
}

if (req.method === "POST" && url.pathname === "/v1/pool/claim") {
  const body = await req.json().catch(() => null);
  const pack = (body as any)?.pack ? String((body as any).pack) : null;
  enforcePack(pack && pack !== "all" ? pack : null);
  try {
    const res = await v1.poolClaim(body);
    return jsonRes(res, 200, h);
  } catch (e) {
    return jsonRes({ error: String((e as any)?.message ?? e), details: (e as any)?.details }, 400, h);
  }
}

if (req.method === "POST" && url.pathname === "/v1/pool/release") {
  const body = await req.json().catch(() => null);
  const pack = (body as any)?.pack ? String((body as any).pack) : null;
  enforcePack(pack && pack !== "all" ? pack : null);
  try {
    const res = await v1.poolRelease(body);
    return jsonRes(res, 200, h);
  } catch (e) {
    return jsonRes({ error: String((e as any)?.message ?? e), details: (e as any)?.details }, 400, h);
  }
}

if (req.method === "POST" && url.pathname === "/v1/pool/snapshot") {
  const body = await req.json().catch(() => null);
  const pack = (body as any)?.pack ? String((body as any).pack) : null;
  enforcePack(pack && pack !== "all" ? pack : null);
  try {
    const res = await v1.poolSnapshot(body);
    return jsonRes(res, 200, h);
  } catch (e) {
    return jsonRes({ error: String((e as any)?.message ?? e), details: (e as any)?.details }, 400, h);
  }
}

// resolver
if (req.method === "POST" && url.pathname === "/v1/resolve") {
  const body = await req.json().catch(() => null);
  try {
    const res = await v1.resolve(body);
    return jsonRes(res, 200, h);
  } catch (e) {
    return jsonRes({ error: String((e as any)?.message ?? e), details: (e as any)?.details }, 400, h);
  }
}

// resolver apply (emit canonical + synthesized facts)
if (req.method === "POST" && url.pathname === "/v1/resolve/apply") {
  const body = await req.json().catch(() => ({}));
  enforcePack(String((body as any)?.pack ?? ""));
  try {
    const res = await v1.resolveApply(body);
    return jsonRes(res, 200, h);
  } catch (e) {
    return jsonRes({ error: String((e as any)?.message ?? e), details: (e as any)?.details }, 400, h);
  }
}


// resolver enqueue (schedule apply)
if (req.method === "POST" && url.pathname === "/v1/resolve/enqueue") {
  const body = await req.json().catch(() => ({}));
  enforcePack(String((body as any)?.pack ?? ""));
  try {
    const res = await v1.resolveEnqueue(body);
    return jsonRes(res, 200, h);
  } catch (e) {
    inc("memdb_errors_total", { path: url.pathname });
    return jsonRes({ error: String((e as any)?.message ?? e), details: (e as any)?.details }, 400, h);
  }
}

// resolver queue (ops)
if (req.method === "GET" && url.pathname === "/v1/resolve/queue") {
  if (!auth.scopes.includes("ops")) return textRes("Forbidden", 403, h);
  try {
    const res = await v1.resolveQueue();
    return jsonRes(res, 200, h);
  } catch (e) {
    inc("memdb_errors_total", { path: url.pathname });
    return jsonRes({ error: String((e as any)?.message ?? e), details: (e as any)?.details }, 400, h);
  }
}

// vectors
if (req.method === "POST" && url.pathname === "/v1/vectors/upsert") {
  const body = await req.json().catch(() => null);
  try {
    const res = await v1.upsertVector(body);
    return jsonRes(res, 200, h);
  } catch (e) {
    return jsonRes({ error: String((e as any)?.message ?? e), details: (e as any)?.details }, 400, h);
  }
}

if (req.method === "POST" && url.pathname === "/v1/vectors/search") {
  const body = await req.json().catch(() => null);
  try {
    const res = await v1.searchVectors(body);
    return jsonRes(res, 200, h);
  } catch (e) {
    return jsonRes({ error: String((e as any)?.message ?? e), details: (e as any)?.details }, 400, h);
  }
}

  // Convenience endpoints for UIs
  if (req.method === "GET" && url.pathname === "/api/packs") {
    return jsonRes(await listPacks(), 200, h);
  }

  if (req.method === "GET" && url.pathname === "/api/entities") {
    const pack = url.searchParams.get("pack");
    return jsonRes(await listEntities(pack && pack !== "all" ? pack : null), 200, h);
  }

  const entMatch = url.pathname.match(/^\/api\/entities\/(?<id>[^/]+)$/);
  if (req.method === "GET" && entMatch) {
    const id = entMatch.groups?.id ?? "";
    const ent = await getEntity(id);
    if (!ent) return jsonRes({ error: "not found" }, 404, h);
    return jsonRes(ent, 200, h);
  }

  return textRes("Not Found", 404, h);
};