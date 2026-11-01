/** Cash decisions stay coherent across a street and a recoverable state-frame loss.
 * Uses only the committed synthetic engine recording and the isolated backend.
 */
import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { PLAYER, newBackend, signIn } from '../stale-client/mock-backend';
import { ReplayEngine, readRecording, type Recording } from './replay-engine';

const FRAMES = fileURLToPath(new URL('./wire/same-seat-street-boundary.jsonl', import.meta.url));
const CLUB = 'c1ab0000-0000-4000-8000-0000000000c1';
test.skip(!process.env.LIVE_TURN_DIST, 'requires the isolated build under test');
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

function backendFor(rec: Recording) {
  return newBackend({
    engineHttp: 'answered',
    rpc: {
      fn_poker_arena_context: () => ({
        body: {
          arena: { id: CLUB, asset: 'chips', is_platform: false, union_id: null },
          member: true,
          role: 'player',
          cashGamesEnabled: true,
          tournamentsEnabled: true,
        },
      }),
    },
    tables: {
      tables: [
        {
          id: rec.table,
          club_id: CLUB,
          // The embedded relation the table's own bootstrap read selects.
          arena: { id: CLUB, asset: 'chips', is_platform: false, union_id: null },
          union_id: null,
          tournament_id: null,
          name: 'NLH 2/5',
          game_variant: 'nlh',
          game_type: 'cash',
          status: 'running',
          small_blind: 2,
          big_blind: 5,
          min_buy_in: 200,
          max_buy_in: 1000,
          max_players: 6,
          current_players: 2,
          action_time_seconds: 15,
          is_deleted: false,
          created_at: '2026-09-29T00:00:00Z',
        },
      ],
      profiles: [
        {
          id: PLAYER,
          username: 'fixture',
          alias: 'Fixture',
          full_name: 'Live Turn Fixture',
          role: 'user',
          diamonds: 0,
          diamond_balance: 0,
          club_arena_tos_accepted_at: '2026-09-01T00:00:00Z',
          avatar_url: '/hub/club-arena/default-avatar.png',
          arena_avatar_url: '/hub/club-arena/default-avatar.png',
        },
      ],
      clubs: [
        {
          id: CLUB,
          slug: 'live-turn-club',
          name: 'Live Turn Club',
          asset: 'chips',
          is_platform: false,
          is_union: false,
          union_id: null,
          owner_id: null,
          member_count: 2,
          created_at: '2026-09-08T00:00:00Z',
        },
      ],
      club_members: [
        { club_id: CLUB, user_id: PLAYER, role: 'member', status: 'active', chip_balance: 5000 },
      ],
      // This recording permits arbitrary human pauses between decisions.
      // Optional automatic banks must not turn runner speed into a control
      // coherence assertion. Verify this account preference on the wire below.
      user_table_settings: [{ user_id: PLAYER, auto_time_bank: false }],
      // The seat row the table's ten-second liveness read looks for. Without
      // it the page concludes this player was removed and says so in a toast
      // that sits over the action bar.
      table_seats: [
        {
          id: '5ea70000-0000-4000-8000-000000000002',
          table_id: rec.table,
          user_id: PLAYER,
          seat_number: 2,
          stack: 1000,
          status: 'active',
          is_sitting_out: false,
          sit_out_at: null,
          left_at: null,
          leave_pending: false,
          joined_at: '2026-10-04T19:40:00Z',
          profiles: {
            id: PLAYER,
            username: 'fixture',
            alias: 'Fixture',
            full_name: 'Live Turn Fixture',
            avatar_url: '/hub/club-arena/default-avatar.png',
            arena_avatar_url: '/hub/club-arena/default-avatar.png',
          },
        },
      ],
    },
  });
}

async function openTable(page: Page): Promise<ReplayEngine> {
  const rec = readRecording(FRAMES);
  expect(rec.hero).toBe(PLAYER);
  await signIn(page, backendFor(rec));
  const engine = await ReplayEngine.install(page, rec);
  await page.goto(`table/${rec.table}`);
  await expect.poll(() => engine.autoTimeBankPreferences.includes(false)).toBe(true);
  return engine;
}

function controls(page: Page) {
  const panel = page.locator('.action-panel');
  return {
    panel,
    call: panel.locator('.action-btn--call'),
    check: panel.locator('.action-btn--check:not([disabled])'),
    wager: panel.locator('.action-btn--raise'),
  };
}

async function expectOpeningBet(page: Page): Promise<void> {
  const bar = controls(page);
  await expect(bar.check).toBeVisible();
  await expect(bar.wager).toBeVisible();
  await expect(bar.wager).toBeEnabled();
  await expect(bar.wager).toHaveAccessibleName('Open Bet Panel');
}

