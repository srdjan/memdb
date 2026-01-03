import { dbRoot, exists, mkdirp, pjoin, readJson, writeJson } from "./fs.ts";
import type { Content, Tags } from "./model.ts";
import { contentBlobPath, contentJsonPath } from "./paths.ts";
import { nowIso } from "./time.ts";
import { makeId } from "./ids.ts";
import { loadPointers, savePointers } from "./indexes.ts";

const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  const arr = Array.from(new Uint8Array(buf));
  return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
};

export type PutContentInput = Readonly<{
  mime?: string;
  bytes?: Uint8Array; // optional (for url-only content)
  source?: string;
  uri?: string;
  excerpt?: string;
  tags?: Tags;
}>;

export const putContent = async (inp: PutContentInput): Promise<Content> => {
  const capturedAt = nowIso();
  const bytes = inp.bytes;
  const sha256 = bytes ? await sha256Hex(bytes) : "sha256:" + makeId("nil");

  // write blob if provided (content-addressed)
  if (bytes) {
    const blobPath = contentBlobPath(sha256);
    await mkdirp(pjoin(dbRoot(), "blobs"));
    if (!(await exists(blobPath))) {
      await Deno.writeFile(blobPath, bytes);
    }
  }

  const id = makeId("cnt");
  const content: Content = {
    id,
    sha256,
    bytes: bytes?.byteLength,
    mime: inp.mime,
    capturedAt,
    source: inp.source,
    uri: inp.uri,
    excerpt: inp.excerpt,
    tags: inp.tags,
  };

  await writeJson(contentJsonPath(id), content);

  // pointer
  const ptr = await loadPointers();
  await savePointers({
    ...ptr,
    content: { ...ptr.content, [id]: `content/${id}.json` },
  });

  return content;
};

export const getContent = async (id: string): Promise<Content | null> => {
  const p = contentJsonPath(id);
  if (!(await exists(p))) return null;
  return await readJson<Content>(p);
};

export const listContents = async (): Promise<readonly Content[]> => {
  const ptr = await loadPointers();
  const out: Content[] = [];
  for (const [id, rel] of Object.entries(ptr.content ?? {})) {
    const abs = pjoin(dbRoot(), rel);
    if (!(await exists(abs))) continue;
    out.push(await readJson<Content>(abs));
  }
  out.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  return out;
};
