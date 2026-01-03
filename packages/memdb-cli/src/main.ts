const apiBase = Deno.env.get("MEMDB_API_URL") ?? "http://localhost:8787";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

const usage = () => {
  console.log(`mem (REST)

Usage:
  mem init
  mem index

  mem add-content --pack <pack?> [--mime <mime>] [--source <src>] [--uri <uri>] [--text <text> | --base64 <b64>] [--tags k=v,...]

  mem add-entity --pack <pack> --type <type> --key <key> [--tags k=v,k2=v2]
  mem add-event --pack <pack> --kind <kind> [--agentId <id>] [--refs kind:id,...] [--tags k=v,...]
  mem add-edge --pack <pack> --predicate <p> --s <id> --o <id> --sourceEventId <evt> [--validFrom ISO] [--confidence 0..1] [--tags k=v,...]
  mem retract-edge --pack <pack> --predicate <p> --s <id> --o <id> --sourceEventId <evt> --validTo ISO [--confidence 0..1] [--tags k=v,...]

  mem neighbors --entity <id> [--asOf ISO] [--pack <pack>]
  mem path --from <id> --to <id> [--asOf ISO] [--pack <pack>] [--maxDepth N]
  mem timeline --entity <id>

  mem health --entity <id> [--asOf ISO] [--pack <pack>]
  mem maintain --entity <id> [--asOf ISO] [--pack <pack>]
  mem maintain-all [--pack <pack>] [--allPacks true] [--asOf ISO]
  mem report [--pack <pack>] [--allPacks true] [--asOf ISO] [--format json|md]

  mem search --kind entities|facts|content --q <query> [--pack <pack>]

  mem search-hybrid --kind entities|facts|content [--q <query>] [--vector <commaNumbers>] [--pack <pack>] [--status <canonical|observed|synthesized>] [--asOf ISO]
  mem search-around --kind entities|facts|content --root <entityId> [--q <query>] [--vector <commaNumbers>] [--pack <pack>] [--status <canonical|observed|synthesized>] [--depth N] [--asOf ISO]
  mem resolve --entity <id> [--asOf ISO] [--pack <pack>] [--persist true]

  mem pool post --pack <pack> --instanceId <id> --topic <text> [--action start|update|complete|block|unblock] [--summary <md>] [--affects k1,k2] [--applyResolution true|false]
  mem pool claim --pack <pack> --instanceId <id> (--workItemId <ent_...> | --topic <text>) [--ttlSeconds N] [--applyResolution true|false]
  mem pool release --pack <pack> --instanceId <id> --workItemId <ent_...> [--applyResolution true|false]
  mem pool snapshot --pack <pack> [--status open|blocked|done|all] [--asOf ISO] [--limit N]

  mem vectors upsert --id <id> --kind entity|edge|event|content|custom [--pack <pack>] --embedding <commaNumbers> [--tags k=v,...]
  mem vectors search --embedding <commaNumbers> [--topK N] [--filterPack <pack>] [--filterKind <kind>]

  mem packs
  mem pack get --name <name>
  mem pack create --name <name> [--template coding_assistant|identity_verifier]

Env:
  MEMDB_API_URL (default: http://localhost:8787)
`);
};

const parseArgs = (argv: readonly string[]) => {
  const flags: Record<string, string> = {};
  const pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      flags[k] = v;
    } else {
      pos.push(a);
    }
  }
  return { flags, pos };
};

const tagsFrom = (s: string | undefined): Record<string, string> => {
  if (!s) return {};
  const out: Record<string, string> = {};
  for (const part of s.split(",")) {
    const [k, ...rest] = part.split("=");
    const v = rest.join("=");
    if (!k) continue;
    out[k.trim()] = (v ?? "").trim();
  }
  return out;
};

const refsFrom = (s: string | undefined): Array<{ kind: string; id: string }> => {
  if (!s) return [];
  return s.split(",").filter(Boolean).map((p) => {
    const [kind, id] = p.split(":");
    if (!kind || !id) throw new Error("refs must be kind:id,kind:id");
    return { kind, id };
  });
};



const embeddingFrom = (s: string | undefined): number[] => {
  if (!s) throw new Error("missing embedding");
  const parts = s.split(",").map((x) => x.trim()).filter(Boolean);
  const out = parts.map((x) => Number(x));
  if (out.some((n) => Number.isNaN(n))) throw new Error("embedding must be comma-separated numbers");
  return out;
};
const getJson = async <T>(path: string): Promise<T> => {
  const res = await fetch(new URL(path, apiBase));
  const txt = await res.text();
  if (!res.ok) throw new Error(txt || `HTTP ${res.status}`);
  return JSON.parse(txt) as T;
};

