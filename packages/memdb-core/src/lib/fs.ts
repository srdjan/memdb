import { ensureDir } from "@std/fs";
import * as path from "@std/path";

export type Json = Record<string, unknown>;

export const dbRoot = (): string => Deno.env.get("MEMDB_ROOT") ?? "./memdb";

export const pjoin = (...parts: readonly string[]): string => path.join(...parts);

export const writeText = async (
  filePath: string,
  content: string,
  opts?: { append?: boolean },
): Promise<void> => {
  await ensureDir(path.dirname(filePath));
  await Deno.writeTextFile(filePath, content, { append: opts?.append ?? false });
};

export const readText = async (filePath: string): Promise<string> =>
  await Deno.readTextFile(filePath);

export const writeJson = async (filePath: string, v: unknown): Promise<void> => {
  const s = JSON.stringify(v, null, 2) + "\n";
  await writeText(filePath, s);
};

export const readJson = async <T>(filePath: string): Promise<T> => {
  const s = await readText(filePath);
  return JSON.parse(s) as T;
};

export const exists = async (filePath: string): Promise<boolean> => {
  try {
    await Deno.stat(filePath);
    return true;
  } catch {
    return false;
  }
};

export const mkdirp = async (dirPath: string): Promise<void> => {
  await ensureDir(dirPath);
};

export const isoToYmd = (iso: string): { yyyy: string; mm: string; dd: string } => {
  const d = new Date(iso);
  const yyyy = String(d.getUTCFullYear());
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return { yyyy, mm, dd };
};

export const listFilesRec = async (dirPath: string): Promise<string[]> => {
  const out: string[] = [];
  for await (const e of Deno.readDir(dirPath)) {
    const p = path.join(dirPath, e.name);
    if (e.isDirectory) out.push(...await listFilesRec(p));
    else out.push(p);
  }
  return out;
};
