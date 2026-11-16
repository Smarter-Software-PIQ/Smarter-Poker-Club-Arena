/**
 * OMAHA RE-RAISED POT: A COORDINATED CALLING RANGE, STRONGER OUT OF POSITION
 * (2026-11-15, PLO Strategy lane; options omahaOopReraisedPotStrongRange and
 * omahaReraisedPotFlopContinueNeedsEquityShape, default OFF, read `=== true`).
 *
 * Owner, 2026-11-15 11:49, 11:51 and 11:55 Chicago: Horses need a much
 * stronger range when they call 3-bets and 4-bets out of position and must
 * not call just because the opponent is aggressive. The calling range is
 * rundowns, hands that make straights and double-suited hands, played to
 * crack a big hand with cards the opponent does not have. It is not ace-king,
 * ace-queen, ace-jack, king-queen or king-jack hands unless all four or five
 * cards are coordinated, and it is not high cards with low cards (A-K-9-8-5
 * and A-Q-10-5-4 are trash; K-Q-J-9-8 and A-Q-J-10-8 are fine). Calling a
 * 4-bet pays only when the hand can make the nuts or flops a pair with a nut
 * draw; after the flop the caller continues only with those. No blanket rule.
 *
 * PREFLOP RULE (omahaOopReraisedPotStrongRange). PLO4/PLO5 cash, high only,
 * one board, no bomb pot. The Horse's decision is a CALL, the last raiser is
 * not all in, and either
 *   - it faces a 3-bet or more and acts BEFORE the last raiser on every later
 *     street (out of position), or
 *   - it faces a 4-bet or more, in either position.
 * The call stands only when one of these holds:
 *   - ACES WITH A SUIT (the engine's class `aa_ds`): never examined, played
 *     as today.
 *   - COMMITMENT, equity above the raw price and: facing a 3-bet, the
 *     stack-to-pot ratio after the call under OOP_COMMIT_MAX_SPR (1); facing
 *     a 4-bet or more, the call itself all in. (A pot-sized 4-bet leaves
 *     that ratio under 1 at any ordinary depth, so the ratio alone would
 *     excuse every 4-bet call from the coordination test.)
 *   - STRONG RANGE: the hand is COORDINATED (below; bare aces, class
 *     `aa_dry`, are excused this test only) AND its equity is at least the
 *     raw price plus the engine's realization charge (V53):
 *     OOP_REALIZATION_MARGIN (0.10) out of position, IP_REALIZATION_MARGIN
 *     (0.05) in position; plus DOMINATED_KEY_CARD_MARGIN (0.03) facing a
 *     4-bet or more when the hand holds exactly one ace or exactly one king
 *     (the 4-bettor's key cards: the hand is dominated, not unblocked).
 *     Facing a 4-bet or more with the ratio after the call under 1 the
 *     margins are waived (the stack goes in on most flops) but the hand must
 *     still be coordinated.
 * Otherwise the call becomes a fold. A raise is never touched, so a hand the
 * existing 4-bet or 5-bet logic raises still raises. A call of a 3-bet in
 * position is unchanged.
 *
 * EQUITY is against the last raiser's range alone: hands whose preflop
 * percentile lies in the band the mind reads for him (HorseMind.bandFor: his
 * measured width when his read is engaged, the line-implied prior otherwise,
 * 0.62-1 for a 3-bet). A 4-bet or more whose band no read has widened below
 * 0.86 is priced against the engine's declared 4-bet range instead
 * (omahaReraisedPremium: a pair of aces, kings double-suited, double-suited
 * rundowns), which is aces- and kings-heavy, so a hand that shares his key
 * cards scores low and a live, unblocked hand scores higher. Aggression widens that band, which raises the equity, but
 * the realization margin is charged in full whoever the raiser is, and no
 * width makes an uncoordinated hand a call. Sampled with the deterministic
 * generator of HorseOmahaReraisedPot (seeded by the hand): no draw from the
 * brain's random stream. No estimate leaves the decision as it is. A hand
 * that is neither coordinated nor committed folds without one.
 *
 * COORDINATED (omahaOopCoordinated): the hand is not the V46 class
 * `dangler`, holds at most one pair, and ALL its cards form ONE connected
 * group: sorted by rank (the ace high or low), no two neighbouring ranks are
 * more than two apart, so no card stands outside the group (no dangler is
 * tolerated, in PLO4 or PLO5) and a high-cards-plus-low-cards hand is split
 * and fails. One-rank gaps inside the group are limited: one in PLO4, two in
 * PLO5 (class `rundown`); a double-suited hand (the elite class `rundown_ds`
 * or `broadway_conn_ds`, or two clean two-card suits) may have one more
 * (class `double_suited_connected`).
 *
 * FLOP RULE (omahaReraisedPotFlopContinueNeedsEquityShape). Same games. On
 * the flop of a pot raised twice or more preflop, the Horse did not make the
 * last preflop raise (it called), faces a wager, and would call or raise.
 * It continues only with
 *   - two pair or better of its own (the board's pair plus one pair is one
 *     pair), or
 *   - one pair WITH a nut-leaning draw: the nut flush draw, or
 *     FLOP_PAIR_MIN_STRAIGHT_OUTS (8) straight outs of which at least
 *     FLOP_PAIR_MIN_NUT_STRAIGHT_OUTS (4) make the nut straight, or
 *   - a strong draw without a pair: FLOP_NUT_DRAW_MIN_OUTS (8) outs to a
 *     nut-class hand (omahaNutClassOuts), or a flush draw together with 8
 *     straight outs (a combo draw),
 * or when the call costs under FLOP_CHEAP_CALL_PRICE (0.10) of the resulting
 * pot. Otherwise the continue becomes a fold. Its own bets when checked to
 * are untouched.
 *
 * RE-RAISE RULE (two options, switched separately: omahaReraiseRangeOutOfPosition
 * restricts the out-of-position spots, omahaReraiseRangeEarlyPosition the
 * early-position spots; owner 2026-11-15 12:18: the
 * Horses' 3-bet and 4-bet ranges out of position and under the gun must be
 * capped). Same games, preflop. The Horse's decision is a RAISE that would
 * be the 3-bet or the 4-bet (one or two raises before it), and the spot is
 * RESTRICTED:
 *   - out of position after the flop against the player it re-raises, or
 *     against a player already in the pot for that raise (a caller who acts
 *     again) who acts after the Horse on later streets; or
 *   - early position: a table of six or more dealt in, the Horse in one of
 *     the first two seats left of the big blind (under the gun, under the
 *     gun plus one), with a live player still to act on the raise.
 * Blind against blind (only the two blinds live) is never restricted; in
 * position from the middle seats, the cutoff and the button nothing changes.
 * In a restricted spot the re-raise stands only with
 *   - aces with a suit (class `aa_ds`), or
 *   - any pair of aces when the re-raise commits: the stack-to-pot ratio once
 *     the re-raise is called is at or under OOP_COMMIT_MAX_SPR (1), or
 *   - the engine's declared premium structures without a pair of aces
 *     (omahaReraisedPremium: kings double-suited; a double-suited rundown,
 *     four ranks inside a span of four, the lowest seven or higher).
 * Every other hand, bare aces (class `aa_dry`) short of that commitment
 * included, does not re-raise:
 * it CALLS. A call that then faces a 3-bet (the Horse would have 4-bet) is
 * judged by the preflop calling rule above and folds when that rule folds
 * it (bare aces are excused coordination there and priced). A call of a
 * single raise (the Horse would have 3-bet) stands when the hand is
 * coordinated or holds a pair of aces, or when its equity against the
 * opener's range clears the price plus the realization margin (0.10 out of
 * position, 0.05 in position); otherwise it folds, so a 3-bet made as
 * pressure with a weak hand does not become a weak call. No hand is banned
 * by name: the test is the class.
 *
 * Pure: no state, no telemetry, no draw from the brain's random stream.
 */
