# memdb-web (placeholder)

This is a minimal SSR web app intended as a starting point for teams to build:

- “Create your agent” flows
- pack templates (coding assistant, identity verifier, etc.)
- a memory browser / graph explorer UI
- human-in-the-loop review and curation tools

## Run

```bash
deno task dev
```

Open http://localhost:8000

## Notes

- This app uses a tiny SSR router + string templates and serves HTML.
- It includes placeholder endpoints that *call into memdb-core* via direct module imports.
- The UI is intentionally barebones; extend it with HTMX or your preferred minimal approach.



## Requires API

Start `memdb-api` first, then run this app.

- `MEMDB_API_URL` (default: http://localhost:8787)


This app uses `/v1/*` endpoints (no `/rpc`).
