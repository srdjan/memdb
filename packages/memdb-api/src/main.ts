import { serve } from "@std/http/server.ts";
import { router } from "./router.ts";
import { startResolutionWorker } from "./worker.ts";
import { initTurso } from "./turso.ts";

const port = Number(Deno.env.get("MEMDB_API_PORT") ?? "8787");
console.log(`memdb-api listening on http://localhost:${port}`);

startResolutionWorker();
await initTurso();
serve((req) => router(req), { port });
