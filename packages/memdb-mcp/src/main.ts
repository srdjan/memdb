import { tools } from "./tools.ts";

type JsonRpcId = string | number | null;
type JsonRpcReq = Readonly<{ jsonrpc: "2.0"; id?: JsonRpcId; method: string; params?: any }>;
type JsonRpcRes = Readonly<{ jsonrpc: "2.0"; id: JsonRpcId; result?: any; error?: any }>;

const apiUrl = (Deno.env.get("MEMDB_API_URL") ?? "http://localhost:8787").replace(/\/$/, "");
const apiKey = Deno.env.get("MEMDB_API_KEY") ?? "";

// Minimal stdio JSON-RPC (MCP) server.
const encoder = new TextEncoder();
const write = async (obj: unknown) => {
  const line = JSON.stringify(obj) + "\n";
  await Deno.stdout.write(encoder.encode(line));
};

const callApi = async (path: string, init: RequestInit): Promise<any> => {
  const headers = new Headers(init.headers ?? {});
  if (apiKey) headers.set("authorization", `Bearer ${apiKey}`);
  headers.set("content-type", "application/json");
  const res = await fetch(`${apiUrl}${path}`, { ...init, headers });
  const txt = await res.text();
  const data = txt ? JSON.parse(txt) : null;
  if (!res.ok) {
    throw Object.assign(new Error(data?.error ?? `HTTP ${res.status}`), { details: data });
  }
  return data;
};

const toolCall = async (name: string, args: any): Promise<any> => {
  switch (name) {
    case "memdb.search": {
      const kind0 = String(args?.kind ?? "facts");
      const kind = kind0 === "contents" ? "content" : kind0;
      const limit = Number(args?.limit ?? 10);

      const body = {
        kind,
        pack: args?.pack ?? null,
        status: args?.status ?? null,
        asOf: args?.asOf ?? null,
        q: args?.q ?? "",
        vector: Array.isArray(args?.vector) ? args.vector : null,
        filterTags: args?.filterTags ?? null,
        alpha: args?.alpha ?? null,
        beta: args?.beta ?? null,
        gamma: args?.gamma ?? null,
        halfLifeDays: args?.halfLifeDays ?? null,
        limit,
      };

      return await callApi(`/v1/search/hybrid`, { method: "POST", body: JSON.stringify(body) });
    }

    case "memdb.search.around": {
      const kind0 = String(args?.kind ?? "facts");
      const kind = kind0 === "contents" ? "content" : kind0;

      const body = {
        kind,
        rootEntityId: String(args?.rootEntityId ?? ""),
        pack: args?.pack ?? null,
        status: args?.status ?? null,
        asOf: args?.asOf ?? null,
        depth: args?.depth ?? null,
        limit: args?.limit ?? null,
        q: args?.q ?? "",
        vector: Array.isArray(args?.vector) ? args.vector : null,
        filterTags: args?.filterTags ?? null,
        alpha: args?.alpha ?? null,
        beta: args?.beta ?? null,
        gamma: args?.gamma ?? null,
        halfLifeDays: args?.halfLifeDays ?? null,
        maxNodes: args?.maxNodes ?? null,
        maxEdges: args?.maxEdges ?? null,
      };

      return await callApi(`/v1/search/around`, { method: "POST", body: JSON.stringify(body) });
    }

    case "memdb.state.neighbors": {
      const entityId = String(args?.entityId ?? "");
      const asOf = String(args?.asOf ?? new Date().toISOString());
      const pack = args?.pack ?? null;
      return await callApi(`/v1/state/neighbors?entityId=${encodeURIComponent(entityId)}&asOf=${encodeURIComponent(asOf)}${pack ? `&pack=${encodeURIComponent(String(pack))}` : ""}`, { method: "GET" });
    }
    case "memdb.state.diff": {
      const entityId = String(args?.entityId ?? "");
      const t1 = String(args?.t1 ?? "");
      const t2 = String(args?.t2 ?? "");
      const pack = args?.pack ?? null;
      const path =
        `/v1/state/diff?entityId=${encodeURIComponent(entityId)}` +
        `&t1=${encodeURIComponent(t1)}` +
        `&t2=${encodeURIComponent(t2)}` +
        (pack ? `&pack=${encodeURIComponent(String(pack))}` : "");
      return await callApi(path, { method: "GET" });
    }

    case "memdb.state.subgraph": {
      const rootEntityId = String(args?.rootEntityId ?? "");
      const asOf = String(args?.asOf ?? new Date().toISOString());
      const pack = args?.pack ?? null;
      const depth = Number(args?.depth ?? 2);
      const maxEdges = Number(args?.maxEdges ?? 500);
      const path =
        `/v1/state/subgraph?rootEntityId=${encodeURIComponent(rootEntityId)}` +
        `&asOf=${encodeURIComponent(asOf)}` +
        `&depth=${depth}` +
        `&maxEdges=${maxEdges}` +
        (pack ? `&pack=${encodeURIComponent(String(pack))}` : "");
      return await callApi(path, { method: "GET" });
    }

    case "memdb.resolve.apply": {
      return await callApi(`/v1/resolve/apply`, { method: "POST", body: JSON.stringify(args ?? {}) });
    }
    case "memdb.resolve.enqueue": {
      return await callApi(`/v1/resolve/enqueue`, { method: "POST", body: JSON.stringify(args ?? {}) });
    }
    case "memdb.trace.decision": {
      return await callApi(`/v1/trace/decision`, { method: "POST", body: JSON.stringify(args ?? {}) });
    }
    case "memdb.bootstrap": {
      return await callApi(`/v1/bootstrap`, { method: "POST", body: JSON.stringify(args ?? {}) });
    }
    
    case "memdb.query.pattern": {
      return await callApi(`/v1/query/pattern`, { method: "POST", body: JSON.stringify(args ?? {}) });
    }

    case "memdb.pool.post": {
      return await callApi(`/v1/pool/post`, { method: "POST", body: JSON.stringify(args ?? {}) });
    }
    case "memdb.pool.claim": {
      return await callApi(`/v1/pool/claim`, { method: "POST", body: JSON.stringify(args ?? {}) });
    }
    case "memdb.pool.release": {
      return await callApi(`/v1/pool/release`, { method: "POST", body: JSON.stringify(args ?? {}) });
    }
    case "memdb.pool.snapshot": {
      return await callApi(`/v1/pool/snapshot`, { method: "POST", body: JSON.stringify(args ?? {}) });
    }

default:
      throw new Error(`Unknown tool: ${name}`);
  }
};

