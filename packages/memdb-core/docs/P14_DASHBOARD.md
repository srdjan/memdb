# P14 — Maintain-all multi-pack + drift dashboard report

P13 introduced `maintain-all` and persisted health metrics in manifests.
P14 adds:

1) `mem maintain-all --allPacks true` — maintain all packs per entity
2) `mem report` — generate JSON/Markdown dashboard with replay drift percentiles

## maintain-all allPacks mode

```
mem maintain-all --allPacks true [--asOf ISO]
```

For each entity in `kv/manifests/`:
- read its manifest
- determine pack keys = keys(manifest.checkpointsByPack) (or `["all"]` if empty)
- run `maintain(entityId, packKey, asOf)` for each pack key

Note: pack key `"all"` is treated as `pack=null` (global view).

You can still scope to a single pack:

```
mem maintain-all --pack coding_assistant
```

## report

```
mem report [--asOf ISO] [--pack <pack>] [--allPacks true] [--format json|md]
```

- scans entities from `kv/manifests/*.json`
- evaluates health for the requested pack(s) at `asOf` (computes live if needed)
- outputs:
  - replayHours percentiles (p50/p90/p99), max, count
  - count needing checkpoint / segmentation
  - top-N worst entities by replayHours

This is intended for cron + simple monitoring.

