import { dbRoot, exists, pjoin, readText, writeText } from "@memdb/core/lib/fs.ts";
import { nowIso } from "@memdb/core/lib/time.ts";
import { v1 } from "./v1.ts";
import { inc, setGauge } from "./metrics.ts";

type QueueEntry = Readonly<{
  id: string;
  entityId: string;
  pack: string;
  priority: number;
  reason: string;
  asOf: string;
  requestedAt: string;
  attempts: number;
}>;

const qPath = (): string => pjoin(dbRoot(), "kv", "queue", "resolution.jsonl");
const lockPath = (): string => pjoin(dbRoot(), "kv", "queue", "resolution.lock");

const tryAcquireLock = async (): Promise<Deno.FsFile | null> => {
  try {
    return await Deno.open(lockPath(), { createNew: true, write: true });
  } catch {
    return null;
  }
};

const releaseLock = async (f: Deno.FsFile): Promise<void> => {
  try {
    f.close();
  } catch {
    // ignore
  }
  try {
    await Deno.remove(lockPath());
  } catch {
    // ignore
  }
};

const parseQueue = (raw: string): QueueEntry[] => {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length);
  const out: QueueEntry[] = [];
  for (const l of lines) {
    try {
      out.push(JSON.parse(l));
    } catch {
      // ignore bad lines
      inc("memdb_queue_parse_errors_total");
    }
  }
  return out;
};

const writeQueue = async (items: QueueEntry[]): Promise<void> => {
  const content = items.map((x) => JSON.stringify(x)).join("\n") + (items.length ? "\n" : "");
  await writeText(qPath(), content);
};

export const drainResolutionQueueOnce = async (opts?: { maxItems?: number }): Promise<void> => {
  const maxItems = Math.max(1, Math.min(50, opts?.maxItems ?? 5));
  if (!(await exists(qPath()))) {
    setGauge("memdb_resolution_queue_length", {}, 0);
    return;
  }

  const lock = await tryAcquireLock();
  if (!lock) return;
  try {
    const raw = await readText(qPath());
    const items = parseQueue(raw);

    // sort by priority desc then requestedAt asc
    items.sort((a, b) => (b.priority - a.priority) || String(a.requestedAt).localeCompare(String(b.requestedAt)));

    const run = items.slice(0, maxItems);
    const rest = items.slice(maxItems);

    for (const it of run) {
      try {
        inc("memdb_resolution_jobs_started_total");
        await v1.resolveApply({
          entityId: it.entityId,
          pack: it.pack,
          asOf: it.asOf ?? nowIso(),
          emitSynthesized: true,
          // tag a "custodian" agent id for provenance
          agentId: "memdb-scheduler",
        } as any);
        inc("memdb_resolution_jobs_succeeded_total");
      } catch (e) {
        inc("memdb_resolution_jobs_failed_total");
        const next: QueueEntry = { ...it, attempts: (it.attempts ?? 0) + 1 };
        rest.push(next);
      }
    }

    await writeQueue(rest);
    setGauge("memdb_resolution_queue_length", {}, rest.length);
  } finally {
    await releaseLock(lock);
  }
};

export const startResolutionWorker = (): void => {
  const enabled = (Deno.env.get("MEMDB_RESOLVE_WORKER") ?? "true").toLowerCase() !== "false";
  if (!enabled) return;

  const intervalMs = Number(Deno.env.get("MEMDB_RESOLVE_WORKER_MS") ?? "2000");
  const safeInterval = Number.isFinite(intervalMs) ? Math.max(500, Math.min(60_000, intervalMs)) : 2000;

  // fire-and-forget loop
  setInterval(() => {
    drainResolutionQueueOnce().catch(() => inc("memdb_resolution_worker_errors_total"));
  }, safeInterval);
};
