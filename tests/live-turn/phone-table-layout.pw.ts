/** The phone table's bottom row, hero seat, action pill and top inset.
 *
 * Dan, 2026-11-11, from his phone:
 *   3. The action buttons are far too small. Double them, growing upward until
 *      their top edge sits just under the bottom-center seat box (its name
 *      plate and the hand label under it). The Previous Hand button moves up
 *      with them. The hero's avatar is always the size of every other avatar.
 *   5. The action pill shows the hero's cards ONLY. The hero's own action
 *      (Check, Call, Fold, Bet, Raise, All In) shows on the seat, never in it.
 *   6. Nothing is ever cut off at the top: the notch, the Dynamic Island and
 *      the status bar of an installed app are always cleared.
 *
 * WHY THESE WERE BROKEN. Since 2026-10-25 a portrait phone lays the table out
 * at PHONE_TABLE_LAYOUT_WIDTH_PX (600 CSS px) and the browser scales it down
 * (useTableEnvironment). Every phone rule written as `@media (max-width:
 * 480px)` therefore never matched at the table, including the 2026-11-09
 * doubling of the buttons and the installed-app status bar floor. And the
 * browser reports env(safe-area-inset-top) in unscaled CSS px, so at a scale
 * of 0.65 the notch band was paid at 65% of its height (measured below).
 *
 * This is the built app in real phone viewports, signed in as the fixture
 * player, at a table whose engine socket is answered in the browser. Every
 * measurement is in the 600px layout's own CSS px unless it says device px.
 */
import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PLAYER, newBackend, signIn } from '../stale-client/mock-backend';

const ENGINE_HOST = 'engine.smarter.poker';
const TABLE = '7ab1e000-0000-4000-8000-0000000000bb';
const ROOM = '11a70000-0000-4000-8000-0000000000b1';
const CLUSTER = 'c1a50000-0000-4000-8000-0000000000b1';
const CLUB = 'c1ab0000-0000-4000-8000-0000000000c1';
/** The bar's button height before this change: the desktop clamp() at the
 *  600px layout width (36.5px + 2.545vw = 51.8px), which every phone drew. */
const PREVIOUS_BUTTON_PX = 51.8;
/** "Just below" the bottom-center seat: no overlap, and no more air than this. */
const MAX_SEAT_GAP_PX = 24;
/** An iPhone 15 Pro's Dynamic Island band, in device px (points). */
const NOTCH_PX = 59;
/** Evidence screenshots are taken at a real iPhone's density; the gate runs
 *  at 1x, which measures the same layout and keeps a failure's trace small. */
const SHOT_DPR = process.env.PHONE_LAYOUT_SHOTS ? 3 : 1;

test.skip(!process.env.LIVE_TURN_DIST, 'requires the isolated build under test');
test.skip(({ browserName }) => browserName !== 'chromium', 'safe-area emulation is Chromium CDP');
// A retained trace of this animated table did not finish writing inside the
// test's budget (measured: a red assertion became a 60s timeout). A failure
// keeps its screenshot and every assertion names the measurement it read.
test.use({ trace: 'off', screenshot: 'only-on-failure' });

type Card = { rank: string; suit: string };
const HERO_CARDS: Card[] = [
  { rank: 'T', suit: 'h' },
  { rank: '4', suit: 'c' },
];
const villain = (n: number) => `0bb0ffee-0000-4000-8000-0000000000${String(60 + n)}`;
const NAMES = [
  'KingFish',
  'Marlin',
  'Barracuda',
  'Snapper',
  'Grouper',
  'Wahoo',
  'Tarpon',
  'Bonito',
];

interface Scenario {
  name: string;
  width: number;
  height: number;
  seats: 6 | 9;
  bombPot?: boolean;
  lightning?: boolean;
  plo4?: boolean;
  /** A Lightning game still in its feeder (MUST MOVE) game: its own table, the
   *  game's live players and Lightning start count as the database reports them. */
  feeder?: { live: number; on: number };
  /** Portraits: the hero's and the opponents'. Absent: initials everywhere. */
  art?: { hero: Portrait; opponents: Portrait[] };
}
type Portrait = 'photo' | 'wolf' | 'aztec' | 'initials';
const ART_HOST = 'https://smarter.poker';
const PORTRAIT_URL: Record<Portrait, string> = {
  photo: `${ART_HOST}/avatars/fixture/photo.png`,
  wolf: `${ART_HOST}/avatars/table/vip_wolf@2x.webp`,
  aztec: `${ART_HOST}/avatars/table/vip_aztec_warrior@2x.webp`,
  initials: '',
};

