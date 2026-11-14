/**
 * HOLD'EM PERSONA RE-RAISE PROBE (2026-11-14, D3 option C, option
 * holdemPersonaReRaiseMix, default OFF). Plays the PREFLOP round of all-Horse
 * tables through HorseLogic.decide, every seat on the source-assigned hybrid
 * profile, and does two jobs:
 *
 *  1. `playProbeHand` decides every spot once per ARM from the same random
 *     stream position (the first arm drives the hand), so a test can compare
 *     arms decision by decision: action, amount and the stream state after.
 *  2. `measurePersonaReRaise` is the opportunity-weighted measurement: a
 *     fleet of synthetic ids in exactly the model's 25/20/40/15 archetype
 *     mix, every seat rotation, reporting per behaviour (3-bet bluff, squeeze
 *     bluff, 26-35bb four-bet reshove bluff) eligible, taken and the rate
 *     with a 95% Wilson interval, pooled, per archetype, per scale decile
 *     and (the reshove) per effective-stack bucket inside 26-35bb, with the
 *     option on and with it off on the same code; how often the
 *     min(1, p * scale) cap bound; what a refused reshove bluff did instead;
 *     and the model's E[min(1, scale)] to hold the measured reshove against.
 *
 * "Eligible" is the decision reaching the mix comparison. With the option on
 * that is the *_eligible_seen receipt. With it off no receipt exists, so each
 * off decision is decided a second time with the option on FROM THE SAME
 * STREAM POSITION and discarded: the conditions in front of the comparison
 * are the same code and the same draws either way, so the second look's
 * receipt says whether the off decision reached the comparison too. "Taken"
 * is the bluff branch itself (the preflop authority event, which is recorded
 * after the fold-equity test, in both arms), or for the reshove the shove.
 *
 * Limits: synthetic ids, not the fleet's; Horses against Horses; preflop
 * only; no top-up, no postflop, no humans; decisions made with mind off.
 * The CLI is server/scripts/holdem-persona-reraise-probe.ts. Pure and seeded.
 */
import { HorseLogic } from '../engine/HorseLogic.js';
import { restoreFastRandom, saveFastRandom, seedFastRandom } from '../engine/HorseEval.js';
import { HORSE_HYBRID_PROFILES } from '../engine/HorseHybridProfile.js';
import {
  HOLDEM_ARCHETYPE_NLH_3BET_MIX,
  HOLDEM_MODEL_MEAN_NLH_3BET_MIX,
  holdemPersonaFor,
  holdemPersonaReRaiseScale,
  type HorseHoldemArchetype,
} from '../engine/HorsePersona.js';
import { drainFires, enableBrainTelemetry } from '../engine/BrainTelemetry.js';
import { SUITS, RANKS } from '../engine/PokerEngine.js';
import type { ActionRecord, Card, HandStage, SeatPlayer } from '../types.js';

/** The V9 hourly mood hashes the hour: pin it so a measurement repeats. */
const PROBE_CLOCK_MS = Date.UTC(2026, 10, 14, 11, 0, 0);

export type ProbeVariant = 'nlh' | 'plo4' | 'plo5' | 'plo6' | 'short_deck' | 'flh';
export type ProbeMode = 'cash' | 'tournament';
const HOLE_CARDS: Record<ProbeVariant, number> = {
  nlh: 2,
  plo4: 4,
  plo5: 5,
  plo6: 6,
  short_deck: 2,
  flh: 2,
};
const SHORT_DECK_OUT = new Set(['2', '3', '4', '5']);

