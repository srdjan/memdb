## memdb Design Document

### One-liner

**memdb** is a **world-model database** for long-term memory: it stores immutable evidence (event clock), derives canonical truth (state clock), and exposes a stable tool surface (REST + MCP) plus a filesystem-shaped projection for compatibility.

---

## 1) Goals

1. **Deterministic truth**: “what’s true now” comes only from **canonical facts**.
2. **Auditability**: every canonical claim traces to evidence (content + events + observed facts).
3. **Agent-agnostic**: Claude Code, Codex, Cursor, custom runtimes use the same **MCP tools** and **REST APIs**.
4. **Cheap persistence**: durable memory lives on disk/DB; context is assembled via search.
5. **Portability & debuggability**: snapshots + virtual filesystem view.
6. **Simple ops**: no product OLTP database; only **memdb-state (Turso/libSQL)** plus filesystem packs.

---

## 2) Core Concepts

### Context vs Memory

* **Context** (per request): system prompt + project bootstrap files + conversation window + tool results.
* **Memory** (persistent): memdb packs + indexes; retrieved on demand (search over injection).

### Two clocks

* **Event clock (evidence)**: immutable record of what happened and why.
* **State clock (truth)**: canonical view derived from resolution (“apply”).

**Invariant:** State-clock endpoints return **canonical facts only**.

---

## 3) Storage Architecture

### 3.1 Filesystem packs (source of truth for evidence)

Pack directory stores:

* `content/` immutable text/markdown/uri/blobs
* `events/` provenance records (agentId, correlationId, timestamps)
* observed facts (edges) emitted at write-time
* optional daily memory files (`memory/YYYY-MM-DD.md`, `MEMORY.md`)
* JSONL transcripts / compaction summaries (if used)

### 3.2 Turso/libSQL: `memdb-state` (operational “state spine”)

Single DB for:

* `facts_canonical` (fast state-clock reads)
* entity index (`entities`)
* queues (`resolution_queue`, optional embedding queue)
* snapshots registry
* metrics counters
* optional API key storage (`auth_keys`)
* optional chunk index (FTS + vectors + embedding cache)

No separate app OLTP DB.

---

## 4) Data Model

### 4.1 Content (evidence)

Immutable records:

* text/markdown/uri/blob
* tags, size metadata, content hash

### 4.2 Events (provenance)

* kind, timestamp
* `agentId`, `threadId`, `correlationId`
* refs to related content ids

### 4.3 Entities

Typed nodes with deterministic `(type, key)` identity:

* examples: Repo, File, Function, Person, Org, WorkItem, Artifact

### 4.4 Facts / Edges (temporal)

Triples `(s, predicate, o)` with:

* `validFrom`, `validTo`
* `status`: `observed | canonical | synthesized | retracted | superseded`
* `confidence`, `salience`
* `sourceEventId`, content references

### 4.5 Resolution (“apply”)

Transforms observed facts into:

* **canonical facts** (state clock)
* **synthesized facts** (summaries/timelines)
* derivation/supersession links
* interval auto-closing on conflicts (policy-driven)

---

## 5) Memory Layout (transparent + editable)

memdb supports a **two-layer Markdown memory** model inside each pack (optional but recommended):

* `memory/YYYY-MM-DD.md` — append-only daily notes (Layer 1)
* `MEMORY.md` — curated durable knowledge (Layer 2: preferences, key decisions, contacts)

These are plain files in the workspace; memdb indexes them for search.

### Project bootstrap files (always loaded by hosts)

Pack template provides:

* `AGENTS.md` — operating rules, mandatory recall policy, where to write
* `USER.md` — who the user is / stable preferences
* `SOUL.md` — persona / system posture
* `BOOTSTRAP.md` — what to load at session start

---

## 6) Query & Retrieval

### 6.1 State-clock reads (canonical only)

* neighbors, subgraph expansion, time-travel “asOf”, diffs

### 6.2 Hybrid retrieval (search over injection)

Hybrid scoring combines:

* semantic similarity (vectors)
* lexical matching (FTS/BM25)
* symbolic filters (tags/entities/predicates)
* recency weighting

