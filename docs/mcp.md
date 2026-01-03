# MCP integration (Claude Code + OpenAI Codex)

This repo includes an MCP stdio server at:

- `packages/memdb-mcp`

It exposes a small set of **strict JSON** tools that proxy to `memdb-api` REST endpoints.

## 1) Run memdb + memdb-mcp

Start the API:

```bash
deno task api
```

Start MCP server (stdio):

```bash
MEMDB_API_URL=http://localhost:8787 MEMDB_API_KEY=memdb_dev_key deno run -A packages/memdb-mcp/src/main.ts
```

## 2) Claude Code

### Option A: project-scoped `.mcp.json`

Create `.mcp.json` in your repo root:

```json
{
  "mcpServers": {
    "memdb": {
      "command": "deno",
      "args": ["run", "-A", "packages/memdb-mcp/src/main.ts"],
      "env": {
        "MEMDB_API_URL": "http://localhost:8787",
        "MEMDB_API_KEY": "memdb_dev_key"
      }
    }
  }
}
```

### Option B: CLI add

```bash
claude mcp add --transport stdio memdb -- deno run -A packages/memdb-mcp/src/main.ts
```

Then in Claude Code: use `/mcp` to verify the server is connected.

## 3) OpenAI Codex (CLI/IDE)

Codex supports MCP servers via `~/.codex/config.toml`.

Example:

```toml
[mcp_servers.memdb]
command = "deno"
args = ["run", "-A", "/ABS/PATH/TO/your-repo/packages/memdb-mcp/src/main.ts"]
env = { MEMDB_API_URL = "http://localhost:8787", MEMDB_API_KEY = "memdb_dev_key" }
```

> Note: adjust the absolute path as needed for your machine.

## 4) Tool list

The server exposes:

- `memdb.search`
- `memdb.state.neighbors`
- `memdb.state.diff` *(P20)*
- `memdb.state.subgraph` *(P20)*
- `memdb.resolve.apply`
- `memdb.resolve.enqueue` *(P20)*
- `memdb.trace.decision`
- `memdb.bootstrap`


### memdb.search (hybrid search)

`memdb.search` calls `POST /v1/search/hybrid` under the hood. You can provide `q`, `vector`, or both.

Example (canonical facts, recency-boosted):

```json
{
  "kind": "facts",
  "pack": "coding_assistant",
  "status": "canonical",
  "q": "timeout",
  "vector": [0.01, 0.02, 0.03],
  "limit": 10,
  "halfLifeDays": 14
}
```

Each tool has a strict JSON input schema (see `packages/memdb-mcp/src/tools.ts`).


### memdb.search.around (subgraph hybrid retrieval)

This tool expands a **small canonical neighborhood** around an anchor entity, then runs **hybrid scoring**
(vector + text + recency) *within that neighborhood*.

Use when:
- you already have a specific anchor (`Repo`, `Subject`, `Session`, etc.)
- you want the best few facts/content near it, not global search

Example payload:

```json
{
  "kind": "facts",
  "rootEntityId": "ent_...",
  "pack": "coding_assistant",
  "depth": 2,
  "status": "canonical",
  "q": "timeout",
  "halfLifeDays": 14,
  "limit": 10
}
```

## New tool: memdb.query.pattern

Use this tool to run anchored pattern queries over canonical or observed lanes.
