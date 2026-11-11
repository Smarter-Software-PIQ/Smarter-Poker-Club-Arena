/** A tournament rebuy is taking a seat again: the rebought player sees their cards.
 *
 * MichaelJordan, Monday Night Turbo, 2026-11-10: busted, rebought on the same
 * table and seat, and was folded by the clock three hands running. The bust
 * set the page's left-seat latch and the rebuy receipt never cleared it, so
 * the delivery door dropped every hole-card frame until a reload.
 *
 * This is the built app, signed in as the fixture player at a tournament
 * table, with an engine socket that speaks the production protocol and a
 * Supabase that answers in the browser. Nothing leaves this machine: the
 * rebuy is a recorded receipt, not a purchase. FIXTURE EVIDENCE ONLY; it says
 * nothing about what any real player's screen showed.
 *
 * LIVE_TURN_EXPECT_DEFECT=1 asserts the defect instead, for a build that
 * predates the fix: the witness that the suite can fail.
 */
import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import { PLAYER, newBackend, signIn } from '../stale-client/mock-backend';

const ENGINE_HOST = 'engine.smarter.poker';
const TABLE = '7a8b0000-0000-4000-8000-0000000000d1';
const TOURNAMENT = '70a40000-0000-4000-8000-0000000000d1';
const CLUB = 'c1ab0000-0000-4000-8000-0000000000d1';
const HERO_SEAT = 7;
const EXPECT_DEFECT = process.env.LIVE_TURN_EXPECT_DEFECT === '1';

test.skip(!process.env.LIVE_TURN_DIST, 'requires the isolated build under test');
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

type Card = { rank: string; suit: string };
const BEFORE_BUST: Card[] = [
  { rank: 'K', suit: 'h' },
  { rank: 'Q', suit: 'h' },
];
const AFTER_REBUY: Card[] = [
  { rank: 'A', suit: 'd' },
  { rank: '3', suit: 'd' },
];
const NEXT_HAND: Card[] = [
  { rank: '9', suit: 'c' },
  { rank: '9', suit: 's' },
];

const villain = (n: number) => `0bb0ffee-0000-4000-8000-0000000000d${n}`;

type HeroState = 'playing' | 'busted' | 'absent';

/** A tournament hand as the engine publishes it to the table. */
function snapshot(hand: number, hero: HeroState, heroStack: number) {
  const seats = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  let v = 0;
  const players = seats
    .map((seat) => {
      const isHero = seat === HERO_SEAT;
      if (isHero && hero === 'absent') return null;
      const id = isHero ? PLAYER : villain(++v);
      return {
        seat,
        user_id: id,
        username: isHero ? 'Fixture' : `Villain${v}`,
        avatar_url: '',
        equipped_frame: '',
        equipped_aura: '',
        stack: isHero ? heroStack : 5000,
        bet: 0,
        totalInvested: 0,
        cards: [],
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
        is_disconnected: false,
        time_bank_remaining: 40,
        time_bank_uses_remaining: 2,
        position: '',
        session_baseline: 0,
        stay_remaining_ms: 0,
        stay_running: false,
        leave_locked: false,
        is_waiting_for_bb: false,
        is_mucked: false,
        hand_name: '',
      };
    })
    .filter(Boolean);
  return {
    table_id: TABLE,
    tournament_id: TOURNAMENT,
    hand_id: `4a4d0000-0000-4000-8000-${String(hand).padStart(12, '0')}`,
    hand_number: hand,
    pot: hero === 'busted' ? 0 : 1200,
    community_cards: [],
    community_cards2: [],
    community_cards3: [],
    hand_variant: 'nlh',
    ante: 800,
    ante_mode: 'big_blind',
    current_bet: 800,
    current_player: null,
    dealer_seat: 3,
    stage: hero === 'busted' ? 'waiting' : 'preflop',
    winner_ids: [],
    winners: [],
    min_raise: 800,
    last_raise: 800,
    betting_structure: 'no_limit',
    action_context: null,
    turn_start_time_ms: 0,
    turn_duration_ms: 0,
    server_time_ms: Date.now(),
    discard_deadline_ms: null,
    discard_deadlines: {},
    discard_duration_ms: 0,
    turn_deadline_ms: 0,
    time_bank_active: false,
    disconnect_states: {},
    max_seats: 9,
    is_anonymous: false,
    waiting_for_bb_user_ids: [],
    post_bb_deferred_user_ids: [],
    posting_bb_user_ids: [],
    pots: [],
    action_history: [],
    players,
  };
}

