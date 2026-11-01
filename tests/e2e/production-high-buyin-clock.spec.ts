import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { prepareCashLobbyActions } from './support/cashLobbyOverlays';
import { diamondEntryRead, settleDiamondSpinsOffer } from './support/diamondInvitationOffer';
import { openLobbyGameSection } from './support/lobbyGameSections';
import { isReadOnlySpectatorSocketType } from './support/spectatorSocketRead';
import { EngineSocketJournal } from './support/liveTableRealtime';

const CLUB_ID = process.env.E2E_CLUB_ID || 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4';
type Row = Record<string, any>;
test.use({ viewport: { width: 393, height: 852 }, trace: 'off', video: 'off' });

test('above 25 previews and the natural engine level clock stay within seven to ten minutes', async ({
  page,
  context,
  request,
}, info) => {
  test.setTimeout(14 * 60_000);
  page.setDefaultTimeout(15_000);
  expect(/^ca-customization-cert-.*@example\.invalid$/.test(process.env.SP_EMAIL || '')).toBe(true);
  const pin = JSON.parse(readFileSync('e2e-report/lobby-ui-proof/before.json', 'utf8'));
  expect(pin.action).toBe('verify-high-buyin-clock');
  const blocked: string[] = [];
  const rows = new Map<string, Row>();
  const reads: Promise<void>[] = [];
  const readErrors: string[] = [];
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (!response.ok() || !/\/(?:tournaments|get_club_home)$/.test(path)) return;
    reads.push(
      (async () => {
        const body = await response.json();
        const found = Array.isArray(body) ? body : body.tournaments;
        if (Array.isArray(found))
          for (const row of found) if (row?.id && row.buy_in_amount != null) rows.set(row.id, row);
      })().catch(() => {
        readErrors.push(path);
      })
    );
  });
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
          blocked.push(`websocket:${type || 'unreadable'}`);
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
      blocked.push(new URL(route.request().url()).pathname);
      await route.abort('blockedbyclient');
    }
  );
  const engine = async (tableId?: string) => {
    const response = await request.get(
      `https://engine.smarter.poker/health?high_clock=${Date.now()}${tableId ? `&liveness_table_ids=${tableId}` : ''}`,
      { timeout: 15_000 }
    );
    expect(response.ok()).toBe(true);
    const health = await response.json();
    expect(health.releaseSha).toBe(pin.engine.releaseSha);
    expect(health.instanceId ?? health.instance_id ?? health.instance).toBe(pin.engine.instanceId);
    expect(health.maintenance?.active).toBe(false);
    return health;
  };
  const before = await engine();
  const offer = diamondEntryRead(page);
  await page.goto(`clubs/${CLUB_ID}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await prepareCashLobbyActions(page);
  await settleDiamondSpinsOffer(page, offer);
  await openLobbyGameSection(page, 'MTT');
  const previews: Row[] = [];
  let selected: Row | undefined;
  for (const [format, label] of [
    ['SPIN', 'SPINS'],
    ['SNG', "SIT N GO'S"],
    ['SATELLITE', 'SATELLITES'],
    ['MTT', "MTT'S"],
  ]) {
    await page.getByRole('tab', { name: label, exact: true }).click();
    await expect
      .poll(async () => {
        await Promise.all(reads);
        return rows.size;
      })
      .toBeGreaterThan(0);
    const cards = page.locator('[data-testid="lobby-game-row"]:visible');
    await expect(cards.first()).toBeVisible();
    const ids = await cards.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-id'))
    );
    const candidates = ids
      .map((id) => (id ? rows.get(id) : undefined))
      .filter((row): row is Row => !!row && Number(row.buy_in_amount) > 25);
    const subject =
      format === 'MTT'
        ? candidates
            .filter(
              (row) =>
                String(row.status).toUpperCase() === 'RUNNING' &&
                Number(row.current_players) >= 4 &&
                row.on_break !== true &&
                row.is_on_break !== true &&
                row.addon_period_triggered !== true
            )
            .sort((a, b) => Number(b.current_players) - Number(a.current_players))[0]
        : candidates.sort(
            (a, b) =>
              Number(
                ['REGISTERING', 'SCHEDULED', 'ANNOUNCED'].includes(String(b.status).toUpperCase())
              ) -
              Number(
                ['REGISTERING', 'SCHEDULED', 'ANNOUNCED'].includes(String(a.status).toUpperCase())
              )
          )[0];
    expect(
      subject,
      `A real above-25 ${format} witness must be visible; no synthetic fixture or empty pass`
    ).toBeTruthy();
    await page
      .locator(`[data-testid="lobby-game-row"][data-id="${subject!.id}"]:visible`)
      .getByRole('button', { name: /^Details:/ })
      .click();
    const panel = page.getByRole('dialog').filter({ has: page.locator('.arena-game-card') });
    // Spin/SNG cards have no full-lobby link. Their observed real IDs use
    // the canonical read-only details route; MTT/satellites use the actual link.
    const navigation = ['SPIN', 'SNG'].includes(format)
      ? 'canonical-observed-id'
      : 'full-lobby-link';
    if (navigation === 'full-lobby-link') {
      await panel.getByRole('link', { name: 'Open Full Tournament Lobby', exact: true }).click();
    } else {
      await page.goto(`tournaments/${subject!.id}?club_id=${CLUB_ID}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });
    }
    await page.getByRole('tab', { name: 'Blinds', exact: true }).click();
    const current = page.locator('.blinds-tab__meter-foot span:last-child');
    await expect(current).toContainText(/Min Level/);
    const printed = await page
      .locator(
        '.blinds-tab__meter-foot span:last-child, .blinds-tab__level-of, .blinds-tab__card .tl-section-note'
      )
      .allTextContents();
    const minutes = printed
      .filter((value) => /Min(?: Level)?$/.test(value.trim()))
      .map((value) => Number(value.match(/([0-9]+(?:\.[0-9]+)?) Min/)?.[1]));
    expect(minutes.length).toBeGreaterThan(0);
    expect(
      minutes.every((value) => Number.isFinite(value) && value >= 7 && value <= 10),
      `${format} above-25 preview levels: ${minutes.join(',')}`
    ).toBe(true);
    previews.push({
      format,
      tournamentId: subject!.id,
      buyIn: Number(subject!.buy_in_amount),
      navigation,
      minutes,
    });
    await info.attach(`high-buyin-${format.toLowerCase()}-preview.png`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    if (format === 'MTT') {
      selected = subject;
      break;
    }
    await page.goto(`clubs/${CLUB_ID}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await prepareCashLobbyActions(page);
    await openLobbyGameSection(page, 'MTT');
  }
  expect(readErrors).toEqual([]);
  expect(previews.map((value) => value.format)).toEqual(['SPIN', 'SNG', 'SATELLITE', 'MTT']);
  const journal = new EngineSocketJournal(page);
  await page.getByRole('tab', { name: 'Tables', exact: true }).click();
  const watch = page.getByRole('button', { name: /^Watch .+ Players Seated$/ });
  await expect(watch.first()).toBeVisible();
  const tableIds = await watch.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-warm-table'))
  );
  let tableId: string | undefined;
  for (const id of tableIds.slice(0, 16)) {
    if (!id) continue;
    const health = await engine(id);
    if (
      health.tableLiveness?.some(
        (row: Row) =>
          row.tableId === id && row.running && !row.paused && row.seated >= 2 && row.dealable >= 2
      )
    ) {
      tableId = id;
      break;
    }
  }
  expect(
    tableId,
    'The natural clock witness requires an existing running populated tournament table'
  ).toBeTruthy();
  expect(Number.isSafeInteger(Number(selected!.current_level))).toBe(true);
  expect(Number(selected!.current_level)).toBeGreaterThanOrEqual(0);
  const since = Date.now();
  await page.locator(`button[data-warm-table="${tableId}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/table/${tableId}(?:[?#]|$)`), { timeout: 30_000 });
  await expect(page.getByTestId('spectator-footer-bar')).toBeVisible();
  const naturalLevel = () =>
    journal.frames.find((frame) => {
      const payload = frame.message.payload as Row | undefined;
      return (
        frame.direction === 'received' &&
        frame.at >= since &&
        frame.message.type === 'EVENT' &&
        frame.message.tableId === tableId &&
        frame.message.replayed !== true &&
        payload?.replayed !== true &&
        payload?.type === 'level_up' &&
        Number(payload.small_blind) > 0 &&
        Number(payload.big_blind) > 0 &&
        payload.table_id === tableId &&
        payload.tournament_id === selected!.id &&
        Number.isSafeInteger(payload.new_level) &&
        payload.new_level > Number(selected!.current_level) &&
        Number.isSafeInteger(payload.timestamp) &&
        payload.timestamp >= since
      );
    });
  await expect
    .poll(() => Boolean(naturalLevel()), {
      timeout: 10 * 60_000,
      intervals: [500, 1000],
      message:
        'Observe one natural, non-replayed level_up from the serving engine without playing or changing a clock',
    })
    .toBe(true);
  const event = naturalLevel()!;
  const payload = event.message.payload as Row;
  expect(typeof payload.duration_minutes).toBe('number');
  expect(payload.duration_minutes).toBeGreaterThanOrEqual(7);
  expect(payload.duration_minutes).toBeLessThanOrEqual(10);
  const after = await engine(tableId);
  expect(
    after.tableLiveness?.some((row: Row) => row.tableId === tableId && row.running && !row.paused)
  ).toBe(true);
  expect(blocked).toEqual([]);
  await info.attach('high-buyin-natural-level.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await info.attach('high-buyin-clock.json', {
    body: Buffer.from(
      JSON.stringify({
        previews,
        engine: { releaseSha: before.releaseSha, instanceId: pin.engine.instanceId },
        tournamentId: selected!.id,
        tableId,
        buyIn: Number(selected!.buy_in_amount),
        naturalLevel: {
          new_level: payload.new_level,
          duration_minutes: payload.duration_minutes,
          timestamp: payload.timestamp,
          receivedAt: event.at,
        },
        blocked,
      })
    ),
    contentType: 'application/json',
  });
});