/** Read only the fixture board's rendered images, never player holdings. */
async function expectBoardImagesReady(page: Page, count: 3 | 4): Promise<void> {
  const images = page.locator('.community-cards__card img.card-image__img');
  await expect(images).toHaveCount(count);
  for (let i = 0; i < count; i++) {
    await expect(images.nth(i)).toHaveAttribute('loading', 'eager');
  }
  await expect
    .poll(
      () =>
        images.evaluateAll((nodes) =>
          nodes.map((node) => {
            const image = node as HTMLImageElement;
            return image.complete && image.naturalWidth > 0;
          })
        ),
      { message: 'every synthetic board image is loaded with nonzero intrinsic width' }
    )
    .toEqual(Array(count).fill(true));
}

test('the big blind can open betting after calling on the prior street', async ({ page }) => {
  const engine = await openTable(page);
  const bar = controls(page);
  try {
    await expect(bar.call).toBeVisible({ timeout: 60_000 });
    await bar.call.click();
    await expectOpeningBet(page);
    await expectBoardImagesReady(page, 3);
    // Preserve the recording: this witness checks, faces a bet and calls.
    await bar.check.click();
    await expect(bar.call).toBeVisible();
    await bar.call.click();
    await expectOpeningBet(page);
    await expectBoardImagesReady(page, 4);
    expect(engine.accepted.map((action) => action.action)).toEqual(['call', 'check', 'call']);
    expect(engine.problems).toEqual([]);
    expect(engine.timeBankRequests).toEqual([]);
  } finally {
    engine.dispose();
  }
});

test('a lost new-street delta never presents a false check-or-call-only decision', async ({
  page,
}) => {
  const engine = await openTable(page);
  const bar = controls(page);
  let release = () => {};
  try {
    await expect(bar.call).toBeVisible({ timeout: 60_000 });
    // Actual recording after the BB call: community event +3ms, state delta
    // seq6/prev5 +5ms, clock delta seq7/prev6 and turn event +506ms.
    // TableStateHub can soft-drop DELTA delivery; EVENTS have a separate seq.
    // Never let a later frame overtake an earlier one to manufacture this.
    engine.dropStateDeliveryOnce(6, 5);
    release = engine.holdResyncReplies(5_000);
    const resyncBefore = engine.resyncRequests;
    await bar.call.click();
    await expect.poll(() => engine.droppedStateFrames).toEqual([{ seq: 6, prev: 5 }]);
    await expect.poll(() => engine.resyncRequests).toBeGreaterThan(resyncBefore);
    await expect
      .poll(() =>
        engine.sent.some(
          (frame) =>
            frame.type === 'EVENT' &&
            frame.detail === 'turn_change seat 2' &&
            frame.at > engine.accepted[0].at
        )
      )
      .toBe(true);

    // The engine's real new decision has arrived. Either show its coherent
    // opening-bet controls, or withhold all input while authoritative state
    // is missing. Check/Call alone against stale prior-street data is unsafe.
    expect(engine.resyncRepliesHeld, 'recovery is still deliberately pending').toBe(true);
    const observed = await page.evaluate(
      () =>
        new Promise<string[]>((resolve) => {
          const states: string[] = [];
          const read = () => {
            const panel = document.querySelector<HTMLElement>('.action-panel');
            if (!panel || panel.getClientRects().length === 0) {
              states.push('pending');
              return;
            }
            const wager = panel.querySelector<HTMLButtonElement>('.action-btn--raise');
            states.push(
              wager &&
                wager.getClientRects().length > 0 &&
                !wager.disabled &&
                wager.getAttribute('aria-label') === 'Open Bet Panel'
                ? 'coherent'
                : 'partial'
            );
          };
          const observer = new MutationObserver(read);
          observer.observe(document.body, { subtree: true, childList: true, attributes: true });
          read();
          // Observe the whole boundary, including the old 700ms chip sweep.
          // A one-shot "pending" read before React commits would falsely pass.
          setTimeout(() => {
            observer.disconnect();
            resolve(states);
          }, 900);
        })
    );
    expect(engine.resyncRepliesHeld, 'no automatic recovery masked this assertion').toBe(true);
    expect(
      observed,
      'new street must not expose a stale check-or-call-only decision'
    ).not.toContain('partial');
    expect(engine.accepted.map((action) => action.action)).toEqual(['call']);
    expect(engine.problems).toEqual([]);
    release();
    await expectOpeningBet(page);
    await expectBoardImagesReady(page, 3);
    expect(engine.accepted.map((action) => action.action)).toEqual(['call']);
    expect(engine.timeBankRequests).toEqual([]);
  } finally {
    release();
    engine.dispose();
  }
});
