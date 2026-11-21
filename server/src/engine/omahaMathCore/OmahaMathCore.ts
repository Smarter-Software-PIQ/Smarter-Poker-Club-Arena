/**
 * omahaMathCore (lane MATHCORE 2026-11-19; owner orders 7:33-7:55 PM Chicago:
 * "ITS MATH FIRST ... make 100% of the decisions based on the math, the hand,
 * the outs, the board. NEVER pre-determined choices").
 *
 * One expected-value decision for every PLO4/PLO5 cash decision (table and
 * Lightning alike, every street). For each legal action - fold, check, call,
 * bet or raise at several sizes, all-in - it computes, in chips from now on:
 *   fold  = 0
 *   check = realization x equity(current ranges) x pot(net of rake)
 *   call  = realization x equity(current ranges) x (pot + call)(net) - call
 *           (players still to act behind: each folds at his measured rate,
 *           else continues with his strongest share and adds his call)
 *   wager = P(everyone folds) x pot(net)
 *         + P(called) x (realization x equity(continuing ranges) x final pot(net) - chips added)
 * and takes the largest. The river and any all-in carry no realization
 * factor (no later decision). The decision that reached the core is never an
 * input, prior or tie-break.
 *
 * Ranges are measured (lane RANGES, OmahaMathCoreTables.ts): the wagerer's
 * holding mix by street, line, size and players; a checker's / caller's mix;
 * a preflop raiser's top-x% deciles; a caller's VPIP width. They are applied
 * to a pool of concrete holdings from the unseen cards (card removal), each
 * classified exactly as the table was built (classifyOmahaHolding) or, preflop,
 * ranked by its equity against the pool. Fold rates are measured cells pooled
 * over EVERY player: one rule for every opponent and for the hero, no person /
 * Horse label and no per-user row anywhere in a lookup (lane CORE-POOLED, owner
 * 9:52 AM Nov 20; OmahaMathCoreIdentityFree.law.test.ts).
 * Equity: lane EQUITY's equityVsRanges (exact 2+3, joint draws, multiway).
 *
 * Pure: no brain random stream, no opponent memory beyond the measured tables
 * keyed by the request; deterministic for a given request.
 */
import {
  buildPool,
  equityVsPools,
  equityVsPoolsEquityLane,
  fullRange,
  seededRng,
  topOf,
  type EquityResult,
  type Pool,
  type RangeSpec,
} from './OmahaMathCoreEquity.js';
import { sizeBand, type Band, type Line } from './MeasuredRanges.js';
import { resetOmahaBestMemo } from './OmahaMathCoreEval.js';
import { omahaDrawFeatures, omahaDrawFutureTerm, type OmahaDrawFeatures } from './OmahaDraws.js';
import {
  OMAHA_MATH_CORE_TABLE_VERSION,
  preflopFoldToRaise,
  preflopFreq,
  wagerNonValue,
  type PreflopLevel,
  type PreflopPosition,
  type Street,
} from './OmahaMathCoreTables.js';
import {
  PREFLOP_GAMES,
  behindResponse,
  preflopOpponentModel,
  preflopRealization,
  reorderPoolPreflop,
  sliceOf,
  type PreflopPublicAction,
} from './OmahaMathCorePreflop.js';
import type { PublicStreetAction } from './OmahaMathCoreRangeTrack.js';
import { RAISE_FOLD_CREDIT_MIN_N } from './OmahaMathCoreValue.js';
import { CURRENT_NUTS_CALL_FLOOR, holdsCurrentNuts } from './OmahaMathCoreNutsFloor.js';
import {
  PREFLOP_REALIZATION_ADMITTED,
  selectionScore,
  wiredBetRate as betRate,
  wiredHeroResponse,
  wiredResponse,
  wiredTrack,
  wiredValue,
  type ResponseKey,
  type WireValueResult,
} from './OmahaMathCoreWire.js';

export const OMAHA_MATH_CORE_VERSION = 'omaha-math-core-v3-public';

export interface CoreOpponent {
  seat: number;
  stack: number;
  /** chips in front this street */
  bet: number;
  folded: boolean;
  allIn: boolean;
  /** his last action on this street before the hero's decision */
  streetAction: 'none' | 'check' | 'call' | 'wager';
  /** he called a wager on the previous street */
  calledPrevStreet: boolean;
  /** he was the previous street's last aggressor */
  prevAggressor: boolean;
  position: PreflopPosition | null;
  /** the highest preflop raise level he made ('call' = limped/called only, 'none' = no voluntary action yet) */
  preflopLevel: PreflopLevel | 'call' | 'none';
}

export interface CoreState {
  variant: 'plo4' | 'plo5';
  /** the table's chip unit (0.01 or 1): every wager the core proposes is a whole number of it */
  chipUnit: number;
  mode: 'table' | 'lightning';
  street: Street;
  hole: number[];
  board: number[];
  /** every chip in the middle, this street's bets included */
  pot: number;
  toCall: number;
  heroBet: number;
  heroStack: number;
  currentBet: number;
  minRaiseTo: number | null;
  maxRaiseTo: number | null;
  bigBlind: number;
  legal: string[];
  heroSeat: number;
  heroPosition: PreflopPosition | null;
  ip: boolean;
  opponents: CoreOpponent[];
  /** the street's last aggressor (null when nobody wagered), its line (RANGES definitions) and size band */
  aggressorSeat: number | null;
  line: Line | null;
  band: Band | null;
  /** the last wager's share of the pot (bet: added/pot before; raise: (added - to call)/(pot + to call)) */
  wagerFrac: number;
  /** the line a hero wager would be (cbet/barrel/stab/probe/donk/raise/check_raise) */
  heroWagerLine: Line;
  /** preflop raises so far (0 unopened, 1 open, 2 three-bet, ...) */
  preflopRaises: number;
  /**
   * `whole` (omahaMathCoreNetsTheWholeDeduction, default OFF): `cap` is the cap of the dealt-player tier, `drop`
   * the fixed jackpot drop in chips, and a preflop line that reaches a flop is netted of both (a preflop
   * fold-out still pays nothing). Absent: percentage and table cap after the flop only, as before.
   */
  rake: {
    percent: number;
    cap: number;
    noFlopNoDrop: boolean;
    whole?: boolean;
    drop?: number;
  } | null;
  seed: string;
  /** the hand's public postflop actions in order (lane RANGEADV's tracker; absent: current-street rules) */
  history?: PublicStreetAction[];
  /** the hand's public preflop actions in order (lane PREFLOP-EV's bands; absent: preflopLevel) */
  preflopActions?: PreflopPublicAction[];
}

export interface CoreActionEv {
  action: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all_in';
  /** call: chips paid; bet: bet size; raise / all_in: raise-to total */
  amount: number | null;
  adds: number;
  ev: number;
  equity: number | null;
  se: number | null;
  foldProb: number;
  foldSource: string | null;
  range: string | null;
  /** lane DRAWS: later-street chips the showdown equity leaves out (implied / reverse implied / barrel); null = none */
  /**
   * lane CORE-4: measured realization of the core's own priced EV for this street and action (flop and turn);
   * ev above is the calibrated value r x (raw + adds) - adds; raw is the uncalibrated price
   */
  calibration?: { r: number; raw: number; rawSe: number | null; cell: string } | null;
  future?: {
    chips: number;
    implied: number;
    reverse: number;
    miss: number;
    barrel: number | null;
  } | null;
}

