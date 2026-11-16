/**
 * PLO6 STRATEGY CALIBRATION (PLO6 port of the PLO Strategy catalogue, 2026-11-15).
 *
 * The six-card values and class tests the Omaha strategy options need before
 * any of them may act in PLO6. No PLO4 or PLO5 value is changed by it.
 *
 * Readers (2026-11-16): HorseLogic.decide calls
 * applyPlo6OmahaStrategyCalibration with the decision's omahaStrategyInPlo6
 * gate (see the end of this file), and the receipt validator registers the
 * same values for the re-run of a decision whose context carries that gate,
 * then takes them back. The class tests are read by the six-card branches of
 * the Omaha strategy modules (re-raised pots, the pricing rules through
 * HorsePlo6PricingPort.ts, the strong-hand class), each reached only with the
 * gate on. With the gate off (the option is OFF-ONLY) nothing here is
 * registered and every PLO6 decision reads what it read before. The draw-out
 * helpers and the entries no rule reads yet are documented where they stand.
 *
 * Sources: SPEC-A (options 3.1 to 3.16, helpers H1-H26, measured inputs M1-M5)
 * and SPEC-B (options 3.17 to 3.31, helpers H27-H39, counts N1-N3), written for
 * this build in the PLO6 archive under phase1-play/plo-port-20261115/.
 *
 * The rule for a PLO6 value (SPEC-A section 1): it replaces the PLO4/PLO5
 * value only on closed-form six-card combinatorics ('derived') or an existing
 * PLO6 measurement ('measured'); otherwise the PLO5 value is kept and flagged
 * ('kept_plo5_unmeasured').
 *
 * Omaha plays exactly two hole cards with three board cards: six hole cards
 * are 15 hole pairs. Every strength read here goes through HorseEval's own
 * evaluators; no hand ranking is restated. Pure functions: no randomness, no
 * clock, no state.
 */
import type { Card } from '../types.js';
import { omahaBoatsAbove, omahaNutStatus, scoreOmahaHiPartial } from './HorseEval.js';
import { handClassRead, omahaEliteClassRead } from './HorseHandClasses.js';
import {
  OMAHA_STRATEGY_CONSTANT_DEFAULTS,
  type OmahaPlo6StrategyCalibration,
  type OmahaStrategyConstantKey,
  omahaStrategyConstant,
  registerOmahaPlo6StrategyCalibration,
} from './HorseOmahaStrategyGame.js';

export const PLO6_HOLE_CARDS = 6;
/** C(6,2): the two-card holdings inside one six-card hand. */
export const PLO6_HOLE_PAIRS = 15;

export type Plo6CalibrationBasis = 'derived' | 'measured' | 'kept_plo5_unmeasured';
type Scalar = number | string;
export type Plo6CalibrationValue =
  | Scalar
  | readonly Scalar[]
  | { readonly [field: string]: Plo6CalibrationValue };
export interface Plo6Calibration<V extends Plo6CalibrationValue = Plo6CalibrationValue> {
  readonly value: V;
  readonly basis: Plo6CalibrationBasis;
  readonly note: string;
}

