/**
 * The recorded flop decisions behind HorseOmahaFlopFacingBetEv.test.ts.
 *
 * PLO5 1/2 cash, 2026-11-16 to 2026-11-17: twenty-one flop decisions of Horses
 * facing one player's bet or raise, taken from the decision audit of that
 * player's 721 hands (lane archive plo-handoff-review-01a1cbbd/
 * audit2-01BNteGZ, PLO5-WOOWOO-AUDIT-PART2-DECISIONS-20261117.csv). Each entry
 * is the hand's own public record at the moment the Horse answered: who sat
 * where (P = a person, H = a Horse), every recorded action before it in order
 * (seat | street | action | amount | origin | full raise | dead), the seats as
 * they stood, and that Horse's own cards. No user ids, no names and no
 * person's cards (a Horse's own recorded cards are committed the way the
 * complaint fixtures under horseComplaints/ commit them).
 *
 * The public snapshot is REBUILT from the recorded actions and starting
 * stacks (the audit export kept no engine snapshot): pot, bets, stacks behind
 * and the pot-limit raise bounds are replayed arithmetic, not a copy of the
 * engine's own record.
 *
 * Groups:
 *  - wrongFold: the Horse folded and the audit judged the fold wrong (range
 *    equity against the bettor's measured range well above the price); the
 *    flop verdict calls.
 *  - wrongFoldKept: judged a wrong fold by the audit, and the flop verdict
 *    still folds (stated in the test, not hidden).
 *  - lostCall: the Horse called, the hand lost, and the flop verdict folds.
 *  - smallBetCall: a call of a bet of a third of the pot that the verdict keeps.
 *  - rc02a: the five flop folds of sets and nut straights the 48-hour audit
 *    of the same tables named (its root cause RC-02a; hands 59710501,
 *    59727433, 59756252, 59806482, 59842423, 2026-11-16 and 2026-11-17, with
 *    a caller already in or players still to act); the verdict calls four
 *    of them and prices the fifth within a few percent of the pot of its margin.
 *  - bareOverpair: a real node of the bare-overpair continuation (the
 *    preflop raiser checked a bare big pair and faces a bet heads-up), which
 *    the flop verdict stands aside for.
 * The audit file holds one flop call judged wrong (hand 59852499): it is a
 * bomb pot, outside this rule, so it is not here.
 */
import type {
  ComplaintAction,
  ComplaintFixture,
  ComplaintPublicNode,
} from './HorseComplaintReplay.js';
import type { Card, CardRank, CardSuit } from '../types.js';

export interface RecordedFlopFacingBet {
  /** Hand number. */
  n: number;
  group: 'wrongFold' | 'wrongFoldKept' | 'lostCall' | 'smallBetCall' | 'rc02a' | 'bareOverpair';
  /** The audit's cause or note for the decision. */
  audit: string;
  /** What the Horse did. */
  did: 'fold' | 'call';
  pl: string;
  dealer: number;
  /** Every recorded action before the decision. */
  a: string;
  board: string;
  seat: number;
  hole: string;
  pot: number;
  /** Chips to call, and the flop's current bet. */
  bet: number;
  cur: number;
  min: number | null;
  max: number | null;
  /** [seat, behind, street bet, hand total, dead ante, individual ante, flags: folded 1, all-in 2] */
  seats: number[][];
}

