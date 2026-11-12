import { restingAvatarBox, tableRenderScale } from './avatarCrownBounds';
import { buttonRadiusWidthPct } from './tableGeometry';
import {
  hiddenFanReservations,
  dealerReservations,
  heroPrivateReservations,
} from './mobileAvatarReservations';

export type MobileAvatarProfile = { scale: number; px: number; py: number };
// Per-slot ceilings. Static reservations select one scale and pivot per
// asset/layout; turns, folds and reveals never rerun that selection.
// Unqualified layouts retain their existing artwork.
const fixed = (scale: number, px = 0): MobileAvatarProfile => ({ scale, px, py: 1 });
const MOBILE_PROFILES: Record<string, Record<number, MobileAvatarProfile>> = {
  'cash|9|seated': { 0: fixed(1.1), 4: fixed(1.05), 6: fixed(1.05), 8: fixed(1.05) },
  'cash|9|spectator': {
    0: fixed(1.15),
    2: fixed(1.02),
    4: fixed(1.1, -0.5),
    6: fixed(1.15, 0.5),
    8: fixed(1.15, 0.5),
  },
};

export type PaintBox = { left: number; top: number; width: number; height: number };
type PaintChoice = {
  scale: number;
  x: number;
  y: number;
  parts: PaintBox[];
  origin: [number, number];
};
const right = (r: PaintBox) => r.left + r.width;
const bottom = (r: PaintBox) => r.top + r.height;
const intersection = (a: PaintBox, b: PaintBox) =>
  Math.max(0, Math.min(right(a), right(b)) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(bottom(a), bottom(b)) - Math.max(a.top, b.top));
const area = (parts: PaintBox[], obstacle: PaintBox) =>
  parts.reduce((sum, part) => sum + intersection(part, obstacle), 0);

/** New paint is checked against the settled layout, never used to move it.
 * November 12: only existing overlap with OWN cards/action labels may grow.
 * The original layout pass still runs in full; this final finite pass either
 * qualifies fixed paint against reserved state envelopes, or retains its size. */
export function chooseMobileAvatarPaint(
  parts: PaintBox[],
  origin: [number, number],
  clipBottom: number,
  obstacles: Array<{ box: PaintBox; ownLayer: boolean }>,
  felt: PaintBox,
  viewport: PaintBox,
  ceiling = 1.15,
  maxPaintHeight = Infinity,
  profile?: MobileAvatarProfile
): PaintChoice {
  const unchanged = { scale: 1, x: 0, y: 0, parts, origin };
  if (!parts.length) return unchanged;
  const bounds = {
    left: Math.min(...parts.map((p) => p.left)),
    top: Math.min(...parts.map((p) => p.top)),
    right: Math.max(...parts.map(right)),
    bottom: Math.max(...parts.map(bottom)),
  };
  const height = bounds.bottom - bounds.top;
  const existing = obstacles.map((o) => area(parts, o.box));
  // The actual CSS felt window is a stadium. Using its enclosing rendered
  // stadium is conservative on a tapered phone: it can refuse room, not add it.
  const radius = Math.min(felt.width, felt.height) / 2;
  const feltInterval = (y: number): [number, number] | null => {
    if (y <= felt.top || y >= bottom(felt)) return null;
    const dy = Math.max(felt.top + radius - y, y - (bottom(felt) - radius), 0);
    const half = Math.sqrt(Math.max(0, radius * radius - dy * dy));
    return [felt.left + felt.width / 2 - half, felt.left + felt.width / 2 + half];
  };
  const rows = new Map<number, number[][]>();
  const rowCover = (row: number) => {
    let cover = rows.get(row);
    if (!cover) {
      const y = row / 10;
      cover = parts
        .filter((q) => q.top <= y && bottom(q) >= y + 0.1)
        .map((q) => [q.left, right(q)])
        .sort((a, b) => a[0] - b[0]);
      rows.set(row, cover);
    }
    return cover;
  };
  const addsFelt = (next: PaintBox[]) =>
    next.some((p) => {
      const from = Math.max(p.top, felt.top),
        to = Math.min(bottom(p), bottom(felt));
      for (let row = Math.floor(from * 10); row < Math.ceil(to * 10); row++) {
        const y = row / 10;
        const band = feltInterval(Math.min(Math.max(y + 0.05, from), to));
        if (!band) continue;
        let start = Math.max(p.left, band[0]);
        const end = Math.min(right(p), band[1]);
        if (end <= start) continue;
        for (const [l, r] of rowCover(row)) {
          if (l > start + 0.01) break;
          start = Math.max(start, r);
        }
        if (start < end - 0.01) return true;
      }
      return false;
    });
  for (const scale of profile ? [profile.scale] : [1.15, 1.1, 1.05, 1.02]) {
    if (scale <= 1 || scale > ceiling + 0.0001) continue;
    // Crown-first (Option A), then growth toward free rail. No image stretch.
    for (const py of profile ? [profile.py] : [0, 1, -1, 2])
      for (const px of profile ? [profile.px] : [0, 0.5, -0.5, 1, -1]) {
        const pivot: [number, number] = [
          (bounds.left + bounds.right) / 2 + px * height,
          bounds.top + py * height,
        ];
        const next = parts
          .map((p) => {
            const top = pivot[1] + (p.top - pivot[1]) * scale;
            return {
              left: pivot[0] + (p.left - pivot[0]) * scale,
              top,
              width: p.width * scale,
              height: Math.max(
                0,
                Math.min(clipBottom, pivot[1] + (bottom(p) - pivot[1]) * scale) - top
              ),
            };
          })
          .filter((p) => p.height > 0);
        if (
          next.some(
            (p) =>
              p.left < viewport.left ||
              right(p) > right(viewport) ||
              p.top < viewport.top ||
              bottom(p) > bottom(viewport)
          )
        )
          continue;
        if (
          Math.max(...next.map(bottom)) - Math.min(...next.map((p) => p.top)) >
          maxPaintHeight + 0.01
        )
          continue;
        if (addsFelt(next)) continue;
        if (
          obstacles.some((o, i) => {
            const overlap = area(next, o.box);
            return !(o.ownLayer && existing[i] > 0) && overlap > existing[i] + 0.01;
          })
        )
          continue;
        return {
          scale,
          x: (1 - scale) * (pivot[0] - origin[0]),
          y: (1 - scale) * (pivot[1] - origin[1]),
          parts: next,
          origin,
        };
      }
  }
  return unchanged;
}

