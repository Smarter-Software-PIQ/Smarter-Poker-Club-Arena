import { restingAvatarBox, tableRenderScale } from './avatarCrownBounds';
import { buttonRadiusWidthPct } from './tableGeometry';
import {
  hiddenFanReservations,
  hiddenFanStates,
  mobilePositionLabels,
  dealerSeatReservations,
  heroPrivateReservations,
} from './mobileAvatarReservations';

export type MobileAvatarProfile = { scale: number; px: number; py: number };
// Per-slot ceilings. Static reservations select one scale and pivot per
// asset/layout; turns, folds and reveals never rerun that selection.
// Unqualified layouts retain their existing artwork.
const fixed = (scale: number, px = 0): MobileAvatarProfile => ({ scale, px, py: 1 });
/** Dan, 2026-11-12: "make them as large as possible, without breaking
 * functionality or overlapping existing features or displays". The ceiling is
 * the largest zoom the fitter may try; every real feature (cards, bet chips and
 * amount tags, plates, badges, dealer button, pot, board, controls, neighbours)
 * stays a hard obstacle, so a seat gets the largest zoom those leave room for. */
export const MOBILE_AVATAR_MAX_SCALE = 2.5;
/** The seated hero keeps the owner-approved 2x head-and-shoulders zoom: its
 * crown room is the pot's edge, so a larger zoom can only sink the character
 * behind its plate, and the hero's portrait is never the smaller one
 * (Dan 2026-11-11, pinned by tests/live-turn/phone-table-layout.pw.ts). */
