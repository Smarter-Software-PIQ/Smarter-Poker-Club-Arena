import { useLayoutEffect, useRef, type RefObject } from 'react';
import {
  avatarRestPose,
  restingAvatarTop,
  restingAvatarBox,
  tableRenderScale,
} from '../components/table/avatarCrownBounds';
import { createOpponentAvatarLayout } from '../components/table/opponentAvatarLayout';
import { placeProtectedCardRow, type CardBox } from '../lib/protectedCardPlacement';
import {
  assignProtectedWagers,
  greedyProtectedWagers,
  wagerBoxesOverlap,
} from '../lib/protectedWagerPlacement';
import {
  FELT_WINDOW,
  projectPortraitTable,
  unprojectPortraitTable,
  chipRadiusWidthPct,
  PORTRAIT_CARD_LANE_MAX_VIEWPORT_PX,
} from '../components/table/tableGeometry';

type SettledCardRow = { translate: string; width: string; step: string };

/** Layout belongs to the table that paints it; no global selectors or game-state writes. */
export function useProtectedCardLayout(
  root: RefObject<HTMLDivElement | null>,
  revision: string,
  handKey = 'current'
) {
  const opponentArt = useRef({ key: '', shifts: new WeakMap<HTMLElement, [number, number]>() });
  // A runout changes the board, pot and highlights, never the hand's slot.
  // Retain placements across effect revisions; only a new hand or viewport
  // geometry may allocate a new slot. Removed DOM rows expire naturally.
  const settled = useRef({
    key: '',
    dealer: null as { owner: string; translate: string } | null,
    rows: new WeakMap<HTMLElement, SettledCardRow>(),
    pods: new WeakMap<HTMLElement, string>(),
    podPoses: new WeakMap<HTMLElement, string>(),
    ownerSpacingTried: new WeakSet<HTMLElement>(),
    wagers: new WeakMap<
      HTMLElement,
      { offsets: string[]; width: number; height: number; owner: string | null }
    >(),
  });
  useLayoutEffect(() => {
    const scaler = root.current;
    const page = scaler?.closest('.table-page');
    if (!scaler || !page) return;
    let active = true;
    const observedCardAnimations = new WeakSet<Animation>();
    const restoreRow = (row: HTMLElement, fixed: SettledCardRow) => {
      row.style.translate = fixed.translate;
      for (const [name, value] of [
        ['--vh-card-w', fixed.width],
        ['--vh-step-f', fixed.step],
      ]) {
        if (value) row.style.setProperty(name, value);
        else row.style.removeProperty(name);
      }
    };
    const refreshGeometry = () => {
      const box = scaler.getBoundingClientRect();
      const key = [
        handKey,
        Math.round(box.width),
        Math.round(box.height),
        Math.round(page.getBoundingClientRect().width),
        // Orientation, not the raw viewport height: a phone browser's toolbar
        // showing or hiding changes innerHeight without moving the felt. When
        // it does resize the table, the scaler box above changes and resets.
        window.innerHeight > window.innerWidth ? 'portrait' : 'landscape',
        scaler.style.getPropertyValue('--table-w'),
        scaler.style.getPropertyValue('--table-h'),
        scaler.style.getPropertyValue('--sp-board-card-w'),
        scaler.style.getPropertyValue('--sp-tabled-card-w'),
      ].join(':');
      if (settled.current.key !== key) {
        settled.current = {
          key,
          dealer: null,
          rows: new WeakMap(),
          pods: new WeakMap(),
          podPoses: new WeakMap(),
          ownerSpacingTried: new WeakSet(),
          wagers: new WeakMap(),
        };
      }
    };
    refreshGeometry();
    const topPods = () =>
      Array.from(
        scaler.querySelectorAll<HTMLElement>(
          page.getAttribute('data-seats') === '6' && page.getBoundingClientRect().width > 480
            ? '.seat-wrapper--cap, .seat-wrapper--top'
            : '.seat-wrapper--top'
        )
      );
    const wagers = () => Array.from(scaler.querySelectorAll<HTMLElement>('.seat__bet-chips'));
    const resetWagers = () =>
      wagers().forEach((bet) => {
        for (const name of ['--bet-offset-x', '--bet-offset-y', '--collect-dx', '--collect-dy'])
          bet.style.removeProperty(name);
      });
    const hasPendingCardMotion = (rows: HTMLElement[]) => {
      const entering = rows
        .flatMap((row) => row.getAnimations?.({ subtree: true }) ?? [])
        .filter(
          (animation) =>
            animation.playState === 'running' &&
            Number.isFinite(animation.effect?.getComputedTiming().iterations)
        );
      for (const animation of entering)
        if (!observedCardAnimations.has(animation)) {
          observedCardAnimations.add(animation);
          const completed = () => {
            if (active) schedule();
          };
          void animation.finished.then(completed, completed);
        }
      return entering.length > 0;
    };
    /* The tabled hands. On a phone they are placed BEFORE the wagers and the
       dealer button (Dan 2026-10-22: a shown hand must be clearly displayed at
       its own player), which are then placed round them; elsewhere, after. */
    const placeRows = (withMarkers: boolean) => {
      const rows = Array.from(scaler.querySelectorAll<HTMLElement>('.seat__cards--revealed')).sort(
        (a, b) =>
          // Edge chairs' shown hands are confined by the viewport. Reserve
          // those narrow lanes first, then place the flexible cap hands in
          // the space between them, in six- and nine-seat rings alike.
          Number(Boolean(a.closest('.seat-wrapper--cap,.seat-wrapper--top'))) -
          Number(Boolean(b.closest('.seat-wrapper--cap,.seat-wrapper--top')))
      );
      // Do not capture a partial deal/flip or reveal-size transition as the
      // permanent card width. Every owed animation still plays to completion;
      // its own finite completion resumes this same placement transaction.
      if (hasPendingCardMotion(rows.filter((row) => !settled.current.rows.has(row)))) return false;
      const scale = tableRenderScale(scaler);
      const visibleBox = (element: Element): CardBox | null => {
        // Corner badges share the avatar's breathing and winner wrapper. Its
        // compositor pose must not turn into a new permanent card/wager lane.
        const box =
          element instanceof HTMLElement && element.matches('.seat__position-badge')
            ? restingAvatarBox(element, scale)
            : element.getBoundingClientRect();
        return box.width > 0 && box.height > 0 ? box : null;
      };
      const protectedEntries = Array.from(
        page.querySelectorAll(
          (withMarkers ? '.seat__bet-chips, ' : '') +
            '.community-area, .seat__avatar-img, .pot-area, .pot-display, .seat__info, .seat__strength, .seat__action, .seat__bounty, .seat__position-badge, .pot-display__pile, .action-panel, .bbj-widget, .bbj-mini-plate, .cch-column, .chat-collapsed'
        )
      ).flatMap((element) => {
        // Transparent canvas is not a foreign character. Retain the same
        // card/panel keep-outs while measuring actual decoded avatar paint.
        const box =
          element instanceof HTMLImageElement && element.matches('.seat__avatar-img')
            ? (artwork.paintedBox(element) ?? visibleBox(element))
            : visibleBox(element);
        return box ? [{ element, box }] : [];
      });
      const protectedBoxes = protectedEntries.map(({ box }) => box);
      // A later seat can reveal before an earlier DOM sibling. Reserve every
      // already-settled hand before allocating any new one, regardless of order.
      for (const fixedRow of rows) {
        if (!settled.current.rows.has(fixedRow)) continue;
        const boxes = Array.from(fixedRow.querySelectorAll('.seat__card'))
          .map(visibleBox)
          .filter((box): box is CardBox => box !== null);
        if (!boxes.length) continue;
        const left = Math.min(...boxes.map((box) => box.left));
        const top = Math.min(...boxes.map((box) => box.top));
        protectedBoxes.push({
          left,
          top,
          width: Math.max(...boxes.map((box) => box.left + box.width)) - left,
          height: Math.max(...boxes.map((box) => box.top + box.height)) - top,
        });
      }
      const dealer = withMarkers ? scaler.querySelector<HTMLElement>('.dealer-button') : null;
      if (dealer) {
        const settled = dealerSettledBox(scaler, dealer);
        if (settled) protectedBoxes.push(settled);
      }
      const pageBounds = page.getBoundingClientRect();
      for (const row of rows) {
        // Top-cap reveals need daylight below the mobile page's clipping
        // edge. Jackpot rectangles remain individual keep-outs: reserving
        // their entire horizontal band would push a centred hand to a neighbour.
        const mobileTop =
          pageBounds.top +
          (row.closest('.seat-wrapper--cap') && window.innerWidth <= 768 ? 8 * scale : 0);
        const bounds = {
          left: pageBounds.left,
          top: mobileTop,
          width: pageBounds.width,
          height: Math.max(0, pageBounds.bottom - mobileTop),
        };

        const fixed = settled.current.rows.get(row);
        if (fixed !== undefined) {
          restoreRow(row, fixed);
          const cards = Array.from(row.querySelectorAll('.seat__card'))
            .map(visibleBox)
            .filter((box): box is CardBox => box !== null);
          if (cards.length) {
            const left = Math.min(...cards.map((card) => card.left));
            const top = Math.min(...cards.map((card) => card.top));
            protectedBoxes.push({
              left,
              top,
              width: Math.max(...cards.map((card) => card.left + card.width)) - left,
              height: Math.max(...cards.map((card) => card.top + card.height)) - top,
            });
          }
          continue;
        }
        // Hero containers span the reserved bottom strip; only the painted
        // cards are obstacles, not that transparent flex alignment space.
        const cards = Array.from(row.querySelectorAll('.seat__card'))
          .map(visibleBox)
          .filter((box): box is CardBox => box !== null);
        if (!cards.length) continue;
        const left = Math.min(...cards.map((card) => card.left));
        const top = Math.min(...cards.map((card) => card.top));
        const box = {
          left,
          top,
          width: Math.max(...cards.map((card) => card.left + card.width)) - left,
          height: Math.max(...cards.map((card) => card.top + card.height)) - top,
        };
        // Dan 2026-10-22: a tabled hand must be clearly shown, and shown at
        // its own player. A villain's tabled row is drawn over that player's
        // own art (the bust, the action tag, the bounty and position chips),
        // never its plate, so a full-size PLO5 or PLO6 row stays beside its
        // owner instead of being pushed across the table to the first empty
        // patch of felt.
        const seat = row.classList.contains('seat__cards--opponent') ? row.closest('.seat') : null;
        // Keep DOM ownership, not a second animated rectangle measurement:
        // equal boxes are not identity, and one avatar/action can change its
        // painted box between layout reads without becoming another player.
        const ownBoxes = new Set(
          protectedEntries
            .filter(
              ({ element }) =>
                seat?.contains(element) &&
                element.matches(
                  '.seat__avatar-img, .seat__action, .seat__bounty, .seat__position-badge'
                )
            )
            .map(({ box }) => box)
        );
        const others = protectedBoxes.filter((other) => !ownBoxes.has(other));
        // The hand stands nearer its own player than any other (avatar
        // centres), whenever any such spot exists.
        const mineImage = seat?.querySelector<HTMLImageElement>('.seat__avatar-img');
        const mineAt = mineImage ? restingAvatarBox(mineImage, scale) : null;
        const centres = Array.from(
          scaler.querySelectorAll('.seat:not(.seat--empty) .seat__avatar-img')
        )
          .map((img) => restingAvatarBox(img as HTMLImageElement, scale))
          .filter((r) => r.width > 0 && r !== mineAt)
          .map((r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 }));
        const ownsIt = (candidate: CardBox) => {
          if (!mineAt || !mineAt.width) return true;
          const x = candidate.left + candidate.width / 2;
          const y = candidate.top + candidate.height / 2;
          const own = Math.hypot(
            x - (mineAt.left + mineAt.width / 2),
            y - (mineAt.top + mineAt.height / 2)
          );
          return centres.every(
            (c) =>
              Math.hypot(
                c.x - (mineAt.left + mineAt.width / 2),
                c.y - (mineAt.top + mineAt.height / 2)
              ) < 1 || own + 4 < Math.hypot(x - c.x, y - c.y)
          );
        };
        // Prefer the owner's lane with zero extra padding before moving a
        // shown hand beside another chair. Rectangles still cannot overlap.
        const place = (candidate: CardBox) =>
          placeProtectedCardRow(candidate, others, bounds, cards.length >= 5 ? 3 : 4, ownsIt) ??
          placeProtectedCardRow(candidate, others, bounds, 0, ownsIt) ??
          placeProtectedCardRow(candidate, others, bounds);
        let natural = box;
        let next = place(box);
        // Shorter tabled rows that cannot stay at their own player
        // at full spacing closes up, a step at a time, before it is allowed to
        // leave: every card keeps the board's size and its rank and suit
        // corner, the row just overlaps more. Only when no spacing is this
        // player's does it drop to 85 percent of the board's size. Widths are
        // computed rather than measured, because cards glide over 0.2s.
        const count = cards.length;
        if (seat && count >= 2 && count <= 6) {
          // The spacing and card size this hand was drawn at, and the ones the
          // stylesheet gives it, so a closed-up hand can be judged at full size.
          const inlineStep = parseFloat(row.style.getPropertyValue('--vh-step-f'));
          const inlineWidth = row.style.getPropertyValue('--vh-card-w');
          const drawnW = Math.max(...cards.map((card) => card.width));
          if (!Number.isFinite(inlineStep)) {
            row.dataset.baseStep = getComputedStyle(row).getPropertyValue('--vh-step-f').trim();
          }
          if (!inlineWidth) row.dataset.baseCardW = String(drawnW / scale);
          const base = parseFloat(row.dataset.baseStep ?? '') || 0.5;
          const fullW = (parseFloat(row.dataset.baseCardW ?? '') || drawnW / scale) * scale;
          const anchor = row.closest('.seat-wrapper--top')
            ? 'centre'
            : seat.classList.contains('seat--cards-right')
              ? 'right'
              : 'left';
          // The row's own anchors: its bottom edge, and its outboard edge (or
          // its centre on a top-cap chair).
          const anchorX =
            anchor === 'left'
              ? box.left
              : anchor === 'right'
                ? box.left + box.width
                : box.left + box.width / 2;
          const bottom = box.top + box.height;
          const heightPerW = box.height / drawnW;
          const at = (step: number, size: number): CardBox => {
            const cardW = fullW * size;
            const width = cardW * (1 + (count - 1) * step);
            const height = cardW * heightPerW;
            const left =
              anchor === 'left'
                ? anchorX
                : anchor === 'right'
                  ? anchorX - width
                  : anchorX - width / 2;
            return { left, top: bottom - height, width, height };
          };
          const shifted = (from: CardBox, to: CardBox) =>
            Math.hypot(to.left - from.left, to.top - from.top);
          // Board size first, at its own spacing, then closing up, then (only
          // when nothing else is this player's) 85 percent of the board's size.
          const tries: Array<[number, number]> = [];
          for (const size of count >= 5 ? [1] : [1, 0.85])
            for (const step of [base, 0.6, 0.5, 0.4, 0.32, 0.27])
              if (
                step <= base &&
                (count < 5 || step >= 0.5) &&
                !tries.some(([a, b]) => a === step && b === size)
              )
                tries.push([step, size]);
          let pick: { step: number; size: number; from: CardBox; to: CardBox } | null = null;
          for (const [step, size] of tries) {
            const from = at(step, size);
            const to =
              placeProtectedCardRow(from, others, bounds, 4, ownsIt) ??
              placeProtectedCardRow(from, others, bounds, 0, ownsIt);
            if (!to) continue;
            if (!pick || shifted(from, to) < shifted(pick.from, pick.to))
              pick = { step, size, from, to };
            if (shifted(from, to) <= fullW * size * 1.5) break;
          }
          if (!pick) {
            const from = at(base, 1);
            const to = placeProtectedCardRow(from, others, bounds);
            if (to) pick = { step: base, size: 1, from, to };
          }
          if (pick) {
            if (pick.step === base) row.style.removeProperty('--vh-step-f');
            else row.style.setProperty('--vh-step-f', String(pick.step));
            if (pick.size === 1) row.style.removeProperty('--vh-card-w');
            else row.style.setProperty('--vh-card-w', `${(fullW * pick.size) / scale}px`);
            natural = pick.from;
            next = pick.to;
          }
        }
        if (next) {
          // translate is independent of the deal/flip transform and preserves animations.
          row.style.translate = `${(next.left - natural.left) / scale}px ${(next.top - natural.top) / scale}px`;
          protectedBoxes.push(next);
        } else {
          // No clearer spot on this felt: the hand stays where it is drawn.
          row.style.removeProperty('translate');
          protectedBoxes.push(natural);
        }
        // Dan 2026-10-23: shown cards never move once they are on the table.
        // Every tabled hand (Hold'em through PLO6) keeps this slot, spacing and
        // size for the rest of the hand; only a new hand or a real change in
        // the table's own geometry may place it again.
        settled.current.rows.set(row, {
          translate: row.style.translate || '',
          width: row.style.getPropertyValue('--vh-card-w'),
          step: row.style.getPropertyValue('--vh-step-f'),
        });
      }
      return true;
    };
    const artwork = createOpponentAvatarLayout(
      scaler,
      page as HTMLElement,
      opponentArt.current,
      () => schedule()
    );
    const place = (
      remainingOwnerSpacingPasses = wagers().length,
      spacingOrigins?: Map<HTMLElement, { y: number; radius: number }>
    ) => {
      refreshGeometry();
      resetWagers();
      if (artwork.prepare(handKey)) {
        settled.current.pods = new WeakMap();
        settled.current.dealer = null;
        settled.current.rows = new WeakMap();
        settled.current.wagers = new WeakMap();
        settled.current.ownerSpacingTried = new WeakSet();
      }
      const offsetNames = ['--bet-offset-x', '--bet-offset-y', '--collect-dx', '--collect-dy'];
      for (const bet of wagers()) {
        const stored = settled.current.wagers.get(bet);
        if (stored)
          offsetNames.forEach((name, index) => bet.style.setProperty(name, stored.offsets[index]));
      }
      const dealerElement = scaler.querySelector<HTMLElement>('.dealer-button');
      if (dealerElement) {
        const owner = `${dealerElement.dataset.ownerX}:${dealerElement.dataset.ownerY}`;
        const cached = settled.current.dealer;
        if (cached?.owner === owner) dealerElement.style.translate = cached.translate;
        else dealerElement.style.removeProperty('translate');
      }
      const rows = Array.from(scaler.querySelectorAll<HTMLElement>('.seat__cards--revealed'));
      rows.forEach((row) => {
        const fixed = settled.current.rows.get(row);
        if (fixed === undefined) row.style.removeProperty('translate');
        else restoreRow(row, fixed);
      });
      // A closed-up spacing belongs to one tabled hand; the same element holds
      // the next hand face down.
      scaler
        .querySelectorAll<HTMLElement>('.seat__cards:not(.seat__cards--revealed)')
        .forEach((cluster) => {
          settled.current.rows.delete(cluster);
          cluster.style.removeProperty('--vh-step-f');
          cluster.style.removeProperty('--vh-card-w');
          delete cluster.dataset.baseStep;
          delete cluster.dataset.baseCardW;
        });
      const scale = tableRenderScale(scaler);
      const pageBox = page.getBoundingClientRect();
      // Production uses the desktop-width viewport on phones. Preserve the
      // legacy <=480px fallback for browsers that ignore that viewport.
      const sixMax = page.getAttribute('data-seats') === '6' && pageBox.width > 480;
      for (const pod of scaler.querySelectorAll('.seat-wrapper--cap, .seat-wrapper--top')) {
        const seat = pod.querySelector<HTMLElement>('.seat');
        // Keep the character connected to its plate with the existing 3px
        // minimum overlap. Reclaim only the extra overlap for the full PLO
        // row, whose bottom reads this same shared token.
        if (sixMax) seat?.style.setProperty('--sp-wrap-overlap', '3px');
        else seat?.style.removeProperty('--sp-wrap-overlap');
      }
      topPods().forEach((pod) => {
        if (sixMax) {
          const avatar = pod.querySelector<HTMLImageElement>('.seat__avatar-img');
          const pose = `${avatar ? avatarRestPose(avatar) : ''}:${window.innerWidth <= 768 && Boolean(pod.querySelector('.seat__cards--revealed'))}`;
          // Folded/resting posture is a layout input. Gesture frames are not.
          if (settled.current.podPoses.get(pod) !== pose) settled.current.pods.delete(pod);
          settled.current.podPoses.set(pod, pose);
        }
        const shift = settled.current.pods.get(pod);
        if (shift === undefined) {
          pod.style.removeProperty('translate');
          pod.style.removeProperty('--sp-top-seat-shift');
        } else {
          pod.style.translate = `0px ${shift}px`;
          pod.style.setProperty('--sp-top-seat-shift', `${shift}px`);
        }
      });
      const chrome = Array.from(page.querySelectorAll('.bbj-widget, .bbj-mini-plate'))
        .map((element) => element.getBoundingClientRect())
        .filter((box) => box.width > 0 && box.height > 0);
      // Every phone table needs the top-seat lane, including tables without
      // a payable Mini BBJ or any jackpot. Keep the declared plate band when
      // chrome is absent; the embedded page already starts below the tab bar.
      const plateHeight =
        parseFloat(getComputedStyle(page).getPropertyValue('--sp-bbj-plate-h')) || 0;
      const chromeBottom = chrome.length
        ? Math.max(...chrome.map((box) => box.bottom))
        : pageBox.top + plateHeight;
      if (sixMax || pageBox.width <= 768) {
        for (const pod of topPods()) {
          if (settled.current.pods.has(pod)) continue;
          const avatar = pod.querySelector<HTMLImageElement>('.seat__avatar-img');
          const image = avatar ? restingAvatarBox(avatar, scale) : null;
          if (image && image.height > 0) {
            // Dan 2026-10-22: "pull the table down so the top player isn't
            // scrunched up." The pod's highest painted part (the art, or the
            // position chip on its corner) keeps 8px of air below the jackpot
            // plate rather than 4px against it.
            const badgeElement = pod.querySelector<HTMLElement>('.seat__position-badge');
            const badge = badgeElement ? restingAvatarBox(badgeElement, scale) : null;
            const highest = Math.min(image.top, badge && badge.height > 0 ? badge.top : Infinity);
            // On the shortest nine-seat phones a board-sized PLO hand needs
            // a full card-height lane between the jackpot and its own plate.
            const largeHand = scaler.querySelector(
              ".seat__cards:is([data-card-count='5'], [data-card-count='6'])"
            );
            const cardHeight =
              ((parseFloat(
                scaler.style.getPropertyValue('--sp-tabled-card-w') ||
                  scaler.style.getPropertyValue('--sp-board-card-w')
              ) || 0) *
                92) /
              64;
            const plateTop =
              pod.querySelector('.seat__info')?.getBoundingClientRect().top ?? highest;
            const clearance =
              largeHand && window.innerHeight > window.innerWidth
                ? Math.max(8, cardHeight + 9 - (plateTop - highest))
                : 8;
            // Dan 2026-10-26: the six-max top-centre villain rises to the
            // tab/action bar, with only the crown clipped. Corner jackpot
            // plates do not reserve a band across this centred seat. Anchor
            // the actual art, not its transparent slot or position badge.
            const anchorTop = sixMax && avatar ? restingAvatarTop(avatar, scale) : highest;
            const naturalTarget = sixMax
              ? pageBox.top - 2 * scale
              : chromeBottom + clearance * scale;
            // A revealed top hand needs its full height above its own plate.
            // Lower the pod as one unit instead of forcing the cards sideways
            // into a neighbour when the compact crown anchor clips that lane.
            const target =
              window.innerWidth <= 768 && pod.querySelector('.seat__cards--revealed')
                ? Math.max(
                    naturalTarget,
                    Math.max(pageBox.top, chromeBottom) +
                      (cardHeight + 9) * scale -
                      (plateTop - anchorTop)
                  )
                : naturalTarget;
            const shift = (target - anchorTop) / scale;
            pod.style.translate = `0px ${shift}px`;
            // Bets use the scaler's rail coordinates. Moving the top avatar
            // within its lane must not carry its bet onto the player plate.
            pod.style.setProperty('--sp-top-seat-shift', `${shift}px`);
            settled.current.pods.set(pod, String(shift));
          }
        }
      }
      if (artwork.space()) {
        // Metadata arrives after initial card placement. Rebase shown rows
        // once against the final opponent position, then retain that slot.
        settled.current.rows = new WeakMap();
        rows.forEach((row) => {
          row.style.removeProperty('translate');
          row.style.removeProperty('--vh-step-f');
          row.style.removeProperty('--vh-card-w');
          delete row.dataset.baseStep;
          delete row.dataset.baseCardW;
        });
      }
      // The helper is recreated on a runout effect revision, while its public
      // image metadata resolves from the shared cache on the next microtask.
      // Keep existing slots until that explicit read completes; substituting
      // raw transparent image squares here would falsely evict those slots.
      // Observers and terminal metadata failures retain the baseline placer.
      if (page.getAttribute('data-hero') === 'true' && artwork.awaitingMetadata()) return;
      const boxSources = new WeakMap<CardBox, Element>();
      const paintedSources = new WeakMap<CardBox, HTMLImageElement>();
      const paintedTests = new WeakMap<CardBox, (target: CardBox, gap?: number) => boolean>();
      const visibleBox = (element: Element): CardBox | null => {
        const box =
          element instanceof HTMLImageElement && element.matches('.seat__avatar-img')
            ? (artwork.paintedBox(element, true) ?? restingAvatarBox(element, scale))
            : element instanceof HTMLElement && element.matches('.seat__position-badge')
              ? restingAvatarBox(element, scale)
              : element.getBoundingClientRect();
        boxSources.set(box, element);
        if (element instanceof HTMLImageElement && element.matches('.seat__avatar-img')) {
          paintedSources.set(box, element);
          paintedTests.set(box, artwork.preparePaintedTouch(element, true));
        }
        return box.width > 0 && box.height > 0 ? box : null;
      };
      const markerTouches = (candidate: CardBox, obstacle: CardBox) => {
        const image = paintedSources.get(obstacle);
        return image
          ? // The prepared paint already contains the complete idle sweep.
            // Keep half a layout pixel of air without adding that breath twice.
            paintedTests.get(obstacle)!(candidate, 0.5)
          : wagerBoxesOverlap(candidate, obstacle);
      };
      // 2026-10-24: every portrait viewport up to 768px, not only phones up to
      // 480. Above 480 the desktop order placed the shown hands AFTER the
      // wagers and the button, and a board-sized PLO5/PLO6 row that could not
      // stand at its owner fell through to the unowned fallback: parked under
      // the hero or in front of another player. Here the hands are placed
      // first, at their own players, and the markers are placed round them.
      const phoneMarkers =
        window.innerWidth <= PORTRAIT_CARD_LANE_MAX_VIEWPORT_PX &&
        window.innerHeight > window.innerWidth;
      if (phoneMarkers) {
        // Dan 2026-10-22: a tabled hand is the SAME SIZE AS THE BOARD's cards,
        // overlapped but never covered. The board is drawn through the felt's
        // perspective. TablePage publishes the settled board width from table geometry.
        // Measuring an animated board card here fed its transient scale back
        // into every shown hand's dimensions during the runout.
        if (!placeRows(false)) return;
        // Selecting a fallback width can itself start the owed reveal-size
        // tween. Reserve marker slots only after that actual geometry settles,
        // including already-cached rows and Hero's visible deal/peek motion.
        if (hasPendingCardMotion(Array.from(scaler.querySelectorAll<HTMLElement>('.seat__cards'))))
          return;
        const canvas = scaler.getBoundingClientRect();
        // The painted chassis is tapered on a portrait phone only (TablePage.css,
        // 480px); a wider portrait felt is drawn flat, and the marker grid must
        // follow the felt actually painted.
        const portraitTaper =
          page.getAttribute('data-hero') === 'false' || window.innerWidth > 480 ? 0 : undefined;
        const size = { w: canvas.width, h: canvas.height, portraitTaper };
        const inset = (chipRadiusWidthPct(size) * canvas.width) / 100 + 3;
        const radius = (FELT_WINDOW.width * canvas.width) / 200 - inset;
        const cx = ((FELT_WINDOW.left + FELT_WINDOW.width / 2) * canvas.width) / 100;
        const upper =
          (FELT_WINDOW.top * canvas.height) / 100 + (FELT_WINDOW.width * canvas.width) / 200;
        const lower =
          ((FELT_WINDOW.top + FELT_WINDOW.height) * canvas.height) / 100 -
          (FELT_WINDOW.width * canvas.width) / 200;
        const points: { x: number; y: number; depth: number }[] = [];
        let depth = 0;
        const add = (x: number, y: number) => {
          const projected = projectPortraitTable(
            {
              x: (x / canvas.width) * 100,
              y: (y / canvas.height) * 100,
            },
            portraitTaper
          );
          points.push({
            x: canvas.left + (projected.x * canvas.width) / 100,
            y: canvas.top + (projected.y * canvas.height) / 100,
            depth,
          });
        };
        /* Dan 2026-10-21: "MAKE SURE WHEN CHIPS ARE PUT IN THE POT THEY ARE
           ACTUALLY ON THE TABLE, AND NOT ON THE RAIL ... THEY NEED TO BE
           FARTHER IN." The bands are CENTRES, and a wager is a disc with its
           amount printed beside it (plus the ALL IN puck when the player is
           all in), so a centre a few pixels inside the felt still printed half
           the stack on the rail. Candidates now walk further in, and one is
           only eligible when the WHOLE wager box is on the painted felt with
           daylight to spare (see `wagerOnFelt`). */
        const feltMarginPx = Math.max(8, canvas.width * 0.025);
        const wagerOnFeltWithMargin = (box: CardBox, margin: number): boolean =>
          [
            [box.left, box.top],
            [box.left + box.width, box.top],
            [box.left, box.top + box.height],
            [box.left + box.width, box.top + box.height],
          ].every(([x, y]) => {
            const flat = unprojectPortraitTable(
              {
                x: ((x - canvas.left) / canvas.width) * 100,
                y: ((y - canvas.top) / canvas.height) * 100,
              },
              portraitTaper
            );
            const px = (flat.x * canvas.width) / 100;
            const py = (flat.y * canvas.height) / 100;
            const spineY = Math.min(Math.max(py, upper), lower);
            return Math.hypot(px - cx, py - spineY) <= radius + inset - margin;
          });
        const wagerOnFelt = (box: CardBox) => wagerOnFeltWithMargin(box, feltMarginPx);
        for (const extra of [0, 10, 20, 28, 36, 44, 52, 64, 76, 88, 100]) {
          depth = extra;
          const band = radius - extra;
          for (let angle = 0; angle < 360; angle += 2) {
            const radians = (angle * Math.PI) / 180;
            add(
              cx + Math.cos(radians) * band,
              (Math.sin(radians) < 0 ? upper : lower) + Math.sin(radians) * band
            );
          }
          for (let y = upper; y <= lower; y += 3) {
            add(cx - band, y);
            add(cx + band, y);
          }
        }
        const obstacles = Array.from(
          page.querySelectorAll(
            '.community-area, .table-brand, .pot-display, .pot-display__pile, .seat__avatar-img, .seat__info, .seat__action, .seat__bounty, .seat__position-badge, .seat__cards--hero .seat__card, .seat__cards--revealed .seat__card, .bbj-widget, .bbj-mini-plate, .chat-collapsed, .mtp-lobby-btn'
          )
        )
          .map(visibleBox)
          .filter((box): box is CardBox => box !== null);
        // The printed table name is the one obstacle a marker may stand on as a
        // last resort: on the smallest phones (320px) the players, the board and
        // the pot leave almost no bare felt, and printing over the felt's own
        // lettering beats stacking two players' chips in one spot.
        const printing = Array.from(page.querySelectorAll('.table-brand'))
          .map(visibleBox)
          .filter((box): box is CardBox => box !== null);
        const hardObstacles = obstacles.filter(
          (box) =>
            !printing.some(
              (mark) =>
                mark.left === box.left &&
                mark.top === box.top &&
                mark.width === box.width &&
                mark.height === box.height
            )
        );

        /* Dan 2026-10-22: "that 50 cents to my left is actually my bet, it's
           sitting in front of the other player." The nearest clear felt spot
           can be nearer a neighbour than its owner when the owner's own front
           is crowded, and then the wager reads as the neighbour's. A wager may
           only stand where its OWN player is the nearest player (avatar
           centres), on every pool but the last-resort one. */
        /* Dan 2026-10-25, with two phone screenshots: "CHIPS ARE STILL
           DISPLAYING IN THE WRONG LOCATIONS INSTEAD OF ALWAYS 100% OF THE TIME
           BEING IN FRONT OF THE USER WHO BET THE CHIPS ... MAKE THE MOBILE
           LAYOUT AND CHIP POSITIONS THE SAME AS DESKTOP AND IPAD." Three
           things let a wager leave its owner here, all closed:
             1. an EMPTY chair counted as nobody, so a raise could settle in an
                empty chair's lane (his screenshot: CactusDenim's raise beside
                the empty seat on the far rail). Every chair counts now;
             2. the search was centred on the owner's AVATAR, so the best spot
                could be anywhere around the player, behind or beside them. It
                is centred on the wager's own rest point now: the desktop's
                spot in front of the player, moved only as far as it must;
             3. the last fallback tiers dropped the ownership rule. Every tier
                keeps it, and a wager with no clear spot of its own stays at
                its rest point in front of its player.
           Pinned by tests/a-bet-sits-in-front-of-its-own-player.law.test.ts. */
        const initialPlayerCentres = Array.from(page.querySelectorAll('.seat-wrapper'))
          .map(
            (wrapper) =>
              wrapper.querySelector('.seat:not(.seat--empty) .seat__avatar-img') ??
              wrapper.querySelector('.seat') ??
              wrapper
          )
          .map((element) => {
            const r =
              element instanceof HTMLImageElement
                ? restingAvatarBox(element, scale)
                : element.getBoundingClientRect();
            return {
              x: r.left + r.width / 2,
              y: r.top + r.height / 2,
              w: r.width,
              // spAvatarBreathe translates 1.5px and grows by .008 about
              // the feet. Reserve both players' complete idle envelope,
              // plus half a layout pixel, without following each frame.
              motion: 1.5 * scale + 0.008 * Math.max(r.width, r.height) + 0.5 * scale,
            };
          })
          .filter((c) => c.w > 0 && Number.isFinite(c.x) && Number.isFinite(c.y));
        // Reserve the dealer's owned slot before chips compete for that lane.
        // Its retained translation is tried first and remains fixed on runout.
        const reservedDealer = placeDealerButton(
          scaler,
          canvas,
          scale,
          points,
          obstacles,
          hardObstacles,
          []
        );
        if (reservedDealer) {
          obstacles.push(reservedDealer);
          hardObstacles.push(reservedDealer);
          if (dealerElement)
            settled.current.dealer = {
              owner: `${dealerElement.dataset.ownerX}:${dealerElement.dataset.ownerY}`,
              translate: dealerElement.style.translate || '',
            };
        }
        const fixedWagers: CardBox[] = [];
        const commitWager = (bet: HTMLElement, next: CardBox, box = visibleBox(bet)) => {
          if (!box) return;
          const dx = (next.left - box.left) / scale;
          const dy = (next.top - box.top) / scale;
          const style = getComputedStyle(bet);
          const number = (name: string) => parseFloat(style.getPropertyValue(name)) || 0;
          const base = {
            x: number('--bet-offset-x'),
            y: number('--bet-offset-y'),
            cx: number('--collect-dx'),
            cy: number('--collect-dy'),
          };
          bet.style.setProperty('--bet-offset-x', `${base.x + dx}px`);
          bet.style.setProperty('--bet-offset-y', `${base.y + dy}px`);
          bet.style.setProperty('--collect-dx', `${base.cx - dx}px`);
          bet.style.setProperty('--collect-dy', `${base.cy - dy}px`);
          if (artwork.ready())
            settled.current.wagers.set(bet, {
              offsets: offsetNames.map((name) => bet.style.getPropertyValue(name)),
              width: box.width,
              height: box.height,
              owner: bet.closest('.seat')?.getAttribute('data-player-id') ?? null,
            });
        };
        const permanentKeepouts = [
          ...(reservedDealer ? [reservedDealer] : []),
          ...Array.from(
            page.querySelectorAll(
              '.community-area,.seat__avatar-img,.seat__info,.seat__action,.seat__bounty,.seat__position-badge,.seat__cards--hero .seat__card,.seat__cards--revealed .seat__card,.pot-display,.pot-display__pile,.bbj-widget,.bbj-mini-plate,.chat-collapsed,.mtp-lobby-btn'
            )
          )
            .map(visibleBox)
            .filter((value): value is CardBox => value !== null),
        ];
        // A retained slot keeps its placement air until actual paint overlaps.
        // Use the same physical test when a partial assignment becomes a keeper.
        const retainedWagerTouches = (candidate: CardBox, other: CardBox) =>
          paintedSources.has(other)
            ? paintedTests.get(other)!(candidate, 0)
            : Math.min(candidate.left + candidate.width, other.left + other.width) -
                Math.max(candidate.left, other.left) >
                0.5 &&
              Math.min(candidate.top + candidate.height, other.top + other.height) -
                Math.max(candidate.top, other.top) >
                0.5;
        const buildEntries = (bets = wagers(), trial = false, retainedBoxes = fixedWagers) => {
          const obstacles = trial
            ? Array.from(
                page.querySelectorAll(
                  '.community-area,.table-brand,.pot-display,.pot-display__pile,.seat__avatar-img,.seat__info,.seat__action,.seat__bounty,.seat__position-badge,.seat__cards--hero .seat__card,.seat__cards--revealed .seat__card,.bbj-widget,.bbj-mini-plate,.chat-collapsed,.mtp-lobby-btn'
                )
              )
                .map(visibleBox)
                .filter((box): box is CardBox => box !== null)
                .concat(retainedBoxes, reservedDealer ? [reservedDealer] : [])
            : permanentKeepouts.concat(printing);
          const hardObstacles = obstacles.filter(
            (box) =>
              !printing.some(
                (mark) =>
                  mark.left === box.left &&
                  mark.top === box.top &&
                  mark.width === box.width &&
                  mark.height === box.height
              )
          );
          const playerCentres = !trial
            ? initialPlayerCentres
            : Array.from(page.querySelectorAll('.seat-wrapper')).map((wrapper) => {
                const image = wrapper.querySelector<HTMLImageElement>('.seat__avatar-img');
                const r = image ? restingAvatarBox(image, scale) : wrapper.getBoundingClientRect();
                return {
                  x: r.left + r.width / 2,
                  y: r.top + r.height / 2,
                  motion: 1.5 * scale + 0.008 * Math.max(r.width, r.height) + 0.5 * scale,
                };
              });
          return bets
            .flatMap((bet) => {
              let box = visibleBox(bet);
              const ownerImage = bet
                .closest('.seat-wrapper')
                ?.querySelector<HTMLImageElement>('.seat__avatar-img');
              const owner = ownerImage ? restingAvatarBox(ownerImage, scale) : null;
              if (!box || !owner) return [];
              const stored = settled.current.wagers.get(bet);
              const ownerMotion =
                1.5 * scale + 0.008 * Math.max(owner.width, owner.height) + 0.5 * scale;
              const ownershipGap = (other: (typeof playerCentres)[number]) =>
                1.5 + ownerMotion + other.motion;
              const currentOwner = {
                x: owner.left + owner.width / 2,
                y: owner.top + owner.height / 2,
              };
              const markerCentre = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
              const ownerDistance = Math.hypot(
                markerCentre.x - currentOwner.x,
                markerCentre.y - currentOwner.y
              );
              const stillOwned = playerCentres.every(
                (other) =>
                  Math.hypot(other.x - currentOwner.x, other.y - currentOwner.y) < 1 ||
                  ownerDistance + ownershipGap(other) <
                    Math.hypot(markerCentre.x - other.x, markerCentre.y - other.y)
              );
              if (
                !trial &&
                stored &&
                stillOwned &&
                stored.owner === bet.closest('.seat')?.getAttribute('data-player-id') &&
                Math.abs(stored.width - box.width) < 0.5 &&
                Math.abs(stored.height - box.height) < 0.5 &&
                !fixedWagers.some((other) => wagerBoxesOverlap(box!, other)) &&
                !permanentKeepouts.some((other) => retainedWagerTouches(box!, other))
              ) {
                fixedWagers.push(box);
                obstacles.push(box);
                hardObstacles.push(box);
                return [];
              }
              // Reallocate invalid slots from the inherited rail anchor rather
              // than compounding the previous retained displacement.
              if (stored && !trial) {
                offsetNames.forEach((name) => bet.style.removeProperty(name));
                settled.current.wagers.delete(bet);
                box = visibleBox(bet);
                if (!box) return [];
              }
              const desired = { x: owner.left + owner.width / 2, y: owner.top + owner.height / 2 };
              // The wager's own rest point, where the seat geometry puts it in
              // front of its player (desktop's spot): the live box less any
              // nudge an earlier pass wrote on the element itself.
              const own = getComputedStyle(bet);
              const inherited = getComputedStyle(bet.parentElement ?? bet);
              const nudge = (axis: 'x' | 'y') =>
                ((parseFloat(own.getPropertyValue(`--bet-offset-${axis}`)) || 0) -
                  (parseFloat(inherited.getPropertyValue(`--bet-offset-${axis}`)) || 0)) *
                scale;
              const anchor = {
                x: box.left + box.width / 2 - nudge('x'),
                y: box.top + box.height / 2 - nudge('y'),
              };
              const hasAllInMarker = Boolean(bet.querySelector('.seat__allin-puck'));
              // A joint recovery first offers each compatible retained slot
              // unchanged, then the nearest clear alternatives around it.
              const retainedAnchor = trial && stored && stillOwned ? markerCentre : null;
              const placed = [
                ...(retainedAnchor ? [{ ...box, depth: 0 }] : []),
                {
                  left: anchor.x - box.width / 2,
                  top: anchor.y - box.height / 2,
                  width: box.width,
                  height: box.height,
                  depth: 0,
                },
                ...points.map((point) => ({
                  left: point.x - box.width / 2,
                  top: point.y - box.height / 2,
                  width: box.width,
                  height: box.height,
                  depth: point.depth,
                })),
              ];
              // Full captions can narrow any short-phone lane, including Holdem.
              // Sample exact obstacle edges as well as the oval, so a clear slot
              // beside a label is found before the overlapping last-resort tier.
              // Wider portrait side pods need the same exact slots.
              if (
                sixMax ||
                artwork.ready() ||
                window.innerWidth > 480 ||
                window.innerWidth <= 375
              ) {
                const minLeft = window.innerWidth > 480 ? canvas.left : pageBox.left;
                const maxRight = window.innerWidth > 480 ? canvas.right : pageBox.right;
                const xs = new Set([anchor.x - box.width / 2, minLeft, maxRight - box.width]);
                const ys = new Set([
                  anchor.y - box.height / 2,
                  pageBox.top,
                  canvas.bottom - box.height,
                ]);
                for (const obstacle of hardObstacles) {
                  for (const air of sixMax
                    ? [3, 1]
                    : page.getAttribute('data-seats') === '9' && window.innerWidth <= 480
                      ? [3, 2]
                      : [3]) {
                    xs.add(obstacle.left - box.width - air);
                    xs.add(obstacle.left + obstacle.width + air);
                    ys.add(obstacle.top - box.height - air);
                    ys.add(obstacle.top + obstacle.height + air);
                  }
                }
                // A wider portrait page has bare screen beyond the table; a wager
                // stays on the table's own canvas there, never out in the margin.
                for (const left of xs)
                  for (const top of ys) {
                    const candidate = {
                      left,
                      top,
                      width: box.width,
                      height: box.height,
                      depth: 20,
                    };
                    if (
                      left >= minLeft &&
                      // Jackpot and chat rectangles protect their actual areas;
                      // they do not reserve a full-width invisible top band.
                      top >= pageBox.top &&
                      left + box.width <= maxRight &&
                      top + box.height <= canvas.bottom
                    )
                      placed.push(candidate);
                  }
              }
              // ALL IN is a felt marker, never a label in the avatar lane. Even
              // crowded-table fallbacks must keep its entire wager slot on felt.
              // A marker's entire disc stays on felt. On a crowded cap lane,
              // one pixel of edge clearance fits where the chips' eight-pixel
              // decoration margin does not; never fall back off felt or to a neighbour.
              const eligible = hasAllInMarker
                ? placed.filter((candidate) => wagerOnFeltWithMargin(candidate, 1))
                : placed;
              const clearOfTable = eligible.filter(
                (candidate) => !obstacles.some((obstacle) => markerTouches(candidate, obstacle))
              );
              // Wholly on the felt whenever every wager fits there together. On a
              // small, crowded phone they may not, and then the nearest spots that
              // still clear every player, the board, the pot and each other are
              // used, rail band included, rather than leaving a wager on a player.
              // Nearest the wager's own rest point: it moves as little as it can.
              const costAnchor = retainedAnchor ?? anchor;
              const byCost = (a: (typeof clearOfTable)[number], b: (typeof clearOfTable)[number]) =>
                Math.hypot(
                  a.left + a.width / 2 - costAnchor.x,
                  a.top + a.height / 2 - costAnchor.y
                ) -
                Math.hypot(
                  b.left + b.width / 2 - costAnchor.x,
                  b.top + b.height / 2 - costAnchor.y
                );
              const distinct = (list: typeof clearOfTable, cap: number): CardBox[] => {
                const kept: CardBox[] = [];
                for (const candidate of list) {
                  if (
                    kept.every(
                      (other) =>
                        Math.hypot(candidate.left - other.left, candidate.top - other.top) >= 4
                    )
                  )
                    kept.push(candidate);
                  if (kept.length >= cap) break;
                }
                return kept;
              };
              const ownedBy = (candidate: (typeof clearOfTable)[number]): boolean => {
                const cx0 = candidate.left + candidate.width / 2;
                const cy0 = candidate.top + candidate.height / 2;
                const own = Math.hypot(cx0 - desired.x, cy0 - desired.y);
                return playerCentres.every(
                  (other) =>
                    Math.hypot(other.x - desired.x, other.y - desired.y) < 1 ||
                    own + ownershipGap(other) < Math.hypot(cx0 - other.x, cy0 - other.y)
                );
              };
              if (page.getAttribute('data-seats') === '9' && window.innerWidth <= 480) {
                const covered = (candidate: CardBox) =>
                  hardObstacles.reduce(
                    (sum, other) =>
                      sum +
                      Math.max(
                        0,
                        Math.min(candidate.left + candidate.width, other.left + other.width) -
                          Math.max(candidate.left, other.left)
                      ) *
                        Math.max(
                          0,
                          Math.min(candidate.top + candidate.height, other.top + other.height) -
                            Math.max(candidate.top, other.top)
                        ),
                    0
                  );
                const closest = eligible
                  .filter(ownedBy)
                  .map((candidate) => ({ candidate, covered: covered(candidate) }))
                  .sort((a, b) => a.covered - b.covered || byCost(a.candidate, b.candidate))
                  .slice(0, 8);
                for (const { candidate } of closest)
                  for (const distance of [0.5, 1, 1.5, 2])
                    for (const [dx, dy] of [
                      [-distance, 0],
                      [distance, 0],
                      [0, -distance],
                      [0, distance],
                    ]) {
                      const next = {
                        ...candidate,
                        left: candidate.left + dx,
                        top: candidate.top + dy,
                      };
                      if (
                        next.left < pageBox.left ||
                        next.left + next.width > pageBox.right ||
                        next.top < pageBox.top ||
                        next.top + next.height > canvas.bottom ||
                        (hasAllInMarker && !wagerOnFeltWithMargin(next, 1)) ||
                        !ownedBy(next)
                      )
                        continue;
                      if (!obstacles.some((obstacle) => markerTouches(next, obstacle)))
                        clearOfTable.push(next);
                    }
              }
              const nearest = [...clearOfTable].sort(byCost);
              const owned = nearest.filter(ownedBy);
              const overPrinting = eligible
                .filter(
                  (candidate) =>
                    !hardObstacles.some((obstacle) => markerTouches(candidate, obstacle))
                )
                .sort(byCost)
                .filter(ownedBy);
              return [
                {
                  bet,
                  box,
                  hasAllInMarker,
                  laneCandidates: eligible,
                  clearCandidates: distinct(nearest, 160),
                  felt: distinct(owned.filter(wagerOnFelt), 96),
                  // Exactly the rail-band slots this placer has always offered.
                  candidates: distinct(
                    owned.filter((candidate) => candidate.depth <= 20),
                    96
                  ),
                  wide: distinct(owned, 160),
                  any: distinct(nearest.filter(ownedBy), 160),
                  printing: distinct(overPrinting, 160),
                  // Last resort on the smallest felts: this player's own spots, the
                  // least covered first, so two players' wagers never share one.
                  least: distinct(
                    eligible
                      .filter(ownedBy)
                      .map((candidate) => ({
                        candidate,
                        covered: hardObstacles.reduce(
                          (sum, o) =>
                            sum +
                            Math.max(
                              0,
                              Math.min(candidate.left + candidate.width, o.left + o.width) -
                                Math.max(candidate.left, o.left)
                            ) *
                              Math.max(
                                0,
                                Math.min(candidate.top + candidate.height, o.top + o.height) -
                                  Math.max(candidate.top, o.top)
                              ),
                          0
                        ),
                      }))
                      .sort((a, b) => a.covered - b.covered || byCost(a.candidate, b.candidate))
                      .map((entry) => entry.candidate),
                    160
                  ),
                },
              ];
            })
            .sort((a, b) => Number(b.hasAllInMarker) - Number(a.hasAllInMarker));
        };
        const compactNine =
          page.getAttribute('data-seats') === '9' &&
          window.innerWidth <= 340 &&
          Boolean(
            page.querySelector('.seat__cards--opponent.seat__cards--revealed > :nth-child(5)')
          );
        // Tiny differences at one contact must not consume the entire finite
        // search. Cover the derived endpoint geometry, then try the chosen
        // proposals in minimum-motion order. All three budgets stay fixed.
        const diverse = <T>(values: T[], limit: number, distance: (a: T, b: T) => number): T[] => {
          if (!compactNine || values.length <= limit) return values.slice(0, limit);
          const chosen: T[] = [];
          const selected = new Set<number>();
          const nearest = values.map(() => Infinity);
          let next = 0;
          while (chosen.length < limit && selected.size < values.length) {
            const item = values[next];
            chosen.push(item);
            selected.add(next);
            let furthest = -Infinity;
            for (let i = 0; i < values.length; i++) {
              if (selected.has(i)) continue;
              nearest[i] = Math.min(nearest[i], distance(values[i], item));
              if (nearest[i] > furthest) {
                furthest = nearest[i];
                next = i;
              }
            }
          }
          return chosen;
        };
        const showdownRows = Array.from(
          scaler.querySelectorAll('.seat__cards--opponent.seat__cards--revealed')
        );
        const compactFullShowdown =
          compactNine &&
          !scaler.querySelector('.seat__allin-puck') &&
          showdownRows.length > 0 &&
          showdownRows.every((row) => row.querySelectorAll('.seat__card').length === 5);
        const compactFacts =
          compactNine &&
          (Boolean(scaler.querySelector('.seat__allin-puck')) || compactFullShowdown);
        const opponentRowPose = () =>
          Array.from(scaler.querySelectorAll<HTMLElement>('.seat:not(.seat--hero)'))
            .map((seat) =>
              [
                seat.style.getPropertyValue('--sp-opponent-x'),
                seat.style.getPropertyValue('--sp-opponent-y'),
                seat.querySelector<HTMLElement>(':scope > .seat__info')?.style.translate ?? '',
                seat.querySelector<HTMLElement>(':scope > .seat__action')?.style.translate ?? '',
              ].join(':')
            )
            .join('|');
        const entries = buildEntries();
        // A later DOM sibling may already own a retained slot. Reserve the
        // complete retained set before assigning any newly generated pools;
        // otherwise an earlier new wager could take that later player's slot.
        for (const entry of entries)
          for (const pool of ['felt', 'candidates', 'wide', 'any', 'printing', 'least'] as const)
            entry[pool] = entry[pool].filter((candidate) =>
              fixedWagers.every((fixed) => !wagerBoxesOverlap(candidate, fixed))
            );
        // Enlarging a character can move its visual centre above the curved
        // felt's ownership lane. With no clear owned slot, adjust only the
        // opponent spacing by the nearest vertical contact or viewport pixel that restores
        // one. Persistent all-in markers stay wholly on felt; ordinary chips
        // retain their existing rail/page lanes. This is one finite transaction,
        // not an animation-following or event-driven repair pass.
        if (remainingOwnerSpacingPasses > 0 && artwork.ready()) {
          const beforeRowPose = opponentRowPose();
          let movedOwner = false;
          const movedSeats = new Set<HTMLElement>();
          const origins =
            spacingOrigins ??
            new Map(
              Array.from(scaler.querySelectorAll<HTMLElement>('.seat:not(.seat--hero)')).map(
                (seat) => {
                  const parts = Array.from(
                    seat.querySelectorAll(
                      '.seat__avatar-img,:scope > .seat__info,:scope > .seat__action,:scope > .seat__bounty,.seat__position-badge'
                    )
                  )
                    .map(visibleBox)
                    .filter((r): r is CardBox => r !== null);
                  return [
                    seat,
                    {
                      y: (parseFloat(seat.style.getPropertyValue('--sp-opponent-y')) || 0) * scale,
                      radius: parts.length
                        ? (Math.max(...parts.map((p) => p.top + p.height)) -
                            Math.min(...parts.map((p) => p.top))) /
                          2
                        : 0,
                    },
                  ] as const;
                }
              )
            );
          const blocked = entries.filter(
            (entry) =>
              !entry.wide.length &&
              !entry.printing.length &&
              !settled.current.ownerSpacingTried.has(entry.bet)
          );
          // Each successful movement triggers a fresh bounded placement pass,
          // so a newly constrained neighbour is not judged from stale pools.
          // Failed owners may retry after that change; successful wagers cannot.
          let factJointProofs = 0;
          for (const entry of blocked) {
            const seat = entry.bet.closest<HTMLElement>('.seat:not(.seat--hero)');
            const image = seat?.querySelector<HTMLImageElement>('.seat__avatar-img');
            if (!seat || !image || movedSeats.has(seat)) continue;
            let factProbe: HTMLElement | null = null;
            let factWagers: Array<{ bet: HTMLElement; next: CardBox }> = [];
            let rivalProposals: Array<{ seat: HTMLElement; shift: number }> = [];
            const acceptsLane = () => {
              // The local limit is cumulative across this whole transaction,
              // including peers moved by a chain from another owner.
              if (
                [...origins].some(
                  ([owner, origin]) =>
                    Math.abs(
                      (parseFloat(owner.style.getPropertyValue('--sp-opponent-y')) || 0) * scale -
                        origin.y
                    ) > origin.radius
                )
              )
                return false;
              const mine = restingAvatarBox(image, scale);
              const centre = { x: mine.left + mine.width / 2, y: mine.top + mine.height / 2 };
              const motion = 1.5 * scale + 0.008 * Math.max(mine.width, mine.height) + 0.5 * scale;
              const others = Array.from(page.querySelectorAll('.seat-wrapper')).map((wrapper) => {
                const art = wrapper.querySelector<HTMLImageElement>('.seat__avatar-img');
                const r = art ? restingAvatarBox(art, scale) : wrapper.getBoundingClientRect();
                return {
                  same: art === image,
                  seat: art?.closest<HTMLElement>('.seat') ?? null,
                  x: r.left + r.width / 2,
                  y: r.top + r.height / 2,
                  motion: 1.5 * scale + 0.008 * Math.max(r.width, r.height) + 0.5 * scale,
                };
              });
              const keepouts = Array.from(
                page.querySelectorAll(
                  '.community-area,.seat__avatar-img,.seat__info,.seat__action,.seat__bounty,.seat__position-badge,.seat__cards--hero .seat__card,.seat__cards--revealed .seat__card,.pot-display,.pot-display__pile,.bbj-widget,.bbj-mini-plate,.chat-collapsed'
                )
              )
                .map(visibleBox)
                .filter((r): r is CardBox => r !== null);
              const laneCandidates = factProbe ? [...entry.laneCandidates] : entry.laneCandidates;
              if (factProbe) {
                // A raised caption and its owner's shown hand have new exact
                // edges. Include those contacts before proving the owned lane.
                const xs = new Set(entry.laneCandidates.map((candidate) => candidate.left));
                const ys = new Set<number>();
                for (const obstacle of keepouts) {
                  const element = boxSources.get(obstacle);
                  if (
                    element &&
                    ((factProbe.contains(element) &&
                      element.matches('.seat__info,.seat__action')) ||
                      (seat.contains(element) && element.matches('.seat__card')))
                  ) {
                    ys.add(obstacle.top - entry.box.height - 2);
                    ys.add(obstacle.top + obstacle.height + 2);
                  }
                }
                for (const left of xs)
                  for (const top of ys) laneCandidates.push({ ...entry.box, left, top, depth: 20 });
              }
              const clearLane = laneCandidates.some((candidate) => {
                const point = {
                  x: candidate.left + candidate.width / 2,
                  y: candidate.top + candidate.height / 2,
                };
                const ownDistance = Math.hypot(point.x - centre.x, point.y - centre.y);
                if (factProbe) {
                  if (
                    !wagerOnFeltWithMargin(candidate, 1) ||
                    [
                      ...keepouts,
                      ...(compactFullShowdown ? [] : fixedWagers),
                      ...(reservedDealer ? [reservedDealer] : []),
                    ].some((other) => markerTouches(candidate, other))
                  )
                    return false;
                  const blocked = others.filter(
                    (other) =>
                      !other.same &&
                      ownDistance + 1.5 + motion + other.motion >=
                        Math.hypot(point.x - other.x, point.y - other.y)
                  );
                  if (!blocked.length) return true;
                  // A felt pocket can need its one nearest neighbour to vacate
                  // in the same finite caption/body transaction.
                  if (blocked.length === 1) {
                    const rival = blocked[0];
                    const origin = rival.seat && origins.get(rival.seat);
                    if (rival.seat && origin) {
                      const required = ownDistance + 1.5 + motion + rival.motion;
                      const square = required * required - (point.x - rival.x) ** 2;
                      if (square > 0)
                        for (const direction of [-1, 1]) {
                          const shift = point.y + direction * (Math.sqrt(square) + 0.001) - rival.y;
                          if (Math.abs(shift) <= origin.radius && Math.abs(shift) > 0.0001)
                            rivalProposals.push({ seat: rival.seat, shift });
                        }
                    }
                  }
                  return false;
                }
                return (
                  (entry.hasAllInMarker
                    ? wagerOnFeltWithMargin(candidate, 1)
                    : candidate.left >= (window.innerWidth > 480 ? canvas.left : pageBox.left) &&
                      candidate.left + candidate.width <=
                        (window.innerWidth > 480 ? canvas.right : pageBox.right) &&
                      candidate.top >= pageBox.top &&
                      candidate.top + candidate.height <= canvas.bottom) &&
                  others.every(
                    (other) =>
                      other.same ||
                      ownDistance + 1.5 + motion + other.motion <
                        Math.hypot(point.x - other.x, point.y - other.y)
                  ) &&
                  [...keepouts, ...fixedWagers, ...(reservedDealer ? [reservedDealer] : [])].every(
                    (other) =>
                      !(factProbe
                        ? markerTouches(candidate, other)
                        : wagerBoxesOverlap(candidate, other))
                  )
                );
              });
              if (!clearLane || !factProbe || !compactFullShowdown) return clearLane;
              // A valid provisional chip can occupy the only wager pocket.
              // Release that reservation only inside a joint proof which keeps
              // every already resolved wager and adds this previously blocked
              // wager. The ordinary pools offer their current slot first.
              factWagers = [];
              if (factJointProofs >= 8) return false;
              factJointProofs++;
              const fresh = buildEntries(wagers(), true, []);
              const resolved = new Set(wagers().filter((bet) => settled.current.wagers.has(bet)));
              resolved.add(entry.bet);
              if ([...resolved].some((bet) => !fresh.some((proposal) => proposal.bet === bet)))
                return false;
              const solve = (proposals: typeof fresh) => {
                const assignment =
                  assignProtectedWagers(proposals.map((proposal) => proposal.wide)) ??
                  cleanGreedyWagers(proposals.map((proposal) => proposal.wide)) ??
                  assignProtectedWagers(proposals.map((proposal) => proposal.printing)) ??
                  cleanGreedyWagers(proposals.map((proposal) => proposal.printing));
                if (!assignment) return false;
                factWagers = proposals.map((proposal, index) => ({
                  bet: proposal.bet,
                  next: assignment[index],
                }));
                return true;
              };
              return solve(fresh) || solve(fresh.filter((proposal) => resolved.has(proposal.bet)));
            };
            const shifts = new Set<number>();
            for (let distance = 1; distance <= Math.ceil(pageBox.height); distance++) {
              shifts.add(-distance);
              shifts.add(distance);
            }
            const ownParts = Array.from(
              seat.querySelectorAll(
                '.seat__avatar-img,:scope > .seat__info,:scope > .seat__action,:scope > .seat__bounty,.seat__position-badge'
              )
            )
              .map(visibleBox)
              .filter((r): r is CardBox => r !== null);
            const localRadius = ownParts.length
              ? (Math.max(...ownParts.map((part) => part.top + part.height)) -
                  Math.min(...ownParts.map((part) => part.top))) /
                2
              : 0;
            const contacts = Array.from(
              page.querySelectorAll(
                '.community-area,.bbj-widget,.bbj-mini-plate,.chat-collapsed,.seat__avatar-img,.seat__info,.seat__action,.seat__bounty,.seat__position-badge,.seat--hero .seat__cards .seat__card'
              )
            )
              .filter((element) => !seat.contains(element))
              .map(visibleBox)
              .filter((r): r is CardBox => r !== null);
            // A curved lane can end between whole pixels. Include actual
            // contact edges, retaining a thousandth pixel of positive air,
            // rather than discarding that physically available interval.
            for (const part of ownParts) {
              shifts.add(pageBox.top - part.top + 0.001);
              shifts.add(pageBox.bottom - part.top - part.height - 0.001);
              for (const other of contacts) {
                if (part.left >= other.left + other.width || part.left + part.width <= other.left)
                  continue;
                shifts.add(other.top - part.top - part.height - 0.001);
                shifts.add(other.top + other.height - part.top + 0.001);
              }
            }
            // A spacing correction stays within half this pod's height.
            // If a neighbour must move first, defer to the next bounded
            // dependent pass rather than moving a player across the table.
            const orderedShifts = [...shifts]
              .filter((value) => Math.abs(value) <= localRadius)
              .sort((a, b) => Math.abs(a) - Math.abs(b) || a - b);
            const acceptsLaneWithPeer = () => {
              rivalProposals = [];
              if (acceptsLane()) return true;
              if (!factProbe) return false;
              const unique = new Map<HTMLElement, Map<number, number>>();
              for (const proposal of rivalProposals) {
                const shifts = unique.get(proposal.seat) ?? new Map<number, number>();
                const key = Math.round(proposal.shift * 64);
                const old = shifts.get(key);
                if (old === undefined || Math.abs(proposal.shift) < Math.abs(old))
                  shifts.set(key, proposal.shift);
                unique.set(proposal.seat, shifts);
              }
              const proposals = [...unique]
                .flatMap(([seat, values]) => [...values.values()].map((shift) => ({ seat, shift })))
                .sort((a, b) => Math.abs(a.shift) - Math.abs(b.shift));
              return diverse(proposals, 16, (a, b) =>
                a.seat === b.seat ? Math.abs(a.shift - b.shift) : Infinity
              )
                .sort((a, b) => Math.abs(a.shift) - Math.abs(b.shift))
                .some((proposal) =>
                  artwork.tryShiftOwnerForWager(proposal.seat, proposal.shift, acceptsLane)
                );
            };
            const trySpacing = () => {
              if (factProbe && acceptsLaneWithPeer()) return true;
              const trials = factProbe
                ? diverse(orderedShifts, 32, (a, b) => Math.abs(a - b)).sort(
                    (a, b) => Math.abs(a) - Math.abs(b) || a - b
                  )
                : orderedShifts;
              return trials.some(
                (shift) =>
                  Math.abs(shift) > 0.0001 &&
                  artwork.tryShiftOwnerForWager(seat, shift, acceptsLaneWithPeer)
              );
            };
            let opened = trySpacing();
            if (!opened && compactFacts && (entry.hasAllInMarker || compactFullShowdown)) {
              const mine = restingAvatarBox(image, scale);
              const cx = mine.left + mine.width / 2,
                cy = mine.top + mine.height / 2;
              const motion = 1.5 * scale + 0.008 * Math.max(mine.width, mine.height) + 0.5 * scale;
              const possibleOwner = (candidate: CardBox) => {
                const x = candidate.left + candidate.width / 2,
                  y = candidate.top + candidate.height / 2;
                const closest = Math.hypot(x - cx, Math.max(0, Math.abs(y - cy) - localRadius));
                if (!compactFullShowdown)
                  return initialPlayerCentres.every(
                    (other) =>
                      Math.hypot(other.x - cx, other.y - cy) < 1 ||
                      closest + 1.5 + motion + other.motion < Math.hypot(x - other.x, y - other.y)
                  );
                const blockers = initialPlayerCentres.filter(
                  (other) =>
                    Math.hypot(other.x - cx, other.y - cy) >= 1 &&
                    closest + 1.5 + motion + other.motion >= Math.hypot(x - other.x, y - other.y)
                );
                if (!blockers.length) return true;
                if (blockers.length !== 1) return false;
                // The actual lane proof can move one rival. Its prefilter must
                // admit that same finite family, while keeping the rival inside
                // its original half-pod motion bounds.
                const other = blockers[0];
                return [...origins].some(([rival, origin]) => {
                  const art = rival.querySelector<HTMLImageElement>('.seat__avatar-img');
                  if (!art) return false;
                  const rect = restingAvatarBox(art, scale);
                  const rx = rect.left + rect.width / 2,
                    ry = rect.top + rect.height / 2;
                  if (Math.hypot(rx - other.x, ry - other.y) >= 1) return false;
                  const current =
                    (parseFloat(rival.style.getPropertyValue('--sp-opponent-y')) || 0) * scale;
                  const up = origin.y - origin.radius - current;
                  const down = origin.y + origin.radius - current;
                  const furthest = Math.max(
                    Math.hypot(x - rx, y - ry - up),
                    Math.hypot(x - rx, y - ry - down)
                  );
                  return closest + 1.5 + motion + other.motion < furthest;
                });
              };
              const facts = Array.from(
                scaler.querySelectorAll<HTMLElement>('.seat:not(.seat--hero):not(.seat--empty)')
              ).flatMap((factSeat) => {
                const bounds = artwork.captionRaiseBounds(factSeat);
                if (!bounds || bounds.maxRaise <= 0.001) return [];
                const contacts = entry.laneCandidates
                  .filter(
                    (candidate) =>
                      possibleOwner(candidate) && wagerBoxesOverlap(candidate, bounds.info)
                  )
                  .map((candidate) => ({
                    target: candidate.top,
                    raise: bounds.info.top + bounds.info.height + 2 - candidate.top,
                  }))
                  .filter(({ raise }) => raise > 0 && raise <= bounds.maxRaise)
                  .sort((a, b) => a.raise - b.raise);
                if (!contacts.length) return [];
                const lowerThird = bounds.minTop + bounds.info.height + 2 + 0.001;
                return [
                  { seat: factSeat, targets: [...new Set([contacts[0].target, lowerThird])] },
                ];
              });
              // Only a physically blocking caption is tried, at its nearest
              // exact contact and its existing character's lower-bust endpoint.
              // The nested callback proves the actual body and felt-marker lane
              // before either same-size caption is retained.
              for (const fact of facts) {
                for (const target of fact.targets) {
                  factProbe = fact.seat;
                  factWagers = [];
                  opened = artwork.tryRaiseCaptionForWager(fact.seat, target, trySpacing);
                  factProbe = null;
                  if (opened) break;
                }
                if (opened) break;
              }
            }
            if (opened) {
              factWagers.forEach(({ bet, next }) => commitWager(bet, next));
              movedOwner = true;
              movedSeats.add(seat);
              settled.current.ownerSpacingTried.add(entry.bet);
            }
          }
          if (movedOwner) {
            // Rebase shown hands once against the final pod positions. Existing
            // wager slots remain retained and undergo their normal validity check.
            // A joint proof can only reassign markers, with zero body or
            // caption movement. That does not invalidate a tabled hand's slot.
            if (!compactFacts || opponentRowPose() !== beforeRowPose) {
              settled.current.rows = new WeakMap();
              rows.forEach((row) => {
                row.style.removeProperty('translate');
                row.style.removeProperty('--vh-step-f');
                row.style.removeProperty('--vh-card-w');
                delete row.dataset.baseStep;
                delete row.dataset.baseCardW;
              });
            }
            place(remainingOwnerSpacingPasses - 1, origins);
            return;
          }
        }
        // Every wager on the felt at once when the table allows it. A crowded
        // short phone (three players all in on one side) can leave no joint
        // solution; then each wager still takes its own best clear spot in
        // turn, instead of every wager staying wherever it first landed.
        const placements =
          assignProtectedWagers(entries.map((entry) => entry.felt)) ??
          assignProtectedWagers(entries.map((entry) => entry.candidates)) ??
          assignProtectedWagers(entries.map((entry) => entry.wide)) ??
          // The exact search has a fixed budget; a crowded ring can exhaust it
          // while each player's own spots still fit side by side greedily.
          cleanGreedyWagers(entries.map((entry) => entry.wide)) ??
          assignProtectedWagers(
            entries.map((entry) => (compactNine ? entry.printing : entry.any))
          ) ??
          // The smallest felts: over the felt's own lettering before two
          // players' wagers are stacked in one spot.
          assignProtectedWagers(entries.map((entry) => entry.printing)) ??
          greedyProtectedWagers(
            entries.map((entry) => [
              ...entry.wide,
              ...(compactNine ? entry.printing : entry.any),
              ...entry.least,
            ])
          );
        // An individually clear lane can still be consumed by another wager.
        // On compact rings prove the whole assignment against fresh geometry
        // before committing the smallest local owner/rival spacing transaction.
        if (
          remainingOwnerSpacingPasses > 0 &&
          artwork.ready() &&
          page.getAttribute('data-seats') === '9' &&
          window.innerWidth <= 480 &&
          entries.some(
            (entry, index) =>
              !placements?.[index] ||
              (compactNine ? hardObstacles : obstacles).some((obstacle) =>
                markerTouches(placements[index]!, obstacle)
              )
          )
        ) {
          const beforeRowPose = opponentRowPose();
          const origins =
            spacingOrigins ??
            new Map(
              Array.from(scaler.querySelectorAll<HTMLElement>('.seat:not(.seat--hero)')).map(
                (seat) => {
                  const parts = Array.from(
                    seat.querySelectorAll(
                      '.seat__avatar-img,.seat__info,.seat__action,.seat__bounty,.seat__position-badge'
                    )
                  )
                    .map(visibleBox)
                    .filter((r): r is CardBox => r !== null);
                  return [
                    seat,
                    {
                      y: (parseFloat(seat.style.getPropertyValue('--sp-opponent-y')) || 0) * scale,
                      radius: parts.length
                        ? (Math.max(...parts.map((p) => p.top + p.height)) -
                            Math.min(...parts.map((p) => p.top))) /
                          2
                        : 0,
                    },
                  ] as const;
                }
              )
            );
          const withinBudget = () =>
            [...origins].every(
              ([seat, origin]) =>
                Math.abs(
                  (parseFloat(seat.style.getPropertyValue('--sp-opponent-y')) || 0) * scale -
                    origin.y
                ) <= origin.radius
            );
          const bets = entries.map((entry) => entry.bet);
          const affected = entries.filter(
            (entry, index) =>
              !placements?.[index] ||
              (compactNine ? hardObstacles : obstacles).some((obstacle) =>
                markerTouches(placements[index]!, obstacle)
              )
          );
          const retained = wagers().filter((bet) => !bets.includes(bet));
          const retainedKeepers = () => {
            if (!retained.length) return [];
            const fixed = Array.from(
              page.querySelectorAll(
                '.community-area,.table-brand,.seat__info,.seat__action,.seat__bounty,.seat__position-badge,.seat__cards--hero .seat__card,.seat__cards--revealed .seat__card,.pot-display,.pot-display__pile,.bbj-widget,.bbj-mini-plate,.chat-collapsed,.mtp-lobby-btn'
              )
            )
              .filter((element) => !compactNine || !element.matches('.table-brand'))
              .map(visibleBox)
              .filter((r): r is CardBox => r !== null)
              .concat(reservedDealer ? [reservedDealer] : []);
            const avatars = Array.from(
              page.querySelectorAll<HTMLImageElement>('.seat__avatar-img')
            ).map((image) => {
              const rect = restingAvatarBox(image, scale);
              return {
                image,
                rect,
                motion: 1.5 * scale + 0.008 * Math.max(rect.width, rect.height) + 0.5 * scale,
                touches: artwork.preparePaintedTouch(image, true),
              };
            });
            return retained.filter((bet) => {
              const box = visibleBox(bet),
                image = bet
                  .closest('.seat-wrapper')
                  ?.querySelector<HTMLImageElement>('.seat__avatar-img');
              if (
                !box ||
                !image ||
                fixed.some(
                  (other) =>
                    Math.min(box.left + box.width, other.left + other.width) -
                      Math.max(box.left, other.left) >
                      0.5 &&
                    Math.min(box.top + box.height, other.top + other.height) -
                      Math.max(box.top, other.top) >
                      0.5
                )
              )
                return false;
              const own = restingAvatarBox(image, scale),
                x = box.left + box.width / 2,
                y = box.top + box.height / 2;
              const distance = Math.hypot(
                x - own.left - own.width / 2,
                y - own.top - own.height / 2
              );
              const motion = 1.5 * scale + 0.008 * Math.max(own.width, own.height) + 0.5 * scale;
              return avatars.every(
                ({ image: other, rect: r, motion: otherMotion, touches }) =>
                  (other === image ||
                    distance + 1.5 + motion + otherMotion <
                      Math.hypot(x - r.left - r.width / 2, y - r.top - r.height / 2)) &&
                  !touches(box, 0)
              );
            });
          };
          let completedWagers: Array<{ bet: HTMLElement; next: CardBox }> = [];
          const complete = () => {
            completedWagers = [];
            if (!withinBudget()) return false;
            // A local peer cascade may invalidate a previously cached wager's
            // ownership. Retain every compatible fixed slot and prove the whole
            // affected set together before committing any opponent movement.
            const keepers = retainedKeepers();
            const fixed = keepers.map(visibleBox).filter((r): r is CardBox => r !== null);
            const solve = (fresh: ReturnType<typeof buildEntries>) => {
              const assignment =
                assignProtectedWagers(fresh.map((entry) => entry.wide)) ??
                cleanGreedyWagers(fresh.map((entry) => entry.wide)) ??
                (compactNine
                  ? (assignProtectedWagers(fresh.map((entry) => entry.printing)) ??
                    cleanGreedyWagers(fresh.map((entry) => entry.printing)))
                  : null);
              if (!assignment) return false;
              completedWagers = fresh.map((entry, index) => ({
                bet: entry.bet,
                next: assignment[index],
              }));
              return true;
            };
            return (
              solve(
                buildEntries(
                  wagers().filter((bet) => !keepers.includes(bet)),
                  true,
                  fixed
                )
              ) ||
              // Individually valid cached slots can still consume the only joint
              // assignment. This finite fallback keeps their current positions
              // first in each pool and commits only a complete owned solution.
              solve(buildEntries(wagers(), true, []))
            );
          };
          const plans: {
            owner: HTMLElement;
            ownerShift: number;
            rival: HTMLElement | null;
            rivalShift: number;
            cost: number;
          }[] = [];
          const motionCost = () =>
            [...origins].reduce(
              (sum, [seat, origin]) =>
                sum +
                Math.pow(
                  (parseFloat(seat.style.getPropertyValue('--sp-opponent-y')) || 0) * scale -
                    origin.y,
                  2
                ),
              0
            );
          let moved = false;
          for (const entry of affected) {
            const owner = entry.bet.closest<HTMLElement>('.seat:not(.seat--hero)');
            const image = owner?.querySelector<HTMLImageElement>('.seat__avatar-img');
            const origin = owner && origins.get(owner);
            if (!owner || !image || !origin) continue;
            const initial = entry;
            const own = restingAvatarBox(image, scale),
              ownX = own.left + own.width / 2,
              ownY = own.top + own.height / 2;
            const motion = 1.5 * scale + 0.008 * Math.max(own.width, own.height) + 0.5 * scale;
            const centres = () =>
              Array.from(page.querySelectorAll<HTMLImageElement>('.seat__avatar-img'))
                .filter((art) => art !== image)
                .map((art) => {
                  const r = restingAvatarBox(art, scale);
                  return {
                    seat: art.closest<HTMLElement>('.seat'),
                    x: r.left + r.width / 2,
                    y: r.top + r.height / 2,
                    motion: 1.5 * scale + 0.008 * Math.max(r.width, r.height) + 0.5 * scale,
                  };
                });
            const rivals = centres();
            const shifts = new Map<number, number>();
            const addShift = (value: number) => {
              if (Math.abs(value) > origin.radius) return;
              const key = Math.round(value * 64),
                old = shifts.get(key);
              if (old === undefined || Math.abs(value) < Math.abs(old)) shifts.set(key, value);
            };
            addShift(0);
            // Intersect exact ownership Y intervals, leaving only one movable
            // rival for the atomic child trial. Adjacent CSS pixels sample the
            // interval's interior without a whole-viewport pixel search.
            // A paired move may open a currently occupied rival lane. Derive
            // ownership endpoints from that same eligible grid, then let the
            // actual nested trial prove every restored physical keepout.
            for (const candidate of initial.laneCandidates) {
              const x = candidate.left + candidate.width / 2,
                y = candidate.top + candidate.height / 2;
              for (const omitted of rivals.filter(
                (rival) => rival.seat && origins.has(rival.seat)
              )) {
                let lower = ownY - origin.radius,
                  upper = ownY + origin.radius;
                for (const rival of rivals) {
                  if (rival === omitted) continue;
                  const available =
                    Math.hypot(x - rival.x, y - rival.y) - 1.5 - motion - rival.motion;
                  const square = available * available - (x - ownX) * (x - ownX);
                  if (available <= 0 || square <= 0) {
                    lower = Infinity;
                    break;
                  }
                  const radius = Math.sqrt(square);
                  lower = Math.max(lower, y - radius + 0.001);
                  upper = Math.min(upper, y + radius - 0.001);
                }
                if (lower > upper) continue;
                for (const endpoint of [lower - ownY, upper - ownY]) {
                  addShift(endpoint);
                  addShift(Math.floor(endpoint));
                  addShift(Math.ceil(endpoint));
                }
              }
            }
            const evaluate = (ownerShift: number) => {
              if (!withinBudget()) return false;
              const fresh = entry;
              const mine = restingAvatarBox(image, scale),
                cx = mine.left + mine.width / 2,
                cy = mine.top + mine.height / 2;
              const current = centres();
              const proposals = new Map<
                HTMLElement,
                Map<number, { shift: number; candidate: CardBox }>
              >();
              const proposalObstacles = Array.from(
                page.querySelectorAll(
                  '.community-area,.table-brand,.seat__avatar-img,.seat__info,.seat__action,.seat__bounty,.seat__position-badge,.seat__cards--hero .seat__card,.seat__cards--revealed .seat__card,.pot-display,.pot-display__pile,.bbj-widget,.bbj-mini-plate,.chat-collapsed,.mtp-lobby-btn'
                )
              )
                .filter((element) => !compactNine || !element.matches('.table-brand'))
                .map(visibleBox)
                .filter((r): r is CardBox => r !== null)
                .concat(reservedDealer ? [reservedDealer] : []);
              const partGroups = new Map<HTMLElement, CardBox[]>();
              for (const rival of current)
                if (rival.seat)
                  partGroups.set(
                    rival.seat,
                    proposalObstacles.filter((obstacle) => {
                      const element = boxSources.get(obstacle);
                      return element && rival.seat!.contains(element);
                    })
                  );
              // A rival's current paint can occupy the very lane it must vacate.
              // Exempt that one proposed pod only while deriving the movement;
              // the fresh whole-assignment check restores every keepout.
              const laneCandidates =
                compactNine && Math.abs(ownerShift) > 0.0001
                  ? fresh.laneCandidates.flatMap((candidate) => [
                      candidate,
                      { ...candidate, top: candidate.top + ownerShift },
                    ])
                  : fresh.laneCandidates;
              // A cap's shown-card edge moves with its owner. Keep both its
              // existing marker seeds and the translated edge seeds; the final
              // fresh whole-ring assignment still proves every actual slot.
              for (const candidate of laneCandidates) {
                const x = candidate.left + candidate.width / 2,
                  y = candidate.top + candidate.height / 2;
                if (
                  candidate.left < pageBox.left ||
                  candidate.left + candidate.width > pageBox.right ||
                  candidate.top < pageBox.top ||
                  candidate.top + candidate.height > canvas.bottom
                )
                  continue;
                const distance = Math.hypot(x - cx, y - cy);
                const blocked = current.filter(
                  (rival) =>
                    distance + 1.5 + motion + rival.motion >= Math.hypot(x - rival.x, y - rival.y)
                );
                if (
                  !blocked.length &&
                  !proposalObstacles.some((obstacle) => markerTouches(candidate, obstacle))
                ) {
                  plans.push({ owner, ownerShift, rival: null, rivalShift: 0, cost: motionCost() });
                  continue;
                }
                if (blocked.length !== 1) continue;
                const rival = blocked[0],
                  rivalOrigin = rival.seat && origins.get(rival.seat);
                if (!rival.seat || !rivalOrigin) continue;
                const rivalSeat = rival.seat;
                const rivalParts = partGroups.get(rivalSeat) ?? [];
                if (
                  proposalObstacles.some(
                    (obstacle) =>
                      !rivalParts.includes(obstacle) && markerTouches(candidate, obstacle)
                  )
                )
                  continue;
                const required = distance + 1.5 + motion + rival.motion;
                const square = required * required - (x - rival.x) * (x - rival.x);
                if (square <= 0) continue;
                const byShift =
                  proposals.get(rival.seat) ??
                  new Map<number, { shift: number; candidate: CardBox }>();
                for (const direction of [-1, 1]) {
                  const dy = y + direction * (Math.sqrt(square) + 0.001) - rival.y;
                  if (Math.abs(dy) > rivalOrigin.radius) continue;
                  // The exact ownership boundary must also vacate this marker's
                  // physical footprint before an expensive actual DOM trial.
                  const inverse = { ...candidate, top: candidate.top - dy };
                  if (rivalParts.some((obstacle) => markerTouches(inverse, obstacle))) continue;
                  const key = Math.round(dy * 64),
                    old = byShift.get(key);
                  if (old === undefined || Math.abs(dy) < Math.abs(old.shift))
                    byShift.set(key, { shift: dy, candidate });
                }
                proposals.set(rival.seat, byShift);
              }
              const ranked = [...proposals]
                .flatMap(([seat, values]) =>
                  [...values.values()].map((value) => ({ seat, ...value }))
                )
                .sort((a, b) => Math.abs(a.shift) - Math.abs(b.shift));
              for (const proposal of diverse(ranked, 16, (a, b) =>
                a.seat === b.seat ? Math.abs(a.shift - b.shift) : Infinity
              ).sort((a, b) => Math.abs(a.shift) - Math.abs(b.shift)))
                artwork.tryShiftOwnerForWager(proposal.seat, proposal.shift, () => {
                  if (!withinBudget()) return false;
                  const actual = restingAvatarBox(image, scale),
                    px = proposal.candidate.left + proposal.candidate.width / 2,
                    py = proposal.candidate.top + proposal.candidate.height / 2;
                  const distance = Math.hypot(
                    px - actual.left - actual.width / 2,
                    py - actual.top - actual.height / 2
                  );
                  if (
                    centres().some(
                      (rival) =>
                        distance + 1.5 + motion + rival.motion >=
                        Math.hypot(px - rival.x, py - rival.y)
                    )
                  )
                    return false;
                  const keepouts = Array.from(
                    page.querySelectorAll(
                      '.community-area,.table-brand,.seat__avatar-img,.seat__info,.seat__action,.seat__bounty,.seat__position-badge,.seat__cards--hero .seat__card,.seat__cards--revealed .seat__card,.pot-display,.pot-display__pile,.bbj-widget,.bbj-mini-plate,.chat-collapsed,.mtp-lobby-btn'
                    )
                  )
                    .filter((element) => !compactNine || !element.matches('.table-brand'))
                    .map(visibleBox)
                    .filter((r): r is CardBox => r !== null)
                    .concat(reservedDealer ? [reservedDealer] : []);
                  if (keepouts.some((obstacle) => markerTouches(proposal.candidate, obstacle)))
                    return false;
                  plans.push({
                    owner,
                    ownerShift,
                    rival: proposal.seat,
                    rivalShift: proposal.shift,
                    cost: motionCost(),
                  });
                  return false;
                });
              return false;
            };
            for (const shift of diverse(
              [...shifts.values()].sort((a, b) => Math.abs(a) - Math.abs(b) || a - b),
              32,
              (a, b) => Math.abs(a - b)
            ).sort((a, b) => Math.abs(a) - Math.abs(b) || a - b)) {
              if (Math.abs(shift) < 0.0001) evaluate(shift);
              else artwork.tryShiftOwnerForWager(owner, shift, () => evaluate(shift));
            }
          }
          // Only the best finite physically valid pairs rebuild all wager pools.
          // Collection above always rolls back; failed joint trials do as well.
          const unique = new Map<string, (typeof plans)[number]>();
          const chairIds = new Map([...origins.keys()].map((seat, index) => [seat, index]));
          for (const plan of plans) {
            const key = [
              chairIds.get(plan.owner),
              Math.round(plan.ownerShift * 64),
              plan.rival ? chairIds.get(plan.rival) : -1,
              Math.round(plan.rivalShift * 64),
            ].join(':');
            const old = unique.get(key);
            if (!old || plan.cost < old.cost) unique.set(key, plan);
          }
          for (const plan of diverse(
            [...unique.values()].sort((a, b) => a.cost - b.cost),
            8,
            (a, b) =>
              a.owner === b.owner && a.rival === b.rival
                ? Math.hypot(a.ownerShift - b.ownerShift, a.rivalShift - b.rivalShift)
                : Infinity
          ).sort((a, b) => a.cost - b.cost)) {
            const accept = () =>
              plan.rival && Math.abs(plan.rivalShift) > 0.0001
                ? artwork.tryShiftOwnerForWager(plan.rival, plan.rivalShift, complete)
                : complete();
            if (
              Math.abs(plan.ownerShift) < 0.0001
                ? accept()
                : artwork.tryShiftOwnerForWager(plan.owner, plan.ownerShift, accept)
            ) {
              moved = true;
              break;
            }
          }
          if (moved) {
            completedWagers.forEach(({ bet, next }) => commitWager(bet, next));
            // A joint proof can only reassign markers, with zero body or
            // caption movement. That does not invalidate a tabled hand's slot.
            if (!compactFacts || opponentRowPose() !== beforeRowPose) {
              settled.current.rows = new WeakMap();
              rows.forEach((row) => {
                row.style.removeProperty('translate');
                row.style.removeProperty('--vh-step-f');
                row.style.removeProperty('--vh-card-w');
                delete row.dataset.baseStep;
                delete row.dataset.baseCardW;
              });
            }
            place(remainingOwnerSpacingPasses - 1, origins);
            return;
          }
        }
        const finishPartialAssignment =
          artwork.ready() && page.getAttribute('data-seats') === '9' && window.innerWidth <= 340;
        const cachedBefore = wagers().filter((bet) => settled.current.wagers.has(bet)).length;
        let unresolved = false;
        const placedWagers: CardBox[] = [...fixedWagers];
        for (let i = 0; i < entries.length; i++) {
          const { bet, box } = entries[i];
          const next = placements?.[i];
          if (
            !next ||
            (finishPartialAssignment &&
              [...permanentKeepouts, ...placedWagers].some((other) =>
                retainedWagerTouches(next, other)
              ))
          ) {
            unresolved = true;
            // No clear spot of its own: it stays at its rest point in front of
            // its player, never in front of somebody else.
            for (const name of ['--bet-offset-x', '--bet-offset-y', '--collect-dx', '--collect-dy'])
              bet.style.removeProperty(name);
            continue;
          }
          commitWager(bet, next, box);
          obstacles.push(next);
          hardObstacles.push(next);
          placedWagers.push(next);
        }
        // Complete the original finite allocation with the safe slots already
        // proved above. Never cache a covered last resort and wait for a runout
        // to discover that the remaining owner's lane needs a little spacing.
        // Each continuation adds a valid keeper and consumes the existing pass
        // budget, preserving its cumulative opponent-motion origins.
        if (
          finishPartialAssignment &&
          unresolved &&
          remainingOwnerSpacingPasses > 0 &&
          wagers().filter((bet) => settled.current.wagers.has(bet)).length > cachedBefore
        ) {
          place(remainingOwnerSpacingPasses - 1, spacingOrigins);
          return;
        }
        // A terminal metadata/owner gap may leave the baseline slot unresolved.
        // Retry that same owned placement against the actual assigned wagers.
        if (!reservedDealer)
          placeDealerButton(scaler, canvas, scale, points, obstacles, hardObstacles, placedWagers);
      }
      if (!phoneMarkers) placeRows(true);
    };
    place();
    let frame: number | null = null;
    const schedule = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        place();
      });
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(scaler);
    observer.observe(page);
    // Pot amounts animate independently of the table's fixed canvas. Reserve
    // their actual final footprint when it changes, including a later pot node.
    const observedPots = new WeakSet<Element>();
    const observePots = () => {
      scaler.querySelectorAll('.pot-display,.pot-display__pile').forEach((pot) => {
        if (observedPots.has(pot)) return;
        observedPots.add(pot);
        observer.observe(pot);
      });
    };
    observePots();
    // SeatSlot reveals on its own animation clock, after the parent's commit.
    // React's child insertion/class change is the layout event to consume.
    const mutations = new MutationObserver(() => {
      observePots();
      schedule();
    });
    mutations.observe(scaler, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class'],
    });
    document.fonts?.addEventListener('loadingdone', schedule);
    scaler.addEventListener('animationend', schedule);
    scaler.addEventListener('transitionend', schedule);
    scaler.addEventListener('load', schedule, true);
    return () => {
      active = false;
      artwork.stop();
      document.fonts?.removeEventListener('loadingdone', schedule);
      resetWagers();
      observer.disconnect();
      mutations.disconnect();
      scaler.removeEventListener('animationend', schedule);
      scaler.removeEventListener('transitionend', schedule);
      scaler.querySelector<HTMLElement>('.dealer-button')?.style.removeProperty('translate');
      scaler.removeEventListener('load', schedule, true);
      if (frame !== null) cancelAnimationFrame(frame);
      scaler
        .querySelectorAll<HTMLElement>('.seat-wrapper--cap .seat, .seat-wrapper--top .seat')
        .forEach((seat) => seat.style.removeProperty('--sp-wrap-overlap'));
      topPods().forEach((pod) => {
        pod.style.removeProperty('translate');
        pod.style.removeProperty('--sp-top-seat-shift');
      });
      scaler
        .querySelectorAll<HTMLElement>('.seat__cards--revealed')
        .forEach((row) => row.style.removeProperty('translate'));
    };
  }, [root, revision, handKey]);
}

