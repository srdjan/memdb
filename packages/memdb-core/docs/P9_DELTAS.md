# P9 — Delta logs + nearest-checkpoint replay + compaction

P8 made *correct* as-of queries possible using `adj_all` + edgeKey version selection.
P9 makes them **fast** by introducing per-entity **delta logs** and a replay algorithm.

## Delta logs

Per entity, we record edge-version transitions as NDJSON:

`kv/deltas/<entityId>/<YYYY-MM-DD>.ndjson`

Each line:

```json
{
  "ts": "2025-12-28T12:34:56Z",
  "entityId": "ent_...",
  "pack": "coding_assistant",
  "edgeKey": "sha256_...",
  "addEdgeId": "edge_...",
  "removeEdgeId": "edge_..." // or null
}
```

We write a delta for **both endpoints** (s and o) on `add-edge` and `retract-edge`.
This is append-only.

## Checkpoints

P8 checkpoints were daily and contained selected edge ids.
P9 extends checkpoints to store entries that preserve the edgeKey mapping:

`views/asof/<packOrAll>/<entityId>/<YYYY-MM-DD>.json`

```json
{
  "entityId": "ent_...",
  "asOfDate": "2025-12-28",
  "asOf": "2025-12-28T12:00:00Z",
  "pack": "coding_assistant",
  "entries": [
    { "edgeKey": "sha256_...", "edgeId": "edge_..." }
  ]
}
```

For backward compatibility, old snapshots with `edges: string[]` are still readable
(the planner will load edges to reconstruct edgeKey mappings).

## As-of planning algorithm

For an as-of query at time `t`:

1. Find nearest checkpoint date `d <= day(t)` (if any)
2. Load checkpoint into `state: Map<edgeKey, edgeId>`
3. Replay deltas from day(d) to day(t), applying records where `ts <= t`:
   - if removeEdgeId present: delete that edgeKey (or overwrite)
   - set state[edgeKey] = addEdgeId
4. Load edges for the resulting edgeIds and filter by validity window.

Fallback: if no checkpoint exists, use the P8 method (`adj_all` scan).

## Compaction

```
mem compact --asOf ISO --entity <entId> [--pack <pack>] [--deleteBefore true]
```

- Creates a checkpoint at the given as-of timestamp
- Optionally deletes delta logs strictly earlier than the checkpoint date

This is a baseline compaction. More advanced compaction (rolling checkpoints + delta pruning) is a natural next step.

