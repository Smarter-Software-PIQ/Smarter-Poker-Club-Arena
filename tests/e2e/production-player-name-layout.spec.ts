import { test, expect, type Page } from '@playwright/test';
import { CASH_SPECTATOR_ACTION, CASH_TABLE_CARD_SELECTOR } from './support/cashTableCandidates';
import { openLobbyGameSection } from './support/lobbyGameSections';
import { prepareCashLobbyActions } from './support/cashLobbyOverlays';
import { diamondEntryRead, settleDiamondSpinsOffer } from './support/diamondInvitationOffer';
import { isReadOnlySpectatorSocketType } from './support/spectatorSocketRead';

const CLUB_ID = process.env.E2E_CLUB_ID || 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4';
test.use({ viewport: { width: 393, height: 852 }, trace: 'off', video: 'off' });

/** Read painted text ranges and the actual plate's content bounds, not overflow CSS alone. */
async function nameGeometry(page: Page) {
  return page.evaluate(() => {
    // Query and measure in one browser task. A keyed live plate may remount
    // between locator resolution and a later evaluation, especially on resize.
    const names = [
      ...document.querySelectorAll('.seat__info:not([aria-hidden="true"]) .seat__name'),
    ].filter(
      (well) => well.getClientRects().length > 0 && getComputedStyle(well).visibility !== 'hidden'
    );
    return names.map((well) => {
      const value = well.querySelector('.seat__name-text');
      const plate = well.closest('.seat__info');
      const seat = plate?.closest('.seat[data-player-id][role="region"]');
      if (!well.isConnected || !plate?.isConnected || !seat?.isConnected || !value) {
        return {
          text: well.textContent?.trim() || '',
          fullName: '',
          fontSize: 0,
          whiteSpace: '',
          lineCount: 0,
          complete: false,
          fits: false,
          invalidGeometry: 'A painted name lacks its connected occupied seat, plate or text',
        };
      }
      const seatLabel = seat.getAttribute('aria-label') || '';
      const beforeStack = seatLabel.slice(0, seatLabel.lastIndexOf(', Stack '));
      const fullName = beforeStack
        .replace(/^Seat \d+: /, '')
        .replace(/(?: \((?:Acting Now|Folded|All In)\))+$/, '')
        .trim();
      const box = well.getBoundingClientRect();
      const plateBox = plate.getBoundingClientRect();
      const css = getComputedStyle(plate);
      const valueCss = getComputedStyle(value);
      const scaleX = plateBox.width / ((plate as HTMLElement).offsetWidth || plateBox.width);
      const px = (text: string) => Number.parseFloat(text) || 0;
      const inner = {
        left: plateBox.left + (px(css.borderLeftWidth) + px(css.paddingLeft)) * scaleX,
        right: plateBox.right - (px(css.borderRightWidth) + px(css.paddingRight)) * scaleX,
      };
      const range = document.createRange();
      range.selectNodeContents(value);
      const ink = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
      const baselines = [...new Set(ink.map((rect) => Math.round(rect.top * 2) / 2))];
      const text = value.textContent?.trim() || '';
      return {
        text,
        fullName,
        fontSize: px(valueCss.fontSize),
        whiteSpace: valueCss.whiteSpace,
        lineCount: baselines.length,
        ink: ink.map((rect) => ({
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
        })),
        box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom },
        inner,
        complete:
          Boolean(text) &&
          text === fullName &&
          text === well.getAttribute('title')?.trim() &&
          !text.includes('\u2026'),
        fits:
          ink.length > 0 &&
          ink.every(
            (rect) =>
              rect.left >= Math.max(box.left, inner.left) - 1 &&
              rect.right <= Math.min(box.right, inner.right) + 1 &&
              rect.top >= box.top - 1 &&
              rect.bottom <= box.bottom + 1
          ),
      };
    });
  });
}

