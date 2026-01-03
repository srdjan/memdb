# Vectors (P5 mock)

We mock a vector store using token overlap.

## Store an embedding item

```
mem embed --pack <pack> --profile <profile> --target entity:<id>|event:<id>|edge:<id> [--text "..."]
```

If `--text` is omitted, the system derives text from the target.

## Search

```
mem search --profile <profile> --query "..." [--pack <pack>] [--topK N]
```

Scores are `overlap(tokens(item), tokens(query))`.

## Consolidation

```
mem consolidate --pack <pack> --entity <entId> --profile <profile>
```

Creates:
- an `Artifact` entity with a summary key
- an event recording the consolidation
- a `derived_from` edge from artifact → original entity
- a blob containing the summary text
- an embedding item for the artifact (unless blocked by policy)