/** The engine, for one tournament table: the multiplexed protocol the page speaks. */
class TournamentEngine {
  private sockets = new Set<WebSocketRoute>();
  private seq = 0;
  private eventSeq = 0;
  private state: ReturnType<typeof snapshot> | null = null;
  /** What a SUBSCRIBE or RESYNC re-sends, as rePushHoleCards does. */
  private heroCards: { hand: number; cards: Card[] } | null = null;
  private pinger: ReturnType<typeof setInterval> | null = null;
  resyncs = 0;

  static async install(page: Page): Promise<TournamentEngine> {
    const engine = new TournamentEngine();
    await page.routeWebSocket(
      (url) => url.hostname === ENGINE_HOST,
      (ws) => engine.onSocket(ws)
    );
    await page.route(
      (url) => url.hostname === ENGINE_HOST,
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' },
          body: JSON.stringify({ ok: true, success: true }),
        })
    );
    engine.pinger = setInterval(() => engine.all({ type: 'PING', ts: Date.now() }), 5_000);
    return engine;
  }

  dispose(): void {
    if (this.pinger) clearInterval(this.pinger);
  }

  get connected(): boolean {
    return this.sockets.size > 0;
  }

  private onSocket(ws: WebSocketRoute): void {
    ws.onMessage((data) => {
      let msg: { type?: string; tableId?: string } | null = null;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (!msg?.type) return;
      if (msg.type === 'SUBSCRIBE') {
        this.sockets.add(ws);
        ws.send(JSON.stringify({ type: 'SUBSCRIBED', tableId: msg.tableId }));
        this.sendState(ws);
        this.rePush(ws);
      } else if (msg.type === 'RESYNC') {
        this.resyncs += 1;
        this.sendState(ws);
        this.rePush(ws);
      } else if (msg.type === 'UNSUBSCRIBE') {
        this.sockets.delete(ws);
      }
    });
    ws.onClose(() => this.sockets.delete(ws));
  }

  private all(frame: unknown): void {
    for (const ws of this.sockets) {
      try {
        ws.send(JSON.stringify(frame));
      } catch {
        /* a closed socket removes itself */
      }
    }
  }

  private sendState(ws: WebSocketRoute): void {
    if (!this.state) return;
    ws.send(JSON.stringify({ type: 'SNAPSHOT', tableId: TABLE, seq: this.seq, state: this.state }));
  }

  private holeCardFrame(hand: number, cards: Card[]) {
    return {
      type: 'USER_EVENT',
      tableId: TABLE,
      payload: {
        kind: 'hole_cards',
        row: {
          table_id: TABLE,
          user_id: PLAYER,
          seat_number: HERO_SEAT,
          hand_number: hand,
          cards,
        },
      },
    };
  }

  private rePush(ws: WebSocketRoute): void {
    const h = this.heroCards;
    if (h) ws.send(JSON.stringify(this.holeCardFrame(h.hand, h.cards)));
  }

  /** The private frame, as CARDS_DEALT sends it. */
  deal(hand: number, cards: Card[]): void {
    this.heroCards = { hand, cards };
    this.all(this.holeCardFrame(hand, cards));
  }

  /** A stale private frame for an older hand, as a delayed re-send would arrive. */
  late(hand: number, cards: Card[]): void {
    this.all(this.holeCardFrame(hand, cards));
  }

  /** The engine holds the cards; nothing is sent until the table asks. */
  holdFor(hand: number, cards: Card[]): void {
    this.heroCards = { hand, cards };
  }

  private event(payload: Record<string, unknown>): void {
    this.eventSeq += 1;
    this.all({ type: 'EVENT', tableId: TABLE, seq: this.eventSeq, ts: Date.now(), payload });
  }

  handStarted(hand: number): void {
    this.event({
      type: 'hand_started',
      table_id: TABLE,
      hand_number: hand,
      dealer_seat: 3,
      timestamp: Date.now(),
    });
  }

  /** The bust vacates the seat, as removeEliminatedTournamentSeat publishes it. */
  seatLeft(reason: string): void {
    this.heroCards = null;
    this.event({
      type: 'seat_left',
      table_id: TABLE,
      seat: HERO_SEAT,
      user_id: PLAYER,
      reason,
      timestamp: Date.now(),
    });
  }

  publish(hand: number, hero: HeroState, heroStack = 5000): void {
    this.seq += 1;
    this.state = snapshot(hand, hero, heroStack);
    this.all({ type: 'SNAPSHOT', tableId: TABLE, seq: this.seq, state: this.state });
  }
}

