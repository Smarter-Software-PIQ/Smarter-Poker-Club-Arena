/**
 * omahaFacingBetIsPricedByEquity (default OFF; EMERG lane FACING, 2026-11-19).
 *
 * PLO4/PLO5 cash, high only, one board, postflop. The Horse faces a bet or a
 * raise whose last aggressor is a person, and the node's final answer is a
 * fold. The fold stands only when the call does not pay: the Horse's showdown
 * equity, recomputed here (exactly two hole cards and three board cards,
 * card-seeded Monte Carlo of OMAHA_FACING_EQUITY_SAMPLES runouts against one
 * holding for every live opponent), mapped through the street calibration
 * measured against persons' REAL cards in the 48-hour dataset (fit on Nov 18,
 * held out on Nov 19), times the street realization measured from the
 * Horses' own flop and turn calls, must beat the price
 * paid / (pot + paid) by the measured margin. Otherwise the call replaces the
 * fold. It never changes a check, a call, a bet or a raise, so a raise the
 * node already chose is kept.
 *
 * Pure in the request (hero cards, board, pot, the chips to call, the live
 * opponents, the street): no opponent memory, no brain random stream. The
 * response validator re-runs it (omahaFacingEquityAdmitsCall).
 * Constants: docs/horse-option-authority.d/omahaFacingBetIsPricedByEquity.CONSTANTS.md
 */
