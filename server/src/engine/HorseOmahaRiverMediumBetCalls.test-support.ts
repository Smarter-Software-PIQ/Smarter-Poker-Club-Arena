/**
 * The recorded river folds behind HorseOmahaRiverMediumBetCalls.test.ts.
 *
 * PLO5 1/2 cash, 2026-11-15, one table, one human bettor (seat marked P).
 * Each entry is a hand's own public record at the moment a Horse folded the
 * river: who sat where, every recorded action in order (seat | street |
 * action | amount | origin | full raise | dead), the snapshot the engine
 * recorded with the fold, and the folding Horse's own cards. No user ids and
 * no person's cards (a Horse's own recorded cards are committed the way the
 * complaint fixtures under horseComplaints/ commit them, in `hole`). `expand` turns an entry into the complaint-replay shape
 * (HorseComplaintReplay.stateAt), exactly as a complaint fixture is read.
 */
import type {
  ComplaintAction,
  ComplaintFixture,
  ComplaintPublicNode,
} from './HorseComplaintReplay.js';
import type { Card, CardRank, CardSuit } from '../types.js';

export interface RecordedRiverFold {
  /** Hand number. */
  n: number;
  /** What the Horse held, in the engine's words, and whether it was the best hand. */
  held: string;
  best: boolean;
  pl: string;
  dealer: number;
  a: string;
  boards: string[];
  seat: number;
  ord: number;
  hole: string;
  pot: number;
  bet: number;
  min: number | null;
  max: number | null;
  seats: number[][];
  bomb?: boolean;
}

