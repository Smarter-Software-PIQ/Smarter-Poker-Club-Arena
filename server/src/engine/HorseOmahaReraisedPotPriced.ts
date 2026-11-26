/**
 * OMAHA RE-RAISED POT, PRICED BY POSITION, DEPTH AND PLAYERS (PLO lead-6 2026-11-24; options
 * omahaReraisedPotCallIsPriced and omahaReraisedPotReraiseIsPriced, each default OFF, read `=== true`).
 *
 * Owner rulings this prices: "calling 3-bets and 4-bets out of position is a losing play; out of position needs a
 * much stronger range; calling ranges are coordinated hands"; no blanket rule (every decision priced by the hand,
 * the opponents and the pot and stacks); nothing keyed on person-vs-Horse identity or a named player; no unshown
 * hole card read or stored.
 *
 * WHAT IT PRICES. PLO4/PLO5 cash, high only, one board, preflop, the Horse facing a 3-bet or more. Every amount is
 * in chips relative to folding now (what the Horse already has in is sunk):
 *
 *   EV(fold) = 0
 *   EV(call) = (1 - rho) x SUM over who behind continues, s:
 *                P(s) x [ R(pos_s, players_s, spr_s, eq_s) x eq_s x (pot_s - rake(pot_s)) - call ]
 *              - rho x call
 *   EV(raise) = F x pot + (1 - F) x [ R_agg x eq2 x (pot2 - rake(pot2)) - risk ]
 *
 *  - THE FIELD is every live player: the re-raiser (the last raiser), every player already in for the price, and
 *    every player still to act behind the call. A player behind continues with probability c (calls the price),
 *    re-raises with probability rho_j (then the call is treated as lost: -call), or folds. Every subset s of the
 *    players behind who continue is its own scenario: its own pot, its own count of players, its own position
 *    (the Horse is in position only when it acts after EVERY player in that field on later streets) and its own
 *    equity, all priced on the SAME samples (common random numbers, omahaReraisedEquityAgainst's onSample).
 *    The out-of-position guard this replaces read position against the re-raiser and the players already in only,
 *    so a big blind behind a small-blind 3-bettor with the opener still to act read "in position" (audit leak 1).
 *  - EQUITY is the Horse's exact cards against one holding per player, each drawn from his range (card removal),
 *    over a random run-out; ties split; side pots are not modelled. Ranges are top shares by the engine's preflop
 *    percentile: the re-raiser's from his measured re-raise rate (RANGE WIDTH below), a caller's and a player
 *    behind's as measured multiples of it (self-play).
 *  - REALIZATION R is measured in league self-play (every card there belongs to the engine's own simulated players;
 *    no production card is read): the share of its flop equity a player who saw the flop of a re-raised pot got
 *    back, by role (caller or last aggressor), position against the whole flop field, players at the flop and the
 *    stack-to-pot ratio, with the equity term. See RERAISED_POT_REALIZATION.
 *  - RAKE is the table's (omahaPreflopDefenceRake), on every scenario pot.
 *  - THE RE-RAISE (only one the earlier rules proposed, at their size): F is the chance every player folds to it,
 *    from the re-raiser's fold to a re-raise at that node (his record against the anchored prior) and the measured
 *    fold of a player who must call it cold. When it is called the re-raiser's range is the top (1 - f) of it.
 *
 * Pure: no state, no telemetry, no draw from the brain's random stream (the sampler seeds from the cards).
 */
import type { Card } from '../types.js';
import { omahaPreflopPercentile } from './HorseEval.js';
import { omahaReraisedEquityAgainstPercentileFloors } from './HorseOmahaReraisedPot.js';
import { reRaiseLineWidth } from './HorseOpponentExploit.js';

export const OMAHA_RERAISED_POT_PRICED_VARIANTS: ReadonlySet<string> = new Set(['plo4', 'plo5']);

/** Joint samples per decision (one holding per player and one run-out each). */
export const RERAISED_POT_PRICED_SAMPLES = 360;
/** At most this many players behind are priced as possible continuers (the rest are taken to fold). */
export const RERAISED_POT_MAX_PRICED_BEHIND = 3;

