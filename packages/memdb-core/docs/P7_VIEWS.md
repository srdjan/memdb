# P7 — Materialized views + planner

P7 introduces **materialized "current" views** to make reads fast and stable without scanning or reconstructing adjacency every time.

## Views

### Current entity view (authoritative for reads)

`views/current/<entityId>.json`

```json
{
  "entityId": "ent_...",
  "asOf": "2025-12-28T18:00:00Z",
  "edges": ["edge_...", "edge_..."]
}
```

- `edges` contains **edge ids** for the entity's current adjacency.
- On `add-edge` / `retract-edge`, we update both endpoints' current views incrementally.
- Reads (`neighbors`, `path`) prefer `views/current/*.json` and fall back to `kv/adj_current/*.idx`.

### Generated Markdown

`views/current/<entityId>.md` is still generated (by `mem index`) and may be rebuilt anytime.

## Rebuild

`mem index` rebuilds:

- pointers
- adj_current / timeline
- views/current/*.json
- markdown views



## P8

For historical snapshots, see `docs/P8_ASOF.md`.
