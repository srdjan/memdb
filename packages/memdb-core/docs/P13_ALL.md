# P13 — Maintain-all + per-pack policy overrides + health metrics in manifest

P12 introduced per-entity `health` and `maintain` with a global policy.
P13 adds:

1. `mem maintain-all` — cron-friendly maintenance across all known entities
2. Per-pack policy overrides in `kv/policy.json` (backward compatible)
3. Persisting health metrics into `kv/manifests/<entityId>.json` for monitoring

## Policy format

Backward compatible with the P12 flat form.

### New preferred form

`kv/policy.json`

```json
{
  "default": {
    "rollupEveryHours": 6,
    "maxReplayHours": 48,
    "keepDailyDays": 7,
    "segmentMaxDays": 14
  },
  "packs": {
    "coding_assistant": { "maxReplayHours": 24 },
    "identity_verifier": { "keepDailyDays": 14 }
  }
}
```

Resolution:
- start from `default`
- overlay `packs[packKey]` if present

## Commands

### maintain-all

```
mem maintain-all [--pack <pack>] [--asOf ISO]
```

- scans `kv/manifests/*.json` to discover entity ids (no other scans)
- runs `maintain(entityId, pack, asOf)` for each
- writes health summary to stdout

### health persistence

Each `health` / `maintain` updates the manifest:

`kv/manifests/<entityId>.json` gets:

```json
{
  "healthByPack": {
    "coding_assistant": {
      "computedAt": "2025-12-28T12:00:00Z",
      "asOf": "2025-12-28T12:00:00Z",
      "nearestCheckpointAt": "...",
      "replayHours": 3.4,
      "needsCheckpoint": false,
      "needsSegmentation": true,
      "segmentBeforeDay": "2025-12-21"
    }
  }
}
```

This allows monitoring drift without running `health` constantly.

