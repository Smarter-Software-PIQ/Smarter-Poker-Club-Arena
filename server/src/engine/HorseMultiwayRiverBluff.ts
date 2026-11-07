/**
 * ═══ MULTIWAY RIVER BLUFFS (Dan 2026-11-06) ═══
 *
 * Dan, 2026-11-06 20:52 Chicago: "MAKE SURE THAT YOU FULLY UPGRADE ENHANCE,
 * OPTIMIZE AND IMPROVE THE RIVER BLUFFING RANGE AND ACTIVATION FOR BOTH
 * HOLDEM AND PLO. ITS IMPORTANT TO ALSO CHECK THAT THERE IS NOTHING THAT IS
 * EVER BLOCKING OR PRENENTING, OR 'SHUTTING OFF' RIVER BLUFFS FOR QUALIFIED
 * CANDITATES OR SITUATIONS."
 *
 * HorseRiverBluffRange (#9803) owns the heads-up river. A river with two or
 * three opponents still in fell to the old layers, which almost never bluff
 * there. Measured on production (24 hours to 2026-11-07, horse river spots
 * with nothing to call, hands whose hole cards were recorded): Hold'em air
 * bet 2.9% of the time three-handed against 12.7% heads-up, PLO4 air was
 * 5.5% of three-handed river bets and 0 of 24 four-handed, PLO6 0 of 97.
 * No receipt for a multiway river bluff exists at all.
 *
 * Multiway the arithmetic is much harsher, and this module is built on it.
 * A bet of s pots needs every opponent to fold: if each folds with
 * probability f, the bluff wins f^N, and it must beat s/(1+s) (one half at a
 * pot-sized bet). Two uncapped opponents folding 60% each fold together
 * only 36% of the time; three, 22%. So a multiway bluff is only right when
 * the opponents' folds are CORRELATED - every one of them capped by the
 * line (the turn checked through, or they all just called) and the bet
 * representing a hand hero credibly holds because hero blocks it. Hence:
 *
 *  - Only 2 or 3 opponents (3- and 4-way). Five-way and wider: never.
 *  - A real nut blocker is REQUIRED (riverNutBlocker: the nut-flush card in
 *    Hold'em, the omahaFlushBlocker nut class in Omaha, or a rank of the
 *    best straight). No blocker, no multiway bluff - the field calls with
 *    every flush and straight that hero does not remove.
 *  - A story is REQUIRED: the turn checked through (a capped field), hero's
 *    delayed bet after a flop bet, hero's turn barrel that everyone flatted,
 *    the turn bettor checking the river with hero last to act, or a scare
 *    card hero blocks. Any opponent raise on the turn or the river uncaps
 *    that player: no story.
 *  - No showdown value: Hold'em, no hole card pairs the board and no pocket
 *    pair; Omaha, at most one pair; and equity against the field under half
 *    of a fair share (0.5 / (N + 1): 0.167 three-way, 0.125 four-way).
 *  - Frequency falls steeply with each opponent: the heads-up balanced share
 *    for the size times MULTIWAY_RIVER_BLUFF_DECAY (0.45 with two opponents,
 *    0.18 with three), times line and selection, times the PRODUCT of every
 *    opponent's read. One credible station keeps 5% (near zero). Caps: 0.2
 *    per combo three-way, 0.09 four-way.
 *  - Size is polarized and legal: no limit 0.75-1.0 pot, a 1.0-1.25x
 *    overbet when the river is a scare card hero blocks, the shove when
 *    shallow and not a survival risk; pot limit 0.75-1.0 pot, never above.
 *  - Tournaments scale it down with icmRisk (never below 0.15); a locked
 *    satellite seat never bluffs (the caller skips the module).
 *
 * Fixed limit, short deck, multi-board, bomb pots and hi-lo with a low
 * possible stay with their own layers, exactly as heads-up.
 */
import type { ActionRecord, Card } from '../types.js';
import { RANK_VALUES } from './PokerEngine.js';
import {
  riverBluffBalancedProbability,
  riverMissedDraw,
  RIVER_BLUFF_PRIOR_AIR_SHARE,
  RIVER_BLUFF_PRIOR_VALUE_SHARE,
} from './HorseRiverBluffRange.js';

