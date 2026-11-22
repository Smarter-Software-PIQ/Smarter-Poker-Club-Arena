/**
 * The audit E fixtures (decisions.csv rows, hand id prefix as the key), rebuilt by buildSpot. Each states the
 * row it answers and the public action chosen to reproduce that row's numbers.
 */
import type { SpotSpec } from './AHoldemTournamentAllInCallIsPriced.fixtures.js';

const NINE = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const EIGHT = [1, 2, 3, 4, 5, 6, 7, 8];
const fill = (seats: number[], chips: number, set: Record<number, number>) =>
  Object.fromEntries(seats.map((s) => [s, set[s] ?? chips]));
const foldAll = (seats: number[]) => seats.map((s) => [s, 'fold', 0] as const);

export interface AuditCase {
  row: string;
  spec: SpotSpec;
  /** The audit's verdict for the row: the action that is right by its price. */
  best: 'call' | 'fold';
}

export const AUDIT_CASES: Record<string, AuditCase> = {
  // da2d1f44 EP1 88, 15bb, bb 200, nine dealt, 569 left / 89 paid (bounty-only Free Buy): opened 2.2bb, a
  // 15bb re-jam behind; pot 19.7bb, call 12.8bb; audit equity 0.53 against a price of 0.36: CLEAR fold.
  da2d1f44: {
    row: 'da2d1f44 preflop EP1 8c8h fold, eq 0.53 req 0.36, loss 5.87bb CLEAR PF_FOLD_VS_JAM_TOO_TIGHT',
    best: 'call',
    spec: {
      bb: 200,
      seats: NINE,
      dealer: 9,
      hero: 3,
      heroCards: '8c8h',
      stacks: fill(NINE, 4000, { 3: 3000, 7: 3000 }),
      streets: {
        preflop: [
          [3, 'raise', 440],
          ...foldAll([4, 5, 6]),
          [7, 'all_in', 0],
          ...foldAll([8, 9, 1, 2]),
        ],
      },
      playersLeft: 569,
      spotsPaid: 89,
    },
  },
  // 95b1c217 EP1 AJs, 13bb, bb 600, eight dealt, 47 left / 9 paid: opened 2.2bb, a re-jam behind that covers;
  // call 10.8bb (the audit's pot of 20.79bb holds 3.09bb this rebuild does not; its pot is 17.7bb, a worse
  // price for the call); audit equity 0.56 against 0.38: CLEAR fold.
  '95b1c217': {
    row: '95b1c217 preflop EP1 AcJc fold, eq 0.56 req 0.38, loss 5.18bb CLEAR PF_FOLD_VS_JAM_TOO_TIGHT',
    best: 'call',
    spec: {
      bb: 600,
      seats: EIGHT,
      dealer: 8,
      hero: 3,
      heroCards: 'AcJc',
      stacks: fill(EIGHT, 12000, { 3: 7800, 6: 9000 }),
      streets: {
        preflop: [
          [3, 'raise', 1320],
          ...foldAll([4, 5]),
          [6, 'all_in', 0],
          ...foldAll([7, 8, 1, 2]),
        ],
      },
      playersLeft: 47,
      spotsPaid: 9,
    },
  },
  // 1b51e45d LJ 55, 15.98bb, bb 200, eight dealt, 345 left / 65 paid: opened 2.2bb, a covering re-jam from
  // the button; pot 20.68bb, call 13.78bb; audit equity 0.45 against 0.34: CLEAR fold.
  '1b51e45d': {
    row: '1b51e45d preflop LJ 5h5d fold, eq 0.45 req 0.34, loss 4.64bb CLEAR PF_FOLD_VS_JAM_TOO_TIGHT',
    best: 'call',
    spec: {
      bb: 200,
      seats: EIGHT,
      dealer: 8,
      hero: 5,
      heroCards: '5h5d',
      stacks: fill(EIGHT, 4000, { 5: 3196, 8: 5000 }),
      streets: {
        preflop: [
          [3, 'fold', 0],
          [4, 'fold', 0],
          [5, 'raise', 440],
          ...foldAll([6, 7]),
          [8, 'all_in', 0],
          ...foldAll([1, 2]),
        ],
      },
      playersLeft: 345,
      spotsPaid: 65,
    },
  },
  // d325481d LJ 66, committed: 12.5bb, bb 600, eight dealt, 461 left / 83 paid: the Horse 3-bet to 11.69bb
  // over an open, a 30bb jam and the opener's all-in call behind it; 0.81bb left to call into about 64bb;
  // audit equity 0.26 against 0.02 (committed share 0.94): CLEAR fold, PF_FOLD_AFTER_COMMITTING.
  d325481d: {
    row: 'd325481d preflop LJ 6d6c fold, eq 0.26 req 0.02, loss 12.77bb CLEAR PF_FOLD_AFTER_COMMITTING',
    best: 'call',
    spec: {
      bb: 600,
      seats: EIGHT,
      dealer: 8,
      hero: 5,
      heroCards: '6d6c',
      stacks: fill(EIGHT, 12000, { 3: 12000, 5: 7500, 7: 18000 }),
      streets: {
        preflop: [
          [3, 'raise', 1500],
          [4, 'fold', 0],
          [5, 'raise', 7014],
          [6, 'fold', 0],
          [7, 'all_in', 0],
          ...foldAll([8, 1, 2]),
          [3, 'all_in', 0],
        ],
      },
      playersLeft: 461,
      spotsPaid: 83,
    },
  },
  // All-In-Or-Fold Afternoon Free Buy, the big blind facing a lone jam (the closing seat).
  // 475e2de7 BB TsKs 6.8bb, bb 250, eight dealt, 414 left / 64 paid: call 5.8bb into 9.3bb; 0.51 against 0.38.
  '475e2de7': {
    row: '475e2de7 preflop BB TsKs fold (All-In-Or-Fold), eq 0.51 req 0.38, loss 1.91bb CLEAR',
    best: 'call',
    spec: {
      bb: 250,
      seats: EIGHT,
      dealer: 8,
      hero: 2,
      heroCards: 'TsKs',
      stacks: fill(EIGHT, 5000, { 2: 1700, 8: 3000 }),
      streets: { preflop: [...foldAll([3, 4, 5, 6, 7]), [8, 'all_in', 0], [1, 'fold', 0]] },
      aof: true,
      playersLeft: 414,
      spotsPaid: 64,
    },
  },
  // fbfdfc4a BB Ac7c 9.4bb, bb 250, nine dealt, 416 left / 64 paid: call 8.4bb into 11.9bb; 0.51 against 0.41.
  fbfdfc4a: {
    row: 'fbfdfc4a preflop BB Ac7c fold (All-In-Or-Fold), eq 0.51 req 0.41, loss 1.9bb CLEAR',
    best: 'call',
    spec: {
      bb: 250,
      seats: NINE,
      dealer: 9,
      hero: 2,
      heroCards: 'Ac7c',
      stacks: fill(NINE, 5000, { 2: 2350, 8: 4000 }),
      streets: {
        preflop: [...foldAll([3, 4, 5, 6, 7]), [8, 'all_in', 0], [9, 'fold', 0], [1, 'fold', 0]],
      },
      aof: true,
      playersLeft: 416,
      spotsPaid: 64,
    },
  },
  // 09bdb97c BB 8cTh 3.75bb, bb 200, eight dealt, 417 left / 64 paid: call 2.75bb into 6.25bb; 0.43 against 0.31.
  '09bdb97c': {
    row: '09bdb97c preflop BB 8cTh fold (All-In-Or-Fold), eq 0.43 req 0.31, loss 1.11bb CLEAR',
    best: 'call',
    spec: {
      bb: 200,
      seats: EIGHT,
      dealer: 8,
      hero: 2,
      heroCards: '8cTh',
      stacks: fill(EIGHT, 4000, { 2: 750, 7: 3000 }),
      streets: { preflop: [...foldAll([3, 4, 5, 6]), [7, 'all_in', 0], ...foldAll([8, 1])] },
      aof: true,
      playersLeft: 417,
      spotsPaid: 64,
    },
  },
  // 0f7c778b BTN TsKh on Td7cQc 9d (turn), bb 300, eight dealt, 58 left / 9 paid: a 3-bet pot, flop bet and
  // call, then a 32.39bb all-in into 30.11bb; audit equity 0.65 against 0.34: CLEAR fold, POST_POTODDS_FOLD_ALLIN.
  '0f7c778b': {
    row: '0f7c778b turn BTN TsKh fold facing all-in, eq 0.65 req 0.34, loss 29.08bb CLEAR',
    best: 'call',
    spec: {
      bb: 300,
      seats: EIGHT,
      dealer: 8,
      hero: 8,
      heroCards: 'TsKh',
      stacks: fill(EIGHT, 6000, { 2: 14007, 8: 18000 }),
      streets: {
        preflop: [
          ...foldAll([3, 4, 5, 6, 7]),
          [8, 'raise', 750],
          [1, 'fold', 0],
          [2, 'raise', 2700],
          [8, 'call', 0],
        ],
        flop: [
          [2, 'bet', 1590],
          [8, 'call', 0],
        ],
        turn: [[2, 'all_in', 0]],
      },
      board: 'Td7cQc9d',
      playersLeft: 58,
      spotsPaid: 9,
    },
  },
  // fb6eb2ec BTN Kd7d on 2dKsQh (flop), bb 50, nine dealt, 549 left / 83 paid: a 3-bet pot, then a 47.72bb
  // all-in into 36.52bb; audit equity 0.54 against 0.36: CLEAR fold, POST_POTODDS_FOLD_ALLIN.
  fb6eb2ec: {
    row: 'fb6eb2ec flop BTN Kd7d fold facing all-in, eq 0.54 req 0.36, loss 23.71bb CLEAR',
    best: 'call',
    spec: {
      bb: 50,
      seats: NINE,
      dealer: 3,
      hero: 3,
      heroCards: 'Kd7d',
      stacks: fill(NINE, 3000, { 3: 3600, 4: 3249 }),
      streets: {
        preflop: [
          ...foldAll([6, 7, 8, 9, 1, 2]),
          [3, 'raise', 125],
          [4, 'raise', 863],
          [5, 'fold', 0],
          [3, 'call', 0],
        ],
        flop: [[4, 'all_in', 0]],
      },
      board: '2dKsQh',
      playersLeft: 549,
      spotsPaid: 83,
    },
  },
  // 7a7125e8 heads-up turbo, big blind Qc5c on Th5d9s (flop), bb 50, winner take all: a 3bb all-in into 4bb;
  // audit equity 0.43 against 0.30: CLEAR fold, POST_POTODDS_FOLD_ALLIN.
  '7a7125e8': {
    row: '7a7125e8 flop BB Qc5c fold facing all-in (heads-up, winner take all), eq 0.43 req 0.30, loss 1.32bb CLEAR',
    best: 'call',
    spec: {
      bb: 50,
      seats: [1, 2],
      dealer: 1,
      hero: 2,
      heroCards: 'Qc5c',
      stacks: { 1: 225, 2: 500 },
      streets: {
        preflop: [
          [1, 'raise', 75],
          [2, 'call', 0],
        ],
        flop: [[1, 'all_in', 0]],
      },
      board: 'Th5d9s',
      playersLeft: 2,
      spotsPaid: 1,
    },
  },
  // 2b5b823c CO QhQd on AsAc3h9d6c (river), bb 400, nine dealt, 336 left / 51 paid: bet the flop and turn,
  // called twice, then faced a 12.5bb river bet into 21.44bb and called; audit equity 0.10 against 0.27:
  // CLEAR call, POST_CALL_TOO_LIGHT_RIVER.
  '2b5b823c': {
    row: '2b5b823c river CO QhQd call, eq 0.10 req 0.27, loss 8bb CLEAR POST_CALL_TOO_LIGHT_RIVER',
    best: 'fold',
    spec: {
      bb: 400,
      seats: NINE,
      dealer: 9,
      hero: 8,
      heroCards: 'QhQd',
      stacks: fill(NINE, 8000, { 8: 20000, 2: 24000 }),
      streets: {
        preflop: [
          ...foldAll([3, 4, 5, 6, 7]),
          [8, 'raise', 1000],
          ...foldAll([9, 1]),
          [2, 'call', 0],
        ],
        flop: [
          [2, 'check', 0],
          [8, 'bet', 800],
          [2, 'call', 0],
        ],
        turn: [
          [2, 'check', 0],
          [8, 'bet', 2188],
          [2, 'call', 0],
        ],
        river: [[2, 'bet', 5000]],
      },
      board: 'AsAc3h9d6c',
      playersLeft: 336,
      spotsPaid: 51,
    },
  },
};