const now = () => new Date().toISOString();

/** The hero's physical seat, as `table_seats` holds it. The bust's hand-stack
 *  RPC removes it in one transaction; the rebuy's atomic purchase writes it back. */
const heroSeatRow = (stack: number) => ({
  id: '5ea70000-0000-4000-8000-0000000000d7',
  table_id: TABLE,
  seat_number: HERO_SEAT,
  user_id: PLAYER,
  player_id: PLAYER,
  stack,
  status: 'active',
  is_sitting_out: false,
  is_away: false,
  left_at: null,
  joined_at: '2026-11-10T01:50:41Z',
  club_id: CLUB,
});

interface Fixture {
  rebuys: number;
  seats: Record<string, unknown>[];
  /** Reads of the rebuy eligibility row (canRebuy's `rebuy_prompt_until` select). */
  eligibilityReads: number;
  /** While set, tournament reads made after an eligibility read wait on it:
   *  the price read the offer makes is held until the seat exit has landed. */
  hold: { after: number; until: Promise<void> } | null;
  /** The hero's own `table_hole_cards` row, as the engine writes it on deal. */
  holeCards: Record<string, unknown>[];
}

function backend(fx: Fixture) {
  const profile = {
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
  };
  const tournament = {
    id: TOURNAMENT,
    club_id: CLUB,
    name: 'Fixture Night Turbo',
    game_type: 'nlh',
    variant: 'nlh',
    tournament_type: 'mtt',
    format_contract: 'mtt-v1',
    status: 'RUNNING',
    buy_in_amount: 18,
    buy_in_fee: 2,
    is_rebuy: true,
    is_reentry: true,
    rebuy_cost: 20,
    rebuy_chips: 5000,
    rebuy_levels: 20,
    late_reg_levels: 20,
    late_reg_mins: 600,
    max_rebuys: 10,
    starting_chips: 5000,
    add_on_available: false,
    prize_pool_finalized: false,
    current_level: 1,
    level_started_at: now(),
    start_time: now(),
    started_at: now(),
    blind_structure: 'turbo',
    blind_speed: 'turbo',
    current_players: 9,
    max_players: 100,
    table_size: 9,
    on_break: false,
    entry_contract_locked: true,
  };
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
      process_tournament_rebuy: (args) => {
        fx.rebuys += 1;
        fx.seats.splice(0, fx.seats.length, heroSeatRow(5000));
        return {
          body: {
            success: true,
            atomic_tournament_chip_purchase: 'v1',
            rebuy_type: args.p_rebuy_type,
            new_stack: 5000,
            seated: true,
            table_id: TABLE,
            seat_number: HERO_SEAT,
          },
        };
      },
    },
    tables: {
      tables: [
        {
          id: TABLE,
          club_id: CLUB,
          union_id: null,
          tournament_id: TOURNAMENT,
          arena: { id: CLUB, asset: 'chips', is_platform: false, union_id: null },
          name: 'Fixture Night Turbo - Table 1',
          game_variant: 'nlh',
          game_type: 'tournament',
          status: 'playing',
          small_blind: 400,
          big_blind: 800,
          max_players: 9,
          current_players: 9,
          is_deleted: false,
          created_at: '2026-11-10T00:00:00Z',
        },
      ],
      tournaments: [tournament],
      tournament_players: [
        {
          tournament_id: TOURNAMENT,
          user_id: PLAYER,
          username: 'fixture',
          // As the server writes a bust: a zero-stack entry inside its window.
          status: 'playing',
          chips: 0,
          prize: 0,
          rebuy_prompt_until: new Date(Date.now() + 10 * 60_000).toISOString(),
          rebuys: fx.rebuys,
          add_on: false,
          table_id: TABLE,
          seat_number: HERO_SEAT,
          club_id: CLUB,
        },
      ],
      profiles: [profile],
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
          member_count: 10,
          created_at: '2026-09-08T00:00:00Z',
        },
      ],
      club_members: [
        { club_id: CLUB, user_id: PLAYER, role: 'member', status: 'active', chip_balance: 5000 },
      ],
      user_table_settings: [{ user_id: PLAYER, auto_time_bank: false }],
      table_seats: fx.seats,
      table_hole_cards: fx.holeCards,
    },
  });
}

