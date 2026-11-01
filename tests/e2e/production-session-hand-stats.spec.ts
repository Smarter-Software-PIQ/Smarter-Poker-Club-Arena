import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type WebSocketRoute, type Route } from '@playwright/test';
const samples = JSON.parse(
  readFileSync(new URL('./support/sessionHandStatsSamples.json', import.meta.url), 'utf8')
);

const TITLE = 'published cash and tournament hand totals survive all session surfaces';
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const CLUB = process.env.E2E_CLUB_ID || 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4';
const ACTOR_NAME = 'Session Stats Proof';
const OCCUPANCY = 'b8f20756-e25c-4626-bf82-18287a18fc82';
const OPPONENT = 'c1f79de9-2757-4b2c-877c-b23b3ac63f89';
type Scope = 'cash' | 'tournament';
type Surface = 'player-hub' | 'full-session-stats' | 'final-results';

// Published application, actual parser/components, isolated actor. Every table,
// result and self-only RPC value below is a controlled browser input. This is
// never an authoritative seat, hand settlement, payout or database certificate.
test.use({
  viewport: { width: 393, height: 852 },
  trace: 'off',
  video: 'off',
  serviceWorkers: 'block',
});
test(TITLE, async ({ page, context, request }, info) => {
  test.setTimeout(150_000);
  page.setDefaultTimeout(15_000);
  if (!process.env.E2E_TEST_ACCOUNT_FILE)
    throw new Error('The maintained isolated account record is required');
  const account = JSON.parse(await readFile(process.env.E2E_TEST_ACCOUNT_FILE, 'utf8'));
  if (
    !UUID.test(account.id) ||
    !/^ca-customization-cert-postdeploy-.*@example\.invalid$/.test(account.email)
  )
    throw new Error('Session statistics proof refuses a non-reserved authentication identity');
  const localQualification = process.env.HAND_STATS_LOCAL_FIXTURE === '1';
  if (localQualification && (process.env.GITHUB_ACTIONS || account.localFixture !== true))
    throw new Error(
      'Fake authentication is restricted to an explicitly marked offline qualification'
    );
  const userId: string = account.id;
  const expectedSha = process.env.LIVE_SHA;
  if (!/^[0-9a-f]{40}$/.test(expectedSha || ''))
    throw new Error('An exact published client SHA is required');
  let scope: Scope = 'cash';
  let finalReadPending = false;
  let sequence = 1;
  const sockets = new Set<WebSocketRoute>();
  const refused = { http: 0, websocket: 0 };
  const forwardedMethods: string[] = [];
  const surfaces: Array<{ scope: Scope; surface: Surface; expected: number; rendered: number }> =
    [];
  const bracket: Array<{ point: string; origin: string; sha: string; reason: null }> = [];
  const rpcReads: Array<{ scope: Scope; asOf: boolean; hands: number }> = [];
  const sample = () => samples[scope];
  const table = () => ({
    id: sample().tableId,
    club_id: CLUB,
    union_id: null,
    arena: { id: CLUB, asset: 'chips', is_platform: false, union_id: null },
    name: `Controlled ${scope} Session`,
    game_type: scope === 'cash' ? 'cash' : 'tournament',
    game_variant: 'NLH',
    tournament_id: sample().tournamentId,
    status: 'running',
    small_blind: 25,
    big_blind: 50,
    stakes: '25/50',
    max_players: 9,
    current_players: 2,
    min_buy_in: 1000,
    max_buy_in: 10000,
    cluster_id: null,
    settings: {},
    created_at: sample().started_at,
    is_deleted: false,
  });
  const seat = () => ({
    id: OCCUPANCY,
    table_id: sample().tableId,
    user_id: userId,
    seat_number: 1,
    occupancy_id: OCCUPANCY,
    stack: 5000,
    joined_at: sample().started_at,
    left_at: null,
    is_sitting_out: false,
    leave_pending: false,
    status: 'active',
    club_id: CLUB,
    profiles: { id: userId, username: ACTOR_NAME, display_name: ACTOR_NAME },
  });
  const snapshot = () => ({
    type: 'SNAPSHOT',
    tableId: sample().tableId,
    seq: sequence++,
    state: {
      table_id: sample().tableId,
      table_name: table().name,
      game_variant: 'NLH',
      hand_number: 72,
      max_players: 9,
      stage: 'waiting',
      pot: 0,
      current_bet: 0,
      community_cards: [],
      action_history: [],
      current_player: null,
      dealer_seat: 1,
      small_blind: 25,
      big_blind: 50,
      min_raise: 50,
      last_raise: 50,
      timestamp: Date.now(),
      players: [
        {
          seat: 1,
          user_id: userId,
          username: ACTOR_NAME,
          stack: 5000,
          bet: 0,
          cards: [],
          is_sitting_out: false,
        },
        {
          seat: 2,
          user_id: OPPONENT,
          username: 'Controlled Opponent',
          stack: 5000,
          bet: 0,
          cards: [],
          is_sitting_out: false,
        },
      ],
    },
  });
  const json = async (route: Route, data: unknown) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(data),
    });
  };
  await context.route('**/*', async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    const path = url.pathname;
    if (path.endsWith('/rpc/fn_my_game_session_hand_stats')) {
      const args = req.postDataJSON();
      expect(args.p_table_id).toBe(sample().tableId);
      const row = { ...sample(), hands_played: sample().hands_played - (finalReadPending ? 1 : 0) };
      rpcReads.push({ scope, asOf: typeof args.p_as_of === 'string', hands: row.hands_played });
      await json(route, row);
      return;
    }
    // No POST/PATCH/DELETE, unload beacon, heartbeat, telemetry or financial
    // request from this synthetic hero may reach a backend. Self-only stats
    // POST above is fulfilled in this browser and is never forwarded either.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) {
      refused.http++;
      await route.abort('blockedbyclient');
      return;
    }
    if (
      path.endsWith('/rest/v1/tables') &&
      url.searchParams.get('id') === `eq.${sample().tableId}`
    ) {
      await json(route, req.headers().accept?.includes('vnd.pgrst.object') ? table() : [table()]);
      return;
    }
    if (
      path.endsWith('/rest/v1/table_seats') &&
      (url.searchParams.get('table_id') === `eq.${sample().tableId}` ||
        url.searchParams.get('user_id') === `eq.${userId}`)
    ) {
      await json(route, req.headers().accept?.includes('vnd.pgrst.object') ? seat() : [seat()]);
      return;
    }
    if (
      scope === 'tournament' &&
      path.endsWith('/rest/v1/tournaments') &&
      url.searchParams.get('id') === `eq.${sample().tournamentId}`
    ) {
      const row = {
        id: sample().tournamentId,
        name: 'Controlled Tournament',
        club_id: CLUB,
        status: 'RUNNING',
        tournament_type: 'mtt',
        variant: 'NLH',
        buy_in_amount: 25,
        buy_in_fee: 0,
        starting_chips: 5000,
        current_level: 1,
        current_players: 2,
        registered_players: 2,
        prize_pool: 50,
        settings: {},
      };
      await json(route, req.headers().accept?.includes('vnd.pgrst.object') ? row : [row]);
      return;
    }
    if (
      scope === 'tournament' &&
      path.endsWith('/rest/v1/tournament_players') &&
      url.searchParams.get('tournament_id') === `eq.${sample().tournamentId}`
    ) {
      const row = {
        user_id: userId,
        tournament_id: sample().tournamentId,
        table_id: sample().tableId,
        seat_number: 1,
        username: ACTOR_NAME,
        status: 'playing',
        chips: 5000,
        chip_count: 5000,
        position: null,
        prize: 0,
        registered_at: sample().started_at,
      };
      await json(route, req.headers().accept?.includes('vnd.pgrst.object') ? row : [row]);
      return;
    }
    if (
      localQualification &&
      (!['smarter.poker', 'ca-static.smarter.poker'].includes(url.hostname) ||
        path.startsWith('/api/') ||
        !!req.headers().authorization)
    ) {
      // Local code prequalification must never forward a fabricated token.
      // Only actual public client assets are read from the network.
      if (path.endsWith('/auth/v1/user')) {
        await json(route, {
          id: userId,
          aud: 'authenticated',
          role: 'authenticated',
          email: account.email,
          user_metadata: { username: ACTOR_NAME, display_name: ACTOR_NAME },
          app_metadata: { provider: 'email' },
        });
        return;
      }
      const one = req.headers().accept?.includes('vnd.pgrst.object');
      const rows = path.endsWith('/rest/v1/profiles')
        ? [
            {
              id: userId,
              user_id: userId,
              username: ACTOR_NAME,
              display_name: ACTOR_NAME,
              role: 'player',
              is_active: true,
              club_arena_tos_accepted_at: '2026-11-01T00:00:00Z',
              arena_avatar_url: '/avatars/table/free_samurai@2x.webp',
            },
          ]
        : path.endsWith('/rest/v1/clubs')
          ? [
              {
                id: CLUB,
                name: 'Controlled Proof Club',
                asset: 'chips',
                is_platform: false,
                union_id: null,
                status: 'active',
                settings: {},
              },
            ]
          : path.endsWith('/rest/v1/club_members')
            ? [
                {
                  id: OCCUPANCY,
                  user_id: userId,
                  club_id: CLUB,
                  status: 'active',
                  role: 'member',
                  chip_balance: 0,
                },
              ]
            : [];
      await json(route, one ? (rows[0] ?? null) : rows);
      return;
    }
    forwardedMethods.push(req.method());
    await route.continue();
  });
  await context.routeWebSocket(
    () => true,
    (client) => {
      // Do not call connectToServer: no upstream socket exists in this proof.
      const engine = new URL(client.url()).hostname === 'engine.smarter.poker';
      if (engine) sockets.add(client);
      client.onMessage((message) => {
        refused.websocket++;
        if (!engine) return;
        try {
          const frame = JSON.parse(String(message));
          if (frame.type === 'SUBSCRIBE' && frame.tableId === sample().tableId) {
            client.send(JSON.stringify({ type: 'SUBSCRIBED', tableId: frame.tableId }));
            client.send(JSON.stringify(snapshot()));
          } else if (
            frame.type === 'RESYNC' &&
            (!frame.tableId || frame.tableId === sample().tableId)
          )
            client.send(JSON.stringify(snapshot()));
          else if (frame.type === 'PING')
            client.send(JSON.stringify({ type: 'PONG', ts: frame.ts }));
        } catch {
          /* unreadable upstream bytes remain refused */
        }
      });
      if (/\/ws\/table\//.test(new URL(client.url()).pathname))
        client.send(JSON.stringify(snapshot()));
    }
  );
  async function readBuild(point: 'before' | 'after') {
    for (const origin of [
      'https://smarter.poker/hub/club-arena',
      'https://ca-static.smarter.poker',
    ]) {
      const response = await request.get(`${origin}/build-info.json?handstats=${Date.now()}`);
      expect(response.ok()).toBe(true);
      const build = await response.json();
      expect(build.ca_sha).toBe(expectedSha);
      expect(build.built_by).toBe('publish-club-arena.yml');
      bracket.push({ point, origin, sha: build.ca_sha, reason: null });
    }
  }
  async function countValue(row: Locator, expected: number) {
    await expect(row).toBeVisible();
    await expect
      .poll(async () => Number((await row.innerText()).match(/\d[\d,]*/)?.[0]?.replaceAll(',', '')))
      .toBe(expected);
    return Number((await row.innerText()).match(/\d[\d,]*/)?.[0]?.replaceAll(',', ''));
  }
  const hubRow = (label: string) =>
    page
      .locator('.hero-hub__figure')
      .filter({
        has: page.locator('.hero-hub__figure-label', { hasText: new RegExp(`^${label}$`, 'i') }),
      })
      .locator('.hero-hub__figure-value');
  const resultsRow = (label: string) =>
    page
      .locator('.rtr__row')
      .filter({ has: page.locator('.rtr__label', { hasText: new RegExp(`^${label}$`, 'i') }) })
      .locator('.rtr__value');
  try {
    await readBuild('before');
    for (const nextScope of ['cash', 'tournament'] as const) {
      scope = nextScope;
      console.log(`HAND_STATS_STEP ${scope} table`);
      finalReadPending = false;
      sockets.clear();
      await page.goto(`table/${sample().tableId}`, { waitUntil: 'domcontentloaded' });
      expect(new URL(page.url()).origin).toBe('https://smarter.poker');
      await expect(page.locator('.table-surface')).toBeVisible({ timeout: 35000 });
      await expect(page.locator(`.seat--hero[data-player-id="${userId}"]`)).toHaveCount(1, {
        timeout: 20000,
      });
      const openHub = async () => {
        await page
          .locator(
            `.seat--hero[data-player-id="${userId}"] [role="button"][aria-label^="Player Actions For"]`
          )
          .press('Enter');
        await expect(page.getByRole('dialog', { name: 'Player Hub', exact: true })).toBeVisible();
      };
      await openHub();
      console.log(`HAND_STATS_STEP ${scope} player-hub`);
      surfaces.push({
        scope,
        surface: 'player-hub',
        expected: sample().hands_played,
        rendered: await countValue(hubRow('Hands'), sample().hands_played),
      });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator(`.seat--hero[data-player-id="${userId}"]`)).toHaveCount(1);
      await openHub();
      await countValue(hubRow('Hands'), sample().hands_played);
      console.log(`HAND_STATS_STEP ${scope} reload`);
      await page.getByText('Full Session Stats', { exact: true }).click();
      await expect(
        page.getByRole('dialog', { name: 'Real Time Result', exact: true })
      ).toBeVisible();
      surfaces.push({
        scope,
        surface: 'full-session-stats',
        expected: sample().hands_played,
        rendered: await countValue(resultsRow('Hands Played'), sample().hands_played),
      });
      await page
        .getByRole('dialog', { name: 'Real Time Result', exact: true })
        .getByTestId('sc-close')
        .click();
      // Existing owner-bound completion channel is a display transport only.
      // Start one hand short, then deliver the real parser's unlock event to
      // prove final-card refresh without another hand or any leave transaction.
      console.log(`HAND_STATS_STEP ${scope} full-session-stats`);
      finalReadPending = true;
      await page.evaluate(
        ({ userId, tableId, asOf, started, tournamentId, scope, occupancy }) => {
          const payload = {
            closeTableId: tableId,
            closeSeat: 1,
            closeOccupancyId: occupancy,
            handStatsTarget: { tableId, userId, asOf: Date.parse(asOf) },
            arenaAsset: 'chips',
            duration: 600,
            handsPlayed: 0,
            handsWon: 0,
            totalRebuys: 0,
            profitLoss: 0,
            biggestPot: 0,
            peakStack: 5000,
            totalBuyIn: 5000,
            tableName: `Controlled ${scope} Session`,
            sessionStart: Date.parse(started),
            sessionEnd: Date.parse(asOf),
            ...(scope === 'tournament'
              ? {
                  tournament: {
                    userId,
                    tournamentId,
                    name: 'Controlled Tournament',
                    finishPlace: 2,
                    entrants: 2,
                    prize: 0,
                    bountyWinnings: 0,
                    knockouts: 0,
                    rebuys: 0,
                    addOns: 0,
                  },
                }
              : {}),
          };
          const channel = new BroadcastChannel('club-arena-session-completion-v1');
          channel.postMessage({ owner: userId, payload });
          setTimeout(() => channel.close(), 0);
        },
        {
          userId,
          tableId: sample().tableId,
          asOf: sample().through_at,
          started: sample().started_at,
          tournamentId: sample().tournamentId,
          scope,
          occupancy: OCCUPANCY,
        }
      );
      const finalValue =
        scope === 'cash'
          ? page
              .locator('.ssh-tile')
              .filter({ has: page.locator('.ssh-tile__label', { hasText: /^Hands Played$/i }) })
              .locator('.ssh-tile__value')
          : page
              .locator('.trc2__session-stat')
              .filter({ has: page.locator('.trc2__session-label', { hasText: /^Hands$/i }) })
              .locator('.trc2__session-value');
      await countValue(finalValue, sample().hands_played - 1);
      finalReadPending = false;
      expect(sockets.size).toBeGreaterThan(0);
      for (const client of sockets)
        client.send(
          JSON.stringify({
            type: 'EVENT',
            tableId: sample().tableId,
            ts: Date.now(),
            payload: {
              type: 'table_unlocked',
              table_id: sample().tableId,
              hand_number: 72,
              seated_count: 2,
              next_state: 'waiting',
            },
          })
        );
      surfaces.push({
        scope,
        surface: 'final-results',
        expected: sample().hands_played,
        rendered: await countValue(finalValue, sample().hands_played),
      });
      await info.attach(`published-${scope}-hand-counts`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
      if (scope === 'cash')
        await page.getByRole('button', { name: 'Close Session Summary', exact: true }).click();
    }
    await readBuild('after');
    expect(rpcReads.some((row) => row.scope === 'cash' && row.asOf)).toBe(true);
    expect(rpcReads.some((row) => row.scope === 'tournament' && row.asOf)).toBe(true);
    const forwardedWrites = forwardedMethods.filter(
      (method) => !['GET', 'HEAD', 'OPTIONS'].includes(method)
    ).length;
    expect(forwardedWrites).toBe(0);
    await info.attach('published-session-hand-stats', {
      body: Buffer.from(
        JSON.stringify(
          {
            clientSha: expectedSha,
            syntheticTransport: true,
            actualDatabaseProof: false,
            actualPublishedAssets: true,
            reservedActor: !localQualification,
            syntheticAuthentication: localQualification,
            forwardedWrites,
            reloadVerified: true,
            finalSettlementVerified: true,
            finalSettlementMeaning:
              'controlled existing TABLE_UNLOCKED refresh; no actual settlement transaction',
            authoritativeSeatReceipt: false,
            financialReceipt: false,
            surfaces,
            bracket,
            refused,
            rpcReads,
          },
          null,
          2
        )
      ),
      contentType: 'application/json',
    });
  } finally {
    // Keep every write guard armed through unload of the synthetic hero.
    await context.close();
  }
});