/** Frequency multiplier on the heads-up balanced share, by opponents live. */
export const MULTIWAY_RIVER_BLUFF_DECAY: Readonly<Record<number, number>> = Object.freeze({
  2: 0.45,
  3: 0.18,
});
/** The most often one combo bluffs, by opponents live. */
export const MULTIWAY_RIVER_BLUFF_CAP: Readonly<Record<number, number>> = Object.freeze({
  2: 0.2,
  3: 0.09,
});
/** Air bar: equity against the field under this share of a fair share. */
export const MULTIWAY_RIVER_BLUFF_AIR_FAIR_SHARE = 0.5;
/** A credible station anywhere in the field keeps this much of the bluffs. */
export const MULTIWAY_RIVER_BLUFF_STATION_FACTOR = 0.05;
/** The product of the field's reads is bounded to this. */
export const MULTIWAY_RIVER_BLUFF_READ_MAX = 1.3;

/** How well the line caps the whole field. */
export const MULTIWAY_RIVER_BLUFF_LINE = {
  checkedThrough: 1.0,
  initiative: 1.0,
  barrel: 0.6,
  opponentGaveUp: 0.5,
  scare: 0.7,
} as const;

/** Blockers only; a missed draw adds a little (it is in every betting range). */
export const MULTIWAY_RIVER_BLUFF_WEIGHTS = {
  blocker: 1.0,
  blockerAndDraw: 1.15,
} as const;

/** Hero first to act with the whole field behind it: a little less. */
export const MULTIWAY_RIVER_BLUFF_OOP_FACTOR = 0.85;

export type MultiwayRiverBluffLine = keyof typeof MULTIWAY_RIVER_BLUFF_LINE | 'none';
export type MultiwayRiverBluffSelection = keyof typeof MULTIWAY_RIVER_BLUFF_WEIGHTS | 'none';

export interface MultiwayRiverBluffSpot {
  omaha: boolean;
  potLimit: boolean;
  hiLo: boolean;
  lowPossible: boolean;
  fixedLimit: boolean;
  shortDeck: boolean;
  multiBoard: boolean;
  bombPot: boolean;
  holeCount: number;
  hole: Card[];
  board: Card[];
  history: readonly ActionRecord[];
  heroId: string;
  /** every live (not folded) opponent */
  opponentIds: string[];
  /** every live opponent can still put chips in (none all in, all have a stack) */
  allCanRespond: boolean;
  /** hero's equity against the whole field */
  equity: number;
  /** hero's made-hand category (1 high card, 2 one pair, ...; 0 unknown) */
  madeCategory: number;
  /** hero acts last on the river */
  inPosition: boolean;
  /** the last aggressor of the earlier streets */
  initiative: 'hero' | 'opp' | 'none';
  /** the river completed a flush, a straight or paired the board */
  scareCard: boolean;
  /** hero holds the nut blocker (riverNutBlocker) */
  nutBlocker: boolean;
}

export interface MultiwayRiverBluffEligibility {
  eligible: boolean;
  reason:
    | 'eligible'
    | 'domain'
    | 'heads_up'
    | 'too_many'
    | 'cannot_respond'
    | 'showdown_value'
    | 'no_blocker'
    | 'no_story';
  opponents: number;
  line: MultiwayRiverBluffLine;
  selection: MultiwayRiverBluffSelection;
}

const rank = (c: Card): number => RANK_VALUES[c.rank] ?? 0;

const aggressive = (a: ActionRecord): boolean =>
  a.action === 'bet' || a.action === 'raise' || (a.action === 'all_in' && a.isFullRaise === true);

/** Hold'em: a hole card pairs the board, or a pocket pair. */
export function holdemHoleHasPair(hole: readonly Card[], board: readonly Card[]): boolean {
  const boardRanks = new Set(board.map(rank));
  if (hole.some((c) => boardRanks.has(rank(c)))) return true;
  return hole.length === 2 && rank(hole[0]) === rank(hole[1]);
}

/** The multiway air bar for this many opponents. */
export function multiwayRiverAirBar(opponents: number): number {
  return MULTIWAY_RIVER_BLUFF_AIR_FAIR_SHARE / (Math.max(1, opponents) + 1);
}

