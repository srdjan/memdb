export const isActiveAt = (validFromIso: string, validToIso: string | null, tIso: string): boolean => {
  const vf = Date.parse(validFromIso);
  const t = Date.parse(tIso);
  const vt = validToIso ? Date.parse(validToIso) : Number.POSITIVE_INFINITY;
  return vf <= t && t < vt;
};
