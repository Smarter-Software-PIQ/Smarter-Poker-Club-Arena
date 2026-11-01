import { openLobbyGameSection } from './support/lobbyGameSections';
import { createClient } from '@supabase/supabase-js';
import {
  acknowledgePreferenceWelcome,
  logoutAndOpenFreshPreferenceDevice,
  openFreshPreferenceDevice,
} from './support/accountPreferenceSession';
import {
  CLEANUP_FREEZE_ALLOWANCE_MS,
  createTemporaryCustomizationAccount,
  cleanupTemporaryCustomizationAccount,
  requireCustomizationCertificationEnvironment,
  type TemporaryCustomizationAccount,
} from './support/temporaryCustomizationAccount';
import { ensureAcceptedTerms } from './support/ensureAcceptedTerms';
import { observeSetupFailure } from './support/setupFailureObservation';
import { ensurePlayableProfile } from './support/ensurePlayableProfile';
import { ensureClubMembership } from './support/ensureClubMembership';
import { test, expect, devices, type Page, type Frame } from '@playwright/test';
import { CASH_SPECTATOR_ACTION, CASH_TABLE_CARD_SELECTOR } from './support/cashTableCandidates';
import { prepareCashLobbyActions } from './support/cashLobbyOverlays';
import { observeCashierFailure } from './support/cashierFailureDiagnostics';
import { diamondEntryRead, settleDiamondSpinsOffer } from './support/diamondInvitationOffer';
import {
  restoreLobbyPreference,
  selectLobbyPreference,
  observeLobbyPreferenceProof,
  readLobbyPreferenceOwner,
  lobbyTabLabel,
  type LobbyPreferenceProof,
} from './support/lobbyPreferenceProof';

/**
 * THE THREE THINGS DAN PHOTOGRAPHED, ON THE LIVE LOBBY (2026-09-10).
 *
 * mobile-lobby-chrome.spec.ts builds the lobby from this commit's stylesheets
 * and measures it; that is the pre-merge gate. This file is the other half:
 * the DEPLOYED lobby, signed in, on the phone engine, after the real wallet
 * has published the real count. It exists because the fixture passed on
 * 2026-09-09 while production printed nothing under MY WALLETS - the page
 * reset the count in the same commit the wallet published it, and no fixture
 * of the CSS could see that. A contract about what a player sees has to be
 * read off what a player sees.
 *
 * Signed out this file skips, like every authenticated spec here. It runs on
 * a phone profile in the chromium project: what it reads - the wallet's
 * published text, a sticky offset, a fixed edge - is decided by the app, not
 * the engine, and the engine-specific geometry is already measured on WebKit
 * by mobile-lobby-chrome.spec.ts.
 */
const CLUB_ID = process.env.E2E_CLUB_ID || 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4';

/** The MY WALLETS title's optical centre on the my-wallets-v1 master, as a
 *  percentage of the plate; the count line is centred on it. */
const TITLE_CENTRE_PCT = 54.65;

const preferenceDiagnostics = new WeakMap<Page, Map<Page, LobbyPreferenceProof>>();
const diagnostics = new WeakMap<Page, ReturnType<typeof observeCashierFailure>>();
test.beforeEach(async ({ page }) => {
  diagnostics.set(page, observeCashierFailure(page));
});
test.afterEach(async ({ page }, testInfo) => {
  let index = 0;
  for (const proof of preferenceDiagnostics.get(page)?.values() ?? []) {
    proof.stop();
    await testInfo.attach(`lobby-preference-phases-${index++}.json`, {
      body: Buffer.from(JSON.stringify(proof.snapshot())),
      contentType: 'application/json',
    });
  }
  preferenceDiagnostics.delete(page);
  const observer = diagnostics.get(page);
  if (!observer) return;
  observer.stop();
  if (testInfo.status !== testInfo.expectedStatus) {
    await testInfo.attach('mobile-lobby-network-diagnostics', {
      body: Buffer.from(JSON.stringify(observer.snapshot())),
      contentType: 'application/json',
    });
  }
  diagnostics.delete(page);
});

// Production has no retries. Preserve the first failed action's trace rather
// than relying on on-first-retry, which never records these failures.
test.use({ ...devices['iPhone 13'], trace: 'retain-on-failure' });

