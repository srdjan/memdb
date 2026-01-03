# memdb mini-book (User Guide)

## 1. What we built

We built a filesystem-backed "agent memory substrate" that combines:

- Temporal graph (entities + edges with validFrom/validTo)
- Event timeline (events that justify edges)
- KV metadata (pointers, adjacency lists, manifests)
- Time-travel queries (as-of reconstruction via deltas + checkpoints + segments)
- Maintenance (health, rollups/checkpoints, segmentation)
- Pack concept: pluggable schemas and policies per agent type

This repository is a monorepo with:
- `memdb-core` - engine (filesystem layout + indexes + as-of + maintenance)
- `memdb-api` - REST API on top of core
- `memdb-cli` - CLI client talking to REST
- `memdb-web` - placeholder UI, also a REST consumer

## 2. The mental model

Think of memory as a *temporal knowledge graph* where every claim is a time-bounded edge and is linked to the event that introduced it.

Analogy (feature development): treat edges like "facts" in your codebase, events like "commits / reviews / chats" that justify those facts, and the as-of view like `git checkout <timestamp>` for your memory graph.

## 3. Packs: making memory pluggable per agent type

A **pack** is a schema + policy bundle for one agent type.

Examples:
- `coding_assistant` pack: entities like file/symbol/repo, predicates like depends_on/references
- `identity_verifier` pack: entities like subject/evidence/credential, predicates like asserts/verified_by

Packs can also define defaults like retention and "sensitive tag keys" (PII, biometrics, secrets).

## 4. Filesystem layout (database as folders + files)

At `MEMDB_ROOT` (default `./memdb`):

- `entities/<type>/<id>/props.json`
- `edges/<predicate>/<id>.json`
- `events/YYYY/MM/DD/<id>.json`
- `kv/pointers.json` (id -> file path)
- `kv/adj_current/<entityId>.txt` (current adjacency)
- `kv/adj_all/<entityId>.txt` (append-only adjacency history)
- `deltas/<entityId>/<pack>/...` (delta logs for replay)
- `kv/manifests/<entityId>.json` (checkpoint/segment metadata)
- `segments/...` (rollup segments)
- `views/current/...` and `views/asof/<pack>/...` (materialized views)

## 5. Running the system (REST-first)

### 5.1 Start the API

From repo root:

```bash
deno task api
```

Defaults:
- API: http://localhost:8787
- set `MEMDB_ROOT` to change storage location

### 5.2 Use the CLI (REST client)

```bash
deno task mem init
deno task mem index
```

