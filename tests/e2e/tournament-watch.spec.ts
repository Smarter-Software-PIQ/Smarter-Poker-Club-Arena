/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  WATCHING A RUNNING TOURNAMENT — the route Dan asked for, end to end
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Dan 2026-08-25 (binding): "in MTT, when I click on a tournament that's
 * RUNNING I should be able to click a button and watch the tournament. It
 * should take you directly to the FEATURED TABLE of the tournament
 * automatically, or you can go to Tables or Ranking and see any player and be
 * redirected to that table directly."
 *
 * The unit specs for this assert that the source contains a `featuredTableId`
 * memo and a `btn-watch` class. That is not the same claim. It cannot tell you
 * whether the button renders on a real running tournament, whether the table it
 * points at exists, or whether clicking it lands anywhere. Those are the only
 * things Dan actually asked for, and only a browser against real data can
 * answer them.
 *
 * READ-ONLY. Watching a table is a navigation, not a transaction — nothing here
 * seats anybody or spends anything. It never touches a Register button (see
 * tournament-buy-in-dialog.spec.ts for why that matters).
 *
 * SKIPS RATHER THAN FAILS when production happens to have no running
 * tournament: "there is no live event at 4am" is a fact about the schedule, not
 * a regression in the code.
 */

import { test, expect, type Page } from '@playwright/test';

