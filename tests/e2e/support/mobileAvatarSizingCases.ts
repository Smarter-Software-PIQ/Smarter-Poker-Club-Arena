import { expect, type Page } from '@playwright/test';
import { readMobileTableLayout, waitForMobileAvatarGrowth } from './mobileLiveTableLayout';

export const FIXED_MOBILE_ARTWORK_CASES = [
  { seats: '9', spectator: 'true', cards: '2', occupiedSeats: '', shortPhone: true },
  { seats: '9', spectator: 'false', cards: '2', occupiedSeats: '', shortPhone: true },
  { seats: '9', spectator: 'true', cards: '2', occupiedSeats: '' },
  { seats: '9', spectator: 'false', cards: '2', occupiedSeats: '' },
  { seats: '6', spectator: 'false', cards: '4', occupiedSeats: '0,4' },
  { seats: '6', spectator: 'false', cards: '4', occupiedSeats: '' },
  // Dan, 2026-11-12: six-card tables were the whole point; they grow too.
  { seats: '6', spectator: 'false', cards: '6', occupiedSeats: '' },
  { seats: '6', spectator: 'true', cards: '6', occupiedSeats: '' },
] as const;

export type FixedMobileArtworkSettings = (typeof FIXED_MOBILE_ARTWORK_CASES)[number];

/** Runs inside the existing real-component/font harness, not a second page or
 * pipeline. A fresh action/reveal must never choose a different art transform. */
