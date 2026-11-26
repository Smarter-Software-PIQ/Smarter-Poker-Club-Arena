/**
 * The vectors on which the engine reducer of the postflop bet record and its database twin must agree
 * (scripts/ci/fixtures/horse-postflop-bets-vectors.json; written by server/scripts/generate-horse-postflop-bets-vectors.ts,
 * checked by HorsePostflopBetRecord.test.ts and by scripts/ci/test-horse-exact-public-memory.py). Deterministic; no
 * hole card anywhere (the showdown entries carry only who showed, mucked and the shown hand's name).
 */
import {
  addPostflopBetEvidence,
  postflopBetHandIncrements,
  postflopBetsFromRow,
  postflopBetsRow,
  type PostflopBetAction,
  type PostflopBetCounters,
  type PostflopShowdownEntry,
} from './HorsePostflopBetRecord.js';

export type PostflopVectorAction = Record<string, unknown>;
const A = '00000000-0000-4000-8000-0000000000e1';
const B = '00000000-0000-4000-8000-0000000000e2';
const C = '00000000-0000-4000-8000-0000000000e3';
const act = (
  userId: string,
  stage: string,
  action: string,
  amount = 0,
  extra: Record<string, unknown> = {}
): PostflopVectorAction => ({ userId, stage, action, amount, origin: 'player', ...extra });

/** What the engine computes for one hand: per player, the 42 numbers of his row. */
export function enginePostflopBetIncrements(
  actions: readonly PostflopVectorAction[],
  showdown: readonly PostflopShowdownEntry[] | null
): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const [id, r] of postflopBetHandIncrements(
    actions as unknown as PostflopBetAction[],
    showdown
  ))
    out[id] = postflopBetsRow(r);
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

const blinds = (sb: string, bb: string) => [
  act(sb, 'preflop', 'sb', 1, { origin: 'forced' }),
  act(bb, 'preflop', 'bb', 2, { origin: 'forced' }),
];

export const POSTFLOP_VECTOR_NAMED: {
  name: string;
  actions: PostflopVectorAction[];
  showdown: PostflopShowdownEntry[] | null;
}[] = [
  {
    name: 'heads-up: A bets the river 3/4 pot, B calls, A shows high card (air)',
    actions: [
      ...blinds(A, B),
      act(A, 'preflop', 'call', 1),
      act(B, 'preflop', 'check'),
      act(B, 'flop', 'check'),
      act(A, 'flop', 'check'),
      act(B, 'turn', 'check'),
      act(A, 'turn', 'check'),
      act(B, 'river', 'check'),
      act(A, 'river', 'bet', 3),
      act(B, 'river', 'call', 3),
    ],
    showdown: [
      { user_id: A, mucked: false, hand_name: 'High Card' },
      { user_id: B, mucked: false, hand_name: 'Pair' },
    ],
  },
  {
    name: 'B raises A flop bet, A folds; turn bet by B called by nobody',
    actions: [
      ...blinds(A, B),
      act(A, 'preflop', 'raise', 6),
      act(B, 'preflop', 'call', 4),
      act(B, 'flop', 'check'),
      act(A, 'flop', 'bet', 6),
      act(B, 'flop', 'raise', 20),
      act(A, 'flop', 'fold'),
    ],
    showdown: null,
  },
  {
    name: 'three-way turn: A bets small, B calls (the bet of A is called; A folds later: not shown), C raises; river: B bets, C calls, B mucks',
    actions: [
      ...blinds(B, C),
      act(A, 'preflop', 'call', 2),
      act(B, 'preflop', 'call', 1),
      act(C, 'preflop', 'check'),
      act(B, 'flop', 'check'),
      act(C, 'flop', 'check'),
      act(A, 'flop', 'check'),
      act(B, 'turn', 'check'),
      act(C, 'turn', 'check'),
      act(A, 'turn', 'bet', 2),
      act(B, 'turn', 'call', 2),
      act(C, 'turn', 'raise', 10),
      act(A, 'turn', 'fold'),
      act(B, 'turn', 'call', 8),
      act(B, 'river', 'bet', 26),
      act(C, 'river', 'call', 26),
    ],
    showdown: [
      { user_id: C, mucked: false, hand_name: 'Two Pair' },
      { user_id: B, mucked: true },
    ],
  },
  {
    name: 'a forced fold and an unattributed fold teach nothing; a timeout fold is not learnable',
    actions: [
      ...blinds(A, B),
      act(A, 'preflop', 'call', 1),
      act(B, 'preflop', 'check'),
      act(B, 'flop', 'bet', 2),
      act(A, 'flop', 'fold', 0, { origin: 'timeout' }),
    ],
    showdown: null,
  },
];

