# memdb monorepo

This repository contains:

- **packages/memdb-core** — the filesystem-backed temporal graph + KV metadata + delta logs + checkpoints + manifests + maintenance tooling (P0–P14)
- **packages/memdb-cli** — CLI (HTTP client)
- **packages/memdb-api** — HTTP API server (web + CLI consumer)
- **apps/memdb-web** — a placeholder SSR web app for building agent-specific memory UIs and workflows

## Quick start (API + CLI)

```bash
# terminal 1
deno task api

# terminal 2
deno task mem init
deno task mem index
```

## Quick start (core)

```bash
deno task mem init
deno task mem index
```

See `packages/memdb-core/README.md` for full docs and commands.

## Quick start (web placeholder)

```bash
deno task -c apps/memdb-web/deno.jsonc dev
```

Then open http://localhost:8000

## Repo layout

```
apps/
  memdb-web/        # placeholder UI (SSR + HTMX-style partials)
packages/
  memdb-core/       # CLI + storage engine
```

## Design intent

The **core** is deliberately “boring” and scriptable so it can act as an *agent memory substrate*:
- multiple packs (coding assistant, identity verifier, etc.)
- temporal edges with as-of queries
- delta logs + rollups + segmentation
- per-entity manifest for O(1) planning
- `maintain-all` and drift `report` for ops

The **web app** is intentionally minimal: your teams can fork it to build:
- a per-agent “memory browser”
- annotation workflows
- human-in-the-loop review (e.g. “pin”, “retract”, “merge”)
- agent creation + pack templates


## REST API quick peek

```bash
# create an entity
curl -sS http://localhost:8787/v1/entities \
  -H 'content-type: application/json' \
  -d '{"pack":"coding_assistant","type":"file","key":"README.md","tags":{"lang":"ts"}}'

# neighbors (as-of)
curl -sS 'http://localhost:8787/v1/neighbors?entityId=ent_...&asOf=2025-12-28T12:00:00Z&pack=coding_assistant'
```

## P20 quick wins

- Auto-conflict interval closing via pack `policy.conflictPolicies`
- Resolution queue + worker (`/v1/resolve/enqueue`, `MEMDB_RESOLVE_WORKER_MS`)
- State diffs + subgraph snapshots (`/v1/state/diff`, `/v1/state/subgraph`)
- Prometheus metrics endpoint (`/metrics`, ops scope)


## Optional: Turso / libSQL OLTP spine

memdb can optionally mirror **canonical facts** into a Turso/libSQL database to provide a fast OLTP read path for the **state clock**.

- Docs: `docs/turso.md`
- Tasks: `deno task turso:migrate`, `deno task turso:sync`

