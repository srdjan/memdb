# P6 — Index acceleration + query planner

P6 adds incremental, filesystem-based indexes so common reads do **not** require scanning `edges/` or `events/`.

## New indexes

### Pointers

`kv/pointers.json` now includes paths for:

- `entity[entId] -> entities/<Type>/<entId>/props.json`
- `edge[edgeId]   -> edges/<predicate>/<edgeId>.json`
- `event[evtId]   -> events/YYYY/MM/DD/<evtId>.json`

These are updated incrementally on write, and may be rebuilt by `mem index`.

### Current adjacency

`kv/adj_current/<entityId>.idx` (one edge id per line)

Updated on `add-edge` and `retract-edge`:
- removes superseded edge id (if any)
- adds new edge id
- updates both endpoints (s and o)

Used by:
- `neighbors`
- `path`

### Timeline

`kv/timeline/<entityId>.idx` (one event id per line)

Updated on `add-event` by adding the new event id to each referenced entity's timeline.

Used by:
- `timeline`

## Planner behavior

Reads use indexes if available, and fall back to directory scans when needed.