const url = (path: string) => path.replace(/^\//, '');

async function requireSignedIn(page: Page) {
  if (/\/auth\b/.test(page.url())) {
    if (process.env.E2E_REQUIRE_AUTH === '1') {
      throw new Error('Authenticated tournament verification redirected to sign-in');
    }
    test.skip(true, 'signed out — set SP_EMAIL / SP_PASS for this spec to run');
  }
}

/**
 * Land on the details page of a tournament that is actually RUNNING.
 * Returns false when there is not one to look at.
 */
/**
 * WAIT FOR THE LOBBY TO HAVE ACTUALLY DRAWN ITS CARDS.
 *
 * The first working draft used `waitForTimeout(2500)` here and every spec then
 * blew the 30s test budget: production is a signed-in app holding realtime
 * sockets, and a fixed sleep is both too long when it is fast and too short
 * when it is not. Wait for the thing itself.
 *
 * Returns false when the lobby genuinely has no actionable card — an empty
 * schedule is a fact about production, not a regression.
 */
async function lobbyReady(page: Page): Promise<boolean> {
  const anyCardAction = page.getByRole('button', {
    name: /^\s*(Watch|Open Tournament|Register|Late Register)\b/i,
  });
  try {
    await anyCardAction.first().waitFor({ state: 'visible', timeout: 30_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the navigation drawer out of the way.
 *
 * Found by RUNNING this suite rather than by reading it: on a signed-in cold
 * load the hamburger drawer sits over the lobby, so every card behind it is
 * unmatched and the first draft of these specs SKIPPED on every run — signed in
 * or out. A spec that can only skip reports green and proves nothing.
 */
async function dismissChrome(page: Page) {
  const close = page.getByRole('button', { name: /^\s*Close\s*$/ }).first();
  if (await close.isVisible().catch(() => false)) {
    await close.click().catch(() => {});
    await close.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
  }
}

async function openRunningTournament(page: Page): Promise<boolean> {
  await page.goto(url('tournaments'), { waitUntil: 'domcontentloaded' });
  await requireSignedIn(page);
  await dismissChrome(page);
  if (!(await lobbyReady(page))) return false;

  // A running event's card carries the Watch / Open Tournament action; that is
  // the most reliable "this one is live" marker on the lobby.
  const liveCard = page.getByRole('button', { name: /^\s*(Watch|Open Tournament)\s*$/i }).first();
  if ((await liveCard.count()) === 0) return false;

  await liveCard.click();
  /* An unregistered viewer's Watch carries `?watch=1`, and the details page
     acts on it as soon as its featured table resolves — so this click can land
     on EITHER the details page or straight on the felt. Both are correct; wait
     for whichever arrives. */
  await page
    .waitForURL(/\/(tournaments|table)\/[0-9a-f-]{8,}/i, { timeout: 12000 })
    .catch(() => {});
  return /\/(tournaments|table)\/[0-9a-f-]{8,}/i.test(page.url());
}

/** True once we are on a felt rather than the details page. */
const onTable = (page: Page) => /\/table\/[0-9a-f-]{8,}/i.test(page.url());

test.describe('Watching a running tournament', () => {
  /* Production, signed in, over a real network — and one of these opens a poker
     table, which boots an engine socket. The default 30s is a local-dev budget. */
  test.setTimeout(90_000);

  test('Watch on a live card lands on a real felt, never a dead end', async ({ page }) => {
    /* Dan's item 1, end to end. Three drafts of this test failed for the same
       reason and it is worth recording: the first two branched on
       `page.url()`, which is a SYNCHRONOUS read racing an in-flight
       navigation. On production an unregistered viewer's Watch goes straight
       through to the felt, so the branch chose "details page" and then looked
       for a footer on a page that had already become a table — the assertion
       failed while the feature worked perfectly.

       Assert the DISJUNCTION. Either destination is correct; what must never
       happen is a 404, an error boundary, or still being on the lobby. */
    const ok = await openRunningTournament(page);
    test.skip(!ok, 'no running tournament on production right now');

    expect(page.url(), 'Watch must leave the lobby').toMatch(
      /\/(tournaments|table)\/[0-9a-f-]{8,}/i
    );

    const arrived = page
      .locator('.table-hud')
      .or(page.locator('.table-surface'))
      .or(page.locator('.spectator-footer-bar'))
      .or(page.locator('.details-footer'))
      .first();
    await expect(arrived, 'Watch must land on a felt or on the event page').toBeVisible({
      timeout: 25_000,
    });

    const body = page.locator('body');
    await expect(body).not.toContainText("This page doesn't exist");
    await expect(body).not.toContainText(/Something went wrong|This page ran into an issue/i);
  });

  test('a tournament felt opens its lobby from the top action bar', async ({ page }) => {
    /* Dan 2026-11-01 moved the lobby door from the felt's HUD corner to the
       right corner of the top action bar. Keep proving the real door, its
       placement and the usable full-screen lobby it opens. */
    const ok = await openRunningTournament(page);
    test.skip(!ok, 'no running tournament on production right now');

    /* SETTLE FIRST, THEN DECIDE. Checking `isVisible()` the instant after the
       click is the same race that broke the test above: the watch intent may
       still be navigating, so neither the felt NOR the footer is on screen yet
       and the test concluded "no live table" and skipped itself. Wait for one
       of them to actually exist before branching. */
    const felt = page.locator('.table-hud').or(page.locator('.spectator-footer-bar')).first();
    const watch = page.locator('.details-header__actions .btn-watch');
    await expect(felt.or(watch).first()).toBeVisible({ timeout: 25_000 });

    if (!onTable(page)) {
      if (!(await watch.isVisible().catch(() => false))) {
        test.skip(true, 'this event has no live table to feature');
      }
      try {
        // Auto-watch may finish between the visibility decision and this
        // click, removing the details footer. Bound that race instead of
        // letting a stale locator inherit the entire 90-second test timeout.
        await watch.click({ timeout: 10_000 });
      } catch (error) {
        if (!onTable(page)) throw error;
      }
    }
    if (!onTable(page)) {
      await page.waitForURL(/\/table\/[0-9a-f-]{8,}/i, { timeout: 25_000 });
    }

    const actionBar = page.locator('.multi-table-page__tab-bar-wrapper');
    await expect(actionBar, 'the top action bar must exist on a tournament felt').toBeVisible({
      timeout: 25_000,
    });

    /* ONE button, and it is the lobby door. Seated or watching, the corner
       carries the same control now — the seated/observer split went with the
       figures. */
    const lobbyBtn = actionBar.getByRole('button', { name: 'Open Tournament Lobby', exact: true });
    await expect(
      lobbyBtn,
      'every tournament felt must carry the tournament lobby button'
    ).toBeVisible({ timeout: 25_000 });

    /* The figures must NOT be here. This is the assertion that would catch the
       2026-08-25 bar being reinstated in the corner Dan has now said is a
       door. */
    const barBox = await actionBar.boundingBox();
    const buttonBox = await lobbyBtn.boundingBox();
    expect(barBox).not.toBeNull();
    expect(buttonBox).not.toBeNull();
    expect(
      buttonBox!.x + buttonBox!.width / 2,
      'the lobby door stays on the right'
    ).toBeGreaterThan(barBox!.x + barBox!.width / 2);
    expect(buttonBox!.y, 'the lobby door stays inside the action bar').toBeGreaterThanOrEqual(
      barBox!.y
    );
    expect(buttonBox!.y + buttonBox!.height).toBeLessThanOrEqual(barBox!.y + barBox!.height);
    await expect(actionBar.locator('.mini-stats-card--tournament-stats')).toHaveCount(0);
    await expect(lobbyBtn).not.toContainText(/Stack|VPIP/i);

    /* And it opens the LOBBY as a full-screen popup — not TournamentInfoPanel, which
       is what it used to open and is now reached from the hero avatar. */
    await lobbyBtn.click();
    const lobby = page.locator('.tlm-panel');
    await expect(lobby, 'the corner button must open the tournament lobby overlay').toBeVisible({
      timeout: 20_000,
    });
    /* WHICH panel opened, asked of the thing that names it (moved here
       2026-09-22 with the console rebuild, guarding the same behaviour).

       This used to read the two words back out of the panel's text as one
       run with a space between them. The console header prints the name in
       two measured zones - eyebrow "Tournament" above title "Lobby" - so the
       panel's textContent concatenates to
       "TournamentLobby" with no separator and the old regex could never
       match again, while the player reads exactly what they always did.
       A concatenated substring was never what this line was guarding: it is
       here to catch TournamentInfoPanel opening instead of the lobby. The
       dialog's accessible name says that outright, survives any future zone
       split, and still fails if the wrong panel opens. */
    await expect(
      page.getByRole('dialog', { name: /tournament lobby/i }),
      'the overlay that opened must be the Tournament Lobby, not the info panel'
    ).toBeVisible({ timeout: 20_000 });
    /* FULL SCREEN, ONE FRAME (Dan 2026-10-04: "it should be 'full screen pop
       up' ... remove all these large frames"). The popup used to be a 3/4
       sheet wearing a painted console; on a phone that stack left the tab
       panel 52px tall and nothing a player tapped appeared to do anything.
       It now covers the viewport and the lobby page inside it is usable:
       the tab panel has real height at this viewport, whatever it is. */
    const box = await lobby.boundingBox();
    const viewport = page.viewportSize();
    expect(box && viewport && box.width >= viewport.width - 1).toBeTruthy();
    expect(box && viewport && box.height >= viewport.height - 1).toBeTruthy();
    await expect(lobby.locator('.sc')).toHaveCount(0);

    const panel = lobby.getByRole('tabpanel');
    await expect(panel).toBeVisible({ timeout: 20_000 });
    const panelBox = await panel.boundingBox();
    expect(
      panelBox && panelBox.height >= 200,
      'the tab panel must have room to show a tab, on a phone as much as anywhere'
    ).toBeTruthy();

    /* A tab does what it says: tapping Blinds selects it and changes the
       panel. This is the assertion "zero functionality on mobile" was. */
    const blinds = lobby.getByRole('tab', { name: 'Blinds', exact: true });
    await blinds.click();
    await expect(blinds).toHaveAttribute('aria-selected', 'true');
    await expect(panel.locator('.blinds-tab')).toBeVisible({ timeout: 10_000 });

    /* There is no backdrop left to click off, so the door out is the Close
       control in the lobby's own header. */
    await lobby.getByRole('button', { name: 'Close Tournament Lobby' }).click();
    await expect(lobby).toBeHidden({ timeout: 10_000 });
  });
});

// Exact owner-retired bookmarks. These checks only navigate/read; no seating,
// registration, financial call, fixture insertion or history mutation.
const retiredEvent = '7986217a-0a67-4585-bd43-254356a9cb54';
const retiredTable = '6476c549-17b4-4a2a-b46f-6079bbf98013';

test.describe('Owner-retired tournament bookmarks', () => {
  test.setTimeout(90_000);

  for (const bookmark of [
    { kind: 'table', path: `table/${retiredTable}`, id: retiredTable },
    { kind: 'event', path: `tournaments/${retiredEvent}?watch=1`, id: retiredEvent },
  ]) {
    test(`${bookmark.kind} bookmark cannot reopen the retired game`, async ({ page }) => {
      const retiredEngineConnections: string[] = [];
      // Observe both legacy per-table sockets and multiplexed subscribe frames.
      // Retain only labels, never tokens or complete URLs/frame payloads.
      page.on('websocket', (socket) => {
        const target = new URL(socket.url());
        if (target.hostname !== 'engine.smarter.poker') return;
        // Do not retain query strings, credentials, or arbitrary path segments.
        const path =
          target.pathname === '/ws/multi'
            ? '/ws/multi'
            : target.pathname.startsWith('/ws/table/')
              ? '/ws/table/:tableId'
              : '/[engine-socket]';
        const label = `${target.protocol}//${target.host}${path}`;
        if (socket.url().includes(retiredTable)) {
          retiredEngineConnections.push(`table socket ${label}`);
        }
        socket.on('framesent', (frame) => {
          if (String(frame.payload).includes(retiredTable)) {
            retiredEngineConnections.push(`table subscription ${label}`);
          }
        });
      });
      page.on('request', (request) => {
        const target = new URL(request.url());
        if (
          target.hostname === 'engine.smarter.poker' &&
          (target.href.includes(retiredTable) || (request.postData() ?? '').includes(retiredTable))
        ) {
          retiredEngineConnections.push('table engine request');
        }
      });

      await page.goto(url(bookmark.path), { waitUntil: 'domcontentloaded' });
      await requireSignedIn(page);
      // MultiTablePage redirects retired events to /clubs; a standalone details
      // mount returns its existing not-found state. Both must deny all actions.
      await expect
        .poll(
          async () => {
            if (/\/auth\b/.test(page.url())) return 'signed-out';
            if (!new URL(page.url()).pathname.includes(bookmark.id)) return 'redirected';
            if (
              bookmark.kind === 'event' &&
              (await page
                .getByRole('heading', { name: 'Tournament Not Found', exact: true })
                .isVisible())
            ) {
              return 'not-found';
            }
            return 'pending';
          },
          { timeout: 30_000 }
        )
        .toMatch(/^(redirected|not-found)$/);
      await requireSignedIn(page);
      const details = page.locator('.tournament-details');
      await expect(
        details.getByRole('button', {
          name: /^\s*(Watch|Open Tournament|Register|Late Register|Take Seat)\b/i,
        })
      ).toHaveCount(0);
      await expect(details.locator('a[href*="' + retiredTable + '"]')).toHaveCount(0);
      expect(
        retiredEngineConnections,
        'retired route must be denied before engine connection'
      ).toEqual([]);
    });
  }
});
