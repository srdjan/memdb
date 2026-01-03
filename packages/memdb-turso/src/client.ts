export type TursoConfig = Readonly<{
  /** Base HTTP URL like: https://db-org.turso.io (without /v2/pipeline) */
  url: string;
  /** Database auth token (Bearer) created via: turso db tokens create <db> */
  token: string;
  /** Optional fetch implementation (mainly for tests) */
  fetch?: typeof fetch;
}>;

export type TursoArg =
  | Readonly<{ type: "null" }>
  | Readonly<{ type: "integer"; value: number }>
  | Readonly<{ type: "float"; value: number }>
  | Readonly<{ type: "text"; value: string }>
  | Readonly<{ type: "blob"; base64: string }>;

export type TursoStmt = Readonly<{
  sql: string;
  args?: readonly TursoArg[];
  named_args?: readonly Readonly<{ name: string; value: TursoArg }>[];
}>;

export type TursoPipelineReq =
  | Readonly<{ type: "execute"; stmt: TursoStmt }>
  | Readonly<{ type: "close" }>;

export type TursoPipelineBody = Readonly<{ requests: readonly TursoPipelineReq[] }>;

export type TursoExecuteResult = Readonly<{
  cols: readonly unknown[];
  rows: readonly unknown[];
  affected_row_count: number;
  last_insert_rowid: string | null;
  replication_index?: string;
}>;

export type TursoPipelineResultItem =
  | Readonly<{ type: "ok"; response: Readonly<{ type: "execute"; result: TursoExecuteResult }> }>
  | Readonly<{ type: "ok"; response: Readonly<{ type: "close" }> }>
  | Readonly<{ type: "error"; error: unknown }>;

export type TursoPipelineResponse = Readonly<{
  results: readonly TursoPipelineResultItem[];
  baton?: string | null;
  base_url?: string | null;
}>;

const ensurePipelineUrl = (baseUrl: string): string => {
  const u = baseUrl.trim().replace(/\/+$/, "");
  return u.endsWith("/v2/pipeline") ? u : `${u}/v2/pipeline`;
};

export const tursoArg = (v: unknown): TursoArg => {
  if (v === null || v === undefined) return { type: "null" };
  if (typeof v === "number") return Number.isInteger(v) ? { type: "integer", value: v } : { type: "float", value: v };
  if (typeof v === "string") return { type: "text", value: v };
  throw new Error(`Unsupported Turso arg type: ${typeof v}`);
};

export type TursoClient = Readonly<{
  url: string;
  pipeline: (body: TursoPipelineBody) => Promise<TursoPipelineResponse>;
  execute: (sql: string, args?: readonly unknown[]) => Promise<TursoExecuteResult>;
  execMany: (stmts: readonly Readonly<{ sql: string; args?: readonly unknown[] }>[]) => Promise<void>;
}>;

export const createTursoClient = (cfg: TursoConfig): TursoClient => {
  const url = ensurePipelineUrl(cfg.url);
  const f = cfg.fetch ?? fetch;

  const pipeline = async (body: TursoPipelineBody): Promise<TursoPipelineResponse> => {
    const res = await f(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${cfg.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const txt = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(txt);
    } catch {
      throw new Error(`Turso pipeline returned non-JSON (status ${res.status}): ${txt.slice(0, 200)}`);
    }

    if (!res.ok) {
      throw new Error(`Turso pipeline HTTP ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
    }

    return json as TursoPipelineResponse;
  };

  const execute = async (sql: string, args?: readonly unknown[]): Promise<TursoExecuteResult> => {
    const reqs: TursoPipelineReq[] = [{
      type: "execute",
      stmt: {
        sql,
        args: (args ?? []).map(tursoArg),
      },
    }, { type: "close" }];
    const out = await pipeline({ requests: reqs });
    const first = out.results[0];
    if (!first || (first as any).type !== "ok" || (first as any).response?.type !== "execute") {
      throw new Error(`Unexpected Turso execute response: ${JSON.stringify(out).slice(0, 400)}`);
    }
    return (first as any).response.result as TursoExecuteResult;
  };

  const execMany = async (stmts: readonly Readonly<{ sql: string; args?: readonly unknown[] }>[]): Promise<void> => {
    if (stmts.length === 0) return;
    const reqs: TursoPipelineReq[] = [
      ...stmts.map((s) => ({
        type: "execute" as const,
        stmt: { sql: s.sql, args: (s.args ?? []).map(tursoArg) },
      })),
      { type: "close" as const },
    ];
    const out = await pipeline({ requests: reqs });
    // ensure no errors
    for (const r of out.results) {
      if ((r as any).type === "error") throw new Error(`Turso pipeline error: ${JSON.stringify(r).slice(0, 400)}`);
    }
  };

  return { url, pipeline, execute, execMany };
};

export const tursoFromEnv = (): TursoClient | null => {
  const url = Deno.env.get("MEMDB_TURSO_URL") ?? "";
  const token = Deno.env.get("MEMDB_TURSO_TOKEN") ?? "";
  if (!url.trim() || !token.trim()) return null;
  return createTursoClient({ url, token });
};
