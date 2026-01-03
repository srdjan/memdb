import { dbRoot, isoToYmd, pjoin } from "./fs.ts";

export const entityPropsPath = (type: string, id: string): string =>
  pjoin(dbRoot(), "entities", type, id, "props.json");

export const eventJsonPath = (recordedAtIso: string, id: string): string => {
  const { yyyy, mm, dd } = isoToYmd(recordedAtIso);
  return pjoin(dbRoot(), "events", yyyy, mm, dd, `${id}.json`);
};

export const edgeJsonPath = (predicate: string, id: string): string =>
  pjoin(dbRoot(), "edges", predicate, `${id}.json`);

export const edgeCurrentPtrPath = (edgeKey: string): string =>
  pjoin(dbRoot(), "kv", "edge_current", `${edgeKey}.txt`);


export const contentJsonPath = (id: string): string => pjoin(dbRoot(), "content", `${id}.json`);
export const contentBlobPath = (sha256: string): string => pjoin(dbRoot(), "blobs", sha256);