test('live spectator player names stay complete on one line inside their plates', async ({
  page,
  context,
  request,
}, info) => {
  test.setTimeout(120_000);
  page.setDefaultTimeout(10_000);
  expect(
    /^ca-customization-cert-.*@example\.invalid$/.test(process.env.SP_EMAIL || ''),
    'Use only the owned isolated certificate identity'
  ).toBe(true);
  const participation: string[] = [];
  await context.routeWebSocket(
    (url) =>
      url.hostname === 'engine.smarter.poker' &&
      (url.pathname === '/ws/multi' || url.pathname.startsWith('/ws/table/')),
    (client) => {
      const server = client.connectToServer();
      server.onMessage((message) => client.send(message));
      client.onMessage((message) => {
        let type = '';
        try {
          type = String(JSON.parse(String(message)).type || '');
        } catch {
          /* Refuse unknown writes. */
        }
        if (!isReadOnlySpectatorSocketType(type)) {
          participation.push(`websocket:${type || 'unreadable'}`);
          return;
        }
        server.send(message);
      });
    }
  );
  await page.route(
    /\/(?:action|leave|post-bb|rabbit-hunt|buyin|addchips|rebuy|cashout|sitout|seat-move|seat-change|rest\/v1\/(?:table_seats|tournament_players|wallet_transactions|rpc\/(?:fn_cash_game_join|atomic_table_buyin|fn_lightning_join|fn_lightning_buy_in|fn_take_seat_and_buy_in|fn_register_for_tournament|fn_unregister_from_tournament|fn_leave_seat_and_refund|atomic_table_rebuy|process_tournament_rebuy|fn_join_waitlist)))(?:[/?#]|$)/,
    async (route) => {
      if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.continue();
      participation.push(new URL(route.request().url()).pathname);
      await route.abort('blockedbyclient');
    }
  );
  const offer = diamondEntryRead(page);
  await page.goto(`clubs/${CLUB_ID}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await prepareCashLobbyActions(page);
  await expect(page.getByRole('button', { name: 'Cash Games', exact: true })).toBeVisible({
    timeout: 45_000,
  });
  await settleDiamondSpinsOffer(page, offer);
  await openLobbyGameSection(page, 'ALL');
  await page.getByRole('tab', { name: 'ALL', exact: true }).click();
  const cards = page.locator(`${CASH_TABLE_CARD_SELECTOR}:visible`);
  await expect(cards.first()).toBeVisible();
  const ids = (await cards.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-id'))))
    .filter((id): id is string => /^[0-9a-f-]{36}$/i.test(id || ''))
    .slice(0, 32);
  expect(ids.length).toBeGreaterThan(0);
  const response = await request.get(
    `https://engine.smarter.poker/health?liveness_table_ids=${ids.join(',')}`
  );
  expect(response.ok()).toBe(true);
  const health = await response.json();
  expect(Array.isArray(health.tableLiveness)).toBe(true);
  const subject = health.tableLiveness
    .filter(
      (row: {
        tableId: string;
        running: boolean;
        paused: boolean;
        seated: number;
        dealable: number;
      }) =>
        ids.includes(row.tableId) &&
        row.running &&
        !row.paused &&
        row.seated >= 2 &&
        row.dealable >= 2
    )
    .sort((a: { seated: number }, b: { seated: number }) => b.seated - a.seated)[0];
  expect(subject, 'Observe an actually served populated cash table').toBeTruthy();
  await page
    .locator(`${CASH_TABLE_CARD_SELECTOR}[data-id="${subject.tableId}"]:visible`)
    .getByRole('button', { name: /^Details:/ })
    .click();
  await page
    .getByRole('dialog')
    .filter({ has: page.locator('.arena-game-card') })
    .getByRole('button', { name: CASH_SPECTATOR_ACTION })
    .click();
  await expect(page).toHaveURL(new RegExp(`/table/${subject.tableId}(?:[?#]|$)`), {
    timeout: 30_000,
  });
  await expect(page.getByTestId('spectator-footer-bar')).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const measurements = [];
  for (const [width, height, mode] of [
    [393, 852, 'phone'],
    [1280, 900, 'wide'],
  ] as const) {
    await page.setViewportSize({ width, height });
    await expect
      .poll(async () => (await nameGeometry(page)).length, {
        message: 'Live occupied seats must display actual player names',
      })
      .toBeGreaterThanOrEqual(2);
    await expect
      .poll(
        async () =>
          (await nameGeometry(page)).filter(
            (name) =>
              !name.complete || !name.fits || name.lineCount !== 1 || name.whiteSpace !== 'nowrap'
          ),
        {
          message:
            'Every visible full player name must occupy one line inside its native name plate',
        }
      )
      .toEqual([]);
    const names = await nameGeometry(page);
    const longest = names.reduce((best, name) =>
      name.text.length > best.text.length ? name : best
    );
    expect(longest.text.length).toBeGreaterThan(0);
    measurements.push({ mode, width, height, longest, names });
    await info.attach(`live-player-names-${mode}.png`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  }
  expect(participation).toEqual([]);
  await info.attach('live-player-name-layout.json', {
    body: Buffer.from(JSON.stringify({ tableId: subject.tableId, measurements, participation })),
    contentType: 'application/json',
  });
});
