import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { router } from "./router.ts";

const port = Number(Deno.env.get("PORT") ?? "8000");

console.log(`memdb-web listening on http://localhost:${port}`);

serve((req) => router(req), { port });
