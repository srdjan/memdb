export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export type ToolDef = Readonly<{
  name: string;
  description: string;
  inputSchema: Json; // JSON Schema (draft-07-ish)
}>;

export const tools: readonly ToolDef[] = [
  {
  name: "memdb.search",
  description:
    "Hybrid search (vector + text + recency) over entities, content, or facts. Returns scored items and score breakdowns.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      kind: { type: "string", enum: ["entities", "content", "facts"] },
      pack: { type: ["string", "null"] },
      status: { type: ["string", "null"], description: "Facts only. Example: canonical, observed, synthesized." },
      asOf: { type: "string", description: "ISO timestamp used for recency scoring." },
      q: { type: "string", description: "Optional text query." },
      vector: { type: ["array", "null"], items: { type: "number" }, description: "Optional embedding query vector." },
      filterTags: {
        type: ["object", "null"],
        additionalProperties: { type: "string" },
        description: "Exact-match tag filters (AND).",
      },
      limit: { type: "number", minimum: 1, maximum: 50 },
      alpha: { type: "number", minimum: 0, maximum: 1, description: "Weight for vector score." },
      beta: { type: "number", minimum: 0, maximum: 1, description: "Weight for text score." },
      gamma: { type: "number", minimum: 0, maximum: 1, description: "Weight for recency score." },
      halfLifeDays: { type: "number", minimum: 1, maximum: 365, description: "Recency half-life in days." },
    },
    required: ["kind"],
  },
},
  {
    name: "memdb.state.neighbors",
    description: "State-clock neighbors: returns only canonical facts active at asOf.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        entityId: { type: "string" },
        asOf: { type: "string" },
        pack: { type: ["string", "null"] },
      },
      required: ["entityId"],
    },
  },
  {
    name: "memdb.resolve.apply",
    description: "Apply resolution: emits canonical facts + synthesized facts (status tags) and updates state pointers.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        entityId: { type: "string" },
        asOf: { type: "string" },
        pack: { type: ["string", "null"] },
        emitSynthesized: { type: "boolean" },
        agentId: { type: "string" },
      },
      required: ["entityId"],
    },
  },
  {
    name: "memdb.trace.decision",
    description: "Decision-trace helper: write content + event + observed facts in a single call.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        pack: { type: "string" },
        kind: { type: "string" },
        agentId: { type: "string" },
        tags: { type: "object" },
        content: {
          type: "object",
          additionalProperties: true,
          properties: {
            mime: { type: "string" },
            text: { type: "string" },
            uri: { type: "string" },
            tags: { type: "object" },
          },
        },
        claims: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              predicate: { type: "string" },
              s: { anyOf: [{ type: "string" }, { type: "object" }] },
              o: { anyOf: [{ type: "string" }, { type: "object" }] },
              confidence: { type: "number" },
              validFrom: { type: "string" },
              tags: { type: "object" },
            },
            required: ["predicate", "s", "o"],
          },
        },
      },
      required: ["pack", "content"],
    },
  },
  {
    name: "memdb.bootstrap",
    description: "Bootstrap: seed an entity spine for a pack template (good for quick starts).",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        pack: { type: "string" },
        template: { type: "string", enum: ["coding_assistant", "identity_verifier", "coordination"] },
        repoKey: { type: "string" },
        branchKey: { type: "string" },
        files: { type: "array", items: { type: "string" } },
        issuerKey: { type: "string" },
        verifierKey: { type: "string" },
        policyKey: { type: "string" },
      },
      required: ["pack"],
    },
  },

  {
    name: "memdb.pool.post",
    description: "Pool coordinator: create/update a WorkItem (observed facts) and optionally apply resolution to materialize canonical state.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        pack: { type: "string", description: "Pack name (use the 'coordination' pack or extend your pack schema)." },
        instanceId: { type: "string", description: "Agent instance / run id." },
        action: { type: "string", enum: ["start", "update", "complete", "block", "unblock"] },
        topic: { type: "string" },
        summary: { type: "string" },
        affects: { type: "array", items: { anyOf: [{ type: "string" }, { type: "object", properties: { key: { type: "string" } }, required: ["key"], additionalProperties: true }] } },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        applyResolution: { type: "boolean", description: "If true (default), calls resolve.apply for the WorkItem." },
        tags: { type: "object" }
      },
      required: ["pack", "instanceId", "topic"]
    }
  },

  {
    name: "memdb.pool.claim",
    description: "Pool coordinator: claim a WorkItem with a lease (work_claimed_by). Uniqueness is enforced via conflict policies.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        pack: { type: "string" },
        instanceId: { type: "string" },
        workItemId: { type: "string" },
        topic: { type: "string", description: "Alternative to workItemId (deterministic id derived from topic)." },
        ttlSeconds: { type: "number", minimum: 10, maximum: 86400 },
        applyResolution: { type: "boolean" }
      },
      required: ["pack", "instanceId"]
    }
  },

  {
    name: "memdb.pool.release",
    description: "Pool coordinator: release a WorkItem claim by retracting the current work_claimed_by edge.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        pack: { type: "string" },
        instanceId: { type: "string" },
        workItemId: { type: "string" },
        applyResolution: { type: "boolean" }
      },
      required: ["pack", "instanceId", "workItemId"]
    }
  },

  {
    name: "memdb.pool.snapshot",
    description: "Pool coordinator: list WorkItems and their canonical state-clock fields (action, claim, affects, last summary).",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        pack: { type: "string" },
        asOf: { type: "string" },
        status: { type: "string", enum: ["open", "blocked", "done", "all"] },
        limit: { type: "number", minimum: 1, maximum: 200 }
      },
      required: ["pack"]
    }
  },
{
  name: "memdb.resolve.enqueue",
  description: "Enqueue a resolution/apply job for an entity within a pack (processed by the memdb-api scheduler).",
  inputSchema: {
    type: "object",
    properties: {
      pack: { type: "string", description: "Pack name." },
      entityId: { type: "string", description: "Entity ID to resolve." },
      asOf: { type: "string", description: "ISO timestamp snapshot for resolution (default: now)." },
      priority: { type: "number", description: "Higher runs first (default: 0)." },
      reason: { type: "string", description: "Human-readable reason (default: manual)." },
    },
    required: ["pack", "entityId"],
    additionalProperties: true,
  },
},
{
  name: "memdb.search.around",
  description:
    "Hybrid search constrained to a canonical (or observed) subgraph around an anchor entity. This is the main agent retrieval primitive: expand neighborhood, then score within it.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      kind: { type: "string", enum: ["entities", "content", "facts"] },
      rootEntityId: { type: "string", description: "Anchor entity id (ent_...)" },
      pack: { type: ["string", "null"] },
      status: { type: ["string", "null"], description: "Facts only. Defaults to canonical for facts." },
      asOf: { type: "string", description: "ISO timestamp. Defaults to now." },
      depth: { type: "number", description: "BFS depth (0..4). Default 2." },
      limit: { type: "number", description: "Max results (1..50). Default 10." },
      q: { type: "string", description: "Optional text query." },
      vector: { type: ["array", "null"], items: { type: "number" }, description: "Optional embedding query vector." },
      filterTags: { type: ["object", "null"], additionalProperties: { type: "string" } },
      alpha: { type: "number" },
      beta: { type: "number" },
      gamma: { type: "number" },
      halfLifeDays: { type: "number" },
      maxNodes: { type: "number", description: "Safety cap for neighborhood nodes. Default 1000." },
      maxEdges: { type: "number", description: "Safety cap for neighborhood edges. Default 5000." }
    },
    required: ["kind", "rootEntityId"],
  },
},
{
  name: "memdb.state.diff",
  description: "Diff the canonical (state-clock) neighborhood of an entity between two timestamps.",
  inputSchema: {
    type: "object",
    properties: {
      entityId: { type: "string" },
      t1: { type: "string", description: "ISO timestamp #1" },
      t2: { type: "string", description: "ISO timestamp #2" },
      pack: { type: "string", description: "Optional pack filter." },
    },
    required: ["entityId", "t1", "t2"],
    additionalProperties: false,
  },
},
{
  name: "memdb.state.subgraph",
  description: "Extract a canonical (state-clock) subgraph snapshot rooted at an entity (BFS).",
  inputSchema: {
    type: "object",
    properties: {
      rootEntityId: { type: "string" },
      asOf: { type: "string", description: "ISO timestamp (default: now)." },
      pack: { type: "string", description: "Optional pack filter." },
      depth: { type: "number", description: "BFS depth (default: 2, max: 6)." },
      maxEdges: { type: "number", description: "Hard cap on returned edges (default: 500, max: 5000)." },
    },
    required: ["rootEntityId"],
    additionalProperties: false,
  },
},
{
  name: "memdb.query.pattern",
  description:
    "Run an anchored pattern query over edges. Defaults to canonical lane. Use sVar/oVar to bind variables.",
  inputSchema: {
    type: "object",
    properties: {
      asOf: { type: "string", description: "ISO timestamp (default: now)." },
      pack: { type: "string", description: "Optional pack filter." },
      status: {
        type: "string",
        description: 'Which lane to match: "canonical" | "observed" | "any". Default: canonical.',
      },
      limit: { type: "number", description: "Max results (default: 50, max: 500)." },
      explain: { type: "boolean", description: "Return clause stats." },
      clauses: {
        type: "array",
        items: {
          type: "object",
          properties: {
            predicate: { type: "string" },
            s: { type: "string", description: "Concrete subject entityId." },
            o: { type: "string", description: "Concrete object entityId." },
            sVar: { type: "string", description: "Bind subject to this variable name." },
            oVar: { type: "string", description: "Bind object to this variable name." },
            sType: { type: "string", description: "Optional subject entity type filter." },
            oType: { type: "string", description: "Optional object entity type filter." },
            tags: { type: "object", description: "Exact-match tag filters on the edge." },
          },
          required: ["predicate"],
          additionalProperties: false,
        },
      },
      return: { type: "array", items: { type: "string" }, description: "Variables to project." },
    },
    required: ["clauses"],
    additionalProperties: false,
  },

  // Pool coordinator tools
  {
    name: "memdb.pool.post",
    description:
      "Post a work-item update into a shared pool (creates/updates WorkItem, evidence, observed facts, and optionally applies resolution to emit canonical state).",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        pack: { type: "string", description: "Usually: coordination" },
        instanceId: { type: "string", description: "Agent instance / run id (stable during a run)." },
        action: { type: "string", enum: ["start", "update", "complete", "block", "unblock"] },
        topic: { type: "string", description: "Human label for the work item." },
        summary: { type: "string", description: "Optional markdown summary (stored as content evidence)." },
        affects: {
          type: "array",
          items: { anyOf: [{ type: "string" }, { type: "object", properties: { key: { type: "string" } }, required: ["key"] }] },
          description: "Optional affected artifacts (keys).",
        },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        applyResolution: { type: "boolean", description: "If true (default), emits canonical state facts so state-clock reads work immediately." },
        tags: { type: "object", additionalProperties: { type: "string" } },
      },
      required: ["pack", "instanceId", "topic"],
    },
  },
  {
    name: "memdb.pool.claim",
    description: "Claim (lease) a work item for an agent instance. Emits a work_claimed_by fact and optionally applies resolution.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        pack: { type: "string" },
        instanceId: { type: "string" },
        workItemId: { type: "string" },
        topic: { type: "string", description: "Alternative to workItemId: deterministic topic key." },
        ttlSeconds: { type: "number", minimum: 10, maximum: 86400 },
        applyResolution: { type: "boolean" },
      },
      required: ["pack", "instanceId"],
    },
  },
  {
    name: "memdb.pool.release",
    description: "Release a current claim on a work item (retracts work_claimed_by) and optionally applies resolution.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        pack: { type: "string" },
        instanceId: { type: "string" },
        workItemId: { type: "string" },
        applyResolution: { type: "boolean" },
      },
      required: ["pack", "instanceId", "workItemId"],
    },
  },
  {
    name: "memdb.pool.snapshot",
    description: "Get a state-clock snapshot of the pool (canonical facts) with recent summaries.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        pack: { type: "string" },
        asOf: { type: "string" },
        status: { type: "string", enum: ["open", "blocked", "done", "all"] },
        limit: { type: "number", minimum: 1, maximum: 200 },
      },
      required: ["pack"],
    },
  },
];
