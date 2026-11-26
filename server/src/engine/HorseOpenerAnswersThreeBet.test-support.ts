/**
 * The vectors on which the engine reducer of the opener response record and its database twin must agree
 * (scripts/ci/fixtures/horse-opener-response-vectors.json; written by
 * server/scripts/generate-horse-opener-response-vectors.ts, checked by HorseOpenerAnswersThreeBet.test.ts and by
 * scripts/ci/test-horse-exact-public-memory.py). Deterministic; no cards anywhere.
 */
import {
  addOpenerResponseEvidence,
  emptyOpenerResponse,
  openerResponseHandIncrements,
  openerResponseRow,
  type OpenerResponseAction,
  type OpenerResponseCounters,
} from './HorseOpenerAnswersThreeBet.js';

export type OpenerVectorAction = Record<string, unknown>;
const A = '00000000-0000-4000-8000-0000000000b1';
const B = '00000000-0000-4000-8000-0000000000b2';
const C = '00000000-0000-4000-8000-0000000000b3';
const D = '00000000-0000-4000-8000-0000000000b4';
const act = (
  userId: string,
  action: string,
  extra: Record<string, unknown> = {}
): OpenerVectorAction => ({ userId, stage: 'preflop', action, origin: 'player', ...extra });
const post = (userId: string, action: 'sb' | 'bb', extra: Record<string, unknown> = {}) =>
  act(userId, action, { origin: 'forced', ...extra });

/** What the engine computes for one public action log: per player, the 8 numbers of his row. */
export function engineOpenerResponseIncrements(
  actions: readonly OpenerVectorAction[]
): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const [id, r] of openerResponseHandIncrements(actions as unknown as OpenerResponseAction[]))
    out[id] = openerResponseRow(r);
  return out;
}