export const RECORDED_FLOP_FACING_BETS: RecordedFlopFacingBet[] = [
  {
    n: 59790514,
    group: 'wrongFold',
    audit: 'over-fold of two pair / set / overpair class',
    did: 'fold',
    pl: '1P 2H 3H 4H 5H 6H',
    dealer: 4,
    a: '5|p|sb|1|f|0|0;6|p|bb|2|f|0|0;6|p|ante|2|f|0|1;1|p|raise|9|p|1|0;2|p|call|9|h|0|0;3|p|fold|0|h|0|0;4|p|call|9|h|0|0;5|p|call|8|h|0|0;6|p|fold|0|h|0|0;5|f|check|0|h|0|0;1|f|bet|30|p|1|0',
    board: 'JdQs6c',
    seat: 2,
    hole: '7sAc6s4sQc',
    pot: 70,
    bet: 30,
    cur: 30,
    min: 60,
    max: 130,
    seats: [
      [1, 5326.9, 30.0, 39.0, 0.0, 0, 0],
      [2, 1756.76, 0.0, 9.0, 0.0, 0, 0],
      [3, 1062.75, 0.0, 0.0, 0.0, 0, 1],
      [4, 544.7, 0.0, 9.0, 0.0, 0, 0],
      [5, 939.2, 0.0, 9.0, 0.0, 0, 0],
      [6, 1070.62, 0.0, 2.0, 2.0, 0, 1],
    ],
  },
  {
    n: 59829906,
    group: 'wrongFold',
    audit: 'fold of a strong draw',
    did: 'fold',
    pl: '1P 2H 3H 4H 5H 6H',
    dealer: 2,
    a: '3|p|sb|1|f|0|0;4|p|bb|2|f|0|0;4|p|ante|2|f|0|1;5|p|call|2|h|0|0;6|p|fold|0|h|0|0;1|p|raise|11|p|1|0;2|p|call|11|h|0|0;3|p|call|10|h|0|0;4|p|call|9|h|0|0;5|p|fold|0|h|0|0;3|f|check|0|h|0|0;4|f|check|0|h|0|0;1|f|bet|36|p|1|0;2|f|fold|0|h|0|0',
    board: '5cJsAc',
    seat: 3,
    hole: '7cQc9sKhAs',
    pot: 84,
    bet: 36,
    cur: 36,
    min: 72,
    max: 156,
    seats: [
      [1, 4512.75, 36.0, 47.0, 0.0, 0, 0],
      [2, 612.2, 0.0, 11.0, 0.0, 0, 1],
      [3, 1912.3, 0.0, 11.0, 0.0, 0, 0],
      [4, 429.55, 0.0, 11.0, 2.0, 0, 0],
      [5, 1402.3, 0.0, 2.0, 0.0, 0, 1],
      [6, 593.45, 0.0, 0.0, 0.0, 0, 1],
    ],
  },
  {
    n: 59811519,
    group: 'wrongFold',
    audit: 'over-fold of pair / weak draw at a good price',
    did: 'fold',
    pl: '1P 2H 3H 4H 5H 6H',
    dealer: 4,
    a: '5|p|sb|1|f|0|0;6|p|bb|2|f|0|0;6|p|ante|2|f|0|1;1|p|raise|9|p|1|0;2|p|call|9|h|0|0;3|p|raise|41|h|1|0;4|p|fold|0|h|0|0;5|p|fold|0|h|0|0;6|p|fold|0|h|0|0;1|p|raise|137|p|1|0;2|p|fold|0|h|0|0;3|p|call|96|h|0|0;1|f|bet|144|p|1|0',
    board: '5h4sJd',
    seat: 3,
    hole: '8dTdAsAc2s',
    pot: 432,
    bet: 144,
    cur: 144,
    min: 227.3,
    max: 227.3,
    seats: [
      [1, 5542.75, 144.0, 281.0, 0.0, 0, 0],
      [2, 1452.21, 0.0, 9.0, 0.0, 0, 1],
      [3, 227.3, 0.0, 137.0, 0.0, 0, 0],
      [4, 369.9, 0.0, 0.0, 0.0, 0, 1],
      [5, 559.1, 0.0, 1.0, 0.0, 0, 1],
      [6, 1683.92, 0.0, 2.0, 2.0, 0, 1],
    ],
  },
  {
    n: 59833259,
    group: 'wrongFold',
    audit: 'fold of a strong draw',
    did: 'fold',
    pl: '1P 2H 3H 4H 5H 6H',
    dealer: 2,
    a: '3|p|sb|1|f|0|0;4|p|bb|2|f|0|0;4|p|ante|2|f|0|1;5|p|call|2|h|0|0;6|p|raise|10|h|1|0;1|p|raise|37|p|1|0;2|p|fold|0|h|0|0;3|p|fold|0|h|0|0;4|p|call|35|h|0|0;5|p|fold|0|h|0|0;6|p|fold|0|h|0|0;4|f|check|0|h|0|0;1|f|bet|67|p|1|0',
    board: '2h5s6s',
    seat: 4,
    hole: '4sAh8sJcAd',
    pot: 156,
    bet: 67,
    cur: 67,
    min: 134,
    max: 290,
    seats: [
      [1, 4321.75, 67.0, 104.0, 0.0, 0, 0],
      [2, 520.6, 0.0, 0.0, 0.0, 0, 1],
      [3, 2078.8, 0.0, 1.0, 0.0, 0, 1],
      [4, 495.5, 0.0, 37.0, 2.0, 0, 0],
      [5, 1077.8, 0.0, 2.0, 0.0, 0, 1],
      [6, 518.35, 0.0, 10.0, 0.0, 0, 1],
    ],
  },
  {
    n: 59852600,
    group: 'wrongFold',
    audit: 'fold of a strong draw (facing a raise)',
    did: 'fold',
    pl: '1P 2H 3H 4H 5H 6H',
    dealer: 6,
    a: '1|p|sb|1|f|0|0;2|p|bb|2|f|0|0;2|p|ante|2|f|0|1;3|p|raise|8|h|1|0;4|p|fold|0|h|0|0;5|p|fold|0|h|0|0;6|p|call|8|h|0|0;1|p|call|7|p|0|0;2|p|fold|0|h|0|0;1|f|check|0|p|0|0;3|f|bet|11|h|1|0;6|f|call|11|h|0|0;1|f|raise|72|p|1|0',
    board: '4s8dKd',
    seat: 3,
    hole: '5dQcAcKcAd',
    pot: 122,
    bet: 61,
    cur: 72,
    min: 144,
    max: 255,
    seats: [
      [1, 6870.95, 72.0, 80.0, 0.0, 0, 0],
      [2, 716.2, 0.0, 2.0, 2.0, 0, 1],
      [3, 787.1, 11.0, 19.0, 0.0, 0, 0],
      [4, 407.7, 0.0, 0.0, 0.0, 0, 1],
      [5, 400.0, 0.0, 0.0, 0.0, 0, 1],
      [6, 591.4, 11.0, 19.0, 0.0, 0, 0],
    ],
  },
  {
    n: 59840990,
    group: 'wrongFold',
    audit: 'over-fold of two pair / set / overpair class (paired flop)',
    did: 'fold',
    pl: '1P 2H 3H 4H 6H',
    dealer: 2,
    a: '3|p|sb|1|f|0|0;4|p|bb|2|f|0|0;4|p|ante|2|f|0|1;6|p|raise|8|h|1|0;1|p|raise|29|p|1|0;2|p|fold|0|h|0|0;3|p|fold|0|h|0|0;4|p|fold|0|h|0|0;6|p|call|21|h|0|0;6|f|check|0|h|0|0;1|f|bet|32|p|1|0',
    board: 'KhKd6s',
    seat: 6,
    hole: 'AhAc4d2h3h',
    pot: 95,
    bet: 32,
    cur: 32,
    min: 64,
    max: 159,
    seats: [
      [1, 4672.8, 32.0, 61.0, 0.0, 0, 0],
      [2, 894.85, 0.0, 0.0, 0.0, 0, 1],
      [3, 1631.1, 0.0, 1.0, 0.0, 0, 1],
      [4, 362.0, 0.0, 2.0, 2.0, 0, 1],
      [6, 342.0, 0.0, 29.0, 0.0, 0, 0],
    ],
  },
  {
    n: 59869211,
    group: 'wrongFold',
    audit: 'over-fold of two pair / set / overpair class (paired flop, a third of the pot)',
    did: 'fold',
    pl: '1P 2H 3H 4H 5H',
    dealer: 5,
    a: '1|p|sb|1|f|0|0;2|p|bb|2|f|0|0;2|p|ante|2|f|0|1;3|p|call|2|h|0|0;4|p|raise|10|h|1|0;5|p|call|10|h|0|0;1|p|raise|46|p|1|0;2|p|fold|0|h|0|0;3|p|fold|0|h|0|0;4|p|call|36|h|0|0;5|p|fold|0|h|0|0;1|f|bet|36|p|1|0',
    board: '8c4h4d',
    seat: 4,
    hole: 'Qh9sTcJdJc',
    pot: 144,
    bet: 36,
    cur: 36,
    min: 72,
    max: 216,
    seats: [
      [1, 552.5, 36.0, 82.0, 0.0, 0, 0],
      [2, 420.69, 0.0, 2.0, 2.0, 0, 1],
      [3, 396.0, 0.0, 2.0, 0.0, 0, 1],
      [4, 597.3, 0.0, 46.0, 0.0, 0, 0],
      [5, 814.4, 0.0, 10.0, 0.0, 0, 1],
    ],
  },
  {
    n: 59802550,
    group: 'wrongFold',
    audit: 'over-fold of two pair / set / overpair class (paired flop, a third of the pot)',
    did: 'fold',
    pl: '1P 2H 3H 4H 5H 6H',
    dealer: 1,
    a: '2|p|sb|1|f|0|0;3|p|bb|2|f|0|0;3|p|ante|2|f|0|1;4|p|call|2|h|0|0;5|p|call|2|h|0|0;6|p|call|2|h|0|0;1|p|raise|15|p|1|0;2|p|raise|55|h|1|0;3|p|fold|0|h|0|0;4|p|fold|0|h|0|0;5|p|fold|0|h|0|0;6|p|fold|0|h|0|0;1|p|raise|175|p|1|0;2|p|call|120|h|0|0;2|f|check|0|h|0|0;1|f|bet|119|p|1|0',
    board: '8cTd8s',
    seat: 2,
    hole: 'Qs7d9cKdTc',
    pot: 479,
    bet: 119,
    cur: 119,
    min: 238,
    max: 717,
    seats: [
      [1, 5056.85, 119.0, 294.0, 0.0, 0, 0],
      [2, 1516.21, 0.0, 175.0, 0.0, 0, 0],
      [3, 621.0, 0.0, 2.0, 2.0, 0, 1],
      [4, 631.0, 0.0, 2.0, 0.0, 0, 1],
      [5, 1079.1, 0.0, 2.0, 0.0, 0, 1],
      [6, 1477.32, 0.0, 2.0, 0.0, 0, 1],
    ],
  },
  {
    n: 59806482,
    group: 'wrongFold',
    audit: 'fold of a strong hand',
    did: 'fold',
    pl: '1P 2H 3H 4H 5H 6H',
    dealer: 4,
    a: '5|p|sb|1|f|0|0;6|p|bb|2|f|0|0;6|p|ante|2|f|0|1;1|p|raise|9|p|1|0;2|p|call|9|h|0|0;3|p|call|9|h|0|0;4|p|fold|0|h|0|0;5|p|call|8|h|0|0;6|p|fold|0|h|0|0;5|f|check|0|h|0|0;1|f|bet|30|p|1|0;2|f|fold|0|h|0|0;3|f|fold|0|h|0|0',
    board: '4s7s8h',
    seat: 5,
    hole: '9sJsJhKs3d',
    pot: 70,
    bet: 30,
    cur: 30,
    min: 60,
    max: 130,
    seats: [
      [1, 5522.35, 30.0, 39.0, 0.0, 0, 0],
      [2, 1585.51, 0.0, 9.0, 0.0, 0, 1],
      [3, 544.7, 0.0, 9.0, 0.0, 0, 1],
      [4, 581.5, 0.0, 0.0, 0.0, 0, 1],
      [5, 1201.85, 0.0, 9.0, 0.0, 0, 0],
      [6, 1579.92, 0.0, 2.0, 2.0, 0, 1],
    ],
  },
  {
    n: 59833693,
    group: 'wrongFoldKept',
    audit: 'over-fold of two pair / set / overpair class (paired flop)',
    did: 'fold',
    pl: '1P 2H 3H 4H 5H 6H',
    dealer: 6,
    a: '1|p|sb|1|f|0|0;2|p|bb|2|f|0|0;2|p|ante|2|f|0|1;3|p|raise|8|h|1|0;4|p|fold|0|h|0|0;5|p|fold|0|h|0|0;6|p|call|8|h|0|0;1|p|raise|36|p|1|0;2|p|fold|0|h|0|0;3|p|fold|0|h|0|0;6|p|call|28|h|0|0;1|f|bet|63|p|1|0',
    board: '6hKcKs',
    seat: 6,
    hole: '9hTs3cJsJc',
    pot: 147,
    bet: 63,
    cur: 63,
    min: 126,
    max: 273,
    seats: [
      [1, 5067.35, 63.0, 99.0, 0.0, 0, 0],
      [2, 392.0, 0.0, 2.0, 2.0, 0, 1],
      [3, 1986.8, 0.0, 8.0, 0.0, 0, 1],
      [4, 512.5, 0.0, 0.0, 0.0, 0, 1],
      [5, 989.8, 0.0, 0.0, 0.0, 0, 1],
      [6, 451.35, 0.0, 36.0, 0.0, 0, 0],
    ],
  },
  {
    n: 59848622,
    group: 'wrongFoldKept',
    audit: 'over-fold of pair / weak draw at a good price',
    did: 'fold',
    pl: '1P 2H 3H 4H 5H 6H',
    dealer: 3,
    a: '4|p|sb|1|f|0|0;5|p|bb|2|f|0|0;5|p|ante|2|f|0|1;6|p|fold|0|h|0|0;1|p|raise|9|p|1|0;2|p|call|9|h|0|0;3|p|raise|41|h|1|0;4|p|fold|0|h|0|0;5|p|fold|0|h|0|0;1|p|raise|137|p|1|0;2|p|fold|0|h|0|0;3|p|call|96|h|0|0;1|f|bet|216|p|1|0',
    board: '7c3h8s',
    seat: 3,
    hole: 'AhAsKd4sKs',
    pot: 504,
    bet: 216,
    cur: 216,
    min: 432,
    max: 843.9,
    seats: [
      [1, 4660.85, 216.0, 353.0, 0.0, 0, 0],
      [2, 1364.2, 0.0, 9.0, 0.0, 0, 1],
      [3, 843.9, 0.0, 137.0, 0.0, 0, 0],
      [4, 296.95, 0.0, 1.0, 0.0, 0, 1],
      [5, 900.9, 0.0, 2.0, 2.0, 0, 1],
      [6, 553.5, 0.0, 0.0, 0.0, 0, 1],
    ],
  },
  {
    n: 59831538,
    group: 'lostCall',
    audit: 'judged right by the audit model; the hand lost 65 bb',
    did: 'call',
    pl: '1P 2H 3H 4H 5H 6H',
    dealer: 5,
    a: '1|p|bb|2|f|0|0;1|p|ante|2|f|0|1;6|p|sb|1|f|0|0;2|p|raise|8|h|1|0;3|p|call|8|h|0|0;4|p|raise|37|h|1|0;5|p|fold|0|h|0|0;6|p|fold|0|h|0|0;1|p|call|35|p|0|0;2|p|fold|0|h|0|0;3|p|fold|0|h|0|0;1|f|bet|93|p|1|0',
    board: '4c2h6s',
    seat: 4,
    hole: '8sJdAsAh5s',
    pot: 186,
    bet: 93,
    cur: 93,
    min: 186,
    max: 244.05,
    seats: [
      [1, 4757.85, 93.0, 130.0, 2.0, 0, 0],
      [2, 427.1, 0.0, 8.0, 0.0, 0, 1],
      [3, 1659.3, 0.0, 8.0, 0.0, 0, 1],
      [4, 244.05, 0.0, 37.0, 0.0, 0, 0],
      [5, 1308.8, 0.0, 0.0, 0.0, 0, 1],
      [6, 894.95, 0.0, 1.0, 0.0, 0, 1],
    ],
  },
  {
    n: 59868806,
    group: 'lostCall',
    audit: 'judged right by the audit model; the hand lost 16.5 bb',
    did: 'call',
    pl: '1P 2H 3H 4H 5H 6H',
    dealer: 2,
    a: '3|p|sb|1|f|0|0;4|p|bb|2|f|0|0;4|p|ante|2|f|0|1;5|p|raise|8|h|1|0;6|p|call|8|h|0|0;1|p|call|8|p|0|0;2|p|call|8|h|0|0;3|p|call|7|h|0|0;4|p|call|6|h|0|0;3|f|check|0|h|0|0;4|f|check|0|h|0|0;5|f|check|0|h|0|0;6|f|check|0|h|0|0;1|f|bet|25|p|1|0;2|f|fold|0|h|0|0;3|f|fold|0|h|0|0;4|f|fold|0|h|0|0;5|f|fold|0|h|0|0',
    board: 'Jc9d5c',
    seat: 6,
    hole: '7dQd7s3cJd',
    pot: 75,
    bet: 25,
    cur: 25,
    min: 50,
    max: 125,
    seats: [
      [1, 544.4, 25.0, 33.0, 0.0, 0, 0],
      [2, 364.69, 0.0, 8.0, 0.0, 0, 1],
      [3, 384.0, 0.0, 8.0, 0.0, 0, 1],
      [4, 706.8, 0.0, 8.0, 2.0, 0, 1],
      [5, 844.4, 0.0, 8.0, 0.0, 0, 1],
      [6, 364.0, 0.0, 8.0, 0.0, 0, 0],
    ],
  },
  {
    n: 59870825,
    group: 'lostCall',
    audit: 'judged right by the audit model; the hand lost 31.5 bb',
    did: 'call',
    pl: '1P 2H 3H 4H 5H 6H',
    dealer: 5,
    a: '1|p|bb|2|f|0|0;1|p|ante|2|f|0|1;6|p|sb|1|f|0|0;2|p|raise|8|h|1|0;3|p|call|8|h|0|0;4|p|fold|0|h|0|0;5|p|fold|0|h|0|0;6|p|call|7|h|0|0;1|p|call|6|p|0|0;6|f|check|0|h|0|0;1|f|bet|26|p|1|0;2|f|fold|0|h|0|0;3|f|fold|0|h|0|0',
    board: '6cTd4s',
    seat: 6,
    hole: '9c7d7c7sTc',
    pot: 60,
    bet: 26,
    cur: 26,
    min: 52,
    max: 112,
    seats: [
      [1, 827.96, 26.0, 34.0, 2.0, 0, 0],
      [2, 370.18, 0.0, 8.0, 0.0, 0, 1],
      [3, 384.0, 0.0, 8.0, 0.0, 0, 1],
      [4, 719.4, 0.0, 0.0, 0.0, 0, 1],
      [5, 1177.9, 0.0, 0.0, 0.0, 0, 1],
      [6, 373.75, 0.0, 8.0, 0.0, 0, 0],
    ],
  },
  {
    n: 59789847,
    group: 'smallBetCall',
    audit: 'a third of the pot on a paired flop; judged right; the hand lost 11.5 bb',
    did: 'call',
    pl: '1P 2H 3H 5H 6H',
    dealer: 2,
    a: '3|p|sb|1|f|0|0;5|p|bb|2|f|0|0;5|p|ante|2|f|0|1;6|p|call|2|h|0|0;1|p|raise|11|p|1|0;2|p|fold|0|h|0|0;3|p|fold|0|h|0|0;5|p|call|9|h|0|0;6|p|call|9|h|0|0;5|f|check|0|h|0|0;6|f|check|0|h|0|0;1|f|bet|12|p|1|0;5|f|fold|0|h|0|0',
    board: '9d2d2s',
    seat: 6,
    hole: 'Td4dJdJc7c',
    pot: 48,
    bet: 12,
    cur: 12,
    min: 24,
    max: 72,
    seats: [
      [1, 5181.8, 12.0, 23.0, 0.0, 0, 0],
      [2, 1771.26, 0.0, 0.0, 0.0, 0, 1],
      [3, 1088.15, 0.0, 1.0, 0.0, 0, 1],
      [5, 957.2, 0.0, 11.0, 2.0, 0, 1],
      [6, 1183.62, 0.0, 11.0, 0.0, 0, 0],
    ],
  },
  {
    n: 59710501,
    group: 'rc02a',
    audit:
      'bottom set of sevens on 7 9 J, a caller in and a player behind (the 48-hour audit, RC-02a)',
    did: 'fold',
    pl: '1H 2H 3P 4H 5H 6H',
    dealer: 6,
    a: '1|p|sb|1|f|0|0;2|p|bb|2|f|0|0;2|p|ante|2|f|0|1;3|p|raise|9|p|1|0;4|p|call|9|h|0|0;5|p|call|9|h|0|0;6|p|fold|0|h|0|0;1|p|call|8|h|0|0;2|p|call|7|h|0|0;1|f|check|0|h|0|0;2|f|check|0|h|0|0;3|f|bet|36|p|1|0;4|f|fold|0|h|0|0;5|f|call|36|h|0|0',
    board: '7h9hJd',
    seat: 1,
    hole: '3d2c7c7d6c',
    pot: 119,
    bet: 36,
    cur: 36,
    min: 72,
    max: 191,
    seats: [
      [1, 1656.12, 0, 9, 0, 0, 0],
      [2, 614.15, 0, 11, 2, 0, 0],
      [3, 466.1, 36, 45, 0, 0, 0],
      [4, 1486.6, 0, 9, 0, 0, 1],
      [5, 809.9, 36, 45, 0, 0, 0],
      [6, 904.6, 0, 0, 0, 0, 1],
    ],
  },
  {
    n: 59727433,
    group: 'rc02a',
    audit: 'bottom set of deuces on J 5 2, in position, a caller in and two behind (RC-02a)',
    did: 'fold',
    pl: '1H 2H 3P 4H 5H 6H',
    dealer: 6,
    a: '1|p|sb|1|f|0|0;2|p|bb|2|f|0|0;2|p|ante|2|f|0|1;3|p|raise|9|p|1|0;4|p|call|9|h|0|0;5|p|call|9|h|0|0;6|p|call|9|h|0|0;1|p|call|8|h|0|0;2|p|call|7|h|0|0;1|f|check|0|h|0|0;2|f|check|0|h|0|0;3|f|bet|56|p|1|0;4|f|fold|0|h|0|0;5|f|call|56|h|0|0',
    board: 'Jc5s2h',
    seat: 6,
    hole: 'QhAd2d2s9s',
    pot: 168,
    bet: 56,
    cur: 56,
    min: 112,
    max: 280,
    seats: [
      [1, 507.1, 0, 9, 0, 0, 0],
      [2, 539.4, 0, 11, 2, 0, 0],
      [3, 1332.3, 56, 65, 0, 0, 0],
      [4, 397.5, 0, 9, 0, 0, 1],
      [5, 1326.2, 56, 65, 0, 0, 0],
      [6, 1336.05, 0, 9, 0, 0, 0],
    ],
  },
  {
    n: 59756252,
    group: 'rc02a',
    audit: 'the nut straight on 5 4 8 with four players behind (RC-02a)',
    did: 'fold',
    pl: '1P 2H 3H 4H 5H 6H',
    dealer: 4,
    a: '5|p|sb|1|f|0|0;6|p|bb|2|f|0|0;6|p|ante|2|f|0|1;1|p|raise|9|p|1|0;2|p|call|9|h|0|0;3|p|call|9|h|0|0;4|p|call|9|h|0|0;5|p|call|8|h|0|0;6|p|call|7|h|0|0;5|f|check|0|h|0|0;6|f|check|0|h|0|0;1|f|bet|28|p|1|0',
    board: '5h4s8c',
    seat: 2,
    hole: '3h7h6d4c2c',
    pot: 84,
    bet: 28,
    cur: 28,
    min: 56,
    max: 140,
    seats: [
      [1, 2599.64, 28, 37, 0, 0, 0],
      [2, 1035.85, 0, 9, 0, 0, 0],
      [3, 1089.39, 0, 9, 0, 0, 0],
      [4, 1276.75, 0, 9, 0, 0, 0],
      [5, 350, 0, 9, 0, 0, 0],
      [6, 389, 0, 11, 2, 0, 0],
    ],
  },
  {
    n: 59806482,
    group: 'rc02a',
    audit: 'the nut straight on 4 7 8 with two players behind (RC-02a)',
    did: 'fold',
    pl: '1P 2H 3H 4H 5H 6H',
    dealer: 4,
    a: '5|p|sb|1|f|0|0;6|p|bb|2|f|0|0;6|p|ante|2|f|0|1;1|p|raise|9|p|1|0;2|p|call|9|h|0|0;3|p|call|9|h|0|0;4|p|fold|0|h|0|0;5|p|call|8|h|0|0;6|p|fold|0|h|0|0;5|f|check|0|h|0|0;1|f|bet|30|p|1|0',
    board: '4s7s8h',
    seat: 2,
    hole: '5c4hTs2s6c',
    pot: 70,
    bet: 30,
    cur: 30,
    min: 60,
    max: 130,
    seats: [
      [1, 5495.85, 30, 39, 0, 0, 0],
      [2, 1594.51, 0, 9, 0, 0, 0],
      [3, 553.7, 0, 9, 0, 0, 0],
      [4, 581.5, 0, 0, 0, 0, 1],
      [5, 1210.85, 0, 9, 0, 0, 0],
      [6, 1583.92, 0, 4, 2, 0, 1],
    ],
  },
  {
    n: 59842423,
    group: 'rc02a',
    audit: 'top set of nines on 6 9 8 with two players behind (RC-02a)',
    did: 'fold',
    pl: '1P 2H 3H 4H 5H 6H',
    dealer: 1,
    a: '2|p|sb|1|f|0|0;3|p|bb|2|f|0|0;3|p|ante|2|f|0|1;4|p|call|2|h|0|0;5|p|fold|0|h|0|0;6|p|fold|0|h|0|0;1|p|raise|11|p|1|0;2|p|call|10|h|0|0;3|p|call|9|h|0|0;4|p|call|9|h|0|0;2|f|check|0|h|0|0;3|f|check|0|h|0|0;4|f|check|0|h|0|0;1|f|bet|35|p|1|0',
    board: '6c9s8c',
    seat: 2,
    hole: '4d9c4h9d5s',
    pot: 81,
    bet: 35,
    cur: 35,
    min: 70,
    max: 151,
    seats: [
      [1, 4102.4, 35, 46, 0, 0, 0],
      [2, 1019.85, 0, 11, 0, 0, 0],
      [3, 1454.1, 0, 13, 2, 0, 0],
      [4, 265.4, 0, 11, 0, 0, 0],
      [5, 1117.1, 0, 0, 0, 0, 1],
      [6, 474.5, 0, 0, 0, 0, 1],
    ],
  },
  {
    n: 59830767,
    group: 'bareOverpair',
    audit:
      'bare kings on 4 2 4: the preflop raiser checked and faces a bet heads-up (the bare-overpair continuation owns this spot)',
    did: 'fold',
    pl: '1P 2H 3H 4H 5H 6H',
    dealer: 4,
    a: '5|p|sb|1|f|0|0;6|p|bb|2|f|0|0;6|p|ante|2|f|0|1;1|p|raise|9|p|1|0;2|p|fold|0|h|0|0;3|p|call|9|h|0|0;4|p|call|9|h|0|0;5|p|raise|49|h|1|0;6|p|fold|0|h|0|0;1|p|call|40|p|0|0;3|p|fold|0|h|0|0;4|p|fold|0|h|0|0;5|f|check|0|h|0|0;1|f|bet|90|p|1|0',
    board: '4d2c4s',
    seat: 5,
    hole: '9sKh5sKd7d',
    pot: 210.0,
    bet: 90.0,
    cur: 90.0,
    min: 180.0,
    max: 390.0,
    seats: [
      [1, 4456.85, 90.0, 139.0, 0.0, 0, 0],
      [2, 563.1, 0.0, 0.0, 0.0, 0, 1],
      [3, 1713.3, 0.0, 9.0, 0.0, 0, 1],
      [4, 447.05, 0.0, 9.0, 0.0, 0, 1],
      [5, 1267.3, 0.0, 49.0, 0.0, 0, 0],
      [6, 853.45, 0.0, 2.0, 2.0, 0, 1],
    ],
  },
];

