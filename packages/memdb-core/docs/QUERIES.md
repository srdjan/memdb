# Queries (P2–P3)

All read queries operate on **JSON truth**. Markdown is generated for browsing.

## neighbors

```
mem neighbors <entityId> [--asOf ISO] [--pack <pack>]
```

Returns the set of edges (current versions) adjacent to the entity.
If `--asOf` is provided, edges are filtered by validity window:

- `validFrom <= t < (validTo ?? +∞)`

## explain

```
mem explain <edgeId>
```

Prints edge details and the source event (if found), plus its refs.

## timeline

```
mem timeline <entityId> [--pack <pack>]
```

Lists events that reference the entity (via `refs`), sorted by `recordedAt`.

## path

```
mem path <fromEntityId> <toEntityId> [--asOf ISO] [--maxDepth N] [--pack <pack>]
```

BFS over neighbor expansions. Uses **current edge versions** and applies `--asOf` filter on validity.

## index (P3)

```
mem index
```

Generates Markdown views and lightweight indexes:

- `entities/**/entity.md`
- `events/**/<id>.md`
- `edges/**/<id>.md`
- `kv/tags/<k>/<v>.idx` (lists view paths)
- `views/current/<entityId>.json` and `.md` (current neighborhood snapshot)


## embed/search/consolidate (P4–P5)

See `docs/VECTORS.md`.

## P6 indexes

See `docs/P6_INDEXES.md`.

## P7 views

Reads prefer `views/current/*.json` (see `docs/P7_VIEWS.md`).

## checkpoint (P8)

```
mem checkpoint --asOf ISO --entity <entId> [--entity <entId> ...] [--pack <pack>]
```

Writes as-of snapshot files under `views/asof/`.

## compact (P9)

```
mem compact --asOf ISO --entity <entId> [--pack <pack>] [--deleteBefore true]
```

Creates a checkpoint and optionally prunes old delta logs.

## P9 deltas

See `docs/P9_DELTAS.md`.

## rollup (P10)

```
mem rollup --from ISO --to ISO --everyHours N --entity <entId> [--pack <pack>]
```

## segment (P10)

```
mem segment --entity <entId> --beforeDay YYYY-MM-DD [--maxDays N]
```

See `docs/P10_ROLLING.md`.

## P11 manifests

`mem index` rebuilds `kv/manifests/*.json`. See `docs/P11_MANIFEST.md`.

## health / maintain (P12)

```
mem health --entity <entId> [--pack <pack>] [--asOf ISO]
mem maintain --entity <entId> [--pack <pack>] [--asOf ISO]
```

See `docs/P12_MAINTAIN.md`.

## maintain-all (P13)

```
mem maintain-all [--pack <pack>] [--asOf ISO]
```

See `docs/P13_ALL.md`.

## report (P14)

```
mem report [--asOf ISO] [--pack <pack>] [--allPacks true] [--format json|md]
```

See `docs/P14_DASHBOARD.md`.
