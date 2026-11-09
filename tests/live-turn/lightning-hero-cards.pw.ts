/** A Lightning player always sees the cards they were dealt.
 *
 * Mongo, 2026-11-09, Lightning hand 58167350: dealt in on a new seat, never
 * shown his hole cards, folded by the clock. This is the built app in a phone
 * viewport, signed in as the fixture player, in a Lightning pool room, with an
 * engine socket that speaks the production protocol and is answered in the
 * browser (nothing leaves this machine). It plays the frames in the orders the
 * transport can produce and withholds one delivery outright.
 *
 * Every case fails on the build before the fix (de2e7976): a room opened into
 * a live hand shows no cards at all there, because deliveries that arrive
 * before the page knows its player were discarded and nothing asked again.
 */
import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import { PLAYER, newBackend, signIn } from '../stale-client/mock-backend';

const ENGINE_HOST = 'engine.smarter.poker';
const ROOM = '11a70000-0000-4000-8000-0000000000a1';
const CLUSTER = 'c1a50000-0000-4000-8000-0000000000c1';
const CLUB = 'c1ab0000-0000-4000-8000-0000000000c1';

test.skip(!process.env.LIVE_TURN_DIST, 'requires the isolated build under test');
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

type Card = { rank: string; suit: string };
const HAND_ONE: Card[] = [
  { rank: 'A', suit: 's' },
  { rank: 'K', suit: 'd' },
];
const HAND_TWO: Card[] = [
  { rank: '7', suit: 'c' },
  { rank: '2', suit: 'h' },
];
const HAND_THREE: Card[] = [
  { rank: 'Q', suit: 'h' },
  { rank: 'J', suit: 'c' },
];

const villain = (n: number) => `0bb0ffee-0000-4000-8000-00000000006${n}`;

/** A Lightning hand as the engine publishes it to one room. */
function snapshot(hand: number, heroSeat: number) {
  const seats = [1, 2, 3, 4, 5, 6];
  let v = 0;
  const players = seats.map((seat) => {
    const hero = seat === heroSeat;
    const id = hero ? PLAYER : villain(++v);
    return {
      seat,
      user_id: id,
      username: hero ? 'Fixture' : `Villain${v}`,
      avatar_url: '',
      equipped_frame: '',
      equipped_aura: '',
      stack: 100,
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
  });
  return {
    table_id: ROOM,
    lightning_original_top_up: true,
    hand_id: `4a4d0000-0000-4000-8000-${String(hand).padStart(12, '0')}`,
    lightning: {
      hand_id: `4a4d0000-0000-4000-8000-${String(hand).padStart(12, '0')}`,
      cluster_id: CLUSTER,
      name: 'NLH 0.25/0.50 Lightning Games',
      small_blind: 0.25,
      big_blind: 0.5,
      variant: 'nlh',
      fast_fold_available: false,
    },
    hand_number: hand,
    pot: 0.75,
    community_cards: [],
    community_cards2: [],
    community_cards3: [],
    hand_variant: 'nlh',
    ante: 0,
    ante_mode: null,
    current_bet: 0.5,
    current_player: null,
    dealer_seat: 6,
    stage: 'preflop',
    winner_ids: [],
    winners: [],
    min_raise: 0.5,
    last_raise: 0.5,
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
    max_seats: 6,
    is_anonymous: false,
    waiting_for_bb_user_ids: [],
    post_bb_deferred_user_ids: [],
    posting_bb_user_ids: [],
    pots: [],
    action_history: [],
    players,
  };
}

/** The engine, for one room: the multiplexed protocol the page speaks. */
class LightningEngine {
  resyncs = 0;
  /** Hands the page reported re-requesting cards for. */
  rerequestedHands = 0;
  private sockets = new Set<WebSocketRoute>();
  private seq = 0;
  private eventSeq = 0;
  private state: ReturnType<typeof snapshot> | null = null;
  /** What a RESYNC re-sends, as rePushHoleCards does; null withholds it. */
  private heroCards: { hand: number; seat: number; cards: Card[] } | null = null;
  private pinger: ReturnType<typeof setInterval> | null = null;

  static async install(page: Page): Promise<LightningEngine> {
    const engine = new LightningEngine();
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
    ws.send(JSON.stringify({ type: 'SNAPSHOT', tableId: ROOM, seq: this.seq, state: this.state }));
  }

  private holeCardFrame(hand: number, seat: number, cards: Card[]) {
    return {
      type: 'USER_EVENT',
      tableId: ROOM,
      payload: {
        kind: 'hole_cards',
        row: { table_id: ROOM, user_id: PLAYER, seat_number: seat, hand_number: hand, cards },
      },
    };
  }

  private rePush(ws: WebSocketRoute): void {
    const h = this.heroCards;
    if (h) ws.send(JSON.stringify(this.holeCardFrame(h.hand, h.seat, h.cards)));
  }

  /** The private frame, as CARDS_DEALT sends it. */
  deal(hand: number, seat: number, cards: Card[]): void {
    this.heroCards = { hand, seat, cards };
    this.all(this.holeCardFrame(hand, seat, cards));
  }

  /** The engine holds the cards; nothing is sent until the room asks. */
  holdFor(hand: number, seat: number, cards: Card[]): void {
    this.heroCards = { hand, seat, cards };
  }

  handStarted(hand: number): void {
    this.eventSeq += 1;
    this.all({
      type: 'EVENT',
      tableId: ROOM,
      seq: this.eventSeq,
      ts: Date.now(),
      payload: {
        type: 'hand_started',
        table_id: ROOM,
        hand_number: hand,
        dealer_seat: 6,
        timestamp: Date.now(),
      },
    });
  }

  publish(hand: number, heroSeat: number): void {
    this.seq += 1;
    this.state = snapshot(hand, heroSeat);
    this.all({ type: 'SNAPSHOT', tableId: ROOM, seq: this.seq, state: this.state });
  }
}

function backend() {
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
      tables: [],
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
          member_count: 2,
          created_at: '2026-09-08T00:00:00Z',
        },
      ],
      club_members: [
        { club_id: CLUB, user_id: PLAYER, role: 'member', status: 'active', chip_balance: 5000 },
      ],
      user_table_settings: [{ user_id: PLAYER, auto_time_bank: false }],
      table_seats: [],
    },
  });
}

