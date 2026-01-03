const CROCKFORD32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ" as const;

const encode32 = (bytes: Uint8Array): string => {
  // encode arbitrary bytes into Crockford base32 (no padding)
  let out = "";
  let buffer = 0;
  let bits = 0;

  for (const b of bytes) {
    buffer = (buffer << 8) | b;
    bits += 8;
    while (bits >= 5) {
      const idx = (buffer >> (bits - 5)) & 31;
      bits -= 5;
      out += CROCKFORD32[idx];
    }
  }
  if (bits > 0) {
    const idx = (buffer << (5 - bits)) & 31;
    out += CROCKFORD32[idx];
  }
  return out;
};

const u48be = (n: number): Uint8Array => {
  const b = new Uint8Array(6);
  // Big-endian 48-bit
  b[0] = (n / 2 ** 40) & 0xff;
  b[1] = (n / 2 ** 32) & 0xff;
  b[2] = (n / 2 ** 24) & 0xff;
  b[3] = (n / 2 ** 16) & 0xff;
  b[4] = (n / 2 ** 8) & 0xff;
  b[5] = n & 0xff;
  return b;
};

export const ulid = (ms: number = Date.now()): string => {
  // ULID = 48-bit time + 80-bit randomness, Crockford base32 = 26 chars
  const time = u48be(ms);
  const rand = new Uint8Array(10);
  crypto.getRandomValues(rand);

  const bytes = new Uint8Array(16);
  bytes.set(time, 0);
  bytes.set(rand, 6);

  // ULID spec base32 encodes 128 bits into 26 chars; our encode32 yields 26-27 chars depending on bit packing.
  // To keep stable 26 chars, take first 26 chars.
  const s = encode32(bytes);
  return s.slice(0, 26);
};

export const makeId = (prefix: "ent" | "evt" | "edge"): string =>
  `${prefix}_${ulid()}`;

export const nowIso = (): string => new Date().toISOString();