function deepFreeze<T>(o: T): T {
  if (o !== null && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}
const entry =
  (basis: Plo6CalibrationBasis) =>
  <V extends Plo6CalibrationValue>(value: V, note: string): Plo6Calibration<V> => ({
    value,
    basis,
    note,
  });
/** Closed-form six-card arithmetic, or a quantity that does not depend on the card count. */
const d = entry('derived');
/** Fixed by an existing PLO6 measurement. */
const m = entry('measured');
/** The PLO5 value, kept and flagged: no PLO6 measurement excludes it. */
const k = entry('kept_plo5_unmeasured');

const CONSTANTS = {
  // ── SPEC-A section 4 (options 3.1 to 3.16) ──
  /** H9. PLO4/PLO5 count any full house or better as an out. See plo6TurnNutOuts. */
  omahaTurnRedrawShare: d('full_house_only_when_no_bigger_full_house', '3.1, 3.2, 3.16; H9'),
  OMAHA_OOP_TURN_MIN_NUT_OUTS: d(4, '3.1; 4/42 against 4/43: out counts do not scale'),
  OMAHA_OOP_TURN_TOKEN_PRICE: k(
    0.15,
    '3.1; same line as M2 TOKEN_CALL_PRICE; no PLO6 measurement file'
  ),
  OMAHA_OOP_TURN_SHOWDOWN_CREDIT: k(0.15, '3.1; builder allowance'),
  OMAHA_RAISE_NEEDS_NUTS_FOLD_PRICE: k(1 / 3, '3.2; builder constant'),
  /** Flush outs >= 5 with straight outs >= 8, or a strong pair with a draw. */
  omahaComboDrawForRaise: k('plo5_class_unchanged', '3.2, 3.3, 3.4; Q3 (nut outs) open'),
  'omahaComboDrawForRaise.flushOuts': d(5, 'H13; six-card flush draw has 11 - k >= 5 outs'),
  OMAHA_OOP_CHECK_STRAIGHT_DRAW_OUTS: d(8, '3.3, 3.5; also the combo straight-draw line'),
  'omahaBigDrawAggression.outClasses': d([13, 9, 8], '3.4; card-count independent'),
  /** H15. The module's own wrap line applied to the sampled opponent hand. */
  omahaBigDrawContinues: d('plo5_class_plus_13_straight_out_wraps', '3.4; cost unmeasured (Q8)'),
  OMAHA_BIG_DRAW_PRIOR_FOLD_TO_BET: k(0.42, '3.4; PLO6 measured 0.40 (0.33-0.48, M3)'),
  OMAHA_BIG_DRAW_RAISE_FOLD_SCALE: k(0.42, '3.4; PLO6 measured 0.55 (0.31-0.90, M3)'),
  OMAHA_BIG_DRAW_MARGIN: k(0.02, '3.4; builder constant'),
  OMAHA_BIG_DRAW_NUT_END_SHARE: k(0.7, '3.4; builder constant'),
  OMAHA_BIG_DRAW_SAMPLES: k(700, '3.4; builder constant'),
  OMAHA_BIG_DRAW_RUNOUTS: k(3, '3.4; builder constant'),
  FULL_HOUSE: k(7, '3.7, 3.8; class bar "less than a full house"; Q6 open'),
  OMAHA_TURN_PLAN_BEHIND_SHARE: k(0.5, '3.9; builder constant'),
  OMAHA_TURN_PLAN_FOLD_SHARE: k(0.35, '3.9; builder constant'),
  /** PLO4/PLO5: paired-board fold, v81Cell, V86. See plo6RiverM1Fold. */
  omahaRiverShoveFoldVerdict: m('paired_board_fold_then_m1_fold_test', '3.9; M1'),
  omahaStreetPlanCallVeto: m('big_bet_call_fold_plus_paired_board_fold_plus_m1', '3.10; M1'),
  /** PLO6 measured foldOfAlpha 0.99 (0.80-1.20), turnRaise 0.104 (0.066-0.161): M3. */
  OMAHA_STREET_PLAN_PRIOR: k(
    {
      foldOfAlpha: 0.8,
      turnRaise: 0.08,
      turnBet: 0.35,
      turnBluffPerValue: 0.4,
      riverBet: 0.3,
      riverLead: 0.15,
      riverBluffPerValue: 0.33,
      betOfPot: 0.75,
      shoveWhenLeftUnderPot: 0.25,
    },
    '3.10; the PLO6 intervals do not exclude the PLO5 values'
  ),
  planFallbackKeepShare: k(
    { aggressor: 0.35, called_raise: 0.35, called_bet: 0.55, other: 0.8 },
    '3.10; no PLO6 measurement'
  ),
  OMAHA_STREET_PLAN_MARGIN_POT_SHARE: k(0.02, '3.10'),
  OMAHA_STREET_PLAN_COMMIT_SHARE: k(0.5, '3.10'),
  OMAHA_STREET_PLAN_CONTINUE_SHARE: k(0.65, '3.10'),
  OMAHA_STREET_PLAN_SAMPLE: k(160, '3.10'),
  /** H19. PLO4/PLO5: flush fixed at 9 or 5.4, 3 per straight rank, summed. See plo6HoldingDrawOuts. */
  outsOf: d('distinct_unseen_completing_cards_each_once', '3.11; H19'),
  'outsOf.nonNutFlushWeight': d(0.6, '3.11; 5.4 / 9, the PLO4/PLO5 ratio'),
  OMAHA_CARD_IMPACT_DRAW_OUTS: d(5, '3.11; independent once outs are real cards'),
  OMAHA_CARD_IMPACT_NUT_OUTS: d(6, '3.11; independent once outs are real cards'),
  OMAHA_CARD_IMPACT_FREEROLL_OUTS: d(4, '3.11; independent once outs are real cards'),
  'drawOf.perOutWeight': k({ flop: 0.038, turn: 0.021 }, '3.11; closed form 0.047 / 0.024'),
  OMAHA_CARD_IMPACT_SAMPLES: k(800, '3.11'),
  OMAHA_CARD_IMPACT_MARGIN: k(0.04, '3.11'),
  OMAHA_CARD_IMPACT_BLUFF_SHARE: k(0.3, '3.11'),
  OMAHA_CARD_IMPACT_AIR_SHARE: k(0.35, '3.11'),
  OMAHA_CARD_IMPACT_SIZES: k([0.33, 0.5, 0.66, 0.75, 1], '3.11'),
  OMAHA_CARD_IMPACT_PRIOR: k(
    { betCheckedTo: 0.45, bluffShare: 0.3, raiseShare: 0.1, betSize: 0.66, referenceBet: 0.6 },
    '3.11; the PLO6 0.39 (M5) is a Horse mean, not the population'
  ),
  OMAHA_EV_VALUE_SHARE: k(
    {
      river: { under40: 0.45, mid: 0.3, big: 0.2, over: 0.12, raise: 0.1 },
      turn: { under40: 0.5, mid: 0.38, big: 0.28, over: 0.18, raise: 0.14 },
    },
    '3.12, 3.2; shares of holdings of the hand size'
  ),
  OMAHA_EV_LINE_AGGRESSOR: k(0.8, '3.12'),
  OMAHA_EV_LINE_CALLER: k(0.9, '3.12'),
  OMAHA_EV_PRIOR_BLUFF: k(
    {
      river: { under40: 0.13, mid: 0.15, big: 0.19, over: 0.19, raise: 0.08 },
      turn: { under40: 0.34, mid: 0.4, big: 0.22, over: 0.22, raise: 0.15 },
    },
    '3.12; PLO4/PLO5 measurement; M4 says PLO6 river bluffs are probably fewer (Q10)'
  ),
  OMAHA_EV_BLUFF_POOL: k(0.5, '3.12'),
  OMAHA_EV_CALLER_SHARE: k({ river: 0.35, turn: 0.45 }, '3.12'),
  OMAHA_EV_ALL_IN_SHARE: k(0.5, '3.12'),
  OMAHA_EV_BEHIND_SHARE: k(0.25, '3.12'),
  OMAHA_FACING_BET_EV_MARGIN: k(0.02, '3.12'),
  OMAHA_FACING_BET_EV_TRIVIAL_BEHIND: k(0.1, '3.12'),
  PLO6_RIVER_FOLD_BEAT_PROB: m(0.15, 'M1 (V58), paired board; 3.9, 3.10, 3.12, 3.13'),
  PLO6_RIVER_UNPAIRED_FOLD_BEAT_PROB: m(0.3, 'M1 (V59), unpaired, no flush on board'),
  PLO6_RIVER_CHEAP_PRICE: m(0.1, 'M1; a call priced at or below this is kept'),
  /** H16. A PLO6 count is about 7.4x PLO5 by operation count (not timed). */
  'omahaEvHandCounts.streets': d(['river'], '3.12, 3.2; river only until the turn is cheaper'),
  /** PLO4/PLO5: holds >= 1.5 x price with two pair or better. See plo6RiverMediumBetCalls. */
  OMAHA_RIVER_MEDIUM_BET_RANGE_FACTOR: m(
    {
      pairedBeatenBelow: 0.15,
      unpairedNoFlushBeatenBelow: 0.3,
      unpairedFlushPossibleBeatenBelow: 0.15,
      classBar: 'dropped',
    },
    '3.13; M1 lines; Q11 open'
  ),
  OMAHA_RIVER_MEDIUM_BET_MIN_POT_FRAC: k(0.4, '3.13; measured on one PLO5 player'),
  OMAHA_RIVER_MEDIUM_BET_MAX_POT_FRAC: k(0.7, '3.13; measured on one PLO5 player'),
  OMAHA_BIG_BET_POT_SHARE: d(0.7, "3.14; the tier's own line, already used by PLO6"),
  PAIRED_FOLD_RESPECTED_MAX_PRICE: k(0.25, '3.15; M1 rows under 15% do not exclude it'),
  /** Owner PLO6 ruling: arm (b) needs a straight or better, so it adds nothing to arm (a). */
  PAIRED_FOLD_RESPECTED_INVESTED_SHARE: d({ share: 0.6, armNeeds: 'straight_or_better' }, '3.15'),
  V81_MIN_POT_FRAC: m(0.9, '3.16; same line in the PLO6-measured v87Plo6BigBetCell'),
  V81_MIN_EFFECTIVE_BB: m(20, '3.16; same line in the PLO6-measured v87Plo6BigBetCell'),
  V81_MIN_CALL_PRICE: d(0.13, '3.16; V84, whose variant set includes plo6, uses it'),
  BLUFF_CATCHER_TURN: k('plo5_class_unchanged', '3.16; turn unmeasured'),
  BLUFF_CATCHER_RIVER: k('plo5_class_unchanged', '3.16; river already inside M1'),
  /** H20, H28. `plo4 ? 4 : 5` silently disables the cells for six cards. */
  'holeCheck.holeCount': d(PLO6_HOLE_CARDS, '3.9, 3.16, 3.21, 3.26; bug fix, no value'),
  // ── SPEC-B section 5 (options 3.17 to 3.31) ──
  /** H27. Exact share 11.63% (5.55% without aces), N1; unchanged it is 20.25%. See plo6ReraisedPremium. */
  omahaReraisedPremium: d('same_cards_form', '3.22-3.24, 3.26; unmeasured as strategy'),
  /** H29. Hole count minus three; all six cards one group; pass share 8.20% (N1). */
  COORDINATED_MAX_GAPS: d(3, '3.24, 3.22/3.23; unmeasured as strategy; dangler open'),
  /** PLO4/PLO5: any full house or better, or nut class. See plo6StrongHandForValue. */
  omahaStrongHandNow: k(
    'nut_class_only',
    '3.20; owner PLO6 text; M1 rows cited, no measurement file'
  ),
  OMAHA_WIDE_RERAISE_MIN_RATE: k(0.15, '3.28; PLO6 Horse mean 0.0484 x 3 = 0.145 (N2); unmeasured'),
  OMAHA_TIGHT_RERAISE_MIN_OPPS: d(12, '3.27; an observation count'),
  OMAHA_WIDE_RERAISE_MIN_OPPS: d(12, '3.28; an observation count'),
  OMAHA_VALUE_LEADER_MIN_OPPS: d(8, '3.17, 3.18; an observation count'),
  OMAHA_READCOND_MIN_HANDS: d(15, '3.17, 3.18; an observation count'),
  OOP_COMMIT_MAX_SPR: d(1, '3.22-3.24; a ratio of chips'),
  OOP_REALIZATION_MARGIN: k(0.1, '3.22-3.24; six-card equities run closer (H25)'),
  IP_REALIZATION_MARGIN: k(0.05, '3.22-3.24'),
  DOMINATED_KEY_CARD_MARGIN: k(0.03, '3.24; one ace or king is commoner in six cards'),
  OOP_PRIOR_BAND_THREE_BET: k([0.62, 1], '3.22-3.24; band over the six-card reservoir'),
  OOP_PRIOR_BAND_FOUR_BET: k([0.86, 1], '3.22-3.24; band over the six-card reservoir'),
  OOP_PRIOR_BAND_OPEN: k([0.4, 1], '3.22; band over the six-card reservoir'),
  OOP_EQUITY_SAMPLES: d(300, '3.22-3.24; sampler precision'),
  RERAISED_EQUITY_SAMPLES: d(400, '3.26; sampler precision'),
  RERAISED_RUNDOWN_MIN_RANK: d(7, '3.22-3.26; a rank'),
  RERAISED_MIN_PREFLOP_RAISES: d(3, '3.22-3.26; a count of raises'),
  hasAces: k('any_pair_of_aces', '3.26; 6.08% of six-card hands (N1), 4.17% in PLO5'),
  FLOP_PAIR_MIN_STRAIGHT_OUTS: d(8, '3.25; an out count'),
  FLOP_PAIR_MIN_NUT_STRAIGHT_OUTS: d(4, '3.25; an out count'),
  FLOP_NUT_DRAW_MIN_OUTS: d(8, '3.25; an out count'),
  FLOP_CHEAP_CALL_PRICE: k(0.1, '3.25; below the 0.15 token line (M2)'),
  UNDERPAIR_KEEP_PRICE: k(0.1, '3.21; below the 0.15 token line (M2)'),
  UNDERPAIR_NUT_STRAIGHT_OUTS: d(8, '3.21; an out count'),
  OMAHA_STRONG_HAND_RAISE_MARGIN: k(0.04, '3.20'),
  OMAHA_STRONG_HAND_RAISE_STEPS: k([0, 0.5, 1], '3.20'),
  OMAHA_MANIAC_RERAISE_MIN_OPPS: d(12, '3.29; an observation count'),
  'omahaManiacReRaiseWidthMeasured.rateFloor': d(0.02, '3.29; a rate floor'),
  VPIP_LIMP_BUFFER_HANDS: k(3, '3.30; PLO6 share of uncallable hands not measured'),
  VPIP_CALLDOWN_MAX_BB: d(6, '3.30; a price'),
  VPIP_CALLDOWN_MAX_STACK_SHARE: d(0.15, '3.30; a price'),
  /** Index 2 or 3 of a ring of six or more; PLO6 deals at most seven. */
  'omahaReraiseRangeEarlyPosition.seats': d('ring_index_2_or_3_of_6_plus', '3.23; seat facts'),
} satisfies Record<string, Plo6Calibration>;

export type Plo6StrategyConstantKey = keyof typeof CONSTANTS;
/**
 * Every card-count-dependent constant the two specs list, keyed by the name
 * the PLO code uses (a `name.part` key where the code has only a literal).
 */
export const PLO6_OMAHA_STRATEGY_CONSTANTS: Readonly<
  Record<Plo6StrategyConstantKey, Plo6Calibration>
> = deepFreeze(CONSTANTS);

// ── Cards ──
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'] as const;
const RANK_VALUE: Readonly<Record<string, number>> = Object.fromEntries(
  RANKS.map((r, i) => [r, i + 2])
);
const ACE = 14;
const key = (c: Card): string => `${c.rank}:${c.suit}`;
const rankOf = (c: Card): number => RANK_VALUE[c?.rank] ?? 0;
const validCard = (c: Card): boolean =>
  !!c && rankOf(c) > 0 && (SUITS as readonly string[]).includes(c.suit);
const allDistinct = (cards: readonly Card[]): boolean =>
  cards.every(validCard) && new Set(cards.map(key)).size === cards.length;
const isPlo6Hole = (hole: readonly Card[]): boolean =>
  Array.isArray(hole) && hole.length === PLO6_HOLE_CARDS && allDistinct(hole);
function unseenCards(seen: readonly Card[]): Card[] {
  const removed = new Set(seen.map(key));
  const out: Card[] = [];
  for (const suit of SUITS)
    for (const rank of RANKS) {
      const card: Card = { rank, suit };
      if (!removed.has(key(card))) out.push(card);
    }
  return out;
}
const countBy = (cards: readonly Card[], of: (c: Card) => string | number) => {
  const n = new Map<string | number, number>();
  for (const c of cards) n.set(of(c), (n.get(of(c)) ?? 0) + 1);
  return n;
};
/** The 15 four-card subsets of six cards, as indexes. */
const FOUR_OF_SIX: readonly (readonly number[])[] = (() => {
  const out: number[][] = [];
  for (let a = 0; a < 6; a++)
    for (let b = a + 1; b < 6; b++) {
      const rest: number[] = [];
      for (let i = 0; i < 6; i++) if (i !== a && i !== b) rest.push(i);
      out.push(rest);
    }
  return out;
})();

// ── Preflop classes ──
/** Four distinct ranks inside a five-rank window, lowest seven or higher, suited two plus two. */
function rundownTwoPlusTwo(four: readonly Card[]): boolean {
  const ranks = four.map(rankOf);
  if (new Set(ranks).size !== 4) return false;
  const low = Math.min(...ranks);
  if (Math.max(...ranks) - low > 4 || low < CONSTANTS.RERAISED_RUNDOWN_MIN_RANK.value) return false;
  const suits = [...countBy(four, (c) => c.suit).values()];
  return suits.length === 2 && suits[0] === 2;
}

/**
 * SPEC-B H27 and 3.22: the PLO6 premium class for the re-raise ranges (3.22,
 * 3.23, the declared 4-bet range of 3.24, 3.26). A pair of aces (three aces
 * count, as in omahaReraisedPremium); or two kings each with a suited partner;
 * or four cards that are THEMSELVES the rundown and two-plus-two suited. It is
 * the PLO4/PLO5 definition required of the same cards rather than of any
 * cards, and is identical to it for four cards. False for anything but six
 * distinct cards.
 */
export function plo6ReraisedPremium(hole: readonly Card[]): boolean {
  if (!isPlo6Hole(hole)) return false;
  if (hole.filter((c) => rankOf(c) === ACE).length >= 2) return true;
  const suits = countBy(hole, (c) => c.suit);
  if (hole.filter((c) => c.rank === 'K' && (suits.get(c.suit) ?? 0) >= 2).length >= 2) return true;
  return FOUR_OF_SIX.some((idx) => rundownTwoPlusTwo(idx.map((i) => hole[i])));
}

/** One-rank gaps in the group, or null when two neighbouring ranks are more than two apart. */
function groupGaps(distinct: readonly number[]): number | null {
  const xs = [...distinct].sort((a, b) => a - b);
  let gaps = 0;
  for (let i = 1; i < xs.length; i++) {
    const step = xs[i] - xs[i - 1];
    if (step > 2) return null;
    if (step === 2) gaps++;
  }
  return gaps;
}

/**
 * SPEC-B H29 and 3.24: the rank test of omahaOopCoordinated for six cards.
 * All six cards in one connected group (no card outside it), at most one
 * pair, the ace high or low. Returns the one-rank gaps in the group, or null
 * when the hand is not one group.
 */
export function plo6CoordinationGaps(hole: readonly Card[]): number | null {
  if (!isPlo6Hole(hole)) return null;
  const ranks = hole.map(rankOf);
  const high = [...new Set(ranks)];
  if (high.length < PLO6_HOLE_CARDS - 1) return null;
  const low = [...new Set(ranks.map((r) => (r === ACE ? 1 : r)))];
  const found = [groupGaps(high), groupGaps(low)].filter((g): g is number => g !== null);
  return found.length > 0 ? Math.min(...found) : null;
}

export type Plo6Coordination = 'rundown' | 'double_suited_connected' | null;
/**
 * SPEC-B H29 and 3.24: omahaOopCoordinated with the six-card row
 * COORDINATED_MAX_GAPS = 3. Same steps as the PLO4/PLO5 function: no dangler
 * class, the rank test, and one more gap for a double-suited hand.
 */
export function plo6OopCoordinated(hole: readonly Card[]): Plo6Coordination {
  const gaps = plo6CoordinationGaps(hole);
  if (gaps === null) return null;
  const cards = [...hole];
  if (handClassRead(cards, true, false).cls === 'dangler') return null;
  const allowed = CONSTANTS.COORDINATED_MAX_GAPS.value;
  if (gaps <= allowed) return 'rundown';
  const elite = omahaEliteClassRead(cards, false);
  const doubleSuited =
    elite.cls === 'rundown_ds' || elite.cls === 'broadway_conn_ds' || elite.cleanSuits >= 2;
  return doubleSuited && gaps <= allowed + 1 ? 'double_suited_connected' : null;
}

// ── Nut class ──
/** No unseen two cards beat the hand on this board (exactly two hole, three board). */
function exactNuts(hole: Card[], board: Card[], dead: readonly Card[]): boolean {
  const hero = scoreOmahaHiPartial(hole, board);
  if (hero <= 0) return false;
  const unseen = unseenCards([...hole, ...board, ...dead]);
  for (let i = 0; i < unseen.length; i++)
    for (let j = i + 1; j < unseen.length; j++)
      if (scoreOmahaHiPartial([unseen[i], unseen[j]], board) > hero) return false;
  return true;
}

/** The effective-nut classes of omahaNutClassNow, from HorseEval's own status. */
function effectiveNuts(hole: Card[], board: Card[]): boolean {
  const status = omahaNutStatus(hole, board);
  const paired = new Set(board.map((c) => c.rank)).size < board.length;
  if (status.category >= 7) return omahaBoatsAbove(hole, board).boats === 0;
  if (status.category === 6) return status.higherFlushRanks === 0 && !paired;
  if (status.category === 5) return status.straightIsNut && !status.flushPossible && !paired;
  return false;
}

/**
 * SPEC-A H8: omahaNutClassNow on cards alone, for six hole cards. The exact
 * nuts; or a full house or better no bigger full house beats; or the nut
 * flush on an unpaired board; or the nut straight on an unpaired board with
 * no possible flush. On a flop or turn less than three of a kind is never
 * nut class. An evaluator failure or a malformed hand is "no".
 */
export function plo6NutClass(
  hole: readonly Card[],
  board: readonly Card[],
  dead: readonly Card[] = []
): boolean {
  try {
    if (!isPlo6Hole(hole) || !Array.isArray(board) || board.length < 3 || board.length > 5)
      return false;
    if (!allDistinct([...hole, ...board])) return false;
    const h = [...hole];
    const b = [...board];
    if (b.length < 5 && omahaNutStatus(h, b).category < 4) return false;
    return effectiveNuts(h, b) || exactNuts(h, b, dead);
  } catch {
    return false;
  }
}

/**
 * SPEC-B 3.20: the PLO6 strong hand for river value (omahaStrongHandNow) is
 * the nut class ONLY. A full house qualifies only when no bigger full house
 * is possible; PLO4/PLO5 admit any full house.
 */
export function plo6StrongHandForValue(
  hole: readonly Card[],
  board: readonly Card[],
  dead: readonly Card[] = []
): boolean {
  return Array.isArray(board) && board.length === 5 && plo6NutClass(hole, board, dead);
}

// ── River thresholds (pure) ──
const share = (x: number): boolean => Number.isFinite(x) && x >= 0 && x <= 1;

/**
 * SPEC-A M1: the PLO6 river fold test. True when one random six-card hand
 * beats the hand at least 0.15 of the time on a paired board, or 0.30 on an
 * unpaired one, and the call costs more than 0.10 of the final pot. An
 * unreadable share or price is a fold (the safe direction).
 */
export function plo6RiverM1Fold(beatenShare: number, boardPaired: boolean, price: number): boolean {
  if (!share(beatenShare) || !share(price)) return true;
  const bar = boardPaired
    ? CONSTANTS.PLO6_RIVER_FOLD_BEAT_PROB.value
    : CONSTANTS.PLO6_RIVER_UNPAIRED_FOLD_BEAT_PROB.value;
  return beatenShare >= bar && price > CONSTANTS.PLO6_RIVER_CHEAP_PRICE.value;
}

/**
 * SPEC-A 3.12: the PLO6 guard on omahaFacingBetEv's fold -> call direction.
 * True when the fold STANDS whatever the EV says (the M1 fold test). The
 * guard does not read the flush: SPEC-A states it by pairing only.
 */
export function plo6FacingBetEvFoldStands(
  beatenShare: number,
  boardPaired: boolean,
  _flushPossible: boolean,
  price: number
): boolean {
  return plo6RiverM1Fold(beatenShare, boardPaired, price);
}

/**
 * SPEC-A 3.13: the beaten share under which a PLO6 river medium-bet fold may
 * become a call. 0.15 on a paired board; 0.30 unpaired with no flush
 * possible; 0.15 unpaired with a flush possible (the 0.30 line was measured
 * without a flush on board; Q11).
 */
export function plo6RiverMediumBetCallBar(boardPaired: boolean, flushPossible: boolean): number {
  const bars = CONSTANTS.OMAHA_RIVER_MEDIUM_BET_RANGE_FACTOR.value;
  if (boardPaired) return bars.pairedBeatenBelow;
  return flushPossible ? bars.unpairedFlushPossibleBeatenBelow : bars.unpairedNoFlushBeatenBelow;
}

/**
 * SPEC-A 3.13: true when the fold may become a call, i.e. beaten strictly
 * less than the bar. The PLO5 "two pair or better at 1.5 x price" class is
 * not ported and the price does not move the bar; the price is read only so
 * an unreadable spot stays a fold. The 40-70% pot window is the caller's.
 */
export function plo6RiverMediumBetCalls(
  beatenShare: number,
  boardPaired: boolean,
  flushPossible: boolean,
  price: number
): boolean {
  if (!share(beatenShare) || !share(price)) return false;
  return beatenShare < plo6RiverMediumBetCallBar(boardPaired, flushPossible);
}

// ── Draw outs by distinct real cards ──
/** The ten five-rank straights, the ace low or high. */
const STRAIGHTS: readonly (readonly number[])[] = Array.from({ length: 10 }, (_, low) =>
  [0, 1, 2, 3, 4].map((i) => (low + i === 0 ? ACE : low + i + 1))
);
/**
 * A straight from exactly two of the hole ranks and three of the board ranks;
 * with `through`, that board rank is one of the three. A shape test on ranks,
 * not a hand ranking.
 */
function straightWithTwo(
  holeRanks: ReadonlySet<number>,
  boardRanks: ReadonlySet<number>,
  through?: number
): boolean {
  for (const w of STRAIGHTS)
    for (let i = 0; i < 5; i++)
      for (let j = i + 1; j < 5; j++) {
        if (!holeRanks.has(w[i]) || !holeRanks.has(w[j])) continue;
        const rest = w.filter((_, x) => x !== i && x !== j);
        if (!rest.every((r) => boardRanks.has(r))) continue;
        if (through === undefined || rest.includes(through)) return true;
      }
  return false;
}

export interface Plo6DrawCards {
  /** Cards that complete a flush. */
  flush: Card[];
  /** Cards that complete a straight. */
  straight: Card[];
  /** Every completing card ONCE: a card in both lists appears here once. */
  all: Card[];
}
const NO_DRAW_CARDS = (): Plo6DrawCards => ({ flush: [], straight: [], all: [] });

/**
 * SPEC-A H19 (board form): the unseen cards that complete a flush or a
 * straight for SOME two-card holding on a flop or turn board. A flush card is
 * the third of its suit on the board; a straight card gives some two unseen
 * ranks a straight they did not have. `excluded` are cards known elsewhere
 * (the Horse's own hand): never returned and never part of a holding.
 */
export function plo6BoardDrawCompletingCards(
  board: readonly Card[],
  excluded: readonly Card[] = []
): Plo6DrawCards {
  const out = NO_DRAW_CARDS();
  if (!Array.isArray(board) || (board.length !== 3 && board.length !== 4)) return out;
  if (!allDistinct([...board, ...excluded])) return out;
  const unseen = unseenCards([...board, ...excluded]);
  const boardSuits = countBy(board, (c) => c.suit);
  const boardRanks = new Set(board.map(rankOf));
  const liveSuits = countBy(unseen, (c) => c.suit);
  const liveRanks = countBy(unseen, rankOf);
  for (const card of unseen) {
    const r = rankOf(card);
    const flush = boardSuits.get(card.suit) === 2 && (liveSuits.get(card.suit) ?? 0) >= 3;
    const after = new Set(boardRanks).add(r);
    let straight = false;
    for (const w of STRAIGHTS) {
      if (straight || !w.includes(r)) continue;
      for (let i = 0; i < 5 && !straight; i++)
        for (let j = i + 1; j < 5 && !straight; j++) {
          const pair = new Set([w[i], w[j]]);
          if (pair.has(r) || !liveRanks.get(w[i]) || !liveRanks.get(w[j])) continue;
          straight = straightWithTwo(pair, after, r) && !straightWithTwo(pair, boardRanks);
        }
    }
    if (flush) out.flush.push(card);
    if (straight) out.straight.push(card);
    if (flush || straight) out.all.push(card);
  }
  return out;
}

export interface Plo6HoldingDrawOuts extends Plo6DrawCards {
  /** Outs with a non-nut flush card at 0.6 (5.4 / 9); every other out at 1. */
  weighted: number;
}

/**
 * SPEC-A H19 and 3.11 (the `outsOf` fix): the draw outs of ONE holding (an
 * opponent's sampled six cards) on a flop or turn board, as the DISTINCT
 * unseen cards (not in the holding, on the board or in `alsoSeen`, the
 * Horse's hand) that complete its flush or a straight, each once. A flush
 * draw is two of a suit on the board with two or more held; a straight card
 * completes only when the holding has no straight yet. The nut flush draw
 * holds the top rank of the suit not on the board, as in PLO4/PLO5.
 */
export function plo6HoldingDrawOuts(
  holding: readonly Card[],
  board: readonly Card[],
  alsoSeen: readonly Card[] = []
): Plo6HoldingDrawOuts {
  const out: Plo6HoldingDrawOuts = { ...NO_DRAW_CARDS(), weighted: 0 };
  if (!Array.isArray(holding) || holding.length < 2 || !Array.isArray(board)) return out;
  if (board.length !== 3 && board.length !== 4) return out;
  if (!allDistinct([...holding, ...board, ...alsoSeen])) return out;
  const boardSuits = countBy(board, (c) => c.suit);
  const heldSuits = countBy(holding, (c) => c.suit);
  const holeRanks = new Set(holding.map(rankOf));
  const boardRanks = new Set(board.map(rankOf));
  const hasStraight = straightWithTwo(holeRanks, boardRanks);
  for (const card of unseenCards([...holding, ...board, ...alsoSeen])) {
    const r = rankOf(card);
    const flush = boardSuits.get(card.suit) === 2 && (heldSuits.get(card.suit) ?? 0) >= 2;
    const straight = !hasStraight && straightWithTwo(holeRanks, new Set(boardRanks).add(r), r);
    if (!flush && !straight) continue;
    if (flush) out.flush.push(card);
    if (straight) out.straight.push(card);
    out.all.push(card);
    if (straight) {
      out.weighted += 1;
      continue;
    }
    const taken = new Set(board.filter((c) => c.suit === card.suit).map(rankOf));
    let top = ACE;
    while (taken.has(top)) top--;
    const nut = holding.some((c) => c.suit === card.suit && rankOf(c) === top);
    out.weighted += nut ? 1 : CONSTANTS['outsOf.nonNutFlushWeight'].value;
  }
  return out;
}

// ── Nut outs ──
export interface Plo6NutOuts {
  /** The unseen river cards that make a nut-class hand. */
  outs: Card[];
  /** Unseen river cards in all. */
  unseen: number;
  /** outs / unseen; 0 when it cannot be computed. */
  share: number;
}

/**
 * SPEC-A H9: omahaTurnRedrawShare for six cards. The unseen river cards that
 * lift a turn hand to the nut flush or the nut straight on the board that
 * card makes, or to a full house or better that NO bigger full house beats
 * (omahaBoatsAbove(...).boats === 0, the test omahaNutClassNow uses). The
 * PLO4/PLO5 function counts every full house. Each card is counted once.
 */
export function plo6TurnNutOuts(
  hole: readonly Card[],
  board: readonly Card[],
  dead: readonly Card[] = []
): Plo6NutOuts {
  const none: Plo6NutOuts = { outs: [], unseen: 0, share: 0 };
  try {
    if (!isPlo6Hole(hole) || !Array.isArray(board) || board.length !== 4) return none;
    if (!allDistinct([...hole, ...board])) return none;
    const h = [...hole];
    const unseen = unseenCards([...hole, ...board, ...dead]);
    const outs = unseen.filter((card) => effectiveNuts(h, [...board, card]));
    return {
      outs,
      unseen: unseen.length,
      share: unseen.length > 0 ? outs.length / unseen.length : 0,
    };
  } catch {
    return none;
  }
}

// ── Verdicts ──
export type Plo6OptionVerdict = 'take' | 'adapt' | 'skip';
export interface Plo6OptionRuling {
  readonly verdict: Plo6OptionVerdict;
  readonly reason: string;
}
const verdict =
  (v: Plo6OptionVerdict) =>
  (reason: string): Plo6OptionRuling => ({ verdict: v, reason });
const take = verdict('take');
const adapt = verdict('adapt');
const skip = verdict('skip');

const VERDICTS = {
  omahaOopTurnCheckAfterFlopCall: take('3.1; with nut outs that exclude dominated boats (H9)'),
  omahaTurnRiverRaiseNeedsNuts: take('3.2; the nut class is six-card correct (H8)'),
  omahaNoDrawRaiseOutOfPosition: take('3.3; position and distinct-card outs: no change'),
  omahaBigDrawAggression: adapt('3.4; continue model needs the 13+ out wrap; second wave'),
  omahaBareOverpairOopFlopCheck: take('3.5; classes and draw reads six-card correct'),
  omahaOverpairNoOopBarrelVsValueLeader: take('3.6; no six-card change'),
  omahaPairedRiverNoThinLeadVsValueLeader: take('3.7; full-house bar kept, unmeasured'),
  omahaPairedTurnNoBarrelWithoutBoatVsValueLeader: take('3.8; bar kept, unmeasured'),
  omahaTurnBetNeedsRiverPlan: adapt('3.9; look-ahead uses the M1 fold test, not v81Cell'),
  omahaStreetPlan: adapt('3.10; call veto adds the paired-board fold and the M1 fold test'),
  omahaCardImpact: adapt('3.11; outsOf must count distinct real cards (H19)'),
  omahaFacingBetEv: adapt('3.12; river only (count cost), M1 guard on fold -> call'),
  omahaRiverMediumBetStrongHandCalls: adapt('3.13; M1 beaten bars, PLO5 class not ported'),
  omahaBigBetIsPotShare: take("3.14; the tier's own 0.7 line, already used by PLO6"),
  omahaPairedBoardFoldRespectsPrice: adapt('3.15; arm (b) needs a straight or better'),
  omahaBluffCatcherFoldVsValueLeader: adapt('3.16; hole check reads the hole count (H20)'),
  omahaMadeHandDefenseVsValueLeader: take('3.17; no value change; scope repair first (H35)'),
  omahaPressureNeedsPostflopAggression: take('3.18; rates against the PLO6 envelope'),
  omahaRiverNutBlockerBluffReachable: skip('3.19; no PLO6 equity window; adds bluff chips'),
  omahaStrongHandValue: adapt('3.20; strong hand = nut class only; cash only'),
  omahaUnderpairNoMultiwayFlopContinue: adapt('3.21; hole-check fix (H28); last'),
  omahaReraiseRangeOutOfPosition: adapt('3.22; PLO6 premium definition (H27)'),
  omahaReraiseRangeEarlyPosition: adapt('3.23; PLO6 premium definition (H27)'),
  omahaOopReraisedPotStrongRange: adapt('3.24; PLO6 coordination row, premium, maniac aside'),
  omahaReraisedPotFlopContinueNeedsEquityShape: take('3.25; out counts do not scale (H36)'),
  omahaNoCallColdFourBetWithoutPremium: adapt('3.26; PLO6 premium, hole-check fix (H28)'),
  omahaReraisedFoldVsTight: skip('3.27; OFF-ONLY in PLO6: tight-response hold'),
  omahaEliteContinuesVsMeasuredWideThreeBettor: skip('3.28; refusal-to-range-play answers it'),
  omahaManiacReRaiseWidthMeasured: take('3.29; no six-card change; after the row-5 ruling'),
  omahaVpipFloorByLimp: take('3.30; hand counts, prices, public actions: no change'),
  omahaSmallBlindSteal: skip('3.31; OFF-ONLY: owner hold on the blind-steal family'),
} satisfies Record<string, Plo6OptionRuling>;

export type Plo6CatalogueOption = keyof typeof VERDICTS;
/**
 * SPEC-A section 4 and SPEC-B section 6: take, adapt or skip for each of the
 * 31 catalogue options, with the reason. A record, not a switch: nothing
 * here turns an option on.
 */
export const plo6StrategyOptionVerdict: Readonly<Record<Plo6CatalogueOption, Plo6OptionRuling>> =
  deepFreeze(VERDICTS);

// ── The Omaha strategy accessor (HorseOmahaStrategyGame.ts) ──
export interface Plo6AccessorValue {
  /** The entry of PLO6_OMAHA_STRATEGY_CONSTANTS the value is taken from; null: the specs list none. */
  readonly source: Plo6StrategyConstantKey | null;
  /** The PLO6 number for the accessor key; null when there is no entry or the entry is not one number. */
  readonly value: number | null;
}
const numberOf = (source: Plo6StrategyConstantKey): Plo6AccessorValue => {
  const v: Plo6CalibrationValue = CONSTANTS[source].value;
  return { source, value: typeof v === 'number' ? v : null };
};
/** A 0-or-1 accessor switch: 1 when the entry names the six-card form. */
const switchOf = (source: Plo6StrategyConstantKey, sixCardForm: string): Plo6AccessorValue => ({
  source,
  value: CONSTANTS[source].value === sixCardForm ? 1 : 0,
});
/**
 * Each of the accessor's 17 keys (omahaStrategyConstant) with the PLO6 value
 * this file holds for it and the entry it comes from. Nothing is restated:
 * every number is read from CONSTANTS above.
 *  - riverMediumBetRangeFactor: the PLO6 rule is not a factor (the entry is
 *    the M1 beaten bars of plo6RiverMediumBetCalls), so there is no number.
 *  - eliteContinueMaxPotOdds, tournamentPushFoldMaxBB: the specs list no
 *    six-card value.
 *  - pairedFoldRespectedInvestedShare: the share; the entry's `armNeeds`
 *    (a straight or better) is an adaptation the accessor cannot carry.
 */
export const PLO6_OMAHA_STRATEGY_ACCESSOR_VALUES: Readonly<
  Record<OmahaStrategyConstantKey, Plo6AccessorValue>
> = deepFreeze({
  facingBetEvMargin: numberOf('OMAHA_FACING_BET_EV_MARGIN'),
  riverMediumBetRangeFactor: numberOf('OMAHA_RIVER_MEDIUM_BET_RANGE_FACTOR'),
  pairedFoldRespectedMaxPrice: numberOf('PAIRED_FOLD_RESPECTED_MAX_PRICE'),
  pairedFoldRespectedInvestedShare: {
    source: 'PAIRED_FOLD_RESPECTED_INVESTED_SHARE',
    value: CONSTANTS.PAIRED_FOLD_RESPECTED_INVESTED_SHARE.value.share,
  },
  oopTurnMinNutOuts: numberOf('OMAHA_OOP_TURN_MIN_NUT_OUTS'),
  oopTurnShowdownCredit: numberOf('OMAHA_OOP_TURN_SHOWDOWN_CREDIT'),
  oopTurnTokenPrice: numberOf('OMAHA_OOP_TURN_TOKEN_PRICE'),
  cardImpactMargin: numberOf('OMAHA_CARD_IMPACT_MARGIN'),
  streetPlanMarginPotShare: numberOf('OMAHA_STREET_PLAN_MARGIN_POT_SHARE'),
  bigDrawMargin: numberOf('OMAHA_BIG_DRAW_MARGIN'),
  raiseNeedsNutsFoldPrice: numberOf('OMAHA_RAISE_NEEDS_NUTS_FOLD_PRICE'),
  eliteContinueMaxPotOdds: { source: null, value: null },
  bigBetPotShare: numberOf('OMAHA_BIG_BET_POT_SHARE'),
  tournamentPushFoldMaxBB: { source: null, value: null },
  /** H9. */
  turnRedrawNutFullHouseOnly: switchOf(
    'omahaTurnRedrawShare',
    'full_house_only_when_no_bigger_full_house'
  ),
  /** H19. */
  cardImpactDistinctDrawOuts: switchOf('outsOf', 'distinct_unseen_completing_cards_each_once'),
  /** H15: the wrap line is the first of the module's own out classes (13). */
  bigDrawContinueStraightOuts: {
    source: 'omahaBigDrawContinues',
    value:
      CONSTANTS.omahaBigDrawContinues.value === 'plo5_class_plus_13_straight_out_wraps'
        ? (CONSTANTS['omahaBigDrawAggression.outClasses'].value[0] ?? 0)
        : 0,
  },
});

/**
 * What is registered: the keys whose PLO6 value is a number that differs
 * from the accessor default. A key left out reads the PLO4/PLO5 default.
 */
export function plo6OmahaStrategyAccessorCalibration(): OmahaPlo6StrategyCalibration {
  const out: OmahaPlo6StrategyCalibration = {};
  for (const key of Object.keys(OMAHA_STRATEGY_CONSTANT_DEFAULTS) as OmahaStrategyConstantKey[]) {
    const v = PLO6_OMAHA_STRATEGY_ACCESSOR_VALUES[key].value;
    if (v !== null && v !== OMAHA_STRATEGY_CONSTANT_DEFAULTS[key]) out[key] = v;
  }
  return out;
}

const ACCESSOR_CALIBRATION = Object.freeze(plo6OmahaStrategyAccessorCalibration());
const NO_CALIBRATION: OmahaPlo6StrategyCalibration = Object.freeze({});

/** Hands the accessor the PLO6 values: from here a PLO6 read of a registered key returns it. */
export function registerPlo6OmahaStrategyCalibration(): void {
  registerOmahaPlo6StrategyCalibration(ACCESSOR_CALIBRATION);
}

/** Takes them back: every PLO6 read returns the PLO4/PLO5 default again. */
export function clearPlo6OmahaStrategyCalibration(): void {
  registerOmahaPlo6StrategyCalibration(NO_CALIBRATION);
}

/**
 * The decision's caller of the two functions above: HorseLogic.decide,
 * before anything else of the decision, with the decision's own gate
 * (opts.omahaStrategyInPlo6 === true). The receipt validator calls the two
 * functions itself, around the re-run of a decision.
 *
 * Both callers first read what the accessor holds
 * (plo6OmahaStrategyCalibrationHeld), set it to their own gate, and put back
 * what they found in a finally. So the values are in the accessor ONLY while
 * a decision (or a validation) whose gate is on runs; with the option unset
 * or false the accessor holds no PLO6 value at any read of that decision,
 * nothing of a decision is left after it, and a decide entered inside another
 * decide hands the outer one its own state back. PLO6 plays exactly as it did
 * before this hookup, whatever reads the accessor.
 * It does not rest on each reader's own game gate. (One reader does run for
 * PLO6 with the gate off: HorseLogic's bluff-catcher argument computes
 * omahaTurnRedrawShareOf before omahaBluffCatcherCell refuses the game.)
 * No state is kept here: each call sets the accessor to what its gate says.
 */
export function applyPlo6OmahaStrategyCalibration(gateOn: boolean): void {
  if (gateOn === true) registerPlo6OmahaStrategyCalibration();
  else clearPlo6OmahaStrategyCalibration();
}

/**
 * Whether the Omaha strategy accessor holds the PLO6 calibration right now.
 * Read off the accessor itself, so no state is kept beside it:
 * turnRedrawNutFullHouseOnly is 0 for every game by default and 1 for PLO6
 * only while the calibration is registered. The one read both callers
 * (HorseLogic.decide and the receipt validator) save before they set the
 * accessor and restore after. Only this module's calibration is ever
 * registered in production code; a caller that registered another one would
 * get this one back.
 */
export function plo6OmahaStrategyCalibrationHeld(): boolean {
  return omahaStrategyConstant('turnRedrawNutFullHouseOnly', { gameVariant: 'plo6' }) !== 0;
}