function rebaseChoice(choice: PaintChoice | undefined, origin: [number, number]) {
  if (!choice) return;
  const dx = origin[0] - choice.origin[0],
    dy = origin[1] - choice.origin[1];
  return {
    ...choice,
    origin,
    parts: choice.parts.map((p) => ({ ...p, left: p.left + dx, top: p.top + dy })),
  };
}

const properties = [
  '--sp-mobile-art-scale',
  '--sp-mobile-art-x',
  '--sp-mobile-art-y',
  '--sp-mobile-border',
  '--sp-mobile-border-style',
  '--sp-mobile-background',
  '--sp-mobile-shadow',
  '--sp-mobile-overflow',
];
const frameProperties = ['x', 'y', 'w', 'h', 'background', 'border', 'radius', 'shadow'].map(
  (name) => `--sp-frame-${name}`
);
export function resetMobileAvatarPaint(scaler: HTMLElement) {
  scaler
    .querySelectorAll<HTMLElement>('.seat__info')
    .forEach((info) => frameProperties.forEach((name) => info.style.removeProperty(name)));
  scaler.querySelectorAll<HTMLElement>('.seat__avatar-img').forEach((image) => {
    image.style.removeProperty('--sp-mobile-clip-bottom');
    image.style.removeProperty('--sp-mobile-filter');
  });
  scaler.querySelectorAll<HTMLElement>('.seat__avatar').forEach((avatar) => {
    for (const name of properties) avatar.style.removeProperty(name);
  });
}

/** A pending decode/animation must not flash the smaller baseline between
 * transactions. Restoring these paint properties never changes layout inputs. */
export function retainMobilePaint(scaler: HTMLElement) {
  const names = [
    ...properties,
    ...frameProperties,
    '--sp-mobile-clip-bottom',
    '--sp-mobile-filter',
  ];
  const values = Array.from(
    scaler.querySelectorAll<HTMLElement>('.seat__avatar,.seat__avatar-img,.seat__info')
  ).map((element) => ({
    element,
    values: names
      .map((name) => [name, element.style.getPropertyValue(name)] as const)
      .filter(([, value]) => value),
  }));
  return () => {
    for (const item of values)
      for (const [name, value] of item.values) item.element.style.setProperty(name, value);
  };
}

