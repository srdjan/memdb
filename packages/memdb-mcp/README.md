# memdb-mcp

A **Model Context Protocol (MCP)** stdio server that exposes `memdb` as tools usable from agent runtimes
(e.g., Claude Code, OpenAI Codex, etc.) via a stable, JSON-only tool surface.

## Run (stdio)

```bash
MEMDB_API_URL=http://localhost:8787 MEMDB_API_KEY=memdb_dev_key deno run -A packages/memdb-mcp/src/main.ts
```

## What it does

- Implements MCP over **stdio** (JSON-RPC 2.0)
- Proxies tool calls to `memdb-api` REST endpoints
- Enforces strict JSON in/out per tool

See `../../docs/mcp.md` for configuration examples.
