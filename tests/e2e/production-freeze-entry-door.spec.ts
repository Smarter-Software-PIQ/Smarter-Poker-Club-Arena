import { openLobbyGameSection } from './support/lobbyGameSections';
/**
 * THE FROZEN DOOR, PROVEN IN THE BROWSER ON THE DEPLOYED SITE (2026-11-07).
 *
 * Dan's NLH and PLO Lightning joins were refused at 13:20 Chicago during an
 * engine cutover, and nothing on the screen said why or for how long. #9945
 * and #9963 made every Join door say when it opens. Their unit tests mount
 * the pages with synthetic reads; this loads the PUBLISHED client and proves
 * the same wiring against the real lobby and Lightning page.
 *
 * NO REAL FREEZE, EVER. A real freeze refuses real players. Only the answers
 * the client reads about the freeze are faked in this browser:
 *   - fn_entry_purchases_frozen (the entry guard): true or false;
 *   - fn_maintenance_break_state: one row, 47 s remaining, or none;
 *   - fn_lightning_rejoin_seated: the guard's PLATFORM_FROZEN refusal, so the
 *     one door the page taps is answered here and never reaches production;
 *   - the engine's maintenance presentation in /health: idle (the engine is
 *     back; only the database's release boundary is still closing entry,
 *     exactly the 13:20:17-13:21:37 window).
 * Everything else is the real site. READ ONLY: the test fails if any
 * admission or buy-in RPC is sent.
 */
import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { CLUB_ENTRY_MESSAGE_NAME, prepareCashLobbyActions } from './support/cashLobbyOverlays';
import { diamondEntryRead, settleDiamondSpinsOffer } from './support/diamondInvitationOffer';

const club = process.env.E2E_LIGHTNING_CLUB_ID || '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3';
const MONEY_RPCS = new Set([
  '/rest/v1/rpc/fn_cash_game_join',
  '/rest/v1/rpc/atomic_table_buyin',
  '/rest/v1/rpc/fn_lightning_join',
  '/rest/v1/rpc/fn_lightning_buy_in',
]);
const LIGHTNING_ROUTE = /\/lightning\/[0-9a-f-]{36}(?:[?#]|$)/;
const LIGHTNING_ROWS =
  '[data-testid="lobby-game-row"][data-kind="cash"][data-lightning="on"]:visible, .club-home__games .lt-row[data-kind="cash"][data-lightning="on"]:visible';
const OPENS_IN = /^Opens In \d:\d\d$/;

interface FakeFreeze {
  frozen: boolean;
  /** Rejoin calls answered with the refusal; none of them reached production. */
  rejoinsAnswered: number;
  /** Guard reads answered; proves the client asked the guard itself. */
  guardReads: number;
}

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function fakeTheFreezeAnswers(page: Page): Promise<FakeFreeze> {
  const fake: FakeFreeze = { frozen: false, rejoinsAnswered: 0, guardReads: 0 };
  await page.route('**/rest/v1/rpc/fn_entry_purchases_frozen*', (route) => {
    fake.guardReads += 1;
    return json(route, 200, fake.frozen);
  });
  await page.route('**/rest/v1/rpc/fn_maintenance_break_state*', (route) =>
    json(
      route,
      200,
      fake.frozen
        ? [
            {
              phase: 'recovering',
              break_ends_at: null,
              remaining_ms: 47_000,
              reason: 'Restoring every frozen table clock',
            },
          ]
        : []
    )
  );
  await page.route('**/rest/v1/rpc/fn_lightning_rejoin_seated*', (route) => {
    fake.rejoinsAnswered += 1;
    return json(route, 400, {
      code: 'P0001',
      message: 'PLATFORM_FROZEN',
      details: null,
      hint: null,
    });
  });
  // The engine is back (idle); only the database still closes entry.
  await page.route(
    (url) => url.pathname === '/health' && /(^|\.)engine\./.test(url.hostname),
    async (route) => {
      const idle = {
        active: false,
        phase: 'idle',
        break_id: null,
        break_ends_at: null,
        scheduled_ends_at: null,
        reason: '',
        timestamp: Date.now(),
      };
      try {
        const response = await route.fetch();
        const body = (await response.json()) as Record<string, unknown>;
        const maintenance = (body.maintenance ?? {}) as Record<string, unknown>;
        return route.fulfill({
          response,
          json: { ...body, maintenance: { ...maintenance, presentation: idle } },
        });
      } catch {
        return json(route, 200, { running: true, maintenance: { presentation: idle } });
      }
    }
  );
  return fake;
}

function watchMoney(page: Page): string[] {
  const calls: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (MONEY_RPCS.has(path)) calls.push(path);
  });
  return calls;
}

async function openLobby(page: Page) {
  const offer = diamondEntryRead(page);
  await page.goto(`clubs/${club}`, { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/\/auth(?:\/|\?|$)/);
  await prepareCashLobbyActions(page);
  await openLobbyGameSection(page, 'ALL');
  await expect(
    page
      .locator('[data-testid="lobby-game-row"]:visible, .club-home__games .lt-row:visible')
      .first()
  ).toBeVisible({ timeout: 45_000 });
  await settleDiamondSpinsOffer(page, offer);
  const greeting = page.getByRole('dialog', { name: CLUB_ENTRY_MESSAGE_NAME });
  await greeting.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined);
  if (await greeting.isVisible())
    await prepareCashLobbyActions(page, { retainInvitationHandler: false });
  await expect(greeting).toHaveCount(0);
  const allGames = page.getByRole('tab', { name: 'ALL', exact: true });
  if (await allGames.count()) await allGames.click();
  const rows = page.locator(LIGHTNING_ROWS);
  await expect(rows.first(), 'the member lobby lists a Lightning game').toBeVisible({
    timeout: 45_000,
  });
  return rows;
}