function profileFor(image: HTMLImageElement, scaler: HTMLElement, page: HTMLElement) {
  if (!matchMedia('(min-width: 481px) and (max-width: 768px) and (orientation: portrait)').matches)
    return;
  const key = `${page.classList.contains('table-page--tournament') ? 'tournament' : 'cash'}|${page.dataset.seats}|${page.dataset.hero === 'false' ? 'spectator' : 'seated'}`;
  const ring = Array.from(scaler.querySelectorAll<HTMLElement>('.seat-wrapper')).sort((a, b) => {
    const angle = (e: HTMLElement) =>
      (Math.atan2(50 - parseFloat(e.style.left), parseFloat(e.style.top) - 50) + 2 * Math.PI) %
      (2 * Math.PI);
    return angle(a) - angle(b);
  });
  if (
    page.dataset.killEnabled !== 'false' ||
    ![2, 3, 4, 5].includes(Number(page.dataset.holeCardCount))
  )
    return;
  return MOBILE_PROFILES[key]?.[ring.indexOf(image.closest<HTMLElement>('.seat-wrapper')!)];
}
/** The card allocator reserves growth BEFORE selecting a new shown-hand slot.
 * Existing rows keep their original retained placement. Unsupported portraits
 * can reserve more than they paint, but never paint beyond this reservation. */
export function mobileAvatarCardReservation(
  image: HTMLImageElement,
  baseline: PaintBox,
  scaler: HTMLElement,
  page: HTMLElement,
  readPaint: (image: HTMLImageElement) => PaintBox[],
  state?: MobilePaintState
): PaintBox {
  const profile = profileFor(image, scaler, page);
  if (!profile || !image.closest('.seat__avatar--bust')) return baseline;
  const cached = state?.key === mobilePaintKey(scaler, page) ? state.choices.get(image) : undefined;
  if (cached) {
    if (cached.scale === 1) return baseline;
    const avatar = image.closest<HTMLElement>('.seat__avatar')!;
    const rect = restingAvatarBox(avatar, tableRenderScale(scaler));
    return unionPaint([
      baseline,
      ...rebaseChoice(cached, [rect.left + rect.width / 2, rect.bottom])!.parts,
    ]);
  }
  const parts = readPaint(image);
  if (!parts.length) return baseline;
  return mobileGrowthReservation(baseline, parts, profile.scale);
}

function unionPaint(parts: PaintBox[]): PaintBox {
  const left = Math.min(...parts.map((p) => p.left)),
    top = Math.min(...parts.map((p) => p.top));
  return {
    left,
    top,
    width: Math.max(...parts.map(right)) - left,
    height: Math.max(...parts.map(bottom)) - top,
  };
}

export function mobileGrowthReservation(
  baseline: PaintBox,
  parts: PaintBox[],
  ceiling: number
): PaintBox {
  if (!parts.length) return baseline;
  const left = Math.min(...parts.map((p) => p.left)),
    top = Math.min(...parts.map((p) => p.top));
  const r = Math.max(...parts.map(right)),
    b = Math.max(...parts.map(bottom)),
    height = b - top;
  const pivotX = (left + r) / 2 + height,
    pivotY = top + 2 * height;
  const l = Math.min(baseline.left, pivotX + (left - pivotX) * ceiling);
  const t = Math.min(baseline.top, pivotY + (top - pivotY) * ceiling);
  return {
    left: l,
    top: t,
    width:
      Math.max(
        right(baseline),
        (left + r) / 2 - height + (r - ((left + r) / 2 - height)) * ceiling
      ) - l,
    height: Math.max(bottom(baseline), b) - t,
  };
}