export interface CoreReceipt {
  version: string;
  switch: 'omahaMathCore';
  tables: string;
  street: Street;
  realization: { value: number; source: string };
  price: number;
  pot: number;
  toCall: number;
  opponents: { seat: number; range: string }[];
  evs: CoreActionEv[];
  choice: { action: CoreActionEv['action']; amount: number | null; ev: number };
  /** lane CORE-POOLED-2: set when the current-nuts call floor removed the fold (flop/turn, facing a wager) */
  nutFloor?: string | null;
  /** lane DRAWS: the hero's exact draw profile (PLO4/PLO5 flop and turn) */
  draw?: {
    cls: string;
    outs: number;
    nutOuts: number;
    cleanNutOuts: number;
    wrapSize: number;
    fd: string;
    source: string;
  } | null;
  samples: number;
  ms: number;
  /** equity calls that fell back to the unconditioned pool (narrow ranges colliding) */
  equityFallbacks?: number;
  /** set by the rule when the legalizer restated the wager size */
  legalized?: { from: number | null; to: number | null; action: string };
  /**
   * set by the rule (lane COREWIRE-2, lead 10:55 PM "prove it to change it"): today's action was kept because the
   * core's best did not beat it by more than the change margin (k x the combined standard error)
   */
  kept?: { incoming: string; best: string; gap: number; se: number; k: number };
  /** component wiring (lane COREWIRE): which components priced this decision */
  wire?: {
    track: string | null;
    value: WireValueResult['receipt'] | null;
    preflop: string | null;
    /** equity calls made in the last 40 ms of the time box (reduced sample floor) */
    lateEquityCalls: number;
  };
}

interface Clock {
  now: () => number;
}

/** Which equity engine prices the ranges: lane EQUITY's equityVsRanges (default) or the core's own sampler. */
let EQUITY_ENGINE: 'equity-lane' | 'core' = 'equity-lane';
export function setOmahaMathCoreEquityEngine(e: 'equity-lane' | 'core'): void {
  EQUITY_ENGINE = e;
}
function seedNumber(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193);
  return h >>> 0 || 1;
}
/** Interim wager frequency of a line until the public table carries it (named in every receipt that uses it). */
export const INTERIM_WAGER_FREQUENCY = 0.5;
/** The core's whole time budget per decision (inside the 250 ms Lightning floor with the reference work). */
export const OMAHA_MATH_CORE_BUDGET_MS = 150;
const EQ_OPTS = { targetSe: 0.01, minSamples: 400, maxSamples: 4000, maxMs: 40 };
/**
 * Deterministic work budget per decision (lane COREWIRE-2, PROVE-2 gate G6): equity draws x opponents. The
 * 150 ms clock box cannot bind when the clock does not move (exact replay freezes performance.now) and a wall
 * clock makes the answer depend on machine load; this budget bounds the work the same way everywhere. Measured
 * on the exact replay: heads-up decisions use ~2,400 draws (unaffected); five-way flops used up to 11,600 draws x
 * 5 opponents (200-254 ms). Past the budget every equity call takes the reduced floor (150-600 draws).
 */
export const OMAHA_MATH_CORE_WORK_BUDGET = 12000;

const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * The pot the winner takes. `foldOut` marks a pot won because every opponent folded to the hero's
 * wager: preflop that hand sees no flop and pays nothing (no flop, no drop). Every other preflop line
 * the core prices reaches a flop, and with `rake.whole` it is netted of the capped rake and the
 * jackpot drop like a postflop pot (EMERG lane RAKE 2026-11-20). Without `rake.whole`: as before.
 */
function rakeNet(state: CoreState, final: number, foldOut = false): number {
  const rake = state.rake;
  if (!rake || !(rake.percent > 0)) return final;
  if (state.street === 'preflop' && rake.noFlopNoDrop && (rake.whole !== true || foldOut))
    return final;
  const taken = Math.min((rake.percent / 100) * final, rake.cap > 0 ? rake.cap : Infinity);
  if (rake.whole !== true) return final - taken;
  const drop = Number.isFinite(rake.drop) ? Math.max(0, rake.drop as number) : 0;
  return final - taken - Math.min(drop, Math.max(0, final - taken));
}

/** Holdings of the pool between two strength shares (0 = strongest). */
function band(pool: Pool, lo: number, hi: number, label: string): RangeSpec {
  const a = Math.max(0, Math.min(pool.size - 1, Math.floor(lo * pool.size)));
  const b = Math.max(a + 1, Math.min(pool.size, Math.round(hi * pool.size)));
  return { parts: [{ idx: pool.order.slice(a, b), weight: 1 }], label };
}

/**
 * A wagerer's range from public information: a wager of share s of the pot is
 * value from the top of his holdings and bluffs from the bottom, the bluffs at
 * the share that makes a call break even, s / (1 + 2s) (the size is public;
 * the composition follows from it), at the line's wager frequency b.
 */
function wagerRange(
  pool: Pool,
  s: number,
  b: number,
  label: string,
  measuredNonValue?: number
): RangeSpec {
  const alpha = measuredNonValue ?? s / (1 + 2 * s);
  const valueN = Math.max(1, Math.round((1 - alpha) * b * pool.size));
  const bluffN = Math.max(0, Math.round(alpha * b * pool.size));
  const parts = [{ idx: pool.order.slice(0, valueN), weight: 1 - alpha }];
  if (bluffN > 0) parts.push({ idx: pool.order.slice(pool.size - bluffN), weight: alpha });
  return {
    parts,
    label: `${label} Value ${round2(1 - alpha)} / Bluff ${round2(alpha)} At Frequency ${round2(b)}`,
  };
}

function topShare(pool: Pool, share: number, label: string): RangeSpec {
  const n = Math.max(1, Math.round(Math.min(1, Math.max(0.02, share)) * pool.size));
  return { parts: [{ idx: pool.order.slice(0, n), weight: 1 }], label };
}

/** A raise-to on the table's chip unit, inside [minTo, maxTo] (down to the unit, never below the minimum). */
function onUnit(to: number, minTo: number, maxTo: number, unit: number): number {
  const u = unit > 0 ? unit : 0.01;
  const lo = Math.ceil(minTo / u - 1e-9) * u;
  const hi = Math.floor(maxTo / u + 1e-9) * u;
  const v = Math.floor(to / u + 1e-9) * u;
  return round2(Math.min(Math.max(v, lo), hi));
}

function legalHas(state: CoreState, a: string): boolean {
  return state.legal.includes(a);
}

/**
 * Nobody else can win the pot (every opponent folded): the pot is the hero's whatever he does, so the
 * cheapest legal action is the exact maximum (check, else call, else fold), with a receipt.
 */
function uncontestedReceipt(state: CoreState, ms: number): CoreReceipt {
  const act: CoreActionEv['action'] = state.legal.includes('check')
    ? 'check'
    : state.legal.includes('call')
      ? 'call'
      : 'fold';
  const adds = act === 'call' ? Math.max(0, Math.min(state.toCall, state.heroStack)) : 0;
  const ev = act === 'fold' ? 0 : state.pot;
  const a: CoreActionEv = {
    action: act,
    amount: act === 'call' ? round2(adds) : null,
    adds,
    ev,
    equity: act === 'fold' ? null : 1,
    se: 0,
    foldProb: 0,
    foldSource: 'uncontested: no opponent can win the pot',
    range: null,
  };
  return {
    version: OMAHA_MATH_CORE_VERSION,
    switch: 'omahaMathCore',
    tables: OMAHA_MATH_CORE_TABLE_VERSION,
    street: state.street,
    realization: { value: 1, source: 'uncontested' },
    price: 0,
    pot: state.pot,
    toCall: state.toCall,
    opponents: [],
    evs: [a],
    choice: { action: act, amount: a.amount, ev: round2(ev) },
    samples: 0,
    ms: Math.round(ms * 10) / 10,
  };
}

