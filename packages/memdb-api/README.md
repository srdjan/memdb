# memdb-api

HTTP API wrapper around `memdb-core` command engine.

This package exposes:
- a **JSON RPC** endpoint (`POST /rpc (removed)`) that can run any `mem` command
- a few convenience endpoints for UIs:
  - `GET /api/packs`
  - `GET /api/entities?pack=<pack|all>`
  - `GET /api/entities/<id>`

## Run

From repo root:

```bash
deno task -c packages/memdb-api/deno.jsonc dev
```

Default: http://localhost:8787

## Environment

- `MEMDB_API_PORT` (default: 8787)
- `MEMDB_ROOT` (same as core; where the filesystem DB lives)

## RPC

Removed in P15. Use the v1 REST endpoints.
json
{ "argv": ["init"] }
```

Response:
```json
{ "ok": true, "exitCode": 0, "stdout": "...", "stderr": "" }
```


## v1 (REST)

Preferred endpoints for new consumers:

- `POST /v1/init`
- `POST /v1/entities`
- `GET /v1/entities?pack=`
- `GET /v1/entities/:id`
- `POST /v1/events`
- `GET /v1/events/:id`
- `POST /v1/edges`
- `POST /v1/edges/retract`
- `GET /v1/neighbors?entityId=&asOf=&pack=`
- `GET /v1/path?from=&to=&asOf=&pack=&maxDepth=`
- `GET /v1/timeline?entityId=`

`/rpc (removed)` was removed in P15.
