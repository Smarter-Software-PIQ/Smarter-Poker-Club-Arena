import { permanentAvatarFocusScale, restingAvatarBox, tableRenderScale } from './avatarCrownBounds';
/** Opponent artwork only: the hero, slot dimensions and table tokens stay owned
 * by their existing renderers. Image metadata never changes the source image. */
type Alpha = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  bands?: Alpha[];
  spans?: Alpha[];
};
type Box = { left: number; top: number; width: number; height: number };
export type OpponentAvatarState = {
  key: string;
  shifts: WeakMap<HTMLElement, [number, number]>;
  lowerLaneKey?: string;
  captionKey?: string;
  captionPreimages?: WeakMap<HTMLElement, { value: string; priority: string }>;
  idleReservedKey?: string;
};
/** Original inline facts belong to their DOM node, never to a render revision. */
export function syncOpponentCaptionBoundary(
  state: OpponentAvatarState,
  captions: HTMLElement[],
  key: string
): boolean {
  const preimages = (state.captionPreimages ??= new WeakMap());
  for (const caption of captions)
    if (!preimages.has(caption))
      preimages.set(caption, {
        value: caption.style.getPropertyValue('translate'),
        priority: caption.style.getPropertyPriority('translate'),
      });
  const boundary = state.captionKey !== undefined && state.captionKey !== key;
  state.captionKey = key;
  // Failed nested trials restored their INFO already. Legacy action placement
  // alone is not an accepted caption correction and never forces a new pack.
  const accepted = captions.some((caption) => {
    const original = preimages.get(caption)!;
    return (
      caption.classList.contains('seat__info') &&
      (caption.style.getPropertyValue('translate') !== original.value ||
        caption.style.getPropertyPriority('translate') !== original.priority)
    );
  });
  if (!boundary || !accepted) return false;
  for (const caption of captions) {
    const original = preimages.get(caption)!;
    if (original.value) caption.style.setProperty('translate', original.value, original.priority);
    else caption.style.removeProperty('translate');
  }
  state.key = '';
  state.idleReservedKey = undefined;
  return true;
}

export function opponentCaptionBounds(info: Box, art: Box) {
  const minTop = Math.max(art.top + (art.height * 2) / 3, art.top + art.height - info.height);
  return { info, art, minTop, maxRaise: Math.max(0, info.top - minTop) };
}
/** Nested wager proposals commit or restore all opponent anchors together. */
export function opponentShiftTransaction(
  seats: HTMLElement[],
  shifts: WeakMap<HTMLElement, [number, number]>,
  propose: () => boolean
): boolean {
  const saved = seats.map((seat) => ({
    seat,
    shift: shifts.get(seat),
    captions: Array.from(
      seat.querySelectorAll<HTMLElement>(':scope > .seat__info,:scope > .seat__action')
    ).map((element) => ({
      element,
      value: element.style.getPropertyValue('translate'),
      priority: element.style.getPropertyPriority('translate'),
    })),
    styles: ['--sp-opponent-x', '--sp-opponent-y'].map((name) => ({
      name,
      value: seat.style.getPropertyValue(name),
      priority: seat.style.getPropertyPriority(name),
    })),
  }));
  let accepted = false;
  try {
    accepted = propose();
    if (accepted)
      for (const { seat, shift } of saved) {
        if (!(shifts.get(seat) ?? shift)) continue;
        shifts.set(seat, [
          parseFloat(seat.style.getPropertyValue('--sp-opponent-x')) || 0,
          parseFloat(seat.style.getPropertyValue('--sp-opponent-y')) || 0,
        ]);
      }
    return accepted;
  } finally {
    if (!accepted)
      for (const { seat, shift, styles, captions } of saved) {
        for (const { name, value, priority } of styles) {
          if (value) seat.style.setProperty(name, value, priority);
          else seat.style.removeProperty(name);
        }
        for (const { element, value, priority } of captions) {
          if (value) element.style.setProperty('translate', value, priority);
          else element.style.removeProperty('translate');
        }
        if (shift) shifts.set(seat, shift);
        else shifts.delete(seat);
      }
  }
}
const metadata = new Map<string, Promise<Alpha | null>>();
const box = (element: Element): Box => {
  // Position badges share the character's gesture wrapper. Their permanent
  // footprint, rather than a breathing/winner frame, owns the lower lane.
  const scaler = element.closest<HTMLElement>('.table-scaler');
  const r =
    element instanceof HTMLElement && element.matches('.seat__position-badge') && scaler
      ? restingAvatarBox(element, tableRenderScale(scaler))
      : element.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};
const moved = (r: Box, x: number, y: number): Box => ({ ...r, left: r.left + x, top: r.top + y });
const overlap = (a: Box, b: Box, gap = 3) =>
  a.left < b.left + b.width + gap &&
  a.left + a.width + gap > b.left &&
  a.top < b.top + b.height + gap &&
  a.top + a.height + gap > b.top;

/** Minimum movement among the exact obstacle edges, keeping a chair on its
 * original half of the table. No dimensions are reduced to make it fit. */
function opponentShiftCandidates(
  parts: Box[],
  obstacles: Box[],
  bounds: Box,
  side: number,
  outwardOnly = false,
  hints: Box[] = [],
  gap = 3
): Array<[number, number]> {
  if (!parts.length) return [[0, 0]];
  const xs = new Set([0]);
  const ys = new Set([0]);
  for (const part of parts) {
    xs.add(bounds.left - part.left);
    xs.add(bounds.left + bounds.width - part.left - part.width);
    ys.add(bounds.top - part.top);
    ys.add(bounds.top + bounds.height - part.top - part.height);
    for (const other of hints) {
      xs.add(other.left - part.left - part.width - gap);
      xs.add(other.left + other.width - part.left + gap);
      ys.add(other.top - part.top - part.height - gap);
      ys.add(other.top + other.height - part.top + gap);
    }
    for (const other of obstacles) {
      if (part.top < other.top + other.height + gap && part.top + part.height + gap > other.top) {
        xs.add(other.left - part.left - part.width - gap);
        xs.add(other.left + other.width - part.left + gap);
      }
      if (part.left < other.left + other.width + gap && part.left + part.width + gap > other.left) {
        ys.add(other.top - part.top - part.height - gap);
        ys.add(other.top + other.height - part.top + gap);
      }
    }
  }
  // The inward clamp and horizontal checks are independent of y. Reject the
  // same candidates once per x without rebuilding every rectangle for each y.
  const inward =
    side < 0
      ? Math.max(0, bounds.left - Math.min(...parts.map((part) => part.left)))
      : Math.max(
          0,
          Math.max(...parts.map((part) => part.left + part.width)) - bounds.left - bounds.width
        );
  const candidates: Array<[number, number]> = [];
  for (const x of xs) {
    if (outwardOnly && side && x * side < -inward - 0.01) continue;
    const centre = parts[0].left + parts[0].width / 2 + x;
    if (side && (centre - bounds.left - bounds.width / 2) * side < 0) continue;
    if (
      !parts.every(
        (part) =>
          part.left + x >= bounds.left && part.left + x + part.width <= bounds.left + bounds.width
      )
    )
      continue;
    for (const y of ys) {
      if (
        parts.every((part) => {
          const next = moved(part, x, y);
          return (
            next.left >= bounds.left &&
            next.top >= bounds.top &&
            next.left + next.width <= bounds.left + bounds.width &&
            next.top + next.height <= bounds.top + bounds.height &&
            obstacles.every((other) => !overlap(next, other, gap))
          );
        })
      )
        candidates.push([x, y]);
    }
  }
  return candidates.sort((a, b) => a[0] * a[0] + a[1] * a[1] - b[0] * b[0] - b[1] * b[1]);
}

export function nearestOpponentShift(
  parts: Box[],
  obstacles: Box[],
  bounds: Box,
  side: number,
  outwardOnly = false
): [number, number] | null {
  return opponentShiftCandidates(parts, obstacles, bounds, side, outwardOnly)[0] ?? null;
}

/** Jointly place only opponent pods. A finite search avoids freezing a first
 * neighbour where it prevents the remaining rail from fitting. */