async function openTable(page: Page, fx: Fixture): Promise<TournamentEngine> {
  const b = backend(fx);
  await signIn(page, b);
  // Registered after signIn, so it runs first; the mock still answers.
  await page.route(
    (url) => url.pathname.endsWith('/rest/v1/tournament_players'),
    (route, request) => {
      if (new URL(request.url()).searchParams.get('select')?.includes('rebuy_prompt_until'))
        fx.eligibilityReads += 1;
      return route.fallback();
    }
  );
  await page.route(
    (url) => url.pathname.endsWith('/rest/v1/tournaments'),
    async (route) => {
      const hold = fx.hold;
      if (hold && fx.eligibilityReads > hold.after) await hold.until;
      return route.fallback();
    }
  );
  await page.addInitScript(() => {
    localStorage.setItem('ca_sound_enabled', 'false');
    localStorage.setItem('club_arena_sounds', 'false');
  });
  const engine = await TournamentEngine.install(page);
  // Hand 200 is live when the table opens; the hero holds K-Q of hearts.
  engine.publish(200, 'playing');
  engine.holdFor(200, BEFORE_BUST);
  await page.goto(`table/${TABLE}`);
  await expect.poll(() => engine.connected, { timeout: 60_000 }).toBe(true);
  return engine;
}

/** The hero's own face-up cards, as words the page gives a screen reader. */
const heroWords = async (page: Page) =>
  (
    await page
      .locator('[data-card-count] img.card-image__img')
      .evaluateAll((nodes) => nodes.map((n) => (n as HTMLImageElement).alt))
  )
    .map((w) => w.toLowerCase())
    .sort();

async function expectHolding(page: Page, a: RegExp, b: RegExp, timeout = 15_000) {
  await expect
    .poll(
      async () => {
        const words = await heroWords(page);
        return words.length === 2 && a.test(words.join(' | ')) && b.test(words.join(' | '))
          ? 'shown'
          : `showing [${words.join(' | ')}]`;
      },
      { timeout }
    )
    .toBe('shown');
}

async function expectNoCards(page: Page, holdMs = 2_500) {
  await page.waitForTimeout(holdMs);
  expect(await heroWords(page)).toEqual([]);
}

/** Bust: the busting hand settles with the hero on a zero stack, the engine
 *  vacates the seat, and the page opens its rebuy offer. */
async function bust(page: Page, engine: TournamentEngine, fx: Fixture): Promise<void> {
  await expectHolding(page, /king/, /queen/);
  // As the engine does at hand commit: the settled snapshot with the hero on a
  // zero stack, then the seat exit committed by the hand-stack RPC and
  // published as seat_left with the next snapshot. The exit lands while the
  // page is still pricing its rebuy offer (the price read is held until it
  // has), which is the order in which the offer survives the exit.
  let release = () => {};
  const before = fx.eligibilityReads;
  fx.hold = { after: before, until: new Promise<void>((resolve) => (release = resolve)) };
  engine.publish(200, 'busted', 0);
  await expect.poll(() => fx.eligibilityReads, { timeout: 10_000 }).toBeGreaterThan(before);
  fx.seats.splice(0, fx.seats.length);
  engine.seatLeft('busted_awaiting_rebuy_decision');
  engine.publish(200, 'absent');
  await page.waitForTimeout(400);
  fx.hold = null;
  release();
  await expect(rebuyConfirm(page)).toBeVisible({ timeout: 20_000 });
}

/** Pay for the rebuy. Fails fast, naming what the offer says, when it cannot be confirmed. */
async function confirmRebuy(page: Page): Promise<void> {
  const button = rebuyConfirm(page);
  try {
    await expect(button).toBeEnabled({ timeout: 10_000 });
  } catch (error) {
    const said = await page
      .locator('[aria-labelledby="rebuy-modal-title"]')
      .innerText()
      .catch(() => '(no offer)');
    throw new Error(
      `The rebuy could not be confirmed. The offer said: ${said.replace(/\s+/g, ' ')}`,
      {
        cause: error,
      }
    );
  }
  await button.click();
}

const rebuyConfirm = (page: Page) =>
  page.getByRole('button', { name: /^(confirm( rebuy)?|rebuy)\b/i }).last();

