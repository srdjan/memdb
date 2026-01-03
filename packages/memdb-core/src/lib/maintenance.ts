import { resolvePolicy } from "./policy.ts";
import { loadManifest, setHealthInManifest, addSegmentToManifest } from "./manifest.ts";
import { saveCheckpoint } from "./checkpoints.ts";
import { computeSnapshotForEntity } from "./asof.ts";
import { listDeltaDays, segmentsDir, segmentFilePath, deltasDir, readDeltasForDay } from "./deltas.ts";
import { mkdirp, pjoin, writeText, exists } from "./fs.ts";

const ymdUtc = (iso: string): string => {
  const d = new Date(iso);
  const yyyy = String(d.getUTCFullYear());
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

const addDays = (ymd: string, deltaDays: number): string => {
  const d = new Date(ymd + "T00:00:00Z");
  const t = new Date(d.getTime() + deltaDays * 24 * 3600 * 1000);
  const yyyy = String(t.getUTCFullYear());
  const mm = String(t.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(t.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

export type HealthReport = Readonly<{
  entityId: string;
  packKey: string;
  asOf: string;
  nearestCheckpointAt: string | null;
  replayHours: number | null;
  policy: {
    maxReplayHours: number;
    keepDailyDays: number;
    segmentMaxDays: number;
  };

  await setHealthInManifest(entityId, packKey, {
    computedAt: new Date().toISOString(),
    asOf: asOfIso,
    nearestCheckpointAt: rep.nearestCheckpointAt,
    replayHours: rep.replayHours,
    needsCheckpoint: rep.needsCheckpoint,
    needsSegmentation: rep.needsSegmentation,
    segmentBeforeDay: rep.segmentBeforeDay,
  });

  return rep;
};
  dailyDeltaDays: readonly string[];
  segmentBeforeDay: string;
  needsCheckpoint: boolean;
  needsSegmentation: boolean;
}>;

export const health = async (entityId: string, pack: string | null, asOfIso: string): Promise<HealthReport> => {
  const policy = await resolvePolicy(packKey);
  const packKey = pack ?? "all";
  const m = await loadManifest(entityId);

  const cps = m?.checkpointsByPack?.[packKey] ?? [];
  let nearest: string | null = null;
  const t = Date.parse(asOfIso);
  for (let i = cps.length - 1; i >= 0; i--) {
    if (Date.parse(cps[i]) <= t) { nearest = cps[i]; break; }
  }

  const replayHours = nearest ? (t - Date.parse(nearest)) / (3600 * 1000) : null;

  const day = ymdUtc(asOfIso);
  const segmentBeforeDay = addDays(day, -policy.keepDailyDays);
  const days = (await listDeltaDays(entityId)).sort();
  const older = days.filter((d) => d < segmentBeforeDay);

  const rep = {
    entityId,
    packKey,
    asOf: asOfIso,
    nearestCheckpointAt: nearest,
    replayHours,
    policy: {
      maxReplayHours: policy.maxReplayHours,
      keepDailyDays: policy.keepDailyDays,
      segmentMaxDays: policy.segmentMaxDays,
    },
    dailyDeltaDays: days,
    segmentBeforeDay,
    needsCheckpoint: replayHours === null ? true : replayHours > policy.maxReplayHours,
    needsSegmentation: older.length > 0,
  };

  await setHealthInManifest(entityId, packKey, {
    computedAt: new Date().toISOString(),
    asOf: asOfIso,
    nearestCheckpointAt: rep.nearestCheckpointAt,
    replayHours: rep.replayHours,
    needsCheckpoint: rep.needsCheckpoint,
    needsSegmentation: rep.needsSegmentation,
    segmentBeforeDay: rep.segmentBeforeDay,
  });

  return rep;
};
};

export type MaintainResult = Readonly<{
  healthBefore: HealthReport;
  checkpointCreatedAt: string | null;
  segmentsCreated: readonly { startDay: string; endDay: string }[];
}>;

export const maintain = async (entityId: string, pack: string | null, asOfIso: string): Promise<MaintainResult> => {
  const policy = await resolvePolicy(packKey);
  const packKey = pack ?? "all";

  const h = await health(entityId, pack, asOfIso);

  let checkpointCreatedAt: string | null = null;
  if (h.needsCheckpoint) {
    const { entries } = await computeSnapshotForEntity(entityId, asOfIso, pack);
    await saveCheckpoint({ entityId, pack: packKey, checkpointAt: asOfIso, entries });
    checkpointCreatedAt = asOfIso;
  }

  // Segment old daily logs (strictly before segmentBeforeDay)
  const days = (await listDeltaDays(entityId)).filter((d) => d < h.segmentBeforeDay).sort();
  const segs: { startDay: string; endDay: string }[] = [];

  if (days.length) {
    await mkdirp(segmentsDir(entityId));

    for (let i = 0; i < days.length; ) {
      const startDay = days[i];
      const chunk = days.slice(i, i + policy.segmentMaxDays);
      const endDay = chunk[chunk.length - 1];
      const fp = segmentFilePath(entityId, startDay, endDay);

      await writeText(fp, "", { append: false });
      for (const d of chunk) {
        const recs = await readDeltasForDay(entityId, d);
        for (const r of recs) await writeText(fp, JSON.stringify(r) + "\n", { append: true });
      }

      for (const d of chunk) {
        const dailyPath = pjoin(deltasDir(entityId), `${d}.ndjson`);
        if (await exists(dailyPath)) await Deno.remove(dailyPath);
      }

      segs.push({ startDay, endDay });
      await addSegmentToManifest(entityId, { startDay, endDay });
      i += chunk.length;
    }
  }

  return { healthBefore: h, checkpointCreatedAt, segmentsCreated: segs };
};