export function jointOpponentShifts(
  items: Array<{ parts: Box[]; side: number; outwardOnly: boolean }>,
  fixed: Box[],
  bounds: Box,
  gap = 3,
  closeVerticalChains = false,
  topLaneBottom?: number,
  lowerLane?: { top: number; bottom: number }
): Array<[number, number]> | null {
  if (
    items.every((item) =>
      item.parts.every(
        (part) =>
          part.left >= bounds.left &&
          part.top >= bounds.top &&
          part.left + part.width <= bounds.left + bounds.width &&
          part.top + part.height <= bounds.top + bounds.height &&
          fixed.every((other) => !overlap(part, other, gap))
      )
    ) &&
    items.every((item, i) =>
      items
        .slice(i + 1)
        .every((other) =>
          item.parts.every((part) => other.parts.every((peer) => !overlap(part, peer, gap)))
        )
    )
  )
    return items.map(() => [0, 0]);
  const withinAuxiliaryLane = (item: (typeof items)[number], x: number, y: number) => {
    if (topLaneBottom === undefined || !item.parts.length) return true;
    const low = Math.min(...item.parts.map((p) => p.top));
    const high = Math.max(...item.parts.map((p) => p.top + p.height));
    const clamp =
      item.side < 0
        ? Math.max(0, bounds.left - Math.min(...item.parts.map((p) => p.left)))
        : Math.max(
            0,
            Math.max(...item.parts.map((p) => p.left + p.width)) - bounds.left - bounds.width
          );
    return (
      Math.abs(y) <= (high - low) / 2 &&
      (!item.outwardOnly ||
        x * item.side >= -clamp - 0.01 ||
        high + y <= topLaneBottom ||
        (lowerLane !== undefined && low + y >= lowerLane.top && high + y <= lowerLane.bottom))
    );
  };
  const options = items.map((item, index) =>
    opponentShiftCandidates(
      item.parts,
      fixed,
      bounds,
      item.side,
      topLaneBottom === undefined && item.outwardOnly,
      items.filter((_, other) => other !== index).flatMap((other) => other.parts),
      gap
    ).slice(0, 96)
  );
  if (closeVerticalChains) {
    // Three contacts cover a dense side column. Propagate exact translated
    // peer edges, rather than assuming every neighbour remains unmoved.
    const seedYs = items.map(() => new Set<number>());
    for (const side of [-1, 1]) {
      const column = items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item.parts.length > 0 && item.outwardOnly && item.side === side)
        .sort((a, b) => a.item.parts[0].top - b.item.parts[0].top);
      const starts = [
        bounds.top + 0.001,
        ...fixed.map((part) => part.top + part.height + gap + 0.001),
      ];
      for (const start of starts) {
        let top = start;
        for (const { item, index } of column) {
          const low = Math.min(...item.parts.map((part) => part.top));
          const high = Math.max(...item.parts.map((part) => part.top + part.height));
          const y = top - low;
          seedYs[index].add(y);
          top = high + y + gap + 0.001;
        }
      }
      const ends = [bounds.top + bounds.height, ...fixed.map((part) => part.top - gap)];
      for (const end of ends) {
        let bottom = end;
        for (const { item, index } of [...column].reverse()) {
          const low = Math.min(...item.parts.map((part) => part.top));
          const high = Math.max(...item.parts.map((part) => part.top + part.height));
          const y = bottom - high;
          seedYs[index].add(y);
          bottom = low + y - gap - 0.001;
        }
      }
    }
    if (lowerLane)
      items.forEach((item, i) => {
        if (!item.parts.length) return;
        const low = Math.min(...item.parts.map((p) => p.top));
        const high = Math.max(...item.parts.map((p) => p.top + p.height));
        for (const y of [lowerLane.top - low, lowerLane.bottom - high]) seedYs[i].add(y);
      });
    let ys = items.map((item, i) => {
      if (!item.parts.length) return new Set([0]);
      return new Set([
        ...seedYs[i],
        0,
        ...options[i].map((shift) => shift[1]),
        bounds.top - Math.min(...item.parts.map((part) => part.top)),
        bounds.top + bounds.height - Math.max(...item.parts.map((part) => part.top + part.height)),
      ]);
    });
    for (let round = 0; round < 3; round++) {
      const next = ys.map((set) => new Set(set));
      for (let i = 0; i < items.length; i++)
        for (let j = 0; j < items.length; j++) {
          if (i === j) continue;
          for (const part of items[i].parts)
            for (const peer of items[j].parts) {
              if (
                part.left >= peer.left + peer.width + gap ||
                part.left + part.width + gap <= peer.left
              )
                continue;
              for (const y of ys[j])
                for (const candidate of [
                  peer.top + peer.height + y + gap + 0.001 - part.top,
                  peer.top + y - gap - 0.001 - part.top - part.height,
                ]) {
                  if (
                    items[i].parts.every(
                      (p) =>
                        p.top + candidate >= bounds.top &&
                        p.top + p.height + candidate <= bounds.top + bounds.height
                    )
                  )
                    next[i].add(Math.round(candidate * 1e6) / 1e6);
                }
            }
        }
      ys = next.map(
        (set, i) =>
          new Set(
            [...set]
              .sort((a, b) => Math.abs(a) - Math.abs(b))
              .slice(0, 512)
              .concat([...seedYs[i]])
          )
      );
    }
    // The shortest ring needs horizontal contacts between moved neighbours,
    // not just the old natural X positions. Derive a bounded flush grid from
    // the unchanged pod widths; no viewport-specific seat coordinates exist.
    const widths = [
      ...new Set(
        items
          .filter((item) => item.parts.length > 0)
          .map(
            (item) =>
              Math.max(...item.parts.map((p) => p.left + p.width)) -
              Math.min(...item.parts.map((p) => p.left))
          )
      ),
    ];
    let anchors = new Set([
      bounds.left,
      bounds.left + bounds.width,
      ...(lowerLane
        ? items
            .filter((item) => item.parts.length > 0)
            .flatMap((item) => [
              Math.min(...item.parts.map((p) => p.left)),
              Math.max(...item.parts.map((p) => p.left + p.width)),
            ])
        : []),
    ]);
    if (topLaneBottom !== undefined)
      for (let round = 0; round < 3; round++) {
        const next = new Set(anchors);
        for (const edge of anchors)
          for (const width of widths)
            for (const x of [edge + width + gap, edge - width - gap])
              if (x >= bounds.left && x <= bounds.left + bounds.width)
                next.add(Math.round(x * 1e6) / 1e6);
        anchors = new Set([...next].slice(0, 256));
      }
    items.forEach((item, i) => {
      if (!item.parts.length) return;
      const low = Math.min(...item.parts.map((p) => p.left)),
        high = Math.max(...item.parts.map((p) => p.left + p.width));
      const xs =
        topLaneBottom === undefined
          ? [0]
          : [...new Set([0, ...[...anchors].flatMap((x) => [x - low, x - high])])];
      const extra = xs
        .flatMap((x) => [...ys[i]].map((y): [number, number] => [x, y]))
        .filter(([x, y]) => {
          if (!withinAuxiliaryLane(item, x, y)) return false;
          if (
            item.side &&
            (item.parts[0].left + item.parts[0].width / 2 + x - bounds.left - bounds.width / 2) *
              item.side <
              0
          )
            return false;
          return item.parts.every((part) => {
            const r = moved(part, x, y);
            return (
              r.left >= bounds.left &&
              r.left + r.width <= bounds.left + bounds.width &&
              r.top >= bounds.top &&
              r.top + r.height <= bounds.top + bounds.height &&
              fixed.every((other) => !overlap(r, other, gap))
            );
          });
        });
      const seen = new Set<string>();
      const seeds =
        topLaneBottom === undefined
          ? extra.filter((shift) => seedYs[i].has(shift[1]))
          : extra
              .filter(
                ([, y]) =>
                  seedYs[i].has(y) ||
                  Math.abs(y - (bounds.top - Math.min(...item.parts.map((p) => p.top)))) < 0.002
              )
              .concat(
                xs.flatMap((x) =>
                  extra
                    .filter((p) => p[0] === x)
                    .sort((a, b) => a[1] * a[1] - b[1] * b[1])
                    .slice(0, 4)
                )
              );
      const candidates = [...options[i], ...extra]
        .filter(([x, y]) => withinAuxiliaryLane(item, x, y))
        .sort((a, b) => a[0] * a[0] + a[1] * a[1] - b[0] * b[0] - b[1] * b[1])
        .filter((shift) => {
          const key = lowerLane
            ? `${Math.round(shift[0] * 64)}:${Math.round(shift[1] * 64)}`
            : shift.join(':');
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      const seedKeys = new Set<string>();
      const uniqueSeeds = seeds.filter((shift) => {
        const key = lowerLane
          ? `${Math.round(shift[0] * 64)}:${Math.round(shift[1] * 64)}`
          : shift.join(':');
        if (seedKeys.has(key) || seedKeys.size >= 384) return false;
        seedKeys.add(key);
        return true;
      });
      options[i] = [
        ...candidates
          .filter(
            (shift) =>
              !seedKeys.has(
                lowerLane
                  ? `${Math.round(shift[0] * 64)}:${Math.round(shift[1] * 64)}`
                  : shift.join(':')
              )
          )
          .slice(0, Math.max(0, 384 - uniqueSeeds.length)),
        ...uniqueSeeds,
      ].sort((a, b) => a[0] * a[0] + a[1] * a[1] - b[0] * b[0] - b[1] * b[1]);
    });
  }
  const shapes = items.map((item, i) =>
    options[i].map((shift) => item.parts.map((part) => moved(part, ...shift)))
  );
  // Preserve overlap's addition order while preparing immutable part edges.
  // Union bounds only reject disjoint pairs; every possible contact still
  // checks all parts with the same four strict overlap inequalities.
  const preparedShapes = shapes.map((list) =>
    list.map((parts) =>
      parts.map((p) => ({
        left: p.left,
        top: p.top,
        right: p.left + p.width + gap,
        bottom: p.top + p.height + gap,
      }))
    )
  );
  const shapeExtents = preparedShapes.map((list) =>
    list.map((parts) => ({
      left: Math.min(...parts.map((p) => p.left)),
      top: Math.min(...parts.map((p) => p.top)),
      right: Math.max(...parts.map((p) => p.right)),
      bottom: Math.max(...parts.map((p) => p.bottom)),
    }))
  );
  const boundsTouch = (
    a: (typeof shapeExtents)[number][number],
    b: (typeof shapeExtents)[number][number]
  ) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const seatExtents = shapeExtents.map((list) => ({
    left: Math.min(...list.map((p) => p.left)),
    top: Math.min(...list.map((p) => p.top)),
    right: Math.max(...list.map((p) => p.right)),
    bottom: Math.max(...list.map((p) => p.bottom)),
  }));
  const shapesClear = (
    first: (typeof preparedShapes)[number][number],
    second: (typeof preparedShapes)[number][number]
  ) => {
    for (const part of first)
      for (const peer of second)
        if (
          part.left < peer.right &&
          part.right > peer.left &&
          part.top < peer.bottom &&
          part.bottom > peer.top
        )
          return false;
    return true;
  };
  const costs = options.map((list) => list.map(([x, y]) => x * x + y * y));
  // Pair geometry is immutable for this allocation. Compute it once instead
  // of rebuilding every composite rectangle inside each search branch.
  const compatibility: Array<Array<Uint8Array | undefined>> = items.map(() => []);
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) {
      const table = new Uint8Array(options[i].length * options[j].length);
      if (!boundsTouch(seatExtents[i], seatExtents[j])) {
        table.fill(1);
        compatibility[i][j] = table;
        continue;
      }
      for (let a = 0; a < options[i].length; a++) {
        if (!boundsTouch(shapeExtents[i][a], seatExtents[j])) {
          table.fill(1, a * options[j].length, (a + 1) * options[j].length);
          continue;
        }
        for (let b = 0; b < options[j].length; b++)
          table[a * options[j].length + b] = Number(
            !boundsTouch(shapeExtents[i][a], shapeExtents[j][b]) ||
              shapesClear(preparedShapes[i][a], preparedShapes[j][b])
          );
      }
      compatibility[i][j] = table;
    }
  const compatible = (i: number, a: number, j: number, b: number) =>
    i < j
      ? compatibility[i][j]![a * options[j].length + b] === 1
      : compatibility[j][i]![b * options[i].length + a] === 1;
  const chosen = Array<number>(items.length).fill(-1);
  let best: Array<[number, number]> | null = null;
  let bestCost = Infinity;
  let budget = 12000;
  const visit = (remaining: number, total: number) => {
    if (--budget < 0 || total >= bestCost) return;
    if (!remaining) {
      best = chosen.map((option, i) => options[i][option]);
      bestCost = total;
      return;
    }
    let index = -1;
    let available: number[] = [];
    let lowerBound = total;
    for (let i = 0; i < items.length; i++) {
      if (chosen[i] >= 0) continue;
      const clear: number[] = [];
      for (let a = 0; a < options[i].length; a++) {
        if (total + costs[i][a] >= bestCost) continue;
        if (chosen.every((b, j) => b < 0 || compatible(i, a, j, b))) clear.push(a);
      }
      if (!clear.length) return;
      lowerBound += costs[i][clear[0]];
      if (index < 0 || clear.length < available.length) {
        index = i;
        available = clear;
      }
    }
    if (lowerBound >= bestCost) return;
    for (const option of available) {
      chosen[index] = option;
      visit(remaining - 1, total + costs[index][option]);
      chosen[index] = -1;
      if (budget < 0) break;
    }
  };
  visit(items.length, 0);
  return best;
}

