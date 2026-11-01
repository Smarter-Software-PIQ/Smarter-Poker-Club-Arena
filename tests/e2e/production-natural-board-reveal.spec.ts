import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  CASH_SPECTATOR_ACTION,
  CASH_TABLE_CARD_SELECTOR,
  collectVisibleCashCandidates,
  selectClassicCashCandidate,
} from './support/cashTableCandidates';
import { prepareCashLobbyActions } from './support/cashLobbyOverlays';
import { openLobbyGameSection } from './support/lobbyGameSections';
import { EngineSocketJournal } from './support/liveTableRealtime';
import {
  installNaturalBoardReveal,
  naturalBoardRevealEvidence,
} from './support/naturalBoardReveal';
import { isReadOnlySpectatorSocketType } from './support/spectatorSocketRead';

const CLUB = process.env.E2E_CLUB_ID || 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4';
const SHA = /^[0-9a-f]{40}$/;
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

// One public spectator. No outage, chat, injected packets, seats or financial probes.
test.use({ viewport: { width: 393, height: 852 }, trace: 'off', video: 'off', screenshot: 'off' });
test('one natural cash hand owes the full turn and river reveal', async ({
  page,
  context,
  request,
}, info) => {
  test.setTimeout(195_000);
  const started = Date.now();
  const setupDeadline = started + 60_000;
  const sourceSHA = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  expect(sourceSHA).toMatch(SHA);
  expect(process.env.NATURAL_BOARD_REVEAL).toBe('1');
  const expectedClient = process.env.EXPECTED_CLIENT_SHA || '';
  const expectedEngine = process.env.EXPECTED_ENGINE_SHA || '';
  expect(expectedClient).toBe(sourceSHA);
  expect(expectedEngine).toMatch(SHA);
  const file = process.env.E2E_TEST_ACCOUNT_FILE;
  if (!file) throw new Error('The maintained reserved spectator record is required');
  const account = JSON.parse(await readFile(file, 'utf8'));
  expect(String(account.id)).toMatch(UUID);
  expect(String(account.email)).toMatch(/^ca-customization-cert-postdeploy-.*@example\.invalid$/);
  const writes: string[] = [];
  const journal = new EngineSocketJournal(page);
  let subject = '';
  let since = 0;
  let interrupted = false;
  let observedViewer: string | null = null;
  const evidence: Record<string, unknown> = {
    kind: 'scoped-natural-board-live/v1',
    sourceSHA,
    fullReleaseCertificate: false,
    productionParticipation: false,
    verdict: 'unknown',
    observationLimitMs: 120_000,
  };
  const identities = async () => {
    const urls = [
      'https://ca-static.smarter.poker/build-info.json',
      'https://smarter.poker/hub/club-arena/build-info.json',
      'https://engine.smarter.poker/health',
    ];
    const rows = await Promise.all(
      urls.map(async (url) => {
        const response = await request.get(`${url}?natural_board=${Date.now()}`, {
          timeout: 10_000,
        });
        expect(response.ok(), 'The exact live identity must be readable').toBe(true);
        return response.json();
      })
    );
    for (const client of rows.slice(0, 2)) {
      expect(client.ca_sha).toBe(expectedClient);
      expect(client.built_by).toBe('publish-club-arena.yml');
    }
    expect(String(rows[0].run_id)).toMatch(/^[1-9][0-9]*$/);
    expect(String(rows[0].run_id)).toBe(String(rows[1].run_id));
    expect(rows[2].releaseSha).toBe(expectedEngine);
    expect(rows[2].running).toBe(true);
    expect(rows[2].instanceId).toMatch(/^1-[0-9a-f]{8}$/);
    return {
      clientSHA: expectedClient,
      publisherRun: String(rows[0].run_id),
      engineSHA: expectedEngine,
      instance: rows[2].instanceId,
    };
  };
  await context.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (
      url.pathname.endsWith('/rest/v1/table_seats') &&
      (url.searchParams.get('select') || '').startsWith('table_id') &&
      (url.searchParams.get('user_id') || '').startsWith('eq.')
    )
      observedViewer = url.searchParams.get('user_id')!.slice(3);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) {
      const rpc = url.pathname.match(/\/rpc\/([^/]+)$/)?.[1] || '';
      const financial =
        /take_seat|leave_seat|seat_move|move_seat|seat_change|swap_seat|buy_?in|rebuy|add_?chips|cash_?out|cashout|transfer_chips|mint_chips|clawback|distribute_chips|tournament_payout|register_for_tournament|unregister_from_tournament|join_waitlist|leave_waitlist|(?:^|_)(?:credit|debit|transfer|mint|payout|refund|settle)(?:_|$)|claim_(?:daily|bonus|reward)/.test(
          rpc
        );
      const forbidden =
        (url.hostname === 'engine.smarter.poker' && !url.pathname.endsWith('/heartbeat')) ||
        /\/rest\/v1\/(?:table_seats|tournament_players|wallets|wallet_transactions|chip_ledger|chip_transactions)\/?$/.test(
          url.pathname
        ) ||
        /\/(?:action|buyin|buy-in|cashout|cash-out|addchips|add-chips|rebuy|leave|seat-move|seat-change)\/?$/.test(
          url.pathname
        ) ||
        (financial &&
          rpc !== 'fn_cash_effective_buyin' &&
          !/^(?:fn_|ca_)?(?:get|read|list|fetch|can|has|is)_/.test(rpc)) ||
        (url.pathname.endsWith('/rest/v1/club_members') &&
          /"(?:chip_balance|promo_balance|held_chips|locked_chips|credit_used)"\s*:/.test(
            req.postData() || ''
          ));
      if (forbidden) {
        writes.push('http-participation-refused');
        await route.abort('blockedbyclient');
        return;
      }
    }
    await route.continue();
  });
  await context.routeWebSocket(
    () => true,
    (client) => {
      const engine = new URL(client.url()).hostname === 'engine.smarter.poker';
      const server = client.connectToServer();
      server.onMessage((message) => client.send(message));
      client.onMessage((message) => {
        if (engine) {
          let type = '';
          try {
            type = String(JSON.parse(String(message)).type || '');
          } catch {
            /* refused below */
          }
          if (!isReadOnlySpectatorSocketType(type)) {
            writes.push('socket-participation-refused');
            return;
          }
        }
        server.send(message);
      });
    }
  );
  const capture = async (stop = false) => {
    const result = await page.evaluate((stop) => {
      const observer = window.__naturalBoardReveal;
      return {
        receipts: stop ? (observer?.stop() ?? []) : (observer?.receipts ?? []),
        diagnostics: observer?.diagnostics ?? null,
      };
    }, stop);
    const frames = journal.matchingFrames({ direction: 'received', tableId: subject, since });
    return {
      ...naturalBoardRevealEvidence(result.receipts, frames, subject),
      diagnostics: result.diagnostics,
    };
  };
  try {
    evidence.before = await identities();
    const cataloguePromise = page
      .waitForResponse(
        (response) => {
          const url = new URL(response.url());
          return (
            url.pathname.endsWith('/rest/v1/tables') &&
            (url.searchParams.get('select') || '')
              .replace(/\s+/g, '')
              .startsWith('id,name,game_variant,') &&
            url.searchParams.get('tournament_id') === 'is.null'
          );
        },
        { timeout: 30_000 }
      )
      .then(async (response) => {
        expect(response.ok()).toBe(true);
        const rows: unknown = await response.json();
        if (!Array.isArray(rows)) throw new Error('Public cash catalogue is not an array');
        return rows;
      });
    // Attach a rejection handler immediately; navigation failure must not leave an unhandled waiter.
    const catalogueRead = cataloguePromise.then(
      (rows) => ({ rows, error: null }),
      () => ({ rows: null, error: 'public-catalogue-unavailable' })
    );
    await page.goto(`clubs/${CLUB}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    expect(new URL(page.url()).origin).toBe('https://smarter.poker');
    await expect(page.locator('.club-home')).toBeVisible({ timeout: 20_000 });
    await prepareCashLobbyActions(page);
    await openLobbyGameSection(page, 'ALL');
    const all = page.getByRole('tab', { name: 'ALL', exact: true });
    await all.click();
    await expect(all).toHaveAttribute('aria-selected', 'true');
    const statuses = page
      .getByLabel('Game Status', { exact: true })
      .getByRole('button', { name: 'All', exact: true });
    await statuses.click();
    await expect(statuses).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator(CASH_TABLE_CARD_SELECTOR).first()).toBeVisible({ timeout: 10_000 });
    const candidates = await page
      .locator(CASH_TABLE_CARD_SELECTOR)
      .evaluateAll(collectVisibleCashCandidates, CASH_SPECTATOR_ACTION.source);
    const catalogue = await catalogueRead;
    if (!catalogue.rows) throw new Error(catalogue.error || 'Public catalogue unavailable');
    expect(observedViewer, 'The browser must use the reserved identity').toBe(account.id);
    const selected = selectClassicCashCandidate(candidates, catalogue.rows);
    if (!selected) throw new Error('UNKNOWN: no occupied classic public cash subject');
    subject = selected.id;
    const row = page.locator(`[data-testid="lobby-game-row"][data-id="${subject}"]`);
    if (await row.isVisible()) {
      await row.getByRole('button', { name: /^Details:/ }).click();
      await page.getByRole('dialog').getByRole('button', { name: CASH_SPECTATOR_ACTION }).click();
    } else {
      await page
        .locator(`[data-testid="arena-lobby-game-card"][data-id="${subject}"]`)
        .getByRole('button', { name: CASH_SPECTATOR_ACTION })
        .click();
    }
    await expect(page).toHaveURL((url) => url.pathname.endsWith(`/table/${subject}`), {
      timeout: 20_000,
    });
    await expect(page.locator('.table-surface')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('spectator-footer-bar')).toBeVisible();
    await expect(page.locator('.table-page')).toHaveAttribute('data-hero', 'false');
    await expect(page.locator('.seat--hero')).toHaveCount(0);
    await expect
      .poll(
        () =>
          journal.matchingFrames({ direction: 'received', tableId: subject, type: 'SNAPSHOT' })
            .length,
        { timeout: 10_000 }
      )
      .toBeGreaterThan(0);
    expect(Date.now(), 'Setup exhausted the reserved natural observation allowance').toBeLessThan(
      setupDeadline
    );
    await page.bringToFront();
    // Reserve 30 seconds for final identity, raster and receipt work.
    const deadline = Math.min(Date.now() + 120_000, started + 165_000);
    since = Date.now();
    const originalTransports = journal.transportIdsOpenAt(since);
    expect(originalTransports).toHaveLength(1);
    await page.evaluate(installNaturalBoardReveal, deadline);
    evidence.tableId = subject;
    evidence.observationStartedAt = since;
    while (Date.now() < deadline) {
      const state = await page.evaluate(() => ({
        visible: document.visibilityState === 'visible',
        focused: document.hasFocus(),
        dialog: [...document.querySelectorAll('[role="dialog"]')].some(
          (node) => node.getBoundingClientRect().width > 0
        ),
      }));
      const current = await capture();
      if (
        !state.visible ||
        !state.focused ||
        state.dialog ||
        journal.areTransportsClosed(originalTransports) ||
        current.transportContinuity !== 'observed'
      ) {
        interrupted = true;
        break;
      }
      if (current.verdict === 'qualified' || current.verdict === 'violation') break;
      await page.waitForTimeout(Math.min(100, Math.max(1, deadline - Date.now())));
    }
    const result = await capture(true);
    evidence.observationEndedAt = Date.now();
    evidence.reveal = result;
    evidence.verdict = interrupted ? 'unknown' : result.verdict;
    evidence.interrupted = interrupted;
    // Only the PUBLIC board is imaged, after sampling has stopped. This is a
    // real raster/bounds witness of the final board, not first-frame pixel coverage.
    const board = page.locator('.community-cards').filter({ visible: true });
    if ((await board.count()) === 1) {
      evidence.publicBoardBounds = await board.boundingBox();
      await info.attach('natural-board-final-public-raster', {
        body: await board.screenshot({ timeout: 3_000 }),
        contentType: 'image/png',
      });
    }
    evidence.after = await identities();
    expect(evidence.after).toEqual(evidence.before);
    expect(writes).toEqual([]);
    expect(
      evidence.verdict,
      'UNKNOWN is not a qualified same-hand turn and river observation'
    ).toBe('qualified');
  } finally {
    await page.evaluate(() => window.__naturalBoardReveal?.stop()).catch(() => undefined);
    evidence.refusedParticipation = writes;
    mkdirSync('e2e-report', { recursive: true });
    writeFileSync(
      'e2e-report/natural-board-receipt.json',
      JSON.stringify(evidence, null, 2) + '\n'
    );
    await info.attach('mobile-live-table-natural-board-scoped', {
      path: 'e2e-report/natural-board-receipt.json',
      contentType: 'application/json',
    });
  }
});