/** The core decision. Throws on any inconsistency (the caller keeps its decision with an error receipt). */
/**
 * Realization calibration of the core's own priced EV (lane CORE-4, Nov 20 2026; brief item 2).
 *
 * Measured (exact journal replay of the core tree c3c = 1fd33508abd on every journaled PLO4/PLO5 cash decision,
 * Nov 18 1 PM to Nov 19): for each decision the live Horse took, the core's priced EV of THAT action against the
 * chips the Horse actually got back from that point (own result + chips already in; a fold is 0). Ratio
 * r = sum(realised + adds) / sum(priced + adds) per game | street | action (n >= 20), else game | street (cells for
 * PLO4 and the turn are kept for the record; only the streets listed apply). PLO5
 * flop: priced +43.8 bb per call, realised +1.1 +- 6.1 (r 0.34); turn +44.6 vs +9.8 +- 6.6; PLO4 is close to 1.
 * The core's multi-street plan prices later streets the live Horses (and the core's own later decisions) do not
 * bank, worst on the passive lines (check, call) and least on raises.
 *
 * Provenance class own_cards_history (lead ruling 2026-11-19): the inputs are the Horse's own priced EV (its own
 * cards, the board, public actions) and its own chips won; no opponent's hidden card is read.
 * PLO5 flop (lane CORE-POOLED-4, Nov 21): replaced by a population realization fitted offline on hand_history with
 * every player's recorded cards (equity vs the actual holdings, realised chips at hand end, all-in adjusted), all
 * players pooled; check 0.677, raise 1.034, call and bet the pooled 0.809 (the old c3c cells were check 0.31,
 * call 0.343, bet 0.61, raise 0.903 on 47 raises). Same slot and formula as before.
 * Applied to every non-fold candidate on the streets listed (fold stays 0): ev' = r x (ev + adds) - adds,
 * se' = r x se. PLO6 never reaches the core (scope gate); the river is not calibrated here.
 * The calibrated prices rank the continuing actions. A change across the fold boundary (fold -> continue or
 * continue -> fold) must win under BOTH the raw and the calibrated price (OmahaMathCoreRule.ts): r is an average
 * over the calls the Horses made, not a per-hand realization, so it may not by itself fold a call (CORE-4 CV replay:
 * calibrated-only call -> fold on the PLO5 flop graded -1,986 +- 648 bb all-in, -483 +- 297 realised, Nov 19).
 */
export const OMAHA_MATH_CORE_REALIZATION_CALIBRATION = {
  version: 'core-pooled4-realization-v2',
  // the applied cells (streets below: PLO5 flop only) are population_all_cards_capped: an anonymous population
  // parameter fitted offline on every player's recorded cards, never keyed by player, top player 1.7% of a fit cell
  // (cap 20% never binds), never read live. The PLO4 and turn cells are kept for the record (own_cards_history).
  provenance: 'population_all_cards_capped' as const,
  source:
    'PLO5 flop: hand_history population realization (lane CORE-POOLED-4, amendment sha d7fbd6c8); other cells: core3 c3c exact replay receipts vs own realised chips, Nov 18 1 PM - Nov 19, n >= 20 per cell',
  minN: 20,
  // CORE-4 criterion 2 (CRITERIA-CORE4-2.md sha b95d08ec..., exact-replay cross-validation by day vs c3c, delta M1 all-in
  // / M2 realised): PLO5 flop PASS (Nov 19 +644 +- 255 realised, -77 +- 364 all-in; Nov 18 +288 +- 196, -163 +- 183);
  // PLO5 turn FAIL (Nov 19 -564 +- 451 realised); PLO4 flop FAIL (Nov 19 -113 +- 60). Only PASS streets are listed.
  streets: { plo4: [], plo5: ['flop'] } as Record<string, readonly string[]>,
  cells: {
    'plo4|flop': { r: 0.896, n: 369 },
    'plo4|flop|bet': { r: 0.696, n: 103 },
    'plo4|flop|call': { r: 1.133, n: 38 },
    'plo4|flop|check': { r: 1.285, n: 155 },
    'plo4|turn': { r: 0.85, n: 203 },
    'plo4|turn|bet': { r: 0.952, n: 63 },
    'plo4|turn|check': { r: 0.894, n: 77 },
    // PLO5 flop: lane CORE-POOLED-4 (CRITERIA-CORE-POOLED-4-REALIZATION-AMENDMENT sha d7fbd6c8...1c79), measured
    // from hand_history offline, every player pooled: realised chips at hand end (all-in adjusted) over equity vs
    // the opponents' actual holdings x the net pot after the flop round; fit Oct 16 - Nov 16, check Nov 18-20 by
    // serving era. One factor (R1) unless a pair of actions differs at |z| >= 2 with n >= 100 in both sets:
    // only check vs raise does, so check and raise carry their own fit value, call and bet take R1.
    'plo5|flop': { r: 0.8091, n: 8973 },
    'plo5|flop|bet': { r: 0.8091, n: 1996 },
    'plo5|flop|call': { r: 0.8091, n: 1898 },
    'plo5|flop|check': { r: 0.6768, n: 4847 },
    'plo5|flop|raise': { r: 1.0342, n: 232 },
    'plo5|turn': { r: 0.655, n: 1310 },
    'plo5|turn|all_in': { r: 0.697, n: 35 },
    'plo5|turn|bet': { r: 0.663, n: 468 },
    'plo5|turn|call': { r: 0.532, n: 156 },
    'plo5|turn|check': { r: 0.573, n: 363 },
    'plo5|turn|raise': { r: 0.885, n: 32 },
  } as Record<string, { r: number; n: number }>,
};

/** the calibration cell for a candidate (game | street | action, else game | street), null when not calibrated */
export function realizationCalibrationCell(
  variant: string,
  street: string,
  action: string
): { r: number; cell: string } | null {
  const C = OMAHA_MATH_CORE_REALIZATION_CALIBRATION;
  if (action === 'fold') return null;
  const streets = C.streets[variant];
  if (!streets || !streets.includes(street)) return null;
  for (const key of [`${variant}|${street}|${action}`, `${variant}|${street}`]) {
    const c = C.cells[key];
    if (c && c.n >= C.minN && Number.isFinite(c.r) && c.r > 0)
      return { r: c.r, cell: `${key} r=${c.r} n=${c.n}` };
  }
  return null;
}

/** applies the realization calibration in place (pure arithmetic on the priced candidates) */
export function applyRealizationCalibration(
  evs: CoreActionEv[],
  variant: string,
  street: string
): number {
  let applied = 0;
  for (const a of evs) {
    const c = realizationCalibrationCell(variant, street, a.action);
    if (!c) continue;
    const raw = a.ev;
    const rawSe = a.se;
    a.ev = c.r * (raw + a.adds) - a.adds;
    if (a.se !== null && Number.isFinite(a.se)) a.se = c.r * a.se;
    a.calibration = {
      r: c.r,
      raw: Math.round(raw * 100) / 100,
      rawSe: rawSe === null ? null : Math.round(rawSe * 1e4) / 1e4,
      cell: c.cell,
    };
    applied++;
  }
  return applied;
}