async function openRoom(page: Page, opts: { muted: boolean }): Promise<LightningEngine> {
  await signIn(page, backend());
  await page.addInitScript(
    ([room, cluster, club, muted]) => {
      // The room is a Lightning pool session of this tab (the Lightning route
      // registers it on the way in; a reload reads it back from here).
      sessionStorage.setItem(
        'ca.lightning.pool-sessions.v1',
        JSON.stringify([
          {
            poolSessionId: room,
            clusterId: cluster,
            meta: {
              clusterId: cluster,
              clubId: club,
              name: 'NLH 0.25/0.50 Lightning Games',
              variant: 'nlh',
              smallBlind: 0.25,
              bigBlind: 0.5,
              maxPlayers: 6,
              minBuyIn: 25,
              maxBuyIn: 50,
              handedness: 6,
              templateName: null,
              clusterMode: 'lightning',
              enabled: true,
            },
          },
        ])
      );
      if (muted) {
        localStorage.setItem('ca_sound_enabled', 'false');
        localStorage.setItem('club_arena_sounds', 'false');
      }
    },
    [ROOM, CLUSTER, CLUB, opts.muted] as const
  );
  const engine = await LightningEngine.install(page);
  // The page reports each hand it had to ask again for, once, by name.
  page.on('console', (m) => {
    if (m.type() === 'error' && m.text().includes('lightning_hole_cards_rerequested')) {
      engine.rerequestedHands += 1;
    }
  });
  // Hand 101 is already dealt when the room connects: the engine sends the
  // hero's cards with the first snapshot, as it does on every SUBSCRIBE.
  engine.publish(101, 6);
  engine.holdFor(101, 6, HAND_ONE);
  await page.goto(`table/${ROOM}`);
  await expect.poll(() => engine.connected, { timeout: 60_000 }).toBe(true);
  return engine;
}

/** The hero's own face-up cards, as words the page gives a screen reader. */
const heroCards = (page: Page) => page.locator('[data-card-count] img.card-image__img');
const heroWords = async (page: Page) =>
  (await heroCards(page).evaluateAll((nodes) => nodes.map((n) => (n as HTMLImageElement).alt)))
    .map((w) => w.toLowerCase())
    .sort();

