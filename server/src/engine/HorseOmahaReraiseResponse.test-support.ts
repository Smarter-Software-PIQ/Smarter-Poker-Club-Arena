/**
 * The vectors on which the engine reducer of the re-raise response record and its database twin must agree
 * (scripts/ci/fixtures/horse-reraise-response-vectors.json; written by
 * server/scripts/generate-horse-reraise-response-vectors.ts, checked by HorseOmahaReraiseResponse.test.ts and by
 * scripts/ci/test-horse-exact-public-memory.py). Deterministic; no cards anywhere.
 */
import type { ExploitHandAction } from './HorseOpponentExploit.js';
import {
  addReraiseResponseEvidence,
  emptyReraiseResponse,
  reraiseResponseHandIncrements,
  reraiseResponseRow,
  type ReraiseResponseCounters,
} from './HorseOmahaReraiseResponse.js';

export type ReraiseVectorAction = Record<string, unknown>;
const A = '00000000-0000-4000-8000-0000000000a1';
const B = '00000000-0000-4000-8000-0000000000a2';
const C = '00000000-0000-4000-8000-0000000000a3';
const act = (
  userId: string,
  action: string,
  extra: Record<string, unknown> = {}
): ReraiseVectorAction => ({ userId, stage: 'preflop', action, origin: 'player', ...extra });

/** What the engine computes for one public action log: per player, the 8 numbers of his row. */
export function engineReraiseResponseIncrements(
  actions: readonly ReraiseVectorAction[]
): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const [id, r] of reraiseResponseHandIncrements(actions as unknown as ExploitHandAction[]))
    out[id] = reraiseResponseRow(r);
  return out;
}

/** The compact log of the random vectors: `uid,stage,action,origin,full` tokens, `-` for an absent field. */
export function decodeReraiseResponseLog(log: string): ReraiseVectorAction[] {
  const out: ReraiseVectorAction[] = [];
  for (const token of log.split(' ')) {
    if (!token) continue;
    const [uid, stage, action, origin, full] = token.split(',');
    const a: ReraiseVectorAction = { stage, action };
    if (uid !== '-') a.userId = uid;
    if (origin !== '-') a.origin = origin;
    if (full !== '-') a.isFullRaise = full === '1';
    out.push(a);
  }
  return out;
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const RERAISE_VECTOR_NAMED: { name: string; actions: ReraiseVectorAction[] }[] = [
  {
    name: 'a 3-bettor is 4-bet and calls',
    actions: [act(A, 'raise'), act(B, 'raise'), act(A, 'raise'), act(B, 'call')],
  },
  {
    name: 'a 3-bettor is 4-bet and folds',
    actions: [act(A, 'raise'), act(B, 'raise'), act(C, 'raise'), act(A, 'fold'), act(B, 'fold')],
  },
  {
    name: 'a 3-bettor is 4-bet and 5-bets; the 4-bettor then calls the 5-bet',
    actions: [act(A, 'raise'), act(B, 'raise'), act(A, 'raise'), act(B, 'raise'), act(A, 'call')],
  },
  {
    name: 'a full-raise all-in is a raise; an all-in that is not a full raise is a call',
    actions: [
      act(A, 'raise'),
      act(B, 'raise'),
      act(A, 'all_in', { isFullRaise: true }),
      act(B, 'all_in', { isFullRaise: false }),
    ],
  },
  {
    name: 'two raises come back to the 3-bettor: a different spot, not counted',
    actions: [act(A, 'raise'), act(B, 'raise'), act(C, 'raise'), act(A, 'raise'), act(B, 'fold')],
  },
  {
    name: 'an opener who is 3-bet is not a re-raiser; a single raised pot has no opportunity',
    actions: [act(A, 'raise'), act(B, 'raise'), act(A, 'call')],
  },
  {
    name: 'an unattributed fold and a forced action are not admitted; the flop is not read',
    actions: [
      act(A, 'raise'),
      act(B, 'raise'),
      act(A, 'raise'),
      act(B, 'fold', { origin: 'timeout' }),
      act(B, 'call', { origin: 'forced' }),
      { userId: B, stage: 'flop', action: 'fold', origin: 'player' },
    ],
  },
  {
    name: 'hole cards in the log change nothing',
    actions: [
      act(A, 'raise', { holeCards: ['Aspades', 'Ahearts'] }),
      act(B, 'raise'),
      act(A, 'raise'),
      act(B, 'call'),
    ],
  },
];

export interface ReraiseResponseVectors {
  _comment: string;
  named: { name: string; actions: ReraiseVectorAction[]; expected: Record<string, number[]> }[];
  random: { log: string; expected: Record<string, number[]> }[];
  chain: { steps: string[]; checkpoints: { after: number; row: number[] | null }[] };
}

export function buildReraiseResponseVectors(): ReraiseResponseVectors {
  const named = RERAISE_VECTOR_NAMED.map((v) => ({
    ...v,
    expected: engineReraiseResponseIncrements(v.actions),
  }));
  const rnd = rng(20261118);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
  const uids = ['a0', 'a1', 'a2', 'a0', 'a1', 'a2', 'a3', '-'];
  const stages = [...Array<string>(11).fill('preflop'), 'flop'];
  const actionsOf = [
    ...Array<string>(8).fill('raise'),
    'call',
    'call',
    'fold',
    'fold',
    'all_in',
    'all_in',
    'bet',
    'check',
    'sb',
  ];
  const origins = [
    ...Array<string>(9).fill('player'),
    'horse_policy',
    'pre_action',
    'forced',
    'timeout',
    '-',
  ];
  const fulls = ['-', '-', '1', '0'];
  const random = Array.from({ length: 240 }, () => {
    const n = 3 + Math.floor(rnd() * 10);
    const log = Array.from({ length: n }, () =>
      [pick(uids), pick(stages), pick(actionsOf), pick(origins), pick(fulls)].join(',')
    ).join(' ');
    return { log, expected: engineReraiseResponseIncrements(decodeReraiseResponseLog(log)) };
  });
  // The add rule through a chain of 120 hands: each step is one hand's increments for one player as 8 digits
  // (opp, fold, call, raise of each node); a node with an opportunity has exactly one answer.
  const steps: string[] = [];
  const checkpoints: { after: number; row: number[] | null }[] = [];
  let row: ReraiseResponseCounters | null = null;
  for (let k = 1; k <= 120; k++) {
    const node = (): string => {
      if (rnd() < 0.55) return '0000';
      const ans = Math.floor(rnd() * 3);
      return '1' + [0, 1, 2].map((i) => (i === ans ? '1' : '0')).join('');
    };
    const digits = node() + node();
    steps.push(digits);
    const inc = emptyReraiseResponse();
    const d = [...digits].map(Number);
    inc.threeBetFacesFourBet = { opp: d[0], fold: d[1], call: d[2], raise: d[3] };
    inc.fourBetFacesFiveBet = { opp: d[4], fold: d[5], call: d[6], raise: d[7] };
    row = addReraiseResponseEvidence(row, inc);
    if (k % 10 === 0 || k <= 3)
      checkpoints.push({ after: k, row: row ? reraiseResponseRow(row) : null });
  }
  return {
    _comment:
      'Engine/database parity vectors of the re-raise response record (HorseOmahaReraiseResponse; migration 20261118023000). expected = the engine. Written by server/scripts/generate-horse-reraise-response-vectors.ts; do not edit by hand. No cards are read by either reducer.',
    named,
    random,
    chain: { steps, checkpoints },
  };
}
