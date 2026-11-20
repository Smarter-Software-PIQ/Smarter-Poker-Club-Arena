/**
 * OPPONENT HUD: THE LIFETIME PUBLIC PROFILE (2026-11-20, PLO-OWNER lane OPPONENT-HUD)
 *
 * Owner, 3:15 PM Chicago Nov 20 2026: "OPPONENTS PLAY IS SUPPOSED TO BE INSIDE THE HORSES SHARED MEMORY ... ACCESS
 * THE LIFETIME HAND KNOWLEDGE DATA BASE AGAINST THAT HUMAN (OR HORSE) AND HAVE A FULL ESSENTIALLY BUILT IN HEADS UP
 * DISPLAY OF ANY AND ALL READS, PREVIOUS HANDS PLAYED AND ANYTHING ELSE. IT SHOULD BE FROM HAND #1." 3:18 PM: "THEY
 * SHOULDN'T HAVE ACCESS TO HOLE CARDS, BUT THEY SHOULD HAVE ACCESS TO ALL PREVIOUSLY PLAYED HANDS AND ACCESS TO HOW
 * THEIR OPPONENTS PLAY".
 *
 * One profile per opponent per game family (plo4, plo5), built by ONE set of formulas for every opponent: there is no
 * person/Horse input anywhere in this file and no named player. Inputs are public only: the action log (seat, user,
 * action, amount, street, the public node when recorded), the button, the dealt seats and their stacks, the board,
 * the showdown list (who showed, who mucked, the made-hand NAME the showdown revealed) and the winners. The hand
 * record's dealt cards (hand_history.players[].cards) are never read: handRecordFromRow copies only seat, userId and
 * stack from each player (law test OpponentHud.law.test.ts), so a card that was not shown cannot enter a profile, and
 * the showdown strength comes from the revealed hand name of an unmucked showdown entry alone.
 *
 * Every statistic is kept as [opportunities, hits] twice: a lifetime layer (never decays, never thrown away) and a
 * recency layer (each hand weighted 2^(-age / HUD_RECENCY_HALF_LIFE_MS), so today's play counts more). The accessor
 * (OpponentHud.ts) blends them, HUD_LIFETIME_FLOOR of the lifetime layer plus the rest from the recency layer, and
 * shrinks the result toward the population prior with weight n / (n + k): no sample gate, no cliff.
 *
 * Hand-level recall: every voluntary decision of the player is also kept as an instance of a spot (street, line so
 * far, position, size band faced, flop texture, stack-depth band) with what he did and, when the hand reached a
 * showdown, what he showed and whether he won. Cells are kept at three levels of detail so a spot backs off to a
 * coarser one with evidence; the last HUD_LAST_INSTANCES raw instances are kept for the operator dump.
 *
 * Idempotent: a hand is applied once (its id is kept in a bounded ring of recent ids and the watermark moves only
 * forward); a replayed or retried hand changes nothing.
 */

export const HUD_PROFILE_VERSION = 1 as const;
export const HUD_FAMILIES = ['plo4', 'plo5'] as const;
export type HudFamily = (typeof HUD_FAMILIES)[number];
export const HUD_RECENCY_HALF_LIFE_MS = 7 * 24 * 3600 * 1000;
export const HUD_LIFETIME_FLOOR = 0.25;
export const HUD_RECENT_IDS = 192;
export const HUD_LATE_WINDOW_MS = 15 * 60 * 1000;
export const HUD_LAST_INSTANCES = 40;
/** detailed (level 2) recall cells kept per profile; past it the least observed detailed cell is dropped (its
 *  coarser cells keep every instance) */
export const HUD_RECALL_MAX_FINE = 800;

export type HudStreet = 'preflop' | 'flop' | 'turn' | 'river';
export type HudPosition = 'BTN' | 'CO' | 'EP' | 'SB' | 'BB';
export type HudBand = 's' | 'm' | 'l' | 'o';
export type HudTexture = 'mono' | 'paired' | 'conn' | 'dry';
export type HudDepth = 'd1' | 'd2' | 'd3';
export type HudActionCode = 'f' | 'c' | 'r' | 'k' | 'b';
export const HUD_BANDS: readonly HudBand[] = ['s', 'm', 'l', 'o'];
export const HUD_TEXTURES: readonly HudTexture[] = ['mono', 'paired', 'conn', 'dry'];
export const HUD_POSITIONS: readonly HudPosition[] = ['BTN', 'CO', 'EP', 'SB', 'BB'];
export const HUD_DEPTHS: readonly HudDepth[] = ['d1', 'd2', 'd3'];

/** Pot-relative size band of a bet or raise: s < 0.4, m < 0.75, l <= 1.1, o above (overbets and big jams). */
export function hudBand(ratio: number): HudBand {
  if (!(ratio < 0.4)) {
    if (ratio < 0.75) return 'm';
    if (ratio <= 1.1) return 'l';
    return 'o';
  }
  return 's';
}

/** Effective stack depth band in big blinds: d1 < 60, d2 <= 150, d3 deeper. */
export function hudDepth(bbs: number): HudDepth {
  return bbs < 60 ? 'd1' : bbs <= 150 ? 'd2' : 'd3';
}

