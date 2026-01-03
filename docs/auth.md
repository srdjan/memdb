# Auth, scopes, and pack boundaries

The API supports optional API keys with:

- **Scopes**: `read`, `write`, `ops`
- **Pack boundaries**: keys can be limited to specific packs
- **Rate limits**: token-bucket per key (rps/burst)

## Configure keys

### File-based

Create:

`kv/auth/keys.json`

```json
{
  "keys": [
    {
      "id": "dev",
      "key": "memdb_dev_key",
      "scopes": ["read", "write", "ops"],
      "packs": ["*"],
      "rate": { "rps": 10, "burst": 20 }
    },
    {
      "id": "readonly-coding-assistant",
      "key": "memdb_ro_ca",
      "scopes": ["read"],
      "packs": ["coding_assistant"],
      "rate": { "rps": 5, "burst": 10 }
    }
  ]
}
```

### Env-based

Instead of the file, set:

- `MEMDB_API_KEYS_JSON` to the same JSON object (string)

## Enforce auth even in dev

If no keys are configured, the server defaults to **open** (dev mode).

To require auth:

```bash
MEMDB_REQUIRE_AUTH=true deno task api
```

## Using the key

Send either header:

- `Authorization: Bearer <key>`
- `x-api-key: <key>`
