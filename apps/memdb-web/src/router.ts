import { html, layout } from "./views.ts";
import { listPacks, listEntitiesForPack, getEntity } from "./usecases/memory.ts";

type Route = (req: Request) => Promise<Response> | Response;

const notFound = (): Response =>
  new Response("Not Found", { status: 404 });

const textHtml = (s: string, status = 200): Response =>
  new Response(s, { status, headers: { "content-type": "text/html; charset=utf-8" } });

const jsonRes = (v: unknown, status = 200): Response =>
  new Response(JSON.stringify(v, null, 2), { status, headers: { "content-type": "application/json; charset=utf-8" } });

const methodNotAllowed = (): Response =>
  new Response("Method Not Allowed", { status: 405 });

const serveStatic = async (path: string): Promise<Response> => {
  const fp = new URL(`../static/${path}`, import.meta.url);
  try {
    const data = await Deno.readFile(fp);
    const ct = path.endsWith(".css") ? "text/css" : "application/octet-stream";
    return new Response(data, { status: 200, headers: { "content-type": ct } });
  } catch {
    return new Response("Not Found", { status: 404 });
  }
};

const routes: ReadonlyArray<Readonly<{ method: string; path: RegExp; handler: Route }>> = [
  {
    method: "GET",
    path: /^\/static\/(?<path>.+)$/,
    handler: async (req) => {
      const m = req.url.match(/\/static\/(?<path>.+)$/);
      const p = m?.groups?.path ?? "";
      return await serveStatic(p);
    },
  },
  {
    method: "GET",
    path: /^\/$/,
    handler: async () => {
      const packs = await listPacks();
      return textHtml(layout("memdb-web", html.home(packs)));
    },
  },
  {
    method: "GET",
    path: /^\/packs\/(?<pack>[^/]+)$/,
    handler: async (req) => {
      const m = req.url.match(/\/packs\/(?<pack>[^/]+)$/);
      const pack = m?.groups?.pack ?? "all";
      const entities = await listEntitiesForPack(pack === "all" ? null : pack);
      return textHtml(layout(`pack: ${pack}`, html.pack(pack, entities)));
    },
  },
  {
    method: "GET",
    path: /^\/api\/packs$/,
    handler: async () => jsonRes(await listPacks()),
  },
  {
    method: "GET",
    path: /^\/api\/entities\/(?<id>[^/]+)$/,
    handler: async (req) => {
      const m = req.url.match(/\/api\/entities\/(?<id>[^/]+)$/);
      const id = m?.groups?.id;
      if (!id) return jsonRes({ error: "missing id" }, 400);
      const ent = await getEntity(id);
      if (!ent) return jsonRes({ error: "not found" }, 404);
      return jsonRes(ent);
    },
  },
];

export const router = async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  for (const r of routes) {
    if (req.method !== r.method) continue;
    if (!r.path.test(url.pathname)) continue;
    return await r.handler(req);
  }
  if (routes.some((r) => r.path.test(url.pathname))) return methodNotAllowed();
  return notFound();
};
