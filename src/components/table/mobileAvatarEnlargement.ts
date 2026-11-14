import { restingAvatarBox, tableRenderScale } from './avatarCrownBounds';
import { buttonRadiusWidthPct } from './tableGeometry';
import {
  dealerSeatReservations,
  hiddenFanReservations,
  hiddenFanStates,
  mobilePositionLabels,
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

/** The locked size applied to a portrait that has no fitted choice yet (a
 * new arrival at a locked table): grown straight up from its own lower edge,
 * centred over its plate, cropped at clipBottom. No obstacle can change it. */
function fixedChoice(
  parts: PaintBox[],
  origin: [number, number],
  clipBottom: number,
  scale: number
): PaintChoice {
  if (!parts.length || scale <= 1) return { scale: 1, x: 0, y: 0, parts, origin };
  const left = Math.min(...parts.map((p) => p.left));
  const right = Math.max(...parts.map((p) => p.left + p.width));
  const lower = Math.max(...parts.map((p) => p.top + p.height));
  const pivot: [number, number] = [(left + right) / 2, lower];
  const next = parts
    .map((p) => {
      const top = pivot[1] + (p.top - pivot[1]) * scale;
      return {
        left: pivot[0] + (p.left - pivot[0]) * scale,
        top,
        width: p.width * scale,
        height: Math.max(
          0,
          Math.min(clipBottom, pivot[1] + (p.top + p.height - pivot[1]) * scale) - top
        ),
      };
    })
    .filter((p) => p.height > 0);
  return {
    scale,
    x: (1 - scale) * (pivot[0] - origin[0]),
    y: (1 - scale) * (pivot[1] - origin[1]),
    parts: next,
    origin,
  };
}

/** A fitted choice carried to a new origin, and to a new render ratio when
 * the device scale changed since it was fitted (viewport px per layout px). */
function rebaseChoice(choice: PaintChoice | undefined, origin: [number, number], k = 1) {
  if (!choice) return;
  return {
    ...choice,
    origin,
    x: choice.x * k,
    y: choice.y * k,
    parts: choice.parts.map((p) => ({
      left: origin[0] + (p.left - choice.origin[0]) * k,
      top: origin[1] + (p.top - choice.origin[1]) * k,
      width: p.width * k,
      height: p.height * k,
    })),
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
/** Remove the fixed mobile paint. With geometryOnly, only what moves a box
 * (the zoom, its translation and the frame plates) is removed so a layout
 * pass can measure the resting table; the image's filter and torso clip stay,
 * because removing and restoring them inside one pass restarts the image's
 * `filter` transition every pass, and that running transition kept the
 * opponent layout from ever settling, so the table could not refit (the
 * small/large flicker Dan saw, 2026-11-12). */
export function resetMobileAvatarPaint(scaler: HTMLElement, geometryOnly = false) {
  scaler
    .querySelectorAll<HTMLElement>('.seat__info')
    .forEach((info) => frameProperties.forEach((name) => info.style.removeProperty(name)));
  if (!geometryOnly)
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

/** Whether this table, as laid out now, takes the fixed mobile paint at all. */
export function mobileAvatarPaintSupported(scaler: HTMLElement, page: HTMLElement) {
  if (!matchMedia('(min-width: 481px) and (max-width: 768px) and (orientation: portrait)').matches)
    return false;
  const key = `${page.classList.contains('table-page--tournament') ? 'tournament' : 'cash'}|${page.dataset.seats}|${page.dataset.hero === 'false' ? 'spectator' : 'seated'}`;
  return (
    Boolean(MOBILE_PROFILES[key]) &&
    page.dataset.killEnabled === 'false' &&
    [2, 3, 4, 5, 6].includes(Number(page.dataset.holeCardCount)) &&
    Boolean(scaler.querySelector('.seat__avatar'))
  );
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
  const cached = state?.choices.get(image);
  if (cached) {
    if (cached.scale === 1) return baseline;
    const avatar = image.closest<HTMLElement>('.seat__avatar')!;
    const rect = restingAvatarBox(avatar, tableRenderScale(scaler));
    return unionPaint([
      baseline,
      ...rebaseChoice(
        cached,
        [rect.left + rect.width / 2, rect.bottom],
        tableRenderScale(scaler) / (state?.ratio || tableRenderScale(scaler))
      )!.parts,
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
  const cached = scaler ? state?.frames.get(info) : undefined;
  if (cached)
    return cached.scale === 1
      ? baseline
      : unionPaint([
          baseline,
          ...rebaseChoice(
            cached,
            [baseline.left + baseline.width / 2, bottom(baseline)],
            tableRenderScale(scaler!) / (state?.ratio || tableRenderScale(scaler!))
          )!.parts,
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
    '.seat__info,.community-area,.pot-area,.pot-display,.pot-display__pile,.table-hud button,.table-hud__corner > *,.chat-collapsed,.action-panel-wrapper,.table-tab-bar,.bbj-container,.seat:not(.seat--empty) .seat__avatar:not(.seat__avatar--bust),.seat__empty-img'
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
    // Chips on the felt are displays: hard for every portrait.
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
      // The hero's private cards draw above its portrait: the hero may grow
      // behind its own row and every card stays whole; the row stays hard for
      // every other seat.
      for (const box of reserved.boxes)
        boxes.push({ box, owner: seat, layer: true, overlay: true });
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
    // A shown hand draws above its owner's portrait (z-index 4 over 2): the
    // owner may grow behind it; it stays hard for every other seat.
    if (box.width && box.height)
      boxes.push({ box, owner: card.closest('.seat'), layer: true, overlay: true });
  }
  return boxes;
}

export type MobilePaintState = {
  key: string;
  choices: Map<HTMLImageElement, PaintChoice>;
  frames: Map<HTMLElement, PaintChoice>;
  clips: Map<HTMLImageElement, string>;
  obstacles?: ReturnType<typeof stableObstacles>;
  /** Dan 2026-11-12: the table's sizes, locked the first time they are
   * chosen and kept across every later refit (roster, toolbar, resize). A
   * later refit may only confirm them; it never raises them, and lowers
   * them only when a seat can no longer take the locked size at all. */
  locked?: {
    /** The ring the size was locked for; a different ring starts over. */
    ring?: string;
    /** The one size every portrait on this table takes, the hero's included. */
    uniform?: number;
  };
  /** The render ratio (viewport px per layout px) the choices were fitted at. */
  ratio?: number;
  /** The layout key changed since the choices were fitted. The displayed
   * paint and its reservations carry on as they are until the next refit. */
  stale?: boolean;
};
/** Dan 2026-11-13: every table of one game type (cash or tournament, six- or
 * nine-handed) shows the same portrait size on this device, seated or
 * watching, across sessions. The first table to settle a size records it here
 * as a displayed height in layout px; every later table of that type takes the
 * same height, or the largest it can if its own displays (chips, bets, the
 * dealer button) leave less room, and that smaller height then becomes the
 * type's size from then on. The recorded size only ever settles downward to
 * the one every table state can take, and a size a table has already shown
 * is never changed by this. Kept on the device, not per tab, so a new visit
 * does not start a different size. */
// New rail geometry and preallocated portrait scale require a fresh size fit.
const SHARED_SIZE_STORE = 'sp-mobile-avatar-size-v2';
const sharedSizes: Map<string, number> = (() => {
  try {
    return new Map(Object.entries(JSON.parse(localStorage.getItem(SHARED_SIZE_STORE) || '{}')));
  } catch {
    return new Map();
  }
})();
const recordSharedSize = (type: string, height: number) => {
  const known = sharedSizes.get(type);
  if (known !== undefined && known <= height) return;
  sharedSizes.set(type, height);
  try {
    localStorage.setItem(SHARED_SIZE_STORE, JSON.stringify(Object.fromEntries(sharedSizes)));
  } catch {
    /* Private mode or a full store: the in-memory size still applies. */
  }
};
/** Test seam: forget the recorded per-type sizes. */
export const resetSharedMobileAvatarSizes = () => {
  sharedSizes.clear();
  try {
    localStorage.removeItem(SHARED_SIZE_STORE);
  } catch {
    /* Nothing stored. */
  }
};
export const createMobilePaintState = (): MobilePaintState => ({
  key: '',
  choices: new Map(),
  frames: new Map(),
  clips: new Map(),
});
/** Dan 2026-11-12: a size never changes once set, so this key names only
 * what changes the table's geometry (the scaler's own size and place, the
 * ring, the variant, the roster and each portrait's normalization), rounded
 * so sub-pixel drift between passes cannot count as a new layout. The
 * viewport height is deliberately absent: an iOS toolbar or keyboard
 * changes it without moving a chair, and it used to refit the whole table. */
export function mobilePaintKey(scaler: HTMLElement, page: HTMLElement) {
  const round = (value: number) => Math.round(value * 10) / 10;
  const roundProperty = (value: string) => {
    const number = parseFloat(value);
    return Number.isFinite(number) ? String(Math.round(number * 100) / 100) : value;
  };
  return JSON.stringify([
    innerWidth,
    scaler.offsetWidth,
    scaler.offsetHeight,
    round(scaler.getBoundingClientRect().left),
    round(scaler.getBoundingClientRect().top),
    Math.round(tableRenderScale(scaler) * 1000) / 1000,
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
      roundProperty(
        image
          .closest<HTMLElement>('.seat__avatar')
          ?.style.getPropertyValue('--sp-opponent-art-scale') ?? ''
      ),
      roundProperty(
        image.closest<HTMLElement>('.seat')?.style.getPropertyValue('--sp-opponent-x') ?? ''
      ),
      roundProperty(
        image.closest<HTMLElement>('.seat')?.style.getPropertyValue('--sp-opponent-y') ?? ''
      ),
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
      // Dan 2026-11-12: a size never changes once set. The fitted choices
      // stay displayed and reserved through a key change (toolbar, resize, a
      // chair changing hands); they are refitted below at the locked size.
      state.key = key;
      state.stale = true;
      state.frames.clear();
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
  // Dan, 2026-11-11: the hero's portrait is never the smaller one. A photo or
  // initials hero is its circle, which does not grow; its height then caps
  // every portrait's painted height.
  const heroCap =
    hero && !hero.avatar.classList.contains('seat__avatar--bust')
      ? hero.avatar.getBoundingClientRect().height
      : Infinity;
  // A character portrait whose runs are not readable yet would be left out of
  // the table's one size. Before the size is locked the table waits for the
  // pass in which every portrait is readable; after, a late one simply takes
  // the locked size.
  const paintPending = entries.some(
    (e) => !e.parts.length && e.avatar.classList.contains('seat__avatar--bust')
  );
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
    const { e } = item;
    state?.choices.set(e.image, choice);
    // Keep brightness/saturation (including folds). An enlarged soft shadow
    // must not spread onto felt that the original art left clear.
    // The active spotlight is a transient CSS leaf filter, never part of
    // the locked portrait paint. Capturing it here would leave the previous
    // actor bright after the turn moves to another chair.
    const transientStatus = e.seat.matches('.seat--away, .seat--sitting_out');
    const spotlight =
      e.seat.closest('.seat-wrapper--spot') && !e.seat.classList.contains('seat--folded');
    const filter =
      spotlight || transientStatus
        ? e.image.style.getPropertyValue('--sp-mobile-filter') || 'none'
        : getComputedStyle(e.image)
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
      const value = `${clip}px`;
      state?.clips.set(e.image, value);
      e.image.style.setProperty('--sp-mobile-clip-bottom', value);
    }
    painted.set(e.seat, choice.parts);
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
  // Dan 2026-11-12: "they need to stay the same size 1000% of the time".
  // Once a table's sizes are set they are final for this ring: a refit after
  // a resize, a toolbar, a new hand or a new player reuses them exactly and
  // never searches again. Only a different ring (another capacity, or the
  // viewer sitting down or standing up) starts over.
  if (state && state.locked?.ring !== profileKey) state.locked = { ring: profileKey };
  const lock = state?.locked;
  const k = state?.ratio ? ratio / state.ratio : 1;
  // Dan 2026-11-12: every avatar on the table, the hero's included, is the
  // EXACT same size in six- and nine-handed games: the largest one size every
  // seated portrait can take at once without touching any display, grown
  // straight up from its plate (no sideways shift), centred over its frame
  // box. Candidates are checked against the permanent table, then against
  // every neighbour already at that size, so two grown neighbours never meet.
  if (!lock?.uniform && paintPending) prepared.length = 0;
  if (prepared.length && lock?.uniform) {
    const size = lock.uniform;
    prepared.forEach((item) => {
      const clipBottom = Math.min(item.paintBottom, item.plateTop);
      const cached = state?.choices.get(item.e.image);
      apply(
        item,
        cached && cached.scale === size
          ? rebaseChoice(cached, item.origin, k)!
          : fixedChoice(item.e.parts, item.origin, clipBottom, size),
        clipBottom
      );
    });
  } else if (prepared.length) {
    // Fit as if every chair were occupied, so the locked size still holds when
    // the ring fills: each empty chair takes a stand-in portrait (its mirror
    // seat's, or the nearest occupied seat's, moved to that chair) with that
    // seat's plate, and the stand-ins must fit like everyone else.
    type FitItem = {
      key: object;
      parts: PaintBox[];
      origin: [number, number];
      paintBottom: number;
      plateTop: number;
      obstacles: Prepared['obstacles'];
    };
    // A chair's ring position (its wrapper's left/top percentages of the
    // scaler), which an empty or hidden chair has like any other.
    const scalerBox = scaler.getBoundingClientRect();
    const centre = (element: HTMLElement) =>
      [
        scalerBox.left + (parseFloat(element.style.left) / 100) * scalerBox.width,
        scalerBox.top + (parseFloat(element.style.top) / 100) * scalerBox.height,
      ] as const;
    const real: FitItem[] = prepared.map((item) => ({
      key: item.e.seat,
      parts: item.e.parts,
      origin: item.origin,
      paintBottom: item.paintBottom,
      plateTop: item.plateTop,
      obstacles: peers(item),
    }));
    const byWrapper = new Map(
      prepared.map((item) => [item.e.seat.closest<HTMLElement>('.seat-wrapper')!, item])
    );
    const occupiedWrappers = new Set(
      Array.from(scaler.querySelectorAll('.seat:not(.seat--empty)')).map((seat) =>
        seat.closest('.seat-wrapper')
      )
    );
    // Every reserved display on the table is hard for a stand-in: it owns none.
    const hardObjects = objects.map((o) => ({ box: o.box, ownLayer: false }));
    const phantoms: FitItem[] = [];
    ring.forEach((wrapper, index) => {
      if (occupiedWrappers.has(wrapper) || !prepared.length) return;
      // The hero's pod has its own geometry (larger plate, cards below), so it
      // never stands in for an opponent's chair while any opponent is seated.
      const opponents = prepared.filter((item) => !item.e.seat.classList.contains('seat--hero'));
      const candidates = opponents.length ? opponents : prepared;
      const mirrored = byWrapper.get(ring[(ring.length - index) % ring.length]);
      const mirror = mirrored && candidates.includes(mirrored) ? mirrored : undefined;
      const reference =
        mirror ??
        candidates
          .map((item) => ({
            item,
            distance: Math.min(
              Math.abs(ring.indexOf(item.e.seat.closest<HTMLElement>('.seat-wrapper')!) - index),
              ring.length -
                Math.abs(ring.indexOf(item.e.seat.closest<HTMLElement>('.seat-wrapper')!) - index)
            ),
          }))
          .sort((a, b) => a.distance - b.distance)[0].item;
      const from = centre(reference.e.seat.closest<HTMLElement>('.seat-wrapper')!);
      const to = centre(wrapper);
      const dx = to[0] - from[0],
        dy = to[1] - from[1];
      // A mirror seat's portrait is reflected about its own centre line.
      const flip = Boolean(mirror);
      const ox = reference.origin[0];
      const move = (box: PaintBox): PaintBox => ({
        left: (flip ? 2 * ox - (box.left + box.width) : box.left) + dx,
        top: box.top + dy,
        width: box.width,
        height: box.height,
      });
      const plate = reference.e.info.getBoundingClientRect();
      const movedPlate = move(plate);
      phantoms.push({
        key: wrapper,
        parts: reference.e.parts.map(move),
        origin: [reference.origin[0] + dx, reference.origin[1] + dy],
        paintBottom: reference.paintBottom + dy,
        plateTop: reference.plateTop + dy,
        // Its own empty chair (the sit button it replaces) is not an obstacle:
        // a stand-in occupies exactly that chair.
        obstacles: hardObjects
          .filter((_, i) => !(objects[i].owner && wrapper.contains(objects[i].owner)))
          .concat(
            Array.from(painted.values()).flatMap((parts) =>
              parts.map((box) => ({ box, ownLayer: false }))
            )
          ),
      });
      // The stand-in's future plate is a display every other portrait avoids.
      for (const item of real) item.obstacles.push({ box: movedPlate, ownLayer: false });
    });
    const everyone = real.concat(phantoms);
    const at = (item: FitItem, scale: number, obstacles: FitItem['obstacles']) =>
      chooseMobileAvatarPaint(
        item.parts,
        item.origin,
        // The resting art tucks a pixel or two into its plate; clip there so
        // a wider portrait never paints through the plate.
        Math.min(item.paintBottom, item.plateTop),
        obstacles,
        felt,
        viewport,
        scale,
        heroCap,
        { scale, px: 0, py: 1 },
        item.plateTop
      );
    const fitsAll = (scale: number): PaintChoice[] | null => {
      const first = everyone.map((item) => at(item, scale, item.obstacles));
      if (first.some((c) => c.scale !== scale)) return null;
      const grown = new Map(everyone.map((item, i) => [item.key, first[i].parts]));
      const second = everyone.map((item) =>
        at(
          item,
          scale,
          item.obstacles.concat(
            everyone
              .filter((o) => o !== item)
              .flatMap((o) => grown.get(o.key)!.map((box) => ({ box, ownLayer: false })))
          )
        )
      );
      return second.every((c) => c.scale === scale) ? second.slice(0, real.length) : null;
    };
    // The game type's displayed height, shared by every table of that type.
    const sizeType = `${profileKey.split('|').slice(0, 2).join('|')}|${innerWidth}`;
    // Include the CSS bust gain and normalized slot, but remove the retained
    // paint zoom. offsetHeight alone omits the new preallocated portrait gain.
    const restingHeight = Math.max(
      ...prepared.map((item) => restingAvatarBox(item.e.image, ratio).height / ratio)
    );
    const shared = sharedSizes.get(sizeType);
    const rungs = [
      2.5, 2.45, 2.4, 2.35, 2.3, 2.25, 2.2, 2.15, 2.1, 2.05, 2, 1.95, 1.9, 1.85, 1.8, 1.75, 1.7,
      1.65, 1.6, 1.55, 1.5, 1.45, 1.4, 1.35, 1.3, 1.25, 1.2, 1.15, 1.1, 1.05, 1.02, 1,
    ].filter(
      (scale) =>
        scale <= MOBILE_AVATAR_MAX_SCALE &&
        (shared === undefined || !restingHeight || scale * restingHeight <= shared + 0.5)
    );
    let best: PaintChoice[] | null = rungs.length ? fitsAll(rungs[rungs.length - 1]) : null;
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
    // Dan 2026-10-22: a bet and the dealer button each read as their own
    // player's, nearer that player's portrait than any other. Growing every
    // portrait together moves their visible centres, so a size that would
    // put a displayed bet or the button nearer a neighbour is not taken; the
    // next size down that keeps every one of them with its owner is.
    const anchors: Array<[DOMRect, Element]> = [];
    for (const chips of scaler.querySelectorAll('.seat__bet-chips')) {
      const box = chips.getBoundingClientRect(),
        owner = chips.closest('.seat-wrapper');
      if (owner && box.width && box.height) anchors.push([box, owner]);
    }
    const puck = page.querySelector<HTMLElement>('.dealer-button');
    const puckOwner = puck
      ? ring.find(
          (wrapper) =>
            Math.abs(parseFloat(wrapper.style.left) - parseFloat(puck.dataset.ownerX ?? '')) <
              0.01 &&
            Math.abs(parseFloat(wrapper.style.top) - parseFloat(puck.dataset.ownerY ?? '')) < 0.01
        )
      : undefined;
    if (puck && puckOwner) anchors.push([puck.getBoundingClientRect(), puckOwner]);
    const readable = (scale: number) => {
      if (!anchors.length) return true;
      const centres = new Map<Element, [number, number]>();
      for (const item of prepared) {
        const wrapper = item.e.seat.closest('.seat-wrapper');
        const parts = fixedChoice(
          item.e.parts,
          item.origin,
          Math.min(item.paintBottom, item.plateTop),
          scale
        ).parts;
        if (!wrapper || !parts.length) continue;
        centres.set(wrapper, [
          (Math.min(...parts.map((q) => q.left)) +
            Math.max(...parts.map((q) => q.left + q.width))) /
            2,
          (Math.min(...parts.map((q) => q.top)) + Math.max(...parts.map((q) => q.top + q.height))) /
            2,
        ]);
      }
      // A clear margin, so the reading never rests on a pixel.
      const margin = 2 * ratio;
      return anchors.every(([box, owner]) => {
        const own = centres.get(owner);
        if (!own) return true;
        const x = box.left + box.width / 2,
          y = box.top + box.height / 2;
        const mine = Math.hypot(x - own[0], y - own[1]);
        for (const [wrapper, c] of centres)
          if (wrapper !== owner && Math.hypot(x - c[0], y - c[1]) < mine + margin) return false;
        return true;
      });
    };
    if (best && !readable(best[0].scale)) {
      const from = rungs.indexOf(best[0].scale);
      best = null;
      for (let i = from + 1; i < rungs.length && !best; i++)
        if (readable(rungs[i])) best = fitsAll(rungs[i]);
    }
    if (lock && best) lock.uniform = best[0].scale;
    if (best && restingHeight) recordSharedSize(sizeType, best[0].scale * restingHeight);
    prepared.forEach((item, i) => {
      const choice = best
        ? best[i]
        : { scale: 1, x: 0, y: 0, parts: item.e.parts, origin: item.origin };
      apply(item, choice, Math.min(item.paintBottom, item.plateTop));
    });
  }
  // A portrait left unzoomed by this fit keeps no zoom-only filter or clip.
  scaler.querySelectorAll<HTMLImageElement>('.seat__avatar-img').forEach((image) => {
    if (
      image.closest<HTMLElement>('.seat__avatar')?.style.getPropertyValue('--sp-mobile-art-scale')
    )
      return;
    image.style.removeProperty('--sp-mobile-clip-bottom');
    image.style.removeProperty('--sp-mobile-filter');
  });
  if (state) {
    state.stale = false;
    state.ratio = ratio;
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
