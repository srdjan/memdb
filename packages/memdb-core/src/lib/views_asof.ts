import { dbRoot, exists, pjoin, readJson, writeJson, mkdirp } from "./fs.ts";
import type { AsOfSnapshot } from "./model.ts";

export const asOfDir = (packOrAll: string, entityId: string): string =>
  pjoin(dbRoot(), "views", "asof", packOrAll, entityId);

export const asOfPath = (packOrAll: string, entityId: string, ymd: string): string =>
  pjoin(asOfDir(packOrAll, entityId), `${ymd}.json`);

export const loadAsOfSnapshot = async (packOrAll: string, entityId: string, ymd: string): Promise<AsOfSnapshot | null> => {
  const p = asOfPath(packOrAll, entityId, ymd);
  if (!(await exists(p))) return null;
  return await readJson<AsOfSnapshot>(p);
};

export const saveAsOfSnapshot = async (snap: AsOfSnapshot): Promise<void> => {
  await mkdirp(asOfDir(snap.pack, snap.entityId));
  await writeJson(asOfPath(snap.pack, snap.entityId, snap.asOfDate), snap);
};
