type Labels = Readonly<Record<string, string>>;

const keyOf = (name: string, labels: Labels): string => {
  const parts = Object.entries(labels).sort(([a],[b]) => a.localeCompare(b));
  const suffix = parts.map(([k,v]) => `${k}="${String(v).replace(/"/g, '\"')}"`).join(",");
  return suffix ? `${name}{${suffix}}` : name;
};

const counters = new Map<string, number>();

export const inc = (name: string, labels: Labels = {}, by = 1): void => {
  const k = keyOf(name, labels);
  counters.set(k, (counters.get(k) ?? 0) + by);
};

export const setGauge = (name: string, labels: Labels = {}, value = 0): void => {
  const k = keyOf(name, labels);
  counters.set(k, value);
};

export const renderProm = (): string => {
  const lines: string[] = [];
  // minimal format: just emit all series as "name{...} value"
  for (const [k, v] of Array.from(counters.entries()).sort(([a],[b]) => a.localeCompare(b))) {
    lines.push(`${k} ${v}`);
  }
  return lines.join("\n") + "\n";
};
