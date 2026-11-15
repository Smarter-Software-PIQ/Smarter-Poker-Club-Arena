/**
 * PLO6: A MULTIWAY BET WITH A WEAK MADE HAND AND NO DRAW BECOMES A CHECK
 * (PLO6 lane, 2026-11-15; option plo6NoMultiwayBetWithWeakMadeHand, default
 * OFF, read `=== true` by the caller: HorseLogic.plo6MultiwayWeakBetRule, in
 * omahaOwnBetRules and kept outermost by omahaOwnerRuledFinal).
 *
 * The leak. The PLO6 human-table sweep (agent-evidence extreme-archive
 * plo6-audit-01TLQer9Hdf phase1-play plo-port-20261115 SWEEP-PLO6.md, family
 * D2: flop or turn, three or more players live, the Horse BETS an underpair
 * or bottom two pair with no nut flush draw and fewer than eight straight
 * outs) is PLO6's largest cash family: 45 bets in 43 hands, hand net
 * -1,005.5 bb. None of the PLO4/PLO5 options addresses it: 3.21
 * omahaUnderpairNoMultiwayFlopContinue is about CONTINUING against a bet and
 * a call, and its PLO6 form is not a measured loss.
 *
 * The rule. Six-card Omaha high, pot limit, one board, not a bomb pot, not
 * all-in-or-fold; cash and tournaments (a check adds no chips, so there is
 * no prize-equity question). Flop or turn, nothing to call, a check legal,
 * TWO OR MORE live opponents. The Horse's best hand is a weak made hand
 * (plo6WeakMadeHand): one pair below the board's top card (a pocket pair
 * under it, or a pair with a lower board card), two pair without the board's
 * top card (bottom two pair on the flop; on the turn any two pair that does
 * not hold the top rank), the board's own pair with such a pair, or an
 * overpair (a pocket pair above the top card of an unpaired board; added
 * 2026-11-15 on its own measurement, THE OVERPAIR below). It holds
 * no qualifying draw (plo6QualifyingDraw): no nut flush draw, fewer than
 * eight straight outs, fewer than four outs to the nut straight, and no
 * combo draw (a flush draw of any rank with four or more straight outs). It
 * is not nut class (omahaNutClassNow). Then a bet becomes a check.
 *
 * It never turns a check into anything, never touches a decision facing a
 * bet, a heads-up pot, the river, top pair, an overpair on a paired board,
 * top and any other pair, a set or better, a hand with the qualifying draw,
 * or a nut-class hand. It
 * reads hero's cards, the board and the public seats; it draws no random
 * number, calls no telemetry and keeps no state (the caller fires
 * PLO6_MULTIWAY_WEAK_BET_RECEIPT).
 *
 * Owner principles it follows (2026-11-15). No blanket rule: the check
 * depends on the hand (made class, draw, nut class), on the players (two or
 * more still live) and on the street; bet size and pot size were measured
 * and neither separates the losses (below), and a check has no price to
 * weigh. Defence on bad ground: with six cards each opponent holds fifteen
 * two-card hands, so one pair multiway, under the top card or over it, is
 * rarely best and is rarely folded to (the bets below made every opponent
 * fold 12 times in 90). Nut and combo draws stay aggressive: the draw keeps
 * the bet.
 *
 * MEASURED (development evidence, unevaluated). Population: every Horse
 * decision with a person live in PLO6 cash, 2026-11-10T21:30Z to
 * 2026-11-15T20:05Z, 912 hands (the sweep's own extraction SQL, SELECT only,
 * re-run 2026-11-15; the sweep's D2 row reproduced exactly: 45 bets, 43
 * hands, -1,005.5 bb). Hands were classed with THIS file's functions. The
 * rows are re-measured on the same hands after the pre-review fixes of
 * 2026-11-15 (the combo draw keeps the bet; two pair without the top card
 * is one class on the flop and the turn), except where a row says it was
 * measured before them. Before the fixes the file removed 62 bets in 58
 * hands, -1,403.7 bb (lost 41 hands -1,825.9 bb, won 17 hands +422.2 bb,
 * 4.33 to 1). The combo line keeps 3 of those bets (+15.6 bb: lost 1 hand
 * -41.0, won 2 hands +56.6); the turn two-pair class removes 3 more turn
 * bets (-305.1 bb, all three hands lost). The two fixes were decided on the
 * poker in review, not chosen on these numbers.
 * "Hand net" is the Horse's result for the whole hand, not the value of the
 * bet; a hand is counted once per row. removed = the bet would become a
 * check; lost / won = hands with a result of zero or less / above zero.
 * The rows from here to "Decisions taken from it" are the five classes built
 * first, WITHOUT the overpair; the overpair's own rows and the totals of the
 * final rule (90 bets, -2,715.1 bb) follow under THE OVERPAIR.
 *
 *   multiway flop and turn bets, all hands        454 bets, +3,827.4 bb
 *   CHOSEN (this file) removed                     62 bets in 59 hands,
 *     -1,706.9 bb: lost 43 hands -2,089.9 bb, won 16 hands +383.0 bb
 *     (removed loss to removed win 5.46 to 1)
 *   every other multiway flop/turn bet (kept)     392 bets, +5,187.2 bb
 *   same weak hands, kept by the draw              44 bets, -180.1 bb
 *     (lost 22 hands -1,062.7 bb, won 20 hands +882.5 bb)
 *   the spot already checked by the Horses        302 checks
 *
 *   of the sweep's 45 D2 bets: removed 41 (-1,142.7 bb; lost 28 hands
 *     -1,455.8, won 11 hands +313.1); kept 4 (+137.3 bb; three a pair with
 *     four or more nut-straight outs, one a combo draw). Of the 40 graded
 *     mistakes (40% pot or more) 37 are removed (-843.4 bb), of the 5 graded
 *     minor (under 40% pot) 4 (-299.4 bb, all four lost): bet size does not
 *     separate them.
 *   removed and not in D2 (a pair with a lower board card, the paired-board
 *     forms with it, turn two pair without the top card, hands D2 left out
 *     on straight outs the engine does not count): 21 bets, -564.2 bb (lost
 *     15 hands -634.1, won 5 hands +70.0). This is the cost side: the
 *     winning bets the wider class removes.
 *
 *   candidate condition sets, MEASURED BEFORE THE PRE-REVIEW FIXES (two pair
 *   by the flop definition on both streets, no combo line; the choice among
 *   them was made on these rows) (removed bets: net; lost; won; ratio):
 *   hands   | draw that keeps the bet                 | removed
 *   D2 hands| nut flush draw or 8+ straight outs      | 49: -1,048.3; -1,570.9; +522.6; 3.01
 *   D2 hands| nut flush draw or 8+ nut-straight outs  | 57: -1,003.4; -1,769.0; +765.6; 2.31
 *   all weak| none (every bet removed)                | 102: -1,207.7; -2,455.8; +1,248.1; 1.97
 *   all weak| nut flush draw or 8+ nut-straight outs  | 81: -1,153.8; -2,108.4; +954.6; 2.21
 *   all weak| nut flush draw or 8+ straight outs      | 70: -1,297.8; -1,904.9; +607.1; 3.14
 *   all weak| nut flush draw or 4+ nut-straight outs  | 66: -1,354.2; -1,858.4; +504.1; 3.69
 *   all weak| the three together (CHOSEN)             | 62: -1,403.7; -1,825.9; +422.2; 4.33
 *   all weak| nut flush draw or 4+ straight outs      | 43: -1,060.0; -1,337.3; +277.3; 4.82
 *   ("D2 hands" = pocket underpair, its paired-board form, bottom two pair;
 *   "all weak" adds a pair with a board card below the top card and its
 *   paired-board form.) The last row has the highest ratio but keeps 19
 *   bets with four to seven straight outs, not to the nuts, that lost
 *   -370.1 bb (lost 12 hands -532.4, won 7 hands +162.4); the chosen set
 *   removes those, has the next best ratio and removes the most net loss.
 *   After the fixes the final set (the chosen row, less a flush draw with
 *   four or more straight outs, plus turn two pair without the top card) is
 *   62: -1,706.9; -2,089.9; +383.0; 5.46, and removes 17 of those four-to-
 *   seven-out bets (-411.2 bb; lost 12 hands -517.0, won 5 hands +105.8).
 *
 *   the final 62 by cell (bets: net; lost; won):
 *   flop 42: -1,259.6; -1,530.6; +271.0      turn 20: -493.5; -615.7; +122.2
 *   pocket underpair 29: -883.1; -1,092.8; +209.7
 *   pair with a lower board card 10: -124.4; -174.4; +50.0
 *   two pair without the top card 7: -439.8; -447.7; +7.9
 *   board pair with a pocket underpair 8: -127.2; -232.9; +105.7
 *   board pair with a low pair 8: -134.7; -154.6; +20.0
 *   two opponents 27: -1,012.1    three or more 35: -751.2
 *   bet under 40% pot 6: -348.3   bet 40% pot or more 56: -1,402.5
 *   answered by: everyone folded 7 (+68.7)
 *   not re-measured, the 62 bets before the fixes: pot under 12 bb 13: -4.5,
 *     12 to 25 bb 27: -336.0, over 25 bb 22: -1,048.0; called 39 (-915.6),
 *     raised 14 (-598.3, all 14 lost)
 *
 * THE OVERPAIR (added 2026-11-15; measured before it was built, on the same
 * 912 hands with the same method and this file's own functions;
 * MULTIWAY-WEAK-BET-WIRING.md section 13). Multiway flop and turn bets with
 * a pocket pair above the top card of an unpaired board, one pair the best
 * hand (bets: net; lost; won; ratio):
 *   every such bet                    44 bets in 41 hands: -810.7 bb; lost
 *     21 hands -1,746.2; won 20 hands +935.5; 1.87
 *   with no qualifying draw (REMOVED) 28 bets in 26 hands: -1,008.2 bb; lost
 *     15 hands -1,406.3; won 11 hands +398.1; 3.53
 *   kept by the draw                  16 bets in 16 hands: +276.3 bb; lost 6
 *     hands -339.9; won 10 hands +616.2; 0.55 (nut flush draw 8: +139.3;
 *     eight or more straight outs 4: -39.8; four or more nut-straight outs
 *     3: +98.0; combo draw 1: +78.8). This is the cost side the draw test
 *     avoids.
 *   the removed 28 by cell:
 *   flop 26: -1,008.2; -1,406.3; +398.1; 3.53
 *   turn 2: -229.4, both lost (both hands also hold one of the flop bets)
 *   aces 11: -419.5; -506.9; +87.4; 5.80
 *   kings 10: -466.6; -644.8; +178.2; 3.62
 *   queens or lower 7: -122.0; -254.6; +132.5; 1.92
 *   two opponents 16: -891.3; -1,038.0; +146.7; 7.08
 *   three or more 12: -116.9; -368.3; +251.4; 1.46
 *   dry board (three suits, no three ranks inside five) 8: -500.2; -601.5;
 *     +101.3; 5.94
 *   two-tone, monotone or connected board 20: -737.4; -1,034.1; +296.8; 3.48
 *   pot under 12 bb 1: -9.3   12 to 25 bb 14: -401.7; -560.9; +159.2; 3.52
 *   pot over 25 bb 13: -826.6; -1,065.4; +238.9; 4.46
 *   answered by: everyone folded 5 (+90.9), called 17 (-621.8), raised 6
 *     (-477.3)
 * The bar, stated before any cell was read: build only if the removed set
 * loses at least 2.0 to 1 on at least 20 bets and no cell of 8 or more bets
 * known at the decision (street, rank, opponents, board, pot) has a ratio
 * under 1.0. Met with no exclusion; the weakest such cell is three or more
 * opponents (1.46). Cells under 8 bets that won and are removed all the
 * same: queens or lower on a two-tone, monotone or connected board (6 bets,
 * +50.0 bb), kings against three or more (4 bets, +17.4 bb), a flush draw
 * that is not to the nuts with one to three straight outs (4 bets, +118.7
 * bb). Left out on the evidence: an overpair on a PAIRED board (4 bets with
 * no draw, +257.1 bb, all four won) and heads-up (27 bets, +213.3 bb).
 * Not PLO Strategy's omahaBareOverpairOopFlopCheck (HorseOmahaOopChecks.ts):
 * that option is PLO4 and PLO5 cash, the flop only, the Horse the last
 * preflop aggressor and out of position, heads-up or multiway, with a
 * heads-up continuation after its check; any flush draw keeps its bet. This
 * class is PLO6, flop and turn, two or more opponents, any position, with
 * the betting lead or without it, and this file's draw test. Neither acts
 * in the other's games.
 *
 * THE FINAL RULE (the five classes and the overpair) removes 90 bets in 85
 * hands, -2,715.1 bb: lost 58 hands -3,496.2 bb, won 27 hands +781.1 bb
 * (4.48 to 1). Flop 68 bets -2,267.8 bb, turn 22 bets -722.9 bb; two
 * opponents 43 (-1,903.4), three or more 47 (-868.1); everyone folded 12
 * (+159.6). The same hands kept by the draw: 60 bets, +96.2 bb (lost 28
 * hands -1,402.6, won 30 hands +1,498.8). Every other multiway flop/turn
 * bet: 364 bets, +6,143.5 bb. The final spot was already checked 363 times.
 *
 * Decisions taken from it. The river is left out: 3 such river bets in the
 * window (-80.1 bb), too few to rule on. The nut flush draw keeps the bet by
 * the owner's rule on nut draws although the 11 such bets lost (-274.7 bb):
 * owed to the evaluation, not decided here. Heads-up is out of scope by the
 * option's name; the same hands bet heads-up were 21 bets, -413.6 bb (with
 * the overpair 48 bets, -200.3 bb).
 * Tournaments: 3 such bets in 2 hands of the one tournament of the window
 * (+23.4 bb):
 * no evidence either way; allowed because the change only removes chips put
 * in.
 *
 * Limits. Five days; 7 persons, one of them in 667 of the 912 hands (57 of
 * the 62 removed bets had one person live; of the final 90, 82, and that one
 * person was live at 74 of them and at 25 of the overpair's 28), so this is
 * mostly one opponent. The overpair's cells are 1 to 26 bets: the bar it
 * passed is a screen on five days, not an evaluation.
 * Whole-hand results, all-in luck not removed, no solver grade, rake as
 * recorded. The conditions were chosen on the same hands they are measured
 * on. It has had no paired evaluation: default OFF until it has one.
 */