Configurable weights and thresholds per pack.

### 6.3 Virtual filesystem projection (read-only)

memdb exposes a filesystem-shaped projection for compatibility and debugging:

* `facts/` (observed/canonical/synthesized NDJSON)
* `state/` (canonical materializations)
* `entities/`, `events/`, `content/`
  Available via:
* CLI export/watch
* REST `fs.list` / `fs.read`
* MCP tools `memdb.fs.list` / `memdb.fs.read`

### 6.4 Snapshots (portable) + diff + replay

* NDJSON snapshots (single file) + registry
* diff snapshots
* replay canonical state at `asOf`

Available via REST + MCP.

---

## 7) Write Pipelines

### 7.1 Bundled writes (“decision trace”)

One call writes:

* content + event + observed facts (+ optional derived atomic facts)
  Then:
* enqueue or apply resolution

### 7.2 SimpleMem-style ingestion (atomic memory building)

`ingest.atomic` stores:

* raw turns as immutable content (evidence)
* an ingestion event
* optional strict `facts[]` as **atomic observed facts**
* infoScore/noise tags to control fact promotion (never deletes evidence)

### 7.3 Pool coordinator (multi-agent coordination)

Coordination is modeled as facts:

* Entities: WorkItem, AgentInstance, Artifact
* Facts: `work_action`, `work_by`, `work_affects`, `work_blocks`, summaries
  Resolution provides canonical snapshot of open work (blocked/in-progress).

---

## 8) Integration Surface

### REST (primary)

* ingest / trace / pool operations
* resolution (enqueue/apply)
* state-clock endpoints (canonical)
* hybrid search & pattern query
* virtual FS + snapshot APIs

### MCP (agent tool layer)

Stable tools mapping 1:1 to REST:

* `memdb.ingest.atomic`
* `memdb.pool.*`
* `memdb.resolve.*`
* `memdb.state.*`
* `memdb.search.*`
* `memdb.fs.*`
* `memdb.pack.*`

### CLI

Operator/dev UX; uses the same REST endpoints.

### Web app (stateless consumer)

No DB; uses API key and pack selection; preferences may live in localStorage or memdb KV.

---

## 9) Security & Tenancy

* **Tenancy boundary:** `pack`
* **Auth:** API keys + scopes (env or `auth_keys` in memdb-state)
* **Guardrails:** require provenance (`sourceEventId`, content refs) for writes; rate limits for agent-facing operations.
* Optional cross-pack sharing must be explicit.

---

## 10) Minimal `memdb-state` Schema (v1)

Core:

* `entities(pack, entity_id, type, key, …)`
* `facts_canonical(pack, fact_id, s_id, predicate, o_id, valid_from, valid_to, source_event_id, …)`
* `resolution_queue(pack, entity_id, status, priority, …)`
* `snapshots(snapshot_id, pack, kind, as_of, status, path, …)`
* `metrics_counters(pack, name, value, …)`
  Optional:
* `auth_keys`, `fact_derivations`
* chunk index: `chunks`, `chunks_fts`, `chunks_vec`, `embedding_cache`

---

## 11) Operational Workflow

1. **Write evidence** (content/turns) + observed facts (`traceDecision`, `pool.post`, `ingest.atomic`).
2. **Resolve/apply** to emit canonical truth (state clock).
3. **Read truth** from state endpoints (canonical only).
4. **Retrieve context** via hybrid search + virtual FS reads (search over injection).
5. **Snapshot/diff/replay** for portability, audits, and time-travel debugging.

---

## 12) Roadmap (next memory-system upgrades)

1. Memory tools: `memory.search` + `memory.get` (mandatory recall contract)
2. Two-layer Markdown memory templates (`memory/YYYY-MM-DD.md`, `MEMORY.md`) + bootstrap files
3. Turso chunk index: FTS5 + vectors + embedding cache; configurable hybrid weights
4. Session lifecycle hooks: flush before compaction, session-end save
5. Context pruning views for tool outputs (cache-TTL-aware) while preserving evidence on disk
