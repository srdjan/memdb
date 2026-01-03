# Tool schemas (MCP)

The MCP server (`packages/memdb-mcp`) exposes a small tool surface meant to stay stable.

All tools follow:

- **Input**: strict JSON, validated by the client/tooling using the JSON Schema in `packages/memdb-mcp/src/tools.ts`
- **Output**: strict JSON encoded as text in MCP tool responses (for maximum compatibility)

## Recommended conventions

- Always store raw observations as edges with `tags.status="observed"`.
- Only downstream “truth” reads should use the state-clock endpoint (`memdb.state.neighbors`) which reads `status="canonical"`.
- After any burst of new observations, call `memdb.resolve.apply` for affected entities to refresh canonical state.

## New in P20

### Resolver queue

- `POST /v1/resolve/enqueue` — schedule `resolve/apply` for an entity (pack-scoped)
- `GET /v1/resolve/queue` — inspect queued jobs (ops scope)

### State-clock helpers

- `GET /v1/state/diff` — canonical diff between two timestamps
- `GET /v1/state/subgraph` — canonical BFS snapshot rooted at an entity

### Metrics

- `GET /metrics` — Prometheus text format (ops scope)



### Pattern query

- `POST /v1/query/pattern` — anchored join-style pattern query over edges (canonical by default).


## New in P21

### Pattern query

- `POST /v1/query/pattern` — anchored, deterministic pattern matching over facts (supports `asOf`, `status`, `pack`)
- MCP: `memdb.query.pattern`

## New in P22

### Hybrid search endpoint

- `POST /v1/search/hybrid` — merges vector similarity, text match, and recency boost into a single scored result set.

### MCP: `memdb.search`

`memdb.search` now calls `/v1/search/hybrid` by default.

Typical usage:
- provide `q` for text-only
- provide `vector` for semantic-only
- provide both for hybrid

For facts, add `status: "canonical"` to stay on the state-clock lane.


## New in P23

### Subgraph hybrid search ("search around")

This endpoint combines **canonical neighborhood expansion** (state clock) with **hybrid scoring**
(vector + text + recency), producing a compact, high-signal context set for agents.

**REST**
- `POST /v1/search/around`

Request (example: canonical facts around a repo, depth 2):

```json
{
  "kind": "facts",
  "rootEntityId": "ent_repo_...",
  "pack": "coding_assistant",
  "asOf": "2025-12-30T21:00:00.000Z",
  "depth": 2,
  "status": "canonical",
  "q": "timeout cold start",
  "vector": [0.01, 0.02, 0.03],
  "filterTags": { "status": "canonical" },
  "halfLifeDays": 14,
  "limit": 10
}
```

Response shape:
- `neighborhood.nodeCount`, `neighborhood.edgeCount`
- `results[]` with `scoreBreakdown` and the selected record

**MCP**
- `memdb.search.around`

Use this when an agent already has an anchor entity (repo, subject, session, etc.) and wants the
best supporting facts/content/entities **without scanning the whole pack**.

Recommended agent loop:
1) find or bootstrap the anchor entity (by key)
2) write `trace/decision` (observed)
3) enqueue or apply resolution
4) use `memdb.search.around` for retrieval