const parseTagsFlag = (s: string | undefined): Record<string, string> | null => {
  if (!s) return null;
  const out: Record<string, string> = {};
  for (const part of String(s).split(",")) {
    const p = part.trim();
    if (!p) continue;
    const i = p.indexOf("=");
    if (i <= 0) continue;
    out[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  }
  return Object.keys(out).length ? out : null;
};

const postJson = async <T>(path: string, body: unknown): Promise<T> => {
  const res = await fetch(new URL(path, apiBase), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(txt || `HTTP ${res.status}`);
  return JSON.parse(txt) as T;
};

const main = async () => {
  const argv = Deno.args;
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    usage();
    Deno.exit(0);
  }

  const cmd = argv[0];
  const { flags, pos } = parseArgs(argv.slice(1));

  try {
    if (cmd === "init") {
      const r = await postJson("/v1/init", {});
      console.log(JSON.stringify(r, null, 2));
      return;
    }

    if (cmd === "index") {
      const r = await postJson("/v1/index", {});
      console.log(JSON.stringify(r, null, 2));
      return;
    }

    if (cmd === "add-entity") {
      const r = await postJson("/v1/entities", {
        pack: flags.pack,
        type: flags.type,
        key: flags.key,
        tags: tagsFrom(flags.tags),
      });
      console.log(JSON.stringify(r, null, 2));
      return;
    }

    if (cmd === "add-event") {
      const r = await postJson("/v1/events", {
        pack: flags.pack,
        kind: flags.kind,
        agentId: flags.agentId,
        refs: refsFrom(flags.refs),
        tags: tagsFrom(flags.tags),
      });
      console.log(JSON.stringify(r, null, 2));
      return;
    }

    if (cmd === "add-edge") {
      const r = await postJson("/v1/edges", {
        pack: flags.pack,
        predicate: flags.predicate,
        s: flags.s,
        o: flags.o,
        sourceEventId: flags.sourceEventId,
        validFrom: flags.validFrom,
        confidence: flags.confidence ? Number(flags.confidence) : undefined,
        tags: tagsFrom(flags.tags),
      });
      console.log(JSON.stringify(r, null, 2));
      return;
    }

    if (cmd === "retract-edge") {
      const r = await postJson("/v1/edges/retract", {
        pack: flags.pack,
        predicate: flags.predicate,
        s: flags.s,
        o: flags.o,
        sourceEventId: flags.sourceEventId,
        validTo: flags.validTo,
        confidence: flags.confidence ? Number(flags.confidence) : undefined,
        tags: tagsFrom(flags.tags),
      });
      console.log(JSON.stringify(r, null, 2));
      return;
    }

    if (cmd === "neighbors") {
      const entity = flags.entity;
      if (!entity) throw new Error("missing --entity");
      const asOf = flags.asOf ?? new Date().toISOString();
      const pack = flags.pack ? `&pack=${encodeURIComponent(flags.pack)}` : "";
      const r = await getJson(`/v1/neighbors?entityId=${encodeURIComponent(entity)}&asOf=${encodeURIComponent(asOf)}${pack}`);
      console.log(JSON.stringify(r, null, 2));
      return;
    }

    if (cmd === "path") {
      if (!flags.from || !flags.to) throw new Error("missing --from/--to");
      const asOf = flags.asOf ?? new Date().toISOString();
      const pack = flags.pack ? `&pack=${encodeURIComponent(flags.pack)}` : "";
      const maxDepth = flags.maxDepth ? `&maxDepth=${encodeURIComponent(flags.maxDepth)}` : "";
      const r = await getJson(`/v1/path?from=${encodeURIComponent(flags.from)}&to=${encodeURIComponent(flags.to)}&asOf=${encodeURIComponent(asOf)}${pack}${maxDepth}`);
      console.log(JSON.stringify(r, null, 2));
      return;
    }

    if (cmd === "timeline") {
      const entity = flags.entity;
      if (!entity) throw new Error("missing --entity");
      const r = await getJson(`/v1/timeline?entityId=${encodeURIComponent(entity)}`);
      console.log(JSON.stringify(r, null, 2));
      return;
    }

    if (cmd === "health") {
      const entity = flags.entity;
      if (!entity) throw new Error("missing --entity");
      const asOf = flags.asOf ?? new Date().toISOString();
      const pack = flags.pack ? `&pack=${encodeURIComponent(flags.pack)}` : "";
      const r = await getJson(`/v1/health?entityId=${encodeURIComponent(entity)}&asOf=${encodeURIComponent(asOf)}${pack}`);
      console.log(JSON.stringify(r, null, 2));
      return;
    }

    if (cmd === "maintain") {
      const entity = flags.entity;
      if (!entity) throw new Error("missing --entity");
      const r = await postJson("/v1/maintain", {
        entityId: entity,
        pack: flags.pack ?? null,
        asOf: flags.asOf ?? new Date().toISOString(),
      });
      console.log(JSON.stringify(r, null, 2));
      return;
    }

    if (cmd === "maintain-all") {
      const r = await postJson("/v1/maintain-all", {
        pack: flags.pack ?? "",
        allPacks: (flags.allPacks ?? "false") === "true",
        asOf: flags.asOf ?? new Date().toISOString(),
      });
      console.log(JSON.stringify(r, null, 2));
      return;
    }

    if (cmd === "report") {
      const r = await postJson("/v1/report", {
        pack: flags.pack ?? "",
        allPacks: (flags.allPacks ?? "false") === "true",
        asOf: flags.asOf ?? new Date().toISOString(),
        format: flags.format ?? "json",
      });
      if ((flags.format ?? "json") === "md" || (flags.format ?? "json") === "markdown") {
        console.log(String((r as any).markdown ?? ""));
      } else {
        console.log(JSON.stringify(r, null, 2));
      }
      return;
    }

if (cmd === "add-content") {
  const r = await postJson("/v1/content", {
    pack: flags.pack ?? "",
    mime: flags.mime,
    source: flags.source,
    uri: flags.uri,
    text: flags.text,
    base64: flags.base64,
    excerpt: flags.excerpt,
    tags: tagsFrom(flags.tags),
  });
  console.log(JSON.stringify(r, null, 2));
  return;
}

if (cmd === "search") {
  const q = flags.q ?? "";
  const kind = flags.kind ?? "entities";
  const pack = flags.pack ? `&pack=${encodeURIComponent(flags.pack)}` : "";
  const r = await getJson(`/v1/search?kind=${encodeURIComponent(kind)}&q=${encodeURIComponent(q)}${pack}`);
  console.log(JSON.stringify(r, null, 2));
  return;
}

if (cmd === "search-hybrid") {
  const kind = flags.kind ?? "facts";
  const body = {
    kind,
    pack: flags.pack ?? null,
    status: flags.status ?? null,
    asOf: flags.asOf ?? null,
    q: flags.q ?? "",
    vector: flags.vector ? embeddingFrom(flags.vector) : null,
    filterTags: parseTagsFlag(flags.filterTags),
  };
  const r = await postJson("/v1/search/hybrid", body);
  console.log(JSON.stringify(r, null, 2));
  return;
}

if (cmd === "search-around") {
  const kind = flags.kind ?? "facts";
  const root = flags.root;
  if (!root) throw new Error("missing --root <entityId>");
  const body = {
    kind,
    rootEntityId: root,
    pack: flags.pack ?? null,
    status: flags.status ?? null,
    asOf: flags.asOf ?? null,
    depth: flags.depth ? Number(flags.depth) : null,
    q: flags.q ?? "",
    vector: flags.vector ? embeddingFrom(flags.vector) : null,
    filterTags: parseTagsFlag(flags.filterTags),
    limit: flags.limit ? Number(flags.limit) : null,
  };
  const r = await postJson("/v1/search/around", body);
  console.log(JSON.stringify(r, null, 2));
  return;
}

if (cmd === "resolve") {
  const entity = flags.entity;
  if (!entity) throw new Error("missing --entity");
  const r = await postJson("/v1/resolve", {
    entityId: entity,
    pack: flags.pack ?? null,
    asOf: flags.asOf ?? new Date().toISOString(),
    persist: (flags.persist ?? "false") === "true",
  });
  console.log(JSON.stringify(r, null, 2));
  return;
}

if (cmd === "pool" && pos[0] === "post") {
  const pack = flags.pack;
  const instanceId = flags.instanceId;
  const topic = flags.topic;
  if (!pack) throw new Error("missing --pack");
  if (!instanceId) throw new Error("missing --instanceId");
  if (!topic) throw new Error("missing --topic");
  const affects = (flags.affects ? String(flags.affects).split(",").map((x) => x.trim()).filter(Boolean) : [])
    .map((key) => ({ key }));
  const body = {
    pack,
    instanceId,
    topic,
    action: flags.action ?? "update",
    summary: flags.summary ?? "",
    affects,
    applyResolution: (flags.applyResolution ?? "true") === "true",
    confidence: flags.confidence ? Number(flags.confidence) : null,
  };
  const r = await postJson("/v1/pool/post", body);
  console.log(JSON.stringify(r, null, 2));
  return;
}

if (cmd === "pool" && pos[0] === "claim") {
  const pack = flags.pack;
  const instanceId = flags.instanceId;
  const workItemId = flags.workItemId;
  const topic = flags.topic;
  if (!pack) throw new Error("missing --pack");
  if (!instanceId) throw new Error("missing --instanceId");
  if (!workItemId && !topic) throw new Error("missing --workItemId or --topic");
  const body = {
    pack,
    instanceId,
    workItemId: workItemId ?? null,
    topic: topic ?? null,
    ttlSeconds: flags.ttlSeconds ? Number(flags.ttlSeconds) : null,
    applyResolution: (flags.applyResolution ?? "true") === "true",
  };
  const r = await postJson("/v1/pool/claim", body);
  console.log(JSON.stringify(r, null, 2));
  return;
}

if (cmd === "pool" && pos[0] === "release") {
  const pack = flags.pack;
  const instanceId = flags.instanceId;
  const workItemId = flags.workItemId;
  if (!pack) throw new Error("missing --pack");
  if (!instanceId) throw new Error("missing --instanceId");
  if (!workItemId) throw new Error("missing --workItemId");
  const body = {
    pack,
    instanceId,
    workItemId,
    applyResolution: (flags.applyResolution ?? "true") === "true",
  };
  const r = await postJson("/v1/pool/release", body);
  console.log(JSON.stringify(r, null, 2));
  return;
}

if (cmd === "pool" && pos[0] === "snapshot") {
  const pack = flags.pack;
  if (!pack) throw new Error("missing --pack");
  const body = {
    pack,
    asOf: flags.asOf ?? null,
    status: flags.status ?? "open",
    limit: flags.limit ? Number(flags.limit) : null,
  };
  const r = await postJson("/v1/pool/snapshot", body);
  console.log(JSON.stringify(r, null, 2));
  return;
}

if (cmd === "vectors" && pos[0] === "upsert") {
  const id = flags.id;
  if (!id) throw new Error("missing --id");
  const kind = flags.kind ?? "custom";
  const emb = embeddingFrom(flags.embedding);
  const r = await postJson("/v1/vectors/upsert", {
    id,
    kind,
    pack: flags.pack,
    embedding: emb,
    tags: tagsFrom(flags.tags),
  });
  console.log(JSON.stringify(r, null, 2));
  return;
}

if (cmd === "vectors" && pos[0] === "search") {
  const emb = embeddingFrom(flags.embedding);
  const r = await postJson("/v1/vectors/search", {
    query: emb,
    topK: flags.topK ? Number(flags.topK) : 10,
    filter: {
      pack: flags.filterPack,
      kind: flags.filterKind,
    },
  });
  console.log(JSON.stringify(r, null, 2));
  return;
}

    if (cmd === "packs") {
      const r = await getJson("/v1/packs");
      console.log(JSON.stringify(r, null, 2));
      return;
    }

    if (cmd === "pack" && pos[0] === "get") {
      const name = flags.name;
      if (!name) throw new Error("missing --name");
      const r = await getJson(`/v1/packs/${encodeURIComponent(name)}`);
      console.log(JSON.stringify(r, null, 2));
      return;
    }

    if (cmd === "pack" && pos[0] === "create") {
      const name = flags.name;
      if (!name) throw new Error("missing --name");
      const r = await postJson("/v1/packs", { name, template: flags.template });
      console.log(JSON.stringify(r, null, 2));
      return;
    }

    console.error(`Unknown command: ${cmd}`);
    usage();
    Deno.exit(2);
  } catch (e) {
    console.error(String((e as any)?.message ?? e));
    Deno.exit(1);
  }
};

await main();