/** The compact log of the random vectors: `uid,stage,action,origin,full,dead` tokens, `-` for an absent field. */
export function decodeOpenerResponseLog(log: string): OpenerVectorAction[] {
  const out: OpenerVectorAction[] = [];
  for (const token of log.split(' ')) {
    if (!token) continue;
    const [uid, stage, action, origin, full, dead] = token.split(',');
    const a: OpenerVectorAction = { stage, action };
    if (uid !== '-') a.userId = uid;
    if (origin !== '-') a.origin = origin;
    if (full !== '-') a.isFullRaise = full === '1';
    if (dead !== '-') a.dead = dead === '1';
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

/** Each named log with the cell it must produce for its opener (A), checked by the unit test before the fixture. */
export const OPENER_VECTOR_NAMED: {
  name: string;
  actions: OpenerVectorAction[];
  /** the opener's row, or null when the log gives nobody an opportunity */
  opener: number[] | null;
}[] = [
  {
    name: 'six-max: the cutoff opens, the big blind 3-bets, the cutoff calls in position',
    actions: [
      post(C, 'sb'),
      post(B, 'bb'),
      act(D, 'fold'),
      act(A, 'raise'),
      act(C, 'fold'),
      act(B, 'raise'),
      act(A, 'call'),
    ],
    opener: [1, 0, 1, 0, 0, 0, 0, 0],
  },
  {
    name: 'six-max: the small blind opens, the big blind 3-bets, the small blind 4-bets out of position',
    actions: [
      post(A, 'sb'),
      post(B, 'bb'),
      act(C, 'fold'),
      act(D, 'fold'),
      act(A, 'raise'),
      act(B, 'raise'),
      act(A, 'raise'),
    ],
    opener: [0, 0, 0, 0, 1, 0, 0, 1],
  },
  {
    name: 'six-max: the opener under the gun folds to the button 3-bet out of position',
    actions: [
      post(C, 'sb'),
      post(D, 'bb'),
      act(A, 'raise'),
      act(B, 'raise'),
      act(C, 'fold'),
      act(D, 'fold'),
      act(A, 'fold'),
    ],
    opener: [0, 0, 0, 0, 1, 1, 0, 0],
  },
  {
    name: 'heads-up with posts: the small blind (button) opens and calls the big blind 3-bet in position',
    actions: [post(A, 'sb'), post(B, 'bb'), act(A, 'raise'), act(B, 'raise'), act(A, 'call')],
    opener: [1, 0, 1, 0, 0, 0, 0, 0],
  },
  {
    name: 'heads-up without posts: the first actor is the small blind, in position',
    actions: [act(A, 'raise'), act(B, 'raise'), act(A, 'all_in', { isFullRaise: true })],
    opener: [1, 0, 0, 1, 0, 0, 0, 0],
  },
  {
    name: 'three-handed without posts: the last two first actors are the blinds; the button opener is in position',
    actions: [
      act(A, 'raise'),
      act(C, 'fold'),
      act(B, 'raise'),
      act(A, 'all_in', { isFullRaise: false }),
    ],
    opener: [1, 0, 1, 0, 0, 0, 0, 0],
  },
  {
    name: 'a 4-bet by a third player before the opener acts: not this spot',
    actions: [
      post(C, 'sb'),
      post(D, 'bb'),
      act(A, 'raise'),
      act(B, 'raise'),
      act(C, 'raise'),
      act(D, 'fold'),
      act(A, 'fold'),
    ],
    opener: null,
  },
  {
    name: 'a dead blind names nobody; an unattributed fold and a forced action are not admitted; the flop is not read',
    actions: [
      post(C, 'sb'),
      post(D, 'bb'),
      post(A, 'bb', { dead: true }),
      act(A, 'raise'),
      act(B, 'raise'),
      act(C, 'fold'),
      act(D, 'fold'),
      act(A, 'fold', { origin: 'timeout' }),
      act(A, 'call', { origin: 'forced' }),
      { userId: A, stage: 'flop', action: 'fold', origin: 'player' },
    ],
    opener: null,
  },
  {
    name: 'hole cards in the log change nothing',
    actions: [
      post(C, 'sb'),
      post(B, 'bb'),
      act(A, 'raise', { holeCards: ['Aspades', 'Ahearts'] }),
      act(C, 'fold'),
      act(B, 'raise'),
      act(A, 'call'),
    ],
    opener: [1, 0, 1, 0, 0, 0, 0, 0],
  },
];

export interface OpenerResponseVectors {
  _comment: string;
  named: { name: string; actions: OpenerVectorAction[]; expected: Record<string, number[]> }[];
  random: { log: string; expected: Record<string, number[]> }[];
  chain: { steps: string[]; checkpoints: { after: number; row: number[] | null }[] };
}

export function buildOpenerResponseVectors(): OpenerResponseVectors {
  const named = OPENER_VECTOR_NAMED.map(({ name, actions }) => ({
    name,
    actions,
    expected: engineOpenerResponseIncrements(actions),
  }));
  const rnd = rng(20261124);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
  const uids = ['b0', 'b1', 'b2', 'b3', 'b0', 'b1', 'b2', '-'];
  const stages = [...Array<string>(11).fill('preflop'), 'flop'];
  const actionsOf = [
    ...Array<string>(7).fill('raise'),
    'call',
    'call',
    'fold',
    'fold',
    'all_in',
    'all_in',
    'bet',
    'check',
    'sb',
    'bb',
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
  const deads = ['-', '-', '-', '0', '1'];
  const random = Array.from({ length: 260 }, () => {
    const n = 3 + Math.floor(rnd() * 10);
    const lead =
      rnd() < 0.5
        ? `${pick(uids)},preflop,sb,forced,-,${pick(deads)} ${pick(uids)},preflop,bb,forced,-,${pick(deads)} `
        : '';
    const log =
      lead +
      Array.from({ length: n }, () =>
        [pick(uids), pick(stages), pick(actionsOf), pick(origins), pick(fulls), pick(deads)].join(
          ','
        )
      ).join(' ');
    return { log, expected: engineOpenerResponseIncrements(decodeOpenerResponseLog(log)) };
  });
  // The add rule through a chain of 120 hands: each step is one hand's increments for one player as 8 digits
  // (opp, fold, call, raise of each cell); a hand gives at most one cell an opportunity, with exactly one answer.
  const steps: string[] = [];
  const checkpoints: { after: number; row: number[] | null }[] = [];
  let row: OpenerResponseCounters | null = null;
  for (let k = 1; k <= 120; k++) {
    const none = '0000';
    const one = (): string => {
      const ans = Math.floor(rnd() * 3);
      return '1' + [0, 1, 2].map((i) => (i === ans ? '1' : '0')).join('');
    };
    const u = rnd();
    const digits = u < 0.4 ? none + none : u < 0.7 ? one() + none : none + one();
    steps.push(digits);
    const inc = emptyOpenerResponse();
    const d = [...digits].map(Number);
    inc.inPosition = { opp: d[0], fold: d[1], call: d[2], raise: d[3] };
    inc.outOfPosition = { opp: d[4], fold: d[5], call: d[6], raise: d[7] };
    row = addOpenerResponseEvidence(row, inc);
    if (k % 10 === 0 || k <= 3)
      checkpoints.push({ after: k, row: row ? openerResponseRow(row) : null });
  }
  return {
    _comment:
      'Engine/database parity vectors of the opener response record (HorseOpenerAnswersThreeBet; migration 20261124195144). expected = the engine. Written by server/scripts/generate-horse-opener-response-vectors.ts; do not edit by hand. No cards are read by either reducer.',
    named,
    random,
    chain: { steps, checkpoints },
  };
}
