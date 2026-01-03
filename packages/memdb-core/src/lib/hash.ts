const hex = (bytes: Uint8Array): string =>
  [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

export const sha256Hex = async (s: string): Promise<string> => {
  const bytes = new TextEncoder().encode(s);
  const dig = await crypto.subtle.digest("SHA-256", bytes);
  return hex(new Uint8Array(dig));
};

export const edgeKeyOf = async (predicate: string, s: string, o: string): Promise<string> =>
  await sha256Hex(`${predicate}:${s}:${o}`);
