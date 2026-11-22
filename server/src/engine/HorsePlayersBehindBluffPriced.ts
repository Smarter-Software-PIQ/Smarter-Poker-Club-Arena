/**
 * PRICED PLAYERS-BEHIND BLUFF MULTIPLIER (2026-11-22, HORSE DECISIONS lane; option `v17PosIsPriced`,
 * read `=== true`, default OFF, OPTION_SWITCH_REFUSED, zero SQL migrations).
 *
 * Replaces, in single-board no-limit Texas Hold'em on the flop and turn only, the fixed V17 table
 *   `bluffScale *= playersBehind17 === 0 ? 1.1 : === 1 ? 1.0 : === 2 ? 0.72 : 0.5`
 * with the measured probability that the whole respondable field folds.
 *
 * 1. Each live, not-all-in opponent is BEHIND (acts after the Horse this street) or IN FRONT.
 *    Its fold probability is the measured NLH fold-to-first-bet rate of #11724 for this street and size
 *    band, with the bettor IN POSITION for an opponent in front and OUT OF POSITION for one behind,
 *    times the measured flop texture multiplier on the flop:
 *      F_i = min(0.95, prior(street, relation, band, texture) * rho_i),
 *      rho_i = shrunk_i / pooled,
 *    `pooled` = the position-blind (n-weighted) rate of the same table and band, and `shrunk_i` = the
 *    opponent's in-session fold-to-bet count shrunk toward `pooled` with 6 pseudo-observations. A
 *    stranger is the pool (rho = 1); a player's tendency scales both seat relations alike.
 * 2. F_act = prod_i F_i(actual relation). F_ref = the same field with the first player behind kept
 *    behind and every other player behind priced as in front (the order the last-to-act `posMod`
 *    binary already prices). With 0 or 1 player behind, F_ref = F_act.
 * 3. Reference size s = min(0.67 pot, effective stack) / pot (0.67 = BREAK_EVEN_REFERENCE_SIZE, the
 *    size bluffScale is defined at). Risk-adjusted break-even fold share FE_be = bf s / (1 + bf s),
 *    bf = max(1, hero bubble factor) in tournaments, 1 in cash.
 * 4. m = max(F_act / F_ref, min(1, F_act / FE_be)).
 *    0 or 1 behind: m = 1. Every extra player behind costs that player's measured oop / ip fold ratio,
 *    unless the field still folds often enough to beat the price (F_act >= FE_be): then no trim.
 *
 * Pure and deterministic: zero `fastRandom()` draws, public seats and in-session counters only, no
 * opponent hole cards, no `opponentHud/` import, no ExploitCounters wire change. Returns null when the
 * spot cannot be priced; the caller then keeps the legacy table.
 */
import {
  HOLDEM_EMPIRICAL_FLOP_FOLD_TO_CBET,
  HOLDEM_EMPIRICAL_FLOP_TEXTURE_MULT,
  HOLDEM_EMPIRICAL_TURN_FOLD_TO_BET,
  HOLDEM_PRIOR_STRENGTH,
  empiricalBayesShrink,
  holdemBetSizeBand,
  type EmpiricalRateCell,
  type HoldemBetSizeBand,
  type HoldemFlopTexture,
} from './holdemEmpiricalPriors.js';

/** The pot fraction bluffScale is defined at (HorseMind BREAK_EVEN_REFERENCE_SIZE). */
export const PLAYERS_BEHIND_REFERENCE_SIZE = 0.67;
/** Highest fold probability ever priced for one opponent (a range always keeps some calls). */
export const PLAYERS_BEHIND_FOLD_CAP = 0.95;
/** Dealer-relative wrap used by HorseLogic's playersBehind17 seat order. */
const SEAT_WRAP = 1024;
const EPS = 1e-12;

export type PlayersBehindStreet = 'flop' | 'turn';

export interface PlayersBehindCardLike {
  readonly rank: string;
  readonly suit: string;
}

export interface PlayersBehindOpponentInput {
  readonly seat: number;
  readonly stack: number;
  /** In-session fold-to-bet count and opportunities (HorseMind.foldToBetCountersOf), or null. */
  readonly foldToBet?: { readonly hit: number; readonly opp: number } | null;
}

