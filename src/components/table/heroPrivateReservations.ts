import type { ReservationBox } from './mobileAvatarReservations';

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
function cssLength(element: HTMLElement, name: string, fallback: number) {
  const raw = getComputedStyle(element).getPropertyValue(name).trim();
  if (!raw) return fallback;
  if (/^[-+\d.]+px$/.test(raw)) return parseFloat(raw);
  // Let CSS resolve calc/max/clamp/viewport and safe-area units. This invisible
  // measurement is performed once per asset/layout qualification, not per turn.
  const probe = document.createElement('span');
  probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;width:0;height:var(${name},${fallback}px)`;
  element.append(probe);
  const value = parseFloat(getComputedStyle(probe).height);
  probe.remove();
  return Number.isFinite(value) ? value : fallback;
}

export function privateCardLane(
  scaler: HTMLElement,
  page: HTMLElement,
  seat: HTMLElement,
  ratio: number
) {
  const avatar = seat.querySelector<HTMLElement>('.seat__avatar-wrap');
  if (!avatar) return { boxes: [], maxSixShift: 0 };
  const rect = seat.getBoundingClientRect();
  return heroPrivateReservations({
    counts:
      Number(page.dataset.holeCardCount) === 3 ? [2, 3] : [Number(page.dataset.holeCardCount)],
    seatLeft: rect.left,
    seatTop: rect.top,
    seatWidth: rect.width / ratio,
    seatHeight: rect.height / ratio,
    avatarSize: avatar.offsetWidth,
    plateMinWidth: cssLength(seat, '--seat-plate-min-width', rect.width / ratio),
    tableWidth: scaler.offsetWidth,
    viewportWidth: innerWidth,
    heroClear: cssLength(seat, '--sp-hero-clear', 60),
    barInset: cssLength(seat, '--sp-bar-inset', 0),
    boardCardWidth: cssLength(scaler, '--sp-board-card-w', scaler.offsetWidth * 0.088),
    scale: ratio,
  });
}