function snapshot(s: Scenario, heroSeat: number) {
  const id = s.lightning ? ROOM : TABLE;
  let v = 0;
  const fullRing = Array.from({ length: s.seats }, (_, i) => {
    const seat = i + 1;
    const hero = seat === heroSeat;
    const user = hero ? PLAYER : villain(++v);
    return {
      seat,
      user_id: user,
      username: hero ? 'Fixture' : NAMES[v - 1],
      avatar_url: s.art
        ? PORTRAIT_URL[hero ? s.art.hero : s.art.opponents[(v - 1) % s.art.opponents.length]]
        : '',
      equipped_frame: '',
      equipped_aura: '',
      stack: 1000,
      bet: s.plo4 && seat === 4 ? 4 : 0,
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
  const players = s.plo4 ? fullRing.filter((p) => p.seat === heroSeat || p.seat === 4) : fullRing;
  const now = Date.now();
  return {
    table_id: id,
    ...(s.lightning
      ? {
          lightning_original_top_up: true,
          hand_id: '4a4d0000-0000-4000-8000-000000000101',
          lightning: {
            hand_id: '4a4d0000-0000-4000-8000-000000000101',
            cluster_id: CLUSTER,
            name: s.plo4 ? 'PLO4 0.25/0.50 Lightning Games' : 'NLH 0.25/0.50 Lightning Games',
            small_blind: 0.25,
            big_blind: 0.5,
            variant: s.plo4 ? 'plo4' : 'nlh',
            fast_fold_available: false,
          },
        }
      : {}),
    hand_number: 101,
    pot: s.plo4 ? 16 : 15,
    community_cards: [
      { rank: 'K', suit: 's' },
      { rank: '8', suit: 'd' },
      { rank: '2', suit: 'c' },
    ],
    community_cards2: [],
    community_cards3: [],
    hand_variant: s.plo4 ? 'plo4' : 'nlh',
    bomb_pot_in: s.bombPot ? 3 : null,
    bomb_pot_next_at: null,
    bomb_pot_waiting_for: null,
    kill_hand: null,
    kill_next: null,
    ante: 0,
    ante_mode: null,
    current_bet: s.plo4 ? 4 : 0,
    current_player: PLAYER,
    dealer_seat: s.plo4 ? 4 : s.seats,
    stage: 'flop',
    winner_ids: [],
    winners: [],
    min_raise: 5,
    last_raise: 5,
    betting_structure: 'no_limit',
    action_context: `4a4d0000-0000-4000-8000-000000000101:flop:0:${heroSeat}:0`,
    turn_start_time_ms: now,
    turn_duration_ms: 600_000,
    server_time_ms: now,
    discard_deadline_ms: null,
    discard_deadlines: {},
    discard_duration_ms: 0,
    turn_deadline_ms: now + 600_000,
    time_bank_active: false,
    disconnect_states: {},
    max_seats: s.seats,
    is_anonymous: false,
    waiting_for_bb_user_ids: [],
    post_bb_deferred_user_ids: [],
    posting_bb_user_ids: [],
    pots: [],
    action_history: [],
    players,
  };
}

/** The engine for one table: the multiplexed protocol the page speaks. */
class TableEngine {
  private sockets = new Set<WebSocketRoute>();
  private seq = 0;
  private eventSeq = 0;
  private state: ReturnType<typeof snapshot>;
  private pinger: ReturnType<typeof setInterval> | null = null;

  private constructor(
    private s: Scenario,
    private heroSeat: number
  ) {
    this.state = snapshot(s, heroSeat);
  }

  get id(): string {
    return this.s.lightning ? ROOM : TABLE;
  }

  static async install(page: Page, s: Scenario, heroSeat: number): Promise<TableEngine> {
    const engine = new TableEngine(s, heroSeat);
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

  private disposers: Array<() => void> = [];

  onDispose(fn: () => void): void {
    this.disposers.push(fn);
  }

  dispose(): void {
    if (this.pinger) clearInterval(this.pinger);
    for (const fn of this.disposers.splice(0)) fn();
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
        this.send(ws);
      } else if (msg.type === 'RESYNC') {
        this.send(ws);
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

  private send(ws: WebSocketRoute): void {
    ws.send(
      JSON.stringify({ type: 'SNAPSHOT', tableId: this.id, seq: this.seq, state: this.state })
    );
    ws.send(
      JSON.stringify({
        type: 'USER_EVENT',
        tableId: this.id,
        payload: {
          kind: 'hole_cards',
          row: {
            table_id: this.id,
            user_id: PLAYER,
            seat_number: this.heroSeat,
            hand_number: this.state.hand_number,
            cards: this.s.plo4
              ? [...HERO_CARDS, { rank: '2', suit: 'd' }, { rank: '2', suit: 'h' }]
              : HERO_CARDS,
          },
        },
      })
    );
  }

  /** The hero checks: the engine's own action event, then the next turn. */
  heroChecks(): void {
    this.eventSeq += 1;
    this.all({
      type: 'EVENT',
      tableId: this.id,
      seq: this.eventSeq,
      ts: Date.now(),
      payload: {
        type: 'player_action',
        table_id: this.id,
        hand_number: this.state.hand_number,
        seat: this.heroSeat,
        user_id: PLAYER,
        action: 'check',
        amount: 0,
        stage: 'flop',
        timestamp: Date.now(),
      },
    });
    const next = this.state.players.find((p) => p.seat !== this.heroSeat)!;
    this.seq += 1;
    this.state = {
      ...this.state,
      current_player: next.user_id,
      action_context: `4a4d0000-0000-4000-8000-000000000101:flop:1:${next.seat}:0`,
      action_history: [
        {
          seat: this.heroSeat,
          userId: PLAYER,
          action: 'check',
          amount: 0,
          timestamp: Date.now(),
          stage: 'flop',
        },
      ] as never[],
    };
    this.all({ type: 'SNAPSHOT', tableId: this.id, seq: this.seq, state: this.state });
  }
}

function backendFor(s: Scenario, heroSeat: number) {
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
  const arena = { id: CLUB, asset: 'chips', is_platform: false, union_id: null };
  return newBackend({
    engineHttp: 'answered',
    rpc: {
      ...(s.feeder
        ? {
            fn_cash_game_lobby: () => ({
              body: {
                lightning: {
                  lightning_enabled: true,
                  cluster_mode: 'must_move',
                  verdict: { live_eligible: s.feeder!.live },
                  thresholds: { on: s.feeder!.on, off: s.feeder!.on - 1 },
                },
              },
            }),
          }
        : {}),
      fn_poker_arena_context: () => ({
        body: {
          arena,
          member: true,
          role: 'player',
          cashGamesEnabled: true,
          tournamentsEnabled: true,
        },
      }),
    },
    tables: {
      tables: s.lightning
        ? []
        : [
            {
              id: TABLE,
              club_id: CLUB,
              arena,
              union_id: null,
              tournament_id: null,
              name: 'NLH 2/5',
              ...(s.feeder ? { cluster_id: CLUSTER } : {}),
              game_variant: 'nlh',
              game_type: 'cash',
              status: 'running',
              small_blind: 2,
              big_blind: 5,
              min_buy_in: 200,
              max_buy_in: 1000,
              max_players: s.seats,
              current_players: s.seats,
              action_time_seconds: 15,
              bomb_pot_enabled: !!s.bombPot,
              bomb_pot_frequency: s.bombPot ? 10 : null,
              is_deleted: false,
              created_at: '2026-09-29T00:00:00Z',
            },
          ],
      ...(s.plo4
        ? {
            user_theme_settings: [
              {
                user_id: PLAYER,
                game_type: 'ALL',
                table_id: 'carbon_red',
                background_id: 'midnight',
                button_id: 'classic-white',
                cards_id: 'classic_red',
              },
            ],
          }
        : {}),
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
          member_count: s.seats,
          created_at: '2026-09-08T00:00:00Z',
        },
      ],
      club_members: [
        { club_id: CLUB, user_id: PLAYER, role: 'member', status: 'active', chip_balance: 5000 },
      ],
      user_table_settings: [{ user_id: PLAYER, auto_time_bank: false }],
      table_seats: s.lightning
        ? []
        : [
            {
              id: '5ea70000-0000-4000-8000-000000000003',
              table_id: TABLE,
              user_id: PLAYER,
              seat_number: heroSeat,
              stack: 1000,
              status: 'active',
              is_sitting_out: false,
              sit_out_at: null,
              left_at: null,
              leave_pending: false,
              joined_at: '2026-10-04T19:40:00Z',
              profiles: profile,
            },
          ],
    },
  });
}

async function openTable(page: Page, s: Scenario): Promise<TableEngine> {
  const heroSeat = 1;
  // The Dynamic Island, as the phone reports it, before the first paint.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', {
    insets: { top: NOTCH_PX, bottom: 34 },
  });
  // A phone can open its table with browser chrome showing, then reclaim that
  // screen space. The stable felt budget is smaller than the visible action slot.
  if (s.plo4)
    await cdp.send('Emulation.setSmallViewportHeightDifferenceOverride', { difference: 110 });
  await signIn(page, backendFor(s, heroSeat));
  if (s.lightning) {
    await page.addInitScript(
      ([room, cluster, club, plo4]) => {
        sessionStorage.setItem(
          'ca.lightning.pool-sessions.v1',
          JSON.stringify([
            {
              poolSessionId: room,
              clusterId: cluster,
              meta: {
                clusterId: cluster,
                clubId: club,
                name: plo4 ? 'PLO4 0.25/0.50 Lightning Games' : 'NLH 0.25/0.50 Lightning Games',
                variant: plo4 ? 'plo4' : 'nlh',
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
      },
      [ROOM, CLUSTER, CLUB, s.plo4 ?? false] as const
    );
  }
  await page.addInitScript(() => {
    localStorage.setItem('ca_sound_enabled', 'false');
    localStorage.setItem('club_arena_sounds', 'false');
  });
  // Portraits are the bundled fixture art, served here: nothing leaves the machine.
  await page.route(
    (url) => url.hostname === 'smarter.poker' && url.pathname.startsWith('/avatars/'),
    (route) => {
      const path = new URL(route.request().url()).pathname;
      const file = path.endsWith('photo.png')
        ? 'public/default-avatar.png'
        : `tests/e2e/fixtures/table-art/${path.split('/').pop()}`;
      return route.fulfill({
        path: resolve(process.cwd(), file),
        headers: { 'access-control-allow-origin': '*' },
      });
    }
  );
  if (s.plo4) {
    await page.route('**/storage/v1/object/public/assets/buttons/black/icon-*.webp', (route) => {
      const icon = new URL(route.request().url()).pathname.split('/').pop();
      const files: Record<string, string> = {
        'icon-hamburger.webp': 'public/images/btn-hamburger.webp',
        'icon-chat.webp': 'tests/e2e/fixtures/table-art/icon-chat.webp',
        'icon-prevhand.webp': 'tests/e2e/fixtures/table-art/icon-prevhand.webp',
      };
      return icon && files[icon]
        ? route.fulfill({
            path: resolve(files[icon]),
            headers: { 'access-control-allow-origin': '*' },
          })
        : route.fallback();
    });
  }
  const engine = await TableEngine.install(page, s, heroSeat);
  engine.onDispose(() => cdp.detach().catch(() => {}));
  await page.goto(`table/${engine.id}`);
  await expect.poll(() => engine.connected, { timeout: 60_000 }).toBe(true);
  await expect(page.locator('.action-panel .action-btn').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.seat-wrapper--hero .seat__strength')).toBeVisible({
    timeout: 15_000,
  });
  // Seat arrival and the deal settle before anything is measured.
  await page.waitForTimeout(2_000);
  return engine;
}

interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

async function measure(page: Page) {
  return page.evaluate(async () => {
    /* The PAINTED avatar: the opaque pixels of each portrait as they land on
       screen (every ancestor transform, object-fit, and the disc's clip when
       it has one). The circle alone is not what a player compares: a bust
       portrait with transparent margins in a full-size circle reads small. */
    const alphaBoxes = new Map<string, { l: number; t: number; r: number; b: number } | null>();
    const alphaOf = async (src: string, minimumAlpha = 24) => {
      const key = `${src}|${minimumAlpha}`;
      if (alphaBoxes.has(key)) return alphaBoxes.get(key)!;
      let found: { l: number; t: number; r: number; b: number } | null = null;
      try {
        const bitmap = await createImageBitmap(await (await fetch(src)).blob());
        const c = document.createElement('canvas');
        c.width = bitmap.width;
        c.height = bitmap.height;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0);
        const { data } = ctx.getImageData(0, 0, c.width, c.height);
        let l = c.width,
          t = c.height,
          r = -1,
          b = -1;
        for (let y = 0; y < c.height; y++)
          for (let x = 0; x < c.width; x++)
            if (data[(y * c.width + x) * 4 + 3] > minimumAlpha) {
              if (x < l) l = x;
              if (x > r) r = x;
              if (y < t) t = y;
              if (y > b) b = y;
            }
        if (r >= 0)
          found = { l: l / c.width, t: t / c.height, r: (r + 1) / c.width, b: (b + 1) / c.height };
      } catch {
        found = null;
      }
      alphaBoxes.set(key, found);
      return found;
    };
    const painted = async (img: HTMLImageElement, disc: Element) => {
      const rect = img.getBoundingClientRect();
      const d = disc.getBoundingClientRect();
      const src = img.currentSrc || img.src;
      const a = img.naturalWidth > 0 && src ? await alphaOf(src) : null;
      if (!a) return { width: d.width, height: d.height, bottom: d.bottom };
      const cs = getComputedStyle(img);
      const fit =
        cs.objectFit === 'contain'
          ? Math.min(rect.width / img.naturalWidth, rect.height / img.naturalHeight)
          : Math.max(rect.width / img.naturalWidth, rect.height / img.naturalHeight);
      const w = img.naturalWidth * fit;
      const h = img.naturalHeight * fit;
      const x = rect.left + (rect.width - w) / 2;
      const y = rect.top + (rect.height - h) * (cs.objectPosition.endsWith('100%') ? 1 : 0.5);
      let l = x + a.l * w,
        t = y + a.t * h,
        r = x + a.r * w,
        b = y + a.b * h;
      // A fixed portrait zoom crops its hidden torso at the name plate.
      // getBoundingClientRect includes that hidden canvas; measure the actual
      // CSS inset before comparing paint with the action row or other seats.
      const inset = /^inset\(([^)]+)\)$/.exec(cs.clipPath);
      if (inset) {
        const values = inset[1].trim().split(/\s+/);
        const raw = values[2] || values[0];
        const cut = raw.endsWith('%')
          ? (parseFloat(raw) / 100) * rect.height
          : parseFloat(raw) * (rect.height / parseFloat(cs.height));
        if (Number.isFinite(cut)) b = Math.min(b, rect.bottom - cut);
      }
      if (getComputedStyle(disc).overflow !== 'visible') {
        l = Math.max(l, d.left);
        t = Math.max(t, d.top);
        r = Math.min(r, d.right);
        b = Math.min(b, d.bottom);
      }
      return { width: Math.max(0, r - l), height: Math.max(0, b - t), bottom: b };
    };
    const box = (e: Element): Box => {
      const r = e.getBoundingClientRect();
      return {
        top: r.top,
        bottom: r.bottom,
        left: r.left,
        right: r.right,
        width: r.width,
        height: r.height,
      };
    };
    const shown = (e: Element) => {
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.opacity !== '0';
    };
    const buttons = [...document.querySelectorAll('.action-panel .action-btn')]
      .filter(shown)
      .map(box);
    const wrappers = [...document.querySelectorAll('.seat-wrapper')].filter(shown);
    // The bottom-center seat: the occupied chair whose centre is lowest on
    // the felt and nearest its middle. It is the hero's chair when seated.
    const mid = document.documentElement.clientWidth / 2;
    const bottomCenter = wrappers
      .filter((w) => w.querySelector('.seat__avatar-img'))
      .sort((a, b) => {
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        const score = (r: DOMRect) => r.top + r.height / 2 - Math.abs(r.left + r.width / 2 - mid);
        return score(rb) - score(ra);
      })[0];
    // The seat box ends at its lowest painted plate or label (name plate,
    // stack, hand label) - not at chips or cards it throws onto the felt.
    let seatBottom = 0;
    let heroCardsBottom = 0;
    for (const card of document.querySelectorAll('.seat-wrapper--hero img.card-image__img'))
      if (shown(card))
        heroCardsBottom = Math.max(heroCardsBottom, card.getBoundingClientRect().bottom);
    if (bottomCenter) {
      for (const el of bottomCenter.querySelectorAll(
        '.seat__avatar-img, .seat__info, .seat__name, .seat__stack, .seat__strength, .seat__hand-name'
      )) {
        if (!shown(el)) continue;
        const disc = el.closest('.seat__avatar');
        const bottom =
          el instanceof HTMLImageElement && disc
            ? (await painted(el, disc)).bottom
            : el.getBoundingClientRect().bottom;
        seatBottom = Math.max(seatBottom, bottom);
      }
    }
    const avatars: Array<
      Box & {
        hero: boolean;
        paint: { width: number; height: number };
        scale: string;
        photo: boolean;
      }
    > = [];
    for (const w of wrappers) {
      const img = w.querySelector<HTMLImageElement>('.seat__avatar-img');
      const disc = w.querySelector('.seat__avatar');
      if (!img || !disc || !shown(img)) continue;
      avatars.push({
        hero: w.classList.contains('seat-wrapper--hero'),
        ...box(disc),
        paint: await painted(img, disc),
        scale: (disc as HTMLElement).style.getPropertyValue('--sp-mobile-art-scale') || '1',
        // A photo or initials disc is clipped to its circle; character art
        // rises out of it, so their painted heights differ at one size.
        photo: !disc.classList.contains('seat__avatar--bust'),
      });
    }
    const prev = document.querySelector('.prev-hand-card-wrapper');
    const tabBar = document.querySelector('.table-tab-bar');
    const topControls = [
      ...document.querySelectorAll(
        '.table-tab-bar button, .table-tab-bar .table-menu__trigger, .table-tab-bar__tab'
      ),
    ]
      .filter(shown)
      .map(box);
    const vv = window.visualViewport;
    return {
      toolPaintBottoms: await Promise.all(
        Array.from(
          document.querySelectorAll<HTMLImageElement>(
            '.hud-bl-row .tbc-icon-img,.hud-bl-row .prev-hand-card__icon-img'
          ),
          async (img) => {
            const alpha = await alphaOf(img.currentSrc || img.src, 127);
            const rect = img.getBoundingClientRect();
            return alpha ? rect.top + alpha.b * rect.height : null;
          }
        )
      ),
      panel: box(document.querySelector('.action-panel')!),
      frame: box(document.querySelector('.action-panel-wrapper')!),
      heroToolsBottom: Math.max(
        0,
        ...[
          ...document.querySelectorAll(
            '.hero-vpip,.hud-bl-row button,.seat--hero .seat__position-badge,.seat--hero .seat__action,.seat--hero .seat__bounty'
          ),
        ]
          .filter(shown)
          .map((el) => box(el).bottom)
      ),
      safeInset: parseFloat(
        document.documentElement.style.getPropertyValue('--sp-phone-safe-bottom')
      ),
      scaler: document.querySelector('.table-scaler')!.getBoundingClientRect().toJSON(),
      layoutWidth: document.documentElement.clientWidth,
      scale: vv ? vv.scale : 1,
      buttons,
      seatBottom,
      heroCardsBottom,
      bottomCenterIsHero: !!bottomCenter?.classList.contains('seat-wrapper--hero'),
      avatars,
      prev: prev && shown(prev) ? box(prev) : null,
      tabBar: tabBar ? box(tabBar) : null,
      topControls,
      pillText: [...document.querySelectorAll('.table-tab-bar__tab')]
        .map((t) => (t as HTMLElement).innerText)
        .join(' | '),
    };
  });
}

const SCENARIOS: Scenario[] = [
  { name: 'iPhone SE 375x667, 6-max', width: 375, height: 667, seats: 6 },
  { name: 'iPhone SE 375x667, 9-max bomb pot', width: 375, height: 667, seats: 9, bombPot: true },
  { name: 'iPhone 14 390x844, 6-max', width: 390, height: 844, seats: 6 },
  {
    name: 'iPhone 14 390x844, 9-max bomb pot, photo hero',
    width: 390,
    height: 844,
    seats: 9,
    bombPot: true,
    art: { hero: 'photo', opponents: ['wolf', 'aztec', 'photo', 'initials'] },
  },
  { name: 'iPhone 14 390x844, Lightning', width: 390, height: 844, seats: 6, lightning: true },
  {
    name: 'iPhone 14 390x844, Lightning PLO4',
    width: 390,
    height: 844,
    seats: 6,
    lightning: true,
    plo4: true,
    art: { hero: 'wolf', opponents: ['aztec'] },
  },
  {
    name: 'iPhone Pro Max 430x932, 6-max, character-art hero',
    width: 430,
    height: 932,
    seats: 6,
    art: { hero: 'wolf', opponents: ['photo', 'aztec', 'initials'] },
  },
  {
    name: 'iPhone Pro Max 430x932, 9-max, initials hero',
    width: 430,
    height: 932,
    seats: 9,
    art: { hero: 'initials', opponents: ['wolf', 'photo', 'aztec'] },
  },
  {
    name: 'short Android 360x640, 6-max bomb pot',
    width: 360,
    height: 640,
    seats: 6,
    bombPot: true,
  },
  { name: 'short Android 360x640, 9-max', width: 360, height: 640, seats: 9 },
  { name: 'compact phone 320x568, 6-max', width: 320, height: 568, seats: 6 },
];

for (const s of SCENARIOS) {
  test.describe(s.name, () => {
    test.use({
      viewport: { width: s.width, height: s.height },
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: SHOT_DPR,
    });

    test('bottom row, hero seat and top inset', async ({ page }) => {
      const engine = await openTable(page, s);
      try {
        const m = await measure(page);
        if (process.env.PHONE_LAYOUT_SHOTS) {
          mkdirSync(process.env.PHONE_LAYOUT_SHOTS, { recursive: true });
          const file = s.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
          await page.screenshot({ path: `${process.env.PHONE_LAYOUT_SHOTS}/${file}.png` });
          console.log(s.name, JSON.stringify(m));
        }
        // The phone lays the table out at the desktop width (2026-10-25).
        expect(m.layoutWidth).toBe(600);

        // 3a. The buttons are double what they were.
        expect(m.buttons.length).toBeGreaterThanOrEqual(2);
        for (const b of m.buttons)
          expect(b.height, 'every action button is double its old height').toBeGreaterThanOrEqual(
            2 * PREVIOUS_BUTTON_PX
          );
        // 3b. They reach up to just under the bottom-center seat box.
        expect(m.bottomCenterIsHero, 'the hero sits bottom-center').toBe(true);
        const rowTop = Math.min(...m.buttons.map((b) => b.top));
        expect(rowTop, 'the row never covers the bottom-center seat box').toBeGreaterThanOrEqual(
          m.seatBottom
        );
        expect(
          (s.seats === 6 ? m.panel.top : rowTop) - m.seatBottom,
          'the action frame comes up to just under the seat box'
        ).toBeLessThanOrEqual(MAX_SEAT_GAP_PX);
        expect(m.heroCardsBottom, "the hero's cards are drawn").toBeGreaterThan(0);
        expect(rowTop, "the row never covers the hero's cards").toBeGreaterThanOrEqual(
          m.heroCardsBottom
        );
        if (s.seats === 6) {
          const top = Math.min(...m.buttons.map((b) => b.top));
          const bottom = Math.max(...m.buttons.map((b) => b.bottom));
          const left = Math.min(...m.buttons.map((b) => b.left));
          const right = Math.max(...m.buttons.map((b) => b.right));
          expect(
            Math.abs(left - m.panel.left - (m.panel.right - right)),
            'equal horizontal button margins'
          ).toBeLessThan(1);
          expect(
            Math.abs(top - m.panel.top - (m.panel.bottom - bottom)),
            'equal visual padding above and below the button faces within the painted frame'
          ).toBeLessThan(1);
          expect(
            Math.abs(m.frame.bottom - m.panel.bottom),
            'the painted panel fills the fixed frame to the bottom of the screen'
          ).toBeLessThan(1);
          expect(
            (m.frame.bottom - bottom) * m.scale,
            'actions clear the home indicator'
          ).toBeGreaterThanOrEqual((m.safeInset * m.scale) / 2);
          if (s.plo4) {
            expect(m.toolPaintBottoms).toHaveLength(2);
            for (const paintedBottom of m.toolPaintBottoms) {
              expect(paintedBottom).not.toBeNull();
              expect(
                Math.abs(paintedBottom! - m.heroCardsBottom) * m.scale,
                'the opaque tool frames align with the private cards'
              ).toBeLessThan(1.5);
            }
          }
          const bottomOfHero = Math.max(
            m.seatBottom,
            m.heroCardsBottom,
            m.heroToolsBottom,
            m.prev!.bottom
          );
          expect(
            (Math.min(m.frame.top, m.panel.top) - bottomOfHero) * m.scale,
            'two phone pixels of clearance to frame border'
          ).toBeGreaterThanOrEqual(2);
        }
        if (s.plo4) {
          await expect(
            page.locator('.seat-wrapper--hero .seat__cards--hero .seat__card')
          ).toHaveCount(4);
          expect(
            (m.panel.top - Math.max(m.seatBottom, m.heroCardsBottom)) * m.scale,
            'private cards and strength remain within ten phone pixels of the frame'
          ).toBeLessThanOrEqual(10);
        }
        // 3c. Previous Hand moved up with them: wholly above the row.
        expect(m.prev, 'the Previous Hand button is shown').not.toBeNull();
        expect(m.prev!.bottom).toBeLessThanOrEqual(rowTop);
        // 3d. The hero's avatar is as large as every other avatar: its circle
        // is never the smaller one and its portrait takes the table's one
        // size. (A portrait with transparent margins in a full circle reads
        // small, so like art is also compared by its painted height.)
        const hero = m.avatars.find((a) => a.hero)!;
        const others = m.avatars.filter((a) => !a.hero);
        expect(hero, 'the hero avatar is drawn').toBeTruthy();
        expect(others.length).toBeGreaterThan(0);
        for (const o of others) {
          expect(hero.width, 'hero circle vs an opponent circle').toBeGreaterThanOrEqual(
            o.width - 1
          );
          // Dan 2026-11-13: every portrait on the table, the hero's included,
          // is the same size.
          // Character art all takes one size; a photo or initials disc is its
          // circle and never grows, and a photo hero caps the art's height.
          // At one size two artworks' painted heights differ only by their own
          // drawing (a few px of transparent margin), never by a smaller size.
          if (!hero.photo && !o.photo)
            expect(hero.scale, 'hero portrait size vs an opponent portrait size').toBe(o.scale);
          expect(hero.paint.height, 'hero portrait vs an opponent portrait').toBeGreaterThanOrEqual(
            o.paint.height - Math.max(2, o.paint.height * 0.02)
          );
        }
        // 6. The notch band is cleared in DEVICE px, at the table's scale.
        expect(m.topControls.length).toBeGreaterThan(0);
        for (const c of m.topControls)
          expect(c.top * m.scale, 'top control clears the notch').toBeGreaterThanOrEqual(NOTCH_PX);
      } finally {
        engine.dispose();
      }
    });
  });
}

test.describe('the action pill', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 3,
  });

  test("shows the hero's cards only; the hero's action shows on the seat", async ({ page }) => {
    const s = SCENARIOS[2];
    const engine = await openTable(page, s);
    try {
      const pill = page.locator('.table-tab-bar__tab--active');
      await expect(pill.locator('.table-tab-bar__mini-cards')).toBeVisible();
      engine.heroChecks();
      // The action lands where every other player's does: on the seat.
      await expect(page.locator('.seat-wrapper--hero .seat__action')).toHaveText(/check/i);
      // And never in the pill, for the whole of the old 2.5s chip window.
      const deadline = Date.now() + 3_000;
      while (Date.now() < deadline) {
        const text = await pill.innerText();
        expect(text, 'the pill carries no action word').not.toMatch(
          /\b(fold|check|call|bet|raise|all[\s-]?in)\b/i
        );
        await expect(pill.locator('.table-tab-bar__action-chip')).toHaveCount(0);
        await page.waitForTimeout(150);
      }
      await expect(pill.locator('.table-tab-bar__mini-cards')).toBeVisible();
    } finally {
      engine.dispose();
    }
  });
});