const RANKS = '23456789TJQKA';
/** Flop texture class from the three public flop cards ("7d", "Qs", or "7diamonds"). */
export function hudTexture(flop: readonly string[]): HudTexture | null {
  if (flop.length < 3) return null;
  const parsed = flop.slice(0, 3).map((c) => {
    const r = RANKS.indexOf((c[0] ?? '').toUpperCase() === '1' ? 'T' : (c[0] ?? '').toUpperCase());
    const s = (c.length === 2 ? c[1] : c.slice(1)).toLowerCase()[0];
    return { r, s };
  });
  if (parsed.some((c) => c.r < 0 || !c.s)) return null;
  if (parsed[0].s === parsed[1].s && parsed[1].s === parsed[2].s) return 'mono';
  const rs = parsed.map((c) => c.r);
  if (new Set(rs).size < 3) return 'paired';
  const sorted = [...rs].sort((a, b) => a - b);
  const wheel = sorted.map((r) => (r === 12 ? -1 : r)).sort((a, b) => a - b);
  if (sorted[2] - sorted[0] <= 4 || wheel[2] - wheel[0] <= 4) return 'conn';
  return 'dry';
}

const STRONG_MIN = 4; // straight or better (ranking of the revealed made hand)
/** Ranking of a revealed made-hand name (0 high card .. 8 straight flush); null when the name is not a hand class. */
export function hudHandClass(name: string | null | undefined): number | null {
  if (typeof name !== 'string') return null;
  const n = name.toLowerCase();
  if (n.includes('royal') || n.includes('straight flush')) return 8;
  if (n.includes('four of a kind') || n.includes('quads')) return 7;
  if (n.includes('full house')) return 6;
  if (n.includes('flush')) return 5;
  if (n.includes('straight')) return 4;
  if (n.includes('three of a kind') || n.includes('trips') || n.includes('set')) return 3;
  if (n.includes('two pair')) return 2;
  if (n.includes('pair')) return 1;
  if (n.includes('high')) return 0;
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// The public hand record
// ---------------------------------------------------------------------------------------------------------------

export interface HudPublicNode {
  pot: number;
  toCall: number;
  currentBet: number;
  /** the actor's stack before this action and what he has committed this street (from the node's seat row) */
  stack: number | null;
  streetCommitted: number | null;
}
export interface HudPublicAction {
  seat: number;
  userId: string | null;
  action: string;
  amount: number;
  stage: HudStreet;
  dead?: boolean;
  node?: HudPublicNode | null;
}
export interface HudPublicSeat {
  seat: number;
  userId: string;
  /** stack as recorded on the hand row (end of hand); used only when no public node gives the start stack */
  stack: number;
}
export interface HudShowdownEntry {
  userId: string;
  mucked: boolean;
  handName: string | null;
}
export interface HudHandRecord {
  id: string;
  at: number;
  family: HudFamily;
  bb: number;
  button: number | null;
  seats: HudPublicSeat[];
  actions: HudPublicAction[];
  board: string[];
  showdown: HudShowdownEntry[];
  winners: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAGES = new Set<HudStreet>(['preflop', 'flop', 'turn', 'river']);
const num = (x: unknown): number | null =>
  typeof x === 'number' && Number.isFinite(x)
    ? x
    : typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x))
      ? Number(x)
      : null;
