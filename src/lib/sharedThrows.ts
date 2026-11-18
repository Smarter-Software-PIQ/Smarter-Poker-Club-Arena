/** Rendered effects only. No chat messages, account identifiers or inventory are shared. */
export type SharedThrow = [offsetMs: number, from: number, to: number, item: string, seed: number];

export function readSharedThrows(value: unknown): SharedThrow[] | undefined {
  if (!Array.isArray(value) || !value.length || value.length > 256) return;
  const whole = (v: unknown, min: number, max: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
  let previous = 0;
  const result: SharedThrow[] = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 5) return;
    const [at, from, to, item, seed] = entry;
    if (
      !whole(at, previous, 86400000) ||
      !whole(from, 1, 10) ||
      !whole(to, 1, 10) ||
      typeof item !== 'string' ||
      !/^[a-z0-9_-]{1,64}$/.test(item) ||
      !whole(seed, 0, 0xffffffff)
    )
      return;
    previous = at;
    result.push([at, from, to, item, seed]);
  }
  return result;
}

export function throwSeed(id: string) {
  let seed = 2166136261;
  for (let i = 0; i < id.length; i++) seed = Math.imul(seed ^ id.charCodeAt(i), 16777619);
  return seed >>> 0;
}

export function particleRandom(seed: number) {
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
