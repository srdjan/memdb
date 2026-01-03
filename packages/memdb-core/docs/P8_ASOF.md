# P8 — As-of snapshots + historical planner

P0–P7 optimized **current** reads. P8 adds reliable **as-of** reads (temporal queries) without scanning all edges.

## Problem

Current views (`views/current/*.json`) only contain *today's* adjacency. If you ask for `--asOf` in the past, those views will miss historic edges.

Also, edges are versioned via `supersedes`, so as-of truth must select the **latest edge version per `edgeKey` as of time `t`**.

## Solution (P8)

### Historical adjacency index

`kv/adj_all/<entityId>.idx` lists **all edge ids ever adjacent** to the entity (all versions).

On every `add-edge` / `retract-edge`, we append the new edge id to both endpoints' `adj_all`.

`mem index` can rebuild `adj_all` deterministically from `edges/**`.

### As-of edge selection

To compute neighbors as-of time `t`:

1. Load candidate edge ids from `adj_all/<entityId>.idx`
2. Load edges by id via pointers
3. Group by `edgeKey`, keep the version with the greatest `recordedAt` **<= t**
4. Filter by validity window:
   - `validFrom <= t < validTo||∞`
5. Optional `--pack` filter

This yields the correct set even across retractions (because the superseding edge version wins).

### Materialized as-of snapshots (checkpoints)

Optional `mem checkpoint` produces snapshot files so repeated queries are O(1) reads:

`views/asof/<packOrAll>/<entityId>/<YYYY-MM-DD>.json`

These can be treated as **checkpoints** for that date. (Deltas/rolling compaction are the next logical step after this P8 baseline.)

## CLI changes

- `neighbors` and `path` now behave as:
  - no `--asOf`: use current views (`views/current`) for speed
  - with `--asOf`: use historical planner (`adj_all`) and optionally a matching checkpoint

## Next step (P9 idea)

- Store per-entity delta logs (`views/asof_deltas/...`) and support “nearest checkpoint + replay deltas” for arbitrary timestamps efficiently.
