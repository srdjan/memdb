# memdb-cli (REST client)

This CLI talks to `memdb-api` over REST.

## Start the API

From repo root:

```bash
deno task api
```

## Run commands

```bash
deno task mem init
deno task mem index
deno task mem packs
```

## Config

- `MEMDB_API_URL` (default: http://localhost:8787)

