import { expect, type Page } from '@playwright/test';
import { waitForMobileAvatarGrowth } from './mobileLiveTableLayout';

export const FIXED_MOBILE_ARTWORK_CASES = [
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
  await page.setViewportSize({ width: 600, height: 1298 });
  await page.reload();
  await page.evaluate(() => {
    for (const style of document.querySelectorAll('style'))
      style.textContent = (style.textContent || '')
        .replace(/env\(\s*safe-area-inset-top\s*(?:,[^()]*)?\)/g, '72px')
        .replace(/env\(\s*safe-area-inset-bottom\s*(?:,[^()]*)?\)/g, '52px');
    Object.assign(document.documentElement.dataset, {
      cards: '2',
      tournament: 'false',
      spectator: 'true',
      dealer: '2',
      activeSeat: '3',
      action: 'preflop',
      actionPills: 'true',
      villainCards: '2',
      folded: '1,6',
    });
  });
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
        paint: Array.from(document.querySelectorAll<HTMLElement>('.seat__avatar')).map((e) =>
          ['--sp-mobile-art-scale', '--sp-mobile-art-x', '--sp-mobile-art-y'].map((n) =>
            e.style.getPropertyValue(n)
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
    const spectator = settings.spectator === 'true';
    await page.evaluate((settings) => {
      Object.assign(document.documentElement.dataset, {
        tournament: 'false',
        ...settings,
        revealed: 'false',
        folded: '1,6',
        actionPills: 'true',
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
    }
    await expect.poll(async () => (await read()).paint.some((p) => Number(p[0]) > 1)).toBe(true);
    const before = await read();
    // Dan 2026-11-12: every portrait is the exact same size and stays centred
    // over its frame box (no sideways shift), the hero's own zoom aside.
    const opponents = before.paint.slice(spectator ? 0 : 1).filter((p) => p[0]);
    expect(new Set(opponents.map((p) => p[0])).size, 'one size for every portrait').toBe(1);
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
      if (state.revealed === 'true') revealed = after.cards;
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
