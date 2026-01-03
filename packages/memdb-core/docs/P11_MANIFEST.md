# P11 — Per-entity manifests (O(1) planning) + index rebuild

P10 reduced replay cost, but still relied on directory scans to discover:
- available timestamp checkpoints
- available delta segments

P11 adds a **per-entity manifest** so the planner can pick:
- nearest checkpoint <= t
- which segments overlap the day range
without scanning the filesystem at query time.

## Manifest file

`kv/manifests/<entityId>.json`

```json
{
  "entityId": "ent_...",
  "updatedAt": "2025-12-28T12:00:00Z",
  "checkpointsByPack": {
    "all": ["2025-12-28T12:00:00Z", "2025-12-28T18:00:00Z"],
    "coding_assistant": ["2025-12-28T12:00:00Z"]
  },
  "segments": [
    { "startDay": "2025-12-01", "endDay": "2025-12-14" },
    { "startDay": "2025-12-15", "endDay": "2025-12-20" }
  ]
}
```

- `checkpointsByPack[packKey]` is a sorted list of checkpoint timestamps (ISO).
- `segments` are non-overlapping, sorted by `startDay`.

## Incremental updates

- `mem checkpoint`, `mem rollup`, `mem compact` append checkpoint timestamps to the manifest.
- `mem segment` appends segment ranges to the manifest.
- `mem index` rebuilds manifests for all entities (deterministic).

## Planner behavior (as-of)

For `--asOf t`:

1. Read manifest for the entity
2. Pick nearest checkpoint timestamp <= t (packKey)
3. Use manifest.segments to decide which segment files to read
4. Read remaining daily logs by day (no directory scans)

Fallback: if manifest is missing, planner behaves like P10 (scan directories) or cold-start fallback.

