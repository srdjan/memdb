# Turso / libSQL OLTP Spine (Optional)

memdb’s filesystem store is optimized for **immutability and auditability** (content/events/observed facts + temporal indexes).
For many workloads, you also want a fast, conventional **OLTP read path** for the **state clock** (canonical facts).

This optional integration lets you keep memdb’s evidence trail on disk while serving canonical reads from Turso/libSQL.

## What goes into Turso?

Only the **canonical lane**:

- canonical facts (`tags.status = "canonical"`)
- checkpoints for incremental sync

Everything else stays on disk (content, events, observed/superseded facts, embeddings, etc.).

## Setup

1. Create / choose a Turso database and obtain its HTTP URL:

```bash
turso db show <db-name> --http-url
```

2. Create an auth token:

```bash
turso db tokens create <db-name>
```

3. Export env vars:

```bash
export MEMDB_TURSO_URL="https://<db>-<org>.turso.io"
export MEMDB_TURSO_TOKEN="<token>"
```

(Per Turso’s HTTP quickstart, memdb will call the `/v2/pipeline` endpoint automatically.) 

## Migrate schema

```bash
deno task turso:migrate
```

## One-shot sync from filesystem deltas

```bash
deno task turso:sync
```

Optional pack filter:

```bash
export MEMDB_TURSO_SYNC_PACK="core"
deno task turso:sync
```

## Continuous sync (API-side)

If you want the memdb API to keep Turso updated in the background:

```bash
export MEMDB_TURSO_SYNC=true
export MEMDB_TURSO_SYNC_INTERVAL_MS=5000
deno task api
```

## Serve state-clock reads from Turso

Turn on canonical reads:

```bash
export MEMDB_TURSO_CANONICAL_READS=true
deno task api
```

Now **state-clock endpoints** (canonical neighbors, diff, subgraph) will read from Turso when configured.

## Design notes

- **Write-through on apply:** `resolve/apply` will also attempt to upsert canonical facts into Turso immediately (best-effort).
- **Incremental:** The sync loop consumes memdb’s `kv/deltas/<entityId>/*.ndjson` logs and updates canonical rows.
- **No new dependencies:** This package uses Deno `fetch()` and the libSQL HTTP pipeline.

## References

- Turso HTTP Quickstart: https://docs.turso.tech/sdk/http/quickstart