export const RECORDED_RIVER_FOLDS: RecordedRiverFold[] = [
  {
    n: 59399392,
    held: 'two pair, paired board',
    best: false,
    pl: '1P 2H 3H 4H 5H 6H',
    dealer: 3,
    a: '4|p|sb|1|f|0|0;5|p|bb|2|f|0|0;5|p|ante|2|f|0|1;6|p|fold|0|h|0|0;1|p|raise|9|p|1|0;2|p|call|9|h|0|0;3|p|call|9|h|0|0;4|p|call|8|h|0|0;5|p|raise|51|h|1|0;1|p|call|42|p|0|0;2|p|fold|0|h|0|0;3|p|fold|0|h|0|0;4|p|fold|0|h|0|0;5|f|check|0|h|0|0;1|f|check|0|p|0|0;5|t|bet|107|h|1|0;1|t|call|107|p|0|0;5|r|check|0|h|0|0;1|r|bet|173|p|1|0;5|r|fold|0|h|0|0;1|r|return|173|-|0|0',
    boards: ['4sJc2s4d2c'],
    seat: 5,
    ord: 20,
    hole: '3dAh5d3hKs',
    pot: 518,
    bet: 173,
    min: 346,
    max: 452.85,
    seats: [
      [1, 535.3, 173, 331, 0, 0, 0],
      [2, 419.5, 0, 9, 0, 0, 1],
      [3, 559.5, 0, 9, 0, 0, 1],
      [4, 213.35, 0, 9, 0, 0, 1],
      [5, 452.85, 0, 160, 2, 0, 0],
      [6, 784.5, 0, 0, 0, 0, 1],
    ],
  },
  {
    n: 59402247,
    held: 'two pair',
    best: true,
    pl: '1P 2H 3H 4H 6H',
    dealer: 3,
    a: '4|p|sb|1|f|0|0;6|p|bb|2|f|0|0;6|p|ante|2|f|0|1;1|p|raise|9|p|1|0;2|p|call|9|h|0|0;3|p|call|9|h|0|0;4|p|call|8|h|0|0;6|p|call|7|h|0|0;4|f|check|0|h|0|0;6|f|check|0|h|0|0;1|f|bet|36|p|1|0;2|f|fold|0|h|0|0;3|f|fold|0|h|0|0;4|f|fold|0|h|0|0;6|f|call|36|h|0|0;6|t|check|0|h|0|0;1|t|check|0|p|0|0;6|r|check|0|h|0|0;1|r|bet|60|p|1|0;6|r|fold|0|h|0|0;1|r|return|60|-|0|0',
    boards: ['6s3h5d9dAs'],
    seat: 6,
    ord: 20,
    hole: '3sQs6dAd2h',
    pot: 179,
    bet: 60,
    min: 120,
    max: 299,
    seats: [
      [1, 1615.15, 60, 105, 0, 0, 0],
      [2, 391, 0, 9, 0, 0, 1],
      [3, 723.5, 0, 9, 0, 0, 1],
      [4, 373.7, 0, 9, 0, 0, 1],
      [6, 472.1, 0, 47, 2, 0, 0],
    ],
  },
  {
    n: 59407493,
    held: 'set, three-flush board',
    best: true,
    pl: '1H 2H 3H 4H 5H 6P',
    dealer: 1,
    a: '2|p|sb|1|f|0|0;3|p|bb|2|f|0|0;3|p|ante|2|f|0|1;4|p|fold|0|h|0|0;5|p|call|2|h|0|0;6|p|raise|11|p|1|0;1|p|raise|40|h|1|0;2|p|fold|0|h|0|0;3|p|fold|0|h|0|0;5|p|fold|0|h|0|0;6|p|call|29|p|0|0;6|f|check|0|p|0|0;1|f|bet|38|h|1|0;6|f|call|38|p|0|0;6|t|check|0|p|0|0;1|t|bet|44|h|1|0;6|t|raise|125|p|1|0;1|t|call|81|h|0|0;6|r|bet|211|p|1|0;1|r|fold|0|h|0|0;6|r|return|211|-|0|0',
    boards: ['Kh9h2sJh3c'],
    seat: 1,
    ord: 20,
    hole: '8h9c9sJsAc',
    pot: 624,
    bet: 211,
    min: 422,
    max: 1046,
    seats: [
      [1, 1363.23, 0, 203, 0, 0, 0],
      [2, 655.45, 0, 1, 0, 0, 1],
      [3, 816.5, 0, 4, 2, 0, 1],
      [4, 400, 0, 0, 0, 0, 1],
      [5, 1175, 0, 2, 0, 0, 1],
      [6, 763.45, 211, 414, 0, 0, 0],
    ],
  },
  {
    n: 59437205,
    held: 'two pair',
    best: false,
    pl: '1P 2H 3H 4H 5H 6H',
    dealer: 6,
    a: '1|p|sb|1|f|0|0;2|p|bb|2|f|0|0;2|p|ante|2|f|0|1;3|p|call|2|h|0|0;4|p|call|2|h|0|0;5|p|call|2|h|0|0;6|p|call|2|h|0|0;1|p|raise|16|p|1|0;2|p|call|14|h|0|0;3|p|call|14|h|0|0;4|p|call|14|h|0|0;5|p|fold|0|h|0|0;6|p|call|14|h|0|0;1|f|check|0|p|0|0;2|f|check|0|h|0|0;3|f|check|0|h|0|0;4|f|check|0|h|0|0;6|f|check|0|h|0|0;1|t|bet|84|p|1|0;2|t|fold|0|h|0|0;3|t|fold|0|h|0|0;4|t|fold|0|h|0|0;6|t|call|84|h|0|0;1|r|bet|126|p|1|0;6|r|fold|0|h|0|0;1|r|return|126|-|0|0',
    boards: ['Ac8h7sQcKd'],
    seat: 6,
    ord: 25,
    hole: 'Jc4cKhQh8c',
    pot: 378,
    bet: 126,
    min: 252,
    max: 546.85,
    seats: [
      [1, 3229.83, 126, 226, 0, 0, 0],
      [2, 1248.2, 0, 18, 2, 0, 1],
      [3, 1119.7, 0, 16, 0, 0, 1],
      [4, 1148.6, 0, 16, 0, 0, 1],
      [5, 916.15, 0, 2, 0, 0, 1],
      [6, 546.85, 0, 100, 0, 0, 0],
    ],
  },
  {
    n: 59438949,
    held: 'two pair, paired board',
    best: false,
    pl: '1P 2H 3H 4H 5H 6H',
    dealer: 4,
    a: '5|p|sb|1|f|0|0;6|p|bb|2|f|0|0;6|p|ante|2|f|0|1;1|p|raise|9|p|1|0;2|p|raise|32|h|1|0;3|p|fold|0|h|0|0;4|p|fold|0|h|0|0;5|p|fold|0|h|0|0;6|p|fold|0|h|0|0;1|p|call|23|p|0|0;1|f|check|0|p|0|0;2|f|bet|20|h|1|0;1|f|call|20|p|0|0;1|t|check|0|p|0|0;2|t|bet|92|h|1|0;1|t|call|92|p|0|0;1|r|bet|147|p|1|0;2|r|fold|0|h|0|0;1|r|return|147|-|0|0',
    boards: ['ThAh8dJcJs'],
    seat: 2,
    ord: 18,
    hole: '9s6c8cAs6d',
    pot: 440,
    bet: 147,
    min: 294,
    max: 322.2,
    seats: [
      [1, 2321.93, 147, 291, 0, 0, 0],
      [2, 322.2, 0, 144, 0, 0, 0],
      [3, 2053.4, 0, 0, 0, 0, 1],
      [4, 1176.1, 0, 0, 0, 0, 1],
      [5, 962.65, 0, 1, 0, 0, 1],
      [6, 503.25, 0, 4, 2, 0, 1],
    ],
  },
  {
    n: 59446815,
    held: 'set, four-straight board',
    best: true,
    pl: '1P 2H 3H 4H 5H 6H',
    dealer: 4,
    a: '5|p|sb|1|f|0|0;6|p|bb|2|f|0|0;6|p|ante|2|f|0|1;1|p|raise|9|p|1|0;2|p|call|9|h|0|0;3|p|raise|41|h|1|0;4|p|fold|0|h|0|0;5|p|fold|0|h|0|0;6|p|fold|0|h|0|0;1|p|call|32|p|0|0;2|p|call|32|h|0|0;1|f|check|0|p|0|0;2|f|check|0|h|0|0;3|f|check|0|h|0|0;1|t|bet|128|p|1|0;2|t|call|128|h|0|0;3|t|fold|0|h|0|0;1|r|bet|222|p|1|0;2|r|fold|0|h|0|0;1|r|return|222|-|0|0',
    boards: ['2d4c3hTd5c'],
    seat: 2,
    ord: 19,
    hole: 'ThTc7s2sJh',
    pot: 606,
    bet: 222,
    min: null,
    max: null,
    seats: [
      [1, 532.76, 222, 391, 0, 0, 0],
      [2, 228.25, 0, 169, 0, 0, 0],
      [3, 1643.85, 0, 41, 0, 0, 1],
      [4, 1992.4, 0, 0, 0, 0, 1],
      [5, 1078.45, 0, 1, 0, 0, 1],
      [6, 508.97, 0, 4, 2, 0, 1],
    ],
  },
  {
    n: 59455656,
    held: 'two pair',
    best: false,
    pl: '1P 2H 4H 5H 6H',
    dealer: 6,
    a: '1|p|sb|1|f|0|0;2|p|bb|2|f|0|0;2|p|ante|2|f|0|1;4|p|raise|8|h|1|0;5|p|call|8|h|0|0;6|p|raise|37|h|1|0;1|p|call|36|p|0|0;2|p|fold|0|h|0|0;4|p|call|29|h|0|0;5|p|call|29|h|0|0;1|f|check|0|p|0|0;4|f|check|0|h|0|0;5|f|check|0|h|0|0;6|f|bet|41|h|1|0;1|f|call|41|p|0|0;4|f|call|41|h|0|0;5|f|fold|0|h|0|0;1|t|bet|101|p|1|0;4|t|fold|0|h|0|0;6|t|call|101|h|0|0;1|r|bet|239|p|1|0;6|r|fold|0|h|0|0;1|r|return|239|-|0|0',
    boards: ['Ks8dQsJc3d'],
    seat: 6,
    ord: 22,
    hole: '9d4s8cAcKd',
    pot: 716,
    bet: 239,
    min: 478,
    max: 1159.2,
    seats: [
      [1, 2842.02, 239, 418, 0, 0, 0],
      [2, 2002.95, 0, 4, 2, 0, 1],
      [4, 598.65, 0, 78, 0, 0, 1],
      [5, 363, 0, 37, 0, 0, 1],
      [6, 1159.2, 0, 179, 0, 0, 0],
    ],
  },
  {
    n: 59458558,
    held: 'trips, paired board',
    best: true,
    pl: '1P 2H 3H 4H 5H 6H',
    dealer: 3,
    a: '4|p|sb|1|f|0|0;5|p|bb|2|f|0|0;5|p|ante|2|f|0|1;6|p|fold|0|h|0|0;1|p|raise|9|p|1|0;2|p|raise|32|h|1|0;3|p|fold|0|h|0|0;4|p|fold|0|h|0|0;5|p|fold|0|h|0|0;1|p|raise|101|p|1|0;2|p|call|69|h|0|0;1|f|bet|104|p|1|0;2|f|call|104|h|0|0;1|t|bet|312|p|1|0;2|t|call|312|h|0|0;1|r|bet|581|p|1|0;2|r|fold|0|h|0|0;1|r|return|581|-|0|0',
    boards: ['3s8d9h4c4h'],
    seat: 2,
    ord: 17,
    hole: 'Qh4dQs5cJh',
    pot: 1620,
    bet: 581,
    min: 1162,
    max: 2113.95,
    seats: [
      [1, 1084.37, 581, 1098, 0, 0, 0],
      [2, 2113.95, 0, 517, 0, 0, 0],
      [3, 766.5, 0, 0, 0, 0, 1],
      [4, 1136.3, 0, 1, 0, 0, 1],
      [5, 1001.15, 0, 4, 2, 0, 1],
      [6, 829.9, 0, 0, 0, 0, 1],
    ],
  },
  {
    n: 59467641,
    held: 'two pair',
    best: false,
    pl: '1P 2H 3H 4H 5H 6H',
    dealer: 4,
    a: '5|p|sb|1|f|0|0;6|p|bb|2|f|0|0;6|p|ante|2|f|0|1;1|p|raise|9|p|1|0;2|p|call|9|h|0|0;3|p|raise|41|h|1|0;4|p|call|41|h|0|0;5|p|call|40|h|0|0;6|p|fold|0|h|0|0;1|p|call|32|p|0|0;2|p|fold|0|h|0|0;5|f|check|0|h|0|0;1|f|check|0|p|0|0;3|f|bet|40|h|1|0;4|f|fold|0|h|0|0;5|f|call|40|h|0|0;1|f|call|40|p|0|0;5|t|check|0|h|0|0;1|t|check|0|p|0|0;3|t|check|0|h|0|0;5|r|check|0|h|0|0;1|r|bet|149|p|1|0;3|r|fold|0|h|0|0;5|r|fold|0|h|0|0;1|r|return|149|-|0|0',
    boards: ['7sQc2d8s6c'],
    seat: 5,
    ord: 24,
    hole: 'Ad2s7dTdAc',
    pot: 446,
    bet: 149,
    min: 298,
    max: 687.5,
    seats: [
      [1, 1797.17, 149, 230, 0, 0, 0],
      [2, 1076.4, 0, 9, 0, 0, 1],
      [3, 1156.2, 0, 81, 0, 0, 1],
      [4, 790.6, 0, 41, 0, 0, 1],
      [5, 687.5, 0, 81, 0, 0, 0],
      [6, 705.15, 0, 4, 2, 0, 1],
    ],
  },
  {
    n: 59480782,
    held: 'flush, paired board',
    best: true,
    pl: '1P 2H 3H 4H 5H 6H',
    dealer: 3,
    a: '4|p|sb|1|f|0|0;5|p|bb|2|f|0|0;5|p|ante|2|f|0|1;6|p|raise|8|h|1|0;1|p|raise|29|p|1|0;2|p|fold|0|h|0|0;3|p|call|29|h|0|0;4|p|fold|0|h|0|0;5|p|fold|0|h|0|0;6|p|fold|0|h|0|0;1|f|bet|54|p|1|0;3|f|call|54|h|0|0;1|t|bet|179|p|1|0;3|t|call|179|h|0|0;1|r|bet|311|p|1|0;3|r|fold|0|h|0|0;1|r|return|311|-|0|0',
    boards: ['Jd8hQc6hQh'],
    seat: 3,
    ord: 16,
    hole: 'JcAcAhKh2s',
    pot: 848,
    bet: 311,
    min: null,
    max: null,
    seats: [
      [1, 2336.37, 311, 573, 0, 0, 0],
      [2, 1478.2, 0, 0, 0, 0, 1],
      [3, 306.5, 0, 262, 0, 0, 0],
      [4, 320.3, 0, 1, 0, 0, 1],
      [5, 396, 0, 4, 2, 0, 1],
      [6, 767, 0, 8, 0, 0, 1],
    ],
  },
  {
    n: 59484612,
    held: 'two pair, three-flush board',
    best: false,
    pl: '1P 2H 3H 4H 5H',
    dealer: 1,
    a: '2|p|sb|1|f|0|0;3|p|bb|2|f|0|0;3|p|ante|2|f|0|1;4|p|call|2|h|0|0;5|p|fold|0|h|0|0;1|p|raise|11|p|1|0;2|p|raise|36|h|1|0;3|p|fold|0|h|0|0;4|p|fold|0|h|0|0;1|p|call|25|p|0|0;2|f|bet|31|h|1|0;1|f|call|31|p|0|0;2|t|check|0|h|0|0;1|t|bet|70|p|1|0;2|t|call|70|h|0|0;2|r|check|0|h|0|0;1|r|bet|140|p|1|0;2|r|fold|0|h|0|0;1|r|return|140|-|0|0',
    boards: ['QdKc8c4c3d'],
    seat: 2,
    ord: 18,
    hole: '6sQhKhJc9s',
    pot: 420,
    bet: 140,
    min: 280,
    max: 303.5,
    seats: [
      [1, 3699.52, 140, 277, 0, 0, 0],
      [2, 303.5, 0, 137, 0, 0, 0],
      [3, 1194.47, 0, 4, 2, 0, 1],
      [4, 722, 0, 2, 0, 0, 1],
      [5, 1253, 0, 0, 0, 0, 1],
    ],
  },
  // Controls: one pair facing the same size, and a bet above 70% of the pot.
  {
    n: 59477667,
    held: 'one pair, paired board',
    best: true,
    pl: '1P 2H 3H 4H 5H 6H',
    dealer: 3,
    a: '4|p|sb|1|f|0|0;5|p|bb|2|f|0|0;5|p|ante|2|f|0|1;6|p|fold|0|h|0|0;1|p|raise|9|p|1|0;2|p|call|9|h|0|0;3|p|call|9|h|0|0;4|p|call|8|h|0|0;5|p|call|7|h|0|0;4|f|check|0|h|0|0;5|f|check|0|h|0|0;1|f|bet|47|p|1|0;2|f|fold|0|h|0|0;3|f|call|47|h|0|0;4|f|fold|0|h|0|0;5|f|fold|0|h|0|0;1|t|bet|141|p|1|0;3|t|call|141|h|0|0;1|r|bet|212|p|1|0;3|r|fold|0|h|0|0;1|r|return|212|-|0|0',
    boards: ['Kc7dTh4h4s'],
    seat: 3,
    ord: 20,
    hole: 'Ah5cQd9cJd',
    pot: 635,
    bet: 212,
    min: null,
    max: null,
    seats: [
      [1, 2349.02, 212, 409, 0, 0, 0],
      [2, 1499.1, 0, 9, 0, 0, 1],
      [3, 203, 0, 197, 0, 0, 0],
      [4, 1582.1, 0, 9, 0, 0, 1],
      [5, 580.15, 0, 11, 2, 0, 1],
      [6, 1754.7, 0, 0, 0, 0, 1],
    ],
  },
  {
    n: 59422360,
    held: 'trips, double-paired board, 85% pot bet',
    best: false,
    pl: '1H 2H 3H 4H 5H 6P',
    dealer: 6,
    a: '1|p|sb|1|f|0|0;2|p|bb|2|f|0|0;2|p|ante|2|f|0|1;3|p|call|2|h|0|0;4|p|raise|10|h|1|0;5|p|call|10|h|0|0;6|p|call|10|p|0|0;1|p|call|9|h|0|0;2|p|call|8|h|0|0;3|p|call|8|h|0|0;1|f|check|0|h|0|0;2|f|check|0|h|0|0;3|f|check|0|h|0|0;4|f|check|0|h|0|0;5|f|check|0|h|0|0;6|f|bet|62|p|1|0;1|f|call|62|h|0|0;2|f|fold|0|h|0|0;3|f|fold|0|h|0|0;4|f|fold|0|h|0|0;5|f|call|62|h|0|0;1|t|check|0|h|0|0;5|t|check|0|h|0|0;6|t|bet|124|p|1|0;1|t|call|124|h|0|0;5|t|fold|0|h|0|0;1|r|check|0|h|0|0;6|r|bet|424|p|1|0;1|r|fold|0|h|0|0;6|r|return|424|-|0|0',
    boards: ['9s2c9d3s2h'],
    seat: 1,
    ord: 29,
    hole: '5hTc9hQh4s',
    pot: 920,
    bet: 424,
    min: 848,
    max: 947.7,
    seats: [
      [1, 947.7, 0, 196, 0, 0, 0],
      [2, 420.5, 0, 12, 2, 0, 1],
      [3, 523.2, 0, 10, 0, 0, 1],
      [4, 796.5, 0, 10, 0, 0, 1],
      [5, 422.5, 0, 72, 0, 0, 1],
      [6, 3126.75, 424, 620, 0, 0, 0],
    ],
  },
];

