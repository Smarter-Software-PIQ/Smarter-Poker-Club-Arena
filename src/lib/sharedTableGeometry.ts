export interface SharedTableGeometry {
  width: number;
  height: number;
  seats: [number, number][];
}

export function readTableGeometry(value: unknown): SharedTableGeometry | undefined {
  if (!value || typeof value !== 'object') return;
  const { width, height, seats } = value as SharedTableGeometry;
  const inRange = (n: unknown, lo: number, hi: number) =>
    typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi;
  if (
    !inRange(width, 1, 16384) ||
    !inRange(height, 1, 16384) ||
    !Array.isArray(seats) ||
    seats.length < 2 ||
    seats.length > 10 ||
    !seats.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => inRange(n, -100, 200)))
  )
    return;
  return { width, height, seats: seats.map(([x, y]) => [x, y]) };
}

export function captureTableGeometry(
  element: HTMLElement | null,
  seats: { x: number; y: number }[]
) {
  if (!element) return;
  return readTableGeometry({
    width: element.clientWidth,
    height: element.clientHeight,
    seats: seats.map(({ x, y }) => [Number(x.toFixed(4)), Number(y.toFixed(4))]),
  });
}