/**
 * REALIZATION, measured in league self-play (production brain with the live switch rows of 2026-11-24, Hybrid cash
 * profile, sandboxed memory learning on; PLO5 6-max at 100 bb, 40,000 hands, and at 300 bb, 30,000 hands; every flop
 * of a pot with two or more preflop raises, 8,108 flops, 17,211 player-flops). For each player who saw the flop,
 * y = chips won - chips put in after the flop is regressed on x = (all-in flop-start equity against the actual
 * holdings of the others who saw it) x (pot at the flop), with the board's luck taken out by a control variate (the
 * share he wins on the dealt board with no betting; variance -35%). Fitted form, per role (caller, last aggressor)
 * and side (in position = acts after every other player at the flop):
 *
 *   R = 1 - (DEPTH[role][side] - EQ_SLOPE[role][side] x (eq - EQ_CENTRE)) x spr / (spr + DEPTH_HALF)
 *         - EXTRA_PLAYER x (players - 2) x min(1, spr)
 *
 * clamped to [MIN, MAX]; at a ratio of 0 (all in) R = 1. Least squares, weights 1/pot^2; each coefficient shrunk by
 * the positive-part James-Stein factor max(0, 1 - SE^2/coef^2): caller in position depth -0.121 (SE 0.080) -> -0.068,
 * equity slope 0.43 (0.90) -> 0; caller out of position depth 0.494 (0.130) -> 0.46, slope 2.16 (1.15) -> 1.54;
 * aggressor in position depth -0.233 (0.183) -> -0.089, slope 1.77 (1.41) -> 0.66; aggressor out of position depth
 * 0.179 (0.115) -> 0.105, slope 0.70 (0.81) -> 0. EXTRA_PLAYER measured -0.168 (0.095): a negative cost (multiway
 * pots realizing more) is not credited, because it rests on the self-play field folding multiway postflop and the
 * live population is not shown to share it; held at 0. Evidence: docs/horse-option-authority.d/
 * omahaReraisedPotCallIsPriced.md; scripts server/scripts/omaha-reraised-pot-priced/.
 */
export const RERAISED_POT_REALIZATION = {
  depth: {
    caller: { ip: -0.068, oop: 0.46 },
    aggressor: { ip: -0.089, oop: 0.105 },
  },
  eqSlope: {
    caller: { ip: 0, oop: 1.543 },
    aggressor: { ip: 0.661, oop: 0 },
  },
  eqCentre: 0.45,
  depthHalf: 3,
  extraPlayer: 0,
  min: 0.25,
  max: 1.15,
} as const;

/**
 * RANGE WIDTH, measured in the same self-play (the width at which sampled equity against the top share of holdings is
 * unbiased against the actual holdings, heads-up flops of re-raised pots, server/scripts/omaha-reraised-pot-priced):
 * a 3-bettor whose re-raise rate is r holds the top 0.9 r (rate 0.088 -> unbiased width 0.08); a 4-bettor narrows by
 * the line rule (0.08 -> 0.043, measured 0.03-0.05); the player who calls a 3-bet holds about 4 times the 3-bettor's
 * width (measured 0.35 against 0.08), the player who calls a 4-bet about 1.5 times the 4-bettor's (0.06 against
 * 0.04). A player still to act who calls cold: 2 times the re-raiser's (between the two).
 */
export const RERAISED_POT_WIDTH_PER_RATE = 0.9;
export const RERAISED_POT_CALLER_WIDTH_RATIO: Readonly<Record<'threeBet' | 'fourBet', number>> = {
  threeBet: 4,
  fourBet: 1.5,
};
export const RERAISED_POT_BEHIND_WIDTH_RATIO: Readonly<Record<'threeBet' | 'fourBet', number>> = {
  threeBet: 2,
  fourBet: 1.5,
};

/** A player who keeps the Horse out of the deadband: the verdict changes a decision only by more than this share of the pot after the call. */
export const RERAISED_POT_DEADBAND_POT_SHARE = 0.01;

export type ReraisedPotRole = 'raiser' | 'in' | 'behind';

export interface ReraisedPotOpponent {
  seat: number;
  role: ReraisedPotRole;
  /** postflop acting order (larger acts later) */
  order: number;
  /** chips behind now */
  behind: number;
  /** chips still to add to match the current price (0 for the raiser and players in) */
  toMatch: number;
  /** top share of hands he holds when he is in the pot */
  width: number;
  /** behind only: chance he calls the price */
  cont?: number;
  /** behind only: chance he re-raises (the Horse's call is then taken as lost) */
  reraise?: number;
  /** chance he folds to the Horse's re-raise (raiser: his own answer; others: the cold fold) */
  foldToReraise: number;
}

export interface ReraisedPotSpot {
  variant: string;
  /** preflop raises so far (2 = facing a 3-bet) */
  preflopRaises: number;
  call: number;
  /** pot before the call, every wager on the table included */
  pot: number;
  stack: number;
  /** the Horse's postflop acting order */
  heroOrder: number;
  opponents: readonly ReraisedPotOpponent[];
  /** rake on a pot of this size with this many players at the flop */
  rake: (pot: number, players: number) => number;
}