const arr = (x: unknown): unknown[] => {
  if (Array.isArray(x)) return x;
  if (typeof x === 'string') {
    try {
      const v = JSON.parse(x);
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }
  return [];
};
const obj = (x: unknown): Record<string, unknown> | null =>
  x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : null;

/** Why a hand_history row gives no record (closed set; counted by the builders). */
export type HudRowRefusal =
  | 'not_plo45'
  | 'tournament'
  | 'bomb_pot'
  | 'multi_board'
  | 'no_id'
  | 'no_actions'
  | 'bad_row';

/**
 * A hand_history row (plain JSON as PostgREST returns it) to the public record, or the refusal. Copies ONLY the
 * public fields: from each player exactly seat, userId and stack; never `cards`. PLO4/PLO5 cash, one board, no bomb
 * pot. The same function serves the backfill, the incremental update and the reconciliation.
 */
export function handRecordFromRow(row: unknown): HudHandRecord | HudRowRefusal {
  const r = obj(row);
  if (!r) return 'bad_row';
  const family = r.game_variant;
  if (family !== 'plo4' && family !== 'plo5') return 'not_plo45';
  if (r.tournament_id != null) return 'tournament';
  if (r.bomb_pot != null && r.bomb_pot !== false) return 'bomb_pot';
  if (
    (Array.isArray(r.community_cards2) && r.community_cards2.length > 0) ||
    (r.rit_boards != null && arr(r.rit_boards).length > 0)
  )
    return 'multi_board';
  const id = typeof r.id === 'string' && UUID.test(r.id) ? r.id : null;
  if (!id) return 'no_id';
  const atRaw = r.ended_at ?? r.created_at;
  const at = typeof atRaw === 'string' ? Date.parse(atRaw) : num(atRaw);
  const bb = num(r.big_blind);
  if (at === null || !Number.isFinite(at) || bb === null || !(bb > 0)) return 'bad_row';
  const seats: HudPublicSeat[] = [];
  for (const p of arr(r.players)) {
    const o = obj(p);
    if (!o) continue;
    const seat = num(o.seat);
    const userId = typeof o.userId === 'string' ? o.userId : null;
    const stack = num(o.stack) ?? 0;
    if (seat !== null && userId) seats.push({ seat, userId, stack });
  }
  const actions: HudPublicAction[] = [];
  for (const a of arr(r.actions)) {
    const o = obj(a);
    if (!o) continue;
    const seat = num(o.seat);
    const stage = o.stage as HudStreet;
    if (seat === null || !STAGES.has(stage) || typeof o.action !== 'string') continue;
    const pn = obj(o.publicNode);
    let node: HudPublicNode | null = null;
    if (pn) {
      const row = arr(pn.seats).find((s) => Array.isArray(s) && num(s[0]) === seat) as
        | unknown[]
        | undefined;
      const pot = num(pn.pot);
      const toCall = num(pn.toCall);
      const currentBet = num(pn.currentBet);
      if (pot !== null && toCall !== null && currentBet !== null)
        node = {
          pot,
          toCall,
          currentBet,
          stack: row ? num(row[1]) : null,
          streetCommitted: row ? num(row[2]) : null,
        };
    }
    actions.push({
      seat,
      userId: typeof o.userId === 'string' ? o.userId : null,
      action: o.action,
      amount: num(o.amount) ?? 0,
      stage,
      ...(o.dead === true ? { dead: true } : {}),
      node,
    });
  }
  if (!actions.length) return 'no_actions';
  const board = arr(r.community_cards).filter((c): c is string => typeof c === 'string');
  const showdown: HudShowdownEntry[] = [];
  for (const s of arr(r.showdown)) {
    const o = obj(s);
    const userId = o && typeof o.user_id === 'string' ? o.user_id : null;
    if (!o || !userId) continue;
    showdown.push({
      userId,
      mucked: o.mucked === true,
      handName: o.mucked === true ? null : typeof o.hand_name === 'string' ? o.hand_name : null,
    });
  }
  const winners = new Set<string>();
  for (const w of arr(r.winners)) {
    const o = obj(w);
    if (o && typeof o.userId === 'string' && (num(o.amount) ?? 0) > 0) winners.add(o.userId);
  }
  return {
    id,
    at,
    family,
    bb,
    button: num(r.button_seat),
    seats,
    actions,
    board,
    showdown,
    winners: [...winners].sort(),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Statistics registry
// ---------------------------------------------------------------------------------------------------------------

const POST = ['f', 't', 'r'] as const;
type PostKey = (typeof POST)[number];
const STREET_KEY: Record<Exclude<HudStreet, 'preflop'>, PostKey> = {
  flop: 'f',
  turn: 't',
  river: 'r',
};

function registry(): string[] {
  const out = [
    'pf.vpip',
    'pf.pfr',
    'pf.open',
    'pf.limp',
    'pf.3bet',
    'pf.4bet',
    'pf.f3bet',
    'pf.cc',
    'sd.wtsd',
    'sd.wsd',
  ];
  for (const p of HUD_POSITIONS) out.push(`pf.vpip@${p}`, `pf.pfr@${p}`);
  for (const d of HUD_DEPTHS) out.push(`pf.vpip@${d}`, `pf.pfr@${d}`);
  for (const s of POST) {
    out.push(
      `${s}.betCk`,
      `${s}.donk`,
      `${s}.xr`,
      `${s}.fRaise`,
      `${s}.fBet`,
      `${s}.cBet`,
      `${s}.rBet`
    );
    out.push(s === 'f' ? 'f.cbet' : `${s}.barrel`);
    if (s !== 'f') out.push(`${s}.probe`);
    for (const b of HUD_BANDS)
      out.push(`${s}.fBet.${b}`, `${s}.cBet.${b}`, `${s}.rBet.${b}`, `${s}.bsz.${b}`);
    out.push(`sd.strong.${s}`, `sd.strongBig.${s}`);
  }
  for (const t of HUD_TEXTURES) out.push(`f.betCk.${t}`, `f.fBet.${t}`);
  return out;
}
/** Every statistic the profile keeps; a new one must be added here AND covered by OpponentHudProfile.test.ts
 *  (the registry law enumerates this list against the tests' coverage table). */
export const HUD_STATS: readonly string[] = Object.freeze(registry());
const STAT_SET = new Set(HUD_STATS);
export function hudStatIsRegistered(stat: string): boolean {
  return STAT_SET.has(stat);
}

// ---------------------------------------------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------------------------------------------

/** [opportunities, hits] */
export type HudCount = [number, number];
/** recall cell: [n, folds, calls, raises, checks, bets, shown, shownStrong, won] */
export type HudRecallCell = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];
export interface HudInstance {
  h: string;
  at: number;
  s: HudStreet;
  ln: string;
  b: HudBand | '-';
  pos: HudPosition;
  tx: HudTexture | '-';
  d: HudDepth | '-';
  a: HudActionCode;
  /** 0 not shown, 1 shown below a straight, 2 shown a straight or better */
  sh: 0 | 1 | 2;
  w: 0 | 1;
}
export interface OpponentHudProfile {
  v: typeof HUD_PROFILE_VERSION;
  user: string;
  family: HudFamily;
  hands: number;
  /** newest applied hand time (epoch ms); -1 before the first hand */
  wm: number;
  /** recent applied hand ids, newest last, at most HUD_RECENT_IDS */
  ids: string[];
  life: Record<string, HudCount>;
  rec: Record<string, HudCount>;
  /** the time the recency layer is decayed to (epoch ms) */
  recAt: number;
  recall: Record<string, HudRecallCell>;
  last: HudInstance[];
}

export function emptyHudProfile(user: string, family: HudFamily): OpponentHudProfile {
  return {
    v: HUD_PROFILE_VERSION,
    user,
    family,
    hands: 0,
    wm: -1,
    ids: [],
    life: {},
    rec: {},
    recAt: 0,
    recall: {},
    last: [],
  };
}

/** Structural validity of a stored profile (a different version is invalid, so a new build never misreads an old
 *  row: it is rebuilt by the backfill instead). */
export function validHudProfile(x: unknown): x is OpponentHudProfile {
  const p = obj(x);
  if (!p) return false;
  if (p.v !== HUD_PROFILE_VERSION) return false;
  if (typeof p.user !== 'string' || !p.user) return false;
  if (p.family !== 'plo4' && p.family !== 'plo5') return false;
  if (!Number.isSafeInteger(p.hands) || (p.hands as number) < 0) return false;
  if (typeof p.wm !== 'number' || typeof p.recAt !== 'number') return false;
  if (!Array.isArray(p.ids) || p.ids.some((i) => typeof i !== 'string')) return false;
  if (!Array.isArray(p.last)) return false;
  for (const layer of [p.life, p.rec]) {
    const l = obj(layer);
    if (!l) return false;
    for (const [k, v] of Object.entries(l)) {
      if (!STAT_SET.has(k)) return false;
      if (
        !Array.isArray(v) ||
        v.length !== 2 ||
        !v.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0) ||
        v[1] > v[0] + 1e-6
      )
        return false;
    }
  }
  const rc = obj(p.recall);
  if (!rc) return false;
  for (const v of Object.values(rc))
    if (!Array.isArray(v) || v.length !== 9 || !v.every((n) => typeof n === 'number' && n >= 0))
      return false;
  return true;
}

// ---------------------------------------------------------------------------------------------------------------
// Per-hand extraction (public state machine)
// ---------------------------------------------------------------------------------------------------------------

const FORCED = new Set(['sb', 'bb', 'blind', 'ante', 'straddle', 'post', 'kill_blind', 'return']);
const AGGRESSIVE = new Set(['bet', 'raise']);

/** What one hand adds to one player. */
export interface HudHandDelta {
  user: string;
  stats: Map<string, HudCount>;
  instances: Omit<HudInstance, 'sh' | 'w'>[];
  shown: 0 | 1 | 2;
  won: 0 | 1;
}

function positionsOf(rec: HudHandRecord): Map<number, HudPosition> {
  const seats = [...new Set(rec.seats.map((s) => s.seat))].sort((a, b) => a - b);
  const out = new Map<number, HudPosition>();
  if (!seats.length) return out;
  const button = rec.button;
  // clockwise from the first seat after the button; the button (when dealt) ends the order
  const start =
    button === null
      ? 0
      : Math.max(
          0,
          seats.findIndex((s) => s > button)
        );
  const order = [...seats.slice(start), ...seats.slice(0, start)];
  for (const s of order) out.set(s, 'EP');
  const sbPost = rec.actions.find((a) => a.stage === 'preflop' && a.action === 'sb')?.seat;
  const bbPost = rec.actions.find((a) => a.stage === 'preflop' && a.action === 'bb')?.seat;
  if (order.length === 2) {
    // heads-up: the button posts the small blind
    const btn = button !== null && seats.includes(button) ? button : (sbPost ?? order[1]);
    out.set(btn, 'BTN');
    for (const s of order) if (s !== btn) out.set(s, 'BB');
    return out;
  }
  if (button !== null && seats.includes(button)) {
    out.set(button, 'BTN');
    if (order.length >= 4) out.set(order[order.length - 2], 'CO');
  }
  out.set(sbPost ?? order[0], 'SB');
  out.set(bbPost ?? order[1], 'BB');
  return out;
}

interface SeatState {
  user: string;
  streetCommitted: number;
  stack: number | null;
  folded: boolean;
  allIn: boolean;
  voluntary: boolean; // a voluntary preflop action taken
  firstPfDone: boolean;
  checkedThisStreet: boolean;
  aggressedThisStreet: boolean;
  facedOnStreet: boolean;
  firstNoBetOnStreet: boolean;
}

/**
 * Extract every dealt player's delta from one public hand. Pure and deterministic. Uses the recorded public node of
 * an action where present (pot, price, the actor's stack); otherwise reconstructs the pot from the amounts (bet, raise
 * and all-in amounts are totals of the street, call amounts are increments, as the engine records them: on the
 * Nov 19-20 hands every raise exceeded the bet it faced and every all-in after chips already in equalled stack plus
 * those chips), so older hands without a node still give their size bands.
 */
export function extractHandDeltas(rec: HudHandRecord): HudHandDelta[] {
  const pos = positionsOf(rec);
  const seats = new Map<number, SeatState>();
  for (const s of rec.seats)
    seats.set(s.seat, {
      user: s.userId,
      streetCommitted: 0,
      stack: null,
      folded: false,
      allIn: false,
      voluntary: false,
      firstPfDone: false,
      checkedThisStreet: false,
      aggressedThisStreet: false,
      facedOnStreet: false,
      firstNoBetOnStreet: false,
    });
  const deltas = new Map<string, HudHandDelta>();
  const D = (user: string): HudHandDelta => {
    let d = deltas.get(user);
    if (!d) {
      d = { user, stats: new Map(), instances: [], shown: 0, won: 0 };
      deltas.set(user, d);
    }
    return d;
  };
  const add = (user: string, stat: string, hit: boolean) => {
    const m = D(user).stats;
    const c = m.get(stat) ?? [0, 0];
    c[0] += 1;
    if (hit) c[1] += 1;
    m.set(stat, c);
  };
  for (const s of seats.values()) D(s.user);

  let pot = 0;
  let currentBet = 0;
  let street: HudStreet = 'preflop';
  let pfLevel = 0; // raises so far preflop
  let pfLastRaiser: string | null = null;
  let streetAggressions = 0;
  let lastAggressionRatio: number | null = null;
  let prevStreetAggressor: string | null = null;
  let streetAggressor: string | null = null;
  let prevStreetHadBet = true; // preflop always has the blinds
  let texture: HudTexture | null = null;
  const sawFlop = new Set<string>();
  const depthOf = new Map<string, HudDepth | '-'>();
  const f3betOpp = new Set<string>();
  const faced3 = new Set<string>();
  const faced4 = new Set<string>();
  const facedCc = new Set<string>();
  const bbs = rec.bb;

  const startStreet = (next: HudStreet) => {
    if (street === 'preflop') prevStreetAggressor = pfLastRaiser;
    else prevStreetAggressor = streetAggressor;
    prevStreetHadBet = street === 'preflop' ? true : streetAggressions > 0;
    street = next;
    currentBet = 0;
    streetAggressions = 0;
    streetAggressor = null;
    lastAggressionRatio = null;
    for (const s of seats.values()) {
      s.streetCommitted = 0;
      s.checkedThisStreet = false;
      s.aggressedThisStreet = false;
      s.facedOnStreet = false;
      s.firstNoBetOnStreet = false;
    }
    if (next === 'flop') {
      texture = hudTexture(rec.board);
      for (const s of seats.values()) if (!s.folded) sawFlop.add(s.user);
    }
  };

  for (const a of rec.actions) {
    if (a.stage !== street) {
      const orderIdx = (x: HudStreet) => ['preflop', 'flop', 'turn', 'river'].indexOf(x);
      if (orderIdx(a.stage) < orderIdx(street)) continue; // out-of-order record: ignore
      while ((street as HudStreet) !== a.stage && orderIdx(street) < 3)
        startStreet((['preflop', 'flop', 'turn', 'river'] as HudStreet[])[orderIdx(street) + 1]);
    }
    const st = seats.get(a.seat);
    const amt = Math.max(0, a.amount);
    if (a.dead || a.action === 'ante') {
      pot += amt;
      continue;
    }
    if (FORCED.has(a.action)) {
      pot += amt;
      if (st) {
        st.streetCommitted += amt;
        currentBet = Math.max(currentBet, st.streetCommitted);
      }
      continue;
    }
    if (!st || st.folded) continue;
    const user = st.user;
    const potBefore = a.node ? a.node.pot : pot;
    const betBefore = a.node ? a.node.currentBet : currentBet;
    const committedBefore =
      a.node && a.node.streetCommitted !== null ? a.node.streetCommitted : st.streetCommitted;
    const toCall = Math.max(0, betBefore - committedBefore);
    if (!depthOf.has(user)) {
      const stack = a.node && a.node.stack !== null ? a.node.stack + committedBefore : null;
      depthOf.set(user, stack !== null ? hudDepth(stack / bbs) : '-');
    }
    // classify the action
    let raiseTo = committedBefore;
    let code: HudActionCode;
    if (a.action === 'fold') code = 'f';
    else if (a.action === 'check') code = 'k';
    else if (a.action === 'call') {
      code = 'c';
      raiseTo = committedBefore + amt;
    } else if (AGGRESSIVE.has(a.action)) {
      raiseTo = amt;
      code = raiseTo > betBefore + 1e-9 ? (betBefore > 0 ? 'r' : 'b') : 'c';
    } else if (a.action === 'all_in') {
      raiseTo = amt; // the engine records an all-in as the street total, like a raise (measured on Nov 19-20 hands)
      code = raiseTo > betBefore + 1e-9 ? (betBefore > 0 ? 'r' : 'b') : 'c';
      st.allIn = true;
    } else continue; // unknown action word: no evidence
    const aggressive = code === 'r' || code === 'b';
    const ratio = aggressive ? (raiseTo - betBefore) / Math.max(1e-9, potBefore + toCall) : null;
    const position = pos.get(a.seat) ?? 'EP';
    const depth = depthOf.get(user) ?? '-';

    if (street === 'preflop') {
      const firstPf = !st.firstPfDone;
      st.firstPfDone = true;
      const line = pfLevel === 0 ? 'p0' : pfLevel === 1 ? 'p1' : pfLevel === 2 ? 'p2' : 'p3';
      D(user).instances.push({
        h: rec.id,
        at: rec.at,
        s: 'preflop',
        ln: line,
        b: '-',
        pos: position,
        tx: '-',
        d: depth,
        a: code,
      });
      if (firstPf && pfLevel === 0) {
        add(user, 'pf.open', code === 'r' || code === 'b');
        add(user, 'pf.limp', code === 'c');
      }
      if (pfLevel === 1 && !faced3.has(user) && pfLastRaiser !== user) {
        faced3.add(user);
        add(user, 'pf.3bet', aggressive);
      }
      if (pfLevel === 2 && !faced4.has(user) && pfLastRaiser !== user) {
        faced4.add(user);
        add(user, 'pf.4bet', aggressive);
      }
      if (pfLevel >= 1 && !st.voluntary && !facedCc.has(user) && pfLastRaiser !== user) {
        facedCc.add(user);
        add(user, 'pf.cc', code === 'c');
      }
      if (f3betOpp.has(user) && pfLevel === 2 && pfLastRaiser !== user) {
        f3betOpp.delete(user);
        add(user, 'pf.f3bet', code === 'f');
      }
      if (code === 'c' || aggressive) st.voluntary = true;
      if (aggressive) {
        pfLevel += 1;
        if (pfLevel === 1) f3betOpp.add(user);
        else if (pfLevel > 2) f3betOpp.clear();
        pfLastRaiser = user;
      }
    } else {
      const sk = STREET_KEY[street];
      const facingLevel = betBefore > committedBefore + 1e-9 ? streetAggressions : 0;
      const band: HudBand | '-' =
        facingLevel > 0 && lastAggressionRatio !== null ? hudBand(lastAggressionRatio) : '-';
      const line =
        facingLevel === 0
          ? prevStreetAggressor === user
            ? 'xA'
            : 'x0'
          : facingLevel === 1
            ? st.checkedThisStreet
              ? 'b1x'
              : 'b1'
            : st.aggressedThisStreet
              ? 'r2a'
              : 'r2';
      D(user).instances.push({
        h: rec.id,
        at: rec.at,
        s: street,
        ln: line,
        b: band,
        pos: position,
        tx: texture ?? '-',
        d: depth,
        a: code,
      });
      if (facingLevel === 0) {
        if (!st.firstNoBetOnStreet) {
          st.firstNoBetOnStreet = true;
          add(user, `${sk}.betCk`, aggressive);
          if (sk === 'f' && texture) add(user, `f.betCk.${texture}`, aggressive);
          if (prevStreetAggressor === user)
            add(user, sk === 'f' ? 'f.cbet' : `${sk}.barrel`, aggressive);
          else if (prevStreetAggressor !== null) {
            const agg = [...seats.values()].find((s) => s.user === prevStreetAggressor);
            if (agg && !agg.folded && !agg.checkedThisStreet && !agg.aggressedThisStreet)
              add(user, `${sk}.donk`, aggressive);
          }
          if (sk !== 'f' && !prevStreetHadBet) add(user, `${sk}.probe`, aggressive);
        }
      } else if (facingLevel === 1 && !st.aggressedThisStreet && !st.facedOnStreet) {
        st.facedOnStreet = true;
        add(user, `${sk}.fBet`, code === 'f');
        add(user, `${sk}.cBet`, code === 'c');
        add(user, `${sk}.rBet`, aggressive);
        if (band !== '-') {
          add(user, `${sk}.fBet.${band}`, code === 'f');
          add(user, `${sk}.cBet.${band}`, code === 'c');
          add(user, `${sk}.rBet.${band}`, aggressive);
        }
        if (sk === 'f' && texture) add(user, `f.fBet.${texture}`, code === 'f');
        if (st.checkedThisStreet) add(user, `${sk}.xr`, aggressive);
      } else if (st.aggressedThisStreet && facingLevel >= 2) {
        add(user, `${sk}.fRaise`, code === 'f');
      }
      if (aggressive && ratio !== null) add(user, `${sk}.bsz.${hudBand(ratio)}`, true);
      if (code === 'k') st.checkedThisStreet = true;
      if (aggressive) {
        st.aggressedThisStreet = true;
        streetAggressions += 1;
        streetAggressor = user;
        // the bsz.* cells count every bet once in each band's opportunity so they read as a distribution
        if (ratio !== null)
          for (const b of HUD_BANDS) if (b !== hudBand(ratio)) add(user, `${sk}.bsz.${b}`, false);
      }
    }
    if (aggressive) lastAggressionRatio = ratio;
    if (code === 'f') st.folded = true;
    // pot and commitments
    const paid = Math.max(0, raiseTo - committedBefore);
    pot = (a.node ? a.node.pot : pot) + paid;
    st.streetCommitted = raiseTo;
    if (raiseTo > currentBet) currentBet = raiseTo;
    if (a.node) currentBet = Math.max(a.node.currentBet, raiseTo);
  }

  // an all-in before the flop: the board was run out without flop actions; whoever had not folded saw the flop
  if (street === 'preflop' && rec.board.length >= 3)
    for (const s of seats.values()) if (!s.folded) sawFlop.add(s.user);

  // preflop participation (one opportunity per dealt player who had a voluntary decision: a walk in the big blind
  // gives none)
  for (const [seatNo, s] of seats) {
    const d = D(s.user);
    const hadPf = d.instances.some((i) => i.s === 'preflop');
    if (!hadPf) continue;
    const vpip = d.instances.some(
      (i) => i.s === 'preflop' && (i.a === 'c' || i.a === 'r' || i.a === 'b')
    );
    const pfr = d.instances.some((i) => i.s === 'preflop' && (i.a === 'r' || i.a === 'b'));
    const p = pos.get(seatNo) ?? 'EP';
    const dep = depthOf.get(s.user) ?? '-';
    add(s.user, 'pf.vpip', vpip);
    add(s.user, 'pf.pfr', pfr);
    add(s.user, `pf.vpip@${p}`, vpip);
    add(s.user, `pf.pfr@${p}`, pfr);
    if (dep !== '-') {
      add(s.user, `pf.vpip@${dep}`, vpip);
      add(s.user, `pf.pfr@${dep}`, pfr);
    }
  }
  // showdown: went to showdown (listed, shown or mucked) of those who saw the flop; won at showdown; revealed
  // strength of his bets by street (shown entries only: a mucked entry reveals nothing)
  const sdUsers = new Map(rec.showdown.map((e) => [e.userId, e]));
  const winners = new Set(rec.winners);
  const reachedShowdown = rec.showdown.length >= 2;
  for (const user of sawFlop) {
    const went = reachedShowdown && sdUsers.has(user);
    add(user, 'sd.wtsd', went);
    if (went) add(user, 'sd.wsd', winners.has(user));
  }
  for (const d of deltas.values()) {
    const e = reachedShowdown ? sdUsers.get(d.user) : undefined;
    const cls = e && !e.mucked ? hudHandClass(e.handName) : null;
    d.shown = cls === null ? 0 : cls >= STRONG_MIN ? 2 : 1;
    d.won = e && winners.has(d.user) ? 1 : 0;
    if (cls !== null)
      for (const i of d.instances) {
        if (i.s === 'preflop' || !(i.a === 'b' || i.a === 'r')) continue;
        const sk = STREET_KEY[i.s];
        add(d.user, `sd.strong.${sk}`, cls >= STRONG_MIN);
      }
  }
  return [...deltas.values()];
}

/** Big-bet value shown: the own bet's band is attached to the hand's instances afterwards (see applyHudHand). */
function ownBetBands(rec: HudHandRecord): Map<string, Map<HudStreet, HudBand[]>> {
  // a second, minimal pass over the record to attach the band of each own wager to the player and street
  const out = new Map<string, Map<HudStreet, HudBand[]>>();
  const seats = new Map(rec.seats.map((s) => [s.seat, s.userId]));
  let street: HudStreet = 'preflop';
  let pot = 0;
  let currentBet = 0;
  const committed = new Map<number, number>();
  for (const a of rec.actions) {
    if (a.stage !== street) {
      street = a.stage;
      currentBet = 0;
      committed.clear();
    }
    const amt = Math.max(0, a.amount);
    if (a.dead || a.action === 'ante') {
      pot += amt;
      continue;
    }
    const before = a.node?.streetCommitted ?? committed.get(a.seat) ?? 0;
    const potBefore = a.node ? a.node.pot : pot;
    const betBefore = a.node ? a.node.currentBet : currentBet;
    let to = before;
    if (FORCED.has(a.action) || a.action === 'call') to = before + amt;
    else if (AGGRESSIVE.has(a.action)) to = amt;
    else if (a.action === 'all_in') to = amt;
    if (
      street !== 'preflop' &&
      (AGGRESSIVE.has(a.action) || a.action === 'all_in') &&
      to > betBefore + 1e-9
    ) {
      const user = seats.get(a.seat);
      if (user) {
        const ratio =
          (to - betBefore) / Math.max(1e-9, potBefore + Math.max(0, betBefore - before));
        const m = out.get(user) ?? new Map<HudStreet, HudBand[]>();
        m.set(street, [...(m.get(street) ?? []), hudBand(ratio)]);
        out.set(user, m);
      }
    }
    pot = potBefore + Math.max(0, to - before);
    committed.set(a.seat, to);
    currentBet = Math.max(currentBet, to, a.node?.currentBet ?? 0);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Applying a hand
// ---------------------------------------------------------------------------------------------------------------

export function recallKeys(
  i: Pick<HudInstance, 's' | 'ln' | 'b' | 'pos' | 'tx' | 'd'>
): [string, string, string] {
  const l0 = `${i.s}|${i.ln}`;
  const l1 = `${l0}|${i.b}`;
  return [l0, l1, `${l1}|${i.pos}|${i.tx}|${i.d}`];
}

const decay = (dt: number): number => Math.pow(0.5, dt / HUD_RECENCY_HALF_LIFE_MS);

/** Why a hand was not applied to a profile (closed set). */
export type HudApplyRefusal = 'duplicate' | 'stale' | 'not_dealt' | 'family';

/**
 * Apply one public hand to one player's profile in place. Returns null when applied, or why not. A hand is applied
 * exactly once: its id goes into the ring of recent ids; a hand older than the watermark by more than
 * HUD_LATE_WINDOW_MS is refused as stale (the nightly reconciliation rebuilds such a profile from hand_history).
 */
export function applyHudHand(
  profile: OpponentHudProfile,
  rec: HudHandRecord,
  deltas: readonly HudHandDelta[] = extractHandDeltas(rec),
  bands: Map<string, Map<HudStreet, HudBand[]>> = ownBetBands(rec)
): HudApplyRefusal | null {
  if (rec.family !== profile.family) return 'family';
  if (profile.ids.includes(rec.id)) return 'duplicate';
  if (profile.wm >= 0 && rec.at < profile.wm - HUD_LATE_WINDOW_MS) return 'stale';
  const d = deltas.find((x) => x.user === profile.user);
  if (!d) return 'not_dealt';
  // recency layer: decay to the newer of the two clocks, weigh this hand by its own age
  let w = 1;
  if (rec.at > profile.recAt) {
    const k = decay(rec.at - profile.recAt);
    for (const c of Object.values(profile.rec)) {
      c[0] *= k;
      c[1] *= k;
    }
    profile.recAt = rec.at;
  } else w = decay(profile.recAt - rec.at);
  const bump = (layer: Record<string, HudCount>, stat: string, c: HudCount, weight: number) => {
    const cur = layer[stat] ?? [0, 0];
    cur[0] += c[0] * weight;
    cur[1] += c[1] * weight;
    layer[stat] = cur;
  };
  const stats = new Map(d.stats);
  // big-bet strength shown by street (own wager band l or o, shown at showdown)
  if (d.shown > 0) {
    const mine = bands.get(profile.user);
    if (mine)
      for (const [s, bs] of mine) {
        if (s === 'preflop') continue;
        const sk = STREET_KEY[s];
        for (const b of bs)
          if (b === 'l' || b === 'o') {
            const c = stats.get(`sd.strongBig.${sk}`) ?? [0, 0];
            c[0] += 1;
            if (d.shown === 2) c[1] += 1;
            stats.set(`sd.strongBig.${sk}`, c);
          }
      }
  }
  for (const [stat, c] of stats) {
    if (!STAT_SET.has(stat)) continue;
    bump(profile.life, stat, c, 1);
    bump(profile.rec, stat, c, w);
  }
  for (const i of d.instances) {
    for (const key of recallKeys(i)) {
      const cell = profile.recall[key] ?? [0, 0, 0, 0, 0, 0, 0, 0, 0];
      cell[0] += 1;
      cell[i.a === 'f' ? 1 : i.a === 'c' ? 2 : i.a === 'r' ? 3 : i.a === 'k' ? 4 : 5] += 1;
      if (d.shown > 0) {
        cell[6] += 1;
        if (d.shown === 2) cell[7] += 1;
      }
      if (d.won) cell[8] += 1;
      profile.recall[key] = cell as HudRecallCell;
    }
    profile.last.push({ ...i, sh: d.shown, w: d.won });
  }
  const fine = Object.keys(profile.recall).filter((k) => k.split('|').length === 6);
  if (fine.length > HUD_RECALL_MAX_FINE) {
    fine.sort((a, b) => profile.recall[a][0] - profile.recall[b][0] || (a < b ? -1 : 1));
    for (const k of fine.slice(0, fine.length - HUD_RECALL_MAX_FINE)) delete profile.recall[k];
  }
  if (profile.last.length > HUD_LAST_INSTANCES)
    profile.last.splice(0, profile.last.length - HUD_LAST_INSTANCES);
  profile.hands += 1;
  profile.ids.push(rec.id);
  if (profile.ids.length > HUD_RECENT_IDS)
    profile.ids.splice(0, profile.ids.length - HUD_RECENT_IDS);
  if (rec.at > profile.wm) profile.wm = rec.at;
  return null;
}

/** Apply one hand to every dealt player whose profile the caller supplies (by user id); returns per-user outcome. */
export function applyHudHandToProfiles(
  rec: HudHandRecord,
  profileOf: (user: string) => OpponentHudProfile | undefined
): Map<string, HudApplyRefusal | null> {
  const deltas = extractHandDeltas(rec);
  const bands = ownBetBands(rec);
  const out = new Map<string, HudApplyRefusal | null>();
  for (const d of deltas) {
    const p = profileOf(d.user);
    if (p) out.set(d.user, applyHudHand(p, rec, deltas, bands));
  }
  return out;
}

/** Deep copy (the cache hands copies to the packet builder so a later hand never mutates a sent packet). */
export function cloneHudProfile(p: OpponentHudProfile): OpponentHudProfile {
  return JSON.parse(JSON.stringify(p)) as OpponentHudProfile;
}
