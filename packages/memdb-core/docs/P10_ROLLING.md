# P10 — Rolling checkpoints + delta segmentation + timestamp planner

P9 made as-of queries fast with **nearest daily checkpoint** + delta replay.
P10 upgrades this to:

1) **Timestamp checkpoints** (multiple per day, nearest <= t)
2) **Rolling checkpoint creation** (every N hours)
3) **Delta segmentation** (merge many day logs into bounded segments)
4) Planner prefers: nearest checkpoint timestamp -> replay segments + remaining deltas

## Timestamp checkpoints

Stored under:

`views/asof/<packOrAll>/<entityId>/checkpoints/<ISO_SAFE>.json`

Where `<ISO_SAFE>` is `YYYY-MM-DDTHHMMSSZ` (UTC).

Snapshot shape (same as P9, but includes `checkpointAt`):

```json
{
  "entityId": "ent_...",
  "pack": "coding_assistant",
  "checkpointAt": "2025-12-28T12:00:00Z",
  "entries": [{ "edgeKey": "sha256_...", "edgeId": "edge_..." }]
}
```

The old P8/P9 daily format (`views/asof/<pack>/<entityId>/<YYYY-MM-DD>.json`) is still supported as fallback.

## Rolling checkpoint creation

```
mem rollup --from ISO --to ISO --everyHours N --entity <entId> [--pack <pack>]
```

Creates checkpoints at a fixed cadence and writes them to `checkpoints/`.

## Delta segmentation

Daily deltas are great for writes, but replay can become expensive for long spans.
We add segment files:

`kv/deltas/<entityId>/segments/<startDay>_<endDay>.ndjson`

Segments are built by `mem segment`:

```
mem segment --entity <entId> --beforeDay YYYY-MM-DD [--maxDays 14]
```

This merges daily `*.ndjson` files strictly before `beforeDay` into segments of up to `maxDays`, and deletes the merged daily files.

## Planner behavior

For as-of query time `t`:

1) Find nearest checkpoint timestamp <= t (prefer timestamp checkpoints; fallback to daily)
2) Load state map (edgeKey -> edgeId)
3) Replay deltas from checkpoint time to t using:
   - segment files that overlap the day range
   - remaining daily ndjson files for uncovered days
4) Filter loaded edges by validity window at `t`

