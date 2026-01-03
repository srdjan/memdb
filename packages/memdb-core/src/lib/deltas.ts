import { dbRoot, mkdirp, pjoin, writeText, exists, readText } from "./fs.ts";
import type { DeltaRecord } from "./model.ts";

const ymdUtc = (iso: string): string => {
  const d = new Date(iso);
  const yyyy = String(d.getUTCFullYear());
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

export const deltasDir = (entityId: string): string =>
  pjoin(dbRoot(), "kv", "deltas", entityId);

export const segmentsDir = (entityId: string): string =>
  pjoin(deltasDir(entityId), "segments");

export const segmentFilePath = (entityId: string, startDay: string, endDay: string): string =>
  pjoin(segmentsDir(entityId), `${startDay}_${endDay}.ndjson`);

export const deltaFilePath = (entityId: string, ymd: string): string =>
  pjoin(deltasDir(entityId), `${ymd}.ndjson`);

export const appendDelta = async (rec: DeltaRecord): Promise<void> => {
  const ymd = ymdUtc(rec.ts);
  const dir = deltasDir(rec.entityId);
  await mkdirp(dir);
  const fp = deltaFilePath(rec.entityId, ymd);
  await writeText(fp, JSON.stringify(rec) + "\n", { append: true });
};

export const listDeltaDays = async (entityId: string): Promise<readonly string[]> => {
  const dir = deltasDir(entityId);
  if (!(await exists(dir))) return [];
  const days: string[] = [];
  for await (const e of Deno.readDir(dir)) {
    if (!e.isFile) continue;
    if (!e.name.endsWith(".ndjson")) continue;
    days.push(e.name.replace(/\.ndjson$/, ""));
  }
  days.sort();
  return days;
};

export const readDeltasForDay = async (entityId: string, ymd: string): Promise<readonly DeltaRecord[]> => {
  const fp = deltaFilePath(entityId, ymd);
  if (!(await exists(fp))) return [];
  const s = await readText(fp);
  const lines = s.split(/\r?\n/g).map((x) => x.trim()).filter(Boolean);
  const out: DeltaRecord[] = [];
  for (const ln of lines) {
    try {
      out.push(JSON.parse(ln) as DeltaRecord);
    } catch {
      // ignore malformed lines
    }
  }
  out.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  return out;
};

export const pruneDeltasBeforeDay = async (entityId: string, ymdExclusive: string): Promise<number> => {
  const dir = deltasDir(entityId);
  if (!(await exists(dir))) return 0;
  let n = 0;
  for await (const e of Deno.readDir(dir)) {
    if (!e.isFile) continue;
    if (!e.name.endsWith(".ndjson")) continue;
    const day = e.name.replace(/\.ndjson$/, "");
    if (day < ymdExclusive) {
      await Deno.remove(pjoin(dir, e.name));
      n++;
    }
  }
  return n;
};


export const listSegments = async (entityId: string): Promise<readonly { startDay: string; endDay: string; path: string }[]> => {
  const dir = segmentsDir(entityId);
  if (!(await exists(dir))) return [];
  const out: { startDay: string; endDay: string; path: string }[] = [];
  for await (const e of Deno.readDir(dir)) {
    if (!e.isFile) continue;
    if (!e.name.endsWith(".ndjson")) continue;
    const base = e.name.replace(/\.ndjson$/, "");
    const i = base.indexOf("_");
    if (i < 0) continue;
    const startDay = base.slice(0, i);
    const endDay = base.slice(i + 1);
    out.push({ startDay, endDay, path: pjoin(dir, e.name) });
  }
  out.sort((a, b) => a.startDay.localeCompare(b.startDay));
  return out;
};

export const readDeltasFromFile = async (absPath: string): Promise<readonly DeltaRecord[]> => {
  if (!(await exists(absPath))) return [];
  const s = await readText(absPath);
  const lines = s.split(/\r?\n/g).map((x) => x.trim()).filter(Boolean);
  const out: DeltaRecord[] = [];
  for (const ln of lines) {
    try { out.push(JSON.parse(ln) as DeltaRecord); } catch { /* ignore */ }
  }
  out.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  return out;
};
