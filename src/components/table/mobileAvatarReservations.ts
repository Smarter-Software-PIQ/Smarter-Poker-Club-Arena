import { derivePositions } from '../../utils/pokerPositions';
import { dealerButtonPositionClearOfSeat } from './DealerButton';
import { chipRadiusWidthPct, FELT_WINDOW, seatPodPx, type Pos, type Size } from './tableGeometry';

export type ReservationBox = { left: number; top: number; width: number; height: number };

/** Private hero cards, including the row-level peek and per-card deal/mark
 * transforms. seatLeft/Top are viewport coordinates BEFORE the six-card seat
 * shift; all dimensions except these two coordinates are unscaled CSS pixels.
 * Revealed rows, card-flight paths and decorative shadows are separate. */
export function heroPrivateReservations(input: {
  seatLeft: number;
  seatTop: number;
  seatWidth: number;
  seatHeight: number;
  avatarSize: number;
  plateMinWidth: number;
  tableWidth: number;
  viewportWidth: number;
  heroClear: number;
  barInset: number;
  boardCardWidth?: number;
  scale: number;
  counts?: readonly number[];
}): { boxes: Array<ReservationBox & { count: number; index: number }>; maxSixShift: number } {
  const p = Math.max(input.plateMinWidth, (input.avatarSize * 8) / 7);
  const w = Math.min(
    Math.max(50, Math.min(input.tableWidth * 0.139, 100)),
    (input.viewportWidth - p - 36) / 4.5
  );
  const board = input.boardCardWidth ?? w;
  const counts = [...new Set(input.counts ?? [2, 3, 4, 5, 6])].filter(
    (count) => Number.isInteger(count) && count >= 2 && count <= 6
  );
  const maxSixShift = counts.includes(6)
    ? Math.max(0, p / 2 + 12 + board * 3.25 - input.viewportWidth / 2)
    : 0;
  const cy = (input.seatHeight / 2 + input.heroClear + input.barInset) / 2;
  const boxes: Array<ReservationBox & { count: number; index: number }> = [];
  for (const count of counts) {
    const [width, height, step] =
      count === 6
        ? [board, (board * 92) / 64, board * 0.45]
        : count === 5
          ? [w * 0.8, w * 1.12, w * 0.36]
          : count === 4
            ? [w, w * 1.4, w * 0.45]
            : [w, w * 1.4, w * 0.72];
    const rowWidth = width + (count - 1) * step;
    const rowLeft = input.seatWidth + 8 - (count === 6 ? maxSixShift : 0);
    // cardPeekLift transforms the ROW about its default 50% 50% origin.
    // Reserving each card about its own centre would miss the outer cards.
    const rowCentre = rowLeft + rowWidth / 2;
    for (let index = 0; index < count; index++) {
      const left = rowLeft + index * step,
        right = left + width;
      const l = Math.min(left, rowCentre + (left - rowCentre) * 1.03);
      const r = Math.max(right, rowCentre + (right - rowCentre) * 1.03);
      // Deal shrinks about bottom centre and translates down14; marking lifts
      // a card6; row peek lifts8 and scales1.03. Include simultaneous poses.
      const top = cy - (height * 1.03) / 2 - 6 * 1.03 - 8;
      const bottom = cy + (height * 1.03) / 2 + 14 * 1.03;
      boxes.push({
        count,
        index,
        left: input.seatLeft + l * input.scale,
        top: input.seatTop + top * input.scale,
        width: (r - l) * input.scale,
        height: (bottom - top) * input.scale,
      });
    }
  }
  return { boxes, maxSixShift };
}
// Mirrors SeatSlot.tsx VILLAIN_FAN; CSS rotates each back about 50% 120%.
const FANS = [
  [0.3, 0],
  [0.3, 7],
  [0.18, 10],
  [0.14, 12],
  [0.13, 12],
  [0.12, 12],
];

/** Reserve labels reachable on this fixed ring, including a dead button. */
export function mobilePositionLabels(seatCount: number, occupiedCount = seatCount): string[] {
  const count = Math.min(seatCount, Math.max(0, occupiedCount));
  const seats = Array.from({ length: count }, (_, index) => index + 1);
  return [
    ...new Set([
      ...Object.values(derivePositions(seats, 1)),
      ...Object.values(derivePositions(count < seatCount ? seats : seats.slice(0, -1), seatCount)),
    ]),
  ].filter((label) => label !== 'D' && label !== 'BTN');
}

