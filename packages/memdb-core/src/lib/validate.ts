import type { Pack } from "./model.ts";

export type ValidationErr = Readonly<{ msg: string }>;

const hasTag = (tags: Record<string, string>, k: string): boolean =>
  Object.prototype.hasOwnProperty.call(tags, k);

export const validateEntityAgainstPack = (pack: Pack, type: string, tags: Record<string, string>): ValidationErr[] => {
  const errs: ValidationErr[] = [];
  if (!pack.entityTypes.includes(type)) errs.push({ msg: `Entity type '${type}' not allowed by pack '${pack.name}'.` });
  for (const req of pack.policy.requiredTags) {
    if (!hasTag(tags, req)) errs.push({ msg: `Missing required tag '${req}' for pack '${pack.name}'.` });
  }
  return errs;
};

export const validateEventAgainstPack = (pack: Pack, kind: string, tags: Record<string, string>): ValidationErr[] => {
  const errs: ValidationErr[] = [];
  if (!(pack.eventKinds.includes(kind) || kind.startsWith("sys/"))) errs.push({ msg: `Event kind '${kind}' not allowed by pack '${pack.name}'.` });
  for (const req of pack.policy.requiredTags) {
    if (!hasTag(tags, req)) errs.push({ msg: `Missing required tag '${req}' for pack '${pack.name}'.` });
  }
  return errs;
};

export const validateEdgeAgainstPack = (pack: Pack, predicate: string, tags: Record<string, string>): ValidationErr[] => {
  const errs: ValidationErr[] = [];
  if (!(pack.predicates.includes(predicate) || predicate.startsWith("synth/"))) errs.push({ msg: `Predicate '${predicate}' not allowed by pack '${pack.name}'.` });
  for (const req of pack.policy.requiredTags) {
    if (!hasTag(tags, req)) errs.push({ msg: `Missing required tag '${req}' for pack '${pack.name}'.` });
  }
  return errs;
};