export interface PricePlayersBehindInput {
  readonly street: PlayersBehindStreet;
  readonly heroSeat: number;
  readonly dealerSeat: number;
  readonly heroStack: number;
  /** Contestable pot before the Horse's wager. */
  readonly pot: number;
  /** Live, not folded, not all-in, not sitting-out opponents (the playersBehind17 field). */
  readonly opponents: readonly PlayersBehindOpponentInput[];
  /** The flop (first three cards); read on the flop only. */
  readonly board?: readonly PlayersBehindCardLike[];
  /** Hero tournament bubble factor; null / undefined / <= 1 is chip EV (1). */
  readonly heroBubbleFactor?: number | null;
}

export interface PlayersBehindPrice {
  readonly multiplier: number;
  readonly playersBehind: number;
  readonly fieldFold: number;
  readonly referenceFold: number;
  readonly breakEvenFold: number;
  readonly sizeFrac: number;
  readonly band: HoldemBetSizeBand;
  readonly bubbleFactor: number;
}

function finiteNonNeg(x: number): number {
  return Number.isFinite(x) && x > 0 ? x : 0;
}

/** Dealer-relative position, identical to HorseLogic's pos17. */
export function playersBehindSeatPosition(seat: number, dealerSeat: number): number {
  const dd = seat - dealerSeat;
  return dd <= 0 ? dd + SEAT_WRAP : dd;
}

/** Public flop texture from the first three board cards (paired beats mono, as in #11724's split). */
export function playersBehindFlopTexture(
  board: readonly PlayersBehindCardLike[] | undefined
): HoldemFlopTexture | undefined {
  if (!board || board.length < 3) return undefined;
  const flop = board.slice(0, 3);
  const ranks = new Set(flop.map((c) => String(c.rank)));
  if (ranks.size < 3) return 'paired';
  const suits = new Set(flop.map((c) => String(c.suit)));
  if (suits.size === 1) return 'mono';
  return 'unpaired_nonmono';
}

function streetTable(
  street: PlayersBehindStreet
): Readonly<Record<'ip' | 'oop', Readonly<Record<HoldemBetSizeBand, EmpiricalRateCell>>>> {
  return street === 'flop' ? HOLDEM_EMPIRICAL_FLOP_FOLD_TO_CBET : HOLDEM_EMPIRICAL_TURN_FOLD_TO_BET;
}

/** Measured fold rate for a first bet by a bettor in / out of position (texture on the flop). */
export function playersBehindRelationPrior(
  street: PlayersBehindStreet,
  bettorInPosition: boolean,
  band: HoldemBetSizeBand,
  texture?: HoldemFlopTexture
): number {
  const cell = streetTable(street)[bettorInPosition ? 'ip' : 'oop'][band];
  const tex = street === 'flop' && texture ? HOLDEM_EMPIRICAL_FLOP_TEXTURE_MULT[texture].mult : 1;
  return Math.min(PLAYERS_BEHIND_FOLD_CAP, Math.max(0, cell.rate * tex));
}

/** Position-blind pooled rate of the same table and band (n-weighted), texture applied on the flop. */
export function playersBehindPooledPrior(
  street: PlayersBehindStreet,
  band: HoldemBetSizeBand,
  texture?: HoldemFlopTexture
): number {
  const t = streetTable(street);
  const ip = t.ip[band];
  const oop = t.oop[band];
  const tex = street === 'flop' && texture ? HOLDEM_EMPIRICAL_FLOP_TEXTURE_MULT[texture].mult : 1;
  const rate = (ip.hits + oop.hits) / (ip.n + oop.n);
  return Math.min(PLAYERS_BEHIND_FOLD_CAP, Math.max(0, rate * tex));
}

