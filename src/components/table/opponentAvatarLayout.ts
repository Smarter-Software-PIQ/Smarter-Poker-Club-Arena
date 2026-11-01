/** Opponent artwork only: the hero, slot dimensions and table tokens stay owned
 * by their existing renderers. Image metadata never changes the source image. */
type Alpha = { left: number; top: number; right: number; bottom: number };
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
export function nearestOpponentShift(
  parts: Box[],
  obstacles: Box[],
  bounds: Box,
  side: number
): [number, number] | null {
  if (!parts.length) return [0, 0];
  const xs = new Set([0]);
  const ys = new Set([0]);
  for (const part of parts) {
    xs.add(bounds.left - part.left);
    xs.add(bounds.left + bounds.width - part.left - part.width);
    ys.add(bounds.top - part.top);
    ys.add(bounds.top + bounds.height - part.top - part.height);
    for (const other of obstacles) {
      if (part.top < other.top + other.height + 3 && part.top + part.height + 3 > other.top) {
        xs.add(other.left - part.left - part.width - 3);
        xs.add(other.left + other.width - part.left + 3);
      }
      if (part.left < other.left + other.width + 3 && part.left + part.width + 3 > other.left) {
        ys.add(other.top - part.top - part.height - 3);
        ys.add(other.top + other.height - part.top + 3);
      }
    }
  }
  let best: [number, number] | null = null;
  let distance = Infinity;
  for (const x of xs)
    for (const y of ys) {
      const d = x * x + y * y;
      if (d >= distance) continue;
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
            obstacles.every((other) => !overlap(next, other))
          );
        })
      ) {
        best = [x, y];
        distance = d;
      }
    }
  return best;
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
    let left = canvas.width,
      top = canvas.height,
      right = 0,
      bottom = 0;
    for (let y = 0; y < canvas.height; y++)
      for (let x = 0; x < canvas.width; x++) {
        if (pixels[(y * canvas.width + x) * 4 + 3] <= 12) continue;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x + 1);
        bottom = Math.max(bottom, y + 1);
      }
    return bottom > top
      ? {
          left: left / canvas.width,
          top: top / canvas.height,
          right: right / canvas.width,
          bottom: bottom / canvas.height,
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

function subject(image: HTMLImageElement, a: Alpha, rendered: boolean): Box {
  const style = getComputedStyle(image);
  const rect = rendered
    ? box(image)
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
  const resolved = new Map<string, Alpha | null>();
  const pending = new Set<string>();
  const source = (image: HTMLImageElement) => image.currentSrc || image.src;
  let spacingReady = false;
  const images = () => Array.from(scaler.querySelectorAll<HTMLImageElement>('.seat__avatar-img'));
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
      scaler.querySelectorAll<HTMLElement>('.seat').forEach((seat) => {
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
    ).some(
      (seat) =>
        !state.shifts.has(seat) &&
        seat
          .getAnimations({ subtree: true })
          .some(
            (animation) =>
              animation.playState === 'running' &&
              Number.isFinite(animation.effect?.getComputedTiming().iterations)
          )
    );
    if (entering) {
      spacingReady = false;
      return false;
    }
    let changed = false;
    const ratio = scaler.getBoundingClientRect().width / scaler.offsetWidth || 1;
    const pageBox = box(page);
    const header = page
      .closest('.multi-table-page')
      ?.querySelector('.multi-table-page__tab-bar-wrapper');
    const top = header ? box(header).top + box(header).height + 3 : pageBox.top + 3;
    const bounds = {
      left: pageBox.left + 2,
      top,
      width: pageBox.width - 4,
      height: pageBox.top + pageBox.height - top - 3,
    };
    const fixed = Array.from(
      page.querySelectorAll(
        '.community-area,.bbj-widget,.bbj-mini-plate,.seat--hero .seat__info,.seat--hero .seat__cards,.action-panel-wrapper,.tournament-hud'
      )
    )
      .map(box)
      .filter((r) => r.width > 0 && r.height > 0);
    const heroImage = images().find((image) => image.closest('.seat--hero'));
    if (heroImage && resolved.get(source(heroImage)))
      fixed.push(subject(heroImage, resolved.get(source(heroImage))!, true));
    const seats = Array.from(
      scaler.querySelectorAll<HTMLElement>('.seat:not(.seat--hero):not(.seat--empty)')
    );
    const parts = (seat: HTMLElement) => {
      const image = seat.querySelector<HTMLImageElement>('.seat__avatar-img');
      const own = image && resolved.get(source(image));
      return [
        ...(image && own ? [subject(image, own, true)] : []),
        ...Array.from(
          seat.querySelectorAll(
            ':scope > .seat__info,:scope > .seat__action,:scope > .seat__bounty,.seat__position-badge'
          )
        )
          .map(box)
          .filter((r) => r.width > 0 && r.height > 0),
      ];
    };
    for (const seat of seats) {
      const kept = state.shifts.get(seat);
      if (kept) continue;
      const mine = parts(seat);
      const obstacles = [...fixed, ...seats.filter((other) => other !== seat).flatMap(parts)];
      const side = Math.sign(
        box(seat).left + box(seat).width / 2 - pageBox.left - pageBox.width / 2
      );
      const shift = nearestOpponentShift(mine, obstacles, bounds, side);
      if (!shift) continue;
      const local: [number, number] = [shift[0] / ratio, shift[1] / ratio];
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
    paintedBox: (image: HTMLImageElement) => {
      const own = resolved.get(source(image));
      return own ? subject(image, own, true) : null;
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