export const MOBILE_HERO_MAX_SCALE = 2;
const MOBILE_PROFILES: Record<string, Record<number, MobileAvatarProfile>> = {
  'cash|6|seated': Object.fromEntries(
    Array.from({ length: 6 }, (_, i) => [i, fixed(MOBILE_AVATAR_MAX_SCALE)])
  ),
  'cash|6|spectator': Object.fromEntries(
    Array.from({ length: 6 }, (_, i) => [i, fixed(MOBILE_AVATAR_MAX_SCALE)])
  ),
  'cash|9|seated': Object.fromEntries(
    Array.from({ length: 9 }, (_, i) => [i, fixed(MOBILE_AVATAR_MAX_SCALE)])
  ),
  'cash|9|spectator': Object.fromEntries(
    Array.from({ length: 9 }, (_, i) => [i, fixed(MOBILE_AVATAR_MAX_SCALE)])
  ),
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
  profile?: MobileAvatarProfile,
  attachmentBottom = clipBottom,
  // Dan 2026-11-12: a portrait is always centred over its frame box, so no
  // sideways pivot; it grows straight up from its plate.
  centered = false
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
  const minimumHeight = Math.max(0, Math.min(bounds.bottom, clipBottom) - bounds.top);
  const minimumArea = parts.reduce(
    (sum, p) => sum + p.width * Math.max(0, Math.min(bottom(p), clipBottom) - p.top),
    0
  );
  const existing = obstacles.map((o) => area(parts, o.box));
  // November 12 (Dan): the felt is a surface, not a feature. Growing over the
  // felt rim is what every poker app's rail portraits do; what may never be
  // covered is a real display: cards, bet chips and amount tags, plates,
  // badges, the dealer button, the pot, the board, controls and neighbours.
  // Those are the obstacles below. A former "adds no felt pixel" gate refused
  // nearly every seat on a phone, which is why production looked unchanged.
  void felt;
  // One rung: the first pivot that fits, crown-first (Option A), then growth
  // toward free rail. No image stretch.
  const tryScale = (scale: number): PaintChoice | null => {
    for (const py of profile ? [profile.py] : [2, 1, 0.75, 0.5, 0.25, 0.15, 0.1, 0.05, 0, -1])
      for (const px of profile
        ? [profile.px]
        : centered
          ? [0]
          : [0, 0.05, -0.05, 0.1, -0.1, 0.15, -0.15, 0.25, -0.25, 0.5, -0.5, 1, -1]) {
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
        // A crop must not qualify by hiding the character. Preserve at least
        // the original visible height and painted area before testing clearance.
        let nextLeft = Infinity,
          nextTop = Infinity;
        let nextRight = -Infinity,
          nextBottom = -Infinity,
          nextArea = 0;
        for (const part of next) {
          nextLeft = Math.min(nextLeft, part.left);
          nextTop = Math.min(nextTop, part.top);
          nextRight = Math.max(nextRight, right(part));
          nextBottom = Math.max(nextBottom, bottom(part));
          nextArea += part.width * part.height;
        }
        const visibleHeight = next.length ? nextBottom - nextTop : 0;
        if (
          !next.length ||
          // Keep the portrait attached to its plate, rather than floating
          // above or entirely beside the chair to obtain a larger scale.
          nextBottom + 0.01 < Math.min(bounds.bottom, attachmentBottom) ||
          nextLeft > (bounds.left + bounds.right) / 2 ||
          nextRight < (bounds.left + bounds.right) / 2 ||
          // Keep the enlarged portrait's centre within its original footprint
          // so a sideward zoom cannot make it read as the neighbouring chair.
          (nextLeft + nextRight) / 2 < bounds.left ||
          (nextLeft + nextRight) / 2 > bounds.right ||
          visibleHeight + 0.01 < minimumHeight ||
          nextArea + 0.01 < minimumArea
        )
          continue;
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
        if (visibleHeight > maxPaintHeight + 0.01) continue;
        if (
          obstacles.some((o, i) => {
            if (o.ownLayer && existing[i] > 0) return false;
            // Most reserved strips are far from this portrait. Reject them by
            // bounds before walking hundreds of decoded alpha runs. Stop as
            // soon as the same non-negative overlap sum exceeds its allowance.
            if (
              nextRight <= o.box.left ||
              nextLeft >= right(o.box) ||
              nextBottom <= o.box.top ||
              nextTop >= bottom(o.box)
            )
              return false;
            let overlap = 0;
            for (const part of next) {
              overlap += intersection(part, o.box);
              if (overlap > existing[i] + 0.01) return true;
            }
            return false;
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
    return null;
  };
  const rungs = (
    profile
      ? [profile.scale]
      : [
          2.5, 2.45, 2.4, 2.35, 2.3, 2.25, 2.2, 2.15, 2.1, 2.05, 2, 1.95, 1.9, 1.85, 1.8, 1.75, 1.7,
          1.65, 1.6, 1.55, 1.5, 1.45, 1.4, 1.35, 1.3, 1.25, 1.2, 1.15, 1.1, 1.05, 1.02,
        ]
  ).filter((scale) => scale > 1 && scale <= ceiling + 0.0001);
  if (!rungs.length) return unchanged;
  // Room is monotonic in practice: a zoom that fits leaves room for every
  // smaller zoom. Walking every rung from the ceiling down cost hundreds of
  // alpha-run intersections per refused rung on a nine-seat phone ring, which
  // overran the browser suites' settle budget. Bisect the rungs instead: the
  // smallest first (nothing fits: unchanged), then the largest that fits.
  const smallest = tryScale(rungs[rungs.length - 1]);
  if (!smallest) return unchanged;
  let best = smallest;
  let lo = 0,
    hi = rungs.length - 1; // rungs[hi] fits; rungs[lo - 1] never does
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const choice = tryScale(rungs[mid]);
    if (choice) {
      best = choice;
      hi = mid;
    } else lo = mid + 1;
  }
  return best;
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
    ![2, 3, 4, 5, 6].includes(Number(page.dataset.holeCardCount))
  )
    return;
  return MOBILE_PROFILES[key]?.[ring.indexOf(image.closest<HTMLElement>('.seat-wrapper')!)];
}
/** Later shown hands reserve the exact fixed portrait. On first mount the
 * original rows settle first and become constraints for portrait fitting. */
export function mobileAvatarCardReservation(
  image: HTMLImageElement,
  baseline: PaintBox,
  scaler: HTMLElement,
  page: HTMLElement,
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
  // On first mount the original layout settles before paint is selected.
  // The final fitter treats these already displayed cards as constraints.
  // Later reveals reserve the exact cached portrait above. Reserving every
  // possible pivot here would push a hand toward another player's chair.
  return baseline;
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

export function mobileFrameCardReservation(
  info: HTMLElement,
  baseline: PaintBox,
  page: HTMLElement,
  state?: MobilePaintState
): PaintBox {
  if (
    page.classList.contains('table-page--tournament') ||
    !['6', '9'].includes(page.dataset.seats ?? '') ||
    page.dataset.killEnabled !== 'false' ||
    ![2, 3, 4, 5, 6].includes(Number(page.dataset.holeCardCount)) ||
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
  // Initial rows settle first; frame fitting then checks those exact rows.
  // Future reveals use the retained frame footprint above.
  return baseline;
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
  const boxes: Array<{
    box: PaintBox;
    owner: Element | null;
    layer: boolean;
    minimum?: PaintBox;
    /** Drawn over the owner's portrait: the owner may grow behind it. */
    overlay?: boolean;
  }> = [];
  const badge = page.querySelector<HTMLElement>('.seat__position-badge:not(.seat__kill-badge)');
  const badgeStyle = badge ? getComputedStyle(badge) : null;
  const fontSize = badgeStyle
    ? parseFloat(badgeStyle.fontSize)
    : parseFloat(getComputedStyle(document.documentElement).fontSize) * 0.5;
  const context = document.createElement('canvas').getContext('2d')!;
  context.font = badgeStyle?.font || `700 ${fontSize}px ${getComputedStyle(page).fontFamily}`;
  const letter = badgeStyle ? parseFloat(badgeStyle.letterSpacing) || 0 : fontSize * 0.06;
  // A sparse table cannot produce full-ring position labels. Keep any wider
  // label still displayed from a hand whose roster has since shrunk, too.
  // Occupancy changes invalidate the fixed qualification; label rotation does not.
  const positionLabels = [
    ...mobilePositionLabels(
      Number(page.dataset.seats),
      scaler.querySelectorAll('.seat:not(.seat--empty)').length
    ),
    ...Array.from(page.querySelectorAll('.seat__position-badge:not(.seat__kill-badge)')).map(
      (element) => element.textContent?.trim() || ''
    ),
  ];
  const badgeWidth =
    Math.max(
      ...positionLabels.map((label) => context.measureText(label).width + label.length * letter)
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
    // Amount labels are centred on their seat and never wider than the seat
    // plus a margin on each side (a nine-seat ring cannot stack two pods that
    // close). A former full-width band here made every seat's tag lane a wall
    // across the whole screen, which refused its neighbours' growth. Reserve the
    // seat's own lane, including the 1.1x pop and its 2px upward / 8px downward
    // travel.
    // The pill is centred on the seat and at most ~100 layout px wide
    // ("RAISE 1,234.56" at 0.72rem with its padding), so the lane is a fixed
    // 108 px centred on the seat rather than the seat width plus a pad: a
    // 136 px lane under a top chair reached its lower neighbour's crown.
    const laneWidth = 108 * ratio;
    boxes.push({
      box: {
        left: rect.left + rect.width / 2 - laneWidth / 2,
        top: tagTop - 3 * ratio,
        width: laneWidth,
        height: tagH + 12 * ratio,
      },
      owner: seat,
      layer: true,
      minimum: {
        left: rect.left + rect.width / 2 - 12 * ratio,
        top: tagTop,
        width: 24 * ratio,
        height: tagH,
      },
    });
    // Chips already on the felt are displays and stay hard. Where a future
    // bet rests is the marker solver's choice, and that solver treats the
    // enlarged portrait as a display to stay clear of (useProtectedCardLayout),
    // so no guessed rest envelope is reserved here: one abutting the art
    // walled every seated opponent at 1.05x (measured 2026-11-12).
    for (const chips of seat.querySelectorAll<HTMLElement>('.seat__bet-chips,.seat__wager-group')) {
      const box = chips.getBoundingClientRect();
      if (box.width && box.height) boxes.push({ box, owner: seat, layer: false });
    }
    // The position chip can rotate through every label while the art stays put.
    // Kill-enabled tables retain their original size from the stable game setting.
    // The seat's own badge is drawn over its portrait (z-index 6, above the
    // avatar wrap at 2), so the portrait may grow behind it like its own tag;
    // it stays hard for every other seat's portrait.
    boxes.push({
      box: {
        left: at.left + at.width + (4 - badgeWidth) * ratio,
        top: at.top - 6 * ratio,
        width: badgeWidth * ratio,
        height: badgeHeight * ratio,
      },
      owner: seat,
      layer: false,
      overlay: true,
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
        for (const { count, discard } of hiddenFanStates(Number(page.dataset.holeCardCount)))
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
            // An opponent's face-down fan draws over its own portrait
            // (.seat__cards--opponent z-index 4 above the wrap's 2), so the
            // portrait may grow behind its own fan: the cards stay whole. The
            // fan stays hard for every other seat's portrait.
            boxes.push({ box, owner: seat, layer: true, overlay: true });
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
  // The puck's preferred spot beside each chair. Chips rest where the marker
  // solver puts them, and that solver now treats the enlarged portrait as a
  // display to stay clear of (useProtectedCardLayout), so no felt band is
  // reserved here: a band walled every rail portrait (measured 2026-11-12).
  for (const box of dealerSeatReservations({
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
    ![2, 3, 4, 5, 6].includes(Number(page.dataset.holeCardCount))
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
  // Dan, 2026-11-11: the hero's portrait is never the smaller one. A photo or
  // initials hero has no painted runs; its circle is then the opponents' cap.
  // A character-art hero whose runs are not readable yet caps nothing, so the
  // opponents wait for the pass in which the hero's own paint is known.
  const heroPaintPending = Boolean(
    hero && !hero.parts.length && hero.avatar.classList.contains('seat__avatar--bust')
  );
  let heroPaintHeight = hero?.parts.length
    ? Math.max(...hero.parts.map(bottom)) - Math.min(...hero.parts.map((p) => p.top))
    : heroHeight;
  const objects = state
    ? (state.obstacles ??= stableObstacles(scaler, page))
    : stableObstacles(scaler, page);

  type Prepared = {
    e: (typeof entries)[number];
    rect: PaintBox & { bottom: number; right: number };
    origin: [number, number];
    obstacles: Array<{ box: PaintBox; ownLayer: boolean }>;
    paintBottom: number;
    plateTop: number;
  };
  const prepared: Prepared[] = [];
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
    if (e !== hero && heroPaintPending) continue;
    const slot = ring.indexOf(e.seat.closest<HTMLElement>('.seat-wrapper')!);
    const profile = profiles[slot];
    if (!profile || profile.scale <= 1) continue;
    const rect = restingAvatarBox(e.avatar, ratio);
    // The seat's own tag and badge are drawn over its portrait's crown, so the
    // portrait may grow behind them; they stay hard for every other seat.
    // Own cards may only keep an existing overlap; others' objects are hard.
    const obstacles = objects
      .filter((o) => !(o.owner === e.seat && ((o.layer && o.minimum) || o.overlay)))
      .map((o) => ({
        box: o.box,
        ownLayer: o.owner === e.seat && o.layer,
      }));
    prepared.push({
      e,
      rect,
      origin: [rect.left + rect.width / 2, rect.bottom],
      obstacles,
      paintBottom: Math.max(...e.parts.map(bottom)),
      plateTop: e.info.getBoundingClientRect().top,
    });
  }
  const viewport = page.getBoundingClientRect();
  const apply = (item: Prepared, choice: PaintChoice, clipBottom: number) => {
    const { e, rect } = item;
    state?.choices.set(e.image, choice);
    if (choice.scale === 1) return;
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
  };
  const peers = (item: Prepared) => {
    const list = item.obstacles.slice();
    for (const [seat, parts] of painted)
      if (seat !== item.e.seat)
        for (const box of parts) list.push({ box: box as DOMRect, ownLayer: false });
    return list;
  };

  // The seated hero first: the owner-approved 2x head-and-shoulders zoom,
  // centred over its plate, cropping its lower torso at the plate if needed.
  const heroItem = prepared.find((item) => item.e === hero);
  if (heroItem) {
    const { e, rect, origin, paintBottom, plateTop } = heroItem;
    let clipBottom = paintBottom;
    let choice = rebaseChoice(state?.choices.get(e.image), origin);
    if (!choice) {
      for (const lowerEdge of [...new Set([paintBottom, Math.min(paintBottom, plateTop)])]) {
        const candidate = chooseMobileAvatarPaint(
          e.parts,
          origin,
          lowerEdge,
          peers(heroItem),
          felt,
          viewport,
          Math.min(profiles[0]?.scale ?? MOBILE_HERO_MAX_SCALE, MOBILE_HERO_MAX_SCALE),
          Infinity,
          undefined,
          plateTop,
          true
        );
        if (!choice || candidate.scale > choice.scale) {
          choice = candidate;
          clipBottom = lowerEdge;
        }
      }
    }
    if (choice) apply(heroItem, choice, clipBottom);
  }

  // Dan 2026-11-12: every other portrait on the table is the EXACT same size,
  // the largest the tightest seat can take without touching any display. Each
  // grows straight up from its plate (no crop, no sideways shift), stays
  // centred over its frame box, and is never taller than the hero's portrait.
  // Candidate sizes are checked against the settled table first, then against
  // every neighbour already at that size, so two grown neighbours never meet.
  const others = prepared.filter((item) => item.e !== hero);
  if (others.length) {
    const cached = others.map((item) =>
      rebaseChoice(state?.choices.get(item.e.image), item.origin)
    );
    if (cached.every((c) => c)) {
      others.forEach((item, i) =>
        apply(item, cached[i]!, Math.min(item.paintBottom, item.plateTop))
      );
    } else {
      const at = (item: Prepared, scale: number, obstacles: Prepared['obstacles']) =>
        chooseMobileAvatarPaint(
          item.e.parts,
          item.origin,
          // The resting art tucks a pixel or two into its plate; clip there so
          // a wider portrait never paints through the plate.
          Math.min(item.paintBottom, item.plateTop),
          obstacles,
          felt,
          viewport,
          scale,
          heroPaintHeight,
          { scale, px: 0, py: 1 },
          item.plateTop
        );
      const fitsAll = (scale: number): PaintChoice[] | null => {
        const first = others.map((item) => at(item, scale, peers(item)));
        if (first.some((c) => c.scale !== scale)) return null;
        // Every neighbour at this size is an obstacle too.
        const grown = new Map(others.map((item, i) => [item.e.seat, first[i].parts]));
        const second = others.map((item) =>
          at(
            item,
            scale,
            peers(item).concat(
              others
                .filter((o) => o !== item)
                .flatMap((o) => grown.get(o.e.seat)!.map((box) => ({ box, ownLayer: false })))
            )
          )
        );
        return second.every((c) => c.scale === scale) ? second : null;
      };
      const rungs = [
        2.5, 2.45, 2.4, 2.35, 2.3, 2.25, 2.2, 2.15, 2.1, 2.05, 2, 1.95, 1.9, 1.85, 1.8, 1.75, 1.7,
        1.65, 1.6, 1.55, 1.5, 1.45, 1.4, 1.35, 1.3, 1.25, 1.2, 1.15, 1.1, 1.05, 1.02,
      ].filter((scale) => scale <= Math.min(...others.map(() => MOBILE_AVATAR_MAX_SCALE)));
      let best: PaintChoice[] | null = fitsAll(rungs[rungs.length - 1]);
      if (best) {
        let lo = 0,
          hi = rungs.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          const choices = fitsAll(rungs[mid]);
          if (choices) {
            best = choices;
            hi = mid;
          } else lo = mid + 1;
        }
      }
      others.forEach((item, i) => {
        const choice = best
          ? best[i]
          : { scale: 1, x: 0, y: 0, parts: item.e.parts, origin: item.origin };
        apply(item, choice, Math.min(item.paintBottom, item.plateTop));
      });
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