/** The options switched on in production when these hands were played (archive activation-0106z/ON-LIST.txt). */
export const OMAHA_LIVE_OPTIONS_20261116: Readonly<Record<string, true>> = Object.freeze(
  Object.fromEntries(
    [
      'horseActionTimeIsPublicOnly',
      'omahaBareOverpairOopFlopCheck',
      'omahaBigBetIsPotShare',
      'omahaBigDrawAggression',
      'omahaBluffCatcherFoldVsValueLeader',
      'omahaCardImpact',
      'omahaEliteContinuesVsMeasuredWideThreeBettor',
      'omahaFacingBetEv',
      'omahaMadeHandDefenseVsValueLeader',
      'omahaManiacReRaiseWidthMeasured',
      'omahaNoCallColdFourBetWithoutPremium',
      'omahaNoDrawRaiseOutOfPosition',
      'omahaOopReraisedPotStrongRange',
      'omahaOopTurnCheckAfterFlopCall',
      'omahaOverpairNoOopBarrelVsValueLeader',
      'omahaPairedBoardFoldRespectsPrice',
      'omahaPairedRiverNoThinLeadVsValueLeader',
      'omahaPairedTurnNoBarrelWithoutBoatVsValueLeader',
      'omahaPressureNeedsPostflopAggression',
      'omahaReraiseRangeEarlyPosition',
      'omahaReraiseRangeOutOfPosition',
      'omahaReraisedPotFlopContinueNeedsEquityShape',
      'omahaRiverMediumBetStrongHandCalls',
      'omahaRiverNutBlockerBluffReachable',
      'omahaStrategyInTournaments',
      'omahaStreetPlan',
      'omahaStrongHandSlowplayMix',
      'omahaStrongHandValue',
      'omahaTurnBetNeedsRiverPlan',
      'omahaTurnRiverRaiseNeedsNuts',
      'omahaUnderpairNoMultiwayFlopContinue',
      'omahaVpipFloorByLimp',
    ].map((o) => [o, true as const])
  )
);

