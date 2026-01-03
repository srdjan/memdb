# Agent builder plan (placeholder)

This app is meant to become the user-facing surface for creating and managing agent memory.

## Suggested screens

1. Packs
   - list packs
   - create pack from template (coding_assistant / identity_verifier)
2. Entities
   - search by key, tags
   - view as-of snapshots
3. Graph explorer
   - neighbors/path queries, pack filters, asOf timeline slider
4. Curation
   - pin / retract edges (human review)
   - merge duplicates
5. Export/import
   - snapshot export (jsonl)
   - deterministic re-index

## Next dev steps

- Add simple search: key contains, tag filters
- Add `neighbors` view with `asOf` input (calls core CLI or core API)
- Add “Create agent pack” wizard writing pack templates