export interface ReraisedPotScenario {
  prob: number;
  players: number;
  inPosition: boolean;
  pot: number;
  spr: number;
  equity: number;
  realization: number;
  ev: number;
}

export interface ReraisedPotVerdict {
  evCall: number;
  evRaise: number | null;
  /** equity against the field when nobody behind continues */
  equity: number;
  /** probability-weighted realization of the call */
  realization: number;
  /** share of the call's EV-weight in scenarios where the Horse is out of position */
  outOfPositionShare: number;
  /** the chance a player behind re-raises */
  reraiseBehind: number;
  deadband: number;
  scenarios: ReraisedPotScenario[];
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** Measured realization (RERAISED_POT_REALIZATION). */
export function reraisedPotRealization(
  role: 'caller' | 'aggressor',
  inPosition: boolean,
  spr: number,
  players: number,
  equity: number
): number {
  const s = Number.isFinite(spr) ? Math.max(0, spr) : 0;
  if (s <= 1e-9) return 1;
  const c = RERAISED_POT_REALIZATION;
  const side = inPosition ? 'ip' : 'oop';
  const depth = s / (s + c.depthHalf);
  const eq = Number.isFinite(equity) ? clamp(equity, 0, 1) : c.eqCentre;
  const r =
    1 -
    (c.depth[role][side] - c.eqSlope[role][side] * (eq - c.eqCentre)) * depth -
    c.extraPlayer * Math.max(0, players - 2) * Math.min(1, s);
  return clamp(r, c.min, c.max);
}

/** The percentile floor of the top `width` of holdings (reraisedPotRangeOf; at or under 1e-9: every holding). */
export function reraisedPotFloorOf(width: number): number {
  return 1 - clamp(width, 0.02, 1);
}

/** Range predicate: the top `width` of holdings by the engine's preflop percentile. */
export function reraisedPotRangeOf(width: number): (h: readonly Card[]) => boolean {
  const lo = reraisedPotFloorOf(width);
  return lo <= 1e-9 ? () => true : (h) => omahaPreflopPercentile([...h], false) >= lo;
}

/** The re-raiser's width: his anchored re-raise rate mapped to a range, narrowed by the line rule past a 3-bet. */
export function reraisedPotRaiserWidth(rate: number, preflopRaises: number): number {
  const r = Number.isFinite(rate) ? clamp(rate, 0, 1) : 0;
  let width = clamp(RERAISED_POT_WIDTH_PER_RATE * r, 0.02, 1);
  for (let depth = 3; depth <= Math.min(preflopRaises, 6); depth++)
    width = reRaiseLineWidth(width, depth);
  return width;
}

/**
 * The priced verdict, or null when it cannot be priced (outside the games, not four or five cards, fewer than two
 * raises, nothing to call, no field, too few samples). `raiseRisk` is the chips the proposed re-raise adds to what
 * the Horse has in now (null: no re-raise proposed).
 */
export function reraisedPotVerdict(
  spot: ReraisedPotSpot,
  hole: readonly Card[],
  dead: readonly Card[],
  raiseRisk: number | null
): ReraisedPotVerdict | null {
  if (!OMAHA_RERAISED_POT_PRICED_VARIANTS.has(String(spot.variant).toLowerCase())) return null;
  if (hole.length !== 4 && hole.length !== 5) return null;
  if (spot.preflopRaises < 2) return null;
  if (!(spot.call > 0.005) || !(spot.pot > 0) || !(spot.stack > 0)) return null;
  const raiser = spot.opponents.find((o) => o.role === 'raiser');
  if (!raiser) return null;
  const ins = spot.opponents.filter((o) => o.role === 'in');
  const behindAll = spot.opponents
    .filter((o) => o.role === 'behind')
    .sort((a, b) => (b.cont ?? 0) - (a.cont ?? 0));
  const behind = behindAll.slice(0, RERAISED_POT_MAX_PRICED_BEHIND);
  const field = [raiser, ...ins, ...behind];
  const call = Math.min(spot.call, spot.stack);
  const heroBehindAfter = Math.max(0, spot.stack - call);

  // One joint sample set: per sample, hero's score and each field player's score (raiser, ins, behind order).
  const nScen = 1 << behind.length;
  const won = new Array<number>(nScen).fill(0);
  let got = 0;
  const fixedCount = 1 + ins.length;
  // omahaReraisedEquityAgainst(hole, dead, field ranges (reraisedPotRangeOf), ...), the same numbers and onSample
  // scores bit for bit, on card ids (2026-11-26)
  const eq0 = omahaReraisedEquityAgainstPercentileFloors(
    hole,
    dead,
    field.map((o) => reraisedPotFloorOf(o.width)),
    RERAISED_POT_PRICED_SAMPLES,
    (mine, opp) => {
      got++;
      let fixedBest = -Infinity;
      for (let k = 0; k < fixedCount; k++) fixedBest = Math.max(fixedBest, opp[k]!);
      for (let m = 0; m < nScen; m++) {
        let best = fixedBest;
        for (let b = 0; b < behind.length; b++)
          if (m & (1 << b)) best = Math.max(best, opp[fixedCount + b]!);
        if (mine > best) won[m] += 1;
        else if (mine === best) {
          let tied = 1;
          for (let k = 0; k < fixedCount; k++) if (opp[k] === best) tied++;
          for (let b = 0; b < behind.length; b++)
            if (m & (1 << b) && opp[fixedCount + b] === best) tied++;
          won[m] += 1 / tied;
        }
      }
    }
  );
  if (eq0 === null || got === 0) return null;

  let rho = 0;
  {
    let none = 1;
    for (const b of behind) none *= 1 - clamp(b.reraise ?? 0, 0, 1);
    rho = 1 - none;
  }
  const scenarios: ReraisedPotScenario[] = [];
  let evNoRr = 0;
  let wR = 0;
  let wSum = 0;
  let oopW = 0;
  for (let m = 0; m < nScen; m++) {
    let prob = 1;
    const inField = [raiser, ...ins];
    let pot = spot.pot + call;
    for (let b = 0; b < behind.length; b++) {
      const o = behind[b]!;
      const cont = clamp(o.cont ?? 0, 0, 1);
      const rr = clamp(o.reraise ?? 0, 0, 1);
      // conditional on no re-raise behind
      const pc = rr < 1 ? cont / (1 - rr) : 0;
      if (m & (1 << b)) {
        prob *= pc;
        inField.push(o);
        pot += Math.min(o.toMatch, o.behind);
      } else prob *= 1 - pc;
    }
    if (!(prob > 0)) continue;
    const players = 1 + inField.length;
    const inPosition = inField.every((o) => spot.heroOrder > o.order);
    const maxOther = Math.max(
      ...inField.map((o) => Math.max(0, o.behind - (o.role === 'behind' ? o.toMatch : 0)))
    );
    const spr = Math.min(heroBehindAfter, maxOther) / pot;
    const equity = won[m]! / got;
    const realization = reraisedPotRealization('caller', inPosition, spr, players, equity);
    const ev = realization * equity * Math.max(0, pot - spot.rake(pot, players)) - call;
    scenarios.push({ prob, players, inPosition, pot, spr, equity, realization, ev });
    evNoRr += prob * ev;
    wR += prob * realization * equity * pot;
    wSum += prob * equity * pot;
    if (!inPosition) oopW += prob;
  }
  const evCall = (1 - rho) * evNoRr - rho * call;

  let evRaise: number | null = null;
  if (raiseRisk !== null && raiseRisk > call + 0.005) {
    const risk = Math.min(raiseRisk, spot.stack);
    const hisCall = Math.max(0, Math.min(risk - call, raiser.behind));
    const effRisk = call + hisCall;
    let allFold = clamp(raiser.foldToReraise, 0, 0.98);
    for (const o of [...ins, ...behindAll]) allFold *= clamp(o.foldToReraise, 0, 1);
    const width2 = clamp(raiser.width * (1 - clamp(raiser.foldToReraise, 0, 0.95)), 0.02, 1);
    const eq2 = omahaReraisedEquityAgainstPercentileFloors(
      hole,
      dead,
      [reraisedPotFloorOf(width2)],
      RERAISED_POT_PRICED_SAMPLES
    );
    if (eq2 !== null) {
      const pot2 = spot.pot + effRisk + hisCall;
      const spr2 = Math.max(0, Math.min(spot.stack - effRisk, raiser.behind - hisCall)) / pot2;
      const inPos2 = spot.heroOrder > raiser.order;
      const r2 = reraisedPotRealization('aggressor', inPos2, spr2, 2, eq2);
      evRaise =
        allFold * spot.pot +
        (1 - allFold) * (r2 * eq2 * Math.max(0, pot2 - spot.rake(pot2, 2)) - effRisk);
    }
  }
  return {
    evCall,
    evRaise,
    equity: (won[0] ?? 0) / got,
    realization: wSum > 0 ? wR / wSum : 1,
    outOfPositionShare: oopW,
    reraiseBehind: rho,
    deadband: RERAISED_POT_DEADBAND_POT_SHARE * (spot.pot + call),
    scenarios,
  };
}