/** Stable variant counts, including Pineapple's retained discard flight. */
export function hiddenFanStates(cardCount: number): Array<{ count: number; discard: boolean }> {
  if (cardCount === 3)
    return [
      { count: 3, discard: false },
      { count: 2, discard: true },
      { count: 2, discard: false },
    ];
  return Number.isInteger(cardCount) && cardCount >= 2 && cardCount <= 6
    ? [{ count: cardCount, discard: false }]
    : [];
}

/** Settled backs only. Each returned box remains a separate own-layer test.
 * Coordinates and avatarSize/wrapOverlap are unscaled CSS pixels; scale maps
 * their deltas into the viewport. Flights are not certified by this helper. */
export function hiddenFanReservations(input: {
  seatLeft: number;
  seatTop: number;
  seatWidth: number;
  avatarSize: number;
  wrapOverlap: number;
  scale: number;
  side: 'left' | 'right';
  count: number;
  discard?: boolean;
}): ReservationBox[] {
  const { avatarSize: a, wrapOverlap, scale, count } = input;
  if (!Number.isInteger(count) || count < 1 || count > 6 || !(scale > 0)) return [];
  const [step, degrees] = FANS[count - 1];
  const n = count + Number(Boolean(input.discard));
  const h = Math.max(17, a * 0.346),
    w = (h * 2) / 3;
  const cx = input.seatWidth / 2;
  const top = a - wrapOverlap - 1 - h;
  return Array.from({ length: n }, (_, i) => {
    const left =
      input.side === 'right'
        ? cx + a / 2 - 0.8 * w + i * step * w
        : cx - a / 2 + 0.8 * w - w - i * step * w;
    const angle = ((i - (n - 1) / 2) * degrees * (input.side === 'right' ? 1 : -1) * Math.PI) / 180;
    const px = left + w / 2,
      py = top + h * 1.2;
    const corners = [
      [left, top],
      [left + w, top],
      [left, top + h],
      [left + w, top + h],
    ].map(([x, y]) => ({
      x: px + (x - px) * Math.cos(angle) - (y - py) * Math.sin(angle),
      y: py + (x - px) * Math.sin(angle) + (y - py) * Math.cos(angle),
    }));
    const l = Math.min(...corners.map((p) => p.x)),
      t = Math.min(...corners.map((p) => p.y));
    return {
      left: input.seatLeft + l * scale,
      top: input.seatTop + t * scale,
      width: (Math.max(...corners.map((p) => p.x)) - l) * scale,
      height: (Math.max(...corners.map((p) => p.y)) - t) * scale,
    };
  });
}

const cross = (a: Pos, b: Pos, c: Pos) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
function hull(points: Pos[]): Pos[] {
  const sorted = points.sort((a, b) => a.x - b.x || a.y - b.y);
  const half = (list: Pos[]) => {
    const result: Pos[] = [];
    for (const p of list) {
      while (
        result.length > 1 &&
        cross(result[result.length - 2], result[result.length - 1], p) <= 0
      )
        result.pop();
      result.push(p);
    }
    return result;
  };
  return [...half(sorted).slice(0, -1), ...half([...sorted].reverse()).slice(0, -1)];
}

/** Cash portrait 481–768px: all owners, all marker candidates, and the
 * straight-line glide between them. Four-pixel strips cover the expanded
 * convex hull without reserving its entire enclosing rectangle. */
/** The dealer button's preferred spot beside each chair, one box per anchor.
 * The puck draws above every seat (z-index 15 over the wrapper's 10) and its
 * placement already avoids painted art, so this only keeps its first choice
 * clear of a face. */
