import { dbRoot, exists, pjoin, readJson } from "@memdb/core/lib/fs.ts";

type Scope = "read" | "write" | "ops";

export type ApiKeyRecord = Readonly<{
  id: string;
  key: string;
  scopes: readonly Scope[];
  packs: readonly string[]; // pack names or ["*"]
  rate?: Readonly<{ rps: number; burst: number }>;
}>;

type KeyFile = Readonly<{ keys: readonly ApiKeyRecord[] }>;

export type AuthOk = Readonly<{ kind: "ok"; key: ApiKeyRecord }>;
export type AuthDeny = Readonly<{ kind: "deny"; res: Response }>;

const json = (v: unknown, status = 401) =>
  new Response(JSON.stringify(v, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const keysFilePath = () => pjoin(dbRoot(), "kv", "auth", "keys.json");

const loadKeys = async (): Promise<readonly ApiKeyRecord[]> => {
  const env = Deno.env.get("MEMDB_API_KEYS_JSON");
  if (env && env.trim()) {
    const parsed = JSON.parse(env) as KeyFile;
    return parsed.keys ?? [];
  }
  const fp = keysFilePath();
  if (await exists(fp)) {
    const parsed = await readJson<KeyFile>(fp);
    return parsed.keys ?? [];
  }
  return [];
};

// simple in-memory token bucket per key
type Bucket = { tokens: number; lastRefillMs: number; rps: number; burst: number };
const buckets = new Map<string, Bucket>();

const rateAllow = (keyId: string, rate?: ApiKeyRecord["rate"]): boolean => {
  if (!rate) return true;
  const now = Date.now();
  const rps = Math.max(0.1, rate.rps);
  const burst = Math.max(1, rate.burst);
  const b = buckets.get(keyId) ?? { tokens: burst, lastRefillMs: now, rps, burst };
  const elapsed = (now - b.lastRefillMs) / 1000;
  const refill = elapsed * b.rps;
  b.tokens = Math.min(b.burst, b.tokens + refill);
  b.lastRefillMs = now;
  buckets.set(keyId, b);
  if (b.tokens >= 1) {
    b.tokens -= 1;
    return true;
  }
  return false;
};

const parseKey = (req: Request): string | null => {
  const h = req.headers.get("authorization") ?? "";
  if (h.toLowerCase().startsWith("bearer ")) return h.slice(7).trim();
  const x = req.headers.get("x-api-key");
  return x ? x.trim() : null;
};

const requiredScope = (url: URL, method: string): Scope | null => {
  const p = url.pathname;
  if (p === "/healthz") return null;
  if (!p.startsWith("/v1/")) return null;
  if (p === "/v1/init") return "ops";

  // reads
  if (method === "GET") return "read";

  // writes & ops (POST)
  if (p === "/v1/resolve") return "ops";
  if (p === "/v1/resolve/apply") return "ops";
  if (p === "/v1/maintain" || p === "/v1/maintain-all") return "ops";
  if (p === "/v1/index") return "ops";
  if (p === "/v1/report") return "ops";
  if (p === "/v1/bootstrap") return "ops";

  // everything else POST is write
  return "write";
};

export const authorize = async (req: Request, url: URL): Promise<AuthOk | AuthDeny> => {
  const scope = requiredScope(url, req.method);

  // Allow unauthenticated by default for local/dev unless explicitly required.
  const requireAuth = (Deno.env.get("MEMDB_REQUIRE_AUTH") ?? "false").toLowerCase() === "true";

  const keys = await loadKeys();
  if (!keys.length && !requireAuth) return { kind: "ok", key: { id: "dev-open", key: "", scopes: ["read", "write", "ops"], packs: ["*"] } };

  const presented = parseKey(req);
  if (!presented) return { kind: "deny", res: json({ error: "missing_api_key" }, 401) };

  const rec = keys.find((k) => k.key === presented);
  if (!rec) return { kind: "deny", res: json({ error: "invalid_api_key" }, 401) };

  if (!rateAllow(rec.id, rec.rate)) return { kind: "deny", res: json({ error: "rate_limited" }, 429) };

  if (scope && !rec.scopes.includes(scope)) return { kind: "deny", res: json({ error: "insufficient_scope", required: scope }, 403) };

  // Pack boundaries are enforced by handlers (when pack is known).
  return { kind: "ok", key: rec };
};

export const enforcePackAccess = (auth: AuthOk, pack: string): void => {
  const allowed = auth.key.packs;
  if (allowed.includes("*")) return;
  if (!allowed.includes(pack)) {
    throw Object.assign(new Error("forbidden_pack"), { details: { pack, allowed } });
  }
};
