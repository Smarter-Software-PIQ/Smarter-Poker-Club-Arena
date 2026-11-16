export type DealPath = [number, number, number, number, number];
export interface SharedDeal {
  at: number;
  flightMs: number;
  paths: DealPath[];
}
export function readSharedDeal(value: unknown): SharedDeal | undefined {
  if (!value || typeof value !== 'object') return;
  const { at, flightMs, paths } = value as SharedDeal;
  if (
    !Number.isSafeInteger(at) ||
    at < 0 ||
    at > 86400000 ||
    !Number.isFinite(flightMs) ||
    flightMs < 1 ||
    flightMs > 60000 ||
    !Array.isArray(paths) ||
    !paths.length ||
    paths.length > 60
  )
    return;
  if (
    !paths.every(
      (path) =>
        Array.isArray(path) &&
        path.length === 5 &&
        path.slice(0, 4).every((n) => Number.isFinite(n) && n >= -100 && n <= 200) &&
        Number.isFinite(path[4]) &&
        path[4] >= 0 &&
        path[4] <= 60000
    )
  )
    return;
  return { at, flightMs, paths };
}