/** Exactly this holding is on the hero's seat (waits for it to be drawn). */
async function expectHolding(page: Page, a: RegExp, b: RegExp): Promise<void> {
  await expect
    .poll(
      async () => {
        const words = await heroWords(page);
        return words.length === 2 && a.test(words.join(' | ')) && b.test(words.join(' | '))
          ? 'shown'
          : `showing [${words.join(' | ')}]`;
      },
      { timeout: 15_000 }
    )
    .toBe('shown');
}

/** Hand 101 was already live when the room opened. */
async function firstHand(page: Page, engine: LightningEngine): Promise<void> {
  await expectHolding(page, /ace/, /king/);
  // The cards the engine sent on SUBSCRIBE were shown without asking again,
  // although they reached the page before it knew its player.
  expect(engine.rerequestedHands, 'the join delivery was not lost').toBe(0);
  // The transport resyncs on its own while it connects; count from here.
  await page.waitForTimeout(1_000);
  engine.resyncs = 0;
}

for (const muted of [true, false]) {
  const sound = muted ? 'muted' : 'audible';

  test(`${sound}: cards, snapshot on a new seat, then hand start - the new hand is shown`, async ({
    page,
  }) => {
    const engine = await openRoom(page, { muted });
    try {
      await firstHand(page, engine);
      // Hand 102 seats the hero on seat 1. The private frame leads, the
      // snapshot follows, and HAND_STARTED lands last.
      engine.deal(102, 1, HAND_TWO);
      engine.publish(102, 1);
      await page.waitForTimeout(150);
      engine.handStarted(102);
      await expectHolding(page, /seven|7/, /two|deuce|2/);
      // And it stays: nothing later in the hand takes it away.
      engine.publish(102, 1);
      await page.waitForTimeout(2_500);
      await expectHolding(page, /seven|7/, /two|deuce|2/);
      expect(engine.resyncs, 'a hero holding cards never re-requests').toBe(0);
      expect(engine.rerequestedHands).toBe(0);
    } finally {
      engine.dispose();
    }
  });

  test(`${sound}: hand start, cards on the old seat, then the snapshot moves the hero`, async ({
    page,
  }) => {
    const engine = await openRoom(page, { muted });
    try {
      await firstHand(page, engine);
      engine.handStarted(102);
      engine.deal(102, 1, HAND_TWO);
      await page.waitForTimeout(150);
      engine.publish(102, 1);
      await expectHolding(page, /seven|7/, /two|deuce|2/);
      await page.waitForTimeout(2_500);
      await expectHolding(page, /seven|7/, /two|deuce|2/);
      expect(engine.resyncs).toBe(0);
      expect(engine.rerequestedHands).toBe(0);
    } finally {
      engine.dispose();
    }
  });
}

test('a lost delivery is asked for again, once is enough, and the asking stops', async ({
  page,
}) => {
  const engine = await openRoom(page, { muted: false });
  try {
    await firstHand(page, engine);
    // Hand 103: the engine dealt, the frame never reached this socket.
    engine.handStarted(103);
    engine.holdFor(103, 3, HAND_THREE);
    engine.publish(103, 3);
    await expectHolding(page, /queen/, /jack/);
    const asked = engine.resyncs;
    expect(engine.rerequestedHands, 'reported once, for this hand').toBe(1);
    expect(asked, 'the room asked the engine again').toBeGreaterThanOrEqual(1);
    expect(asked, 'and did not need its whole budget').toBeLessThanOrEqual(2);
    // Past every later rung of the ladder: no ask after the cards arrived.
    await page.waitForTimeout(11_000);
    expect(engine.resyncs).toBe(asked);
    await expectHolding(page, /queen/, /jack/);
  } finally {
    engine.dispose();
  }
});

test('a late answer for the previous hand never replaces the live hand', async ({ page }) => {
  const engine = await openRoom(page, { muted: true });
  try {
    await firstHand(page, engine);
    engine.handStarted(102);
    engine.deal(102, 1, HAND_TWO);
    engine.publish(102, 1);
    await expectHolding(page, /seven|7/, /two|deuce|2/);
    // The previous hand's cards, delivered late, as a delayed re-send would.
    engine.deal(101, 6, HAND_ONE);
    await page.waitForTimeout(1_500);
    await expectHolding(page, /seven|7/, /two|deuce|2/);
  } finally {
    engine.dispose();
  }
});
