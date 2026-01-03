type EntityRow = Readonly<{ id: string; type: string; key: string; pack?: string }>;

const apiBase = (): string => Deno.env.get("MEMDB_API_URL") ?? "http://localhost:8787";

const getJson = async <T>(path: string): Promise<T> => {
  const res = await fetch(new URL(path, apiBase()));
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return await res.json() as T;
};

export const listPacks = async (): Promise<readonly string[]> => {
  // Keep using the existing convenience endpoint for packs until a pack CRUD is added to v1.
  return await getJson<readonly string[]>("/v1/packs");
};

export const listEntitiesForPack = async (pack: string | null): Promise<readonly EntityRow[]> => {
  const p = pack ? `?pack=${encodeURIComponent(pack)}` : "";
  return await getJson<readonly EntityRow[]>(`/v1/entities${p}`);
};

export const getEntity = async (id: string): Promise<unknown | null> => {
  try {
    return await getJson<unknown>(`/v1/entities/${encodeURIComponent(id)}`);
  } catch {
    return null;
  }
};
