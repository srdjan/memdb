/**
 * Minimal OLTP spine schema for memdb.
 *
 * Design goal: serve the "state-clock" fast (canonical facts) while memdb's filesystem
 * remains the immutable evidence store (content/events/observed).
 *
 * Notes:
 * - This schema is intentionally small; you can extend it per pack needs.
 * - All timestamps are stored as ISO-8601 strings (UTC recommended).
 */

export const schemaVersion = 1;

export const schemaStatements = (): readonly string[] => [
  // metadata
  `CREATE TABLE IF NOT EXISTS memdb_meta (
     k TEXT PRIMARY KEY,
     v TEXT NOT NULL
   );`,

  `CREATE TABLE IF NOT EXISTS memdb_checkpoints (
     entity_id TEXT NOT NULL,
     pack TEXT NOT NULL,
     last_ts TEXT NOT NULL,
     PRIMARY KEY (entity_id, pack)
   );`,

  // canonical facts (the "state clock" lane)
  `CREATE TABLE IF NOT EXISTS facts_canonical (
     id TEXT PRIMARY KEY,
     edge_key TEXT NOT NULL,
     pack TEXT NOT NULL,
     predicate TEXT NOT NULL,
     s TEXT NOT NULL,
     o TEXT NOT NULL,
     valid_from TEXT NOT NULL,
     valid_to TEXT,
     recorded_at TEXT NOT NULL,
     confidence REAL NOT NULL,
     source_event_id TEXT NOT NULL,
     supersedes TEXT,
     tags_json TEXT NOT NULL
   );`,

  `CREATE INDEX IF NOT EXISTS idx_facts_canon_s_pack ON facts_canonical (s, pack);`,
  `CREATE INDEX IF NOT EXISTS idx_facts_canon_o_pack ON facts_canonical (o, pack);`,
  `CREATE INDEX IF NOT EXISTS idx_facts_canon_pred ON facts_canonical (predicate);`,
  `CREATE INDEX IF NOT EXISTS idx_facts_canon_valid ON facts_canonical (valid_from, valid_to);`,
];
