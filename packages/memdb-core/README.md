# memdb-poc

Filesystem-backed *temporal graph memory* proof of concept.

**Truth is JSON.** Markdown views come later (P2–P3).

## Quick start

```bash
deno task mem init
```

Use `MEMDB_ROOT` to change where the db lives (defaults to `./memdb`).

```bash
MEMDB_ROOT=./demo deno task mem init
```

### Create a coding assistant entity

```bash
deno task mem add-entity --pack coding_assistant --type Repo --key repo://acme/app --tag tenant=acme --tag repoId=acme/app
```

### Create an event

```bash
deno task mem add-event --pack coding_assistant --kind patch_applied --agent agent_coding_01 --ref entity:ent_...
```

### Add a temporal edge

```bash
deno task mem add-edge --pack coding_assistant --p contains --s ent_repo_... --o ent_file_... --evt evt_...
```

### Retract (close validity window) for an edge key (p,s,o)

```bash
deno task mem retract-edge --pack coding_assistant --p contains --s ent_repo_... --o ent_file_... --evt evt_... --validTo 2025-12-28T18:00:00Z
```

## P0–P1 scope

- repo scaffold
- pack vocabularies
- JSON schemas (contracts)
- CLI: init, add-entity, add-event, add-edge, retract-edge
- `edge_current` pointers for “current” facts without mutating history


## P2–P3 added

- CLI read queries: `neighbors`, `timeline`, `path`, `explain`
- Indexer: `index` generates Markdown views and tag indexes


### Generate Markdown views and indexes

```bash
deno task mem index
```


## P4–P5 added

- governance: default retention + sensitive inference + embedding gating
- vector mock: `embed`, `search`
- consolidation: `consolidate` generates summary Artifact + derived_from edge

### Embed and search

```bash
deno task mem embed --pack coding_assistant --profile decision_summary --target entity:ent_...
deno task mem search --profile decision_summary --query "auth token" --topK 5
```

### Consolidate

```bash
deno task mem consolidate --pack coding_assistant --entity ent_... --profile decision_summary
```


## P6 added

- incremental indexes: pointers, current adjacency, timeline
- faster reads (`neighbors`, `path`, `timeline`) without scanning
- `mem index` can rebuild indexes deterministically


## P7 added

- materialized current views in `views/current/<entityId>.json`
- reads prefer views, fall back to `kv/adj_current`
- incremental updates to views on edge writes/retractions


## P8 added

- historical as-of planning via `kv/adj_all/<entityId>.idx`
- correct as-of truth: latest edge version per `edgeKey` as of t + validity filtering
- optional `mem checkpoint` writes `views/asof/<packOrAll>/<entityId>/<YYYY-MM-DD>.json`
- `neighbors`/`path` use current views unless `--asOf` is explicitly provided


## P9 added

- per-entity delta logs: `kv/deltas/<entityId>/<YYYY-MM-DD>.ndjson`
- as-of planner uses nearest checkpoint + replay deltas (fast)
- checkpoint format upgraded to store `{edgeKey, edgeId}` entries (backward compatible)
- `mem compact` to checkpoint + optionally prune old deltas


## P10 added

- timestamp checkpoints: `views/asof/<packOrAll>/<entityId>/checkpoints/<YYYY-MM-DDTHHMMSSZ>.json`
- `mem rollup` to create rolling checkpoints every N hours
- delta segmentation: `kv/deltas/<entityId>/segments/<start>_<end>.ndjson`
- as-of planner picks nearest checkpoint timestamp <= t and replays segments + remaining day logs


## P11 added

- per-entity manifest: `kv/manifests/<entityId>.json`
- as-of planner uses manifest (no directory scans at query time)
- writes update manifests incrementally; `mem index` rebuilds manifests deterministically


## P12 added

- maintenance policy in `kv/policy.json`
- `mem health` to estimate replay cost
- `mem maintain` to auto checkpoint + segment to keep replay bounded


## P13 added

- `mem maintain-all` for cron-friendly maintenance across all entities
- per-pack policy overrides in `kv/policy.json`
- health metrics persisted into `kv/manifests/<entityId>.json` (`healthByPack`)


## P14 added

- `mem maintain-all --allPacks true` to maintain all packs per entity
- `mem report` to generate drift dashboard (markdown/json) with replayHours percentiles


---

## Monorepo note

This package lives under `packages/memdb-core`. From the repo root, you can run:

```bash
deno task mem <command>
```
