import { dbRoot, exists, pjoin, readJson, writeJson, mkdirp } from "./fs.ts";
import type { Pack } from "./model.ts";

const packDir = (root: string) => pjoin(root, "packs");

export const loadPack = async (name: string): Promise<Pack> => {
  const root = dbRoot();
  const inDb = pjoin(packDir(root), `${name}.pack.json`);
  const inRepo = pjoin("packs", `${name}.pack.json`);

  const p = (await exists(inDb)) ? inDb : inRepo;
  return await readJson<Pack>(p);
};

export const copyPacksIntoDb = async (): Promise<void> => {
  const root = dbRoot();
  await mkdirp(packDir(root));

  const names = ["core", "coding_assistant", "identity_verifier", "coordination"] as const;
  for (const n of names) {
    const pack = await readJson<Pack>(pjoin("packs", `${n}.pack.json`));
    await writeJson(pjoin(packDir(root), `${n}.pack.json`), pack);
  }
};
