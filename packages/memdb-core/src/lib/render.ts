export type Tmpl = Readonly<{ raw: string }>;

export const compile = (raw: string): Tmpl => ({ raw });

export const render = (t: Tmpl, vars: Readonly<Record<string, string>>): string => {
  // tiny mustache-ish: {{key}}
  return t.raw.replaceAll(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_m, k) => vars[k] ?? "");
};