async function openLobby(page: Page, openSection = true) {
  // The Diamond Spins offer opens on the answer to this read. Listen before
  // navigating: it leaves as soon as the club resolves.
  const offer = diamondEntryRead(page);
  await page.goto(`clubs/${CLUB_ID}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  await page.waitForTimeout(500);
  test.skip(/\/auth(?:\/|$|\?)/.test(page.url()), 'signed out: the club lobby is behind a login');

  // Either optional welcome can cover a later tab action. Use the original
  // public dismissals, including the shared handler for a delayed Diamond offer.
  await prepareCashLobbyActions(page);
  await expect(page.getByRole('button', { name: 'Cash Games', exact: true })).toBeVisible({
    timeout: 45_000,
  });
  // Then settle that offer here, through its real Not Now and with its whole
  // budget, before a 5-second assertion or a scroll measurement can meet it
  // (support/diamondInvitationOffer.ts has the four runs it failed).
  await settleDiamondSpinsOffer(page, offer);
  if (openSection) await openLobbyGameSection(page, 'ALL');
}

test.describe('the mobile lobby chrome on production', () => {
  // The 30s default expired after the first successful wallet-count assertion
  // in run 35310320354. Allow the existing bounded navigation/readiness (30s +
  // 45s), greeting (3s + 8s), count (20s), persistence (4s) and geometry phases
  // to finish. No individual readiness deadline or visual assertion is relaxed.
  // These cases share the certificate account: the persistence journey selects
  // PLO/NLH while the scroll journey selects ALL. Keep this group in order so
  // one real preference write cannot replace another case's saved selection.
  // Default mode still executes later cases when an earlier assertion fails.
  test.describe.configure({ mode: 'default', timeout: 120_000 });

  test('the selected game list survives a cold return to the lobby', async ({ page }, testInfo) => {
    const proofs = new Map<Page, LobbyPreferenceProof>();
    preferenceDiagnostics.set(page, proofs);
    let ownerId: string | undefined;
    const proofFor = (document: Page) => {
      const proof = proofs.get(document);
      if (!proof) throw new Error('Lobby preference observer was not installed before navigation');
      return proof;
    };
    const openPreferenceLobby = async (document: Page, phase: string) => {
      const proof = observeLobbyPreferenceProof(document, CLUB_ID);
      proofs.set(document, proof);
      proof.phase(phase);
      await openLobby(document, false);
      const documentOwner = await readLobbyPreferenceOwner(document);
      if (ownerId && documentOwner !== ownerId) throw new Error('Lobby preference account changed');
      ownerId = documentOwner;
      const saved = await proof.ready(ownerId);
      if (saved) {
        const section = ['MTT', 'SNG', 'SPIN', 'SATELLITE'].includes(saved)
          ? 'Tournaments'
          : 'Cash Games';
        await expect(document.getByRole('button', { name: section, exact: true })).toHaveAttribute(
          'aria-expanded',
          'true'
        );
      } else {
        await openLobbyGameSection(document, 'ALL');
      }
      if (saved) {
        await expect(
          document
            .getByRole('tablist', { name: 'Game Type', exact: true })
            .getByRole('tab', { name: lobbyTabLabel(saved), exact: true })
        ).toHaveAttribute('aria-selected', 'true');
      }
      return ownerId;
    };
    const certificateOwner = await openPreferenceLobby(page, 'original-open');
    const tabs = page.getByRole('tablist', { name: 'Game Type', exact: true });
    const original = (await tabs.getByRole('tab', { selected: true }).textContent())!.trim();
    const target = ["MTT'S", 'SPINS', 'HEADS UP'].includes(original) ? 'PLO' : "MTT'S";
    let returningPage: Page | undefined;
    let returningReady = false;
    const failures: unknown[] = [];
    let returningDiagnostics: ReturnType<typeof observeCashierFailure> | undefined;
    try {
      proofFor(page).phase('target-save');
      await selectLobbyPreference(page, CLUB_ID, target, certificateOwner, proofFor(page));
      // A new document has no mounted filter state or tab session cache.
      // Reusing the old document raced its legitimate chunk recovery with
      // goto(), which aborted that recovery and the requested navigation.
      returningPage = await page.context().newPage();
      returningDiagnostics = observeCashierFailure(returningPage);
      await openPreferenceLobby(returningPage, 'cold-return');
      returningReady = true;
      await expect(
        returningPage
          .getByRole('tablist', { name: 'Game Type', exact: true })
          .getByRole('tab', { name: target, exact: true })
      ).toHaveAttribute('aria-selected', 'true');
    } catch (error) {
      failures.push(error);
      if (returningDiagnostics)
        await testInfo.attach('cold-return-network-diagnostics', {
          body: Buffer.from(JSON.stringify(returningDiagnostics.snapshot())),
          contentType: 'application/json',
        });
    } finally {
      // This is the isolated certificate account; restore its original view
      // on the ready document before closing it, then independently read it
      // from another document. Only a failed cold open falls back to the old
      // page. Neither a failed journey nor failed restoration is concealed.
      try {
        await restoreLobbyPreference({
          originalPage: page,
          returningPage,
          returningReady,
          clubId: CLUB_ID,
          original,
          ownerId: certificateOwner,
          proofFor,
          verify: async () => {
            const restoredPage = await page.context().newPage();
            try {
              await openPreferenceLobby(restoredPage, 'restored-readback');
              await expect(
                restoredPage
                  .getByRole('tablist', { name: 'Game Type', exact: true })
                  .getByRole('tab', { name: original, exact: true })
              ).toHaveAttribute('aria-selected', 'true');
            } finally {
              await restoredPage.close();
            }
          },
        });
      } catch (cleanupError) {
        failures.push(cleanupError);
        if (returningDiagnostics)
          await testInfo.attach('cold-return-restoration-network-diagnostics', {
            body: Buffer.from(JSON.stringify(returningDiagnostics.snapshot())),
            contentType: 'application/json',
          });
      } finally {
        returningDiagnostics?.stop();
      }
    }
    if (failures.length > 1)
      throw new AggregateError(failures, 'Cold return and preference restoration failed');
    if (failures.length === 1) throw failures[0];
  });

  test('MY WALLETS lives in Cashier and keeps its count centred and unclipped', async ({
    page,
  }) => {
    await openLobby(page);
    await expect(page.locator('.lobby-wallets-trigger')).toHaveCount(0);
    await page.getByRole('link', { name: 'Cashier', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Cashier', exact: true })).toBeVisible();
    const small = page.locator('.cashier-my-wallets .lobby-wallets-trigger__copy small');

    /* The number the viewer's role decides, in the wallet's own words. Not a
       placeholder, and not the empty bay that a wiped count leaves behind. */
    await expect(small).toHaveText(/^\d+ Balances?$/, { timeout: 20_000 });
    const printed = await small.textContent();

    /* ...and there is still a count once every balance has had time to load.
       The 2026-09-10 defect was a count published and then taken back; a
       single read at the right instant would have passed. The NUMBER may
       legitimately move in that window (the live role arriving adds a row to
       a cached one); the bay going empty may not. */
    await page.waitForTimeout(4_000);
    expect(await small.textContent(), 'the count was taken back after it printed').toMatch(
      /^\d+ Balances?$/
    );

    const m = await page.evaluate((titleCentrePct) => {
      const btn = document.querySelector('.lobby-wallets-trigger')!;
      const el = btn.querySelector('small')!;
      const range = document.createRange();
      range.selectNodeContents(el);
      const b = btn.getBoundingClientRect();
      const z = el.getBoundingClientRect();
      const t = range.getBoundingClientRect();
      return {
        clipped: t.width > z.width + 0.5,
        offCentreByPct: Math.abs(
          ((t.left + t.width / 2 - b.left) / b.width) * 100 - titleCentrePct
        ),
      };
    }, TITLE_CENTRE_PCT);
    expect(m.clipped, `${printed} is clipped at the plate's edge`).toBe(false);
    expect(m.offCentreByPct, `${printed} is off the painted title's centre`).toBeLessThan(1);
    const wallets = page.getByRole('region', { name: 'My Wallets', exact: true });
    const trigger = wallets.getByRole('button', { name: /^My Wallets/i });
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(
      wallets.getByRole('region', { name: 'Wallet Balances', exact: true })
    ).toBeVisible();
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(
      wallets.getByRole('region', { name: 'Wallet Balances', exact: true })
    ).toBeHidden();
  });

  test('Create, Find and Join lead the arena with no Play Poker plate', async ({ page }) => {
    await openLobby(page);
    await page.goto('./', { waitUntil: 'domcontentloaded' });
    const actions = page.getByRole('navigation', { name: 'Poker Arena Actions', exact: true });
    await expect(actions).toBeVisible({ timeout: 45_000 });
    await expect(page.getByRole('button', { name: /^Play Poker In / })).toHaveCount(0);
    await expect(page.getByText('Club Options', { exact: true })).toHaveCount(0);
  });

  test('compact rows open details and filters stay at their original position', async ({
    page,
  }, testInfo) => {
    await openLobby(page);
    await openLobbyGameSection(page, 'ALL');
    const allGames = page.getByRole('tab', { name: 'ALL', exact: true });
    await allGames.click();
    await expect(allGames).toHaveAttribute('aria-selected', 'true');
    const row = page.getByTestId('lobby-game-row').first();
    await expect(row).toBeVisible({ timeout: 45_000 });
    await expect(page.locator('.compact-lobby')).toBeVisible();
    await expect(page.locator('.ad-rotator--lobby-strip')).toHaveCount(0);
    const rowLayout = await page.locator('.compact-lobby').evaluate((table) => {
      const header = table.querySelector('thead th:nth-child(3)')!;
      const center = (el: Element) => {
        const box = el.getBoundingClientRect();
        return box.left + box.width / 2;
      };
      return {
        players: [...table.querySelectorAll('.lt-seats__num, .lt-seats__tables')].map((el) =>
          Math.abs(center(el) - center(header))
        ),
        detailsWrap: [...table.querySelectorAll('.compact-lobby__meta')].every(
          (el) => getComputedStyle(el).whiteSpace === 'normal'
        ),
      };
    });
    expect(rowLayout.players.length).toBeGreaterThan(0);
    expect(rowLayout.players.every((offset) => offset <= 1)).toBe(true);
    expect(rowLayout.detailsWrap).toBe(true);
    await expect(page.locator('.lobby-refinements')).toBeVisible();
    await expect(page.locator('.lobby-sortbar')).toBeHidden();
    const deck = page.locator('.club-lobby-command-top__controls');
    await expect(deck).toHaveCSS('position', 'relative');
    await page.evaluate(() => window.scrollTo(0, 0));
    const home = await deck.evaluate((el) => el.getBoundingClientRect().top);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.evaluate(() => window.scrollBy(0, -64));
    await expect
      .poll(() => deck.evaluate((el) => el.getBoundingClientRect().bottom))
      .toBeLessThan(0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect
      .poll(() => deck.evaluate((el) => el.getBoundingClientRect().top))
      .toBeCloseTo(home, 0);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
      .toBeLessThanOrEqual(1);
    const cash = page.locator('[data-testid="lobby-game-row"][data-kind="cash"]').first();
    await expect(cash).toBeVisible();
    await cash.getByRole('button', { name: /^Details:/ }).click();
    await expect(page.getByRole('dialog').locator('.arena-game-card')).toBeVisible();
    await page.getByRole('button', { name: 'Close Game Lobby', exact: true }).click();
    await expect(page.getByRole('dialog').locator('.arena-game-card')).toHaveCount(0);

    const cashDoor = page.getByRole('button', { name: 'Cash Games', exact: true });
    const tournamentDoor = page.getByRole('button', { name: 'Tournaments', exact: true });
    await tournamentDoor.click();
    await expect(tournamentDoor).toHaveAttribute('aria-expanded', 'true');
    await expect(cashDoor).toHaveAttribute('aria-expanded', 'false');
    const gameTypes = page.getByRole('tablist', { name: 'Game Type', exact: true });
    await expect(gameTypes.getByRole('tab')).toHaveText([
      "MTT'S",
      'SPINS',
      "SIT N GO'S",
      'SATELLITES',
    ]);
    await gameTypes.getByRole('tab', { name: "MTT'S", exact: true }).click();
    await expect(gameTypes.getByRole('tab', { name: "MTT'S", exact: true })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await page.evaluate(() => document.fonts.ready);
    const labels = page.locator('#lobby-game-section-controls .lobby-filter-label__text');
    expect(await labels.count()).toBeGreaterThanOrEqual(4);
    for (const label of await labels.all()) {
      const fits = await label.evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const ink = range.getBoundingClientRect();
        const face = el.parentElement!.getBoundingClientRect();
        return (
          ink.left >= face.left - 1 &&
          ink.right <= face.right + 1 &&
          ink.top >= face.top - 1 &&
          ink.bottom <= face.bottom + 1
        );
      });
      expect(fits, `${await label.textContent()} must fit its painted face`).toBe(true);
    }
    await testInfo.attach('live-tournament-filters.png', {
      body: await page.locator('.lobby-controls').screenshot(),
      contentType: 'image/png',
    });
    await tournamentDoor.click();
    await expect(gameTypes).toHaveCount(0);
    await cashDoor.click();
    await expect(cashDoor).toHaveAttribute('aria-expanded', 'true');
    await expect(gameTypes.getByRole('tab')).toHaveText(['ALL', 'NLH', 'PLO', 'LIMIT']);
    await testInfo.attach('live-cash-filters.png', {
      body: await page.locator('.lobby-controls').screenshot(),
      contentType: 'image/png',
    });
    await cashDoor.click();
    await expect(cashDoor).toHaveAttribute('aria-expanded', 'false');
    await expect(tournamentDoor).toHaveAttribute('aria-expanded', 'false');
    await expect(gameTypes).toHaveCount(0);
  });

  test('tournament Details stays inside the spectator table lobby tab', async ({
    page,
  }, testInfo) => {
    test.skip(
      !process.env.SP_EMAIL || !process.env.SP_PASS,
      'The embedded lobby journey requires the isolated production certificate account.'
    );
    expect(
      /^ca-customization-cert-.*@example\.invalid$/.test(process.env.SP_EMAIL || ''),
      'This read-only journey may use only the reserved certificate identity'
    ).toBe(true);
    // Use this group's existing 120-second budget: navigation only, with no
    // additional natural-hand observation or participation phase.
    const participation: string[] = [];
    const routeTrace: string[] = [];
    let tableUrl = '';
    let tournamentId: string | null = null;
    const forbidden =
      /\/(?:action|leave|post-bb|rabbit-hunt|rest\/v1\/(?:table_seats|tournament_players|wallet_transactions|rpc\/(?:fn_cash_game_join|atomic_table_buyin|fn_lightning_join|fn_lightning_buy_in|fn_take_seat_and_buy_in|fn_register_for_tournament|fn_unregister_from_tournament|fn_leave_seat_and_refund|atomic_table_rebuy|process_tournament_rebuy|fn_join_waitlist)))(?:[/?#]|$)/;
    // Refuse an unintended participation request before it can move a seat or
    // chips. The assertion below makes every attempted write a failure.
    await page.route(forbidden, async (route) => {
      const request = route.request();
      if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.continue();
      participation.push(`${request.method()} ${new URL(request.url()).pathname}`);
      await route.abort('blockedbyclient');
    });
    const observeRoute = (frame: Frame) => {
      if (frame === page.mainFrame()) routeTrace.push(frame.url());
    };
    try {
      await openLobby(page);
      await openLobbyGameSection(page, 'ALL');
      await page.getByRole('tab', { name: 'ALL', exact: true }).click();
      const cash = page.locator(`${CASH_TABLE_CARD_SELECTOR}:visible`).first();
      await expect(cash, 'the certificate club has a live cash game to view').toBeVisible({
        timeout: 20_000,
      });
      await cash.getByRole('button', { name: /^Details:/ }).click();
      const panel = page.getByRole('dialog').filter({ has: page.locator('.arena-game-card') });
      await expect(panel).toHaveCount(1);
      // View is observation. Never press Join, a seat, a registration control,
      // or a quick-join game tile anywhere in this journey.
      await panel.getByRole('button', { name: CASH_SPECTATOR_ACTION }).click();
      await expect(page).toHaveURL(/\/table\/[0-9a-f-]{36}(?:[?#]|$)/i, { timeout: 20_000 });
      const actionBar = page.locator('.table-tab-bar:visible').first();
      await expect(actionBar).toBeVisible({ timeout: 20_000 });
      await actionBar.getByRole('button', { name: 'Open Another Table', exact: true }).click();
      await page
        .getByRole('dialog', { name: 'Quick Join', exact: true })
        .getByRole('button', { name: 'Browse Full Lobby', exact: true })
        .click();
      const lobby = page.locator('.multi-table-page__lobby-tab .club-home:visible');
      await expect(lobby).toBeVisible({ timeout: 30_000 });
      await openLobbyGameSection(lobby, 'MTT');
      await lobby.getByRole('tab', { name: "MTT'S", exact: true }).click();
      const tournament = lobby
        .locator('[data-testid="lobby-game-row"][data-kind="mtt"]:visible')
        .first();
      await expect(tournament, 'the certificate club lists a tournament to read').toBeVisible({
        timeout: 20_000,
      });
      tournamentId = await tournament.getAttribute('data-id');
      expect(tournamentId).toMatch(/^[0-9a-f-]{36}$/i);
      await tournament.getByRole('button', { name: /^Details:/ }).click();
      await expect(panel).toHaveCount(1);
      tableUrl = page.url();
      expect(new URL(tableUrl).pathname).toMatch(/\/table\/[0-9a-f-]{36}$/i);
      // The app can recover a wrong /tournaments route through its backstop.
      // Observe every native same-document navigation so a final restored URL
      // cannot hide the route departure this source repair prevents.
      routeTrace.push(tableUrl);
      page.on('framenavigated', observeRoute);
      await panel.getByRole('button', { name: 'Details', exact: true }).click();
      await expect(page.locator('.tournament-details[data-lobby-tab="true"]:visible')).toBeVisible({
        timeout: 20_000,
      });
      await expect(actionBar).toBeVisible();
      const lobbyTab = actionBar.locator('[data-tabid^="lobby:"]');
      await expect(lobbyTab).toHaveCount(1);
      await expect(lobbyTab).toHaveAttribute('aria-current', 'true');
      // The former restore only stole focus when the remembered table index
      // was greater than zero. Put that observer behind the active lobby
      // through the real tab menu so this case exercises that exact branch.
      const lobbyId = await lobbyTab.getAttribute('data-tabid');
      const observerId = new URL(tableUrl).pathname.split('/').pop()!;
      await lobbyTab.click({ button: 'right', noWaitAfter: true });
      await page
        .getByRole('button', { name: 'Move Left', exact: true })
        .click({ noWaitAfter: true });
      await expect(actionBar.locator('[data-tabid]').nth(0)).toHaveAttribute(
        'data-tabid',
        lobbyId!
      );
      await expect(actionBar.locator('[data-tabid]').nth(1)).toHaveAttribute(
        'data-tabid',
        observerId
      );
      await expect(lobbyTab).toHaveAttribute('aria-current', 'true');
      const ownerId = await readLobbyPreferenceOwner(page);
      const seatRefresh = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          response.request().method() === 'GET' &&
          url.pathname.endsWith('/table_seats') &&
          url.searchParams.get('select') === 'table_id' &&
          url.searchParams.get('user_id') === `eq.${ownerId}`
        );
      });
      // Exercise the real visibility recovery read, without a seat or purchase.
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      const refreshed = await seatRefresh;
      expect(refreshed.ok(), 'the owned seat refresh failed').toBe(true);
      expect(await refreshed.json(), 'the certificate identity must stay an observer').toEqual([]);
      // The former focus theft ran 250ms after this authoritative response.
      // Observe past that known deadline, then require the same details page.
      await page.waitForTimeout(500);
      await expect(lobbyTab).toHaveAttribute('aria-current', 'true');
      await expect(
        page.locator('.tournament-details[data-lobby-tab="true"]:visible')
      ).toBeVisible();
      await testInfo.attach('plus-page-after-seat-refresh', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
      expect(page.url()).toBe(tableUrl);
      expect(
        routeTrace.every((url) => url === tableUrl),
        'Details left the running table route'
      ).toBe(true);
      // Only the player's explicit Close Lobby gesture removes this page.
      await lobbyTab.click({ button: 'right', noWaitAfter: true });
      await page
        .getByRole('button', { name: 'Close Lobby', exact: true })
        .click({ noWaitAfter: true });
      await expect(actionBar.locator('[data-tabid^="lobby:"]')).toHaveCount(0);
      await expect(actionBar.locator(`[data-tabid="${observerId}"]`)).toHaveAttribute(
        'aria-current',
        'true'
      );
      expect(page.url()).toBe(tableUrl);
      expect(
        routeTrace.every((url) => url === tableUrl),
        'Closing The Lobby Left The Running Table Route'
      ).toBe(true);
      expect(participation, 'spectator navigation attempted participation').toEqual([]);
    } finally {
      page.off('framenavigated', observeRoute);
      await testInfo.attach('embedded-tournament-details-route.json', {
        body: Buffer.from(JSON.stringify({ tableUrl, tournamentId, routeTrace, participation })),
        contentType: 'application/json',
      });
      // Keep the participation refusal installed through page teardown.
    }
  });

  test('tournament favorites stay below current pins across sorting and reload', async ({
    page,
  }, testInfo) => {
    // Run 41272366052 completed all five format captures and the four favorite
    // phases, then exhausted the shared 120s budget during final evidence.
    // Keep each readiness/assertion deadline and zero retries unchanged.
    test.setTimeout(180_000);
    expect(
      /^ca-customization-cert-.*@example\.invalid$/.test(process.env.SP_EMAIL || ''),
      'Favorite proof requires its owned isolated production account'
    ).toBe(true);
    const preferenceKey = 'lobby-tournament-favorites:global';
    const participation: string[] = [];
    await page.route(
      /\/(?:action|leave|post-bb|rabbit-hunt|buyin|addchips|rebuy|cashout|sitout|seat-move|seat-change|rest\/v1\/(?:table_seats|tournament_players|wallet_transactions|rpc\/(?:fn_cash_game_join|atomic_table_buyin|fn_lightning_join|fn_lightning_buy_in|fn_take_seat_and_buy_in|fn_register_for_tournament|fn_unregister_from_tournament|fn_leave_seat_and_refund|atomic_table_rebuy|process_tournament_rebuy|fn_join_waitlist)))(?:[/?#]|$)/,
      async (route) => {
        if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.continue();
        participation.push(new URL(route.request().url()).pathname);
        await route.abort('blockedbyclient');
      }
    );
    const isPreferenceRead = (response: import('@playwright/test').Response) => {
      const url = new URL(response.url());
      return (
        url.pathname.endsWith('/user_page_preferences') &&
        response.request().method() === 'GET' &&
        response.ok() &&
        url.searchParams.get('preference_key') === `eq.${preferenceKey}`
      );
    };
    const initialRead = page.waitForResponse(isPreferenceRead);
    await openLobby(page);
    const owner = await readLobbyPreferenceOwner(page);
    const firstRead = await initialRead;
    expect(new URL(firstRead.url()).searchParams.get('user_id')).toBe(`eq.${owner}`);
    const initial = await firstRead.json();
    expect(initial?.value ?? initial?.[0]?.value ?? []).toEqual([]);
    expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe(
      'America/Chicago'
    );
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    // Native body glass, including actual text ranges rather than wrapper boxes.
    const bodyInkFits = (elements: Element[]) =>
      elements
        .flatMap((row) => {
          const box = row.getBoundingClientRect();
          const insetTop = box.top + box.width * 0.003;
          const insetBottom = box.top + box.width * 0.102;
          return [...row.querySelectorAll('td:first-child,td[data-label="Buy-In"]')].flatMap(
            (cell) => {
              const ink: DOMRect[] = [];
              const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
              while (walker.nextNode()) {
                const node = walker.currentNode;
                const parent = node.parentElement;
                if (
                  !node.textContent?.trim() ||
                  !parent ||
                  parent.closest('.lt-fav,[aria-hidden="true"]') ||
                  !parent.getBoundingClientRect().width ||
                  getComputedStyle(parent).visibility === 'hidden'
                )
                  continue;
                const range = document.createRange();
                range.selectNodeContents(node);
                ink.push(...[...range.getClientRects()].filter((rect) => rect.width > 0));
              }
              return ink.map((rect) => rect.top >= insetTop - 1 && rect.bottom <= insetBottom + 1);
            }
          );
        })
        .every(Boolean);
    const appearance: unknown[] = [];
    for (const [family, tab, mode] of [
      ['ALL', 'PLO', 'cash'],
      ['MTT', 'SPINS', 'spins'],
      ['MTT', "SIT N GO'S", 'sng'],
      ['MTT', 'SATELLITES', 'satellites'],
      ['MTT', "MTT'S", 'mtt'],
    ]) {
      await openLobbyGameSection(page, family);
      const selectedTab = page.getByRole('tab', { name: tab, exact: true });
      await selectedTab.click();
      await expect(selectedTab).toHaveAttribute('aria-selected', 'true');
      const format =
        mode === 'satellites'
          ? '[data-kind="mtt"].is-satellite'
          : mode === 'mtt'
            ? '[data-kind="mtt"]:not(.is-satellite)'
            : `[data-kind="${mode === 'spins' ? 'spin' : mode}"]`;
      const currentRows = page.locator(`[data-testid="lobby-game-row"][data-id]${format}:visible`);
      await expect(currentRows.first()).toBeVisible({ timeout: 30_000 });
      const sampleRow =
        mode === 'cash'
          ? page
              .locator(
                '[data-testid="lobby-game-row"][data-id][data-kind="cash"][data-lightning-format="true"]:visible'
              )
              .first()
          : currentRows.first();
      await expect(sampleRow).toBeVisible({ timeout: 30_000 });
      await expect(
        sampleRow.getByRole('button', { name: 'Add To Favorites', exact: true })
      ).toBeVisible();
      const id = await sampleRow.getAttribute('data-id');
      const heading = page.locator(`[data-game-heading="${id}"]:visible`);
      await expect(heading.locator('.lt-tournament-heading__name')).toBeVisible();
      await expect
        .poll(() =>
          heading.evaluate((element) => {
            const zone = element.querySelector('.lt-tournament-heading__name') as HTMLElement;
            const title = zone.firstElementChild as HTMLElement;
            const plate = element.querySelector('.lt-tournament-heading__guarantee')!;
            const headBox = element.getBoundingClientRect();
            const plateBox = plate.getBoundingClientRect();
            const centeredPlate =
              Math.abs((plateBox.left + plateBox.width / 2 - headBox.left) / headBox.width - 0.8) <
                0.004 &&
              Math.abs((plateBox.top + plateBox.height / 2 - headBox.top) / headBox.width - 0.081) <
                0.004;
            return (
              centeredPlate &&
              title.scrollHeight <= zone.clientHeight + 1 &&
              Math.abs(
                parseFloat(getComputedStyle(title).fontSize) -
                  parseFloat(getComputedStyle(plate).fontSize)
              ) < 0.1
            );
          })
        )
        .toBe(true);
      const paint = await heading.evaluate(async (element) => {
        const overlayDisplay = getComputedStyle(element, '::after').display;
        if (element.matches('.is-featured') && overlayDisplay !== 'none')
          throw new Error('A format rail is covering the featured red perimeter');
        const backgrounds = [
          getComputedStyle(element, '::before').backgroundImage,
          getComputedStyle(element.querySelector('.lt-tournament-icon,.lt-lightning-icon')!)
            .backgroundImage,
        ];
        for (const background of backgrounds) {
          const url = /url\(["']?(.*?)["']?\)/.exec(background)?.[1];
          if (!url) throw new Error('Premium chassis or format art is absent');
          const image = new Image();
          image.src = url;
          await image.decode();
          if (!image.naturalWidth || !image.naturalHeight)
            throw new Error('Premium art did not load');
        }
        return {
          heading: element.textContent,
          backgrounds,
          overlayDisplay,
          icon: element
            .querySelector('[data-tournament-icon]')
            ?.getAttribute('data-tournament-icon'),
          filter: getComputedStyle(element, '::before').filter,
        };
      });
      if (mode === 'cash') {
        expect(paint.icon).toBe('lightning');
        expect(paint.filter).toContain('grayscale(1)');
        expect(await sampleRow.evaluate((e) => getComputedStyle(e, '::before').filter)).toContain(
          'grayscale(1)'
        );
        await expect
          .poll(() =>
            currentRows.evaluateAll((elements) =>
              elements.every((row) => {
                const value = row.querySelector(
                  '[data-label="Stakes"] .premium-cash-stakes-value'
                ) as HTMLElement | null;
                if (!value) return false;
                const well = value.parentElement!;
                return (
                  value.scrollWidth <= well.clientWidth + 1 &&
                  value.scrollHeight <= well.clientHeight + 1
                );
              })
            )
          )
          .toBe(true);
      }
      if (mode === 'mtt' || mode === 'satellites') {
        expect(paint.backgrounds[1]).toContain('chrome-arena-emblems-v2/');
      }
      const readableCopy = await sampleRow.evaluate((row) =>
        [
          ...row.querySelectorAll(
            '.premium-cash-style,.lt-name__meta,.lt-name__table,.compact-lobby__meta'
          ),
        ]
          .filter((element) => (element as HTMLElement).offsetWidth > 0)
          .map((element) => ({
            text: element.textContent,
            size: parseFloat(getComputedStyle(element).fontSize),
          }))
      );
      expect(readableCopy.every((copy) => copy.size >= 12)).toBe(true);
      await expect
        .poll(() =>
          currentRows.evaluateAll((elements) =>
            elements.every((row) => {
              const value = row.querySelector(
                '[data-label="Buy-In"] .premium-cash-stakes-value'
              ) as HTMLElement | null;
              if (!value) return true;
              const well = value.parentElement!;
              const valueBox = value.getBoundingClientRect();
              const wellBox = well.getBoundingClientRect();
              return (
                value.scrollWidth <= well.clientWidth + 1 &&
                Math.abs(valueBox.left + valueBox.width / 2 - wellBox.left - wellBox.width / 2) < 1
              );
            })
          )
        )
        .toBe(true);
      await expect.poll(() => currentRows.evaluateAll(bodyInkFits)).toBe(true);
      appearance.push({ mode, ...paint });
      await sampleRow.scrollIntoViewIfNeeded();
      await expect(sampleRow).toBeInViewport();
      await expect(heading).toBeInViewport();
      await testInfo.attach(`chrome-arena-${mode}-phone.png`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
      if (mode === 'cash') {
        await page.setViewportSize({ width: 1280, height: 900 });
        const wideCashRows = page.locator(
          '.lobby-table [data-testid="lobby-game-row"][data-kind="cash"][data-id]:visible'
        );
        await expect(wideCashRows.first()).toBeVisible();
        await expect.poll(() => wideCashRows.evaluateAll(bodyInkFits)).toBe(true);
        expect(
          await wideCashRows
            .locator('.premium-cash-style')
            .evaluateAll((elements) =>
              elements.every((element) => parseFloat(getComputedStyle(element).fontSize) >= 12)
            )
        ).toBe(true);
        await heading.evaluate((element) => element.scrollIntoView({ block: 'center' }));
        await testInfo.attach('chrome-arena-cash-wide.png', {
          body: await page.screenshot(),
          contentType: 'image/png',
        });
        await page.setViewportSize({ width: 390, height: 844 });
      }
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    const wideHeading = page.locator('.lobby-table tr[data-game-heading]').first();
    await wideHeading.evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await expect(wideHeading).toBeInViewport();
    expect(
      await page
        .locator('.lobby-table .lt-name__meta,.lobby-table .lt-name__phase')
        .evaluateAll((elements) =>
          elements
            .filter((element) => (element as HTMLElement).offsetWidth > 0)
            .every((element) => parseFloat(getComputedStyle(element).fontSize) >= 12)
        )
    ).toBe(true);
    await testInfo.attach('chrome-arena-mtt-wide.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await page.setViewportSize({ width: 390, height: 844 });
    const rows = page.locator('[data-testid="lobby-game-row"][data-kind="mtt"][data-id]:visible');
    const pinDates = await rows.evaluateAll((elements) =>
      elements.map((e) => ({
        id: e.getAttribute('data-id'),
        hostPinned: e.getAttribute('data-host-pinned') === 'true',
        displayedPinned: e.matches('.is-featured'),
        start: e.getAttribute('data-start-time'),
        today: new Date().toLocaleDateString('en-CA'),
        day: new Date(e.getAttribute('data-start-time') || '').toLocaleDateString('en-CA'),
      }))
    );
    expect(
      pinDates.filter((row) => row.hostPinned).length,
      'Live host-selected events are present'
    ).toBeGreaterThan(0);
    expect(
      pinDates
        .filter((row) => row.displayedPinned)
        .map((row) => row.id)
        .sort()
    ).toEqual(
      pinDates
        .filter((row) => row.hostPinned && row.start && row.day === row.today)
        .map((row) => row.id)
        .sort()
    );
    await testInfo.attach('chrome-arena-appearance.json', {
      body: Buffer.from(JSON.stringify({ appearance, pinDates })),
      contentType: 'application/json',
    });
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });
    const snapshot = () =>
      rows.evaluateAll((elements) =>
        elements.map((element) => ({
          id: element.getAttribute('data-id'),
          pinned: element.matches('[data-featured="true"],.is-featured'),
          favorite: Boolean(element.querySelector('button[aria-label="Remove From Favorites"]')),
        }))
      );
    const chooseSort = async (label: string) => {
      await page.getByRole('button', { name: 'Filters And Sort', exact: true }).click();
      const filters = page.getByRole('dialog', { name: 'Advanced Filters', exact: true });
      const choice = filters.getByRole('button', { name: label, exact: true });
      await choice.click();
      await expect(choice).toHaveAttribute('aria-pressed', 'true');
      await filters.getByRole('button', { name: 'Close Game Filters', exact: true }).click();
      await expect(filters).toBeHidden();
    };
    await chooseSort('Stakes: High To Low');
    const before = await snapshot();
    expect(before.filter((row) => row.favorite)).toEqual([]);
    const ordinary = before.filter((row) => !row.pinned);
    expect(
      ordinary.length,
      'The live schedule needs two ordinary events for promotion'
    ).toBeGreaterThan(1);
    const chosen = ordinary.at(-1)!.id!;
    expect(chosen).toMatch(/^[0-9a-f-]{36}$/i);
    // data-id belongs to the row itself, so address it directly rather than a descendant.
    const selected = () =>
      page.locator(`[data-testid="lobby-game-row"][data-id="${chosen}"]:visible`);
    const saveChoice = (enabled: boolean) =>
      page.waitForResponse((response) => {
        if (
          !response.url().includes('/rest/v1/user_page_preferences') ||
          response.request().method() !== 'POST' ||
          !response.ok()
        )
          return false;
        const body = response.request().postDataJSON();
        return (
          body?.user_id === owner &&
          body?.preference_key === preferenceKey &&
          Array.isArray(body.value) &&
          body.value.length === (enabled ? 1 : 0) &&
          body.value.includes(chosen) === enabled
        );
      });
    const phaseEvidence: Array<{ phase: string; rows: Awaited<ReturnType<typeof snapshot>> }> = [];
    const assertFavoriteTier = async (phase: string) => {
      await expect
        .poll(async () => {
          const current = await snapshot();
          const pins = current.filter((row) => row.pinned);
          const favoriteIndex = current.findIndex((row) => row.id === chosen && row.favorite);
          return (
            favoriteIndex === pins.length &&
            current.slice(0, pins.length).every((row) => row.pinned) &&
            current.slice(pins.length + 1).every((row) => !row.pinned && !row.favorite)
          );
        })
        .toBe(true);
      phaseEvidence.push({ phase, rows: await snapshot() });
    };
    const originalUrl = page.url();
    const saved = saveChoice(true);
    await selected().getByRole('button', { name: 'Add To Favorites', exact: true }).click();
    await saved;
    expect(page.url()).toBe(originalUrl);
    await assertFavoriteTier('starred');
    await chooseSort('Most Players');
    await assertFavoriteTier('players-descending');
    await chooseSort('Stakes: High To Low');
    await assertFavoriteTier('buy-in-descending');
    const readback = page.waitForResponse(
      (response) =>
        isPreferenceRead(response) &&
        new URL(response.url()).searchParams.get('user_id') === `eq.${owner}`
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    const persisted = await (await readback).json();
    expect(persisted?.value ?? persisted?.[0]?.value).toEqual([chosen]);
    await expect(selected()).toBeVisible({ timeout: 30_000 });
    await assertFavoriteTier('reloaded-server-readback');
    await selected().evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await expect(selected()).toBeInViewport();
    await testInfo.attach('tournament-favorite-starred-tier.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    const removed = saveChoice(false);
    await selected().getByRole('button', { name: 'Remove From Favorites', exact: true }).click();
    await removed;
    await expect(
      selected().getByRole('button', { name: 'Add To Favorites', exact: true })
    ).toBeVisible();
    await expect
      .poll(async () => {
        const current = await snapshot();
        return (
          current.findIndex((row) => row.id === chosen) > current.filter((row) => row.pinned).length
        );
      })
      .toBe(true);
    expect((await snapshot()).filter((row) => row.favorite)).toEqual([]);
    expect(participation).toEqual([]);
    await testInfo.attach('tournament-favorite-priority.json', {
      body: Buffer.from(
        JSON.stringify({
          chosen,
          initialFavoritesEmpty: true,
          phases: phaseEvidence,
          participation,
        })
      ),
      contentType: 'application/json',
    });
    await testInfo.attach('tournament-favorite-priority.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });

  test('the footer frame sits on the bottom edge with nothing under it', async ({ page }) => {
    await openLobby(page);
    /* Two landmarks share this name on a club lobby: the arena boundary's
       "Choose Arena" nav inside the page, and the footer. The footer is the
       one that carries the role-scoped controls. */
    const nav = page
      .getByRole('navigation', { name: 'Poker Arena' })
      .filter({ has: page.locator('[data-footer-control]') });
    await expect(nav).toHaveCount(1);
    await expect(nav).toBeVisible();
    await expect(nav).toHaveCSS('position', 'fixed');
    // Resolve the approved role-specific artwork before measuring. The live
    // list can reflow between Playwright calls, so visibility, the actual end
    // and painted-frame geometry must be read together in one browser turn.
    const doors = nav.locator('[data-footer-doors]');
    await expect(doors).toHaveCount(1);
    await expect(doors).toHaveAttribute('data-footer-doors', /^(member|operator)$/);
    const kind = await doors.getAttribute('data-footer-doors');
    const baseFrame =
      kind === 'member' ? 'club-arena-footer-player-v3.webp' : 'club-arena-footer-v5.webp';
    const artwork = doors.locator('..');
    await expect(artwork).toHaveCount(1);
    await expect(artwork.locator(`picture > img[src$="/${baseFrame}"]`)).toHaveCount(1);
    await expect
      .poll(
        () =>
          nav.evaluate((bar) => {
            const root = document.documentElement;
            window.scrollTo(0, root.scrollHeight);
            const atEnd = window.scrollY >= root.scrollHeight - window.innerHeight - 1;
            const shown = bar.getAttribute('data-footer-hidden') === 'false';
            const frame = bar.querySelector('[data-footer-doors]')?.parentElement;
            if (!atEnd || !shown || !frame) return Number.POSITIVE_INFINITY;
            const probe = document.createElement('div');
            probe.style.cssText =
              'position:fixed;bottom:0;left:0;width:1px;height:1px;pointer-events:none';
            document.body.appendChild(probe);
            const edge = probe.getBoundingClientRect().bottom;
            const painted = frame.getBoundingClientRect();
            probe.remove();
            return Math.abs(painted.bottom - edge);
          }),
        {
          message:
            'visible painted footer frame touches the bottom edge at the actual end of the lobby',
          timeout: 10_000,
          intervals: [300, 300, 500, 1_000],
        }
      )
      .toBeLessThan(1);
  });
  test('player preferences save automatically and survive reload and reconnect', async ({
    page,
  }) => {
    await page.goto('settings', { waitUntil: 'domcontentloaded' });
    const volume = page.getByRole('slider', { name: 'Sound Volume', exact: true });
    await expect(volume).toBeVisible({ timeout: 30_000 });
    const original = await volume.inputValue();
    const chosen = original === '23' ? '24' : '23';
    const save = page.waitForResponse(
      (response) =>
        response.url().includes('/rpc/fn_patch_account_settings') &&
        response.ok() &&
        response.request().postDataJSON()?.p_settings_patch?.soundVolume === Number(chosen)
    );
    await volume.evaluate((input: HTMLInputElement, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, chosen);
    await save;
    await expect(page.getByText('All Visible Controls Are Saved.', { exact: true })).toBeVisible();
    try {
      await page.context().setOffline(true);
      await expect(volume).toHaveValue(chosen);
    } finally {
      await page.context().setOffline(false);
    }
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(volume).toHaveValue(chosen, { timeout: 30_000 });
    const restore = page.waitForResponse(
      (response) =>
        response.url().includes('/rpc/fn_patch_account_settings') &&
        response.ok() &&
        response.request().postDataJSON()?.p_settings_patch?.soundVolume === Number(original)
    );
    await volume.evaluate((input: HTMLInputElement, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, original);
    await restore;

    await page.goto('notifications', { waitUntil: 'domcontentloaded' });
    const unread = page
      .getByRole('group', { name: 'Filter Notifications' })
      .getByRole('button', { name: /^Unread/ });
    await expect(unread).toBeVisible({ timeout: 30_000 });
    const preferenceOwner = await readLobbyPreferenceOwner(page);
    const preferenceKey = 'NotificationsPage:filter:global';
    const filterSaved = page.waitForResponse(
      (response) =>
        response.url().includes('/rest/v1/user_page_preferences') &&
        response.request().method() === 'POST' &&
        response.ok() &&
        response.request().postDataJSON()?.user_id === preferenceOwner &&
        response.request().postDataJSON()?.preference_key === preferenceKey &&
        response.request().postDataJSON()?.value === 'unread'
    );
    await unread.click();
    await filterSaved;
    const readback = page.waitForResponse(
      (response) =>
        response.url().includes('/rest/v1/user_page_preferences') &&
        response.request().method() === 'GET' &&
        new URL(response.url()).searchParams.get('user_id') === `eq.${preferenceOwner}` &&
        new URL(response.url()).searchParams.get('preference_key') === `eq.${preferenceKey}` &&
        response.ok()
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    const row = await (await readback).json();
    expect(row?.value ?? row?.[0]?.value).toBe('unread');
    await expect(unread).toHaveAttribute('aria-pressed', 'true');

    const all = page
      .getByRole('group', { name: 'Filter Notifications' })
      .getByRole('button', { name: /^All/ });
    const intentKey = `ca_table_setting_intent:${preferenceOwner}:page:${preferenceKey}`;
    const recovered = page.waitForResponse(
      (response) =>
        response.url().includes('/rest/v1/user_page_preferences') &&
        response.request().method() === 'POST' &&
        response.ok() &&
        response.request().postDataJSON()?.user_id === preferenceOwner &&
        response.request().postDataJSON()?.preference_key === preferenceKey &&
        response.request().postDataJSON()?.value === 'all'
    );
    try {
      await page.context().setOffline(true);
      const offlineStarted = await page.evaluate(() => performance.now());
      await all.click();
      await expect(all).toHaveAttribute('aria-pressed', 'true');
      // Known-offline browsers need not emit a failed HTTP request. The actual
      // contract is a durable choice, then its owned save on reconnect.
      await expect
        .poll(() =>
          page.evaluate((key) => {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw)?.value : null;
          }, intentKey)
        )
        .toBe('all');
      // Stay offline beyond the existing 500ms save debounce so this proves
      // reconnect continuation rather than an ordinary timer firing online.
      await expect
        .poll(() =>
          page.evaluate(
            (started) => navigator.onLine === false && performance.now() - started >= 600,
            offlineStarted
          )
        )
        .toBe(true);
      await expect(all).toHaveAttribute('aria-pressed', 'true');
    } finally {
      await page.context().setOffline(false);
    }
    await recovered;
    await expect(all).toHaveAttribute('aria-pressed', 'true');
    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), intentKey))
      .toBeNull();
    const recoveredReadback = page.waitForResponse(
      (response) =>
        response.url().includes('/rest/v1/user_page_preferences') &&
        response.request().method() === 'GET' &&
        new URL(response.url()).searchParams.get('user_id') === `eq.${preferenceOwner}` &&
        new URL(response.url()).searchParams.get('preference_key') === `eq.${preferenceKey}` &&
        response.ok()
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    const recoveredRow = await (await recoveredReadback).json();
    expect(recoveredRow?.value ?? recoveredRow?.[0]?.value).toBe('all');
    await expect(all).toHaveAttribute('aria-pressed', 'true');
  });
});

const preferenceLifecycleTest = test.extend<{ preferenceAccount: TemporaryCustomizationAccount }>({
  preferenceAccount: [
    async ({ baseURL }, provide, testInfo) => {
      if (!baseURL) throw new Error('Configured BASE_URL required');
      const environment = requireCustomizationCertificationEnvironment();
      const account = await createTemporaryCustomizationAccount(
        environment,
        'preferences-lifecycle',
        0
      );
      try {
        await testInfo.attach('preference-account-owner.json', {
          body: Buffer.from(JSON.stringify({ ownerId: account.id })),
          contentType: 'application/json',
        });
        await provide(account);
      } finally {
        // The test SDK auth lock stalled a prior teardown. A fresh anonymous
        // client lets the original guarded cleanup retire this owner's sessions.
        const cleanupClient = createClient(environment.supabaseUrl, environment.publishableKey, {
          auth: {
            storageKey: `preference-cleanup:${account.id}`,
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
        });
        await cleanupTemporaryCustomizationAccount(environment, {
          ...account,
          client: cleanupClient,
        });
        await testInfo.attach('preference-account-cleanup.json', {
          body: Buffer.from(JSON.stringify({ ownerId: account.id, cleanupVerified: true })),
          contentType: 'application/json',
        });
      }
    },
    // The guarded cleanup can wait on a real freeze; preserve its existing allowance.
    { timeout: 120_000 + CLEANUP_FREEZE_ALLOWANCE_MS },
  ],
  page: [
    async ({ browser, baseURL, preferenceAccount }, provide, testInfo) => {
      if (!baseURL) throw new Error('Configured BASE_URL required');
      const owned = await openFreshPreferenceDevice(browser, baseURL, preferenceAccount);
      // Own contexts do not inherit global setup's passive navigation observer.
      // Retain evidence for this original attempt without another navigation.
      const observation = observeSetupFailure(
        owned.page,
        baseURL,
        process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
      );
      try {
        try {
          await owned.page.goto('settings', { waitUntil: 'domcontentloaded' });
          observation.stage('terms');
          await ensureAcceptedTerms(owned.page);
          observation.stage('profile');
          await ensurePlayableProfile(owned.page);
          await acknowledgePreferenceWelcome(owned.page);
        } catch (error) {
          try {
            await testInfo.attach('owned-preference-setup-failure.json', {
              contentType: 'application/json',
              body: Buffer.from(JSON.stringify(observation.snapshot())),
            });
          } catch (attachmentError) {
            throw new AggregateError(
              [error, attachmentError],
              'Preference setup and evidence attachment failed.'
            );
          }
          throw error;
        }
        observation.dispose();
        await provide(owned.page);
      } finally {
        observation.dispose();
        await owned.context.close();
      }
    },
    { timeout: 120_000 },
  ],
});

preferenceLifecycleTest.describe('owned preference lifecycle', () => {
  preferenceLifecycleTest.describe.configure({ timeout: 300_000 });
  preferenceLifecycleTest(
    'all visible settings and category filters survive UI logout and a fresh device',
    async ({ page, preferenceAccount }, testInfo) => {
      test.setTimeout(300_000);
      await page.goto('settings', { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('checkbox', { name: 'Sound Effects', exact: true })).toBeVisible({
        timeout: 30_000,
      });
      const controls: Record<string, boolean | string> = {};
      const settingKeys: Record<string, string> = {
        'Sound Effects': 'soundEnabled',
        'Four-Color Deck': 'fourColorDeck',
        'Announcement Ticker': 'showTicker',
        'Show Pot Odds': 'showPotOdds',
        'Tournament Reminders': 'tournamentReminders',
        'Club Activity': 'clubActivity',
        'Achievement Unlocked': 'achievementNotifications',
        'Friend Alerts': 'friendAlerts',
        'Settlement Alerts': 'settlementAlerts',
        'Share Usage Analytics': 'shareAnalytics',
      };
      for (const checkbox of await page.getByRole('checkbox').all()) {
        if (!(await checkbox.isVisible())) continue;
        const label = await checkbox.getAttribute('aria-label');
        if (!label || !settingKeys[label]) throw new Error('Unmapped visible Settings checkbox');
        const target = !(await checkbox.isChecked());
        const saved = page.waitForResponse(
          (response) =>
            response.url().includes('/rpc/fn_patch_account_settings') &&
            response.ok() &&
            response.request().postDataJSON()?.p_settings_patch?.[settingKeys[label]] === target,
          { timeout: 45_000 }
        );
        await checkbox.locator('..').click();
        await expect(checkbox).toBeChecked({ checked: target });
        await saved;
        controls[label] = target;
        await expect(
          page.getByText('All Visible Controls Are Saved.', { exact: true })
        ).toBeVisible();
      }
      for (const [label, value] of [
        ['Theme', 'light'],
        ['Animation Speed', 'slow'],
      ]) {
        const select = page.getByRole('combobox', { name: label, exact: true });
        const target =
          (await select.inputValue()) === value ? (label === 'Theme' ? 'dark' : 'fast') : value;
        const key = label === 'Theme' ? 'theme' : 'animationSpeed';
        const saved = page.waitForResponse(
          (response) =>
            response.url().includes('/rpc/fn_patch_account_settings') &&
            response.ok() &&
            response.request().postDataJSON()?.p_settings_patch?.[key] === target,
          { timeout: 45_000 }
        );
        await select.selectOption(target);
        await saved;
        controls[label] = target;
        await expect(
          page.getByText('All Visible Controls Are Saved.', { exact: true })
        ).toBeVisible();
      }
      await page.goto('achievements', { waitUntil: 'domcontentloaded' });
      const category = page
        .getByRole('group', { name: 'Achievement Category' })
        .getByRole('button', { name: /^Social \(/ });
      await category.click();
      await expect(category).toHaveAttribute('aria-pressed', 'true');
      const fresh = await logoutAndOpenFreshPreferenceDevice(
        page,
        testInfo.project.use.baseURL!,
        preferenceAccount
      );
      try {
        await expect
          .poll(async () => {
            const row = await fresh.client
              .from('user_page_preferences')
              .select('value')
              .eq('user_id', fresh.ownerId)
              .eq('preference_key', 'achievements:category:global')
              .maybeSingle();
            if (row.error) return null;
            return row.data?.value;
          })
          .toBe('social');
        const profile = await fresh.client
          .from('profiles')
          .select('settings')
          .eq('id', fresh.ownerId)
          .maybeSingle();
        expect(profile.error).toBeNull();
        for (const [label, value] of Object.entries(controls))
          expect(
            profile.data?.settings[
              settingKeys[label] || (label === 'Theme' ? 'theme' : 'animationSpeed')
            ],
            label
          ).toBe(value);
        await fresh.page.goto('settings', { waitUntil: 'domcontentloaded' });
        await acknowledgePreferenceWelcome(fresh.page);
        for (const [label, value] of Object.entries(controls)) {
          if (typeof value === 'boolean')
            await expect(
              fresh.page.getByRole('checkbox', { name: label, exact: true })
            ).toBeChecked({
              checked: value,
              timeout: 30_000,
            });
          else
            await expect(
              fresh.page.getByRole('combobox', { name: label, exact: true })
            ).toHaveValue(value, { timeout: 30_000 });
        }
        await fresh.page.goto('achievements', { waitUntil: 'domcontentloaded' });
        await expect(
          fresh.page
            .getByRole('group', { name: 'Achievement Category' })
            .getByRole('button', { name: /^Social \(/ })
        ).toHaveAttribute('aria-pressed', 'true');
        await testInfo.attach('account-settings-fresh-device-proof.json', {
          body: Buffer.from(
            JSON.stringify({
              ownerId: fresh.ownerId,
              controls,
              accountSettingsReadback: Object.fromEntries(
                Object.keys(controls).map((label) => [
                  label,
                  profile.data?.settings[
                    settingKeys[label] || (label === 'Theme' ? 'theme' : 'animationSpeed')
                  ],
                ])
              ),
              category: 'social',
              authOnlyContext: true,
              logout: 'real-ui',
              hardwareConsent: 'not requested by visible controls',
            })
          ),
          contentType: 'application/json',
        });
      } finally {
        await fresh.context.close();
      }
    }
  );

  preferenceLifecycleTest(
    'club advanced seats and Players heading survive logout and an empty-device context',
    async ({ page, preferenceAccount }, testInfo) => {
      test.setTimeout(300_000);
      await ensureClubMembership(page, testInfo.project.use.baseURL!, CLUB_ID);
      await page.goto(`clubs/${CLUB_ID}`, { waitUntil: 'domcontentloaded' });
      await prepareCashLobbyActions(page);
      await openLobbyGameSection(page, 'NLH');
      const tabs = page.getByRole('tablist', { name: 'Game Type', exact: true });
      await tabs.getByRole('tab', { name: 'NLH', exact: true }).click();
      await expect(tabs.getByRole('tab', { name: 'NLH', exact: true })).toHaveAttribute(
        'aria-selected',
        'true'
      );
      const exactUrl = page.url();
      await page.getByRole('button', { name: 'Filters And Sort', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Advanced Filters', exact: true });
      const seats = dialog.getByRole('slider', { name: 'Minimum Seats', exact: true });
      await expect(seats).toBeVisible();
      const original = await seats.inputValue();
      const chosen = original === '3' ? '4' : '3';
      const saved = page.waitForResponse(
        (response) =>
          response.url().includes('/rest/v1/user_lobby_filters') &&
          response.request().method() === 'POST' &&
          response.ok() &&
          response.request().postDataJSON()?.filters?.HOLDEM?.seatMin === Number(chosen),
        { timeout: 45_000 }
      );
      await seats.evaluate((input: HTMLInputElement, value) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
          input,
          value
        );
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, chosen);
      await saved;
      await dialog.getByRole('button', { name: 'Close Game Filters', exact: true }).click();
      const players = page
        .getByRole('columnheader', { name: /^Players/ })
        .filter({ visible: true })
        .first();
      await expect(players).toBeVisible();
      if (await players.getByRole('button').count()) await players.getByRole('button').click();
      else await players.click();
      const direction = await players.getAttribute('aria-sort');
      expect(['ascending', 'descending']).toContain(direction);
      const fresh = await logoutAndOpenFreshPreferenceDevice(
        page,
        testInfo.project.use.baseURL!,
        preferenceAccount
      );
      try {
        await expect
          .poll(async () => {
            const row = await fresh.client
              .from('user_lobby_filters')
              .select('filters')
              .eq('user_id', fresh.ownerId)
              .eq('club_id', CLUB_ID)
              .maybeSingle();
            return row.error ? null : row.data?.filters?.HOLDEM?.seatMin;
          })
          .toBe(Number(chosen));
        const sortKey = `lobby:headingSort:HOLDEM:${CLUB_ID}`;
        await expect
          .poll(async () => {
            const row = await fresh.client
              .from('user_page_preferences')
              .select('value')
              .eq('user_id', fresh.ownerId)
              .eq('preference_key', sortKey)
              .maybeSingle();
            return row.error ? null : row.data?.value;
          })
          .toEqual({
            key: 'players',
            dir: direction === 'ascending' ? 'asc' : 'desc',
            chosen: true,
          });
        await fresh.page.goto(exactUrl, { waitUntil: 'domcontentloaded' });
        await acknowledgePreferenceWelcome(fresh.page);
        await prepareCashLobbyActions(fresh.page);
        await expect(fresh.page).toHaveURL(exactUrl);
        await openLobbyGameSection(fresh.page, 'NLH');
        await expect(fresh.page.getByRole('tab', { name: 'NLH', exact: true })).toHaveAttribute(
          'aria-selected',
          'true',
          { timeout: 30_000 }
        );
        await expect(
          fresh.page
            .getByRole('columnheader', { name: /^Players/ })
            .filter({ visible: true })
            .first()
        ).toHaveAttribute('aria-sort', direction!, { timeout: 30_000 });
        await fresh.page.getByRole('button', { name: 'Filters And Sort', exact: true }).click();
        await expect(
          fresh.page
            .getByRole('dialog', { name: 'Advanced Filters', exact: true })
            .getByRole('slider', { name: 'Minimum Seats', exact: true })
        ).toHaveValue(chosen, { timeout: 30_000 });
        const filterReadback = await fresh.client
          .from('user_lobby_filters')
          .select('filters')
          .eq('user_id', fresh.ownerId)
          .eq('club_id', CLUB_ID)
          .maybeSingle();
        const headingReadback = await fresh.client
          .from('user_page_preferences')
          .select('value')
          .eq('user_id', fresh.ownerId)
          .eq('preference_key', sortKey)
          .maybeSingle();
        expect(filterReadback.error).toBeNull();
        expect(headingReadback.error).toBeNull();
        await testInfo.attach('club-filter-fresh-device-proof.json', {
          body: Buffer.from(
            JSON.stringify({
              ownerId: fresh.ownerId,
              clubId: CLUB_ID,
              exactUrl,
              category: 'HOLDEM',
              minimumSeats: Number(chosen),
              sortKey,
              direction,
              accountFilterReadback: filterReadback.data?.filters.HOLDEM,
              accountHeadingReadback: headingReadback.data?.value,
              authOnlyContext: true,
              logout: 'real-ui',
            })
          ),
          contentType: 'application/json',
        });
      } finally {
        await fresh.context.close();
      }
    }
  );
});

preferenceLifecycleTest(
  'table toggle preferences survive UI logout and a cache-empty device',
  async ({ page, preferenceAccount }, testInfo) => {
    test.setTimeout(300_000);
    await page.goto('settings', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Open Menu', exact: true }).click();
    await page.getByRole('button', { name: 'Table Settings', exact: true }).click();
    const panel = page.locator('.tsp-inline');
    await expect(panel).toHaveAttribute('aria-busy', 'false', { timeout: 45_000 });
    const choices: Record<string, boolean> = {};
    const labels: Record<string, string> = {};
    for (const control of await panel.getByRole('switch').all()) {
      if ((await control.getAttribute('data-vip-gated')) === 'true') continue;
      const labelId = await control.getAttribute('aria-labelledby');
      if (!labelId?.startsWith('table-setting-') || !labelId.endsWith('-label'))
        throw new Error('Unknown table preference owner');
      const key = labelId.slice('table-setting-'.length, -'-label'.length);
      const target = (await control.getAttribute('aria-checked')) !== 'true';
      const save = page.waitForResponse(
        (response) =>
          response.url().includes('/rest/v1/user_table_settings') &&
          response.request().method() === 'POST' &&
          response.ok() &&
          response.request().postDataJSON()?.[key] === target,
        { timeout: 45_000 }
      );
      await control.click();
      await save;
      await expect(control).toHaveAttribute('aria-checked', String(target));
      choices[key] = target;
      labels[key] = (await page.locator(`[id="${labelId}"]`).innerText()).trim();
    }
    expect(Object.keys(choices).length).toBeGreaterThan(0);
    const fresh = await logoutAndOpenFreshPreferenceDevice(
      page,
      testInfo.project.use.baseURL!,
      preferenceAccount
    );
    try {
      await fresh.page.goto('settings', { waitUntil: 'domcontentloaded' });
      await acknowledgePreferenceWelcome(fresh.page);
      await fresh.page.getByRole('button', { name: 'Open Menu', exact: true }).click();
      await fresh.page.getByRole('button', { name: 'Table Settings', exact: true }).click();
      const row = await fresh.client
        .from('user_table_settings')
        .select('*')
        .eq('user_id', fresh.ownerId)
        .maybeSingle();
      expect(row.error).toBeNull();
      for (const [key, value] of Object.entries(choices)) {
        expect(row.data?.[key], key).toBe(value);
        await expect(
          fresh.page
            .locator('.tsp-inline')
            .locator(`[role="switch"][aria-labelledby="table-setting-${key}-label"]`)
        ).toHaveAttribute('aria-checked', String(value), { timeout: 30_000 });
      }
      await testInfo.attach('table-toggle-fresh-device-proof.json', {
        body: Buffer.from(
          JSON.stringify({
            ownerId: fresh.ownerId,
            choices,
            labels,
            authOnlyContext: true,
            logout: 'real-ui',
          })
        ),
        contentType: 'application/json',
      });
    } finally {
      await fresh.context.close();
    }
  }
);

preferenceLifecycleTest(
  'stats workspace autosaves independent preferences through UI logout and a fresh device',
  async ({ page, preferenceAccount }, testInfo) => {
    test.setTimeout(300_000);
    const table = 'ca_stats_workspace_preferences';
    const ownerId = preferenceAccount.id;
    const safePreferenceResponses: Array<Record<string, unknown>> = [];
    page.on('response', (response) => {
      const request = response.request();
      if (!['POST', 'PATCH', 'PUT'].includes(request.method())) return;
      let body: Record<string, unknown>;
      try {
        const raw = request.postDataJSON();
        body = Array.isArray(raw) && raw.length === 1 ? raw[0] : raw;
      } catch {
        return;
      }
      if (!body || (body.user_id && body.user_id !== ownerId)) return;
      const preferences = Object.fromEntries(
        Object.entries(body).filter(([key]) =>
          [
            'dashboard_layout',
            'privacy_presentation_mode',
            'p_dashboard_layout',
            'p_privacy_presentation_mode',
          ].includes(key)
        )
      );
      if (!Object.keys(preferences).length) return;
      safePreferenceResponses.push({
        method: request.method(),
        path: new URL(response.url()).pathname,
        status: response.status(),
        preferences,
      });
    });
    const attachSafeResponses = () =>
      testInfo.attach('stats-workspace-preference-response-metadata.json', {
        body: Buffer.from(JSON.stringify(safePreferenceResponses)),
        contentType: 'application/json',
      });
    const read = async (client: typeof preferenceAccount.client) => {
      const result = await client
        .from(table)
        .select('dashboard_layout, privacy_presentation_mode')
        .eq('user_id', ownerId)
        .single();
      expect(result.error).toBeNull();
      return result.data;
    };
    // Exercise authenticated REST/RLS partial upserts independently of the UI:
    // each omitted column must retain the other device's recorded choice.
    for (const patch of [
      {
        user_id: ownerId,
        dashboard_layout: ['overview', 'hands'],
        privacy_presentation_mode: true,
      },
      { user_id: ownerId, dashboard_layout: ['performance', 'overview'] },
    ]) {
      const result = await preferenceAccount.client
        .from(table)
        .upsert(patch, { onConflict: 'user_id' });
      expect(result.error).toBeNull();
    }
    expect(await read(preferenceAccount.client)).toEqual({
      dashboard_layout: ['performance', 'overview'],
      privacy_presentation_mode: true,
    });
    const privacyPatch = await preferenceAccount.client
      .from(table)
      .upsert({ user_id: ownerId, privacy_presentation_mode: false }, { onConflict: 'user_id' });
    expect(privacyPatch.error).toBeNull();
    expect(await read(preferenceAccount.client)).toEqual({
      dashboard_layout: ['performance', 'overview'],
      privacy_presentation_mode: false,
    });

    await page.goto('stats?tab=workspace', { waitUntil: 'domcontentloaded' });
    const zones = page.getByLabel('Dashboard Zones', { exact: true });
    await expect(zones).toHaveValue(/^performance, overview,/, { timeout: 45_000 });
    await zones.fill('over');
    expect(await read(preferenceAccount.client)).toEqual({
      dashboard_layout: ['performance', 'overview'],
      privacy_presentation_mode: false,
    });
    const layoutSave = page.waitForResponse(
      (response) => {
        if (
          !response.url().includes(`/rest/v1/${table}`) ||
          response.request().method() !== 'POST' ||
          !response.ok()
        )
          return false;
        const raw = response.request().postDataJSON();
        const body = Array.isArray(raw) && raw.length === 1 ? raw[0] : raw;
        return (
          JSON.stringify(body?.dashboard_layout) === JSON.stringify(['hands', 'overview']) &&
          !Object.hasOwn(body, 'privacy_presentation_mode')
        );
      },
      { timeout: 45_000 }
    );
    await zones.fill('hands, overview');
    await layoutSave.catch(async (error) => {
      await attachSafeResponses();
      throw error;
    });
    await expect(page.getByText('Preference Saved.', { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    expect(await read(preferenceAccount.client)).toEqual({
      dashboard_layout: ['hands', 'overview'],
      privacy_presentation_mode: false,
    });
    const privacyButton = page.getByRole('button', { name: 'Use Presentation Mode', exact: true });
    await privacyButton.scrollIntoViewIfNeeded({ timeout: 15_000 });
    const privacySave = page.waitForResponse(
      (response) => {
        if (
          !response.url().includes(`/rest/v1/${table}`) ||
          response.request().method() !== 'POST' ||
          !response.ok()
        )
          return false;
        const raw = response.request().postDataJSON();
        const body = Array.isArray(raw) && raw.length === 1 ? raw[0] : raw;
        return body?.privacy_presentation_mode === true && !Object.hasOwn(body, 'dashboard_layout');
      },
      { timeout: 45_000 }
    );
    await Promise.all([
      privacySave,
      (async () => {
        await privacyButton.click({ timeout: 15_000 });
        await expect(
          page.getByRole('button', { name: 'Show Full Detail', exact: true })
        ).toBeVisible({ timeout: 15_000 });
      })(),
    ]).catch(async (error) => {
      await attachSafeResponses();
      throw error;
    });
    await attachSafeResponses();
    expect(await read(preferenceAccount.client)).toEqual({
      dashboard_layout: ['hands', 'overview'],
      privacy_presentation_mode: true,
    });
    const fresh = await logoutAndOpenFreshPreferenceDevice(
      page,
      testInfo.project.use.baseURL!,
      preferenceAccount
    );
    try {
      await fresh.page.goto('stats?tab=workspace', { waitUntil: 'domcontentloaded' });
      await acknowledgePreferenceWelcome(fresh.page);
      await expect(fresh.page.getByLabel('Dashboard Zones', { exact: true })).toHaveValue(
        /^hands, overview,/,
        { timeout: 45_000 }
      );
      await expect(
        fresh.page.getByRole('button', { name: 'Show Full Detail', exact: true })
      ).toBeVisible();
      const persisted = await read(fresh.client);
      expect(persisted).toEqual({
        dashboard_layout: ['hands', 'overview'],
        privacy_presentation_mode: true,
      });
      await testInfo.attach('stats-workspace-fresh-device-proof.json', {
        body: Buffer.from(
          JSON.stringify({
            ownerId,
            persisted,
            independentAuthenticatedPartialWrites: true,
            validLayoutAutosave: true,
            invalidPartialTypingIgnored: true,
            authOnlyContext: true,
            logout: 'real-ui',
          })
        ),
        contentType: 'application/json',
      });
    } finally {
      await fresh.context.close();
    }
  }
);
