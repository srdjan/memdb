# SPEC (P0–P1)

## Design rules

1) **Events are append-only** (`events/*.json`).
2) **Edges are append-only** (`edges/*.json`).
3) “Current truth” for a `(predicate,s,o)` triple is pointed to by:
   - `kv/edge_current/<edgeKey>.txt`
4) Retractions (closing validity window) are represented by writing a **new edge record** that **supersedes** the prior edge for that edgeKey.

## Temporal semantics

An edge is active “as-of” time `t` if:

- `validFrom <= t` and (`validTo` is null OR `t < validTo`)

In later phases, reads will select the **latest version per edgeKey** (by pointer or by recordedAt ordering) before applying as-of filtering.

## Edge keys

`edgeKey = sha256("${predicate}:${s}:${o}")` (hex string)

## Directories created by `mem init`

- entities
- events
- edges
- kv/edge_current
- kv/entity_current
- kv/tags
- blobs
- packs


## P3: Generated views

Markdown files (`*.md`) are generated and may be deleted/rebuilt at any time.
JSON files remain the source of truth.

## P4: Governance

- default retention tags on writes
- sensitive tag inference for identity pack
- forbiddenEmbeddingTags enforced at embed time

## P5: Vector mock

- embeddings stored as tokens + payload in `vectors/items`
- search uses token-overlap scoring
- consolidation creates summary artifacts and embeddings