/* Dan, 2026-11-11: below the Lightning start count the table says how many
   more players are needed, and never that Lightning cannot start. */
test.describe('the Lightning start ticker', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 3,
  });

  test('a feeder game below its start count counts down and shows no start error', async ({
    page,
  }) => {
    const s: Scenario = { ...SCENARIOS[2], feeder: { live: 2, on: 5 } };
    const engine = await openTable(page, s);
    try {
      await expect(page.getByTestId('lightning-start-ticker')).toHaveText(
        '3 More Players Until Lightning Games Start',
        { timeout: 15_000 }
      );
      const leave = page.getByRole('button', { name: 'Leave Next Hand', exact: true });
      const chat = page.getByRole('button', { name: 'Open Table Chat', exact: true });
      for (const button of [leave, chat]) {
        await expect(button).toBeVisible();
        expect(
          await button.evaluate((el) => {
            const box = el.getBoundingClientRect();
            return el.contains(
              document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
            );
          }),
          'the control receives taps at its centre'
        ).toBe(true);
      }
      expect(
        Math.abs((await leave.boundingBox())!.y - (await chat.boundingBox())!.y)
      ).toBeLessThanOrEqual(1);
      const body = await page.locator('body').innerText();
      expect(body, 'no Lightning start error is shown').not.toMatch(
        /(can.?t|cannot|unable to|could not|won.?t)\s+start|not enough players/i
      );
    } finally {
      engine.dispose();
    }
  });
});