export function decideOmahaMathCore(state: CoreState, clock: Clock): { receipt: CoreReceipt } {
  resetOmahaBestMemo();
  const t0 = clock.now();
  const rng = seededRng(state.seed);
  // every opponent still in the hand; when the state marks none live but some are all-in (PROVE-2 hand
  // 60037957: every other seat all-in), the all-in seats are the field (no fold credit for them)
  let live = state.opponents.filter((o) => !o.folded);
  if (live.length === 0) live = state.opponents.filter((o) => o.allIn);
  if (live.length === 0) return { receipt: uncontestedReceipt(state, clock.now() - t0) };
  if (state.hole.length !== Number(state.variant.slice(-1)))
    throw new Error('omahaMathCore: hole count');
  const street = state.street;
  const game = state.variant;
  const mode = state.mode;
  const pre = street === 'preflop';
  // postflop: lane RANGEADV's tracked ranges over the whole public line; its pool is the decision's
  // pool (the core's own pool is built only when tracking declines)
  const tracked = pre ? null : wiredTrack(state, clock.now);
  const pool =
    tracked?.pool ??
    buildPool(
      state.hole,
      state.board,
      state.hole.length,
      pre ? 300 : street === 'river' ? 500 : 360,
      // preflop PLO4/PLO5: lane PREFLOP-EV's model sets the strength order below, so one shared board
      // is enough here (the 30-board percentile it replaces cost most of the preflop time)
      pre ? (PREFLOP_GAMES.includes(game) ? 1 : 30) : 6,
      rng
    );
  // preflop strength order: lane PREFLOP-EV's additive two-card equity model (lead decision: unconditional)
  if (pre && PREFLOP_GAMES.includes(game)) reorderPoolPreflop(pool, game);
  const stack = Math.max(0, state.heroStack);
  const toCall = Math.max(0, Math.min(state.toCall, stack));
  const P = state.pot;
  const playersNow: 'hu' | 'mw' = live.length === 1 ? 'hu' : 'mw';
  const aggressor = live.find((o) => o.seat === state.aggressorSeat) ?? null;
  let samples = 0;
  let equityFallbacks = 0;
  // the whole decision is time-boxed (the worker deadline turns a late answer into a fold)
  const deadline = t0 + OMAHA_MATH_CORE_BUDGET_MS;
  const remaining = () => Math.max(5, Math.min(EQ_OPTS.maxMs, deadline - clock.now()));
  // anytime (lane COREWIRE): inside the last 40 ms of the box every equity call takes the core sampler
  // at a reduced sample floor (150 draws, SE ~0.04), so a wide decision still answers on time
  let lateCalls = 0;
  let work = 0;
  const late = () => deadline - clock.now() < 40 || work >= OMAHA_MATH_CORE_WORK_BUDGET;
  // draws this call may take inside the work budget (at least the reduced floor's 150)
  const drawCap = (k: number) =>
    Math.max(
      150,
      Math.min(
        EQ_OPTS.maxSamples,
        Math.floor((OMAHA_MATH_CORE_WORK_BUDGET - work) / Math.max(1, k))
      )
    );
  const coreSampler = (ranges: RangeSpec[]) =>
    equityVsPools(
      state.hole,
      state.board,
      pool,
      ranges,
      seededRng(`${state.seed}|eq`),
      late()
        ? { ...EQ_OPTS, minSamples: 150, maxSamples: 600, maxMs: 3, now: clock.now }
        : {
            ...EQ_OPTS,
            minSamples: Math.min(EQ_OPTS.minSamples, drawCap(ranges.length)),
            maxSamples: drawCap(ranges.length),
            maxMs: remaining(),
            now: clock.now,
          }
    );
  const eq = (ranges: RangeSpec[]): EquityResult => {
    // lane EQUITY's equityVsRanges; the core's own exact 2+3 sampler when equityVsRanges declines (it returns null rather than throw, e.g. on repeated joint collisions)
    let r: EquityResult =
      // (four or more opponents: the core's clock-capped sampler; equityVsRanges has no clock cap and its
      // joint redraws on narrow multiway preflop ranges measured up to 270 ms, COREWIRE smoke)
      EQUITY_ENGINE === 'equity-lane' && !late() && ranges.length <= 3
        ? equityVsPoolsEquityLane(
            state.hole,
            state.board,
            pool,
            ranges,
            seedNumber(`${state.seed}|eq`),
            {
              ...EQ_OPTS,
              minSamples: Math.min(EQ_OPTS.minSamples, drawCap(ranges.length)),
              maxSamples: drawCap(ranges.length),
              now: clock.now,
            }
          )
        : coreSampler(ranges);
    if (!Number.isFinite(r.equity)) r = coreSampler(ranges);
    // narrow ranges colliding on every draw (four or five live opponents): the same sampler against
    // the unconditioned pool for every seat, named in the receipt (never today's path silently)
    if (!Number.isFinite(r.equity)) {
      r = coreSampler(
        ranges.map((x) => fullRange(pool, `pool (collision fallback for ${x.label})`))
      );
      equityFallbacks++;
    }
    if (!Number.isFinite(r.equity)) throw new Error('omahaMathCore: equity unavailable');
    if (late()) lateCalls++;
    samples += r.samples;
    work += r.samples * Math.max(1, ranges.length);
    return r;
  };

  // ── each live opponent's range now, from public information only ──
  const st = street as Exclude<Street, 'preflop'>;
  const rangeOf = new Map<number, RangeSpec>();
  for (const o of live) {
    let range: RangeSpec | null = null;
    if (pre) {
      const pos = o.position;
      const f0 = pos ? preflopFreq({ game, mode, position: pos, lvl: 0 }) : null;
      const f1 = pos ? preflopFreq({ game, mode, position: pos, lvl: 1 }) : null;
      const f2 = pos ? preflopFreq({ game, mode, position: pos, lvl: 2 }) : null;
      const f3 = pos ? preflopFreq({ game, mode, position: pos, lvl: 3 }) : null;
      if (o.preflopLevel === 'open' && f0)
        range = topShare(pool, f0.raise, `open: top ${round2(f0.raise)} [${f0.source}]`);
      else if (o.preflopLevel === '3bet' && f1)
        range = topShare(pool, f1.raise, `3-bet: top ${round2(f1.raise)} [${f1.source}]`);
      else if (o.preflopLevel === '4bet' && f0 && f2)
        range = topShare(
          pool,
          f0.raise * f2.raise,
          `4-bet: top ${round2(f0.raise * f2.raise)} [${f0.source}; ${f2.source}]`
        );
      else if (o.preflopLevel === '5bet+' && f1 && f3)
        range = topShare(
          pool,
          f1.raise * f3.raise,
          `5-bet: top ${round2(f1.raise * f3.raise)} [${f1.source}; ${f3.source}]`
        );
      else if (o.preflopLevel === 'call') {
        const f = state.preflopRaises > 0 ? f1 : f0;
        if (f)
          range = band(
            pool,
            f.raise,
            f.raise + f.call,
            `called: band ${round2(f.raise)}-${round2(f.raise + f.call)} [${f.source}]`
          );
      }
    } else if (o.seat === state.aggressorSeat && state.band) {
      const s = Math.max(0.05, state.wagerFrac);
      if (state.line === 'raise' || state.line === 'check_raise') {
        // a raise: how often a player raises a wager of this size is public (every player pooled)
        const c = wiredResponse(state.board, {
          game,
          mode,
          street: st,
          line: 'all',
          band: state.band,
          players: playersNow,
        });
        const nv = wagerNonValue({
          game,
          mode,
          street: st,
          line: state.line,
          band: state.band,
          players: playersNow,
        });
        range = wagerRange(
          pool,
          s,
          c ? Math.max(0.02, c.raise) : INTERIM_WAGER_FREQUENCY,
          `raise [${c ? c.source : 'interim frequency'}; ${nv ? nv.source : 'break-even bluff share'}]`,
          nv ? nv.nv : undefined
        );
      } else {
        // public: how often a player wagers on this line (every player pooled), and the share of such wagers
        // shown at showdown that were not value (lead decision: shownNonValue)
        const br = betRate({
          game,
          mode,
          street: st,
          line: state.line ?? 'all',
          players: playersNow,
        });
        const nv = wagerNonValue({
          game,
          mode,
          street: st,
          line: state.line ?? 'all',
          band: state.band,
          players: playersNow,
        });
        range = wagerRange(
          pool,
          s,
          br ? Math.max(0.02, br.b) : INTERIM_WAGER_FREQUENCY,
          `wager ${state.line}/${state.band} [${br ? br.source : 'interim frequency'}; ${nv ? nv.source : 'break-even bluff share'}]`,
          nv ? nv.nv : undefined
        );
      }
    } else if (o.streetAction === 'call' && aggressor && state.line && state.band) {
      const c = wiredResponse(state.board, {
        game,
        mode,
        street: st,
        line: state.line,
        band: state.band,
        players: playersNow,
      });
      if (c)
        range = band(
          pool,
          c.raise,
          1 - c.fold,
          `called: band ${round2(c.raise)}-${round2(1 - c.fold)} [${c.source}]`
        );
    } else if (o.streetAction === 'check') {
      const br = betRate({
        game,
        mode,
        street: st,
        line: 'all',
        players: playersNow,
      });
      const b = br ? br.b : INTERIM_WAGER_FREQUENCY;
      range = band(
        pool,
        b,
        1,
        `checked: below the top ${round2(b)} [${br ? br.source : 'interim frequency'}]`
      );
    }
    rangeOf.set(o.seat, range ?? fullRange(pool, 'pool (no public cell)'));
  }
  if (tracked) for (const [seat, r] of tracked.rangeOf) rangeOf.set(seat, r);
  // preflop: lane PREFLOP-EV's public-frequency bands and size-aware fold / re-raise
  const pfm = pre ? preflopOpponentModel(state, pool) : null;
  if (pfm) for (const [seat, r] of pfm.rangeOf) rangeOf.set(seat, r);

  // realization: no public measurement yet (the measured tables used exact equity against hidden cards)
  const real = 1;
  const realCell = { source: 'no public realization measurement: none applied' };
  const realized = (_closing: boolean): number => real;

  // ── lane DRAWS: later streets (PLO4/PLO5 flop and turn; PLO6 and the river get none) ──
  const drawF: OmahaDrawFeatures | null =
    street === 'flop' || street === 'turn' ? omahaDrawFeatures(state.hole, state.board) : null;
  const oppBehindMax = Math.max(0, ...live.map((o) => o.stack));
  let drawSource = '';
  const future = (potNext: number, heroAdds: number, allIn: boolean, barrelLine: Line | null) => {
    if (!drawF) return null;
    const effBehind = Math.min(
      stack - heroAdds,
      Math.max(0, oppBehindMax - Math.max(0, heroAdds - toCall))
    );
    let turnBarrelFold: { p: number; source: string } | null = null;
    if (barrelLine && street === 'flop') {
      let p = 1;
      const src: string[] = [];
      for (const o of live) {
        const c = wiredResponse(state.board, {
          game,
          mode,
          street: 'turn',
          line: barrelLine,
          band: sizeBand(2 / 3, false),
          players: playersNow,
        });
        if (!c) {
          p = NaN;
          break;
        }
        p *= c.fold;
        src.push(`s${o.seat}:${round2(c.fold)} ${c.source}`);
      }
      if (Number.isFinite(p)) turnBarrelFold = { p, source: src.join('; ') };
    }
    const t = omahaDrawFutureTerm(drawF, {
      street: street as 'flop' | 'turn',
      potNext,
      effBehind,
      allIn,
      turnBarrelFold,
    });
    drawSource = t.source;
    return t;
  };
  // preflop realization (LEAD RULING 2026-11-19: admitted, provenance own_cards_history: the Horses' own cards in
  // their own past hands, nothing about any opponent's hidden cards). Preflop stays behind omahaMathCorePreflop.
  // the realization of the preflop call / check line (the receipt's realization when admitted)
  let pfRealCallLine: { value: number; source: string } | null = null;
  const pfReal = (pot: number, eff: number, players: number, allIn: boolean) => {
    if (!PREFLOP_REALIZATION_ADMITTED) return { value: real, source: realCell.source };
    try {
      return preflopRealization(state, pot, eff, players, allIn);
    } catch (e) {
      return {
        value: real,
        source: `preflop realization error (${(e as Error).message}): ${realCell.source}`,
      };
    }
  };

  const foldOf = (
    o: CoreOpponent,
    frac: number,
    allIn: boolean,
    level: 'open' | '3bet' | '4bet+'
  ): { p: number; r: number; source: string } => {
    if (o.allIn) return { p: 0, r: 0, source: 'all-in' };
    if (pfm) {
      const toSize = state.currentBet + frac * (P + toCall);
      const f = pfm.foldOf(o, level, allIn ? state.heroBet + stack : toSize);
      return { p: f.p, r: f.reraise, source: f.source };
    }
    if (pre) {
      const facing =
        level === 'open' ? 'facing_open' : level === '3bet' ? 'facing_3bet' : 'facing_4bet+';
      const c = preflopFoldToRaise({
        game,
        mode,
        position: o.position ?? 'all',
        facing,
      });
      return c
        ? { p: c.p, r: 0, source: c.source }
        : { p: 0, r: 0, source: 'no measured cell: no fold credit' };
    }
    const c = wiredHeroResponse(state.hole, state.board, state.seed, {
      game,
      mode,
      street: street as Exclude<Street, 'preflop'>,
      line: state.heroWagerLine,
      band: sizeBand(frac, allIn),
      players: playersNow,
    } satisfies ResponseKey);
    // one measured, pooled response rule for every responder (no person/Horse branch)
    // a raise takes fold credit only from its exact street/line cell with n >= 30 (VALUE
    // RAISE_FOLD_CREDIT_MIN_N; persons' answers to raises are thin and value-heavy: PROVE river C7)
    if (
      c &&
      (state.heroWagerLine === 'raise' || state.heroWagerLine === 'check_raise') &&
      c.exactN < RAISE_FOLD_CREDIT_MIN_N
    )
      return {
        p: 0,
        r: Math.max(0, Math.min(1, c.raise)),
        source: `${c.source}; no fold credit (raise line, exact n ${c.exactN} < ${RAISE_FOLD_CREDIT_MIN_N})`,
      };
    return c
      ? { p: c.fold, r: Math.max(0, Math.min(1 - c.fold, c.raise)), source: c.source }
      : { p: 0, r: 0, source: 'no measured cell: no fold credit' };
  };

  const evs: CoreActionEv[] = [];
  // players still to act who owe chips (one who already matched the bet, a big blind facing a
  // limp, cannot fold: he is in front, priced with his range, never given fold credit)
  const behind = live.filter(
    (o) =>
      o.streetAction === 'none' &&
      !o.allIn &&
      o.seat !== state.aggressorSeat &&
      o.bet < state.currentBet - 0.005
  );
  const front = live.filter((o) => !behind.includes(o));
  // preflop (lane PREFLOP-EV): a player still to act who already matched (a big blind facing a limp)
  // cannot fold but can still raise (iso); he is priced as behind with no fold share
  const behindPf = pre
    ? live.filter((o) => o.streetAction === 'none' && !o.allIn && o.seat !== state.aggressorSeat)
    : behind;
  const label = (rs: RangeSpec[]) => rs.map((r) => r.label).join(' + ');

  // postflop: lane VALUE's planValue prices check / call / every size (the one implementation of the
  // check node, the raised branch and the multi-street continuation; field response from HVH-MULTI,
  // players behind priced by HVH-MULTI's squeeze term); the one-step loop below is the fallback
  let wired: WireValueResult | null = null;
  let wiredNote: string | null = null;
  if (!pre) {
    try {
      wired = wiredValue({
        state,
        pool,
        live,
        behind,
        front,
        rangeOf,
        eq,
        topOf: (r, share, l) => topOf(pool, r, share, l),
        rakeNet: (f) => rakeNet(state, f),
        onUnit,
        legalHas: (a) => legalHas(state, a),
        deadline,
        now: clock.now,
      });
      if (!wired) wiredNote = 'value: null (core one-step loop)';
    } catch (e) {
      wired = null;
      wiredNote = `value error (${String((e as Error)?.message ?? e).slice(0, 120)}): core one-step loop`;
    }
  }
  if (wired) {
    if (toCall > 0.005 && legalHas(state, 'fold'))
      evs.push({
        action: 'fold',
        amount: null,
        adds: 0,
        ev: 0,
        equity: null,
        se: null,
        foldProb: 0,
        foldSource: null,
        range: null,
      });
    evs.push(...wired.evs);
  }

  if (!wired && toCall > 0.005) {
    if (legalHas(state, 'fold'))
      evs.push({
        action: 'fold',
        amount: null,
        adds: 0,
        ev: 0,
        equity: null,
        se: null,
        foldProb: 0,
        foldSource: null,
        range: null,
      });
    const callAllIn = state.heroStack <= state.toCall + 0.005;
    if (legalHas(state, 'call') || (callAllIn && legalHas(state, 'all_in'))) {
      const base = front.map((o) => rangeOf.get(o.seat)!);
      // a wager larger than the hero's whole stack: the excess is not his to win
      const uncovered = callAllIn
        ? front.reduce((s, o) => s + Math.max(0, o.bet - (state.heroBet + stack)), 0)
        : 0;
      const e1 = eq(base);
      let ev: number;
      let behindNote: string | null = null;
      if ((pfm ? behindPf : behind).length === 0) {
        let rz = realized(callAllIn || street === 'river');
        if (pfm && !callAllIn) {
          // preflop, nobody behind: the measured realization of this call line (admitted own_cards_history)
          const effC = Math.min(
            stack - toCall,
            Math.max(0, ...live.map((o) => o.stack - Math.max(0, state.currentBet - o.bet)))
          );
          const rr = pfReal(P + toCall - uncovered, effC, live.length + 1, effC <= 0.005);
          pfRealCallLine = rr;
          rz = rr.value;
        }
        ev = rz * e1.equity * rakeNet(state, P + toCall - uncovered) - toCall;
      } else if (pfm) {
        // preflop with players still to act (lane PREFLOP-EV): each folds / calls / raises at his public
        // frequency for his node; a raise behind (iso / squeeze) is priced one step deep
        let pNoRaise = 1;
        let worst: { o: CoreOpponent; r: number } | null = null;
        let extra = 0;
        const cont: RangeSpec[] = [];
        const srcs: string[] = [];
        const basePf = live.filter((o) => !behindPf.includes(o)).map((o) => rangeOf.get(o.seat)!);
        for (const o of behindPf) {
          const br0 = behindResponse(state, o);
          // matched already: his non-raise is a check, never a fold
          const br =
            o.bet >= state.currentBet - 0.005
              ? { ...br0, fold: 0, call: Math.max(0, 1 - br0.raise) }
              : br0;
          pNoRaise *= 1 - br.raise;
          if (br.raise > 0 && (!worst || br.raise > worst.r)) worst = { o, r: br.raise };
          const pc = br.call / Math.max(1e-9, br.call + br.fold);
          const r0 = rangeOf.get(o.seat)!;
          cont.push(
            sliceOf(
              pool,
              r0,
              br.raise,
              br.raise + br.call,
              `behind calls ${round2(br.call)} of ${r0.label}`
            )
          );
          extra += pc * Math.max(0, Math.min(o.stack + o.bet, state.currentBet) - o.bet);
          srcs.push(
            `s${o.seat}: fold ${round2(br.fold)} call ${round2(br.call)} raise ${round2(br.raise)} ${br.source}`
          );
        }
        const e2 = eq([...basePf, ...cont]);
        const potN = P + toCall + extra - uncovered;
        const effN = Math.min(
          stack - toCall,
          Math.max(0, ...live.map((o) => o.stack - Math.max(0, state.currentBet - o.bet)))
        );
        const rN = callAllIn
          ? { value: 1, source: 'all-in' }
          : pfReal(potN, effN, basePf.length + 1 + behindPf.length, effN <= 0.005);
        pfRealCallLine = rN;
        const evNoRaise = rN.value * e2.equity * rakeNet(state, potN) - toCall;
        let evRaised = -toCall;
        if (worst && !callAllIn && pNoRaise < 1 - 1e-6) {
          const o = worst.o;
          const r0 = rangeOf.get(o.seat)!;
          const rr = topOf(pool, r0, worst.r, `raises behind ${round2(worst.r)} of ${r0.label}`);
          const P1 = P + toCall;
          const oCall = state.currentBet - o.bet;
          const to2 = Math.min(
            o.stack + o.bet,
            state.currentBet + P1 + oCall,
            state.heroBet + stack
          );
          const heroCall = Math.max(0, to2 - (state.heroBet + toCall));
          const potR = P1 + (to2 - o.bet) + heroCall;
          const allInR = to2 >= state.heroBet + stack - 0.005 || to2 >= o.stack + o.bet - 0.005;
          const eR = eq([...basePf, rr]);
          const effR = Math.min(stack - toCall - heroCall, o.stack + o.bet - to2);
          const rR = pfReal(potR, effR, basePf.length + 2, allInR);
          const callR = rR.value * eR.equity * rakeNet(state, potR) - (toCall + heroCall);
          evRaised = Math.max(-toCall, callR);
          srcs.push(
            `raise behind by s${o.seat} to ${round2(to2)}: hero ${callR > -toCall ? 'calls' : 'folds'} ${round2(evRaised)}; ${rR.source}`
          );
        }
        ev = pNoRaise * evNoRaise + (1 - pNoRaise) * evRaised;
        behindNote = srcs.join('; ');
      } else {
        // players behind face the same price: each folds at his measured rate, else continues (strongest share)
        let pAllFold = 1;
        let extra = 0;
        const cont: RangeSpec[] = [];
        const frac = state.toCall / Math.max(1e-9, P - state.toCall);
        for (const o of behind) {
          // a player behind faces the AGGRESSOR's wager (his line and size; the pooled cell)
          const fc =
            !pre && aggressor && state.line && state.band
              ? wiredResponse(state.board, {
                  game,
                  mode,
                  street: street as Exclude<Street, 'preflop'>,
                  line: state.line,
                  band: state.band,
                  players: playersNow,
                })
              : null;
          const f = fc
            ? { p: fc.fold, r: fc.raise, source: fc.source }
            : foldOf(
                o,
                frac,
                false,
                state.preflopRaises <= 1 ? 'open' : state.preflopRaises === 2 ? '3bet' : '4bet+'
              );
          pAllFold *= f.p;
          cont.push(
            topOf(
              pool,
              rangeOf.get(o.seat)!,
              1 - f.p,
              `continue ${round2(1 - f.p)} of ${rangeOf.get(o.seat)!.label}`
            )
          );
          extra += Math.max(0, Math.min(o.stack + o.bet, state.currentBet) - o.bet);
        }
        const e2 = eq([...base, ...cont]);
        const r = realized(callAllIn);
        ev =
          pAllFold * (r * e1.equity * rakeNet(state, P + toCall - uncovered) - toCall) +
          (1 - pAllFold) *
            (r * e2.equity * rakeNet(state, P + toCall + extra - uncovered) - toCall);
      }
      const futCall = future(P + toCall, toCall, callAllIn, null);
      if (futCall) ev += futCall.chips;
      evs.push({
        future: futCall,
        action: callAllIn ? 'all_in' : 'call',
        amount: callAllIn ? round2(state.heroBet + stack) : round2(toCall),
        adds: toCall,
        ev,
        equity: e1.equity,
        se: e1.se,
        foldProb: 0,
        foldSource: behindNote,
        range: label(base),
      });
    }
  } else if (!wired && legalHas(state, 'check')) {
    const rs = live.map((o) => rangeOf.get(o.seat)!);
    const e = eq(rs);
    let ev = realized(false) * e.equity * rakeNet(state, P);
    let note = 'check closes the street';
    const futCheck = future(P, 0, false, null);
    // The check is a line, not a terminal: heads-up, an opponent still to act wagers at his public
    // rate (his median measured size) with his public wager range; the hero then folds or calls,
    // the better; when he checks behind, the hero holds his share against the checking range.
    const toAct = live.filter((o) => o.streetAction === 'none' && !o.allIn);
    if (!pre && live.length === 1 && toAct.length === 1) {
      const o = toAct[0];
      const lineIfBet: Line = o.prevAggressor ? (street === 'flop' ? 'cbet' : 'barrel') : 'stab';
      const br = betRate({
        game,
        mode,
        street: street as Exclude<Street, 'preflop'>,
        line: lineIfBet,
        players: playersNow,
      });
      if (br) {
        const sz = br.size;
        const B = Math.min(sz * P, o.stack, stack);
        const nv = wagerNonValue({
          game,
          mode,
          street: street as Exclude<Street, 'preflop'>,
          line: lineIfBet,
          band: sizeBand(sz, false),
          players: playersNow,
        });
        const range = rangeOf.get(o.seat)!;
        const betRange = wagerRange(
          pool,
          sz,
          Math.max(0.02, br.b),
          `if he wagers ${round2(sz)} pot`,
          nv ? nv.nv : undefined
        );
        const checkRange = band(pool, br.b, 1, 'if he checks behind');
        void range;
        const eBet = eq([betRange]);
        const eCheck = eq([checkRange]);
        const heroAllIn = B >= stack - 0.005;
        const callEv =
          realized(heroAllIn || street === 'river') * eBet.equity * rakeNet(state, P + 2 * B) - B;
        const evIfBet = Math.max(0, callEv);
        const evIfCheck = realized(street === 'river') * eCheck.equity * rakeNet(state, P);
        ev = br.b * evIfBet + (1 - br.b) * evIfCheck;
        note = `he wagers ${round2(br.b)} [${br.source}] -> hero ${callEv > 0 ? 'calls' : 'folds'} (eq ${round2(eBet.equity)}); checks behind -> eq ${round2(eCheck.equity)}`;
      }
    }
    evs.push({
      action: 'check',
      amount: null,
      adds: 0,
      future: futCheck,
      ev: ev + (futCheck ? futCheck.chips : 0),
      equity: e.equity,
      se: e.se,
      foldProb: 0,
      foldSource: note,
      range: label(rs),
    });
  }

  // ── wagers: bet / raise at a half and a full pot, smaller bets unopened, and all-in ──
  if (
    !wired &&
    // nobody left to call a wager (every opponent all-in): no wager is priced (PROVE-2 hand 60037957)
    live.some((o) => !o.allIn) &&
    (legalHas(state, 'raise') || legalHas(state, 'bet') || legalHas(state, 'all_in')) &&
    stack > toCall + 0.005
  ) {
    const maxTo = state.maxRaiseTo ?? state.heroBet + stack;
    const minTo = state.minRaiseTo ?? state.currentBet + state.bigBlind;
    const allInTo = state.heroBet + stack;
    const fracs = toCall > 0.005 || pre ? [0.5, 1] : [1 / 3, 0.5, 2 / 3, 1];
    const targets = new Set<number>();
    for (const f of fracs)
      targets.add(onUnit(state.currentBet + f * (P + toCall), minTo, maxTo, state.chipUnit));
    if (allInTo <= maxTo + 0.005) targets.add(round2(allInTo));
    const level: 'open' | '3bet' | '4bet+' =
      state.preflopRaises === 0 ? 'open' : state.preflopRaises === 1 ? '3bet' : '4bet+';
    for (const to of [...targets].sort((a, b) => a - b)) {
      if (to > allInTo + 0.005) continue;
      const allIn = to >= allInTo - 0.005;
      const action: CoreActionEv['action'] = allIn
        ? 'all_in'
        : state.currentBet > 0.005
          ? 'raise'
          : 'bet';
      if (
        !legalHas(state, action) &&
        !(action === 'bet' && legalHas(state, 'raise')) &&
        !(action === 'raise' && legalHas(state, 'bet'))
      )
        continue;
      const adds = Math.min(stack, to - state.heroBet);
      const frac = (adds - toCall) / Math.max(1e-9, P + toCall);
      if (pfm) {
        // preflop (lane PREFLOP-EV): each responder folds / re-raises / calls at his measured rates for
        // this size; the re-raise branch is priced one step deep (the hero then folds or calls)
        const P1 = P + adds;
        let pAll = 1;
        let pNoRR = 1;
        let callChips = 0;
        let worstRR: { o: CoreOpponent; rr: number } | null = null;
        let anyAll = allIn;
        const callRanges: RangeSpec[] = [];
        const srcs: string[] = [];
        for (const o of live) {
          const f = pfm.foldOf(o, level, to);
          const canRR = !allIn && !o.allIn && o.stack + o.bet > to + 0.005;
          const rr = canRR ? f.reraise : 0;
          const c = Math.max(0, 1 - f.p - rr);
          pAll *= f.p;
          pNoRR *= 1 - rr;
          const chips = Math.max(0, Math.min(o.stack + o.bet, to) - o.bet);
          callChips += chips * (c / Math.max(1e-9, c + f.p));
          if (o.stack + o.bet <= to + 0.005) anyAll = true;
          const r0 = rangeOf.get(o.seat)!;
          callRanges.push(
            sliceOf(
              pool,
              r0,
              rr,
              rr + c,
              `calls ${round2(c)} (band ${round2(rr)}-${round2(rr + c)}) of ${r0.label}`
            )
          );
          if (rr > 0 && (!worstRR || rr > worstRR.rr)) worstRR = { o, rr };
          srcs.push(`s${o.seat}: fold ${round2(f.p)} reraise ${round2(rr)} ${f.source}`);
        }
        const pRR = 1 - pNoRR;
        const pCall = Math.max(0, 1 - pAll - pRR);
        let evCalled = 0;
        let eC: EquityResult | null = null;
        if (pCall > 1e-6) {
          eC = eq(callRanges);
          const potC = P1 + callChips;
          const effB = Math.min(
            stack - adds,
            Math.max(0, ...live.map((o) => o.stack - Math.max(0, to - o.bet)))
          );
          const rC = pfReal(potC, effB, live.length + 1, anyAll || effB <= 0.005);
          evCalled = rC.value * eC.equity * rakeNet(state, potC) - adds;
          srcs.push(`called: ${rC.source}`);
        }
        let evRR = -adds;
        if (worstRR && pRR > 1e-6) {
          const o = worstRR.o;
          const r0 = rangeOf.get(o.seat)!;
          const rrRange = topOf(
            pool,
            r0,
            worstRR.rr,
            `re-raises ${round2(worstRR.rr)} of ${r0.label}`
          );
          const oCall = to - o.bet;
          const to2 = Math.min(o.stack + o.bet, to + (P1 + oCall), state.heroBet + stack);
          const heroCall = Math.max(0, to2 - to);
          const potRR = P1 + (to2 - o.bet) + heroCall;
          const allInRR = to2 >= state.heroBet + stack - 0.005 || to2 >= o.stack + o.bet - 0.005;
          const eR = eq([rrRange]);
          const effR = Math.min(stack - adds - heroCall, o.stack + o.bet - to2);
          const rR = pfReal(potRR, effR, 2, allInRR);
          const callRR = rR.value * eR.equity * rakeNet(state, potRR) - (adds + heroCall);
          evRR = Math.max(-adds, callRR);
          srcs.push(
            `re-raise by s${o.seat} to ${round2(to2)}: hero eq ${round2(eR.equity)} -> ${callRR > -adds ? 'call' : 'fold'} ${round2(evRR)}; ${rR.source}`
          );
        }
        evs.push({
          action,
          amount: action === 'bet' ? round2(adds) : round2(to),
          adds,
          ev: pAll * rakeNet(state, P, true) + pRR * evRR + pCall * evCalled,
          equity: eC ? eC.equity : null,
          se: eC ? eC.se : null,
          foldProb: pAll,
          foldSource: srcs.join('; '),
          range: label(callRanges),
        });
        continue;
      }
      let pAllFold = 1;
      let calls = 0;
      let anyAllIn = allIn;
      const cont: RangeSpec[] = [];
      const sources: string[] = [];
      for (const o of live) {
        const f = foldOf(o, frac, allIn, level);
        pAllFold *= f.p;
        sources.push(`s${o.seat}:${round2(f.p)} ${f.source}`);
        cont.push(
          topOf(
            pool,
            rangeOf.get(o.seat)!,
            1 - f.p,
            `continue ${round2(1 - f.p)} of ${rangeOf.get(o.seat)!.label}`
          )
        );
        calls += Math.max(0, Math.min(o.stack + o.bet, to) - o.bet);
        if (o.stack + o.bet <= to + 0.005) anyAllIn = true;
      }
      let e = eq(cont);
      let ev =
        pAllFold * rakeNet(state, P, true) +
        (1 - pAllFold) *
          (realized(anyAllIn || street === 'river') * e.equity * rakeNet(state, P + adds + calls) -
            adds);
      // Heads-up, the opponent may re-raise at his public raise frequency: priced one step deep
      // (his pot-size re-raise from the top of his range; the hero then folds or calls, the better).
      if (live.length === 1 && !allIn && !pre) {
        const o = live[0];
        const f = foldOf(o, frac, allIn, level);
        const oppMax = o.stack + o.bet;
        if (f.r > 0 && oppMax > to + 0.005) {
          const range = rangeOf.get(o.seat)!;
          const potAfterCall = P + adds + (to - o.bet);
          const oppTo = Math.min(oppMax, to + potAfterCall, state.heroBet + stack);
          const heroMore = Math.max(0, oppTo - to);
          const raiseRange = topOf(pool, range, f.r, `re-raise ${round2(f.r)} of ${range.label}`);
          const callRange = band(pool, f.r, 1 - f.p, `call band ${round2(f.r)}-${round2(1 - f.p)}`);
          const eCall = eq([callRange]);
          const eRaise = eq([raiseRange]);
          const closingR =
            oppTo >= state.heroBet + stack - 0.005 || oppTo >= oppMax - 0.005 || street === 'river';
          const vsRaise = Math.max(
            -adds,
            realized(closingR) *
              eRaise.equity *
              rakeNet(state, P + adds + heroMore + (oppTo - o.bet)) -
              adds -
              heroMore
          );
          const pc = Math.max(0, 1 - f.p - f.r);
          ev =
            f.p * rakeNet(state, P, true) +
            pc *
              (realized(anyAllIn || street === 'river') *
                eCall.equity *
                rakeNet(state, P + adds + calls) -
                adds) +
            f.r * vsRaise;
          e = eCall;
          sources.push(
            `re-raise ${round2(f.r)} -> hero ${vsRaise <= -adds + 1e-9 ? 'folds' : 'calls'} (eq ${round2(eRaise.equity)})`
          );
        }
      }
      const futWager = future(P + adds + calls, adds, anyAllIn, 'barrel');
      if (futWager) ev += (1 - pAllFold) * futWager.chips;
      evs.push({
        future: futWager,
        action,
        amount: action === 'bet' ? round2(adds) : round2(to),
        adds,
        ev,
        equity: e.equity,
        se: e.se,
        foldProb: pAllFold,
        foldSource: sources.join('; '),
        range: label(cont),
      });
    }
  }

  // current-nuts call floor (OmahaMathCoreNutsFloor.ts): every postflop street, facing a wager, a call available
  let nutFloor: string | null = null;
  if (CURRENT_NUTS_CALL_FLOOR && !pre && toCall > 0.005) {
    const callLike = evs.some(
      (e) => e.action === 'call' || (e.action === 'all_in' && e.adds <= toCall + 0.005)
    );
    if (
      callLike &&
      evs.some((e) => e.action === 'fold') &&
      holdsCurrentNuts(state.hole, state.board)
    ) {
      for (let i = evs.length - 1; i >= 0; i--) if (evs[i].action === 'fold') evs.splice(i, 1);
      nutFloor = `current nuts facing a wager (${street}): fold not a candidate, call or raise only`;
    }
  }
  if (evs.length === 0) throw new Error('omahaMathCore: no legal action priced');
  if (!pre) applyRealizationCalibration(evs, String(state.variant).toLowerCase(), street);
  // ranked by the lower confidence bound (selectionScore, OmahaMathCoreWire.ts); ties: fewer chips
  let best = evs[0];
  for (const a of evs) {
    const d = selectionScore(a) - selectionScore(best);
    if (d > 1e-9 || (Math.abs(d) <= 1e-9 && a.adds < best.adds)) best = a;
  }
  const r4 = (x: number | null) => (x === null ? null : Math.round(x * 1e4) / 1e4);
  return {
    receipt: {
      version: OMAHA_MATH_CORE_VERSION,
      switch: 'omahaMathCore',
      tables: OMAHA_MATH_CORE_TABLE_VERSION,
      street,
      realization: pfRealCallLine ?? { value: real, source: realCell.source },
      price: toCall > 0 ? round2((toCall / (P + toCall)) * 1e4) / 1e4 : 0,
      pot: P,
      toCall,
      opponents: live.map((o) => ({
        seat: o.seat,
        range: rangeOf.get(o.seat)!.label,
      })),
      evs: evs.map((a) => ({
        ...a,
        ev: round2(a.ev),
        adds: round2(a.adds),
        equity: r4(a.equity),
        se: r4(a.se),
      })),
      choice: { action: best.action, amount: best.amount, ev: round2(best.ev) },
      nutFloor,
      draw: drawF
        ? {
            cls: drawF.cls,
            outs: drawF.outs,
            nutOuts: drawF.nutOuts,
            cleanNutOuts: drawF.cleanNutOuts,
            wrapSize: drawF.wrapSize,
            fd: drawF.fd,
            source: drawSource,
          }
        : null,
      samples,
      equityFallbacks,
      ms: Math.round((clock.now() - t0) * 10) / 10,
      wire: {
        track: tracked
          ? `rangeadv tracked ${tracked.rangeOf.size} seats (${Math.round(tracked.ms)} ms)`
          : null,
        value: wired ? wired.receipt : null,
        preflop: pfm ? 'preflop-ev bands and fold / re-raise' : wiredNote,
        lateEquityCalls: lateCalls,
      },
    },
  };
}
