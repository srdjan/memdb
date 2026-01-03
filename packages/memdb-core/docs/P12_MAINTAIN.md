# P12 — Maintenance policy + bounded replay SLA

P11 made planning O(1) by introducing per-entity manifests.
P12 adds a simple **maintenance loop** to keep replay costs bounded over time.

## Goals

- Ensure `neighbors/path --asOf` queries don't require replaying "too much" history
- Keep daily delta files from growing without bound
- Provide predictable operational knobs

## Policy file

`kv/policy.json`

```json
{
  "rollupEveryHours": 6,
  "maxReplayHours": 48,
  "keepDailyDays": 7,
  "segmentMaxDays": 14
}
```

Meaning:
- **rollupEveryHours**: preferred cadence for timestamp checkpoints in steady state
- **maxReplayHours**: if the nearest checkpoint is older than this, create a new checkpoint at `asOf`
- **keepDailyDays**: keep last N daily delta files; segment older ones
- **segmentMaxDays**: segment size when merging daily logs

## Commands

### `mem health`

```
mem health --entity <entId> [--pack <pack>] [--asOf ISO]
```

Reports:
- nearest checkpoint time
- estimated replay window (hours)
- daily delta days present and whether they'd be segmented by policy

### `mem maintain`

```
mem maintain --entity <entId> [--pack <pack>] [--asOf ISO]
```

Actions (idempotent):
1. If replay window > maxReplayHours → create checkpoint at `asOf`
2. Segment daily deltas older than `keepDailyDays` days into `segments/` using `segmentMaxDays`
3. Updates manifest as a side effect (checkpoint/segment already do)

Default `asOf` is now (UTC).

## Notes

This is deliberately a *baseline* maintainer, not a full daemon.
The next step (optional) would be a background scheduler or cron-friendly `mem maintain --all`.

