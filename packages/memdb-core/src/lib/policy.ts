import { dbRoot, exists, pjoin, readJson, writeJson, mkdirp } from "./fs.ts";

export type Policy = Readonly<{
  rollupEveryHours: number;
  maxReplayHours: number;
  keepDailyDays: number;
  segmentMaxDays: number;
}>;

const policyPath = (): string => pjoin(dbRoot(), "kv", "policy.json");

export const defaultPolicy: Policy = {
  rollupEveryHours: 6,
  maxReplayHours: 48,
  keepDailyDays: 7,
  segmentMaxDays: 14,
};

export const ensurePolicy = async (): Promise<Policy> => {
  const p = policyPath();
  if (!(await exists(p))) {
    await mkdirp(pjoin(dbRoot(), "kv"));
    await writeJson(p, { default: defaultPolicy, packs: {} });
    return defaultPolicy;
  }
  // Preserve existing file; if legacy flat, keep it
  const loaded = await readJson<any>(p);
  if (loaded && typeof loaded === "object" && loaded.rollupEveryHours !== undefined) {
    return normalize(loaded as Partial<Policy>);
  }
  const base = normalize(loaded?.default ?? {});
  return base;
};
};

export type PolicyFile =
  | Policy
  | Readonly<{
      default?: Partial<Policy>;
      packs?: Record<string, Partial<Policy>>;
    }>;

const normalize = (p: Partial<Policy>): Policy => ({
  rollupEveryHours: Number(p.rollupEveryHours ?? defaultPolicy.rollupEveryHours),
  maxReplayHours: Number(p.maxReplayHours ?? defaultPolicy.maxReplayHours),
  keepDailyDays: Number(p.keepDailyDays ?? defaultPolicy.keepDailyDays),
  segmentMaxDays: Number(p.segmentMaxDays ?? defaultPolicy.segmentMaxDays),
});

export const resolvePolicy = async (packKey: string): Promise<Policy> => {
  const p = policyPath();
  if (!(await exists(p))) {
    await mkdirp(pjoin(dbRoot(), "kv"));
    // write new preferred structure
    await writeJson(p, { default: defaultPolicy, packs: {} });
    return defaultPolicy;
  }

  const loaded = await readJson<PolicyFile>(p);
  // flat legacy form
  if ((loaded as any).rollupEveryHours !== undefined) {
    return normalize(loaded as Partial<Policy>);
  }

  const obj = loaded as any;
  const base = normalize(obj.default ?? {});
  const over = normalize({ ...base, ...(obj.packs?.[packKey] ?? {}) });
  return over;
};