import type { Card, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { scoreOmahaHi } from './HorseEval.js';
import { v81StreetWager } from './HorseOmahaBigBetCalls.js';
import { omahaIsTournamentMode } from './HorseOmahaTournamentScope.js';

export const OMAHA_FACING_EQUITY_VARIANTS: ReadonlySet<string> = new Set(['plo4', 'plo5']);
/** Runouts per verdict: SE <= 0.5 / sqrt(600) = 0.020 on the raw share. */
export const OMAHA_FACING_EQUITY_SAMPLES = 600;
/** More live opponents than this: no verdict (the fold stands). */
export const OMAHA_FACING_EQUITY_FIELD_MAX = 5;

type Street = 'flop' | 'turn' | 'river';
/**
 * Calibration knots [raw, true] by street and heads-up/multiway: the raw
 * share against random holdings mapped to the measured share against the
 * persons' real cards in the same spots (Nov 18 fit; CONSTANTS.md).
 */
export const OMAHA_FACING_EQUITY_CALIBRATION: Readonly<
  Record<
    Street,
    { hu: readonly (readonly [number, number])[]; mw: readonly (readonly [number, number])[] }
  >
> = {
  flop: {
    hu: [
      [0.203, 0.191],
      [0.303, 0.252],
      [0.407, 0.312],
      [0.495, 0.4],
      [0.596, 0.489],
      [0.715, 0.59],
      [0.869, 0.783],
    ],
    mw: [
      [0.107, 0.085],
      [0.199, 0.17],
      [0.298, 0.25],
      [0.399, 0.292],
      [0.5, 0.376],
      [0.6, 0.518],
      [0.985, 0.975],
    ],
  },
  turn: {
    hu: [
      [0.214, 0.089],
      [0.302, 0.289],
      [0.401, 0.318],
      [0.5, 0.381],
      [0.602, 0.486],
      [0.714, 0.614],
      [0.86, 0.658],
    ],
    mw: [
      [0.09, 0.047],
      [0.204, 0.177],
      [0.293, 0.232],
      [0.39, 0.349],
      [0.996, 0.997],
    ],
  },
  river: {
    hu: [
      [0.059, 0.0],
      [0.261, 0.1],
      [0.409, 0.176],
      [0.492, 0.289],
      [0.595, 0.412],
      [0.735, 0.422],
      [0.877, 0.571],
    ],
    mw: [],
  },
};
/** Measured realization of the all-in share after a call (river: 1, no later street). */
export const OMAHA_FACING_EQUITY_REALIZATION: Readonly<Record<Street, number>> = {
  flop: 0.463,
  turn: 0.541,
  river: 1,
};
/** Measured margin over the price (calibration standard error, CONSTANTS.md). */
export const OMAHA_FACING_EQUITY_MARGIN: Readonly<Record<Street, number>> = {
  flop: 0.02,
  turn: 0.04,
  river: 0.08,
};

const RANKS: readonly string[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const SUITS: readonly string[] = ['clubs', 'diamonds', 'hearts', 'spades'];
const key = (c: Card): string => `${c.rank}${c.suit}`;

export interface OmahaFacingEquitySpot {
  street: Street;
  paid: number;
  price: number;
  opponents: number;
  bettorSeat: number;
}

export interface OmahaFacingEquityVerdict {
  raw: number;
  calibrated: number;
  realized: number;
  price: number;
  margin: number;
  call: boolean;
}

/** The facing-a-person's-wager spot, or null outside the rule's scope. */
export function omahaFacingEquitySpot(
  player: SeatPlayer,
  gs: HorseGameStateV2
): OmahaFacingEquitySpot | null {
  try {
    const variant = String(gs.gameVariant ?? '').toLowerCase();
    if (!OMAHA_FACING_EQUITY_VARIANTS.has(variant)) return null;
    if (omahaIsTournamentMode(gs)) return null;
    const street = gs.stage as Street;
    const boardLen = street === 'flop' ? 3 : street === 'turn' ? 4 : street === 'river' ? 5 : 0;
    if (
      boardLen === 0 ||
      gs.variantRules?.splitLow8OrBetter ||
      (gs.boardCount ?? 1) !== 1 ||
      gs.communityCards2?.length ||
      gs.communityCards3?.length ||
      gs.bombPot === true ||
      gs.wagersCapped === true
    )
      return null;
    const board = gs.communityCards ?? [];
    const hole = player.cards ?? [];
    if (board.length !== boardLen || hole.length !== Number(variant.at(-1))) return null;
    const toCall = Number.isFinite(gs.toCall)
      ? (gs.toCall as number)
      : Number.isFinite(gs.currentBet) && Number.isFinite(player.bet)
        ? Math.max(0, gs.currentBet - player.bet)
        : NaN;
    if (
      !Number.isFinite(toCall) ||
      !(toCall > 0.005) ||
      !Number.isFinite(gs.pot) ||
      !(gs.pot > 0) ||
      !Number.isFinite(player.stack) ||
      !(player.stack > 0) ||
      player.is_folded ||
      player.is_all_in ||
      player.is_sitting_out
    )
      return null;
    if (Array.isArray(gs.legalActions) && !gs.legalActions.includes('fold')) return null;
    if (
      Array.isArray(gs.legalActions) &&
      !gs.legalActions.includes('call') &&
      !gs.legalActions.includes('all_in')
    )
      return null;
    const bets = new Map(gs.players.map((p) => [p.seat, p.bet]));
    const faced = v81StreetWager(gs.actionHistory, street, bets, gs.pot);
    if (!faced || faced.bettorSeat === player.seat) return null;
    const bettor = gs.players.find((p) => p.seat === faced.bettorSeat);
    // A person's wager only: the calibration is measured against persons.
    if (!bettor || bettor.is_folded || bettor.is_horse !== false) return null;
    const opponents = gs.players.filter(
      (p) => p.seat !== player.seat && !p.is_folded && (!p.is_sitting_out || p.is_all_in)
    ).length;
    if (opponents < 1 || opponents > OMAHA_FACING_EQUITY_FIELD_MAX) return null;
    const paid = Math.min(player.stack, toCall);
    return { street, paid, price: paid / (gs.pot + paid), opponents, bettorSeat: faced.bettorSeat };
  } catch {
    return null;
  }
}

function seedOf(hole: readonly Card[], board: readonly Card[], opponents: number): number {
  let h = 0x811c9dc5;
  const mix = (t: string): void => {
    for (let i = 0; i < t.length; i++) {
      h ^= t.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  };
  for (const group of [hole, board]) {
    for (const k of group.map(key).sort()) mix(k);
    mix('|');
  }
  mix(String(opponents));
  return h >>> 0 || 1;
}

/** mulberry32: this module's own stream, never the brain's. */
function stream(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The Horse's showdown share against `opponents` random holdings of its own
 * size, run to the river: exactly two hole and three board cards. Null when
 * the cards are not a valid hand.
 */
export function omahaFacingRawEquity(
  hole: readonly Card[],
  board: readonly Card[],
  opponents: number,
  samples: number = OMAHA_FACING_EQUITY_SAMPLES
): number | null {
  const known = new Set([...hole, ...board].map(key));
  if (known.size !== hole.length + board.length) return null;
  if ([...hole, ...board].some((c) => !c || !RANKS.includes(c.rank) || !SUITS.includes(c.suit)))
    return null;
  const deck: Card[] = [];
  for (const suit of SUITS)
    for (const rank of RANKS) {
      const card = { rank, suit } as Card;
      if (!known.has(key(card))) deck.push(card);
    }
  const size = hole.length;
  const need = 5 - board.length + opponents * size;
  if (need > deck.length) return null;
  const rnd = stream(seedOf(hole, board, opponents));
  const fullBoard: Card[] = [...board];
  const heroHole = [...hole];
  const opp: Card[] = new Array(size);
  let total = 0;
  for (let s = 0; s < samples; s++) {
    // Partial Fisher-Yates: the first `need` cards are the draw.
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(rnd() * (deck.length - i));
      const t = deck[i];
      deck[i] = deck[j];
      deck[j] = t;
    }
    let d = 0;
    for (let i = board.length; i < 5; i++) fullBoard[i] = deck[d++];
    const hero = scoreOmahaHi(heroHole, fullBoard);
    let best = -1;
    let ties = 0;
    for (let o = 0; o < opponents; o++) {
      for (let k = 0; k < size; k++) opp[k] = deck[d++];
      const v = scoreOmahaHi(opp, fullBoard);
      if (v > best) {
        best = v;
        ties = v === hero ? 1 : 0;
      } else if (v === best && v === hero) ties++;
    }
    if (hero > best) total += 1;
    else if (hero === best) total += 1 / (1 + ties);
  }
  return total / samples;
}

function interpolate(knots: readonly (readonly [number, number])[], x: number): number {
  if (knots.length === 0) return x;
  if (x <= knots[0][0]) return knots[0][1];
  for (let i = 1; i < knots.length; i++) {
    const [x1, y1] = knots[i];
    const [x0, y0] = knots[i - 1];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / Math.max(1e-9, x1 - x0);
  }
  return knots[knots.length - 1][1];
}

/** The calibrated share, or null where the cell had too few measured spots (fewer than three knots). */
export function omahaFacingEquityCalibrated(
  street: Street,
  headsUp: boolean,
  raw: number
): number | null {
  const cell = OMAHA_FACING_EQUITY_CALIBRATION[street];
  const knots = headsUp ? cell.hu : cell.mw;
  if (knots.length < 3) return null;
  return Math.max(0, Math.min(1, interpolate(knots, raw)));
}

export function omahaFacingEquityVerdict(
  spot: OmahaFacingEquitySpot,
  hole: readonly Card[],
  board: readonly Card[]
): OmahaFacingEquityVerdict | null {
  const raw = omahaFacingRawEquity(hole, board, spot.opponents);
  if (raw === null) return null;
  const calibrated = omahaFacingEquityCalibrated(spot.street, spot.opponents === 1, raw);
  if (calibrated === null) return null;
  const realized = calibrated * OMAHA_FACING_EQUITY_REALIZATION[spot.street];
  const margin = OMAHA_FACING_EQUITY_MARGIN[spot.street];
  return {
    raw,
    calibrated,
    realized,
    price: spot.price,
    margin,
    call: realized - spot.price > margin,
  };
}

/**
 * The rule: a final fold in the spot becomes the call when the verdict says
 * the call pays. `legalize` turns the call into the legal call (or the
 * whole-stack all-in). Every other decision is returned unchanged.
 */
export function omahaFacingBetIsPricedByEquityRule<
  D extends { action: string; amount?: number | null },
>(
  decision: D,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  on: boolean,
  legalize: (d: D) => D,
  note?: (verdict: OmahaFacingEquityVerdict) => void
): D {
  if (!on || decision.action !== 'fold') return decision;
  try {
    const spot = omahaFacingEquitySpot(player, gs);
    if (!spot) return decision;
    const verdict = omahaFacingEquityVerdict(spot, player.cards ?? [], gs.communityCards ?? []);
    if (!verdict || !verdict.call) return decision;
    // The legalizer makes the call for the whole stack an all-in.
    const legal = legalize({ ...decision, action: 'call', amount: spot.paid } as D);
    if (legal.action !== 'call' && legal.action !== 'all_in') return decision;
    note?.(verdict);
    return { ...decision, action: legal.action, amount: legal.amount };
  } catch {
    return decision;
  }
}

/** The validator's re-run: the exact call this rule makes in this spot. */
export function omahaFacingEquityAdmitsCall(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  amount: number | null | undefined
): boolean {
  try {
    const spot = omahaFacingEquitySpot(player, gs);
    if (!spot || !Number.isFinite(amount) || Math.abs((amount as number) - spot.paid) > 0.005)
      return false;
    const verdict = omahaFacingEquityVerdict(spot, player.cards ?? [], gs.communityCards ?? []);
    return verdict !== null && verdict.call;
  } catch {
    return false;
  }
}