The CLI talks to REST at `MEMDB_API_URL` (default http://localhost:8787).

### 5.3 Run the placeholder web app

```bash
deno task -c apps/memdb-web/deno.jsonc dev
```

Open: http://localhost:8000

## 6. Key workflows

### 6.1 Create a pack

```bash
deno task mem pack create --name my_coding_pack --template coding_assistant
deno task mem packs
deno task mem pack get --name my_coding_pack
```

REST:
- `POST /v1/packs`
- `GET /v1/packs`
- `GET /v1/packs/:name`

### 6.2 Create entities/events/edges

```bash
# entity
deno task mem add-entity --pack my_coding_pack --type file --key README.md --tags lang=ts,area=docs

# event (justification)
deno task mem add-event --pack my_coding_pack --kind observed --refs entity:ent_... --tags source=import

# edge (claim)
deno task mem add-edge --pack my_coding_pack --predicate references --s ent_A --o ent_B --sourceEventId evt_...
```

### 6.3 Query neighbors (time travel)

```bash
deno task mem neighbors --entity ent_A --asOf 2025-12-28T12:00:00Z --pack my_coding_pack
```

REST:
- `GET /v1/neighbors?entityId=&asOf=&pack=`

### 6.4 Path query

```bash
deno task mem path --from ent_A --to ent_Z --asOf 2025-12-28T12:00:00Z --pack my_coding_pack --maxDepth 6
```

REST:
- `GET /v1/path?from=&to=&asOf=&pack=&maxDepth=`

### 6.5 Maintenance and reporting

```bash
deno task mem health --entity ent_A --pack my_coding_pack --asOf 2025-12-28T12:00:00Z
deno task mem maintain --entity ent_A --pack my_coding_pack --asOf 2025-12-28T12:00:00Z

deno task mem maintain-all --allPacks true
deno task mem report --allPacks true --format md
```

REST:
- `GET /v1/health`
- `POST /v1/maintain`
- `POST /v1/maintain-all`
- `POST /v1/report`

## 7. Why we removed /rpc

`/rpc` tunneled CLI argv over HTTP. It was convenient but:
- hard to secure (argv-based authz)
- unstable contract (flags become API changes)
- bad observability (everything is "run argv")

Now:
- CLI and web share typed REST endpoints
- each endpoint can have explicit auth and metrics
- evolution is safer

## 8. Next directions (optional)

- Add authn/authz (API keys, per-pack permissions)
- Add bulk ingest endpoints (batch entities/edges/events)
- Add vector store integration behind an interface (embed locally, store vectors as files)
- Build the agent builder UI (create pack, seed entities, browse graphs, curate edges)

---

## P16 Additions: Content, Search, Resolver, Vectors

### Content: immutable evidence layer

Content is **source evidence**. It is never edited; it is referenced by events and facts.

REST:

- `POST /v1/content`  
  Body supports either:
  - `{ text: "..." }` (stored as bytes, excerpt auto-generated)
  - `{ base64: "..." }` (stored as bytes)
  - or metadata-only content `{ uri, excerpt }`

  Optional: `pack`, `mime`, `source`, `uri`, `excerpt`, `tags`.

- `GET /v1/content?pack=<pack>`
- `GET /v1/content/:id`

CLI:

```bash
deno task mem add-content --pack my_coding_pack --mime text/plain --source slack --text "decision trace..."
```

### Search: cheap but useful

Single endpoint, multiple kinds:

- `GET /v1/search?kind=entities|facts|content&q=...&pack=...`

CLI:

```bash
deno task mem search --kind facts --q timeout --pack my_coding_pack
```

This is intentionally simple (substring matching). It’s a stable spine you can later replace with:
- inverted indexes,
- hybrid BM25 + vectors,
- pack-specific analyzers.

### Resolver (skeleton): producing resolution artifacts

Resolution is where “world models” emerge: deciding what is canonical, superseded, corroborated, synthesized.

For now we ship a deterministic resolver that **proposes** canonical edges per edgeKey at an as-of time.

- `POST /v1/resolve`
  Body: `{ entityId, asOf, pack, persist }`

If `persist=true`, the run is stored under:

- `kv/resolutions/<entityId>/<pack|all>/<timestamp>.json`

CLI:

```bash
deno task mem resolve --entity ent_... --pack my_coding_pack --persist true
```

### Vectors: sidecar index (bring-your-own embeddings)

We do not generate embeddings yet. Callers supply embeddings.

- `POST /v1/vectors/upsert`  
  `{ id, kind, pack?, embedding:number[], tags? }`

- `POST /v1/vectors/search`  
  `{ query:number[], topK, filter?: { pack?, kind? } }`

CLI:

```bash
deno task mem vectors upsert --id ent_123 --kind entity --pack my_coding_pack --embedding "0.1,0.2,0.3"
deno task mem vectors search --embedding "0.1,0.2,0.3" --topK 5 --filterPack my_coding_pack
```

---

## Where this gets you (tie-back to “two clocks”)

- **Event clock**: events + resolution artifacts + (future) decision traces as events
- **State clock**: current views + canonical facts (future) computed from resolution
- **Content**: the evidence trail that makes “why” durable

In other words: the memdb substrate can host “context graphs” with **auditable decision traces** without needing continual learning.


## 9. Canonical state vs. raw observations (P16: apply resolution)

### Why you want this (agent interoperability)

Agents are great at *emitting observations* but terrible at being consistent about what is “true right now”:
they change wording, forget to retract old claims, and you’ll end up with contradictory active edges.

So memdb now supports a **two-lane model**:

- **Observed lane**: everything agents say (edges tagged `status=observed` or untagged legacy edges)
- **Canonical lane**: synthesized, conflict-resolved “best current truth” edges tagged `status=canonical`

The key move: **resolution produces new canonical edges** (it does not mutate old ones).

### New endpoint: apply resolution

`POST /v1/resolve/apply`

- Runs the resolver for an entity neighborhood (`asOf`, optional `pack` filter)
- Emits new **canonical** edges (same predicate, same S/O, `tags.status="canonical"`)
- Emits optional **synthesized** timeline edges (predicate prefixed with `synth/…`, `tags.status="synthesized"`)
- Records a `sys/fact_resolution_applied` event (in pack `core`) as the source event for all derived facts

Example:

```bash
curl -sS -X POST http://localhost:8787/v1/resolve/apply   -H "content-type: application/json"   -d '{
    "entityId": "ent_...",
    "asOf": "2025-12-29T00:00:00.000Z",
    "pack": "coding_assistant",
    "emitSynthesized": true,
    "agentId": "codex"
  }'
```

### New endpoint: state-clock neighbors

`GET /v1/state/neighbors?entityId=...&asOf=...&pack=...`

This is the “read only canonical facts” view you asked for:

- Returns **only** edges where `tags.status === "canonical"` and active at `asOf`.
- This endpoint is what downstream agents should rely on to avoid hallucinating from conflicting raw inputs.

## 10. MCP adapter (P17)

### Why MCP is the highest ROI

Instead of building bespoke plugins per agent runtime, you expose **one stable tool surface**:
a set of strict JSON tools over stdio. Claude Code, Codex, and others can all speak MCP.

This repo includes:

- `packages/memdb-mcp` — MCP stdio server that proxies tools to `memdb-api`.

Run:

```bash
MEMDB_API_URL=http://localhost:8787 MEMDB_API_KEY=memdb_dev_key deno run -A packages/memdb-mcp/src/main.ts
```

Tools exposed:

- `memdb.search`
- `memdb.state.neighbors`
- `memdb.resolve.apply`
- `memdb.trace.decision`
- `memdb.bootstrap`

See `docs/mcp.md` for configuration examples.

## 11. Auth + scopes (P18)

The API supports optional API keys with:

- **Scopes**: `read`, `write`, `ops`
- **Pack boundaries**: keys can be limited to specific packs
- **Rate limits**: token-bucket per key (rps/burst)

### Configure keys

Option A (recommended): file-based keys:

`kv/auth/keys.json`

```json
{
  "keys": [
    {
      "id": "dev",
      "key": "memdb_dev_key",
      "scopes": ["read", "write", "ops"],
      "packs": ["*"],
      "rate": { "rps": 10, "burst": 20 }
    }
  ]
}
```

Option B: `MEMDB_API_KEYS_JSON` env var containing the same JSON.

If no keys are configured, auth defaults to **open** (dev mode). Set `MEMDB_REQUIRE_AUTH=true` to enforce auth even in dev.

## 12. Agent experience polish (P19)

### Decision trace helper

Agents usually want “one call” that stores the raw text, links it to a justification event,
and emits observed facts from that decision.

`POST /v1/trace/decision` does exactly that (content + event + edges).

Example:

```bash
curl -sS -X POST http://localhost:8787/v1/trace/decision   -H "content-type: application/json"   -d '{
    "pack": "coding_assistant",
    "agentId": "claude-code",
    "kind": "decision_recorded",
    "content": { "mime": "text/markdown", "text": "We should increase timeout to 30s for cold starts." },
    "claims": [
      {
        "predicate": "config",
        "s": { "type": "File", "key": "src/server.ts" },
        "o": { "type": "ConfigKey", "key": "timeoutMs=30000" },
        "confidence": 0.7
      }
    ]
  }'
```

### Bootstrap helper

`POST /v1/bootstrap` seeds a minimal entity spine for a template, so an agent can start writing facts immediately.