/** Which story hero's line tells the whole field on this river, or 'none'. */
export function multiwayRiverBluffLine(spot: MultiwayRiverBluffSpot): MultiwayRiverBluffLine {
  const h = spot.history;
  const opp = new Set(spot.opponentIds);
  // A live opponent's raise on the turn or the river uncaps that player.
  const oppRaisedLate = h.some(
    (a) =>
      (a.stage === 'turn' || a.stage === 'river') &&
      opp.has(a.userId) &&
      (a.action === 'raise' || (a.action === 'all_in' && a.isFullRaise === true))
  );
  if (oppRaisedLate) return 'none';
  const turn = h.filter((a) => a.stage === 'turn');
  const turnAggressor = turn.filter(aggressive).map((a) => a.userId);
  const heroTurnBet = turnAggressor.includes(spot.heroId);
  if (spot.initiative === 'hero') {
    // Hero bet the turn and every live opponent called it.
    if (
      heroTurnBet &&
      spot.opponentIds.every((id) =>
        turn.some((a) => a.userId === id && (a.action === 'call' || a.action === 'all_in'))
      )
    )
      return 'barrel';
    // Hero bet the flop, the turn checked through: a delayed bet.
    if (
      turn.length > 0 &&
      turnAggressor.length === 0 &&
      h.some((a) => a.stage === 'flop' && a.userId === spot.heroId && aggressive(a))
    )
      return 'initiative';
  }
  // Everyone checked the turn: the whole field is capped.
  if (turn.length > 0 && turnAggressor.length === 0) return 'checkedThrough';
  // The turn bettor (one opponent) checked the river, every live opponent
  // checked it, and hero acts last: the field gave up.
  if (spot.initiative === 'opp' && spot.inPosition && turnAggressor.length === 1) {
    const river = h.filter((a) => a.stage === 'river');
    if (spot.opponentIds.every((id) => river.some((a) => a.userId === id && a.action === 'check')))
      return 'opponentGaveUp';
  }
  // A river scare card hero blocks: hero represents what it removes.
  if (spot.scareCard && spot.nutBlocker && !turnAggressor.some((id) => opp.has(id))) return 'scare';
  return 'none';
}

/** Is this a qualified multiway river-bluff candidate, and which kind. */
export function multiwayRiverBluffEligibility(
  spot: MultiwayRiverBluffSpot
): MultiwayRiverBluffEligibility {
  const n = spot.opponentIds.length;
  const out = (
    reason: MultiwayRiverBluffEligibility['reason'],
    line: MultiwayRiverBluffLine = 'none',
    selection: MultiwayRiverBluffSelection = 'none'
  ): MultiwayRiverBluffEligibility => ({
    eligible: reason === 'eligible',
    reason,
    opponents: n,
    line,
    selection,
  });
  const holeOk = spot.omaha ? [4, 5, 6].includes(spot.holeCount) : spot.holeCount === 2;
  if (
    spot.board.length !== 5 ||
    !holeOk ||
    spot.hole.length !== spot.holeCount ||
    spot.fixedLimit ||
    spot.shortDeck ||
    spot.multiBoard ||
    spot.bombPot ||
    (spot.hiLo && spot.lowPossible)
  )
    return out('domain');
  if (n < 2) return out('heads_up');
  if (n > 3) return out('too_many');
  if (!spot.allCanRespond) return out('cannot_respond');
  const pairOk = spot.omaha
    ? spot.madeCategory <= 2
    : !holdemHoleHasPair(spot.hole, spot.board) && spot.madeCategory <= 2;
  if (!pairOk || !(spot.equity < multiwayRiverAirBar(n))) return out('showdown_value');
  if (!spot.nutBlocker) return out('no_blocker');
  const line = multiwayRiverBluffLine(spot);
  if (line === 'none') return out('no_story');
  const selection: MultiwayRiverBluffSelection = riverMissedDraw(spot.hole, spot.board, spot.omaha)
    ? 'blockerAndDraw'
    : 'blocker';
  return out('eligible', line, selection);
}

/** One opponent's read. */
export interface MultiwayOpponentRead {
  /** credible station, or a measured fold-to-river-bet under 35% */
  station: boolean;
  /** HorseMind.riverFoldRate, or null without a sample */
  riverFoldRate: number | null;
}

