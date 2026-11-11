import { expect, type Page } from '@playwright/test';

/** Exercise the published client with the existing local-only engine fixture. */
export async function verifyHeroCelebrations(
  page: Page,
  tableId: string,
  heroId: string,
  rivalId: string
) {
  // No synthetic hand may create production writes or client diagnostics.
  await page.route('**/*', async (route) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) {
      await route.abort('blockedbyclient');
      return;
    }
    await route.fallback();
  });
  await page.evaluate(() => {
    // The remaining native sockets are Supabase, not the local engine double.
    WebSocket.prototype.send = function () {};
  });
  // The fixture owns no real seat and its engine WebSocket never connects upstream.
  // Capture actual oscillator starts, leaving Web Audio and user sound gates intact.
  const surface = await page.locator('.table-surface').boundingBox();
  if (!surface) throw new Error('The published table surface is not visible.');
  // A real pointer gesture unlocks document audio even while table artwork
  // overlays the surface. No table control or projected hand action is needed.
  await page.mouse.click(surface.x + surface.width / 2, surface.y + surface.height / 2);
  await page.evaluate(() => {
    const start = OscillatorNode.prototype.start;
    const setValueAtTime = AudioParam.prototype.setValueAtTime;
    const scheduled = new WeakMap<AudioParam, number>();
    AudioParam.prototype.setValueAtTime = function (value: number, time: number) {
      scheduled.set(this, value);
      return setValueAtTime.call(this, value, time);
    };
    const frequencies: number[] = [];
    Object.assign(window, { __heroCelebrationFrequencies: frequencies });
    OscillatorNode.prototype.start = function (when?: number) {
      // Count the win arpeggio, excluding ordinary chip-collection clicks.
      const frequency = scheduled.get(this.frequency) ?? this.frequency.value;
      if ([523.25, 659.25, 783.99, 1046.5].some((note) => Math.abs(note - frequency) < 0.1)) {
        frequencies.push(frequency);
      }
      return start.call(this, when);
    };
  });
  const audioCount = () =>
    page.evaluate(
      () =>
        (window as unknown as { __heroCelebrationFrequencies: number[] })
          .__heroCelebrationFrequencies.length
    );
  const particles = page.locator('canvas').filter({ visible: true });
  const celebrationCount = () =>
    particles.evaluateAll(
      (elements) =>
        elements.filter(
          (el) =>
            getComputedStyle(el).position === 'fixed' && getComputedStyle(el).zIndex === '9999'
        ).length
    );
  const emit = (payload: Record<string, unknown>) =>
    page.evaluate(
      (data) => {
        window.dispatchEvent(new CustomEvent('ca-test-celebration', { detail: data }));
      },
      { table_id: tableId, hand_number: 7, timestamp: Date.now(), ...payload }
    );

  // A losing quads hand used to trigger the reveal fanfare on every screen.
  const beforeReveal = await audioCount();
  await emit({
    type: 'showdown',
    results: [
      { user_id: heroId, hand_ranking: 8, hand_name: 'Four Of A Kind', mucked: false },
      { user_id: rivalId, hand_ranking: 9, hand_name: 'Straight Flush', mucked: false },
    ],
  });
  await expect(page.locator('.community-cards--showdown').first()).toBeVisible();
  expect(await audioCount()).toBe(beforeReveal);
  expect(await celebrationCount()).toBe(0);

  for (const [label, winnerIds, expected] of [
    ['loss', [rivalId], false],
    ['small chop', [rivalId, heroId], true],
    ['sole win', [heroId], true],
  ] as const) {
    await expect.poll(celebrationCount, { timeout: 6_000 }).toBe(0);
    const before = await audioCount();
    await emit({
      type: 'pot_win',
      pot: 2,
      pot_id: label,
      winner_ids: winnerIds,
      winners: winnerIds.map((user_id) => ({
        user_id,
        amount: 2 / winnerIds.length,
        hand_name: 'Straight',
      })),
    });
    if (expected) {
      // Both the confetti canvas and the hero's seat-particle canvas must mount.
      await expect.poll(celebrationCount).toBe(2);
      await expect.poll(audioCount).toBeGreaterThan(before);
    } else {
      // A positive UI acknowledgement proves the losing payout was consumed.
      await expect(
        page.locator('.seat__hand-name--winner').filter({ hasText: 'Straight' }).first()
      ).toBeVisible();
      expect(await audioCount()).toBe(before);
      expect(await celebrationCount()).toBe(0);
    }
    console.log(`[hero-celebration] served client ${label}: sound/confetti=${expected}`);
  }
}