const ok = (id: JsonRpcId, result: any): JsonRpcRes => ({ jsonrpc: "2.0", id, result });
const err = (id: JsonRpcId, code: number, message: string, data?: any): JsonRpcRes => ({
  jsonrpc: "2.0",
  id,
  error: { code, message, data },
});

const handle = async (req: JsonRpcReq) => {
  // Notifications (no id) -> no response.
  const id = ("id" in req) ? (req.id ?? null) : null;
  const isNotif = !("id" in req);

  try {
    if (req.method === "initialize") {
      const protocolVersion = req.params?.protocolVersion ?? "2024-11-05";
      const result = {
        protocolVersion,
        serverInfo: { name: "memdb-mcp", version: "0.0.1" },
        capabilities: { tools: { listChanged: false } },
      };
      if (!isNotif) await write(ok(id, result));
      return;
    }

    if (req.method === "tools/list") {
      const result = { tools };
      if (!isNotif) await write(ok(id, result));
      return;
    }

    if (req.method === "tools/call") {
      const name = String(req.params?.name ?? "");
      const args = req.params?.arguments ?? {};
      const out = await toolCall(name, args);
      const result = {
        content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
      };
      if (!isNotif) await write(ok(id, result));
      return;
    }

    // Unknown -> error
    if (!isNotif) await write(err(id, -32601, `Method not found: ${req.method}`));
  } catch (e) {
    if (!isNotif) await write(err(id, -32000, String((e as any)?.message ?? e), (e as any)?.details));
  }
};

// Streaming newline-delimited JSON
const decoder = new TextDecoderStream();
const input = Deno.stdin.readable.pipeThrough(decoder);

let buf = "";
for await (const chunk of input) {
  buf += chunk;
  while (true) {
    const nl = buf.indexOf("\n");
    if (nl < 0) break;
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let req: JsonRpcReq | null = null;
    try {
      req = JSON.parse(line);
    } catch {
      // ignore
      continue;
    }
    await handle(req);
  }
}
