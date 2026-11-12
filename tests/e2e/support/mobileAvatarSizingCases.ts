import { expect, type Page } from '@playwright/test';

/** Runs inside the existing real-component/font harness, not a second page or
 * pipeline. A fresh action/reveal must never choose a different art transform. */
export async function checkFixedMobileArtwork(page: Page, bundle: string) {
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
  for (const settings of [
    { seats: '9', spectator: 'true', cards: '2', occupiedSeats: '' },
    { seats: '9', spectator: 'false', cards: '2', occupiedSeats: '' },
    { seats: '6', spectator: 'false', cards: '4', occupiedSeats: '0,4' },
    { seats: '6', spectator: 'false', cards: '4', occupiedSeats: '' },
  ]) {
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
    await expect.poll(async () => (await read()).paint.some((p) => Number(p[0]) > 1)).toBe(true);
    const before = await read();
    if (!spectator) {
      expect(Number(before.paint[0][0]), 'hero grows').toBeGreaterThan(1);
      if (settings.seats === '6') expect(Number(before.paint[0][0])).toBe(1.3);
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
  for (const settings of [
    { cards: '6', killEnabled: 'false' },
    { cards: '2', killEnabled: 'true' },
  ]) {
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