export function dealerSeatReservations(input: {
  canvas: ReservationBox;
  scale: number;
  anchors: readonly Pos[];
  dealerSize: number;
  viewportWidth: number;
  scalerSize: Size;
}): ReservationBox[] {
  const { canvas: c, scale, anchors, dealerSize, viewportWidth } = input;
  if (
    viewportWidth <= 480 ||
    viewportWidth > 768 ||
    !(scale > 0) ||
    !(dealerSize > 0) ||
    !anchors.length
  )
    return [];
  const size = input.scalerSize;
  const r = dealerSize / 2 + 2 * scale;
  return anchors.map((pos) => {
    const p = dealerButtonPositionClearOfSeat(
      pos,
      size,
      seatPodPx(viewportWidth, pos.y >= 100 && pos.x === 50, size.w),
      anchors
    );
    const x = c.left + (p.x * c.width) / 100,
      y = c.top + (p.y * c.height) / 100;
    return { left: x - r, top: y - r, width: 2 * r, height: 2 * r };
  });
}

export function dealerReservations(input: {
  canvas: ReservationBox;
  scale: number;
  anchors: readonly Pos[];
  dealerSize: number;
  viewportWidth: number;
  scalerSize: Size;
  /** Only the rim band, without the chair spots (dealerSeatReservations). */
  bandOnly?: boolean;
}): ReservationBox[] {
  const { canvas: c, scale, anchors, dealerSize, viewportWidth } = input;
  if (
    viewportWidth <= 480 ||
    viewportWidth > 768 ||
    !(scale > 0) ||
    !(dealerSize > 0) ||
    !anchors.length
  )
    return [];
  // DealerButton measures clientWidth/clientHeight, while the hook's marker
  // candidates use the rendered scaler box. Preserve that distinction.
  const size = input.scalerSize;
  const centers = input.bandOnly
    ? []
    : anchors.map((pos) => {
        const p = dealerButtonPositionClearOfSeat(
          pos,
          size,
          seatPodPx(viewportWidth, pos.y >= 100 && pos.x === 50, size.w),
          anchors
        );
        return { x: c.left + (p.x * c.width) / 100, y: c.top + (p.y * c.height) / 100 };
      });
  const inset =
    (chipRadiusWidthPct({ w: c.width, h: c.height, portraitTaper: 0 }) * c.width) / 100 + 3;
  const radius = (FELT_WINDOW.width * c.width) / 200 - inset;
  const cx = ((FELT_WINDOW.left + FELT_WINDOW.width / 2) * c.width) / 100;
  const upper = (FELT_WINDOW.top * c.height) / 100 + (FELT_WINDOW.width * c.width) / 200;
  const lower =
    ((FELT_WINDOW.top + FELT_WINDOW.height) * c.height) / 100 - (FELT_WINDOW.width * c.width) / 200;
  // The marker band: dealer puck and chip rests live in the outer 52 px of
  // the felt. The deeper rungs (64 to 100 px) reserved felt no marker rests
  // on and walled every mid-rail portrait (measured 2026-11-12).
  for (const extra of [0, 10, 20, 28, 36, 44, 52]) {
    const band = radius - extra;
    for (let angle = 0; angle < 360; angle += 2) {
      const a = (angle * Math.PI) / 180;
      centers.push({
        x: c.left + cx + Math.cos(a) * band,
        y: c.top + (Math.sin(a) < 0 ? upper : lower) + Math.sin(a) * band,
      });
    }
    for (let y = upper; y <= lower; y += 3) {
      centers.push(
        { x: c.left + cx - band, y: c.top + y },
        { x: c.left + cx + band, y: c.top + y }
      );
    }
  }
  const r = dealerSize / 2;
  const polygon = hull(
    centers.flatMap((p) => [-r, r].flatMap((x) => [-r, r].map((y) => ({ x: p.x + x, y: p.y + y }))))
  );
  const result: ReservationBox[] = [];
  const minY = Math.min(...polygon.map((p) => p.y)),
    maxY = Math.max(...polygon.map((p) => p.y));
  for (let top = minY; top < maxY; top += 4) {
    const bottom = Math.min(top + 4, maxY),
      xs: number[] = [];
    polygon.forEach((a, i) => {
      const b = polygon[(i + 1) % polygon.length];
      if (a.y >= top && a.y <= bottom) xs.push(a.x);
      for (const y of [top, bottom])
        if (a.y !== b.y && y >= Math.min(a.y, b.y) && y <= Math.max(a.y, b.y))
          xs.push(a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y));
    });
    if (xs.length)
      result.push({
        left: Math.min(...xs),
        top,
        width: Math.max(...xs) - Math.min(...xs),
        height: bottom - top,
      });
  }
  return result;
}