export interface PostflopBetVectors {
  named: {
    name: string;
    actions: PostflopVectorAction[];
    showdown: unknown;
    expected: Record<string, number[]>;
  }[];
  random: {
    actions: PostflopVectorAction[];
    showdown: unknown;
    expected: Record<string, number[]>;
  }[];
  chain: { steps: number[][]; checkpoints: { after: number; row: number[] | null }[] };
}

export function buildPostflopBetVectors(): PostflopBetVectors {
  const named = POSTFLOP_VECTOR_NAMED.map(({ name, actions, showdown }) => ({
    name,
    actions,
    showdown,
    expected: enginePostflopBetIncrements(actions, showdown),
  }));
  const rnd = rng(20261125);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
  const ids = ['p0', 'p1', 'p2', 'p0', 'p1', '-'];
  const stages = ['preflop', 'flop', 'flop', 'turn', 'turn', 'river', 'river', 'river'];
  const acts = [
    'bet',
    'bet',
    'raise',
    'call',
    'call',
    'call',
    'check',
    'check',
    'fold',
    'all_in',
    'sb',
    'bb',
  ];
  const origins = [
    ...Array<string>(8).fill('player'),
    'horse_policy',
    'pre_action',
    'forced',
    'timeout',
    '-',
  ];
  const names = [
    'High Card',
    'high card',
    'HIGH CARD',
    'High Card',
    'Pair',
    'Two Pair',
    'Flush',
    7,
  ];
  const random = Array.from({ length: 300 }, () => {
    // streets in order, each a few actions, amounts small integers or fractions
    const n = 4 + Math.floor(rnd() * 14);
    let stageIdx = 0;
    const actions: PostflopVectorAction[] = [];
    for (let k = 0; k < n; k++) {
      if (rnd() < 0.3 && stageIdx < stages.length - 1) stageIdx += 1 + Math.floor(rnd() * 2);
      stageIdx = Math.min(stageIdx, stages.length - 1);
      const a: PostflopVectorAction = { stage: stages[stageIdx], action: pick(acts) };
      const uid = pick(ids);
      if (uid !== '-') a.userId = uid;
      const o = pick(origins);
      if (o !== '-') a.origin = o;
      if (rnd() < 0.9) a.amount = Math.round(rnd() * 40 * 4) / 4;
      if (a.action === 'all_in') a.isFullRaise = rnd() < 0.5;
      actions.push(a);
    }
    const showdown =
      rnd() < 0.2
        ? null
        : ['p0', 'p1', 'p2']
            .filter(() => rnd() < 0.85)
            .map((u) => {
              const e: Record<string, unknown> = { user_id: u };
              if (rnd() < 0.3) e.mucked = true;
              else {
                e.mucked = false;
                e.hand_name = pick(names);
              }
              return e;
            });
    return {
      actions,
      showdown,
      expected: enginePostflopBetIncrements(actions, showdown as PostflopShowdownEntry[] | null),
    };
  });
  // The add rule through a chain of 120 hands (rows of 42 numbers, each a valid one-hand increment).
  const steps: number[][] = [];
  const checkpoints: { after: number; row: number[] | null }[] = [];
  let row: PostflopBetCounters | null = null;
  for (let k = 1; k <= 120; k++) {
    const r = new Array<number>(42).fill(0);
    for (let s = 0; s < 3; s++)
      if (rnd() < 0.35) {
        r[2 * s] = 1;
        r[2 * s + 1] = rnd() < 0.3 ? 1 : 0;
      }
    if (rnd() < 0.3) {
      const cell = Math.floor(rnd() * 12);
      const shown = rnd() < 0.7 ? 1 : 0;
      r[6 + 3 * cell] = 1;
      r[6 + 3 * cell + 1] = shown;
      r[6 + 3 * cell + 2] = shown && rnd() < 0.4 ? 1 : 0;
    }
    steps.push(r);
    row = addPostflopBetEvidence(row, postflopBetsFromRow(r));
    if (k % 10 === 0 || k <= 3)
      checkpoints.push({ after: k, row: row ? postflopBetsRow(row) : null });
  }
  return { named, random, chain: { steps, checkpoints } };
}