const SUITS: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const STAGES: Record<string, string> = { p: 'preflop', f: 'flop', t: 'turn', r: 'river' };
const ORIGINS: Record<string, string> = { f: 'forced', h: 'horse_policy', p: 'player' };

export const flopCardsOf = (text: string): Card[] =>
  (text.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUITS[x[1]] }));

/** What a test may change in a recorded decision before it is replayed. */
export interface FlopEdit {
  hole?: string;
  board?: string;
  variant?: 'plo4' | 'plo5' | 'plo6';
  /** chips behind, by seat */
  stacks?: Record<number, number>;
  mode?: 'cash' | 'tournament';
  bombPot?: boolean;
  wagersCapped?: boolean;
  /** every chip amount of the hand multiplied (the same spot at other stakes) */
  scale?: number;
}

/** A recorded flop decision as a complaint fixture plus the node of the decision. */
export function expandFlop(
  r: RecordedFlopFacingBet,
  edit: FlopEdit = {}
): { fx: ComplaintFixture; node: ComplaintAction } {
  const k = edit.scale ?? 1;
  const variant = edit.variant ?? 'plo5';
  const actions: ComplaintAction[] = r.a.split(';').map((row, i) => {
    const [seat, stage, action, amount, origin, full, dead] = row.split('|');
    return {
      ord: i + 1,
      seat: Number(seat),
      stage: STAGES[stage],
      action,
      amount: Number(amount) * k,
      ...(ORIGINS[origin] ? { origin: ORIGINS[origin] } : {}),
      isFullRaise: full === '1',
      dead: dead === '1',
    };
  });
  const seats = r.seats.map((s) => {
    const row = [s[0], s[1] * k, s[2] * k, s[3] * k, s[4] * k, s[5] * k, s[6]];
    const behind = edit.stacks?.[s[0]];
    if (behind !== undefined) row[1] = behind;
    return row;
  });
  const hero = seats.find((s) => s[0] === r.seat)!;
  const toCall = Math.min(r.bet * k, hero[1]);
  const canRaise = r.max !== null && hero[1] > toCall + 0.005;
  const node: ComplaintAction = {
    ord: actions.length + 1,
    seat: r.seat,
    stage: 'flop',
    action: r.did,
    amount: r.did === 'call' ? toCall : 0,
    origin: 'horse_policy',
    isFullRaise: false,
    dead: false,
  };
  actions.push(node);
  node.publicNode = {
    pot: r.pot * k,
    ante: 2 * k,
    anteType: 'big_blind',
    mode: edit.mode ?? 'cash',
    asset: 'chips',
    seats,
    boards: [edit.board ?? r.board],
    street: 'flop',
    toCall,
    currentBet: r.cur * k,
    minRaiseTo: canRaise ? r.min! * k : null,
    maxRaiseTo: canRaise ? Math.min(r.max! * k, hero[2] + hero[1]) : null,
    legalActions: canRaise ? ['fold', 'call', 'raise', 'all_in'] : ['fold', 'call', 'all_in'],
    dealerSeat: r.dealer,
    chipUnit: 0.01,
    bigBlind: 2 * k,
    smallBlind: 1 * k,
    variant,
    structure: 'pot_limit',
    actorSeat: r.seat,
    bombPot: edit.bombPot === true,
    boardCount: 1,
    allInOrFold: false,
    fixedBetSize: null,
    wagersCapped: edit.wagersCapped === true,
  } as unknown as ComplaintPublicNode;
  const fx: ComplaintFixture = {
    version: 1,
    slug: `omaha-flop-facing-bet-${r.n}-seat-${r.seat}`,
    title: `Omaha Flop Decision Facing A Bet, Hand ${r.n}`,
    complaint:
      'A Horse answered a flop bet without counting its hand against the bettor and the price',
    handId: String(r.n),
    fmt: edit.mode === 'tournament' ? 'tour' : 'cash',
    variant,
    players: r.pl.split(' ').map((p) => ({ seat: Number(p[0]), isHorse: p[1] === 'H' })),
    hole: { [String(r.seat)]: flopCardsOf(edit.hole ?? r.hole) },
    actions,
    forbidden: [{ ord: node.ord, kind: r.did === 'fold' ? 'fold' : 'call' }],
    seeds: [],
  } as ComplaintFixture;
  return { fx, node };
}
