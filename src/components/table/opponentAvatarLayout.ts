import { restingAvatarBox, tableRenderScale } from './avatarCrownBounds';
/** Opponent artwork only: the hero, slot dimensions and table tokens stay owned
 * by their existing renderers. Image metadata never changes the source image. */
type Alpha = { left: number; top: number; right: number; bottom: number; bands?: Alpha[] };
type Box = { left: number; top: number; width: number; height: number };
export type OpponentAvatarState = { key: string; shifts: WeakMap<HTMLElement, [number, number]> };
const metadata = new Map<string, Promise<Alpha | null>>();
const box = (element: Element): Box => {
  const r = element.getBoundingClientRect();
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
  const candidates: Array<[number, number]> = [];
  for (const x of xs)
    for (const y of ys) {
      if (outwardOnly && side) {
        // Enlarged edge artwork may require only the minimum inward clamp
        // that puts its paint back inside this viewport. It may never move
        // farther inward merely to escape another rail obstacle.
        const inward =
          side < 0
            ? Math.max(0, bounds.left - Math.min(...parts.map((part) => part.left)))
            : Math.max(
                0,
                Math.max(...parts.map((part) => part.left + part.width)) -
                  bounds.left -
                  bounds.width
              );
        if (x * side < -inward - 0.01) continue;
      }

      const centre = parts[0].left + parts[0].width / 2 + x;
      if (side && (centre - bounds.left - bounds.width / 2) * side < 0) continue;
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
      ) {
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
  topLaneBottom?: number
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
        .filter(({ item }) => item.outwardOnly && item.side === side)
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
    let ys = items.map(
      (item, i) =>
        new Set([
          ...seedYs[i],
          0,
          ...options[i].map((shift) => shift[1]),
          bounds.top - Math.min(...item.parts.map((part) => part.top)),
          bounds.top +
            bounds.height -
            Math.max(...item.parts.map((part) => part.top + part.height)),
        ])
    );
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
        items.map(
          (item) =>
            Math.max(...item.parts.map((p) => p.left + p.width)) -
            Math.min(...item.parts.map((p) => p.left))
        )
      ),
    ];
    let anchors = new Set([bounds.left, bounds.left + bounds.width]);
    if (topLaneBottom !== undefined)
      for (let round = 0; round < 3; round++) {
        const next = new Set(anchors);
        for (const edge of anchors)
          for (const width of widths)
            for (const x of [edge + width, edge - width])
              if (x >= bounds.left && x <= bounds.left + bounds.width)
                next.add(Math.round(x * 1e6) / 1e6);
        anchors = new Set([...next].slice(0, 256));
      }
    items.forEach((item, i) => {
      const low = Math.min(...item.parts.map((p) => p.left)),
        high = Math.max(...item.parts.map((p) => p.left + p.width));
      const xs =
        topLaneBottom === undefined
          ? [0]
          : [...new Set([0, ...[...anchors].flatMap((x) => [x - low, x - high])])];
      const extra = xs
        .flatMap((x) => [...ys[i]].map((y): [number, number] => [x, y]))
        .filter(([x, y]) => {
          // Keep this last fallback local to its original chair. Searching
          // distant rows consumes the finite budget on unnecessary movement.
          if (
            topLaneBottom !== undefined &&
            Math.abs(y) >
              (Math.max(...item.parts.map((p) => p.top + p.height)) -
                Math.min(...item.parts.map((p) => p.top))) /
                2
          )
            return false;
          if (
            item.side &&
            (item.parts[0].left + item.parts[0].width / 2 + x - bounds.left - bounds.width / 2) *
              item.side <
              0
          )
            return false;
          if (
            topLaneBottom !== undefined &&
            item.outwardOnly &&
            x * item.side < -0.01 &&
            Math.max(...item.parts.map((p) => p.top + p.height + y)) > topLaneBottom
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
                ([x, y]) =>
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
        .filter(
          ([x, y]) =>
            topLaneBottom === undefined ||
            ((!item.outwardOnly ||
              x * item.side >= -0.01 ||
              Math.max(...item.parts.map((p) => p.top + p.height + y)) <= topLaneBottom) &&
              Math.abs(y) <=
                (Math.max(...item.parts.map((p) => p.top + p.height)) -
                  Math.min(...item.parts.map((p) => p.top))) /
                  2)
        )
        .sort((a, b) => a[0] * a[0] + a[1] * a[1] - b[0] * b[0] - b[1] * b[1])
        .filter((shift) => {
          const key = shift.join(':');
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      const seedKeys = new Set<string>();
      const uniqueSeeds = seeds.filter((shift) => {
        const key = shift.join(':');
        if (seedKeys.has(key) || seedKeys.size >= 384) return false;
        seedKeys.add(key);
        return true;
      });
      options[i] = [
        ...candidates
          .filter((shift) => !seedKeys.has(shift.join(':')))
          .slice(0, Math.max(0, 384 - uniqueSeeds.length)),
        ...uniqueSeeds,
      ].sort((a, b) => a[0] * a[0] + a[1] * a[1] - b[0] * b[0] - b[1] * b[1]);
    });
  }
  const shapes = items.map((item, i) =>
    options[i].map((shift) => item.parts.map((part) => moved(part, ...shift)))
  );
  const costs = options.map((list) => list.map(([x, y]) => x * x + y * y));
  // Pair geometry is immutable for this allocation. Compute it once instead
  // of rebuilding every composite rectangle inside each search branch.
  const compatibility: Array<Array<Uint8Array | undefined>> = items.map(() => []);
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) {
      const table = new Uint8Array(options[i].length * options[j].length);
      for (let a = 0; a < options[i].length; a++)
        for (let b = 0; b < options[j].length; b++)
          table[a * options[j].length + b] = Number(
            shapes[i][a].every((part) => shapes[j][b].every((peer) => !overlap(part, peer, gap)))
          );
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

/** Push only directly intersecting neighbours in the requested direction.
 * This finite contact cascade is part of one wager-placement transaction. */
export function pushOpponentChain(
  items: Array<{ parts: Box[]; capBottom?: number }>,
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
  const shifted = (i: number) => items[i].parts.map((p) => moved(p, 0, shifts[i]));
  const valid = (i: number) =>
    Math.abs(shifts[i]) <= (maximumMotion?.[i] ?? Infinity) &&
    shifted(i).every(
      (p) =>
        p.left >= bounds.left &&
        p.left + p.width <= bounds.left + bounds.width &&
        p.top >= bounds.top &&
        p.top + p.height <= bounds.top + bounds.height &&
        (items[i].capBottom === undefined || p.top + p.height <= items[i].capBottom!) &&
        fixed.every((obstacle) => !overlap(p, obstacle, 0))
    );
  for (let step = 0; step < items.length * items.length * 4; step++) {
    if (!items.every((_, i) => valid(i))) return null;
    let advanced = false;
    for (let i = 0; i < items.length && !advanced; i++) {
      if (!shifts[i]) continue;
      const source = shifted(i);
      for (let k = 0; k < items.length; k++) {
        if (i === k) continue;
        const target = shifted(k);
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
                ? p.top + p.height - items[k].parts[q].top + 0.001
                : p.top - items[k].parts[q].top - items[k].parts[q].height - 0.001;
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
    const transform = style.transform === 'none' ? 1 : new DOMMatrix(style.transform).d;
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
  const prepare = () => {
    spacingReady = false;
    const all = images().filter((image) => image.complete && image.naturalWidth > 0);
    const hero = all.find((image) => image.closest('.seat--hero'));
    if (!hero) {
      state.key = '';
      state.shifts = new WeakMap();
      scaler.querySelectorAll<HTMLElement>('.seat,.seat__avatar').forEach((element) => {
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
          if (active && image.isConnected) {
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
    const key = `${scaler.clientWidth}:${scaler.clientHeight}:${page.clientWidth}:${page.clientHeight}:${target.toFixed(2)}:${scales.join('|')}`;
    if (state.key !== key) {
      changed = true;
      state.key = key;
      state.shifts = new WeakMap();
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
        '.community-area,.bbj-widget,.bbj-mini-plate,.mtp-lobby-btn,.chat-collapsed,.seat--hero .seat__info,.seat--hero .seat__cards .seat__card,.action-panel-wrapper,.tournament-hud'
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
    if (seats.every((seat) => state.shifts.has(seat))) return false;
    // Retry a not-yet-fitted ring from its original captions, so a fallback
    // displacement is never compounded by another metadata/layout event.
    for (const seat of seats)
      seat.querySelector<HTMLElement>(':scope > .seat__action')?.style.removeProperty('translate');
    // Stable top-first input makes equal-cost solutions reproducible.
    const ordered = seats
      .map((seat) => ({ seat, parts: parts(seat) }))
      .sort((a, b) => a.parts[0].top - b.parts[0].top || a.parts[0].left - b.parts[0].left);
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
    if (!shifts) {
      spacingReady = false;
      return false;
    }
    const descriptions = describe();
    for (let i = 0; i < ordered.length; i++) {
      const seat = ordered[i].seat;
      const item = descriptions[i];
      if (
        item.outwardOnly &&
        shifts[i][0] * item.side < -0.01 &&
        Math.max(...item.parts.map((p) => p.top + p.height + shifts[i][1])) <= topLaneBottom
      )
        seat.dataset.opponentLane = 'cap';
      else delete seat.dataset.opponentLane;
      const local: [number, number] = [shifts[i][0] / ratio, shifts[i][1] / ratio];
      seat.style.setProperty('--sp-opponent-x', `${local[0]}px`);
      seat.style.setProperty('--sp-opponent-y', `${local[1]}px`);
      state.shifts.set(seat, local);
      changed ||= Math.abs(local[0]) > 0.01 || Math.abs(local[1]) > 0.01;
    }
    return changed;
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
    tryShiftOwnerForWager: (seat: HTMLElement, deltaY: number, accept: () => boolean) => {
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
          '.community-area,.bbj-widget,.bbj-mini-plate,.mtp-lobby-btn,.chat-collapsed,.seat--hero .seat__info,.seat--hero .seat__cards .seat__card,.action-panel-wrapper,.tournament-hud'
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
      const pods = seats.map((other) => ({
        parts: parts(other),
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
          ? (Math.max(...parts.map((p) => p.top + p.height)) -
              Math.min(...parts.map((p) => p.top))) /
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
      const trials = seats.flatMap((other, i) => {
        if (!changes[i]) return [];
        const before = state.shifts.get(other)!;
        const next: [number, number] = [before[0], before[1] + changes[i] / ratio];
        return [{ other, before, next, previous: other.style.getPropertyValue('--sp-opponent-y') }];
      });
      for (const trial of trials)
        trial.other.style.setProperty('--sp-opponent-y', `${trial.next[1]}px`);
      let accepted = false;
      try {
        accepted = accept();
        if (accepted) for (const trial of trials) state.shifts.set(trial.other, trial.next);
        return accepted;
      } finally {
        if (!accepted)
          for (const trial of trials) {
            if (trial.previous) trial.other.style.setProperty('--sp-opponent-y', trial.previous);
            else trial.other.style.removeProperty('--sp-opponent-y');
          }
      }
    },
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
