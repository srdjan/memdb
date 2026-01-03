# Governance (P4)

## Tags and retention

All entities, events, and edges carry `tags`.

On write, if `retention_class` is missing, it is set from the pack policy:

- coding_assistant: `ops_180d`
- identity_verifier: `audit_7y`

## Sensitive inference (defaults)

For `identity_verifier`, some entity types default to `pii=true` if not provided:

- Subject, Document, BiometricCheck, Evidence

This is conservative and you can override explicitly by providing `--tag pii=false`.

For `coding_assistant`, some entity types default to `secret=false` unless you set it.

## Embedding policy

Each pack can define `policy.forbiddenEmbeddingTags` (e.g. `pii=true` or `secret=true`).

`mem embed` blocks creation when a forbidden tag matches the effective tag set.

For events, effective tags include propagation from referenced entities (if any referenced entity has `pii=true`, then the event is treated as `pii=true` for embedding purposes).

