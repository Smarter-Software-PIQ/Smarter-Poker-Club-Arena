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
 * ranked by its equity against the pool. Fold rates and realization are
 * measured cells, person-specific (shrunk) where the person has a row.
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
import {
  OMAHA_MATH_CORE_TABLE_VERSION,
  betRate,
  preflopFoldToHorse,
  preflopFreq,
  responseTo,
  wagerNonValue,
  type Actor,
  type PreflopLevel,
  type PreflopPosition,
  type Street,
} from './OmahaMathCoreTables.js';

export const OMAHA_MATH_CORE_VERSION = 'omaha-math-core-v3-public';

export interface CoreOpponent {
  seat: number;
  user: string;
  person: boolean;
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
  rake: { percent: number; cap: number; noFlopNoDrop: boolean } | null;
  seed: string;
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
  opponents: { seat: number; person: boolean; range: string }[];
  evs: CoreActionEv[];
  choice: { action: CoreActionEv['action']; amount: number | null; ev: number };
  samples: number;
  ms: number;
  /** equity calls that fell back to the unconditioned pool (narrow ranges colliding) */
  equityFallbacks?: number;
  /** set by the rule when the legalizer restated the wager size */
  legalized?: { from: number | null; to: number | null; action: string };
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

const round2 = (x: number) => Math.round(x * 100) / 100;

function rakeNet(state: CoreState, final: number): number {
  if (!state.rake || !(state.rake.percent > 0)) return final;
  if (state.street === 'preflop' && state.rake.noFlopNoDrop) return final;
  return (
    final -
    Math.min((state.rake.percent / 100) * final, state.rake.cap > 0 ? state.rake.cap : Infinity)
  );
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
    label: `${label} value ${round2(1 - alpha)} / bluff ${round2(alpha)} at frequency ${round2(b)}`,
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

/** The core decision. Throws on any inconsistency (the caller keeps its decision with an error receipt). */
export function decideOmahaMathCore(state: CoreState, clock: Clock): { receipt: CoreReceipt } {
  const t0 = clock.now();
  const rng = seededRng(state.seed);
  const live = state.opponents.filter((o) => !o.folded);
  if (live.length === 0) throw new Error('omahaMathCore: no live opponent');
  if (state.hole.length !== Number(state.variant.slice(-1)))
    throw new Error('omahaMathCore: hole count');
  const street = state.street;
  const game = state.variant;
  const mode = state.mode;
  const pre = street === 'preflop';
  const pool = buildPool(
    state.hole,
    state.board,
    state.hole.length,
    // preflop: 30 shared boards per holding so the strength order is not noise (SE ~0.05 per holding)
    pre ? 300 : street === 'river' ? 500 : 360,
    pre ? 30 : 6,
    rng
  );
  const stack = Math.max(0, state.heroStack);
  const toCall = Math.max(0, Math.min(state.toCall, stack));
  const P = state.pot;
  const playersNow: 'hu' | 'mw' = live.length === 1 ? 'hu' : 'mw';
  const actorOf = (o: CoreOpponent): Actor => (o.person ? 'person' : 'horse');
  const aggressor = live.find((o) => o.seat === state.aggressorSeat) ?? null;
  let samples = 0;
  let equityFallbacks = 0;
  // the whole decision is time-boxed (the worker deadline turns a late answer into a fold)
  const deadline = t0 + OMAHA_MATH_CORE_BUDGET_MS;
  const remaining = () => Math.max(5, Math.min(EQ_OPTS.maxMs, deadline - clock.now()));
  const coreSampler = (ranges: RangeSpec[]) =>
    equityVsPools(state.hole, state.board, pool, ranges, seededRng(`${state.seed}|eq`), {
      ...EQ_OPTS,
      maxMs: remaining(),
      now: clock.now,
    });
  const eq = (ranges: RangeSpec[]): EquityResult => {
    // lane EQUITY's equityVsRanges; the core's own exact 2+3 sampler when equityVsRanges declines (it returns null rather than throw, e.g. on repeated joint collisions)
    let r: EquityResult =
      EQUITY_ENGINE === 'equity-lane' && clock.now() < deadline
        ? equityVsPoolsEquityLane(
            state.hole,
            state.board,
            pool,
            ranges,
            seedNumber(`${state.seed}|eq`),
            { ...EQ_OPTS, now: clock.now }
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
    samples += r.samples;
    return r;
  };

  // ── each live opponent's range now, from public information only ──
  const st = street as Exclude<Street, 'preflop'>;
  const rangeOf = new Map<number, RangeSpec>();
  for (const o of live) {
    const actor = actorOf(o);
    let range: RangeSpec | null = null;
    if (pre) {
      const pos = o.position;
      const f0 = pos ? preflopFreq({ game, mode, position: pos, lvl: 0, actor }) : null;
      const f1 = pos ? preflopFreq({ game, mode, position: pos, lvl: 1, actor }) : null;
      const f2 = pos ? preflopFreq({ game, mode, position: pos, lvl: 2, actor }) : null;
      const f3 = pos ? preflopFreq({ game, mode, position: pos, lvl: 3, actor }) : null;
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
        // a raise: how often this kind of player raises a wager of this size is public
        const c = responseTo({
          game,
          mode,
          street: st,
          line: 'all',
          band: state.band,
          players: playersNow,
          bettor: 'horse',
          responder: actor,
          user: null,
        });
        const nv = wagerNonValue({
          game,
          mode,
          street: st,
          line: state.line,
          band: state.band,
          players: playersNow,
          bettor: actor,
        });
        range = wagerRange(
          pool,
          s,
          c ? Math.max(0.02, c.raise) : INTERIM_WAGER_FREQUENCY,
          `raise [${c ? c.source : 'interim frequency'}; ${nv ? nv.source : 'break-even bluff share'}]`,
          nv ? nv.nv : undefined
        );
      } else {
        // public: how often this kind of player wagers on this line, and the share of such wagers
        // shown at showdown that were not value (lead decision: shownNonValue)
        const br = betRate({
          game,
          mode,
          street: st,
          line: state.line ?? 'all',
          players: playersNow,
          actor,
          user: o.person ? o.user : null,
        });
        const nv = wagerNonValue({
          game,
          mode,
          street: st,
          line: state.line ?? 'all',
          band: state.band,
          players: playersNow,
          bettor: actor,
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
      const c = responseTo({
        game,
        mode,
        street: st,
        line: state.line,
        band: state.band,
        players: playersNow,
        bettor: actorOf(aggressor),
        responder: actor,
        user: o.person ? o.user : null,
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
        actor,
        user: o.person ? o.user : null,
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

  // realization: no public measurement yet (the measured tables used exact equity against hidden cards)
  const real = 1;
  const realCell = { source: 'no public realization measurement: none applied' };
  const realized = (_closing: boolean): number => real;

  const foldOf = (
    o: CoreOpponent,
    frac: number,
    allIn: boolean,
    level: 'open' | '3bet' | '4bet+'
  ): { p: number; r: number; source: string } => {
    if (o.allIn) return { p: 0, r: 0, source: 'all-in' };
    if (pre) {
      const facing =
        level === 'open' ? 'facing_open' : level === '3bet' ? 'facing_3bet' : 'facing_4bet+';
      const c = preflopFoldToHorse({
        game,
        mode,
        position: o.position ?? 'all',
        facing,
        actor: actorOf(o),
      });
      return c
        ? { p: c.p, r: 0, source: c.source }
        : { p: 0, r: 0, source: 'no measured cell: no fold credit' };
    }
    const c = responseTo({
      game,
      mode,
      street: street as Exclude<Street, 'preflop'>,
      line: state.heroWagerLine,
      band: sizeBand(frac, allIn),
      players: playersNow,
      bettor: 'horse',
      responder: actorOf(o),
      user: o.person ? o.user : null,
    });
    if (!o.person) {
      // A Horse responder: the table measures Horses of the pre-core brain (they over-folded). A
      // Horse on this core defends to the price, folding s / (1 + s) of his range to a wager of
      // pot share s; pricing core Horses with the old cells would make cores bluff each other
      // without end (PROVE self-play). The raise share stays the measured one.
      const sc = Math.max(0, frac) / (1 + Math.max(0, frac));
      return {
        p: sc,
        r: c ? Math.max(0, Math.min(1 - sc, c.raise)) : 0,
        source: `self-consistent Horse defence: fold s/(1+s) = ${round2(sc)} at s = ${round2(frac)}${c ? ` (old Horse cell ${round2(c.fold)}: ${c.source})` : ''}`,
      };
    }
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
  const label = (rs: RangeSpec[]) => rs.map((r) => r.label).join(' + ');

  if (toCall > 0.005) {
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
      if (behind.length === 0) {
        ev =
          realized(callAllIn || street === 'river') *
            e1.equity *
            rakeNet(state, P + toCall - uncovered) -
          toCall;
      } else {
        // players behind face the same price: each folds at his measured rate, else continues (strongest share)
        let pAllFold = 1;
        let extra = 0;
        const cont: RangeSpec[] = [];
        const frac = state.toCall / Math.max(1e-9, P - state.toCall);
        for (const o of behind) {
          // a player behind faces the AGGRESSOR's wager (his line, size and kind), not a Horse wager
          const fc =
            !pre && aggressor && state.line && state.band
              ? responseTo({
                  game,
                  mode,
                  street: street as Exclude<Street, 'preflop'>,
                  line: state.line,
                  band: state.band,
                  players: playersNow,
                  bettor: actorOf(aggressor),
                  responder: actorOf(o),
                  user: o.person ? o.user : null,
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
      evs.push({
        action: callAllIn ? 'all_in' : 'call',
        amount: callAllIn ? round2(state.heroBet + stack) : round2(toCall),
        adds: toCall,
        ev,
        equity: e1.equity,
        se: e1.se,
        foldProb: 0,
        foldSource: null,
        range: label(base),
      });
    }
  } else if (legalHas(state, 'check')) {
    const rs = live.map((o) => rangeOf.get(o.seat)!);
    const e = eq(rs);
    let ev = realized(false) * e.equity * rakeNet(state, P);
    let note = 'check closes the street';
    // The check is a line, not a terminal: heads-up, an opponent still to act wagers at his public
    // rate (his median measured size) with his public wager range; the hero then folds or calls,
    // the better; when he checks behind, the hero holds his share against the checking range.
    const toAct = live.filter((o) => o.streetAction === 'none' && !o.allIn);
    if (!pre && live.length === 1 && toAct.length === 1) {
      const o = toAct[0];
      const actor = actorOf(o);
      const lineIfBet: Line = o.prevAggressor ? (street === 'flop' ? 'cbet' : 'barrel') : 'stab';
      const br = betRate({
        game,
        mode,
        street: street as Exclude<Street, 'preflop'>,
        line: lineIfBet,
        players: playersNow,
        actor,
        user: o.person ? o.user : null,
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
          bettor: actor,
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
      ev,
      equity: e.equity,
      se: e.se,
      foldProb: 0,
      foldSource: note,
      range: label(rs),
    });
  }

  // ── wagers: bet / raise at a half and a full pot, smaller bets unopened, and all-in ──
  if (
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
        pAllFold * rakeNet(state, P) +
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
            f.p * rakeNet(state, P) +
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
      evs.push({
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

  if (evs.length === 0) throw new Error('omahaMathCore: no legal action priced');
  let best = evs[0];
  for (const a of evs)
    if (a.ev > best.ev + 1e-9 || (Math.abs(a.ev - best.ev) <= 1e-9 && a.adds < best.adds)) best = a;
  const r4 = (x: number | null) => (x === null ? null : Math.round(x * 1e4) / 1e4);
  return {
    receipt: {
      version: OMAHA_MATH_CORE_VERSION,
      switch: 'omahaMathCore',
      tables: OMAHA_MATH_CORE_TABLE_VERSION,
      street,
      realization: { value: real, source: realCell.source },
      price: toCall > 0 ? round2((toCall / (P + toCall)) * 1e4) / 1e4 : 0,
      pot: P,
      toCall,
      opponents: live.map((o) => ({
        seat: o.seat,
        person: o.person,
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
      samples,
      equityFallbacks,
      ms: Math.round((clock.now() - t0) * 10) / 10,
    },
  };
}
