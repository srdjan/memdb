import { dbRoot, pjoin } from "./fs.ts";

export const vectorsRoot = (): string => pjoin(dbRoot(), "vectors");

export const embeddingItemPath = (id: string): string =>
  pjoin(vectorsRoot(), "items", `${id}.json`);