/**
 * Where the dealer button will stand once its left/top glide settles, in page
 * pixels, including any translate this hook gave it. Read from the inline
 * percentages rather than the live box, because during the 0.6s glide between
 * seats the live box is somewhere on the way.
 */
function dealerSettledBox(scaler: HTMLElement, dealer: HTMLElement): CardBox | null {
  const canvas = scaler.getBoundingClientRect();
  const left = parseFloat(dealer.style.left);
  const top = parseFloat(dealer.style.top);
  if (!Number.isFinite(left) || !Number.isFinite(top) || canvas.width <= 0) return null;
  const scale = tableRenderScale(scaler);
  const size = (parseFloat(getComputedStyle(dealer).width) || dealer.offsetWidth || 0) * scale;
  if (size <= 0) return null;
  const shift = (dealer.style.translate || '0px 0px').split(/\s+/).map((v) => parseFloat(v) || 0);
  const x = canvas.left + (left / 100) * canvas.width + (shift[0] || 0) * scale;
  const y = canvas.top + (top / 100) * canvas.height + (shift[1] || 0) * scale;
  return { left: x - size / 2, top: y - size / 2, width: size, height: size };
}

/**
 * Dan 2026-10-22, from a real phone: "I'm actually one behind the button and
 * the button is right in front of me." The button's rest point is computed in
 * ring geometry, which on a phone does not know where the tags, bounties and
 * dropped hero actually landed, so its keep-outs can push it across the felt
 * until it stands nearer the next player than its own. This pass runs on the
 * painted layout: the button keeps its rest point when that point is clear of
 * every player, the board and the pot AND its own player is the nearest one;
 * otherwise it takes the nearest felt point that satisfies both. It runs
 * after the wagers are placed, and keeps clear of them too.
 */
