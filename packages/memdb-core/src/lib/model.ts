export type Tags = Readonly<Record<string, string>>;

export type ConflictPolicy = Readonly<{
  predicate: string;
  /**
   * "one_per_subject" means: for a given (predicate, subject), only one active object is allowed
   * in the observed lane. New assertions auto-close conflicting intervals.
   */
  uniqueness: "one_per_subject";
  /** Which lane the policy applies to. Default: observed. */
  lane?: "observed" | "all";
}>;


export type PackPolicy = Readonly<{
  requiredTags: readonly string[];
  forbiddenEmbeddingTags: readonly string[];
  defaultRetentionClass: string;
  conflictPolicies?: readonly ConflictPolicy[];
}>;

export type Pack = Readonly<{
  name: string;
  entityTypes: readonly string[];
  predicates: readonly string[];
  eventKinds: readonly string[];
  policy: PackPolicy;
}>;

export type Entity = Readonly<{
  id: string;
  type: string;
  key: string;
  createdAt: string; // ISO
  tags: Tags;
}>;

export type Ref =
  | Readonly<{ kind: "entity"; id: string }>
  | Readonly<{ kind: "edge"; id: string }>
  | Readonly<{ kind: "content"; id: string }>
  | Readonly<{ kind: "blob"; id: string }>;

export type Claim = Readonly<{
  predicate: string;
  s: string;
  o: string;
  validFrom: string; // ISO
  confidence: number; // 0..1
}>;

export type Event = Readonly<{
  id: string;
  agentId: string;
  kind: string;
  recordedAt: string; // ISO
  pack: string;
  tags?: Tags;
  refs: readonly Ref[];
  claims?: readonly Claim[];
}>;

export type Edge = Readonly<{
  id: string;
  edgeKey: string;
  predicate: string;
  s: string;
  o: string;
  validFrom: string; // ISO
  validTo: string | null; // ISO
  recordedAt: string; // ISO
  confidence: number; // 0..1
  sourceEventId: string;
  supersedes: string | null;
  pack: string;
  tags: Tags;
}>;

export type Token = string;

export type EmbeddingTarget =
  | Readonly<{ kind: "entity"; id: string }>
  | Readonly<{ kind: "event"; id: string }>
  | Readonly<{ kind: "edge"; id: string }>;

export type EmbeddingItem = Readonly<{
  id: string;
  profile: string;
  pack: string;
  target: EmbeddingTarget;
  recordedAt: string; // ISO
  payload: string;    // sanitized text (or derived)
  tokens: readonly Token[];
  tags: Tags;         // effective tags used for policy gating
}>;

export type CurrentEntityView = Readonly<{
  entityId: string;
  asOf: string; // ISO
  edges: readonly string[]; // edge ids adjacent to entity
}>;

export type AsOfSnapshot = Readonly<{
  entityId: string;
  asOfDate: string; // YYYY-MM-DD (UTC)
  asOf: string;     // ISO
  pack: string;     // pack name or "all"
  edges: readonly string[]; // edge ids selected (post edgeKey versioning + validity)
}>;

export type SnapshotEntry = Readonly<{ edgeKey: string; edgeId: string }>;

export type DeltaRecord = Readonly<{
  ts: string; // ISO
  entityId: string;
  pack: string;
  edgeKey: string;
  addEdgeId: string;
  removeEdgeId: string | null;
}>;

export type TimestampCheckpoint = Readonly<{
  entityId: string;
  pack: string; // pack name or "all"
  checkpointAt: string; // ISO
  entries: readonly SnapshotEntry[];
}>;

export type SegmentRange = Readonly<{ startDay: string; endDay: string }>;

export type EntityManifest = Readonly<{
  entityId: string;
  updatedAt: string; // ISO
  checkpointsByPack: Record<string, readonly string[]>; // packKey -> sorted ISO timestamps
  segments: readonly SegmentRange[]; // non-overlapping, sorted
}>;

export type HealthMetrics = Readonly<{
  computedAt: string; // ISO now
  asOf: string; // ISO
  nearestCheckpointAt: string | null;
  replayHours: number | null;
  needsCheckpoint: boolean;
  needsSegmentation: boolean;
  segmentBeforeDay: string;
}>;


export type Content = Readonly<{
  id: string;
  sha256: string;
  bytes?: number;
  mime?: string;
  capturedAt: string; // ISO
  source?: string;
  uri?: string;
  excerpt?: string;
  tags?: Tags;
}>;

export type VectorItem = Readonly<{
  id: string;
  kind: "entity" | "edge" | "event" | "content" | "custom";
  pack?: string;
  dims: number;
  embedding: readonly number[];
  recordedAt: string; // ISO
  tags?: Tags;
}>;