export function opponentFitsLowerLane(
  parts: Box[],
  limits: { top: number; bottom: number },
  heroParts: Box[] = []
): boolean {
  return (
    parts.length > 0 &&
    parts.every(
      (part) =>
        part.top >= limits.top &&
        part.top + part.height <= limits.bottom &&
        heroParts.every((hero) => !overlap(part, hero, 0))
    )
  );
}

/** Full endpoint envelope of the existing idle breath. Only peer contacts
 * reserve this paint; permanent page/header and board geometry stays static. */
export function opponentIdleEnvelope(parts: Box[], origin: [number, number], ratio: number): Box[] {
  return parts.map((part) => {
    const left = origin[0] + (part.left - origin[0]) * 1.008;
    const top = origin[1] + (part.top - origin[1]) * 1.008 - 1.5 * ratio;
    const right = left + part.width * 1.008;
    const bottom = top + part.height * 1.008;
    const x = Math.min(part.left, left),
      y = Math.min(part.top, top);
    return {
      left: x,
      top: y,
      width: Math.max(part.left + part.width, right) - x,
      height: Math.max(part.top + part.height, bottom) - y,
    };
  });
}

/** Retain each contiguous alpha run through the complete idle path, never
 * joining transparent gaps between separate ears or limbs. Cached per trial. */
export function opponentIdleSpans(
  spans: Alpha[],
  content: Box,
  origin: [number, number],
  ratio: number
): Alpha[] {
  const runs = spans.map((span) => ({
    left: content.left + span.left * content.width,
    top: content.top + span.top * content.height,
    width: (span.right - span.left) * content.width,
    height: (span.bottom - span.top) * content.height,
  }));
  return opponentIdleEnvelope(runs, origin, ratio).map((part) => ({
    left: (part.left - content.left) / content.width,
    top: (part.top - content.top) / content.height,
    right: (part.left + part.width - content.left) / content.width,
    bottom: (part.top + part.height - content.top) / content.height,
  }));
}

/** Push only directly intersecting neighbours in the requested direction.
 * This finite contact cascade is part of one wager-placement transaction. */
export function pushOpponentChain(
  items: Array<{
    parts: Box[];
    peerParts?: Box[];
    capBottom?: number;
    laneTop?: number;
    laneBottom?: number;
  }>,
  owner: number,
  deltaY: number,
  fixed: Box[],
  bounds: Box,
  maximumMotion?: number[]
): number[] | null {
  if (!items[owner] || !deltaY || !Number.isFinite(deltaY)) return null;
  const shifts = items.map(() => 0);
  shifts[owner] = deltaY;
  const direction = Math.sign(deltaY);
  const shifted = (i: number, peers = false) =>
    (peers ? (items[i].peerParts ?? items[i].parts) : items[i].parts).map((p) =>
      moved(p, 0, shifts[i])
    );
  const valid = (i: number) =>
    Math.abs(shifts[i]) <= (maximumMotion?.[i] ?? Infinity) &&
    shifted(i).every(
      (p) =>
        p.left >= bounds.left &&
        p.left + p.width <= bounds.left + bounds.width &&
        p.top >= bounds.top &&
        p.top + p.height <= bounds.top + bounds.height &&
        (items[i].capBottom === undefined || p.top + p.height <= items[i].capBottom!) &&
        (items[i].laneTop === undefined || p.top >= items[i].laneTop!) &&
        (items[i].laneBottom === undefined || p.top + p.height <= items[i].laneBottom!) &&
        fixed.every((obstacle) => !overlap(p, obstacle, 0))
    );
  for (let step = 0; step < items.length * items.length * 4; step++) {
    if (!items.every((_, i) => valid(i))) return null;
    let advanced = false;
    for (let i = 0; i < items.length && !advanced; i++) {
      if (!shifts[i]) continue;
      const source = shifted(i, true);
      for (let k = 0; k < items.length; k++) {
        if (i === k) continue;
        const target = shifted(k, true);
        let next = shifts[k];
        for (const p of source)
          for (let q = 0; q < target.length; q++) {
            const peer = target[q];
            // DOMRect compositor coordinates can differ by one float32 ULP
            // at an otherwise exact shared edge (68 vs 67.99999237060547).
            // Such a contact must not trigger a whole-pod vertical cascade.
            if (
              !overlap(p, peer, 0) ||
              Math.min(p.left + p.width, peer.left + peer.width) - Math.max(p.left, peer.left) <=
                1e-4 ||
              Math.min(p.top + p.height, peer.top + peer.height) - Math.max(p.top, peer.top) <= 1e-4
            )
              continue;
            if (k === owner) return null;
            const contact =
              direction > 0
                ? p.top + p.height - (items[k].peerParts ?? items[k].parts)[q].top + 0.001
                : p.top -
                  (items[k].peerParts ?? items[k].parts)[q].top -
                  (items[k].peerParts ?? items[k].parts)[q].height -
                  0.001;
            next = direction > 0 ? Math.max(next, contact) : Math.min(next, contact);
          }
        if (next !== shifts[k]) {
          shifts[k] = next;
          advanced = true;
          break;
        }
      }
    }
    if (!advanced) return shifts;
  }
  return null;
}