export function probeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffledDeck(variant: ProbeVariant, r: () => number): Card[] {
  const d: Card[] = [];
  for (const s of SUITS)
    for (const rank of RANKS) {
      if (variant === 'short_deck' && SHORT_DECK_OUT.has(String(rank))) continue;
      d.push({ rank, suit: s } as Card);
    }
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

const PERSONA_BLUFF_BRANCHES = new Set(['three_bet_bluff', 'squeeze_bluff']);

/** One way of deciding the same spot. `telemetry` turns the receipts on. */
export interface ProbeArm {
  opts: Record<string, unknown>;
  telemetry?: boolean;
  /** Runs this arm's decision inside a caller's bracket (a test's control). */
  around?: <T>(decide: () => T) => T;
}
export interface ProbeRead {
  action: string;
  amount: number;
  /** The shared random stream's state after this arm's decision. */
  rngAfter: number;
  /** Telemetry keys this arm's decision fired (empty without telemetry). */
  fires: string[];
  /** The 3-bet bluff or squeeze bluff branch itself was taken. */
  bluffBranch: boolean;
}
export interface ProbeSpot {
  variant: ProbeVariant;
  mode: ProbeMode;
  seats: number;
  heroId: string;
  heroSeat: number;
  heroCards: Card[];
  raises: number;
  callers: number;
  limpers: number;
  /** Hero's stack plus bet against the deepest live opponent's, in big blinds. */
  effectiveBB: number;
  /** One read per arm, in arm order. reads[0] drove the hand. */
  reads: ProbeRead[];
}
export interface ProbeTable {
  variant: ProbeVariant;
  mode: ProbeMode;
  /** Seat i + 1 is played by ids[i]; the dealer is the last seat. */
  ids: readonly string[];
  /** Big blinds behind, one figure for all or a [low, high] range per seat. */
  depthBB: number | readonly [number, number];
}

export interface ProbeTableState {
  players: SeatPlayer[];
  history: ActionRecord[];
  currentBet: number;
  lastRaise: number;
  dealerSeat: number;
  bb: number;
  sb: number;
}

function gameStateOf(table: ProbeTable, st: ProbeTableState, round: (n: number) => number) {
  return {
    players: st.players.map((p) => ({ ...p, cards: p.cards.slice() })),
    communityCards: [],
    pot: round(st.players.reduce((a, p) => a + p.bet, 0)),
    currentBet: st.currentBet,
    minRaise: Math.max(st.bb, st.lastRaise),
    lastRaise: st.lastRaise,
    stage: 'preflop' as HandStage,
    gameVariant: table.variant,
    bigBlind: st.bb,
    smallBlind: st.sb,
    dealerSeat: st.dealerSeat,
    actionHistory: st.history.slice(),
    gameMode: table.mode,
    ante: 0,
    format: table.mode,
  };
}

/** Decide one spot once per arm from the same stream position. The stream is
 *  left where the first arm left it. */
export function decideArms(
  table: ProbeTable,
  st: ProbeTableState,
  heroSeat: number,
  arms: readonly ProbeArm[],
  round: (n: number) => number = (x) => Math.round(x * 100) / 100
): ProbeRead[] {
  if (arms.some((a) => a.telemetry)) enableBrainTelemetry();
  const profile = HORSE_HYBRID_PROFILES[table.mode];
  const start = saveFastRandom();
  const reads: ProbeRead[] = [];
  for (const arm of arms) {
    restoreFastRandom(start);
    if (arm.telemetry) drainFires();
    const gs = gameStateOf(table, st, round);
    const decide = () =>
      HorseLogic.decide(
        gs.players.find((p) => p.seat === heroSeat)!,
        gs as never,
        profile.style,
        { ...profile.mods },
        {
          mind: false,
          telemetry: arm.telemetry === true,
          decisionTimeMs: PROBE_CLOCK_MS,
          ...arm.opts,
        } as never
      );
    const dec = arm.around ? arm.around(decide) : decide();
    const events = (dec as { preflopAuthority?: { events?: readonly { branch: string }[] } })
      .preflopAuthority?.events;
    reads.push({
      action: String(dec.action),
      amount: Number(dec.amount ?? 0),
      rngAfter: saveFastRandom(),
      fires: arm.telemetry ? drainFires().map((f) => f.feature) : [],
      bluffBranch: (events ?? []).some((e) => PERSONA_BLUFF_BRANCHES.has(e.branch)),
    });
  }
  restoreFastRandom(reads[0].rngAfter);
  return reads;
}

/**
 * Play one preflop round. Every decision is made once per arm from the same
 * stream position; the first arm's answer is the one the hand follows.
 */
export function playProbeHand(
  table: ProbeTable,
  r: () => number,
  arms: readonly ProbeArm[],
  onSpot: (spot: ProbeSpot) => void
): void {
  if (arms.some((a) => a.telemetry)) enableBrainTelemetry();
  const n = table.ids.length;
  const cash = table.mode === 'cash';
  const bb = cash ? 0.1 : 100;
  const sb = cash ? 0.05 : 50;
  const round = (x: number) => (cash ? Math.round(x * 100) / 100 : Math.round(x));
  const deck = shuffledDeck(table.variant, r);
  const seats = Array.from({ length: n }, (_, i) => i + 1);
  const dealerSeat = n;
  // Heads-up the dealer posts the small blind.
  const sbSeat = n === 2 ? dealerSeat : 1;
  const bbSeat = n === 2 ? 1 : 2;
  const depthOf = () =>
    typeof table.depthBB === 'number'
      ? table.depthBB
      : table.depthBB[0] + r() * (table.depthBB[1] - table.depthBB[0]);
  const players: SeatPlayer[] = seats.map((seat) => ({
    seat,
    user_id: table.ids[seat - 1],
    username: 'U' + seat,
    stack: round(depthOf() * bb),
    bet: 0,
    totalInvested: 0,
    cards: deck.splice(0, HOLE_CARDS[table.variant]),
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
  }));
  const bySeat = new Map(players.map((p) => [p.seat, p]));
  const post = (seat: number, amt: number) => {
    const p = bySeat.get(seat)!;
    p.bet = amt;
    p.totalInvested = amt;
    p.stack = round(p.stack - amt);
  };
  post(sbSeat, sb);
  post(bbSeat, bb);
  const st: ProbeTableState = {
    players,
    history: [],
    currentBet: bb,
    lastRaise: bb,
    dealerSeat,
    bb,
    sb,
  };
  let raises = 0;
  let callersOfLast = 0;
  let limpers = 0;
  const acted = new Set<number>();
  const note = (hero: SeatPlayer, action: 'fold' | 'check' | 'call' | 'raise', amount: number) =>
    st.history.push({
      seat: hero.seat,
      userId: hero.user_id,
      action,
      amount,
      timestamp: 1000 + st.history.length,
      stage: 'preflop',
    } as ActionRecord);
  // Action starts left of the big blind.
  let idx = seats.indexOf(bbSeat);
  let guard = 0;
  for (;;) {
    if (guard++ > n * 8) throw new Error('preflop did not close');
    const live = players.filter((p) => !p.is_folded);
    if (live.length <= 1) break;
    const pending = live.filter(
      (p) => !p.is_all_in && (!acted.has(p.seat) || p.bet < st.currentBet)
    );
    if (pending.length === 0) break;
    idx = (idx + 1) % n;
    const hero = bySeat.get(seats[idx])!;
    if (hero.is_folded || hero.is_all_in) continue;
    if (acted.has(hero.seat) && hero.bet >= st.currentBet) continue;
    const reads = decideArms(table, st, hero.seat, arms, round);
    onSpot({
      variant: table.variant,
      mode: table.mode,
      seats: n,
      heroId: hero.user_id,
      heroSeat: hero.seat,
      heroCards: hero.cards.slice(),
      raises,
      callers: callersOfLast,
      limpers,
      effectiveBB:
        Math.min(
          hero.stack + hero.bet,
          Math.max(0, ...live.filter((p) => p.seat !== hero.seat).map((p) => p.stack + p.bet))
        ) / bb,
      reads,
    });
    acted.add(hero.seat);
    let action = reads[0].action;
    const toCall = round(st.currentBet - hero.bet);
    let raiseTo = 0;
    if (action === 'raise' || action === 'bet') raiseTo = round(reads[0].amount);
    if (action === 'all_in') {
      raiseTo = round(hero.bet + hero.stack);
      action = raiseTo > st.currentBet ? 'raise' : 'call';
    }
    if (action === 'raise' && raiseTo <= st.currentBet) action = toCall > 0 ? 'call' : 'check';
    if (action === 'bet') action = 'raise';
    if (action === 'check' && toCall > 0) action = 'fold';
    if (action === 'fold') {
      hero.is_folded = true;
      note(hero, 'fold', 0);
      continue;
    }
    if (action === 'check') {
      note(hero, 'check', 0);
      continue;
    }
    if (action === 'raise') {
      const to = Math.min(raiseTo, round(hero.bet + hero.stack));
      st.lastRaise = round(Math.max(st.lastRaise, to - st.currentBet));
      hero.stack = round(hero.stack - (to - hero.bet));
      hero.bet = to;
      hero.totalInvested = to;
      if (hero.stack <= 0) hero.is_all_in = true;
      st.currentBet = to;
      raises++;
      callersOfLast = 0;
      note(hero, 'raise', to);
    } else {
      const pay = Math.min(toCall, hero.stack);
      hero.stack = round(hero.stack - pay);
      hero.bet = round(hero.bet + pay);
      hero.totalInvested = hero.bet;
      if (hero.stack <= 0) hero.is_all_in = true;
      if (raises === 0) limpers++;
      else callersOfLast++;
      note(hero, 'call', hero.bet);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// The synthetic fleet
// ─────────────────────────────────────────────────────────────────────────

export const PROBE_ARCHETYPES: readonly HorseHoldemArchetype[] = [
  'lag_shark',
  'tag_crusher',
  'tricky_trap',
  'nit_hunter',
];

export const syntheticHorseId = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/**
 * The first synthetic ids, in order, that fill each archetype's quota. The
 * default is 900 ids in exactly the model's 25/20/40/15 mix.
 */
export function syntheticFleet(
  quota: Readonly<Record<HorseHoldemArchetype, number>> = {
    lag_shark: 225,
    tricky_trap: 180,
    tag_crusher: 360,
    nit_hunter: 135,
  }
): string[] {
  const left: Record<string, number> = { ...quota };
  const want = Object.values(quota).reduce((a, b) => a + b, 0);
  const ids: string[] = [];
  for (let n = 1; ids.length < want; n++) {
    if (n > want * 200) throw new Error('synthetic fleet did not fill');
    const id = syntheticHorseId(n);
    const a = holdemPersonaFor(id).archetype;
    if (left[a] > 0) {
      left[a]--;
      ids.push(id);
    }
  }
  return ids;
}

// ─────────────────────────────────────────────────────────────────────────
// The opportunity-weighted measurement
// ─────────────────────────────────────────────────────────────────────────

export type PersonaBehaviour = 'threeBetBluff' | 'squeezeBluff' | 'fourBetReshove';
export const PERSONA_BEHAVIOURS: readonly PersonaBehaviour[] = [
  'threeBetBluff',
  'squeezeBluff',
  'fourBetReshove',
];
const KEY: Record<PersonaBehaviour, { eligible: string; changed: string; capped?: string }> = {
  threeBetBluff: {
    eligible: 'holdem_persona_3bet_bluff_eligible_seen',
    changed: 'holdem_persona_3bet_bluff_changed_seen',
    capped: 'holdem_persona_3bet_bluff_capped_seen',
  },
  squeezeBluff: {
    eligible: 'holdem_persona_squeeze_bluff_eligible_seen',
    changed: 'holdem_persona_squeeze_bluff_changed_seen',
    capped: 'holdem_persona_squeeze_bluff_capped_seen',
  },
  fourBetReshove: {
    eligible: 'holdem_persona_fourbet_reshove_eligible_seen',
    changed: 'holdem_persona_fourbet_reshove_changed_seen',
  },
};

/**
 * The reshove's effective-stack buckets (low exclusive, high inclusive). The
 * site is named 26-35bb but its gate is "over 25, up to 35", so the first
 * bucket is the part below 26 that the name leaves out.
 */
export const RESHOVE_STACK_BUCKETS: readonly (readonly [number, number])[] = [
  [25, 26],
  [26, 28],
  [28, 30],
  [30, 32],
  [32, 35],
];
const stackBucketOf = (effBB: number): string => {
  for (const [lo, hi] of RESHOVE_STACK_BUCKETS)
    if (effBB > lo && effBB <= hi) return `${lo}-${hi}bb`;
  return 'other';
};

export interface RateCell {
  eligible: number;
  taken: number;
  /** Percent, one decimal. */
  rate: number;
  /** 95% Wilson interval, percent. */
  low: number;
  high: number;
  /** Option on only: comparisons whose answer differed from the unscaled one. */
  changed: number;
  /** Option on, 3-bet and squeeze only: min(1, p * scale) held at 1. */
  capped: number;
}
/** Rows keyed 'pooled', an archetype, 'decile N', or a stack bucket. */
export type BehaviourReport = Record<string, RateCell>;
export interface PersonaReRaiseReport {
  seats: number;
  mode: ProbeMode;
  depthBB: number | readonly [number, number];
  ids: number;
  archetypeIds: Record<HorseHoldemArchetype, number>;
  tables: number;
  hands: number;
  seed: number;
  /** Mean of the scale over the ids used. */
  meanScale: number;
  /** Scale range of each decile of the ids used (decile 1 the tightest). */
  deciles: { decile: number; ids: number; low: number; high: number; meanMin1: number }[];
  /** The model's E[min(1, scale)], percent: the reshove bluff's expected rate. */
  modelMin1: { pooled: number } & Record<HorseHoldemArchetype, number>;
  /** E[min(1, scale)] over the ids used, percent. */
  fleetMin1: { pooled: number } & Record<HorseHoldemArchetype, number>;
  on: Record<PersonaBehaviour, BehaviourReport>;
  off: Record<PersonaBehaviour, BehaviourReport>;
  /** Option on: what a bluff class that did not reshove did instead. */
  reshoveInstead: Record<string, number>;
}

export function wilson95(taken: number, n: number): { low: number; high: number } {
  if (n <= 0) return { low: 0, high: 0 };
  const z = 1.959963984540054;
  const p = taken / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const w = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { low: Math.max(0, (c - w) / d), high: Math.min(1, (c + w) / d) };
}

const pct1 = (x: number) => Math.round(x * 1000) / 10;

/** The id-hash model's E[min(1, scale)]: pooled and per archetype, percent. */
export function modelExpectedMin1(): { pooled: number } & Record<HorseHoldemArchetype, number> {
  const out: Record<string, number> = {};
  let pooled = 0;
  for (const a of HOLDEM_ARCHETYPE_NLH_3BET_MIX) {
    let sum = 0;
    for (let h = 0; h < 1000; h++)
      sum += Math.min(
        1,
        Math.round((a.base + (h / 1000) * a.span) * 100) / 100 / HOLDEM_MODEL_MEAN_NLH_3BET_MIX
      );
    out[a.archetype] = pct1(sum / 1000);
    pooled += (a.sharePct / 100) * (sum / 1000);
  }
  return { ...out, pooled: pct1(pooled) } as { pooled: number } & Record<
    HorseHoldemArchetype,
    number
  >;
}

type Raw = { e: number; t: number; c: number; cap: number };
type Tally = Record<PersonaBehaviour, Map<string, Raw>>;
const emptyTally = (): Tally => ({
  threeBetBluff: new Map(),
  squeezeBluff: new Map(),
  fourBetReshove: new Map(),
});
const rawOf = (m: Map<string, Raw>, key: string): Raw => {
  let r = m.get(key);
  if (!r) m.set(key, (r = { e: 0, t: 0, c: 0, cap: 0 }));
  return r;
};

function reportOf(
  tally: Tally,
  rows: readonly string[]
): Record<PersonaBehaviour, BehaviourReport> {
  return Object.fromEntries(
    PERSONA_BEHAVIOURS.map((b) => [
      b,
      Object.fromEntries(
        rows
          .filter((k) => b === 'fourBetReshove' || !(k.endsWith('bb') || k === 'other'))
          .map((k) => {
            const r = tally[b].get(k) ?? { e: 0, t: 0, c: 0, cap: 0 };
            const w = wilson95(r.t, r.e);
            return [
              k,
              {
                eligible: r.e,
                taken: r.t,
                rate: r.e > 0 ? pct1(r.t / r.e) : 0,
                low: pct1(w.low),
                high: pct1(w.high),
                changed: r.c,
                capped: r.cap,
              },
            ];
          })
      ),
    ])
  ) as Record<PersonaBehaviour, BehaviourReport>;
}

export interface MeasureOptions {
  /** Seats per table (the fleet is cut into tables of this many). */
  seats?: number;
  mode?: ProbeMode;
  depthBB?: number | readonly [number, number];
  /** Hands dealt per table per seat rotation. */
  handsPerRotation?: number;
  seed?: number;
  /** The ids to seat, in table order. Default: syntheticFleet(). */
  ids?: readonly string[];
}

const ON: ProbeArm = { opts: { holdemPersonaReRaiseMix: true }, telemetry: true };
const OFF: ProbeArm = { opts: {}, telemetry: true };

/**
 * The measurement. Every table plays every seat rotation; the option-on run
 * and the option-off run are dealt the same cards from the same seeds.
 */
export function measurePersonaReRaise(o: MeasureOptions = {}): PersonaReRaiseReport {
  const seats = o.seats ?? 9;
  const mode = o.mode ?? 'cash';
  const depthBB = o.depthBB ?? (mode === 'cash' ? 100 : ([20, 40] as const));
  const handsPerRotation = o.handsPerRotation ?? 700;
  const seed = o.seed ?? 20261114;
  const ids = o.ids ?? syntheticFleet();
  const tables = Math.floor(ids.length / seats);
  const archetypeOf = new Map(ids.map((id) => [id, holdemPersonaFor(id).archetype]));
  const scaleOf = new Map(ids.map((id) => [id, holdemPersonaReRaiseScale(id)]));
  const archetypeIds = Object.fromEntries(
    PROBE_ARCHETYPES.map((a) => [a, ids.filter((id) => archetypeOf.get(id) === a).length])
  ) as Record<HorseHoldemArchetype, number>;
  // Deciles of the ids used, by scale (ties broken by id order).
  const ranked = ids
    .map((id, i) => ({ id, i, s: scaleOf.get(id)! }))
    .sort((x, y) => x.s - y.s || x.i - y.i);
  const decileOf = new Map(
    ranked.map((x, rank) => [x.id, Math.min(10, 1 + Math.floor((rank * 10) / ranked.length))])
  );
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const deciles = Array.from({ length: 10 }, (_, d) => {
    const xs = ranked.filter((x) => decileOf.get(x.id) === d + 1).map((x) => x.s);
    return {
      decile: d + 1,
      ids: xs.length,
      low: Math.round(Math.min(...xs) * 1000) / 1000,
      high: Math.round(Math.max(...xs) * 1000) / 1000,
      meanMin1: pct1(mean(xs.map((s) => Math.min(1, s)))),
    };
  });
  const min1 = (keep: (id: string) => boolean) =>
    pct1(mean(ids.filter(keep).map((id) => Math.min(1, scaleOf.get(id)!))));
  const fleetMin1 = {
    pooled: min1(() => true),
    ...Object.fromEntries(
      PROBE_ARCHETYPES.map((a) => [a, min1((id) => archetypeOf.get(id) === a)])
    ),
  } as { pooled: number } & Record<HorseHoldemArchetype, number>;
  const rows = [
    'pooled',
    ...PROBE_ARCHETYPES,
    ...deciles.map((d) => `decile ${d.decile}`),
    ...RESHOVE_STACK_BUCKETS.map(([lo, hi]) => `${lo}-${hi}bb`),
  ];
  const reshoveInstead: Record<string, number> = {};
  let hands = 0;
  const run = (arm: 'on' | 'off'): Tally => {
    const tally = emptyTally();
    const r = probeRng(seed + seats * 7919);
    seedFastRandom((seed + seats * 104729) >>> 0);
    hands = 0;
    for (let t = 0; t < tables; t++) {
      const seated = ids.slice(t * seats, (t + 1) * seats);
      for (let rot = 0; rot < seats; rot++) {
        const rotated = seated.map((_, i) => seated[(i + rot) % seats]);
        const table: ProbeTable = { variant: 'nlh', mode, ids: rotated, depthBB };
        for (let h = 0; h < handsPerRotation; h++) {
          hands++;
          playProbeHand(table, r, arm === 'on' ? [ON] : [OFF, ON], (spot) => {
            // Off: the second look (option on, same stream position) says
            // whether the off decision reached the comparison.
            const look = arm === 'on' ? spot.reads[0] : spot.reads[1];
            const real = spot.reads[0];
            for (const b of PERSONA_BEHAVIOURS) {
              if (!look.fires.includes(KEY[b].eligible)) continue;
              const reshove = b === 'fourBetReshove';
              const taken = reshove
                ? arm === 'on'
                  ? !real.fires.includes(KEY[b].changed)
                  : real.action === 'all_in'
                : real.bluffBranch;
              const groups = [
                'pooled',
                archetypeOf.get(spot.heroId)!,
                `decile ${decileOf.get(spot.heroId)}`,
                ...(reshove ? [stackBucketOf(spot.effectiveBB)] : []),
              ];
              for (const g of groups) {
                const cell = rawOf(tally[b], g);
                cell.e++;
                if (taken) cell.t++;
                if (arm === 'on' && real.fires.includes(KEY[b].changed)) cell.c++;
                if (arm === 'on' && KEY[b].capped && real.fires.includes(KEY[b].capped!))
                  cell.cap++;
              }
              if (reshove && arm === 'on' && !taken)
                reshoveInstead[real.action] = (reshoveInstead[real.action] ?? 0) + 1;
            }
          });
        }
      }
    }
    return tally;
  };
  const onTally = run('on');
  const offTally = run('off');
  const extra = [...onTally.fourBetReshove.keys(), ...offTally.fourBetReshove.keys()].includes(
    'other'
  )
    ? ['other']
    : [];
  return {
    seats,
    mode,
    depthBB,
    ids: ids.length,
    archetypeIds,
    tables,
    hands,
    seed,
    meanScale: Math.round(mean([...scaleOf.values()]) * 100000) / 100000,
    deciles,
    modelMin1: modelExpectedMin1(),
    fleetMin1,
    on: reportOf(onTally, [...rows, ...extra]),
    off: reportOf(offTally, [...rows, ...extra]),
    reshoveInstead,
  };
}

const LABEL: Record<PersonaBehaviour, string> = {
  threeBetBluff: 'RULE 1  3-bet bluff',
  squeezeBluff: 'RULE 2  squeeze bluff',
  fourBetReshove:
    'RULE 3  26-35bb four-bet reshove (gate: over 25bb, up to 35bb effective), bluff classes A5s-A2s',
};

export function formatPersonaReRaiseReport(rep: PersonaReRaiseReport): string {
  const lines: string[] = [];
  const depth = typeof rep.depthBB === 'number' ? `${rep.depthBB}bb` : `${rep.depthBB.join('-')}bb`;
  lines.push(
    `${rep.seats}-handed ${rep.mode} ${depth}: ${rep.ids} ids (LAG ${rep.archetypeIds.lag_shark} / TAG ${rep.archetypeIds.tag_crusher} / Tricky ${rep.archetypeIds.tricky_trap} / Nit ${rep.archetypeIds.nit_hunter}), ${rep.tables} tables x ${rep.seats} rotations, ${rep.hands} hands per arm, seed ${rep.seed}, mean scale ${rep.meanScale}`
  );
  const cell = (c: RateCell | undefined) =>
    c ? `${c.taken}/${c.eligible} = ${c.rate}% (${c.low} to ${c.high})` : '0/0';
  for (const b of PERSONA_BEHAVIOURS) {
    lines.push(LABEL[b]);
    const reshove = b === 'fourBetReshove';
    for (const row of Object.keys(rep.on[b])) {
      const on = rep.on[b][row];
      const off = rep.off[b][row];
      const d = row.startsWith('decile ') ? rep.deciles[Number(row.slice(7)) - 1] : undefined;
      const expected =
        reshove && row === 'pooled'
          ? `  expected on: model ${rep.modelMin1.pooled}%, these ids ${rep.fleetMin1.pooled}%`
          : reshove && row in rep.modelMin1
            ? `  expected on: model ${rep.modelMin1[row as HorseHoldemArchetype]}%, these ids ${rep.fleetMin1[row as HorseHoldemArchetype]}%`
            : reshove && d
              ? `  expected on: these ids ${d.meanMin1}%`
              : '';
      lines.push(
        `  ${(d ? `${row} (scale ${d.low}-${d.high})` : row).padEnd(30)} on ${cell(on)}` +
          (reshove ? '' : ` capped ${on.capped}`) +
          ` changed ${on.changed}  | off ${cell(off)}${expected}`
      );
    }
    const on = rep.on[b].pooled;
    const off = rep.off[b].pooled;
    lines.push(
      `  pooled: option-off rate ${off.rate}% is ${off.rate >= on.low && off.rate <= on.high ? 'INSIDE' : 'OUTSIDE'} the option-on interval ${on.low} to ${on.high}`
    );
    if (reshove)
      lines.push(
        `  a bluff class that did not reshove did instead: ${JSON.stringify(rep.reshoveInstead)}`
      );
  }
  return lines.join('\n');
}