function placeDealerButton(
  scaler: HTMLElement,
  canvas: DOMRect,
  scale: number,
  points: ReadonlyArray<{ x: number; y: number; depth: number }>,
  obstacles: ReadonlyArray<CardBox>,
  hardObstacles: ReadonlyArray<CardBox> = obstacles,
  wagers: ReadonlyArray<CardBox> = []
): CardBox | null {
  const dealer = scaler.querySelector<HTMLElement>('.dealer-button');
  if (!dealer) return null;
  const rest = dealerSettledBox(scaler, dealer);
  if (!rest) return null;
  const left = parseFloat(dealer.style.left);
  const top = parseFloat(dealer.style.top);
  const ownerX = parseFloat(dealer.dataset.ownerX ?? '');
  const ownerY = parseFloat(dealer.dataset.ownerY ?? '');
  if (!Number.isFinite(ownerX) || !Number.isFinite(ownerY)) return rest;
  const centreOf = (element: Element | null | undefined) => {
    const r =
      element instanceof HTMLImageElement
        ? restingAvatarBox(element, scale)
        : element?.getBoundingClientRect();
    return r && r.width > 0
      ? {
          x: r.left + r.width / 2,
          y: r.top + r.height / 2,
          motion: 1.5 * scale + 0.008 * Math.max(r.width, r.height) + 0.5 * scale,
        }
      : null;
  };
  let owner: { x: number; y: number; motion: number } | null = null;
  const others: { x: number; y: number; motion: number }[] = [];
  for (const wrapper of Array.from(scaler.querySelectorAll<HTMLElement>('.seat-wrapper'))) {
    const centre = centreOf(wrapper.querySelector('.seat:not(.seat--empty) .seat__avatar-img'));
    if (!centre) continue;
    const mine =
      Math.abs(parseFloat(wrapper.style.left) - ownerX) < 0.01 &&
      Math.abs(parseFloat(wrapper.style.top) - ownerY) < 0.01;
    if (mine) owner = centre;
    else others.push(centre);
  }
  if (!owner) return rest;
  const own = owner;
  const size = rest.width;
  const air = 3 * scale;
  const boxAt = (x: number, y: number): CardBox => ({
    left: x - size / 2,
    top: y - size / 2,
    width: size,
    height: size,
  });
  const clearOf = (list: ReadonlyArray<CardBox>) => (box: CardBox) =>
    !list.some(
      (o) =>
        box.left < o.left + o.width + air &&
        box.left + box.width > o.left - air &&
        box.top < o.top + o.height + air &&
        box.top + box.height > o.top - air
    );
  const owned = (x: number, y: number) => {
    const mine = Math.hypot(x - own.x, y - own.y);
    return others.every((o) => mine + 1.5 + own.motion + o.motion < Math.hypot(x - o.x, y - o.y));
  };
  const restX = rest.left + size / 2;
  const restY = rest.top + size / 2;
  let best: { x: number; y: number } | null = null;
  if (clearOf(obstacles)(rest) && owned(restX, restY)) best = { x: restX, y: restY };
  // Off the felt's printing if possible; over it only when nothing else is
  // this player's (the smallest phones).
  for (const clear of [clearOf(obstacles), clearOf(hardObstacles)]) {
    if (best) break;
    let cost = Infinity;
    for (const point of points) {
      if (point.depth < 0) continue; // include the clear rail band before covering protected content
      if (!owned(point.x, point.y) || !clear(boxAt(point.x, point.y))) continue;
      const next = Math.hypot(point.x - own.x, point.y - own.y);
      if (next < cost) {
        cost = next;
        best = { x: point.x, y: point.y };
      }
    }
  }
  if (!best) {
    // The smallest felts: still this player's button, on the spot it covers
    // least of, rather than a clear spot in front of somebody else.
    const covered = (box: CardBox) =>
      hardObstacles.reduce(
        (sum, o) =>
          sum +
          Math.max(
            0,
            Math.min(box.left + box.width, o.left + o.width) - Math.max(box.left, o.left)
          ) *
            Math.max(
              0,
              Math.min(box.top + box.height, o.top + o.height) - Math.max(box.top, o.top)
            ),
        0
      );
    // Ownership remains mandatory even in the most crowded printing lane.
    const offWagers = clearOf(wagers);
    let cost = Infinity;
    for (const point of points) {
      if (point.depth < 10 || !owned(point.x, point.y)) continue;
      const box = boxAt(point.x, point.y);
      if (!offWagers(box)) continue;
      const next = covered(box) * 4 + Math.hypot(point.x - own.x, point.y - own.y);
      if (next < cost) {
        cost = next;
        best = { x: point.x, y: point.y };
      }
    }
  }
  if (!best) return null;
  const baseX = canvas.left + (left / 100) * canvas.width;
  const baseY = canvas.top + (top / 100) * canvas.height;
  dealer.style.translate = `${(best.x - baseX) / scale}px ${(best.y - baseY) / scale}px`;
  return boxAt(best.x, best.y);
}

/** The greedy fallback, accepted only when every wager found its own spot and
 *  no two of them touch. */
function cleanGreedyWagers(options: ReadonlyArray<ReadonlyArray<CardBox>>): CardBox[] | null {
  const result = greedyProtectedWagers(options);
  for (let i = 0; i < result.length; i++) {
    const a = result[i];
    if (!a) return null;
    for (let j = i + 1; j < result.length; j++) {
      const b = result[j];
      if (b && wagerBoxesOverlap(a, b)) return null;
    }
  }
  return result as CardBox[];
}