const SUITS: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const STAGES: Record<string, string> = { p: 'preflop', f: 'flop', t: 'turn', r: 'river' };
const ORIGINS: Record<string, string> = { f: 'forced', h: 'horse_policy', p: 'player' };

export const cardsOf = (text: string): Card[] =>
  (text.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUITS[x[1]] }));

/** The table's recorded rake and jackpot rules (identical on every hand here). */
const DEDUCTIONS = {
  bbj: { feeBB: 0.25, enabled: true, minPotBB: 10, minPlayersDealt: 3 },
  rake: {
    cap: 5,
    percent: 10,
    noFlopNoDrop: true,
    playerCountCaps: [
      [2, 2.5],
      [3, 5],
      [4, 5],
    ],
  },
  rules: 'controller-rake-bbj-v1',
  status: 'captured',
  version: 1,
};

/** A recorded fold as a complaint fixture plus the node of the fold. */
export function expand(r: RecordedRiverFold): { fx: ComplaintFixture; node: ComplaintAction } {
  const actions: ComplaintAction[] = r.a.split(';').map((row, i) => {
    const [seat, stage, action, amount, origin, full, dead] = row.split('|');
    return {
      ord: i + 1,
      seat: Number(seat),
      stage: STAGES[stage],
      action,
      amount: Number(amount),
      ...(ORIGINS[origin] ? { origin: ORIGINS[origin] } : {}),
      isFullRaise: full === '1',
      dead: dead === '1',
    };
  });
  const node = actions.find((x) => x.ord === r.ord)!;
  if (node.seat !== r.seat || node.action !== 'fold' || node.stage !== 'river')
    throw new Error(`hand ${r.n}: action ${r.ord} is not the recorded river fold`);
  node.publicNode = {
    pot: r.pot,
    ante: 2,
    anteType: 'big_blind',
    mode: 'cash',
    asset: 'chips',
    seats: r.seats,
    boards: r.boards,
    street: 'river',
    toCall: r.bet,
    currentBet: r.bet,
    minRaiseTo: r.min,
    maxRaiseTo: r.max,
    legalActions: r.max === null ? ['fold', 'call', 'all_in'] : ['fold', 'call', 'raise', 'all_in'],
    dealerSeat: r.dealer,
    chipUnit: 0.01,
    bigBlind: 2,
    smallBlind: 1,
    variant: 'plo5',
    structure: 'pot_limit',
    actorSeat: r.seat,
    bombPot: r.bomb === true,
    boardCount: r.boards.length,
    allInOrFold: false,
    fixedBetSize: null,
    wagersCapped: false,
    vpipFloor: 50,
    vpipWindowHands: 30,
    deductions: DEDUCTIONS,
  } as unknown as ComplaintPublicNode;
  const fx: ComplaintFixture = {
    version: 1,
    slug: `plo5-river-fold-${r.n}`,
    title: `PLO5 River Fold, Hand ${r.n}`,
    complaint: 'A Horse folded a strong made hand on the river to a bet of about half the pot',
    handId: String(r.n),
    fmt: 'cash',
    variant: 'plo5',
    players: r.pl.split(' ').map((p) => ({ seat: Number(p[0]), isHorse: p[1] === 'H' })),
    hole: { [String(r.seat)]: cardsOf(r.hole) },
    actions,
    forbidden: [{ ord: r.ord, kind: 'fold' }],
    seeds: [],
  };
  return { fx, node };
}