/** Noisy uploaded alpha must never create an unbounded precise-footprint
 * cache. An excessive run count discards precision entirely, never pixels. */
export function readOpponentAlphaSpans(
  pixels: Uint8ClampedArray,
  width: number,
  height: number
): Alpha[] | undefined {
  const spans: Alpha[] = [];
  for (let y = 0; y < height; y++) {
    let first = -1;
    for (let x = 0; x <= width; x++) {
      const painted = x < width && pixels[(y * width + x) * 4 + 3] > 12;
      if (painted && first < 0) first = x;
      if (!painted && first >= 0) {
        if (spans.length === 4096) return undefined;
        spans.push({
          left: first / width,
          right: x / width,
          top: y / height,
          bottom: (y + 1) / height,
        });
        first = -1;
      }
    }
  }
  return spans;
}

function alpha(image: HTMLImageElement): Promise<Alpha | null> {
  const source = image.currentSrc || image.src;
  const cached = metadata.get(source);
  if (cached) return cached;
  const read = (input: HTMLImageElement): Alpha | null => {
    const canvas = document.createElement('canvas');
    const reduction = Math.min(1, 512 / Math.max(input.naturalWidth, input.naturalHeight));
    canvas.width = Math.round(input.naturalWidth * reduction);
    canvas.height = Math.round(input.naturalHeight * reduction);
    if (!canvas.width || !canvas.height) return null;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(input, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const rows = Array.from({ length: canvas.height }, () => [canvas.width, 0]);
    let left = canvas.width,
      top = canvas.height,
      right = 0,
      bottom = 0;
    for (let y = 0; y < canvas.height; y++)
      for (let x = 0; x < canvas.width; x++) {
        if (pixels[(y * canvas.width + x) * 4 + 3] <= 12) continue;
        rows[y][0] = Math.min(rows[y][0], x);
        rows[y][1] = Math.max(rows[y][1], x + 1);
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x + 1);
        bottom = Math.max(bottom, y + 1);
      }
    // Keep decoded contiguous runs for wager narrow-phase queries only.
    // The pod solver continues using its five bounded conservative strips.
    const spans = readOpponentAlphaSpans(pixels, canvas.width, canvas.height);
    // The crown is narrower than the lower bust. Five conservative strips
    // retain every painted pixel while leaving its transparent corners free.
    // The small first strip matters where an unchanged name plate meets a crown.
    const cuts = [0, 1 / 32, 1 / 8, 1 / 3, 2 / 3, 1];
    const bands: Alpha[] = [];
    if (bottom > top)
      for (let i = 1; i < cuts.length; i++) {
        const y0 = top + Math.floor((bottom - top) * cuts[i - 1]);
        const y1 = top + Math.floor((bottom - top) * cuts[i]);
        const strip = rows.slice(y0, y1).filter(([l, r]) => r > l);
        if (!strip.length) continue;
        bands.push({
          left: Math.min(...strip.map(([l]) => l)) / canvas.width,
          right: Math.max(...strip.map(([, r]) => r)) / canvas.width,
          top: y0 / canvas.height,
          bottom: y1 / canvas.height,
        });
      }
    return bottom > top
      ? {
          left: left / canvas.width,
          top: top / canvas.height,
          right: right / canvas.width,
          bottom: bottom / canvas.height,
          bands,
          spans,
        }
      : null;
  };
  const pending = new Promise<Alpha | null>((resolve) => {
    try {
      resolve(read(image));
      return;
    } catch {
      /* Read the same public bytes with CORS, without changing the shown image. */
    }
    const probe = new Image();
    const timer = window.setTimeout(() => finish(null), 5000);
    const finish = (result: Alpha | null) => {
      clearTimeout(timer);
      probe.onload = null;
      probe.onerror = null;
      resolve(result);
    };
    probe.crossOrigin = 'anonymous';
    probe.onload = () => {
      try {
        finish(read(probe));
      } catch {
        finish(null);
      }
    };
    probe.onerror = () => finish(null);
    probe.src = source;
  });
  if (metadata.size >= 256) metadata.delete(metadata.keys().next().value!);
  metadata.set(source, pending);
  return pending;
}

/** Cached decoded spans preserve gaps between ears in wager narrow phases. */
export function opponentPaintSpansTouch(
  spans: Alpha[],
  content: Box,
  target: Box,
  gap = 0
): boolean {
  const left = (target.left - gap - content.left) / content.width;
  const right = (target.left + target.width + gap - content.left) / content.width;
  const top = (target.top - gap - content.top) / content.height;
  const bottom = (target.top + target.height + gap - content.top) / content.height;
  return spans.some(
    (span) => span.left < right && span.right > left && span.top < bottom && span.bottom > top
  );
}