export function mobileFrameCardReservation(
  info: HTMLElement,
  baseline: PaintBox,
  page: HTMLElement,
  state?: MobilePaintState
): PaintBox {
  if (
    page.classList.contains('table-page--tournament') ||
    page.dataset.seats !== '9' ||
    page.dataset.killEnabled !== 'false' ||
    ![2, 3, 4, 5].includes(Number(page.dataset.holeCardCount)) ||
    !matchMedia('(min-width: 481px) and (max-width: 768px) and (orientation: portrait)').matches
  )
    return baseline;
  const scaler = info.closest<HTMLElement>('.table-scaler');
  const cached =
    scaler && state?.key === mobilePaintKey(scaler, page) ? state.frames.get(info) : undefined;
  if (cached)
    return cached.scale === 1
      ? baseline
      : unionPaint([
          baseline,
          ...rebaseChoice(cached, [baseline.left + baseline.width / 2, bottom(baseline)])!.parts,
        ]);
  // The largest frame candidate grows from its top centre by ten percent.
  return {
    left: baseline.left - baseline.width * 0.05,
    top: baseline.top,
    width: baseline.width * 1.1,
    height: baseline.height * 1.1,
  };
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

/** Only stable geometry enters qualification. Cash tables have no bounty badge
 * (seatBountyBadge); narrower portrait layouts use different label/fan rules. */
function stableObstacles(scaler: HTMLElement, page: HTMLElement) {
  const ratio = tableRenderScale(scaler);
  const boxes: Array<{ box: PaintBox; owner: Element | null; layer: boolean; minimum?: PaintBox }> =
    [];
  const badge = page.querySelector<HTMLElement>('.seat__position-badge:not(.seat__kill-badge)');
  const badgeStyle = badge ? getComputedStyle(badge) : null;
  const fontSize = badgeStyle
    ? parseFloat(badgeStyle.fontSize)
    : parseFloat(getComputedStyle(document.documentElement).fontSize) * 0.5;
  const context = document.createElement('canvas').getContext('2d')!;
  context.font = badgeStyle?.font || `700 ${fontSize}px ${getComputedStyle(page).fontFamily}`;
  const letter = badgeStyle ? parseFloat(badgeStyle.letterSpacing) || 0 : fontSize * 0.06;
  const badgeWidth =
    Math.max(
      ...['SB', 'BB', 'UTG', 'UTG+1', 'UTG+2', 'MP', 'MP+1', 'HJ', 'CO', 'BTN'].map(
        (label) => context.measureText(label).width + label.length * letter
      )
    ) + 12;
  const badgeHeight = fontSize * 1.3 + 4;
  for (const element of page.querySelectorAll<HTMLElement>(
    '.seat__info,.community-area,.pot-area,.pot-display,.pot-display__pile,.table-hud button,.table-hud__corner > *,.chat-collapsed,.action-panel-wrapper,.table-tab-bar,.bbj-container'
  )) {
    const box = element.getBoundingClientRect();
    if (box.width && box.height) boxes.push({ box, owner: element.closest('.seat'), layer: false });
  }
  for (const seat of scaler.querySelectorAll<HTMLElement>('.seat:not(.seat--empty)')) {
    const rect = seat.getBoundingClientRect(),
      style = getComputedStyle(seat);
    const avatar = seat.querySelector<HTMLElement>('.seat__avatar-wrap');
    if (!avatar) continue;
    const at = restingAvatarBox(avatar, ratio);
    const tagH = (parseFloat(style.getPropertyValue('--sp-tag-h')) || 20) * ratio;
    const hero = seat.classList.contains('seat--hero');
    const cap = Boolean(seat.closest('.seat-wrapper--top,.seat-wrapper--cap'));
    const rise = (parseFloat(style.getPropertyValue('--sp-art-rise')) || 12) * ratio;
    const gap = (parseFloat(style.getPropertyValue('--sp-tag-gap')) || 3) * ratio;
    const tagTop = hero
      ? rect.top - rise - gap - tagH
      : cap
        ? rect.bottom + 2 * ratio
        : rect.top - 26 * ratio;
    // Amount labels have no fixed maximum width. Reserve the entire band,
    // including the 1.1x pop and its 2px upward / 8px downward travel.
    boxes.push({
      box: { left: 0, top: tagTop - 3 * ratio, width: innerWidth, height: tagH + 12 * ratio },
      owner: seat,
      layer: true,
      minimum: {
        left: rect.left + rect.width / 2 - 12 * ratio,
        top: tagTop,
        width: 24 * ratio,
        height: tagH,
      },
    });
    // The position chip can rotate through every label while the art stays put.
    // Kill-enabled tables retain their original size from the stable game setting.
    boxes.push({
      box: {
        left: at.left + at.width + (4 - badgeWidth) * ratio,
        top: at.top - 6 * ratio,
        width: badgeWidth * ratio,
        height: badgeHeight * ratio,
      },
      owner: seat,
      layer: false,
    });
    if (hero) {
      const input = {
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
      };
      const reserved = heroPrivateReservations(input);
      for (const box of reserved.boxes) boxes.push({ box, owner: seat, layer: true });
    }
    // Reserve each possible fan separately. An overlap with one card never
    // authorizes a new overlap with another card or another fan orientation.
    if (!hero)
      for (const side of [seat.classList.contains('seat--cards-left') ? 'left' : 'right'] as const)
        for (let count = 1; count <= 6; count++)
          for (const discard of [false, true])
            for (const box of hiddenFanReservations({
              seatLeft: rect.left,
              seatTop: rect.top,
              seatWidth: rect.width / ratio,
              avatarSize: avatar.offsetWidth,
              wrapOverlap: parseFloat(style.getPropertyValue('--sp-wrap-overlap')) || 6,
              scale: ratio,
              side,
              count,
              discard,
            }))
              boxes.push({ box, owner: seat, layer: true });
  }
  const canvas = scaler.getBoundingClientRect();
  const anchors = Array.from(scaler.querySelectorAll<HTMLElement>('.seat-wrapper')).map((e) => ({
    x: parseFloat(e.style.left),
    y: parseFloat(e.style.top),
  }));
  const scalerSize = {
    w: scaler.offsetWidth,
    h: scaler.offsetHeight,
    railBets: false,
    portraitTags: true,
    portraitTaper: page.dataset.hero === 'false' ? 0 : undefined,
  };
  const dealerSize = ((buttonRadiusWidthPct(scalerSize) * scalerSize.w) / 100) * 2;
  for (const box of dealerReservations({
    canvas,
    scale: ratio,
    anchors,
    dealerSize: dealerSize * ratio,
    viewportWidth: innerWidth,
    scalerSize,
  }))
    boxes.push({ box, owner: null, layer: false });
  // These rows are immutable once displayed. At an asset/layout change they
  // remain constraints; later reveals do not invalidate the retained choice.
  for (const card of scaler.querySelectorAll<HTMLElement>(
    '.seat__cards--hero .seat__card,.seat__cards--revealed .seat__card'
  )) {
    const box = card.getBoundingClientRect();
    if (box.width && box.height) boxes.push({ box, owner: card.closest('.seat'), layer: true });
  }
  return boxes;
}

export type MobilePaintState = {
  key: string;
  choices: Map<HTMLImageElement, PaintChoice>;
  frames: Map<HTMLElement, PaintChoice>;
  clips: Map<HTMLImageElement, string>;
  obstacles?: ReturnType<typeof stableObstacles>;
};
export const createMobilePaintState = (): MobilePaintState => ({
  key: '',
  choices: new Map(),
  frames: new Map(),
  clips: new Map(),
});
export function mobilePaintKey(scaler: HTMLElement, page: HTMLElement) {
  return JSON.stringify([
    innerWidth,
    innerHeight,
    scaler.offsetWidth,
    scaler.offsetHeight,
    scaler.getBoundingClientRect().left,
    scaler.getBoundingClientRect().top,
    tableRenderScale(scaler),
    page.dataset.seats,
    page.dataset.killEnabled,
    page.dataset.holeCardCount,
    page.dataset.hero,
    page.classList.contains('table-page--tournament'),
    Array.from(scaler.querySelectorAll<HTMLImageElement>('.seat__avatar-img')).map((image) => [
      image.currentSrc || image.src,
      image.closest('.seat')?.getAttribute('data-player-id'),
      image.closest<HTMLElement>('.seat-wrapper')?.style.left,
      image.closest<HTMLElement>('.seat-wrapper')?.style.top,
      image.offsetWidth,
      image.offsetHeight,
      image
        .closest<HTMLElement>('.seat__avatar')
        ?.style.getPropertyValue('--sp-opponent-art-scale'),
      image.closest<HTMLElement>('.seat')?.style.getPropertyValue('--sp-opponent-x'),
      image.closest<HTMLElement>('.seat')?.style.getPropertyValue('--sp-opponent-y'),
    ]),
  ]);
}

export function enlargeMobileAvatars(
  scaler: HTMLElement,
  page: HTMLElement,
  readPaint: (image: HTMLImageElement) => PaintBox[],
  state?: MobilePaintState
) {
  if (state) {
    const key = mobilePaintKey(scaler, page);
    if (state.key !== key) {
      state.key = key;
      state.choices.clear();
      state.frames.clear();
      state.clips.clear();
      state.obstacles = undefined;
    }
  }
  if (!matchMedia('(min-width: 481px) and (max-width: 768px) and (orientation: portrait)').matches)
    return;
  const surface = page.querySelector<HTMLElement>('.table-surface');
  if (!surface) return;
  const felt = surface.getBoundingClientRect();
  const ratio = tableRenderScale(scaler);
  const ring = Array.from(scaler.querySelectorAll<HTMLElement>('.seat-wrapper')).sort((a, b) => {
    const angle = (e: HTMLElement) =>
      (Math.atan2(50 - parseFloat(e.style.left), parseFloat(e.style.top) - 50) + 2 * Math.PI) %
      (2 * Math.PI);
    return angle(a) - angle(b);
  });
  const profileKey = `${page.classList.contains('table-page--tournament') ? 'tournament' : 'cash'}|${page.dataset.seats}|${page.dataset.hero === 'false' ? 'spectator' : 'seated'}`;
  const profiles = MOBILE_PROFILES[profileKey];
  if (
    !profiles ||
    page.dataset.killEnabled !== 'false' ||
    ![2, 3, 4, 5].includes(Number(page.dataset.holeCardCount))
  )
    return;
  const seats = Array.from(scaler.querySelectorAll<HTMLElement>('.seat:not(.seat--empty)'));
  const entries = seats
    .map((seat) => {
      const image = seat.querySelector<HTMLImageElement>('.seat__avatar-img');
      const avatar = seat.querySelector<HTMLElement>('.seat__avatar');
      const info = seat.querySelector<HTMLElement>('.seat__info');
      return image && avatar && info
        ? { seat, image, avatar, info, parts: readPaint(image) }
        : null;
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);
  // Reserve peers' original paint, then each accepted enlarged footprint.
  const painted = new Map(entries.map((e) => [e.seat, e.parts]));
  const hero = entries.find((e) => e.seat.classList.contains('seat--hero'));
  const ordered = hero ? [hero, ...entries.filter((e) => e !== hero)] : entries;
  let heroHeight = hero?.avatar.getBoundingClientRect().height ?? Infinity;
  let heroPaintHeight = hero?.parts.length
    ? Math.max(...hero.parts.map(bottom)) - Math.min(...hero.parts.map((p) => p.top))
    : Infinity;
  const objects = state
    ? (state.obstacles ??= stableObstacles(scaler, page))
    : stableObstacles(scaler, page);

  for (const e of ordered) {
    // Rive rigs and cosmetics need their own painted-footprint proof.
    if (!e.avatar.classList.contains('seat__avatar--bust')) continue;
    if (
      !e.parts.length ||
      Array.from(e.avatar.querySelectorAll<HTMLElement>('.seat__avatar-rive,.sp-cosmetic')).some(
        (el) => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0
      )
    )
      continue;
    const slot = ring.indexOf(e.seat.closest<HTMLElement>('.seat-wrapper')!);
    const profile = profiles[slot];
    if (!profile || profile.scale <= 1) continue;
    const rect = restingAvatarBox(e.avatar, ratio);
    const obstacles = objects.map((o) => ({
      box: o.box,
      ownLayer: o.owner === e.seat && o.layer && (!o.minimum || area(e.parts, o.minimum) > 0),
    }));
    for (const [seat, parts] of painted)
      if (seat !== e.seat)
        for (const box of parts) obstacles.push({ box: box as DOMRect, ownLayer: false });
    const clipBottom = e.avatar.classList.contains('seat__avatar--bust')
      ? Math.max(...e.parts.map(bottom))
      : Infinity;
    const choice =
      rebaseChoice(state?.choices.get(e.image), [rect.left + rect.width / 2, rect.bottom]) ??
      chooseMobileAvatarPaint(
        e.parts,
        [rect.left + rect.width / 2, rect.bottom],
        clipBottom,
        obstacles,
        felt,
        { left: 0, top: 0, width: innerWidth, height: innerHeight },
        Math.min(profile.scale, e === hero ? 1.15 : Math.min(1.15, heroHeight / rect.height)),
        e === hero ? Infinity : heroPaintHeight
      );
    state?.choices.set(e.image, choice);
    if (choice.scale === 1) continue;
    // Keep brightness/saturation (including folds). An enlarged soft shadow
    // must not spread onto felt that the original art left clear.
    const filter = getComputedStyle(e.image)
      .filter.replace(/drop-shadow\((?:[^()]|\([^()]*\))*\)/g, '')
      .trim();
    e.image.style.setProperty('--sp-mobile-filter', filter || 'none');
    const normal = parseFloat(e.avatar.style.getPropertyValue('--sp-opponent-art-scale')) || 1;
    const chrome = getComputedStyle(e.avatar);
    const appearance = {
      border: chrome.borderTopWidth,
      'border-style': chrome.border,
      background: chrome.background,
      shadow: chrome.boxShadow,
      overflow: chrome.overflow,
    };
    for (const [name, value] of Object.entries(appearance))
      e.avatar.style.setProperty(`--sp-mobile-${name}`, value);
    e.avatar.style.setProperty('--sp-mobile-art-scale', String(choice.scale));
    e.avatar.style.setProperty('--sp-mobile-art-x', `${choice.x / (ratio * normal)}px`);
    e.avatar.style.setProperty('--sp-mobile-art-y', `${choice.y / (ratio * normal)}px`);

    if (Number.isFinite(clipBottom)) {
      const imageBox = e.image.getBoundingClientRect();
      const clip = Math.max(
        0,
        ((imageBox.bottom - clipBottom) / imageBox.height) * e.image.offsetHeight
      );
      const value = state?.clips.get(e.image) ?? `${clip}px`;
      state?.clips.set(e.image, value);
      e.image.style.setProperty('--sp-mobile-clip-bottom', value);
    }
    painted.set(e.seat, choice.parts);
    if (e === hero) {
      heroHeight = rect.height * choice.scale;
      heroPaintHeight =
        Math.max(...choice.parts.map(bottom)) - Math.min(...choice.parts.map((p) => p.top));
    }
  }
  return painted;
}

/** Extend the existing plate paint only; its text, timer and hit box stay fixed. */
export function enlargeMobileFrames(
  scaler: HTMLElement,
  page: HTMLElement,
  painted?: Map<HTMLElement, PaintBox[]>,
  state?: MobilePaintState
) {
  if (!painted) return;
  if (!matchMedia('(min-width: 481px) and (max-width: 768px) and (orientation: portrait)').matches)
    return;
  const surface = page.querySelector<HTMLElement>('.table-surface');
  if (!surface) return;
  const ratio = tableRenderScale(scaler);
  const objects = state
    ? (state.obstacles ??= stableObstacles(scaler, page))
    : stableObstacles(scaler, page);
  const boxes = new Map(
    Array.from(scaler.querySelectorAll<HTMLElement>('.seat__info')).map((o) => [
      o,
      o.getBoundingClientRect() as PaintBox,
    ])
  );
  for (const info of scaler.querySelectorAll<HTMLElement>('.seat:not(.seat--empty) .seat__info')) {
    const rect = info.getBoundingClientRect();
    const obstacles = objects
      .filter(
        (o) =>
          !(o.owner === info.closest('.seat') && o.box.left === rect.left && o.box.top === rect.top)
      )
      .map((o) => ({ box: o.box, ownLayer: false }));
    for (const [other, box] of boxes) if (other !== info) obstacles.push({ box, ownLayer: false });
    for (const parts of painted?.values() ?? [])
      for (const box of parts) obstacles.push({ box, ownLayer: false });
    let choice = rebaseChoice(state?.frames.get(info), [rect.left + rect.width / 2, rect.bottom]);
    if (!choice)
      for (const scale of [1.1, 1.05, 1.02]) {
        choice = chooseMobileAvatarPaint(
          [rect],
          [rect.left + rect.width / 2, rect.bottom],
          Infinity,
          obstacles,
          surface.getBoundingClientRect(),
          { left: 0, top: 0, width: innerWidth, height: innerHeight },
          scale,
          Infinity,
          { scale, px: 0, py: 0 }
        );
        if (choice.scale > 1) break;
      }
    if (!choice) continue;
    state?.frames.set(info, choice);
    if (choice.scale === 1) continue;
    const style = getComputedStyle(info),
      next = choice.parts[0];
    const values = {
      x: `${(next.left - rect.left) / ratio - parseFloat(style.borderLeftWidth)}px`,
      y: `${(next.top - rect.top) / ratio - parseFloat(style.borderTopWidth)}px`,
      w: `${next.width / ratio}px`,
      h: `${next.height / ratio}px`,
      background: style.background,
      border: style.border,
      radius: style.borderRadius,
      shadow: style.boxShadow,
    };
    for (const [name, value] of Object.entries(values))
      info.style.setProperty(`--sp-frame-${name}`, value);
    boxes.set(info, next);
  }
}
