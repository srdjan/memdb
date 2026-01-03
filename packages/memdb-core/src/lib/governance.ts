import type { Pack, Tags, Entity, Edge, Event } from "./model.ts";

export const addDefaultRetention = (pack: Pack, tags: Record<string, string>): Record<string, string> => {
  if (!("retention_class" in tags)) {
    tags["retention_class"] = pack.policy.defaultRetentionClass;
  }
  return tags;
};

export const inferSensitiveTags = (pack: Pack, entityType: string, tags: Record<string, string>): Record<string, string> => {
  // conservative defaults; user can override explicitly via --tag pii=false/secret=false
  if (pack.name === "identity_verifier") {
    const piiTypes = new Set(["Subject","Document","BiometricCheck","Evidence"]);
    if (piiTypes.has(entityType) && !("pii" in tags)) tags["pii"] = "true";
  }
  if (pack.name === "coding_assistant") {
    const secretTypes = new Set(["Repo","File","Doc","Patch"]);
    if (secretTypes.has(entityType) && !("secret" in tags)) tags["secret"] = "false";
  }
  return tags;
};

export const matchForbiddenTag = (forbidden: readonly string[], tags: Tags): string | null => {
  for (const f of forbidden) {
    const i = f.indexOf("=");
    if (i < 0) continue;
    const k = f.slice(0, i);
    const v = f.slice(i + 1);
    if (tags[k] === v) return f;
  }
  return null;
};

export const mergeTags = (...parts: readonly (Tags | undefined)[]): Tags => {
  const out: Record<string, string> = {};
  for (const t of parts) {
    if (!t) continue;
    for (const [k, v] of Object.entries(t)) out[k] = v;
  }
  return out;
};

export const effectiveEventTags = (evt: Event, referencedEntities: readonly Entity[]): Tags => {
  // If any referenced entity has pii=true or secret=true, propagate to event for gating
  const derived: Record<string, string> = {};
  for (const ent of referencedEntities) {
    if (ent.tags.pii === "true") derived.pii = "true";
    if (ent.tags.secret === "true") derived.secret = "true";
  }
  return mergeTags(evt.tags, derived, { pack: evt.pack });
};

export const deriveTextForTarget = (targetKind: "entity" | "edge" | "event", obj: Entity | Edge | Event): string => {
  if (targetKind === "entity") {
    const e = obj as Entity;
    return `${e.type} ${e.key}`;
  }
  if (targetKind === "edge") {
    const e = obj as Edge;
    return `${e.predicate} ${e.s} ${e.o} validFrom=${e.validFrom} validTo=${e.validTo ?? "null"}`;
  }
  const e = obj as Event;
  const refs = e.refs.map((r) => `${r.kind}:${r.id}`).join(" ");
  return `${e.kind} agent=${e.agentId} refs=${refs}`;
};

export const sanitizePayload = (pack: Pack, payload: string, tags: Tags): string => {
  // If forbidden tags exist, we block earlier. This is best-effort cleanup.
  if (pack.name === "identity_verifier") {
    // remove obvious email/phone/long digit runs
    return payload
      .replaceAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "<email>")
      .replaceAll(/\b\d{3}[-.\s]?\d{2,3}[-.\s]?\d{4}\b/g, "<phone>")
      .replaceAll(/\b\d{4,}\b/g, "<num>");
  }
  return payload;
};