/** The opponent's read relative to the pool (1 for a stranger). */
export function playersBehindPlayerRead(
  pooled: number,
  foldToBet: { readonly hit: number; readonly opp: number } | null | undefined
): number {
  if (!(pooled > EPS)) return 1;
  if (!foldToBet || !(Number(foldToBet.opp) > 0)) return 1;
  const est = empiricalBayesShrink(
    Number(foldToBet.hit),
    Number(foldToBet.opp),
    pooled,
    HOLDEM_PRIOR_STRENGTH.exploitCountersFallback,
    'exploit_counters'
  );
  return est.mean / pooled;
}

/**
 * Price the players-behind bluff multiplier. Null when the spot cannot be priced (the caller keeps
 * the legacy table and records `v17_pos_priced_unpriced`).
 */
export function pricePlayersBehindBluff(input: PricePlayersBehindInput): PlayersBehindPrice | null {
  if (input.street !== 'flop' && input.street !== 'turn') return null;
  if (!Number.isFinite(input.heroSeat) || !Number.isFinite(input.dealerSeat)) return null;
  const pot = finiteNonNeg(input.pot);
  const heroStack = finiteNonNeg(input.heroStack);
  if (!(pot > EPS) || !(heroStack > EPS)) return null;
  const field = input.opponents.filter((o) => Number.isFinite(o.seat) && o.seat !== input.heroSeat);
  if (field.length === 0) return null;

  let deepest = 0;
  for (const o of field) deepest = Math.max(deepest, finiteNonNeg(o.stack));
  if (!(deepest > EPS)) return null;
  const effStack = Math.min(heroStack, deepest);
  const sizeFrac = Math.min(PLAYERS_BEHIND_REFERENCE_SIZE * pot, effStack) / pot;
  if (!(sizeFrac > EPS) || !Number.isFinite(sizeFrac)) return null;
  const band = holdemBetSizeBand(sizeFrac);
  const texture = input.street === 'flop' ? playersBehindFlopTexture(input.board) : undefined;
  const pooled = playersBehindPooledPrior(input.street, band, texture);
  const priorFront = playersBehindRelationPrior(input.street, true, band, texture);
  const priorBehind = playersBehindRelationPrior(input.street, false, band, texture);

  const heroPos = playersBehindSeatPosition(input.heroSeat, input.dealerSeat);
  const rows = field.map((o) => {
    const pos = playersBehindSeatPosition(o.seat, input.dealerSeat);
    const rho = playersBehindPlayerRead(pooled, o.foldToBet ?? null);
    return {
      pos,
      behind: pos > heroPos,
      front: Math.min(PLAYERS_BEHIND_FOLD_CAP, priorFront * rho),
      back: Math.min(PLAYERS_BEHIND_FOLD_CAP, priorBehind * rho),
    };
  });
  const behind = rows.filter((r) => r.behind);
  let firstBehindPos = Infinity;
  for (const r of behind) firstBehindPos = Math.min(firstBehindPos, r.pos);

  let fieldFold = 1;
  let referenceFold = 1;
  for (const r of rows) {
    fieldFold *= r.behind ? r.back : r.front;
    referenceFold *= r.behind && r.pos === firstBehindPos ? r.back : r.front;
  }
  if (!Number.isFinite(fieldFold) || !Number.isFinite(referenceFold)) return null;

  const rawBf = input.heroBubbleFactor;
  const bubbleFactor =
    Number.isFinite(rawBf as number) && (rawBf as number) > 1 ? (rawBf as number) : 1;
  const breakEvenFold = (bubbleFactor * sizeFrac) / (1 + bubbleFactor * sizeFrac);

  let multiplier: number;
  if (behind.length <= 1) multiplier = 1;
  else if (!(referenceFold > EPS)) multiplier = 1;
  else {
    const ratio = fieldFold / referenceFold;
    const priceCover = breakEvenFold > EPS ? Math.min(1, fieldFold / breakEvenFold) : 1;
    multiplier = Math.max(ratio, priceCover);
  }
  if (!Number.isFinite(multiplier)) return null;
  multiplier = Math.max(0, Math.min(1, multiplier));

  return {
    multiplier,
    playersBehind: behind.length,
    fieldFold,
    referenceFold,
    breakEvenFold,
    sizeFrac,
    band,
    bubbleFactor,
  };
}
