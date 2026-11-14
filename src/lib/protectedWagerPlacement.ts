import type { CardBox } from './protectedCardPlacement';

/** Native classic-green artwork has straight sides and elliptical caps. */
export function insideClassicGreen(box: CardBox, canvas: CardBox, air: number): boolean {
  const x0 = ((box.left - canvas.left - air) * 605) / canvas.width;
  const x1 = ((box.left + box.width - canvas.left + air) * 605) / canvas.width;
  const y0 = ((box.top - canvas.top - air) * 1000) / canvas.height;
  const y1 = ((box.top + box.height - canvas.top + air) * 1000) / canvas.height;
  const dx = Math.max(302.5 - x0, x1 - 302.5) / 199;
  const dy = Math.max(275 - y0, y1 - 725, 0) / 184;
  return dx * dx + dy * dy <= 1;
}

/** Nearest inward rest position before the decoded portrait/card pass takes
 * ownership. Keep the whole actual stack and its amount inside the rail. */
export function firstWagerOnFelt(
  box: CardBox,
  canvas: CardBox,
  felt: CardBox,
  air: number,
  gold: boolean,
  board?: CardBox
) {
  const radius = felt.width / 2,
    cx = felt.left + radius,
    cy = felt.top + felt.height / 2;
  const clear = (candidate: CardBox) => {
    const x = Math.max(cx - candidate.left, candidate.left + candidate.width - cx);
    const y = Math.max(
      felt.top + radius - candidate.top,
      candidate.top + candidate.height - (felt.top + felt.height - radius),
      0
    );
    return (
      Math.hypot(x, y) <= radius - air &&
      (!gold || insideClassicGreen(candidate, canvas, air)) &&
      (!board || !wagerBoxesOverlap(candidate, board))
    );
  };
  if (clear(box)) return box;
  // Fixed-height and fixed-width paths protect side and cap ownership. A
  // diagonal path also covers rounded corners. Slide above/below the board
  // if a side chair's direct path would run onto community cards.
  const middle = { left: cx - box.width / 2, top: cy - box.height / 2 };
  const targets = [{ ...middle, top: box.top }, { ...middle, left: box.left }, middle];
  if (board)
    for (const top of [board.top - box.height - 3, board.top + board.height + 3])
      targets.push({ ...middle, top });
  let best = box,
    distance = Infinity;
  for (const target of targets) {
    const dx = target.left - box.left,
      dy = target.top - box.top,
      length = Math.hypot(dx, dy);
    if (!length) continue;
    const steps = Math.ceil(length / 2);
    for (let i = 1; i <= steps && (length * i) / steps < distance; i++) {
      const candidate = {
        width: box.width,
        height: box.height,
        left: box.left + (dx * i) / steps,
        top: box.top + (dy * i) / steps,
      };
      if (clear(candidate)) {
        best = candidate;
        distance = (length * i) / steps;
        break;
      }
    }
  }
  return best;
}

type MarkerCentre = { x: number; y: number };
/** On the upper arc, choose the clear slot with the largest separation from
 * the next player's portrait. A coarse oval grid can skip the entire lane. */
export function capWagerSlot(
  box: CardBox,
  canvas: CardBox,
  felt: CardBox,
  owner: MarkerCentre,
  rivals: MarkerCentre[],
  blockers: CardBox[],
  scale: number,
  gold: boolean
) {
  const r = felt.width / 2,
    cx = felt.left + r,
    margin = 8 * scale;
  const score = (b: CardBox) => {
    const x = b.left + b.width / 2,
      y = b.top + b.height / 2;
    const halfLane = Math.abs(x - cx) + b.width / 2;
    if (
      Math.hypot(
        halfLane,
        Math.max(0, felt.top + r - b.top, b.top + b.height - (felt.top + felt.height) + r)
      ) >
        r - margin ||
      (gold && !insideClassicGreen(b, canvas, margin)) ||
      blockers.some((q) => wagerBoxesOverlap(b, q))
    )
      return -Infinity;
    return (
      Math.min(...rivals.map((p) => Math.hypot(x - p.x, y - p.y))) -
      Math.hypot(x - owner.x, y - owner.y)
    );
  };
  if (score(box) >= 2 * scale) return box;
  let best: CardBox | undefined,
    bestScore = scale;
  for (let x = felt.left + r / 2; x <= felt.left + felt.width - r / 2; x += scale) {
    const dx = Math.abs(x - cx) + box.width / 2;
    const edge = felt.top + r - Math.sqrt(Math.max(0, (r - margin) ** 2 - dx ** 2));
    for (let dy = 0; dy <= 16 * scale; dy += scale) {
      const candidate = {
        left: x - box.width / 2,
        top: edge + dy,
        width: box.width,
        height: box.height,
      };
      const quality = score(candidate);
      if (quality > bestScore) {
        best = candidate;
        bestScore = quality;
      }
    }
  }
  return best;
}

export function wagerBoxesOverlap(a: CardBox, b: CardBox): boolean {
  return (
    a.left < b.left + b.width + 2 &&
    a.left + a.width > b.left - 2 &&
    a.top < b.top + b.height + 2 &&
    a.top + a.height > b.top - 2
  );
}

/** Finite minimum-remaining-options assignment; a greedy first slot may be
 * another player's only clear rail slot. Candidates already exclude chrome.
 */
export function assignProtectedWagers(
  options: ReadonlyArray<ReadonlyArray<CardBox>>
): CardBox[] | null {
  const result: Array<CardBox | undefined> = options.map(() => undefined);
  let budget = 2000;
  const visit = (remaining: number): boolean => {
    if (!remaining) return true;
    if (--budget < 0) return false;
    let index = -1;
    let available: ReadonlyArray<CardBox> = [];
    for (let i = 0; i < options.length; i++) {
      if (result[i]) continue;
      const candidates = options[i].filter((candidate) =>
        result.every((placed) => !placed || !wagerBoxesOverlap(candidate, placed))
      );
      if (!candidates.length) return false;
      if (index < 0 || candidates.length < available.length) {
        index = i;
        available = candidates;
      }
    }
    for (const candidate of available) {
      result[index] = candidate;
      if (visit(remaining - 1)) return true;
    }
    result[index] = undefined;
    return false;
  };
  return visit(options.length) ? (result as CardBox[]) : null;
}

/** Fallback when no joint assignment exists: most-constrained wager first,
 * each taking its best candidate clear of the wagers already placed. When none
 * is clear of them, its best candidate still clears every player, the board
 * and the pot, which beats staying printed over its own player. A wager with
 * no candidate at all is left where it is (undefined). */
export function greedyProtectedWagers(
  options: ReadonlyArray<ReadonlyArray<CardBox>>
): Array<CardBox | undefined> {
  const result: Array<CardBox | undefined> = options.map(() => undefined);
  const order = options.map((_, i) => i).sort((a, b) => options[a].length - options[b].length);
  for (const index of order) {
    result[index] =
      options[index].find((candidate) =>
        result.every((placed) => !placed || !wagerBoxesOverlap(candidate, placed))
      ) ?? options[index][0];
  }
  return result;
}