test('bust, paid rebuy, seat restored: the next hand is dealt face up', async ({ page }) => {
  const fx: Fixture = {
    rebuys: 0,
    seats: [heroSeatRow(5000)],
    eligibilityReads: 0,
    hold: null,
    holeCards: [],
  };
  const engine = await openTable(page, fx);
  try {
    await bust(page, engine, fx);
    await confirmRebuy(page);
    await expect.poll(() => fx.rebuys, { timeout: 15_000 }).toBe(1);
    // The engine seats the rebuy and deals hand 201: snapshot, start, cards.
    engine.publish(201, 'playing');
    engine.handStarted(201);
    engine.deal(201, AFTER_REBUY);
    if (EXPECT_DEFECT) {
      await expectNoCards(page, 6_000);
      return;
    }
    await expectHolding(page, /ace/, /three|3/);
    // And the hand after that, too.
    engine.publish(202, 'playing');
    engine.handStarted(202);
    engine.deal(202, NEXT_HAND);
    await expectHolding(page, /nine|9/, /nine|9/);
  } finally {
    engine.dispose();
  }
});

test('after a rebuy, cards that lead the seating snapshot are still shown', async ({ page }) => {
  test.skip(EXPECT_DEFECT, 'the defect is witnessed by the in-order case');
  const fx: Fixture = {
    rebuys: 0,
    seats: [heroSeatRow(5000)],
    eligibilityReads: 0,
    hold: null,
    holeCards: [],
  };
  const engine = await openTable(page, fx);
  try {
    await bust(page, engine, fx);
    await confirmRebuy(page);
    await expect.poll(() => fx.rebuys, { timeout: 15_000 }).toBe(1);
    // Reordered: the private frame and hand start reach the page before the
    // snapshot that seats the hero again.
    engine.deal(201, AFTER_REBUY);
    engine.handStarted(201);
    await page.waitForTimeout(300);
    engine.publish(201, 'playing');
    await expectHolding(page, /ace/, /three|3/);
  } finally {
    engine.dispose();
  }
});

test('after a rebuy, a lost delivery is recovered from the engine', async ({ page }) => {
  test.skip(EXPECT_DEFECT, 'the defect is witnessed by the in-order case');
  const fx: Fixture = {
    rebuys: 0,
    seats: [heroSeatRow(5000)],
    eligibilityReads: 0,
    hold: null,
    holeCards: [],
  };
  const engine = await openTable(page, fx);
  try {
    await bust(page, engine, fx);
    await confirmRebuy(page);
    await expect.poll(() => fx.rebuys, { timeout: 15_000 }).toBe(1);
    // Delayed: the engine dealt and wrote the hero's row, the frame never
    // reached this socket. The page has to recover the cards itself.
    engine.holdFor(201, AFTER_REBUY);
    fx.holeCards.splice(0, fx.holeCards.length, {
      table_id: TABLE,
      user_id: PLAYER,
      hand_number: 201,
      cards: AFTER_REBUY,
    });
    engine.publish(201, 'playing');
    engine.handStarted(201);
    await expectHolding(page, /ace/, /three|3/, 25_000);
  } finally {
    engine.dispose();
  }
});

test('after a rebuy, a late frame for the busted hand never replaces the live hand', async ({
  page,
}) => {
  test.skip(EXPECT_DEFECT, 'the defect is witnessed by the in-order case');
  const fx: Fixture = {
    rebuys: 0,
    seats: [heroSeatRow(5000)],
    eligibilityReads: 0,
    hold: null,
    holeCards: [],
  };
  const engine = await openTable(page, fx);
  try {
    await bust(page, engine, fx);
    await confirmRebuy(page);
    await expect.poll(() => fx.rebuys, { timeout: 15_000 }).toBe(1);
    engine.publish(201, 'playing');
    engine.handStarted(201);
    engine.deal(201, AFTER_REBUY);
    await expectHolding(page, /ace/, /three|3/);
    // The busted hand's cards, delivered late.
    engine.late(200, BEFORE_BUST);
    await page.waitForTimeout(2_000);
    await expectHolding(page, /ace/, /three|3/);
  } finally {
    engine.dispose();
  }
});

test('a bust that is not rebought shows no further cards', async ({ page }) => {
  const fx: Fixture = {
    rebuys: 0,
    seats: [heroSeatRow(5000)],
    eligibilityReads: 0,
    hold: null,
    holeCards: [],
  };
  const engine = await openTable(page, fx);
  try {
    await bust(page, engine, fx);
    // No rebuy. The table deals on without the hero; a stray private frame
    // for the next hand must not put cards in front of a player with no seat.
    engine.publish(201, 'absent');
    engine.handStarted(201);
    engine.late(201, AFTER_REBUY);
    await expectNoCards(page);
    expect(fx.rebuys, 'no purchase was made').toBe(0);
  } finally {
    engine.dispose();
  }
});