import type { Card, HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { omahaDrawQuality, omahaMadeClass, variantInfo } from './HorseEval.js';
import { omahaNutClassNow } from './HorseOmahaMadeHandDefense.js';

/** The receipt the caller fires when the bet became a check. */
export const PLO6_MULTIWAY_WEAK_BET_RECEIPT = 'plo6_multiway_weak_made_hand_bet_checked';
/** The one game this rule reads. */
export const PLO6_MULTIWAY_WEAK_BET_VARIANT = 'plo6';
/** Live opponents from which the pot is multiway. */
export const PLO6_MULTIWAY_WEAK_BET_MIN_OPPONENTS = 2;
/** Straight outs from which a draw is open-ended or a wrap (omahaDrawQuality.straightOuts). */
export const PLO6_MULTIWAY_WEAK_BET_STRAIGHT_OUTS = 8;
/** Outs to the nut straight from which a draw is a draw to the nuts (a nut gutshot or more). */
export const PLO6_MULTIWAY_WEAK_BET_NUT_STRAIGHT_OUTS = 4;
/** Straight outs from which a flush draw of any rank is a combo draw (a gutshot or more). */
export const PLO6_MULTIWAY_WEAK_BET_COMBO_STRAIGHT_OUTS = 4;

const STREET_BOARD: Record<string, number> = { flop: 3, turn: 4 };
const ONE_PAIR = 2;
const TWO_PAIR = 3;

const RANK_VALUE: Record<string, number> = Object.fromEntries(
  ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'].map((r, i) => [r, i + 2])
);

/**
 * The weak made hands of this rule, by what the best two hole cards make:
 *  - overpair: one pair, a pocket pair above the top card of an unpaired
 *    board (on a paired board the same pocket pair is not in the class);
 *  - underpair: one pair, a pocket pair below the board's top card;
 *  - low_pair: one pair made with a board card that is not the top card;
 *  - bottom_two_pair: two pair without the top card of an unpaired board (on
 *    the flop the two lowest ranks; on the turn any two pair of hero's that
 *    does not hold the board's top rank, so a flop bottom two pair is the
 *    same class after a turn card that does not pair it);
 *  - underpair_on_paired_board / low_pair_on_paired_board: the board's own
 *    pair plus one of the two pairs above (two pair in name only).
 */
export type Plo6WeakMadeHand =
  | 'overpair'
  | 'underpair'
  | 'low_pair'
  | 'bottom_two_pair'
  | 'underpair_on_paired_board'
  | 'low_pair_on_paired_board';

/**
 * The weak made hand six hole cards hold on a flop or turn board, or null:
 * no pair of hero's own, top pair, an overpair on a paired board, top two
 * pair, top and any other pair, a set or anything better is not one. The
 * category is the engine's
 * own (omahaMadeClass: exactly two hole cards and three board cards).
 */
export function plo6WeakMadeHand(
  hole: readonly Card[],
  board: readonly Card[]
): Plo6WeakMadeHand | null {
  if (hole.length !== 6 || (board.length !== 3 && board.length !== 4)) return null;
  const category = omahaMadeClass([...hole], [...board]).category;
  if (category !== ONE_PAIR && category !== TWO_PAIR) return null;
  const boardCount = new Map<number, number>();
  for (const c of board) {
    const r = RANK_VALUE[c.rank] ?? 0;
    boardCount.set(r, (boardCount.get(r) ?? 0) + 1);
  }
  const holeCount = new Map<number, number>();
  for (const c of hole) {
    const r = RANK_VALUE[c.rank] ?? 0;
    holeCount.set(r, (holeCount.get(r) ?? 0) + 1);
  }
  const boardRanks = [...boardCount.keys()].sort((a, b) => b - a);
  const top = boardRanks[0];
  const paired = boardRanks.length < board.length;
  // Hero's own pairs: a pocket pair off the board, or a hole card that pairs
  // an unpaired board card. Highest first.
  let pocket = 0;
  for (const [r, n] of holeCount) if (n >= 2 && !boardCount.has(r)) pocket = Math.max(pocket, r);
  const matched = boardRanks.filter((r) => boardCount.get(r) === 1 && holeCount.has(r));
  const own = Math.max(pocket, matched[0] ?? 0);
  if (own <= 0) return null;
  if (category === ONE_PAIR) {
    // On a paired board one pair is the board's pair: no made hand of hero's.
    if (paired || own === top) return null;
    // Above the top card of the board the pair is a pocket pair: an overpair.
    if (own > top) return 'overpair';
    return own === pocket ? 'underpair' : 'low_pair';
  }
  if (!paired) {
    if (matched.length < 2) return null;
    // Turn: any two pair that does not hold the board's top rank (matched is
    // highest first, so the best two pair holds the top rank or none does).
    if (board.length === 4) return matched[0] !== top ? 'bottom_two_pair' : null;
    const lowest = boardRanks.slice(-2);
    return matched[0] === lowest[0] && matched[1] === lowest[1] ? 'bottom_two_pair' : null;
  }
  // Paired board: the best two pair is the board's highest pair with hero's
  // own best pair, unless two hole cards pair two board cards that both rank
  // above the board pair (then it is a real two pair, never the bottom two).
  const boardPair = Math.max(...boardRanks.filter((r) => (boardCount.get(r) ?? 0) >= 2));
  if (matched.length >= 2 && own === matched[0] && boardPair < matched[1]) return null;
  if (own >= top) return null;
  return own === pocket ? 'underpair_on_paired_board' : 'low_pair_on_paired_board';
}

/**
 * The draw that keeps the bet: the nut flush draw, eight or more straight
 * outs (open-ended or a wrap), four or more outs to the nut straight, or a
 * combo draw: a flush draw of any rank together with four or more straight
 * outs. omahaDrawQuality's own counts: a card that makes hero a flush or a
 * full house is not a straight out (so an open-ender with a flush draw reads
 * six straight outs, which is why the combo line is four and not eight), and
 * a nut-straight out is a straight no two hole cards beat on a board with no
 * pair and no possible flush.
 */
export function plo6QualifyingDraw(hole: readonly Card[], board: readonly Card[]): boolean {
  const draw = omahaDrawQuality([...hole], [...board], false);
  return (
    draw.nutFlushDraw ||
    draw.straightOuts >= PLO6_MULTIWAY_WEAK_BET_STRAIGHT_OUTS ||
    draw.nutStraightOuts >= PLO6_MULTIWAY_WEAK_BET_NUT_STRAIGHT_OUTS ||
    (draw.dominatedFlushDraw && draw.straightOuts >= PLO6_MULTIWAY_WEAK_BET_COMBO_STRAIGHT_OUTS)
  );
}

export interface Plo6MultiwayWeakBetSpot {
  street: 'flop' | 'turn';
  hand: Plo6WeakMadeHand;
  /** Opponents still in the hand (not folded, not sitting out). */
  liveOpponents: number;
}

/**
 * The spot, or null: six-card Omaha high (pot limit, one board, not a bomb
 * pot, not all-in-or-fold; cash or tournament), flop or turn, nothing to
 * call and a check legal, two or more live opponents, a weak made hand
 * (plo6WeakMadeHand) with no qualifying draw (plo6QualifyingDraw) that is not
 * nut class. Reads hero's cards, the board and the public seats only.
 */
export function plo6MultiwayWeakBetSpot(
  hero: SeatPlayer,
  gs: HorseGameStateV2
): Plo6MultiwayWeakBetSpot | null {
  try {
    const variant = String(gs.gameVariant ?? '').toLowerCase();
    if (variant !== PLO6_MULTIWAY_WEAK_BET_VARIANT) return null;
    const stage = String(gs.stage ?? '');
    if (stage !== 'flop' && stage !== 'turn') return null;
    const vi = variantInfo(variant);
    if (!vi.isOmaha || vi.isFixedLimit || gs.bettingStructure === 'fixed_limit') return null;
    if (gs.variantRules ? gs.variantRules.splitLow8OrBetter : vi.isHiLo) return null;
    if (
      (gs.boardCount ?? 1) > 1 ||
      (gs.communityCards2?.length ?? 0) > 0 ||
      (gs.communityCards3?.length ?? 0) > 0
    )
      return null;
    if (gs.bombPot === true || gs.allInOrFold === true) return null;
    const board: Card[] = gs.communityCards ?? [];
    if (board.length !== STREET_BOARD[stage]) return null;
    if (!Array.isArray(hero.cards) || hero.cards.length !== vi.holeCount) return null;
    const toCall = Number.isFinite(gs.toCall)
      ? Math.max(0, gs.toCall as number)
      : Math.max(0, (gs.currentBet || 0) - (Number.isFinite(hero.bet) ? hero.bet : 0));
    if (toCall > 0.005) return null;
    if (Array.isArray(gs.legalActions) && !gs.legalActions.includes('check')) return null;
    const liveOpponents = (gs.players ?? []).filter(
      (p) => p.seat !== hero.seat && !p.is_folded && !p.is_sitting_out
    ).length;
    if (liveOpponents < PLO6_MULTIWAY_WEAK_BET_MIN_OPPONENTS) return null;
    const hand = plo6WeakMadeHand(hero.cards, board);
    if (hand === null) return null;
    if (plo6QualifyingDraw(hero.cards, board)) return null;
    if (omahaNutClassNow(hero, gs)) return null;
    return { street: stage, hand, liveOpponents };
  } catch {
    return null;
  }
}

export interface Plo6MultiwayWeakBetResult {
  decision: HorseDecision;
  changed: 'bet_checked' | null;
}

/**
 * A bet in the spot becomes a check. Anything else (a check, a fold, a call,
 * a wager outside the spot) is returned as the same object. The caller reads
 * the option, and fires PLO6_MULTIWAY_WEAK_BET_RECEIPT when `changed` is
 * 'bet_checked'.
 */
export function plo6NoMultiwayBetWithWeakMadeHand(
  decision: HorseDecision,
  hero: SeatPlayer,
  gs: HorseGameStateV2
): Plo6MultiwayWeakBetResult {
  const same: Plo6MultiwayWeakBetResult = { decision, changed: null };
  // Facing nothing, the engine's opening wager is a bet; a raise or an
  // all-in that opens the betting is the same wager under another name.
  if (decision.action !== 'bet' && decision.action !== 'raise' && decision.action !== 'all_in')
    return same;
  if (plo6MultiwayWeakBetSpot(hero, gs) === null) return same;
  const checked: HorseDecision = { ...decision, action: 'check' };
  delete checked.amount;
  return { decision: checked, changed: 'bet_checked' };
}