/** The product of every opponent's read. 1 with no reads; any station, 0.05. */
export function multiwayRiverBluffReadFactor(reads: readonly MultiwayOpponentRead[]): number {
  if (reads.some((r) => r.station)) return MULTIWAY_RIVER_BLUFF_STATION_FACTOR;
  let f = 1;
  for (const r of reads) {
    if (r.riverFoldRate !== null && Number.isFinite(r.riverFoldRate)) {
      f *= 1 + Math.max(-0.6, Math.min(0.5, (r.riverFoldRate - 0.45) * 1.5));
    }
  }
  return Math.max(MULTIWAY_RIVER_BLUFF_STATION_FACTOR, Math.min(MULTIWAY_RIVER_BLUFF_READ_MAX, f));
}

export interface MultiwayRiverBluffFrequencyInput {
  eligibility: MultiwayRiverBluffEligibility;
  sizeFrac: number;
  inPosition: boolean;
  reads: readonly MultiwayOpponentRead[];
  /** HorseMind.exploit(...).bluffMod (1 = neutral) */
  bluffMod: number;
  /** tournament survival premium (icmRisk); 0 in cash */
  icmRisk: number;
}

/** The probability this combo bluffs. Zero outside the owned spot. */
export function multiwayRiverBluffProbability(input: MultiwayRiverBluffFrequencyInput): number {
  const e = input.eligibility;
  if (!e.eligible || e.line === 'none' || e.selection === 'none') return 0;
  const decay = MULTIWAY_RIVER_BLUFF_DECAY[e.opponents] ?? 0;
  const cap = MULTIWAY_RIVER_BLUFF_CAP[e.opponents] ?? 0;
  if (!(decay > 0) || !(cap > 0)) return 0;
  // The public bands cannot be paired multiway, so the prior composition.
  const balanced = riverBluffBalancedProbability(
    input.sizeFrac,
    RIVER_BLUFF_PRIOR_VALUE_SHARE,
    RIVER_BLUFF_PRIOR_AIR_SHARE
  );
  let p =
    balanced *
    decay *
    MULTIWAY_RIVER_BLUFF_WEIGHTS[e.selection] *
    MULTIWAY_RIVER_BLUFF_LINE[e.line] *
    (input.inPosition ? 1 : MULTIWAY_RIVER_BLUFF_OOP_FACTOR) *
    multiwayRiverBluffReadFactor(input.reads);
  if (Number.isFinite(input.bluffMod) && input.bluffMod > 0)
    p *= Math.max(0.5, Math.min(1.2, input.bluffMod));
  if (input.icmRisk > 0) p *= Math.max(0.15, 1 - 4 * input.icmRisk);
  return Math.max(0, Math.min(cap, p));
}

/**
 * The bluff size as a fraction of the pot. Pot limit: 0.75-1.0 pot. No
 * limit: 0.75-1.0 pot, a 1.0-1.25x overbet on a scare card hero blocks, the
 * shove when the deepest caller's effective stack is at most 1.25 pots and
 * the shove is not a survival risk. `u` is one uniform draw in [0, 1).
 */
export function multiwayRiverBluffSize(input: {
  potLimit: boolean;
  pot: number;
  /** min(hero's stack, the deepest live opponent's stack) */
  effectiveStack: number;
  scareBlocked: boolean;
  icmRisk: number;
  u: number;
}): { sizeFrac: number; shove: boolean } {
  const { pot, effectiveStack: eff } = input;
  if (!(pot > 0) || !(eff > 0)) return { sizeFrac: 0, shove: false };
  const cap = eff / pot;
  if (input.potLimit) {
    const s = Math.min(1, 0.75 + input.u * 0.25);
    return s >= cap ? { sizeFrac: cap, shove: true } : { sizeFrac: s, shove: false };
  }
  if (cap <= 1.25 && input.icmRisk < 0.03) return { sizeFrac: cap, shove: true };
  const s = input.scareBlocked ? 1 + input.u * 0.25 : 0.75 + input.u * 0.25;
  return s >= cap ? { sizeFrac: cap, shove: true } : { sizeFrac: s, shove: false };
}
