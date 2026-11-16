export interface SharedTableGeometry {
  width: number;
  height: number;
  seats: [number, number][];
  // Original table-container and painted felt bounds, all in CSS pixels.
  layout?: {
    w: number;
    h: number;
    x: number;
    y: number;
    feltW: number;
    feltH: number;
    viewport: number;
  };
}

export function readTableGeometry(value: unknown): SharedTableGeometry | undefined {
  if (!value || typeof value !== 'object') return;
  const { width, height, seats, layout } = value as SharedTableGeometry;
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
  const original =
    layout &&
    [layout.w, layout.h, layout.feltW, layout.feltH, layout.viewport].every((n) =>
      inRange(n, 1, 16384)
    ) &&
    [layout.x, layout.y].every((n) => inRange(n, -16384, 16384))
      ? {
          w: layout.w,
          h: layout.h,
          x: layout.x,
          y: layout.y,
          feltW: layout.feltW,
          feltH: layout.feltH,
          viewport: layout.viewport,
        }
      : undefined;
  return {
    width,
    height,
    seats: seats.map(([x, y]) => [x, y]),
    ...(original ? { layout: original } : {}),
  };
}

export function captureTableGeometry(
  element: HTMLElement | null,
  seats: { x: number; y: number }[]
) {
  if (!element) return;
  const container = element.closest('.table-container')?.getBoundingClientRect();
  const felt = element.getBoundingClientRect();
  return readTableGeometry({
    layout: container && {
      w: container.width,
      h: container.height,
      x: felt.left - container.left,
      y: felt.top - container.top,
      feltW: felt.width,
      feltH: felt.height,
      viewport: element.ownerDocument.defaultView?.innerWidth,
    },
    width: element.clientWidth,
    height: element.clientHeight,
    seats: seats.map(({ x, y }) => [Number(x.toFixed(4)), Number(y.toFixed(4))]),
  });
}
