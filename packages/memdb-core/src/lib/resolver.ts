import { dbRoot, mkdirp, pjoin, writeJson } from "./fs.ts";
import type { Edge } from "./model.ts";
import { edgesAsOfForEntity } from "./asof.ts";
import { nowIso, isActiveAt } from "./time.ts";

export type ResolutionProposal = Readonly<{
  edgeKey: string;
  canonicalEdgeId: string | null;
  candidates: readonly Readonly<{ id: string; recordedAt: string; validFrom: string; validTo: string | null; confidence: number; status: string }>[];
}>;

export type ResolutionRun = Readonly<{
  entityId: string;
  pack: string | null;
  asOf: string;
  createdAt: string;
  proposals: readonly ResolutionProposal[];
}>;

/**
 * Resolver (P16 skeleton)
 *
 * Deterministic, non-LLM rule:
 * - For each (edgeKey) visible as-of time, pick the most recently recorded ACTIVE edge as canonical.
 * - Mark others as superseded candidates.
 *
 * This produces a resolution artifact (json) that a future agent (or an LLM) can "apply"
 * by emitting new synthesized/canonical facts.
 */
export const resolveEntity = async (entityId: string, asOf: string, pack: string | null): Promise<ResolutionRun> => {
  const edges = await edgesAsOfForEntity(entityId, asOf, pack);
  const byKey = new Map<string, Edge[]>();
  for (const e of edges) {
    const arr = byKey.get(e.edgeKey) ?? [];
    arr.push(e);
    byKey.set(e.edgeKey, arr);
  }

  const proposals: ResolutionProposal[] = [];
  for (const [edgeKey, arr] of byKey.entries()) {
    const sorted = arr.slice().sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
    const active = sorted.filter((e) => isActiveAt(e.validFrom, e.validTo, asOf));
    const canonical = active.length ? active[0] : null;

    proposals.push({
      edgeKey,
      canonicalEdgeId: canonical?.id ?? null,
      candidates: sorted.map((e) => ({
        id: e.id,
        recordedAt: e.recordedAt,
        validFrom: e.validFrom,
        validTo: e.validTo,
        confidence: e.confidence,
        status: canonical?.id === e.id ? "canonical" : (isActiveAt(e.validFrom, e.validTo, asOf) ? "active" : "inactive"),
      })),
    });
  }

  proposals.sort((a, b) => a.edgeKey.localeCompare(b.edgeKey));

  return {
    entityId,
    pack,
    asOf,
    createdAt: nowIso(),
    proposals,
  };
};

export const persistResolution = async (run: ResolutionRun): Promise<Readonly<{ path: string }>> => {
  const dir = pjoin(dbRoot(), "kv", "resolutions", run.entityId, run.pack ?? "all");
  await mkdirp(dir);
  const name = run.createdAt.replace(/[:.]/g, "-") + ".json";
  const fp = pjoin(dir, name);
  await writeJson(fp, run as unknown);
  return { path: fp };
};
