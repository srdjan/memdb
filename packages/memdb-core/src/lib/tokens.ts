const STOP = new Set([
  "the","a","an","and","or","but","to","of","in","on","for","with","as","at","by",
  "is","are","was","were","be","been","it","this","that","these","those",
  "from","into","over","under","then","than","so","if","else","when","while",
]);

export const tokenize = (s: string): readonly string[] => {
  const raw = s
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, " ")
    .trim();
  if (!raw) return [];
  const toks = raw.split(/\s+/g).filter((t) => t && !STOP.has(t));
  // stable: de-dupe while preserving order
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of toks) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
};

export const overlapScore = (a: readonly string[], b: readonly string[]): number => {
  const setA = new Set(a);
  let c = 0;
  for (const t of b) if (setA.has(t)) c++;
  return c;
};
