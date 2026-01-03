# Pool Coordinator (Shared Work Graph)

The pool coordinator is a **coordination-friendly schema** + a few **high-level endpoints/tools** so that multiple agents (Claude Code, Codex, custom tools) can collaborate through memdb.

It is inspired by “pool coordinator” patterns (agent-run pooling, claiming/leasing work) but implemented as **temporal facts**.

## Core idea

- **WorkItem** is an entity (durable identity, stable id)
- **WorkStatus** is an entity (`in_progress`, `blocked`, `done`)
- **work_action** is the fact that drives the **state clock**
- **work_claimed_by** is an optional lease/claim fact (used for coordination)

Critically: pool endpoints can **auto-apply resolution** so your *state-clock* views read only canonical facts.

## Pack

Use the built-in pack:

- `packs/coordination.pack.json`

Or copy these entity types/predicates into your own pack.

## REST endpoints

All are `POST`:

- `/v1/pool/post`
- `/v1/pool/claim`
- `/v1/pool/release`
- `/v1/pool/snapshot`

### pool/post

Creates (deterministically) or updates:

- `WorkItem` (topic-based identity)
- `AgentInstance` (your agent run)
- `WorkStatus` (derived from action)
- `Artifact` entities (optional)

Writes evidence as `Content` (optional summary), records a `pool/post` event, asserts facts:

- `work_action` (WorkItem → WorkStatus)
- `work_by` (WorkItem → AgentInstance)
- `work_affects` (WorkItem → Artifact)

If `applyResolution=true` (default), memdb runs `resolve.apply` for the work item so the **canonical** state is immediately available.

Example:

```bash
mem pool post \
  --pack coordination \
  --instanceId run_2026_01_03_123 \
  --topic "Fix flaky CI on memdb-mcp" \
  --action start \
  --summary "Repro in Github Actions; suspect postJson bug in MCP adapter." \
  --affects repo:memdb,package:memdb-mcp
```

### pool/claim

Claims (leases) a WorkItem for an agent instance. This is a fact:

- `work_claimed_by` (WorkItem → AgentInstance)

The lease expiry is stored as an ISO timestamp in `tags.leaseUntil`.

Example:

```bash
mem pool claim \
  --pack coordination \
  --instanceId run_2026_01_03_123 \
  --workItemId ent_... \
  --ttlSeconds 600
```

### pool/release

Retracts the active claim.

```bash
mem pool release --pack coordination --instanceId run_... --workItemId ent_...
```

### pool/snapshot

Returns a **state-clock** snapshot (canonical facts) of work items, with recent summaries from the timeline.

```bash
mem pool snapshot --pack coordination --status open --limit 50
```

## MCP tools

If you run `packages/memdb-mcp` as an MCP stdio server, the pool surface appears as tools:

- `memdb.pool.post`
- `memdb.pool.claim`
- `memdb.pool.release`
- `memdb.pool.snapshot`

These are strict JSON input/output tools (see `packages/memdb-mcp/src/tools.ts`).

## Suggested workflow (multi-agent)

1. **post**: each agent writes its progress (`pool/post`)
2. **claim**: a coordinator agent leases work items to avoid duplication
3. **apply resolution**: keep `applyResolution=true` so canonical state stays current
4. **snapshot**: frontends / dashboards read the state clock
