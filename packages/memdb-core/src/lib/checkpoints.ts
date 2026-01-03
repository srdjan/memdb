import { dbRoot, exists, mkdirp, pjoin, readJson, writeJson } from "./fs.ts";
import { addCheckpointToManifest } from "./manifest.ts";
import type { TimestampCheckpoint } from "./model.ts";

const isoSafe = (iso: string): string => {
  // ISO -> YYYY-MM-DDTHHMMSSZ (UTC)
  const d = new Date(iso);
  const yyyy = String(d.getUTCFullYear());
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}${mi}${ss}Z`;
};

const checkpointsDir = (packOrAll: string, entityId: string): string =>
  pjoin(dbRoot(), "views", "asof", packOrAll, entityId, "checkpoints");

export const checkpointPath = (packOrAll: string, entityId: string, iso: string): string =>
  pjoin(checkpointsDir(packOrAll, entityId), `${isoSafe(iso)}.json`);

export const saveCheckpoint = async (cp: TimestampCheckpoint): Promise<void> => {
  await mkdirp(checkpointsDir(cp.pack, cp.entityId));
  await writeJson(checkpointPath(cp.pack, cp.entityId, cp.checkpointAt), cp);
  await addCheckpointToManifest(cp.entityId, cp.pack, cp.checkpointAt);
};

export const loadCheckpointByFile = async (absPath: string): Promise<TimestampCheckpoint> =>
  await readJson<TimestampCheckpoint>(absPath);

export const listCheckpointFiles = async (packOrAll: string, entityId: string): Promise<readonly string[]> => {
  const dir = checkpointsDir(packOrAll, entityId);
  if (!(await exists(dir))) return [];
  const out: string[] = [];
  for await (const e of Deno.readDir(dir)) {
    if (!e.isFile) continue;
    if (!e.name.endsWith(".json")) continue;
    out.push(pjoin(dir, e.name));
  }
  out.sort(); // isoSafe sorts lexicographically by time
  return out;
};