const requireAccount = () =>
  expect(
    Boolean(process.env.SP_EMAIL && process.env.SP_PASS),
    'isolated authenticated account required'
  ).toBe(true);

test('frozen at 1440px: the board says when the door opens and the banner waits for it', async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  requireAccount();
  await page.setViewportSize({ width: 1440, height: 900 });
  const money = watchMoney(page);
  const fake = await fakeTheFreezeAnswers(page);
  fake.frozen = true;
  const rows = await openLobby(page);

  // (b) The engine reports idle; the banner still waits for the database.
  await expect(page.getByTestId('maintenance-banner-entry').first()).toContainText(
    /Tables Are Back\. New Seats Open In \d:\d\d\. Seats And Chips Are Safe\./,
    { timeout: 15_000 }
  );
  await expect(page.getByText(/Maintenance Complete/)).toHaveCount(0);

  // (a) Every Lightning row's door is the countdown, disabled; none offers Join.
  const row = rows.first();
  const door = row.locator('button[data-act="closed"]');
  await expect(door).toHaveText(OPENS_IN);
  await expect(door).toBeDisabled();
  // The row's own Join (aria-label "Join <game>") is not offered at all.
  await expect(row.locator('button[data-act="join"]')).toHaveCount(0);
  expect(fake.guardReads, 'the client asked the entry guard itself').toBeGreaterThan(0);

  await info.attach('freeze-board-1440.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  expect(fake.rejoinsAnswered).toBe(0);
  expect(money, 'a read-only check sends no admission or buy-in').toEqual([]);
});

test('frozen at 393px: the game panel door counts down and cannot be tapped', async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  requireAccount();
  await page.setViewportSize({ width: 393, height: 900 });
  const money = watchMoney(page);
  const fake = await fakeTheFreezeAnswers(page);
  fake.frozen = true;
  const rows = await openLobby(page);

  const row = rows.first();
  const details = row.getByRole('button', { name: /^Details:/ });
  if (await details.count()) await details.first().click();
  else await row.click();
  const panel = page.getByRole('dialog').filter({ has: page.locator('.arena-game-card') });
  await expect(panel.first()).toBeVisible({ timeout: 8_000 });
  const door = panel.getByRole('button', { name: OPENS_IN }).first();
  await expect(door).toBeVisible();
  await expect(door).toBeDisabled();
  await expect(panel.getByRole('button', { name: 'Join Lightning', exact: true })).toHaveCount(0);

  await info.attach('freeze-panel-393.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  expect(fake.rejoinsAnswered).toBe(0);
  expect(money, 'a read-only check sends no admission or buy-in').toEqual([]);
});

test('open, then frozen as Join is tapped: a refusal with its time, never a failure', async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  requireAccount();
  await page.setViewportSize({ width: 393, height: 900 });
  const money = watchMoney(page);
  const fake = await fakeTheFreezeAnswers(page);
  fake.frozen = false;
  const rows = await openLobby(page);

  // (d) Entry open: no banner, and a Lightning panel offers an enabled Join.
  await expect(page.getByTestId('maintenance-banner-entry')).toHaveCount(0);
  const panel = page.getByRole('dialog').filter({ has: page.locator('.arena-game-card') });
  const tries = Math.min(await rows.count(), 8);
  let join: Locator | null = null;
  for (let i = 0; i < tries && !join; i += 1) {
    const row = rows.nth(i);
    const details = row.getByRole('button', { name: /^Details:/ });
    if (await details.count()) await details.first().click();
    else await row.click();
    await expect(panel.first()).toBeVisible({ timeout: 8_000 });
    const candidate = panel.getByRole('button', { name: 'Join Lightning', exact: true }).first();
    if ((await candidate.count()) && (await candidate.isEnabled())) join = candidate;
    else {
      await page.getByRole('button', { name: 'Close Game Lobby', exact: true }).click();
      await expect(panel).toHaveCount(0);
    }
  }
  expect(join, 'with entry open a Lightning panel offers an enabled Join Lightning').not.toBeNull();

  // (c) The freeze begins as the player taps. The Lightning page asks the
  // rejoin door first; its refusal is answered here and never sent on.
  fake.frozen = true;
  await join!.click();
  await expect(page).toHaveURL(LIGHTNING_ROUTE, { timeout: 15_000 });
  const toast = page.locator('.toast__message').filter({ hasText: /Seats Reopen In About/ });
  await expect(toast.first()).toHaveText(
    /^The Platform Is On A Short Maintenance Break\. Nothing Is Lost\. Seats Reopen In About \d+ Seconds?\.$/,
    { timeout: 20_000 }
  );
  await expect(page.getByText(/Could Not Open/)).toHaveCount(0);
  expect(fake.rejoinsAnswered, 'the rejoin door was asked and answered here').toBeGreaterThan(0);

  // After the refusal the page's own door counts down too.
  const card = page.locator('[data-testid="lightning-entry"] .lightning-cash-card');
  await expect(card.locator('[data-zone="primaryAction"]')).toContainText(/Opens In \d:\d\d/, {
    timeout: 10_000,
  });

  await info.attach('freeze-refusal-393.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  expect(money, 'a read-only check sends no admission or buy-in').toEqual([]);
});
