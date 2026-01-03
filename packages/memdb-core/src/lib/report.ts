import type { HealthReport } from "./maintenance.ts";

export type DriftStats = Readonly<{
  count: number;
  withReplayHours: number;
  p50: number | null;
  p90: number | null;
  p99: number | null;
  max: number | null;
  needsCheckpoint: number;
  needsSegmentation: number;
}>;

const percentile = (sorted: readonly number[], p: number): number | null => {
  if (!sorted.length) return null;
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  const w = rank - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
};

export const computeStats = (reports: readonly HealthReport[]): DriftStats => {
  const hrs = reports
    .map((r) => r.replayHours)
    .filter((x): x is number => typeof x === "number" && Number.isFinite(x))
    .slice()
    .sort((a, b) => a - b);

  const needsCheckpoint = reports.filter((r) => r.needsCheckpoint).length;
  const needsSegmentation = reports.filter((r) => r.needsSegmentation).length;

  return {
    count: reports.length,
    withReplayHours: hrs.length,
    p50: percentile(hrs, 50),
    p90: percentile(hrs, 90),
    p99: percentile(hrs, 99),
    max: hrs.length ? hrs[hrs.length - 1] : null,
    needsCheckpoint,
    needsSegmentation,
  };
};

export const toMarkdown = (packKey: string, asOf: string, stats: DriftStats, worst: readonly HealthReport[]): string => {
  const fmt = (x: number | null) => (x === null ? "—" : x.toFixed(2));
  const lines: string[] = [];
  lines.push(`# memdb drift report`);
  lines.push(``);
  lines.push(`- asOf: \`${asOf}\``);
  lines.push(`- pack: \`${packKey}\``);
  lines.push(``);
  lines.push(`## Replay drift (hours)`);
  lines.push(``);
  lines.push(`- count: **${stats.count}** (with replayHours: ${stats.withReplayHours})`);
  lines.push(`- p50: **${fmt(stats.p50)}**`);
  lines.push(`- p90: **${fmt(stats.p90)}**`);
  lines.push(`- p99: **${fmt(stats.p99)}**`);
  lines.push(`- max: **${fmt(stats.max)}**`);
  lines.push(`- needsCheckpoint: **${stats.needsCheckpoint}**`);
  lines.push(`- needsSegmentation: **${stats.needsSegmentation}**`);
  lines.push(``);
  lines.push(`## Worst entities`);
  lines.push(``);
  lines.push(`| replayHours | entityId | nearestCheckpointAt | needsCheckpoint | needsSegmentation | segmentBeforeDay |`);
  lines.push(`|---:|---|---|---:|---:|---|`);
  for (const r of worst) {
    lines.push(`| ${fmt(r.replayHours)} | \`${r.entityId}\` | \`${r.nearestCheckpointAt ?? "—"}\` | ${r.needsCheckpoint ? "yes" : "no"} | ${r.needsSegmentation ? "yes" : "no"} | \`${r.segmentBeforeDay}\` |`);
  }
  lines.push(``);
  return lines.join("\n");
};