import type { Card, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import {
  omahaDrawQuality,
  omahaMadeClass,
  omahaNutStatus,
  omahaPreflopPercentile,
  variantInfo,
} from './HorseEval.js';
import { omahaNutClassOuts } from './HorseOmahaOnePair.js';
import { handClassRead, omahaEliteClassRead } from './HorseHandClasses.js';
import { omahaCashOnlyExcludes } from './HorseOmahaTournamentScope.js';
import {
  RERAISED_POT_VARIANTS,
  omahaReraisedEquity,
  omahaReraisedPremium,
  preflopRaiseCount,
} from './HorseOmahaReraisedPot.js';
import { omahaStrategyGameInScope } from './HorseOmahaStrategyGame.js';

/** Stack-to-pot ratio after the call under which the call is a commitment. */
export const OOP_COMMIT_MAX_SPR = 1;
/** The engine's out-of-position realization charge (V53), added to the price in full. */
export const OOP_REALIZATION_MARGIN = 0.1;
/** The engine's in-position realization charge (V53), for a call of a 4-bet or more in position. */
export const IP_REALIZATION_MARGIN = 0.05;
/** Added facing a 4-bet or more when the hand holds exactly one ace or exactly one king. */
export const DOMINATED_KEY_CARD_MARGIN = 0.03;
/** One-rank gaps allowed inside the connected group, by hole count; a double-suited hand may have one more. */
export const COORDINATED_MAX_GAPS: Readonly<Record<number, number>> = { 4: 1, 5: 2 };
/** Flop rule: straight outs, and nut-straight outs among them, that make one pair a continue. */
export const FLOP_PAIR_MIN_STRAIGHT_OUTS = 8;
export const FLOP_PAIR_MIN_NUT_STRAIGHT_OUTS = 4;
/** Flop rule: outs to a nut-class hand that make a draw without a pair a continue. */
export const FLOP_NUT_DRAW_MIN_OUTS = 8;
/** Flop rule: a call priced under this share of the resulting pot is left alone. */
export const FLOP_CHEAP_CALL_PRICE = 0.1;
/** Opponent holdings sampled for the equity estimate. */
export const OOP_EQUITY_SAMPLES = 300;
/** The line-implied prior band when the mind gives none (HorseMind.bandFor's own values). */
export const OOP_PRIOR_BAND_THREE_BET: readonly [number, number] = [0.62, 1];
export const OOP_PRIOR_BAND_FOUR_BET: readonly [number, number] = [0.86, 1];

const RANK_VALUE: Record<string, number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

export type OmahaOopCoordination = 'rundown' | 'double_suited_connected' | null;

/** One-rank gaps in the group, or null when two neighbouring ranks are more than two apart. */
function groupGaps(distinct: number[]): number | null {
  const xs = [...distinct].sort((a, b) => a - b);
  let gaps = 0;
  for (let k = 1; k < xs.length; k++) {
    const d = xs[k] - xs[k - 1];
    if (d > 2) return null;
    if (d === 2) gaps++;
  }
  return gaps;
}

/** Which coordination class the hand is, or null (see the module comment). */
export function omahaOopCoordinated(hole: readonly Card[]): OmahaOopCoordination {
  const n = hole.length;
  if (n !== 4 && n !== 5) return null;
  const cards = [...hole];
  if (handClassRead(cards, true, false).cls === 'dangler') return null;
  const ranks = cards.map((c) => RANK_VALUE[c.rank] ?? 0);
  const high = [...new Set(ranks)];
  if (high.length < n - 1) return null;
  const low = [...new Set(ranks.map((r) => (r === 14 ? 1 : r)))];
  const candidates = [groupGaps(high), groupGaps(low)].filter((g): g is number => g !== null);
  if (candidates.length === 0) return null;
  const gaps = Math.min(...candidates);
  const allowed = COORDINATED_MAX_GAPS[n] ?? 0;
  if (gaps <= allowed) return 'rundown';
  const elite = omahaEliteClassRead(cards, false);
  const doubleSuited =
    elite.cls === 'rundown_ds' || elite.cls === 'broadway_conn_ds' || elite.cleanSuits >= 2;
  return doubleSuited && gaps <= allowed + 1 ? 'double_suited_connected' : null;
}

export interface OmahaOopReraisedInput {
  variant: string;
  hole: readonly Card[];
  dead: readonly Card[];
  /** hero acts before the last raiser on every later street */
  outOfPosition: boolean;
  /** preflop raises so far (open = 1) */
  preflopRaises: number;
  toCall: number;
  /** hero's stack before the call */
  stack: number;
  /** the pot before the call */
  pot: number;
  /** the last raiser's percentile band from the mind, or null (the line-implied prior is used) */
  band: readonly [number, number] | null;
  hiLo: boolean;
  multiBoard: boolean;
  bombPot: boolean;
  tournament: boolean;
  allInOrFold: boolean;
}

export interface OmahaOopReraisedVerdict {
  fold: boolean;
  reason: 'aces_suited' | 'commitment' | 'strong_range' | 'uncoordinated' | 'short_of_price';
  coordination: OmahaOopCoordination;
  equity: number | null;
  price: number;
  required: number;
  sprAfter: number;
  /** exactly one ace or exactly one king facing a 4-bet or more */
  dominatedKeyCard: boolean;
}

/**
 * The verdict on a preflop call of a 3-bet or more out of position, or of a
 * 4-bet or more in either position; null outside the rule's scope or without
 * an equity estimate. The caller has already established that the decision
 * is a call and that the last raiser is not all in.
 */
export function omahaOopReraisedCallCell(i: OmahaOopReraisedInput): OmahaOopReraisedVerdict | null {
  if (!omahaStrategyGameInScope(RERAISED_POT_VARIANTS, { gameVariant: i.variant })) return null;
  if (i.hiLo || i.multiBoard || i.bombPot || i.tournament || i.allInOrFold) return null;
  if (i.hole.length !== 4 && i.hole.length !== 5) return null;
  if (i.preflopRaises < 2) return null;
  if (!i.outOfPosition && i.preflopRaises < 3) return null;
  if (!(i.toCall > 0.005) || !(i.pot > 0) || !(i.stack > 0)) return null;
  const call = Math.min(i.toCall, i.stack);
  const price = call / (i.pot + call);
  const sprAfter = (i.stack - call) / (i.pot + call);
  const elite = omahaEliteClassRead([...i.hole], false);
  const coordination = omahaOopCoordinated(i.hole);
  const count = (rank: string) => i.hole.filter((c) => c.rank === rank).length;
  const dominatedKeyCard = i.preflopRaises >= 3 && (count('A') === 1 || count('K') === 1);
  const base = { coordination, price, sprAfter, dominatedKeyCard };
  if (elite.cls === 'aa_ds')
    return { ...base, fold: false, reason: 'aces_suited', equity: null, required: price };
  const fourBet = i.preflopRaises >= 3;
  const allIn = i.stack <= call + 0.005;
  // COMMITMENT. Facing a 3-bet: the stack-to-pot ratio after the call is
  // under 1. Facing a 4-bet or more a pot-sized raise leaves that ratio under
  // 1 at any ordinary depth, so there only a call that is itself all in (no
  // street left to play) is a commitment; short of that the hand must be
  // coordinated, and under a ratio of 1 the realization margin is waived.
  const commitment = fourBet ? allIn : sprAfter < OOP_COMMIT_MAX_SPR;
  const required = commitment
    ? price
    : price +
      (sprAfter < OOP_COMMIT_MAX_SPR
        ? 0
        : (i.outOfPosition ? OOP_REALIZATION_MARGIN : IP_REALIZATION_MARGIN) +
          (dominatedKeyCard ? DOMINATED_KEY_CARD_MARGIN : 0));
  // No equity is needed to fold a hand that is neither coordinated nor committed.
  if (!commitment && coordination === null && elite.cls !== 'aa_dry')
    return { ...base, fold: true, reason: 'uncoordinated', equity: null, required };
  const prior = fourBet ? OOP_PRIOR_BAND_FOUR_BET : OOP_PRIOR_BAND_THREE_BET;
  const [lo, hi] = i.band ?? prior;
  // A 4-bet or more that no read has widened is the engine's declared 4-bet
  // range (omahaReraisedPremium: aces, kings double-suited, double-suited
  // rundowns), not a percentile band: the band ranks ace-king hands high and
  // would call them live against the very aces that dominate them.
  const declaredFourBet = fourBet && lo >= OOP_PRIOR_BAND_FOUR_BET[0] - 1e-9;
  const equity = omahaReraisedEquity(
    i.hole,
    [],
    i.dead,
    declaredFourBet
      ? (h) => omahaReraisedPremium(h)
      : (h) => {
          const p = omahaPreflopPercentile([...h], false);
          return p >= lo && p <= hi;
        },
    OOP_EQUITY_SAMPLES
  );
  if (equity === null) return null;
  if (commitment)
    return equity > price
      ? { ...base, fold: false, reason: 'commitment', equity, required }
      : { ...base, fold: true, reason: 'short_of_price', equity, required };
  return equity >= required
    ? { ...base, fold: false, reason: 'strong_range', equity, required }
    : { ...base, fold: true, reason: 'short_of_price', equity, required };
}

export type OmahaFlopContinueReason =
  | 'two_pair_or_better'
  | 'pair_with_nut_draw'
  | 'strong_draw'
  | 'cheap_call'
  | 'no_equity_shape';

export interface OmahaFlopContinueInput {
  variant: string;
  hole: readonly Card[];
  board: readonly Card[];
  dead: readonly Card[];
  /** preflop raises (open = 1) */
  preflopRaises: number;
  /** hero made the last preflop raise */
  heroLastPreflopRaiser: boolean;
  toCall: number;
  stack: number;
  pot: number;
  hiLo: boolean;
  multiBoard: boolean;
  bombPot: boolean;
  tournament: boolean;
}

/**
 * The flop rule's verdict on a continue (call or raise) facing a wager in a
 * re-raised pot hero called preflop; null outside the rule's scope.
 */
export function omahaReraisedFlopContinueCell(
  i: OmahaFlopContinueInput
): { fold: boolean; reason: OmahaFlopContinueReason } | null {
  if (!omahaStrategyGameInScope(RERAISED_POT_VARIANTS, { gameVariant: i.variant })) return null;
  if (i.hiLo || i.multiBoard || i.bombPot || i.tournament) return null;
  if (i.hole.length !== 4 && i.hole.length !== 5) return null;
  if (i.board.length !== 3) return null;
  if (i.preflopRaises < 2 || i.heroLastPreflopRaiser) return null;
  if (!(i.toCall > 0.005) || !(i.pot > 0) || !(i.stack > 0)) return null;
  const pay = Math.min(i.toCall, i.stack);
  if (pay / (i.pot + pay) < FLOP_CHEAP_CALL_PRICE) return { fold: false, reason: 'cheap_call' };
  const hole = [...i.hole];
  const board = [...i.board];
  const category = omahaNutStatus(hole, board).category;
  const boardPairOnly = category === 3 && omahaMadeClass(hole, board, category).cls === 'board2p';
  if (category >= 3 && !boardPairOnly) return { fold: false, reason: 'two_pair_or_better' };
  const draw = omahaDrawQuality(hole, board, false);
  const pair = category === 2 || boardPairOnly;
  if (
    pair &&
    (draw.nutFlushDraw ||
      (draw.straightOuts >= FLOP_PAIR_MIN_STRAIGHT_OUTS &&
        draw.nutStraightOuts >= FLOP_PAIR_MIN_NUT_STRAIGHT_OUTS))
  )
    return { fold: false, reason: 'pair_with_nut_draw' };
  const flushDraw = draw.nutFlushDraw || draw.dominatedFlushDraw;
  if (
    omahaNutClassOuts(hole, board, [...i.dead]) >= FLOP_NUT_DRAW_MIN_OUTS ||
    (flushDraw && draw.straightOuts >= FLOP_PAIR_MIN_STRAIGHT_OUTS)
  )
    return { fold: false, reason: 'strong_draw' };
  return { fold: true, reason: 'no_equity_shape' };
}

export interface OmahaReraiseByPositionInput {
  variant: string;
  hole: readonly Card[];
  /** preflop raises before the Horse's raise: 1 = it would 3-bet, 2 = it would 4-bet */
  preflopRaises: number;
  /** out of position against the player re-raised, or against a caller in the pot who acts again */
  outOfPosition: boolean;
  /** under the gun or under the gun plus one at a table of six or more, a live player still to act */
  earlyPosition: boolean;
  /** only the two blinds are live */
  blindVersusBlind: boolean;
  /** the stack-to-pot ratio once this re-raise is called is at or under 1 (the caller knows the raise size) */
  reraiseCommits?: boolean;
  hiLo: boolean;
  multiBoard: boolean;
  bombPot: boolean;
  tournament: boolean;
  allInOrFold: boolean;
}

export type OmahaReraiseByPositionVerdict =
  | { reraise: true; reason: 'aces_suited' | 'aces_commitment' | 'premium_structure' }
  | { reraise: false; reason: 'bare_aces' | 'not_premium' };

/**
 * The re-raise rule's verdict on a 3-bet or 4-bet in a restricted spot; null
 * outside the rule's scope (the raise is today's).
 */
export function omahaReraiseByPositionCell(
  i: OmahaReraiseByPositionInput
): OmahaReraiseByPositionVerdict | null {
  if (!omahaStrategyGameInScope(RERAISED_POT_VARIANTS, { gameVariant: i.variant })) return null;
  if (i.hiLo || i.multiBoard || i.bombPot || i.tournament || i.allInOrFold) return null;
  if (i.hole.length !== 4 && i.hole.length !== 5) return null;
  if (i.preflopRaises !== 1 && i.preflopRaises !== 2) return null;
  if (i.blindVersusBlind) return null;
  if (!i.outOfPosition && !i.earlyPosition) return null;
  const cls = omahaEliteClassRead([...i.hole], false).cls;
  if (cls === 'aa_ds') return { reraise: true, reason: 'aces_suited' };
  const aces = i.hole.filter((c) => c.rank === 'A').length >= 2;
  if (aces)
    return i.reraiseCommits === true
      ? { reraise: true, reason: 'aces_commitment' }
      : { reraise: false, reason: 'bare_aces' };
  return omahaReraisedPremium(i.hole)
    ? { reraise: true, reason: 'premium_structure' }
    : { reraise: false, reason: 'not_premium' };
}

/** The line-implied prior band for an opener (HorseMind.bandFor's own value). */
export const OOP_PRIOR_BAND_OPEN: readonly [number, number] = [0.4, 1];

/**
 * A 3-bet the re-raise rule turned into a call of a single raise: does the
 * call stand? Coordinated hands and aces call; any other hand needs equity
 * against the opener's band of the raw price plus the realization margin.
 * No estimate keeps the call.
 */
export function omahaDowngradedThreeBetCalls(i: {
  hole: readonly Card[];
  dead: readonly Card[];
  outOfPosition: boolean;
  toCall: number;
  stack: number;
  pot: number;
  band: readonly [number, number] | null;
}): boolean {
  if (i.hole.filter((c) => c.rank === 'A').length >= 2) return true;
  if (omahaOopCoordinated(i.hole) !== null) return true;
  if (!(i.toCall > 0.005) || !(i.pot > 0) || !(i.stack > 0)) return true;
  const call = Math.min(i.toCall, i.stack);
  const [lo, hi] = i.band ?? OOP_PRIOR_BAND_OPEN;
  const equity = omahaReraisedEquity(
    i.hole,
    [],
    i.dead,
    (h) => {
      const p = omahaPreflopPercentile([...h], false);
      return p >= lo && p <= hi;
    },
    OOP_EQUITY_SAMPLES
  );
  if (equity === null) return true;
  return (
    equity >=
    call / (i.pot + call) + (i.outOfPosition ? OOP_REALIZATION_MARGIN : IP_REALIZATION_MARGIN)
  );
}

/** Order to act on a postflop street: the small blind first, the dealer last. */
export function omahaPostflopOrder(seat: number, dealerSeat: number | undefined): number {
  const d = seat - (dealerSeat ?? 0);
  return d <= 0 ? d + 1024 : d;
}

/** The re-raise rule's spot at a preflop node where hero faces a raise, or null. */
export interface OmahaReraiseSpot {
  input: OmahaReraiseByPositionInput;
  /** the last preflop raiser other than hero */
  raiserSeat: number;
  toCall: number;
  stack: number;
}
export function omahaReraiseByPositionSpot(
  player: SeatPlayer,
  gs: HorseGameStateV2
): OmahaReraiseSpot | null {
  if (String(gs.stage ?? '') !== 'preflop') return null;
  const stack = Number.isFinite(player.stack) ? Math.max(0, player.stack) : 0;
  const heroBet = Number.isFinite(player.bet) ? Math.max(0, player.bet ?? 0) : 0;
  const toCall = Number.isFinite(gs.toCall)
    ? Math.max(0, gs.toCall as number)
    : Math.max(0, (gs.currentBet || 0) - heroBet);
  if (toCall <= 0.005) return null;
  const history = gs.actionHistory ?? [];
  let raiserSeat = -1;
  for (let k = history.length - 1; k >= 0; k--) {
    const a = history[k]!;
    if (a.stage !== 'preflop' || a.seat === player.seat) continue;
    if (a.action !== 'raise' && a.action !== 'all_in' && a.action !== 'bet') continue;
    raiserSeat = a.seat;
    break;
  }
  if (raiserSeat < 0) return null;
  const order = (seat: number) => omahaPostflopOrder(seat, gs.dealerSeat);
  const dealt = (gs.players ?? []).filter((p) => !p.is_sitting_out || p.is_all_in);
  const live = dealt.filter((p) => p.seat !== player.seat && !p.is_folded);
  const mine = order(player.seat);
  const price = gs.currentBet || 0;
  // The player re-raised, and every caller already in the pot for his raise.
  const inPot = live.filter(
    (p) =>
      p.seat === raiserSeat ||
      (Number.isFinite(p.bet) && (p.bet ?? 0) >= price - 0.005 && !p.is_all_in)
  );
  const ring = [...dealt].sort((a, b) => order(a.seat) - order(b.seat));
  const index = ring.findIndex((p) => p.seat === player.seat);
  const stillToAct = live.some(
    (p) => !p.is_all_in && Number.isFinite(p.bet) && (p.bet ?? 0) < price - 0.005
  );
  // Cash only; omahaStrategyInTournaments opens its public tournament scope.
  const tournament = omahaCashOnlyExcludes(player, gs);
  return {
    raiserSeat,
    toCall,
    stack,
    input: {
      variant: String(gs.gameVariant ?? '').toLowerCase(),
      hole: player.cards ?? [],
      preflopRaises: preflopRaiseCount(history),
      outOfPosition: inPot.some((p) => order(p.seat) > mine),
      earlyPosition: ring.length >= 6 && (index === 2 || index === 3) && stillToAct,
      blindVersusBlind:
        ring.length >= 3 &&
        index >= 0 &&
        index <= 1 &&
        live.length > 0 &&
        live.every((p) => ring.findIndex((q) => q.seat === p.seat) <= 1),
      hiLo: gs.variantRules
        ? gs.variantRules.splitLow8OrBetter
        : variantInfo(gs.gameVariant).isHiLo,
      multiBoard: !!(gs.communityCards2?.length || gs.communityCards3?.length),
      bombPot: gs.bombPot === true,
      tournament,
      allInOrFold: gs.allInOrFold === true,
    },
  };
}

/**
 * Receipt validation: at this request the re-raise rule turns a raise into a
 * call of exactly `amount` (the rule re-run on the request; the hand is
 * outside the capped range in a restricted spot).
 */
export function omahaReraiseRuleProducesCall(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  amount: number | null | undefined
): boolean {
  try {
    const spot = omahaReraiseByPositionSpot(player, gs);
    if (spot === null) return false;
    const verdict = omahaReraiseByPositionCell(spot.input);
    if (verdict === null || verdict.reraise) return false;
    return amount === Math.round(Math.min(spot.toCall, spot.stack) * 100) / 100;
  } catch {
    return false;
  }
}