export async function checkFixedMobileArtwork(
  page: Page,
  bundle: string,
  settings: FixedMobileArtworkSettings
) {
  // Start the mobile candidate in the same notched-phone geometry used by
  // its approval screenshots, without the preceding test's injected poses.
  const shortPhone = 'shortPhone' in settings;
  await page.setViewportSize({ width: 600, height: shortPhone ? 1065 : 1298 });
  // Each case is a fresh device session: no game-type size recorded yet.
  await page.evaluate(() => localStorage.removeItem('sp-mobile-avatar-size-v3'));
  await page.reload();
  await page.evaluate((settings) => {
    for (const style of document.querySelectorAll('style'))
      style.textContent = (style.textContent || '')
        .replace(
          /env\(\s*safe-area-inset-top\s*(?:,[^()]*)?\)/g,
          'shortPhone' in settings ? '0px' : '72px'
        )
        .replace(
          /env\(\s*safe-area-inset-bottom\s*(?:,[^()]*)?\)/g,
          'shortPhone' in settings ? '0px' : '52px'
        );
    if ('shortPhone' in settings)
      document.documentElement.style.setProperty('--sp-table-stable-viewport-h', '1065px');
    Object.assign(document.documentElement.dataset, {
      cards: '2',
      tournament: 'false',
      spectator: 'true',
      dealer: '2',
      activeSeat: '3',
      action: 'preflop',
      actionPills: 'none',
      actionCaption: '',
      waitlist: 'true',
      folded: '1,6',
      // Mount the requested game directly. A warm-up nine-seat Hold'em mount
      // can persist a second game type before the first fixture transition.
      ...settings,
      villainCards: settings.cards,
    });
  }, settings);
  await page.addScriptTag({ content: bundle });
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll<HTMLImageElement>('.seat__avatar-img')).length > 0 &&
      Array.from(document.querySelectorAll<HTMLImageElement>('.seat__avatar-img')).every(
        (i) => i.complete && i.naturalWidth > 0
      )
  );
  await page.evaluate(() => document.fonts.ready);
  const settle = async () => {
    await page.evaluate(async () => {
      for (let i = 0; i < 4; i++) {
        for (const animation of document.getAnimations()) {
          if (Number.isFinite(animation.effect?.getComputedTiming().iterations)) {
            try {
              animation.finish();
            } catch {
              /* An unattached effect has no finish. */
            }
          } else {
            animation.pause();
            animation.currentTime = 0;
          }
        }
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        );
      }
    });
    let previous = '',
      stable = 0;
    await expect
      .poll(
        async () => {
          const signature = await page.evaluate(() =>
            JSON.stringify(
              Array.from(document.querySelectorAll('.seat__card')).map((e) => {
                const r = e.getBoundingClientRect();
                return [r.left, r.top, r.width, r.height].map((x) => Math.round(x * 1000));
              })
            )
          );
          stable = signature === previous ? stable + 1 : 0;
          previous = signature;
          return stable;
        },
        { timeout: 10000, intervals: [100] }
      )
      .toBeGreaterThanOrEqual(6);
  };
  const read = () =>
    page.evaluate(() => {
      const rect = (element: Element) => {
        const r = element.getBoundingClientRect();
        return [r.left, r.top, r.width, r.height].map((x) => Math.round(x * 1000) / 1000);
      };
      return {
        anchors: Array.from(document.querySelectorAll('.seat-wrapper,.seat')).map(rect),
        paint: Array.from(document.querySelectorAll<HTMLElement>('.seat__avatar')).map((e) =>
          ['--sp-mobile-art-scale', '--sp-mobile-art-x', '--sp-mobile-art-y'].map((n) =>
            n === '--sp-mobile-art-scale' && e.style.getPropertyValue(n)
              ? String(
                  Number(e.style.getPropertyValue(n)) *
                    (parseFloat(getComputedStyle(e).getPropertyValue('--sp-bust-scale')) || 1)
                )
              : e.style.getPropertyValue(n)
          )
        ),
        frames: Array.from(document.querySelectorAll<HTMLElement>('.seat__info')).map((e) =>
          ['x', 'y', 'w', 'h'].map((n) => e.style.getPropertyValue(`--sp-frame-${n}`))
        ),
        fixed: Array.from(
          document.querySelectorAll(
            '.seat-wrapper,.seat__info,.seat__avatar,.community-area,.table-tab-bar'
          )
        ).map(rect),
        cards: Array.from(document.querySelectorAll('.seat__cards--revealed .seat__card')).map(
          rect
        ),
      };
    });
  // The preceding observer contract injected gesture classes directly.
  // Remove only those test-owned mutations before exercising real transitions.
  await page.evaluate(() => {
    document
      .querySelectorAll('.seat')
      .forEach((e) => e.classList.remove('seat--folded', 'seat--winner-pop', 'seat--allin-shake'));
    document
      .querySelectorAll('.seat__avatar-wrap')
      .forEach((e) => e.classList.remove('seat__avatar-wrap--fold'));
  });
  {
    // Qualify future captions before the first chair/portrait lock: production
    // often mounts between actions, then receives CHECK/FOLD/RAISE later.
    await settle();
    await waitForMobileAvatarGrowth(page);
    await expect(page.locator('.seat > .seat__action')).toHaveCount(0);
    const withoutCaptions = await read();
    for (const actionCaption of ['check', 'fold', 'raise']) {
      await page.evaluate((caption) => {
        document.documentElement.dataset.actionPills = 'true';
        document.documentElement.dataset.actionCaption = caption;
        document.dispatchEvent(new Event('fixture-runout'));
      }, actionCaption);
      await settle();
      expect(await page.locator('.seat > .seat__action').count()).toBeGreaterThan(0);
      expect(
        (await read()).anchors,
        `${actionCaption} cannot move the locked chair anchors`
      ).toEqual(withoutCaptions.anchors);
      const violations = await page.evaluate(readMobileTableLayout, {});
      if (settings.seats === '9')
        expect(
          violations.violations.filter((v: string) => v.includes('Nine-Max')),
          'nine-seat rail positions and both top portraits stay clear of the felt'
        ).toEqual([]);
      expect(
        violations.violations.filter((v: string) => v.startsWith('Action Caption')),
        `${actionCaption} appearing after allocation clears header, cards and peer plates`
      ).toEqual([]);
      expect(
        (await read()).paint.map((p) => p[0]),
        `${actionCaption} cannot resize the locked portraits`
      ).toEqual(withoutCaptions.paint.map((p) => p[0]));
    }
    await page.evaluate(() => {
      document.documentElement.dataset.actionCaption = '';
    });
    const spectator = settings.spectator === 'true';
    await page.evaluate((settings) => {
      Object.assign(document.documentElement.dataset, {
        tournament: 'false',
        ...settings,
        revealed: 'false',
        folded: '1,6',
        actionPills: 'true',
        waitlist: 'true',
        villainCards: settings.cards,
      });
      document.dispatchEvent(new Event('fixture-next-hand'));
    }, settings);
    await settle();
    if (spectator) {
      // Exercise the production screenshot sequence without the fixture's
      // animation-finishing settle helper between resize and proof.
      for (const width of [604, 600]) {
        await page.setViewportSize({ width, height: 1298 });
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
            )
        );
        await waitForMobileAvatarGrowth(page);
        expect((await read()).paint.some((p) => Number(p[0]) > 1)).toBe(true);
      }
      await settle();
      // Dan 2026-11-12: sizes never change once set. A viewport height change
      // (an iOS toolbar or keyboard) and the relayouts after it keep every
      // portrait's paint exactly as it was: no small frame, no new size.
      const locked = (await read()).paint;
      for (const height of [1200, 1298]) {
        await page.setViewportSize({ width: 600, height });
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
            )
        );
        expect(
          (await read()).paint.map((p) => p[0]),
          'a height change never resizes a portrait'
        ).toEqual(locked.map((p) => p[0]));
        await settle();
        expect(
          (await read()).paint.map((p) => p[0]),
          'a settled relayout never resizes a portrait'
        ).toEqual(locked.map((p) => p[0]));
      }
    }
    await expect.poll(async () => (await read()).paint.some((p) => Number(p[0]) > 1)).toBe(true);
    const before = await read();
    // Cards may overlap within their own fan, but never leave the screen or
    // obscure information. Exercise hidden PLO6 cards as well as showdown.
    const cardObstructions = () =>
      page.evaluate(() => {
        const visible = (e: Element) => {
          const style = getComputedStyle(e);
          const r = e.getBoundingClientRect();
          return (
            style.visibility !== 'hidden' && style.display !== 'none' && r.width > 0 && r.height > 0
          );
        };
        const overlaps = (a: DOMRect, b: DOMRect) =>
          Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
          Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
        const chair = (e: Element) =>
          e.closest('.seat-wrapper')?.getAttribute('data-seat-wrapper') ?? 'table';
        const displays = [
          ...document.querySelectorAll(
            '.table-brand,.community-area,.seat__info,.seat__name,.seat__stack,.seat__action,.seat__bet-chips,.dealer-button,.action-panel,.waitlist-cta'
          ),
        ].filter(visible);
        return [...document.querySelectorAll('.seat__cards .seat__card')]
          .filter(visible)
          .flatMap((card) => {
            const r = card.getBoundingClientRect();
            const errors: string[] = [];
            if (
              r.left < -0.5 ||
              r.right > innerWidth + 0.5 ||
              r.top < -0.5 ||
              r.bottom > innerHeight + 0.5
            )
              errors.push(`Card Outside Viewport: ${chair(card)}`);
            for (const display of displays)
              if (overlaps(r, display.getBoundingClientRect()))
                errors.push(
                  `Card ${chair(card)} Covers ${display.className} ${chair(display)}: ${JSON.stringify(r)} vs ${JSON.stringify(display.getBoundingClientRect())}`
                );
            return errors;
          });
      });
    const bottomOverlaps = await page.evaluate(() => {
      const controls = [
        ...document.querySelectorAll('.waitlist-cta,.action-panel,.pre-action-bar'),
      ].filter((el) => el.getBoundingClientRect().height > 0);
      return [...document.querySelectorAll('.seat__info')].flatMap((plate) => {
        const a = plate.getBoundingClientRect();
        return controls
          .filter((control) => {
            const b = control.getBoundingClientRect();
            return (
              Math.min(a.right, b.right) > Math.max(a.left, b.left) + 1 &&
              Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 1
            );
          })
          .map((control) => control.className);
      });
    });
    expect(bottomOverlaps, 'bottom controls leave every player plate clear').toEqual([]);
    expect(await cardObstructions(), 'hidden hands stay complete and clear of displays').toEqual(
      []
    );
    // Dan 2026-11-12: every portrait, the hero's included, is the exact same
    // size and stays centred over its frame box (no sideways shift).
    const grown = before.paint.filter((p) => p[0]);
    expect(new Set(grown.map((p) => p[0])).size, 'one size for every portrait').toBe(1);
    const tableSize = grown[0][0];
    // Dan 2026-11-13: no enlarged portrait is ever cut off. The acting
    // seat's holo sweep must not blend (a blend group clips the grown head in
    // WebKit), and a sit-out badge keeps clear of the portrait's head.
    const uncut = await page.evaluate(() => {
      const results: Array<{
        blend: string;
        badgeTop: number;
        headBottom: number;
        foldFilter: string;
        foldOpacity: string;
        foldSeatOpacity: string;
        foldImageOpacity: string;
        foldWinnerFilter: string;
        actingFilter: string;
        spotlight: string;
        hero: boolean;
        effects: Array<{
          name: string;
          parentFilters: string[];
          parentOpacities: string[];
          imageFilter: string;
          imageOpacity: string;
          restoredFilter: string;
          restoredOpacity: string;
          baselineFilter: string;
          baselineOpacity: string;
        }>;
        statuses: Array<{
          name: string;
          parentFilters: string[];
          parentOpacities: string[];
          imageFilter: string;
          imageOpacity: string;
          badgeTop: number;
        }>;
      }> = [];
      for (const avatar of document.querySelectorAll<HTMLElement>(
        '.seat__avatar[style*="--sp-mobile-art-scale"]'
      )) {
        const paint = avatar.querySelector('.seat__avatar-paint')!;
        const holo = document.createElement('span');
        holo.className = 'seat__holo';
        paint.prepend(holo);
        const badge = document.createElement('div');
        badge.className = 'seat__sitout-badge';
        badge.textContent = 'Waiting For The Button To Pass';
        avatar.parentElement!.appendChild(badge);
        const art = avatar.querySelector('.seat__avatar-img')!.getBoundingClientRect();
        const seat = avatar.closest('.seat')!;
        const wasFolded = seat.classList.contains('seat--folded');
        const wasInHand = seat.classList.contains('seat--in-hand');
        // A folded player is no longer in the hand. Preserve the active hero
        // styling contract when returning from this temporary folded pose.
        seat.classList.remove('seat--in-hand');
        seat.classList.add('seat--folded');
        const foldedStyle = getComputedStyle(avatar.parentElement!);
        const foldFilter = foldedStyle.filter;
        const foldOpacity = foldedStyle.opacity;
        const foldedImage = avatar.querySelector('.seat__avatar-img')!;
        const foldTable = seat.closest('.table-page')!;
        const hadWinnerFlash = foldTable.classList.contains('table-page--winner-flash');
        foldTable.classList.add('table-page--winner-flash');
        getComputedStyle(foldedImage).getPropertyValue('filter');
        for (const element of [seat, foldedImage])
          for (const animation of element.getAnimations()) {
            if (Number.isFinite(animation.effect?.getComputedTiming().iterations))
              animation.finish();
          }
        const foldSeatOpacity = getComputedStyle(seat).opacity;
        const foldImageOpacity = getComputedStyle(foldedImage).opacity;
        const foldWinnerFilter = getComputedStyle(foldedImage).filter;
        foldTable.classList.toggle('table-page--winner-flash', hadWinnerFlash);
        const wrapper = seat.closest('.seat-wrapper')!;
        const wasSpot = wrapper.classList.contains('seat-wrapper--spot');
        seat.classList.remove('seat--folded');
        seat.classList.toggle('seat--in-hand', wasInHand);
        wrapper.classList.add('seat-wrapper--spot');
        const image = avatar.querySelector('.seat__avatar-img')!;
        getComputedStyle(image).getPropertyValue('filter');
        for (const animation of image.getAnimations()) {
          if (Number.isFinite(animation.effect?.getComputedTiming().iterations)) animation.finish();
        }
        const actingFilter = getComputedStyle(seat).filter;
        const spotlight = getComputedStyle(image).filter;
        const statuses = [];
        const originalSeatClass = seat.className;
        wrapper.classList.remove('seat-wrapper--spot');
        seat.classList.remove('seat--away', 'seat--sitting_out', 'seat--in-hand');
        for (const name of ['away', 'sitting_out']) {
          seat.classList.add(`seat--${name}`);
          // Exercise the real status selectors, not merely a badge added to
          // an active seat. WebKit clips grown art at a filtered parent.
          getComputedStyle(image).getPropertyValue('filter');
          for (const animation of image.getAnimations()) {
            if (Number.isFinite(animation.effect?.getComputedTiming().iterations))
              animation.finish();
          }
          statuses.push({
            name,
            parentFilters: [seat, avatar.parentElement!, avatar].map(
              (element) => getComputedStyle(element).filter
            ),
            parentOpacities: [seat, avatar.parentElement!, avatar].map(
              (element) => getComputedStyle(element).opacity
            ),
            imageFilter: getComputedStyle(image).filter,
            imageOpacity: getComputedStyle(image).opacity,
            badgeTop: badge.getBoundingClientRect().top,
          });
          seat.classList.remove(`seat--${name}`);
        }
        const table = seat.closest('.table-page')!;
        const wasDim = wrapper.classList.contains('seat-wrapper--dim');
        const wasWinner = table.classList.contains('table-page--winner-flash');
        wrapper.classList.remove('seat-wrapper--dim');
        table.classList.remove('table-page--winner-flash');
        const finishImageTransition = () => {
          getComputedStyle(image).getPropertyValue('filter');
          for (const animation of image.getAnimations())
            if (Number.isFinite(animation.effect?.getComputedTiming().iterations))
              animation.finish();
        };
        finishImageTransition();
        const baselineFilter = getComputedStyle(image).filter;
        const baselineOpacity = getComputedStyle(image).opacity;
        const effects = [];
        for (const name of ['winner', 'dim', 'winner-dim']) {
          table.classList.toggle('table-page--winner-flash', name.includes('winner'));
          wrapper.classList.toggle('seat-wrapper--dim', name.includes('dim'));
          finishImageTransition();
          const state = {
            name,
            parentFilters: [wrapper, seat, avatar.parentElement!, avatar].map(
              (e) => getComputedStyle(e).filter
            ),
            parentOpacities: [wrapper, seat, avatar.parentElement!, avatar].map(
              (e) => getComputedStyle(e).opacity
            ),
            imageFilter: getComputedStyle(image).filter,
            imageOpacity: getComputedStyle(image).opacity,
          };
          table.classList.remove('table-page--winner-flash');
          wrapper.classList.remove('seat-wrapper--dim');
          finishImageTransition();
          effects.push({
            ...state,
            baselineFilter,
            baselineOpacity,
            restoredFilter: getComputedStyle(image).filter,
            restoredOpacity: getComputedStyle(image).opacity,
          });
        }
        wrapper.classList.toggle('seat-wrapper--dim', wasDim);
        table.classList.toggle('table-page--winner-flash', wasWinner);
        seat.className = originalSeatClass;
        results.push({
          effects,
          hero: seat.classList.contains('seat--hero'),
          actingFilter,
          spotlight,
          foldFilter,
          foldOpacity,
          foldSeatOpacity,
          foldImageOpacity,
          foldWinnerFilter,
          blend: getComputedStyle(holo).mixBlendMode,
          badgeTop: badge.getBoundingClientRect().top,
          headBottom: art.top + art.height * 0.4,
          statuses,
        });
        wrapper.classList.toggle('seat-wrapper--spot', wasSpot);
        seat.classList.toggle('seat--folded', wasFolded);
        holo.remove();
        badge.remove();
      }
      return results;
    });
    expect(uncut.length, 'folded portraits are exercised').toBeGreaterThan(0);
    for (const r of uncut) {
      expect(r.actingFilter, 'acting portraits have no clipping parent filter').toBe('none');
      if (!r.hero)
        expect(r.spotlight, 'acting portrait retains its spotlight').toContain('brightness(1.18)');
      expect(r.foldFilter, 'folded portraits have no clipping parent filter').toBe('none');
      expect(r.foldOpacity, 'fold dimming belongs to the painted image').toBe('1');
      expect(r.foldSeatOpacity, 'folded seat cannot clip its grown portrait').toBe('1');
      expect(
        Number(r.foldImageOpacity),
        'folded dimming retains the composed leaf opacity'
      ).toBeCloseTo(0.4875, 4);
      for (const filter of ['brightness(0.73)', 'brightness(0.8)', 'saturate(0.55)'])
        expect(r.foldWinnerFilter, 'winner flash composes with folded artwork dimming').toContain(
          filter
        );
      expect(r.blend, 'the holo sweep never blends over a grown portrait').toBe('normal');
      expect(
        r.badgeTop,
        "a sit-out badge keeps clear of the portrait's head"
      ).toBeGreaterThanOrEqual(r.headBottom);
      for (const effect of r.effects) {
        expect(effect.parentFilters, `${effect.name} keeps portrait parents unfiltered`).toEqual([
          'none',
          'none',
          'none',
          'none',
        ]);
        expect(effect.parentOpacities, `${effect.name} keeps portrait parents opaque`).toEqual([
          '1',
          '1',
          '1',
          '1',
        ]);
        if (effect.name.includes('winner'))
          expect(effect.imageFilter).toContain('brightness(0.73)');
        if (effect.name.includes('dim')) {
          expect(effect.imageFilter).toContain('brightness(0.85)');
          expect(effect.imageFilter).toContain('saturate(0.9)');
          expect(effect.imageOpacity).toBe('0.78');
        }
        expect(effect.restoredFilter, `${effect.name} restores the prior filter`).toBe(
          effect.baselineFilter
        );
        expect(effect.restoredOpacity, `${effect.name} restores the prior opacity`).toBe(
          effect.baselineOpacity
        );
      }
      for (const status of r.statuses) {
        expect(status.parentFilters, `${status.name} has no clipping parent filter`).toEqual([
          'none',
          'none',
          'none',
        ]);
        expect(status.parentOpacities, `${status.name} dims painted leaves only`).toEqual([
          '1',
          '1',
          '1',
        ]);
        expect(status.imageFilter, `${status.name} keeps its grayscale`).toContain(
          'grayscale(0.6)'
        );
        expect(status.imageOpacity, `${status.name} keeps its dimming`).toBe('0.55');
        expect(
          status.badgeTop,
          `${status.name} keeps its badge below the head`
        ).toBeGreaterThanOrEqual(r.headBottom);
      }
    }
    // Dan 2026-11-13: every table of this game type on this device takes the
    // size this one settled; it is recorded as the displayed height.
    const recorded = await page.evaluate(() =>
      Object.values(
        JSON.parse(localStorage.getItem('sp-mobile-avatar-size-v3') || '{}') as Record<
          string,
          number
        >
      )
    );
    // The displayed height of every grown portrait (the table renders at its
    // layout size here, so viewport px are layout px).
    const heights = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('.seat__avatar'))
        .filter((a) => a.style.getPropertyValue('--sp-mobile-art-scale'))
        .map((a) => a.querySelector('.seat__avatar-img')!.getBoundingClientRect().height)
    );
    const shown = Math.max(...heights);
    expect(Math.max(...heights) - Math.min(...heights), 'one displayed size').toBeLessThan(1);
    expect(recorded.length, 'the game type size is recorded').toBe(1);
    expect(Math.abs(recorded[0] - shown), 'recorded as the displayed height').toBeLessThan(3);
    for (const p of before.paint)
      if (p[0])
        expect(Math.abs(parseFloat(p[1]) || 0), 'centred over its frame box').toBeLessThan(1);
    if (!spectator) {
      expect(Number(before.paint[0][0]), 'hero grows').toBeGreaterThan(1);
      if (settings.seats === '9')
        expect(
          before.paint.slice(1).some((p) => Number(p[0]) > 1),
          'at least one opponent grows'
        ).toBe(true);
    }
    let revealed: number[][] | undefined;
    for (const state of [
      { folded: '1,6', revealed: 'false', active: 7 },
      { folded: '1,6', revealed: 'true', active: 5 },
      { folded: '1,6', revealed: 'true', active: 2 },
    ]) {
      await page.evaluate((state) => {
        Object.assign(document.documentElement.dataset, {
          folded: state.folded,
          revealed: state.revealed,
        });
        document.dispatchEvent(new CustomEvent('fixture-focus', { detail: state.active }));
      }, state);
      await settle();
      const after = await read();
      expect(after.paint, 'art scale and translation remain fixed').toEqual(before.paint);
      expect(after.frames, 'frame paint dimensions remain fixed').toEqual(before.frames);
      expect(after.fixed, 'anchors, hit boxes, plates and controls remain fixed').toEqual(
        before.fixed
      );
      if (revealed)
        expect(after.cards, 'already shown cards never move on a later turn').toEqual(revealed);
      expect(await cardObstructions(), 'shown hands stay complete and clear of displays').toEqual(
        []
      );
      if (state.revealed === 'true') revealed = after.cards;
    }
    // Dan 2026-11-12: the table's size never changes once set, whoever comes
    // and goes. Empty the ring to heads-up, then fill it again: every portrait
    // that is drawn keeps the locked size throughout.
    for (const occupiedSeats of settings.occupiedSeats
      ? ['', settings.occupiedSeats]
      : ['0,4', '']) {
      await page.evaluate((occupiedSeats) => {
        Object.assign(document.documentElement.dataset, { occupiedSeats, revealed: 'false' });
        document.dispatchEvent(new Event('fixture-next-hand'));
      }, occupiedSeats);
      await settle();
      const sizes = (await read()).paint.filter((p) => p[0]).map((p) => p[0]);
      expect(sizes.length, `portraits drawn with seats "${occupiedSeats}"`).toBeGreaterThan(0);
      expect(
        new Set(sizes),
        `a roster change keeps the locked size (seats "${occupiedSeats}")`
      ).toEqual(new Set([tableSize]));
    }
  }
  // Preserve the original disabled-layout check from the final six-card
  // spectator baseline, without charging the other configurations for it.
  if (settings.seats === '6' && settings.spectator === 'true' && settings.cards === '6') {
    const settings = { cards: '2', killEnabled: 'true' };
    await page.evaluate((settings) => {
      Object.assign(document.documentElement.dataset, settings);
      document.dispatchEvent(new Event('fixture-next-hand'));
    }, settings);
    await settle();
    const unchanged = await read();
    expect(
      unchanged.paint.every((p) => !p[0]),
      'unsupported layouts retain original artwork'
    ).toBe(true);
    expect(
      unchanged.frames.every((p) => p.every((v) => !v)),
      'unsupported layouts retain original frames'
    ).toBe(true);
  }
}
