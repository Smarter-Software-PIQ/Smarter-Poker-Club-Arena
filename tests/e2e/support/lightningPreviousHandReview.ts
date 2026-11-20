import { expect, type Page } from '@playwright/test';

/** Read-only fixtures for the published client's Previous Hand control. */
export async function verifyLightningPreviousHandReview(
  page: Page,
  options: {
    room: string;
    viewer: string;
    number: number;
    dealId: string;
    advance: () => void;
    disconnect: () => Promise<void>;
  }
) {
  const { room, viewer, number, dealId } = options;
  const archiveId = '81c81117-cd93-4207-8896-c32c715cd1ac';
  let settled = false;
  let sessionReads = 0;
  let archiveReads = 0;
  const recentRoute = '**/rpc/fn_lightning_recent_hands';
  const historyRoute = (url: URL) =>
    url.pathname.endsWith('/hand_history') &&
    url.searchParams.get('id')?.replaceAll('"', '') === 'in.(' + archiveId + ')';
  await page.route(recentRoute, async (route) => {
    expect(route.request().postDataJSON()).toEqual({ p_pool_session_id: room, p_limit: 50 });
    sessionReads++;
    const earlier = { hand_id: 'earlier', hand_number: number - 1, hand_history_id: null };
    return route.fulfill({
      json: settled
        ? [{ hand_id: dealId, hand_number: number, hand_history_id: archiveId }, earlier]
        : [earlier],
    });
  });
  await page.route(historyRoute, async (route) => {
    const request = route.request();
    const id = new URL(request.url()).searchParams.get('id');
    // Reject any write to this fixture at the browser boundary.
    expect(request.method()).toBe('GET');
    expect(id?.replaceAll('"', '')).toBe('in.(' + archiveId + ')');
    archiveReads++;
    return route.fulfill({
      json: [
        {
          id: archiveId,
          table_id: room,
          hand_number: number,
          game_variant: 'plo5',
          pot_size: 17,
          created_at: '2026-11-14T12:00:00Z',
          small_blind: 1,
          big_blind: 2,
          players: [{ userId: viewer, seat: 1, stack: 999 }],
          actions: [],
          winners: [],
          hole_cards: {},
          community_cards: ['As', 'Kd', '2h'],
        },
      ],
    });
  });
  try {
    await page
      .getByRole('button', { name: 'Previous Hand #' + number + ' - Open Hand History' })
      .click();
    const review = page.getByRole('dialog', { name: 'Hand Detail' });
    await expect(review).toContainText('Hand #' + number);
    await expect(review).toContainText('Awaiting Final Result');
    await expect.poll(() => sessionReads).toBe(1);
    options.advance();
    await expect(page.locator('.table-brand__hand')).toContainText('Hand #' + (number + 2));
    await expect(review).toContainText('Hand #' + number);
    settled = true; // The archive commits with no saved-hand event to this client.
    await options.disconnect();
    await expect(review).toContainText('#' + number, { timeout: 30_000 });
    await expect(review).toContainText('Pot', { timeout: 30_000 });
    await expect(review).toContainText('17', { timeout: 30_000 });
    expect(archiveReads).toBe(1);
    await review.getByRole('button', { name: 'Close' }).first().click();
    await expect(review).toHaveCount(0);
  } finally {
    await page.unroute(recentRoute);
    await page.unroute(historyRoute);
  }
}