function subject(image: HTMLImageElement, a: Alpha, rendered: boolean, override?: Box): Box {
  const style = getComputedStyle(image);
  const rect = rendered
    ? (override ?? box(image))
    : { left: 0, top: 0, width: image.offsetWidth, height: image.offsetHeight };
  const fit =
    style.objectFit === 'contain'
      ? Math.min(rect.width / image.naturalWidth, rect.height / image.naturalHeight)
      : Math.max(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
  const w = image.naturalWidth * fit,
    h = image.naturalHeight * fit;
  const x = rect.left + (rect.width - w) / 2;
  const y = rect.top + (rect.height - h) * (style.objectPosition.endsWith('100%') ? 1 : 0.5);
  let left = x + a.left * w,
    top = y + a.top * h;
  let right = x + a.right * w,
    bottom = y + a.bottom * h;
  if (!image.closest('.seat__avatar--bust')) {
    left = Math.max(left, rect.left);
    right = Math.min(right, rect.left + rect.width);
    top = Math.max(top, rect.top);
    bottom = Math.min(bottom, rect.top + rect.height);
  }
  if (!rendered) {
    const transform =
      (style.transform === 'none' ? 1 : new DOMMatrix(style.transform).d) *
      permanentAvatarFocusScale(image);
    top = rect.height + (top - rect.height) * transform;
    bottom = rect.height + (bottom - rect.height) * transform;
  }
  return { left, top, width: right - left, height: bottom - top };
}

export function createOpponentAvatarLayout(
  scaler: HTMLElement,
  page: HTMLElement,
  state: OpponentAvatarState,
  schedule: () => void
) {
  let active = true;
  const observedAnimations = new WeakSet<Animation>();
  const resolved = new Map<string, Alpha | null>();
  const pending = new Set<string>();
  const source = (image: HTMLImageElement) => image.currentSrc || image.src;
  let spacingReady = false;
  const images = () => Array.from(scaler.querySelectorAll<HTMLImageElement>('.seat__avatar-img'));
  const paintedParts = (image: HTMLImageElement, permanent = true): Box[] => {
    const own = resolved.get(source(image));
    if (!own) return [];
    const ratio = tableRenderScale(scaler);
    const rect = permanent ? restingAvatarBox(image, ratio) : undefined;
    const wrap = image.closest<HTMLElement>('.seat__avatar-wrap');
    const transforms = [
      getComputedStyle(image).transform,
      wrap ? getComputedStyle(wrap).getPropertyValue('--sp-avatar-rest-transform').trim() : '',
    ];
    const axisAligned = transforms.every((transform) => {
      if (!transform || transform === 'none') return true;
      const matrix = new DOMMatrix(transform);
      return Math.abs(matrix.b) < 1e-8 && Math.abs(matrix.c) < 1e-8;
    });
    return (axisAligned && own.bands?.length ? own.bands : [own])
      .map((part) => subject(image, part, true, rect))
      .filter((part) => part.width > 0 && part.height > 0);
  };
  const idleOrigin = (image: HTMLImageElement): [number, number] | null => {
    const wrap = image.closest<HTMLElement>('.seat__avatar-wrap');
    const seat = image.closest<HTMLElement>('.seat');
    if (
      !wrap ||
      !seat ||
      getComputedStyle(wrap).getPropertyValue('--sp-avatar-rest-transform').trim()
    )
      return null;
    const ratio = tableRenderScale(scaler);
    const origin = getComputedStyle(wrap).transformOrigin.split(/\s+/).map(parseFloat);
    let x = origin[0] || 0,
      y = origin[1] || 0;
    let node: HTMLElement | null = wrap;
    while (node && node !== seat) {
      const parent = node.offsetParent as HTMLElement | null;
      x += node.offsetLeft + (parent?.clientLeft || 0);
      y += node.offsetTop + (parent?.clientTop || 0);
      node = parent;
    }
    if (node !== seat) return null;
    const anchor = box(seat);
    return [anchor.left + x * ratio, anchor.top + y * ratio];
  };
  const peerPaint = (image: HTMLImageElement) => {
    const parts = paintedParts(image),
      origin = idleOrigin(image);
    return origin ? opponentIdleEnvelope(parts, origin, tableRenderScale(scaler)) : parts;
  };
  // Snapshot DOM geometry once for each finite wager-placement trial. The
  // returned narrow-phase query only reads decoded runs and numeric boxes.
  const preparePaintedTouch = (image: HTMLImageElement, permanent = true) => {
    const ratio = tableRenderScale(scaler);
    const fallback = permanent ? restingAvatarBox(image, ratio) : box(image);
    const origin = permanent ? idleOrigin(image) : null;
    const conservative = origin ? opponentIdleEnvelope([fallback], origin, ratio)[0] : fallback;
    const refuse = (target: Box, gap = 0) => overlap(conservative, target, gap);
    if (!permanent) return refuse;
    const own = resolved.get(source(image));
    if (!own) return refuse;
    const wrap = image.closest<HTMLElement>('.seat__avatar-wrap');
    const transforms = [
      getComputedStyle(image).transform,
      wrap ? getComputedStyle(wrap).getPropertyValue('--sp-avatar-rest-transform').trim() : '',
    ];
    const axisAligned = transforms.every((transform) => {
      if (!transform || transform === 'none') return true;
      const matrix = new DOMMatrix(transform);
      return matrix.is2D && Math.abs(matrix.b) < 1e-8 && Math.abs(matrix.c) < 1e-8;
    });
    if (!axisAligned || !own.spans?.length || !image.closest('.seat__avatar--bust')) return refuse;
    const content = subject(image, { left: 0, top: 0, right: 1, bottom: 1 }, true, fallback);
    const spans = origin ? opponentIdleSpans(own.spans, content, origin, ratio) : own.spans;
    return (target: Box, gap = 0) =>
      overlap(conservative, target, gap) && opponentPaintSpansTouch(spans, content, target, gap);
  };
  const lowerLaneLimits = (rounding = 0): { top: number; bottom: number } | null => {
    const board = page.querySelector('.community-area');
    const hero = images().find((image) => image.closest('.seat--hero'));
    const heroParts = [
      ...(hero ? paintedParts(hero) : []),
      ...Array.from(
        page.querySelectorAll(
          '.seat--hero .seat__info,.seat--hero .seat__action,.seat--hero .seat__bounty,.seat--hero .seat__position-badge,.seat--hero .seat__cards .seat__card'
        )
      )
        .map(box)
        .filter((part) => part.width > 0 && part.height > 0),
    ];
    if (!board || !heroParts.length) return null;
    const boardBox = box(board);
    const top = boardBox.top + boardBox.height + 3 + rounding;
    const bottom = Math.min(...heroParts.map((part) => part.top)) - 3 - rounding;
    return bottom > top ? { top, bottom } : null;
  };
  const captions = () =>
    Array.from(
      scaler.querySelectorAll<HTMLElement>(
        '.seat:not(.seat--hero) > .seat__info,.seat:not(.seat--hero) > .seat__action'
      )
    );
  const fullRingShowdown = () => {
    const rows = Array.from(
      scaler.querySelectorAll('.seat__cards--opponent.seat__cards--revealed')
    );
    return (
      !scaler.querySelector('.seat__allin-puck') &&
      rows.length > 0 &&
      rows.every((row) => row.querySelectorAll('.seat__card').length === 5)
    );
  };
  const compactAllIn = () =>
    page.getAttribute('data-seats') === '9' &&
    window.innerWidth <= 340 &&
    page.clientWidth <= 340 &&
    (Boolean(scaler.querySelector('.seat__allin-puck')) || fullRingShowdown()) &&
    Boolean(scaler.querySelector('.seat__cards--revealed > :nth-child(5)'));
  const prepare = (handKey = 'current') => {
    syncOpponentCaptionBoundary(
      state,
      captions(),
      `${handKey}:${window.innerWidth}:${window.innerHeight}:${scaler.clientWidth}:${scaler.clientHeight}:${page.clientWidth}:${page.clientHeight}:${images().map(source).join('|')}`
    );
    spacingReady = false;
    const all = images().filter((image) => image.complete && image.naturalWidth > 0);
    const hero = all.find((image) => image.closest('.seat--hero'));
    if (!hero) {
      state.key = '';
      state.shifts = new WeakMap();
      state.lowerLaneKey = undefined;
      scaler.querySelectorAll<HTMLElement>('.seat,.seat__avatar').forEach((element) => {
        delete element.dataset.opponentLane;
        for (const name of ['--sp-opponent-art-scale', '--sp-opponent-x', '--sp-opponent-y'])
          element.style.removeProperty(name);
      });
      scaler
        .querySelectorAll<HTMLElement>('.seat:not(.seat--hero) > .seat__action')
        .forEach((action) => action.style.removeProperty('translate'));
      return false;
    }
    for (const image of all)
      if (image.complete && image.naturalWidth && !pending.has(source(image))) {
        const url = source(image);
        pending.add(url);
        void alpha(image).then((value) => {
          // Decoded bytes belong to the URL, not the DOM node that began
          // the read. A roster/profile render can replace that node while a
          // current portrait still needs the same pending metadata.
          if (active) {
            resolved.set(url, value);
            schedule();
          }
        });
      }
    if (all.some((image) => !resolved.has(source(image)))) return false;
    const heroAlpha = resolved.get(source(hero));
    if (!heroAlpha) return false; // Preserve existing visible artwork if its public metadata is unavailable.
    const target = subject(hero, heroAlpha, false).height;
    const scales: string[] = [];
    let changed = false;
    for (const image of all) {
      const avatar = image.closest<HTMLElement>('.seat__avatar')!;
      const seat = image.closest<HTMLElement>('.seat')!;
      if (image === hero) {
        avatar.style.removeProperty('--sp-opponent-art-scale');
        continue;
      }
      const own = resolved.get(source(image));
      if (!own) continue;
      const factor = target / subject(image, own, false).height;
      const value = factor.toFixed(6);
      if (avatar.style.getPropertyValue('--sp-opponent-art-scale') !== value) {
        avatar.style.setProperty('--sp-opponent-art-scale', value);
        changed = true;
        seat.dispatchEvent(new Event('opponentavatarresize'));
      }
      scales.push(`${seat.dataset.playerId}:${image.currentSrc || image.src}:${value}`);
    }
    if (state.lowerLaneKey) {
      const limits = lowerLaneLimits();
      const signature = limits ? `${limits.top}:${limits.bottom}` : '';
      if (signature !== state.lowerLaneKey) {
        const lowerSeats = Array.from(
          scaler.querySelectorAll<HTMLElement>('.seat[data-opponent-lane="lower"]')
        );
        const heroParts = [
          ...paintedParts(hero),
          ...Array.from(
            page.querySelectorAll(
              '.seat--hero .seat__info,.seat--hero .seat__action,.seat--hero .seat__bounty,.seat--hero .seat__position-badge,.seat--hero .seat__cards .seat__card'
            )
          )
            .map(box)
            .filter((part) => part.width > 0 && part.height > 0),
        ];
        const stillClear =
          limits &&
          lowerSeats.every((seat) => {
            const image = seat.querySelector<HTMLImageElement>('.seat__avatar-img');
            const parts = [
              ...(image ? paintedParts(image) : []),
              ...Array.from(
                seat.querySelectorAll(
                  ':scope > .seat__info,:scope > .seat__action,:scope > .seat__bounty,.seat__position-badge'
                )
              )
                .map(box)
                .filter((part) => part.width > 0 && part.height > 0),
            ];
            return opponentFitsLowerLane(parts, limits, heroParts);
          });
        // A changed caption/board boundary does not move an already clear pod.
        // Only an actual obstruction returns to the existing finite allocator.
        if (!stillClear) state.key = '';
        state.lowerLaneKey = stillClear && lowerSeats.length ? signature : undefined;
      }
    }
    const key = `${scaler.clientWidth}:${scaler.clientHeight}:${page.clientWidth}:${page.clientHeight}:${target.toFixed(2)}:${scales.join('|')}`;
    if (state.key !== key) {
      changed = true;
      state.key = key;
      state.shifts = new WeakMap();
      state.lowerLaneKey = undefined;
      state.idleReservedKey = undefined;
      scaler
        .querySelectorAll<HTMLElement>('.seat:not(.seat--hero) > .seat__action')
        .forEach((action) => action.style.removeProperty('translate'));
      scaler.querySelectorAll<HTMLElement>('.seat').forEach((seat) => {
        delete seat.dataset.opponentLane;
        seat.style.removeProperty('--sp-opponent-x');
        seat.style.removeProperty('--sp-opponent-y');
      });
    }
    // SeatSlot measures caption clearance on the existing animation frame.
    // Allocate once that permanent artwork rise has reached its caption.
    spacingReady = !changed;
    if (changed) schedule();
    return changed;
  };
  const tryShiftOwnerForWager = (seat: HTMLElement, deltaY: number, accept: () => boolean) => {
    const old = state.shifts.get(seat);
    if (!old || !Number.isFinite(deltaY) || seat.classList.contains('seat--hero')) return false;
    const ratio = tableRenderScale(scaler);
    const parts = (owner: HTMLElement): Box[] => {
      const image = owner.querySelector<HTMLImageElement>('.seat__avatar-img');
      const own = image && resolved.get(source(image));
      return [
        ...(image && own ? paintedParts(image) : []),
        ...Array.from(
          owner.querySelectorAll(
            ':scope > .seat__info,:scope > .seat__action,:scope > .seat__bounty,.seat__position-badge'
          )
        )
          .map(box)
          .filter((r) => r.width > 0 && r.height > 0),
      ];
    };
    const pageBox = box(page);
    const header = page
      .closest('.multi-table-page')
      ?.querySelector('.multi-table-page__tab-bar-wrapper');
    const top = header ? box(header).top + box(header).height + 0.5 : pageBox.top + 0.5;
    const fixed = Array.from(
      page.querySelectorAll(
        '.community-area,.bbj-widget,.bbj-mini-plate,.mtp-lobby-btn,.chat-collapsed,.seat--hero .seat__info,.seat--hero .seat__action,.seat--hero .seat__bounty,.seat--hero .seat__position-badge,.seat--hero .seat__cards .seat__card,.action-panel-wrapper,.tournament-hud'
      )
    )
      .map(box)
      .filter((r) => r.width > 0 && r.height > 0);
    const hero = images().find((image) => image.closest('.seat--hero'));
    if (hero && resolved.get(source(hero))) fixed.push(...paintedParts(hero));
    const seats = Array.from(
      scaler.querySelectorAll<HTMLElement>('.seat:not(.seat--hero):not(.seat--empty)')
    );
    if (seats.some((other) => !state.shifts.has(other))) return false;
    const board = page.querySelector('.community-area');
    const lowerLane = lowerLaneLimits();
    if (!lowerLane && seats.some((other) => other.dataset.opponentLane === 'lower')) return false;
    const pods = seats.map((other) => ({
      parts: parts(other),
      peerParts: (() => {
        const image = other.querySelector<HTMLImageElement>('.seat__avatar-img');
        const staticParts = parts(other);
        const count = image ? paintedParts(image).length : 0;
        return image ? [...peerPaint(image), ...staticParts.slice(count)] : staticParts;
      })(),
      laneTop: other.dataset.opponentLane === 'lower' ? lowerLane?.top : undefined,
      laneBottom: other.dataset.opponentLane === 'lower' ? lowerLane?.bottom : undefined,
      capBottom:
        board &&
        (other.dataset.opponentLane === 'cap' ||
          (page.getAttribute('data-seats') === '9' &&
            other.closest('.seat-wrapper--cap,.seat-wrapper--top')))
          ? box(board).top
          : undefined,
    }));
    // A wager may make room locally, never move a chair to another row or
    // leap over the board. The same bound applies to each contacted peer.
    const maximumMotion = pods.map(({ parts }) =>
      parts.length
        ? (Math.max(...parts.map((p) => p.top + p.height)) - Math.min(...parts.map((p) => p.top))) /
          2
        : 0
    );
    const changes = pushOpponentChain(
      pods,
      seats.indexOf(seat),
      deltaY,
      fixed,
      {
        left: pageBox.left + 2,
        top,
        width: pageBox.width - 4,
        height: pageBox.top + pageBox.height - top - 3,
      },
      maximumMotion
    );

    if (!changes) return false;
    return opponentShiftTransaction(seats, state.shifts, () => {
      for (let i = 0; i < seats.length; i++) {
        if (!changes[i]) continue;
        const other = seats[i];
        // Compose with an outer uncommitted proposal's actual position.
        const current = parseFloat(other.style.getPropertyValue('--sp-opponent-y')) || 0;
        other.style.setProperty('--sp-opponent-y', `${current + changes[i] / ratio}px`);
      }
      return accept();
    });
  };
  const captionRaiseBounds = (seat: HTMLElement) => {
    if (!compactAllIn() || seat.classList.contains('seat--hero')) return null;
    const info = seat.querySelector<HTMLElement>(':scope > .seat__info');
    const image = seat.querySelector<HTMLImageElement>('.seat__avatar-img');
    const parts = image ? paintedParts(image) : [];
    if (!info || !parts.length) return null;
    const top = Math.min(...parts.map((part) => part.top));
    const bottom = Math.max(...parts.map((part) => part.top + part.height));
    const left = Math.min(...parts.map((part) => part.left));
    const right = Math.max(...parts.map((part) => part.left + part.width));
    return opponentCaptionBounds(box(info), {
      left,
      top,
      width: right - left,
      height: bottom - top,
    });
  };
  const tryRaiseCaptionForWager = (
    seat: HTMLElement,
    wagerTop: number,
    accept: () => boolean
  ): boolean => {
    const limits = captionRaiseBounds(seat);
    // wagerTop is the future wager's top edge, not the requested INFO top.
    // A caller staging a pod movement subtracts that movement from wagerTop.
    if (!limits || !Number.isFinite(wagerTop)) return false;
    const raise = Math.max(0, limits.info.top + limits.info.height + 2 - wagerTop);
    if (raise <= 0.0001 || raise > limits.maxRaise + 0.0001) return false;
    const seats = Array.from(
      scaler.querySelectorAll<HTMLElement>('.seat:not(.seat--hero):not(.seat--empty)')
    );
    const info = seat.querySelector<HTMLElement>(':scope > .seat__info')!;
    const action = seat.querySelector<HTMLElement>(':scope > .seat__action');
    const ratio = tableRenderScale(scaler);
    const shift = (element: HTMLElement, delta: number) => {
      const axes = element.style.getPropertyValue('translate').split(/\s+/).map(parseFloat);
      element.style.setProperty(
        'translate',
        `${axes[0] || 0}px ${(axes[1] || 0) + delta / ratio}px`
      );
    };
    const originalPot = Array.from(page.querySelectorAll('.pot-display,.pot-display__pile')).map(
      box
    );
    const area = (a: Box, b: Box) =>
      Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)) *
      Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
    const potAreas = originalPot.map((pot) => area(limits.info, pot));
    return opponentShiftTransaction(seats, state.shifts, () => {
      shift(info, -raise);
      if (action) {
        const a = box(action),
          p = box(info);
        const delta = Math.min(0, p.top - a.height - 3 - a.top);
        if (delta) shift(action, delta);
        if (fullRingShowdown()) {
          const cards = Array.from(seat.querySelectorAll('.seat__cards--revealed .seat__card'))
            .map(box)
            .filter((card) => card.width > 0 && card.height > 0);
          const current = box(action);
          if (cards.some((card) => overlap(current, card, 0)))
            shift(
              action,
              Math.min(...cards.map((card) => card.top)) - current.height - 3 - current.top
            );
        }
      }
      if (!accept()) return false;
      const finalLimits = captionRaiseBounds(seat);
      if (!finalLimits || box(info).top < finalLimits.minTop - 0.0001) return false;
      const pageBox = box(page);
      const header = page
        .closest('.multi-table-page')
        ?.querySelector('.multi-table-page__tab-bar-wrapper');
      const top = header ? box(header).top + box(header).height + 0.5 : pageBox.top + 0.5;
      const visible = (element: Element) => {
        const style = getComputedStyle(element);
        return (
          style.visibility !== 'hidden' &&
          style.display !== 'none' &&
          parseFloat(style.opacity) !== 0
        );
      };
      const fixed = Array.from(
        page.querySelectorAll(
          '.community-area,.bbj-widget,.bbj-mini-plate,.mtp-lobby-btn,.chat-collapsed,.action-panel-wrapper,.tournament-hud,.dealer-button,.seat__cards--revealed .seat__card,.seat--hero .seat__cards .seat__card'
        )
      )
        .filter(visible)
        .map(box)
        .filter((r) => r.width > 0 && r.height > 0);
      const foreign = Array.from(
        scaler.querySelectorAll<HTMLElement>(
          '.seat__info,.seat__action,.seat__bounty,.seat__position-badge'
        )
      )
        .filter((element) => element !== info && element !== action && visible(element))
        .map(box)
        .filter((r) => r.width > 0 && r.height > 0);
      const peerTests = images()
        .filter((image) => !seat.contains(image) && visible(image))
        .map((image) => preparePaintedTouch(image));
      const facts = [info, ...(action ? [action] : [])];
      for (const fact of facts) {
        const r = box(fact);
        if (
          r.left < pageBox.left + 2 - 0.0001 ||
          r.left + r.width > pageBox.left + pageBox.width - 2 + 0.0001 ||
          r.top < top - 0.0001 ||
          r.top + r.height > pageBox.top + pageBox.height - 3 + 0.0001
        )
          return false;
        if (
          [...fixed, ...foreign].some(
            (other) =>
              Math.min(r.left + r.width, other.left + other.width) - Math.max(r.left, other.left) >
                0.0001 &&
              Math.min(r.top + r.height, other.top + other.height) - Math.max(r.top, other.top) >
                0.0001
          )
        )
          return false;
        if (peerTests.some((touches) => touches(r, 0))) return false;
        if (fact === action && originalPot.some((pot) => overlap(r, pot, 0))) return false;
      }
      // Preserve existing raw-width pot/name overlap; never create more of it.
      if (originalPot.some((pot, i) => area(box(info), pot) > potAreas[i] + 0.001)) return false;
      return true;
    });
  };
  const reservePeerIdle = () => {
    if (!compactAllIn() || !state.key || state.idleReservedKey === state.key) return false;
    const seats = Array.from(
      scaler.querySelectorAll<HTMLElement>('.seat:not(.seat--hero):not(.seat--empty)')
    );
    if (seats.some((seat) => !state.shifts.has(seat))) return false;
    state.idleReservedKey = state.key;
    let changed = false;
    // One finite contact pass belongs to this original compact allocation.
    for (let pass = 0; pass < seats.length; pass++) {
      let advanced = false;
      for (const seat of seats) {
        const image = seat.querySelector<HTMLImageElement>('.seat__avatar-img');
        if (!image) continue;
        const touches = preparePaintedTouch(image);
        const targets = seats
          .filter((peer) => peer !== seat)
          .flatMap((peer) =>
            Array.from(
              peer.querySelectorAll(
                ':scope > .seat__info,:scope > .seat__action,:scope > .seat__bounty,.seat__position-badge'
              )
            ).map(box)
          )
          .filter((r) => r.width > 0 && r.height > 0);
        const target = targets.find((r) => touches(r, 0));
        if (!target) continue;
        const parts = peerPaint(image).filter((part) => overlap(part, target, 0));
        if (!parts.length) continue;
        const centre =
          parts.reduce((sum, part) => sum + part.top + part.height / 2, 0) / parts.length;
        const down = centre >= target.top + target.height / 2;
        const delta = down
          ? Math.max(...parts.map((part) => target.top + target.height - part.top)) + 0.001
          : Math.min(...parts.map((part) => target.top - part.top - part.height)) - 0.001;
        if (tryShiftOwnerForWager(seat, delta, () => !preparePaintedTouch(image)(target, 0))) {
          changed = true;
          advanced = true;
          break;
        }
      }
      if (!advanced) break;
    }
    return changed;
  };
  const space = () => {
    if (!state.key || !spacingReady) return false;
    // An arriving caption/character has no resting rectangle yet. Let its
    // existing animationend event request the first allocation; infinite
    // breathing remains visible and never delays the permanent layout.
    const entering = Array.from(
      scaler.querySelectorAll<HTMLElement>('.seat:not(.seat--hero)')
    ).some((seat) => {
      if (state.shifts.has(seat)) return false;
      const animations = [
        ...seat.getAnimations(),
        ...Array.from(
          seat.querySelectorAll<HTMLElement>('.seat__avatar-wrap,.seat__action')
        ).flatMap((element) => element.getAnimations({ subtree: true })),
      ].filter(
        (animation) =>
          animation.playState === 'running' &&
          Number.isFinite(animation.effect?.getComputedTiming().iterations)
      );
      for (const animation of animations)
        if (!observedAnimations.has(animation)) {
          observedAnimations.add(animation);
          // WAAPI entry animations have no DOM animationend. Resume this
          // finite placement once, only while its owning table is mounted.
          const completed = () => {
            if (active) schedule();
          };
          void animation.finished.then(completed, completed);
        }
      return animations.length > 0;
    });
    if (entering) {
      spacingReady = false;
      return false;
    }
    let changed = false;
    const ratio = tableRenderScale(scaler);
    const pageBox = box(page);
    const header = page
      .closest('.multi-table-page')
      ?.querySelector('.multi-table-page__tab-bar-wrapper');
    const top = header ? box(header).top + box(header).height + 0.5 : pageBox.top + 0.5;
    const bounds = {
      left: pageBox.left + 2,
      top,
      width: pageBox.width - 4,
      height: pageBox.top + pageBox.height - top - 3,
    };
    const fixed = Array.from(
      page.querySelectorAll(
        '.community-area,.bbj-widget,.bbj-mini-plate,.mtp-lobby-btn,.chat-collapsed,.seat--hero .seat__info,.seat--hero .seat__action,.seat--hero .seat__bounty,.seat--hero .seat__position-badge,.seat--hero .seat__cards .seat__card,.action-panel-wrapper,.tournament-hud'
      )
    )
      .map(box)
      .filter((r) => r.width > 0 && r.height > 0);
    const heroImage = images().find((image) => image.closest('.seat--hero'));
    if (heroImage && resolved.get(source(heroImage))) fixed.push(...paintedParts(heroImage));
    const seats = Array.from(
      scaler.querySelectorAll<HTMLElement>('.seat:not(.seat--hero):not(.seat--empty)')
    );
    const parts = (seat: HTMLElement) => {
      const image = seat.querySelector<HTMLImageElement>('.seat__avatar-img');
      const own = image && resolved.get(source(image));
      return [
        ...(image && own ? paintedParts(image) : []),
        ...Array.from(
          seat.querySelectorAll(
            ':scope > .seat__info,:scope > .seat__action,:scope > .seat__bounty,.seat__position-badge'
          )
        )
          .map(box)
          .filter((r) => r.width > 0 && r.height > 0),
      ];
    };
    // A late pot-amount paint may grow after the ring was cached. Move only
    // an obstructed compact caption, inside its own unchanged character/plate
    // extent; never turn the whole pot into an avatar-body exclusion.
    const clearPotCaptions = () => {
      const pots = Array.from(page.querySelectorAll('.pot-display,.pot-display__pile'))
        .map(box)
        .filter((p) => p.width > 0 && p.height > 0);
      let movedCaption = false;
      for (const seat of seats) {
        const action = seat.querySelector<HTMLElement>(':scope > .seat__action');
        if (!action?.style.translate || !pots.some((pot) => overlap(box(action), pot, 0))) continue;
        const image = seat.querySelector<HTMLImageElement>('.seat__avatar-img');
        const own = [
          ...(image ? paintedParts(image) : []),
          ...Array.from(seat.querySelectorAll(':scope > .seat__info')).map(box),
        ].filter((p) => p.width > 0 && p.height > 0);
        if (!own.length) continue;
        const left = Math.max(bounds.left, Math.min(...own.map((p) => p.left)));
        const top = Math.max(bounds.top, Math.min(...own.map((p) => p.top)));
        const right = Math.min(
          bounds.left + bounds.width,
          Math.max(...own.map((p) => p.left + p.width))
        );
        const bottom = Math.min(
          bounds.top + bounds.height,
          Math.max(...own.map((p) => p.top + p.height))
        );
        const obstacles = [
          ...fixed,
          ...pots,
          ...Array.from(page.querySelectorAll('.seat__cards--revealed .seat__card')).map(box),
          ...seats
            .filter((other) => other !== seat)
            .flatMap((other) => {
              const art = other.querySelector<HTMLImageElement>('.seat__avatar-img');
              return [
                ...(art ? peerPaint(art) : []),
                ...Array.from(
                  other.querySelectorAll(
                    ':scope > .seat__info,:scope > .seat__action,:scope > .seat__bounty,.seat__position-badge'
                  )
                ).map(box),
              ];
            }),
        ].filter((p) => p.width > 0 && p.height > 0);
        const shift = opponentShiftCandidates(
          [box(action)],
          obstacles,
          { left, top, width: right - left, height: bottom - top },
          0,
          false,
          [],
          0.5
        )[0];
        if (!shift) continue;
        const current = action.style.translate.split(/\s+/).map(parseFloat);
        action.style.translate = `${(current[0] || 0) + shift[0] / ratio}px ${(current[1] || 0) + shift[1] / ratio}px`;
        movedCaption = true;
      }
      return movedCaption;
    };
    if (seats.every((seat) => state.shifts.has(seat))) {
      const facts = clearPotCaptions();
      return reservePeerIdle() || facts;
    }
    // Retry a not-yet-fitted ring from its original captions, so a fallback
    // displacement is never compounded by another metadata/layout event.
    for (const seat of seats)
      seat.querySelector<HTMLElement>(':scope > .seat__action')?.style.removeProperty('translate');
    // Stable top-first input makes equal-cost solutions reproducible.
    const ordered = seats
      .map((seat) => ({ seat, parts: parts(seat) }))
      .filter((item) => item.parts.length > 0)
      .sort((a, b) => a.parts[0].top - b.parts[0].top || a.parts[0].left - b.parts[0].left);
    for (const seat of seats) {
      if (!ordered.some((item) => item.seat === seat)) {
        delete seat.dataset.opponentLane;
        seat.style.setProperty('--sp-opponent-x', '0px');
        seat.style.setProperty('--sp-opponent-y', '0px');
        state.shifts.set(seat, [0, 0]);
      }
    }
    if (!ordered.length) return false;
    const describe = () =>
      ordered.map(({ seat }) => ({
        parts: parts(seat),
        side:
          page.getAttribute('data-seats') === '6' &&
          seat.closest('.seat-wrapper--top,.seat-wrapper--cap')
            ? 0
            : Math.sign(box(seat).left + box(seat).width / 2 - pageBox.left - pageBox.width / 2),
        outwardOnly: !seat.closest('.seat-wrapper--cap,.seat-wrapper--top'),
      }));
    let shifts = jointOpponentShifts(describe(), fixed, bounds);
    if (!shifts) {
      // Only the compact ring needs this fallback: the same caption fits
      // above its own plate on the lower bust, retaining all existing sizes.
      for (const { seat } of ordered) {
        const action = seat.querySelector<HTMLElement>(':scope > .seat__action');
        const info = seat.querySelector<HTMLElement>(':scope > .seat__info');
        if (action && info) {
          const a = box(action),
            p = box(info);
          action.style.translate = `0px ${(p.top - a.height - 3 - a.top) / ratio}px`;
        }
      }
      shifts = jointOpponentShifts(describe(), fixed, bounds, 0.5, true);
    }
    const board = page.querySelector('.community-area');
    const topLaneBottom = board ? box(board).top : top;
    if (!shifts) {
      // Last compact fit: plates may meet edge to edge. An edge chair can
      // join the top lane only with its whole pod above the unchanged board.
      shifts = jointOpponentShifts(describe(), fixed, bounds, 0, true, topLaneBottom);
    }
    let lowerLane: { top: number; bottom: number } | undefined;
    if (!shifts) {
      // Broad characters can need the clear lane below the board. Preserve
      // three pixels at both ends plus two CSS layout quanta for round-trip
      // positioning. Hero, cards, table and panel sizes remain unchanged.
      lowerLane = lowerLaneLimits(1 / 32) ?? undefined;
      if (lowerLane)
        shifts = jointOpponentShifts(describe(), fixed, bounds, 3, true, topLaneBottom, lowerLane);
    }
    if (!shifts) {
      spacingReady = false;
      return false;
    }
    const descriptions = describe();
    for (let i = 0; i < ordered.length; i++) {
      const seat = ordered[i].seat;
      const item = descriptions[i];
      if (!item.parts.length) {
        delete seat.dataset.opponentLane;
        seat.style.setProperty('--sp-opponent-x', '0px');
        seat.style.setProperty('--sp-opponent-y', '0px');
        state.shifts.set(seat, [0, 0]);
        continue;
      }
      const clamp =
        item.side < 0
          ? Math.max(0, bounds.left - Math.min(...item.parts.map((p) => p.left)))
          : Math.max(
              0,
              Math.max(...item.parts.map((p) => p.left + p.width)) - bounds.left - bounds.width
            );
      const inward = item.outwardOnly && shifts[i][0] * item.side < -clamp - 0.01;
      const high = Math.max(...item.parts.map((p) => p.top + p.height + shifts[i][1]));
      const low = Math.min(...item.parts.map((p) => p.top + shifts[i][1]));
      if (inward && high <= topLaneBottom) seat.dataset.opponentLane = 'cap';
      else if (inward && lowerLane && low >= lowerLane.top && high <= lowerLane.bottom)
        seat.dataset.opponentLane = 'lower';
      else delete seat.dataset.opponentLane;
      const local: [number, number] = [shifts[i][0] / ratio, shifts[i][1] / ratio];
      seat.style.setProperty('--sp-opponent-x', `${local[0]}px`);
      seat.style.setProperty('--sp-opponent-y', `${local[1]}px`);
      state.shifts.set(seat, local);
      changed ||= Math.abs(local[0]) > 0.01 || Math.abs(local[1]) > 0.01;
    }
    const usedLowerLane = ordered.some(({ seat }) => seat.dataset.opponentLane === 'lower');
    const currentLimits = usedLowerLane ? lowerLaneLimits() : null;
    state.lowerLaneKey = currentLimits ? `${currentLimits.top}:${currentLimits.bottom}` : undefined;
    const facts = clearPotCaptions();
    return reservePeerIdle() || facts || changed;
  };
  return {
    prepare,
    space,
    ready: () => spacingReady && Boolean(state.key),
    awaitingMetadata: () =>
      images().some(
        (image) => image.complete && image.naturalWidth > 0 && !resolved.has(source(image))
      ),
    // A zero-candidate wager may need its own opponent to leave a little
    // room on the felt. This belongs to the original allocation transaction:
    // no timer, retry event, or independent layout pass is scheduled here.
    tryShiftOwnerForWager,
    captionRaiseBounds,
    tryRaiseCaptionForWager,
    preparePaintedTouch,
    paintedTouches: (image: HTMLImageElement, target: Box, gap = 0, permanent = true): boolean =>
      preparePaintedTouch(image, permanent)(target, gap),
    paintedParts,
    paintedBox: (image: HTMLImageElement, permanent = false) => {
      const own = resolved.get(source(image));
      const ratio = tableRenderScale(scaler);
      return own
        ? subject(image, own, true, permanent ? restingAvatarBox(image, ratio) : undefined)
        : null;
    },
    paintedObstacles: () =>
      images().flatMap((image) => {
        const own = resolved.get(source(image));
        return own ? [subject(image, own, true)] : [];
      }),
    stop: () => {
      active = false;
    },
  };
}
