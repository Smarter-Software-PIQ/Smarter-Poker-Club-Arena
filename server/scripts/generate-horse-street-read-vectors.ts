/**
 * Writes scripts/ci/fixtures/horse-street-read-vectors.json: the hands on which the engine reducer
 * (HorseOmahaStreetRead.streetReadHandIncrements / addStreetReadEvidence) and the database reducer
 * (public.fn_horse_street_read_increments / fn_horse_street_read_add, migration 20261117175407) must agree.
 * `expected` is what the ENGINE computes; HorseOmahaStreetReadVectors.test.ts fails when the file and the engine
 * disagree, and scripts/ci/test-horse-exact-public-memory.py fails when the database and the file disagree.
 *
 * Run from server/:  npx tsx scripts/generate-horse-street-read-vectors.ts
 * Deterministic (seeded); running it twice writes the same content. Reads no database and no network.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  addStreetReadEvidence,
  streetReadRow,
  type StreetReadCounters,
} from '../src/engine/HorseOmahaStreetRead.js';
import {
  decodeStreetReadLog,
  engineStreetReadIncrements,
  type StreetReadVectorAction,
} from '../src/engine/HorseOmahaStreetRead.test-support.js';

const A = '00000000-0000-4000-8000-0000000000a1';
const B = '00000000-0000-4000-8000-0000000000a2';
const C = '00000000-0000-4000-8000-0000000000a3';
const act = (
  userId: string,
  stage: string,
  action: string,
  extra: Record<string, unknown> = {}
): StreetReadVectorAction => ({ userId, stage, action, origin: 'player', ...extra });
const RAINBOW = ['Kspades', '8hearts', '3clubs'];
const PAIRED = ['8spades', '8hearts', 'Qclubs', '2diamonds', '2clubs'];

const cbetHand = [
  act(A, 'preflop', 'raise'),
  act(B, 'preflop', 'call'),
  act(B, 'flop', 'check'),
  act(A, 'flop', 'bet'),
  act(B, 'flop', 'fold'),
];
interface Named {
  name: string;
  actions: unknown[];
  community_cards: unknown;
  community_cards2: unknown;
}
const named: Named[] = [
  {
    name: 'the last preflop raiser bets a rainbow flop and the caller folds',
    actions: cbetHand,
    community_cards: RAINBOW,
    community_cards2: null,
  },
  {
    name: 'the same hand with hole cards written on the actions: nothing changes',
    actions: cbetHand.map((a) => ({
      ...a,
      holeCards: ['Aspades', 'Ahearts', 'Kdiamonds', 'Kclubs'],
    })),
    community_cards: RAINBOW,
    community_cards2: null,
  },
  {
    name: 'a paired flop: the caller leads, so it is a flop bet and no continuation bet',
    actions: [
      act(A, 'preflop', 'raise'),
      act(B, 'preflop', 'call'),
      act(B, 'flop', 'bet'),
      act(A, 'flop', 'call'),
      act(B, 'turn', 'check'),
      act(A, 'turn', 'bet'),
      act(B, 'turn', 'call'),
      act(B, 'river', 'check'),
      act(A, 'river', 'check'),
    ],
    community_cards: PAIRED,
    community_cards2: null,
  },
  {
    name: 'a bettor who is raised and folds; several raises count one opportunity per cell',
    actions: [
      act(A, 'preflop', 'raise'),
      act(B, 'preflop', 'raise'),
      act(C, 'preflop', 'call'),
      act(A, 'preflop', 'call'),
      act(A, 'flop', 'check'),
      act(B, 'flop', 'bet'),
      act(C, 'flop', 'raise'),
      act(A, 'flop', 'call'),
      act(B, 'flop', 'raise'),
      act(C, 'flop', 'raise'),
      act(A, 'flop', 'fold'),
      act(B, 'flop', 'fold'),
    ],
    community_cards: ['Kspades', '8spades', '3clubs'],
    community_cards2: null,
  },
  {
    name: 'a forced fold, an unattributed fold and a forced check teach nothing; an all-in that is not a full raise is not a bet',
    actions: [
      act(A, 'preflop', 'raise'),
      act(B, 'preflop', 'call'),
      act(C, 'preflop', 'call'),
      act(B, 'flop', 'check', { origin: 'forced' }),
      act(C, 'flop', 'all_in', { isFullRaise: false }),
      act(A, 'flop', 'all_in', { isFullRaise: true }),
      act(B, 'flop', 'fold', { origin: 'forced' }),
      { userId: C, stage: 'flop', action: 'fold' },
    ],
    community_cards: ['Kspades', '8spades', '3spades'],
    community_cards2: null,
  },
  {
    name: 'a double-board hand with two different flops: the street cells are learned, no texture cell is',
    actions: [
      act(A, 'flop', 'bet'),
      act(B, 'flop', 'call'),
      act(A, 'turn', 'check'),
      act(B, 'turn', 'bet'),
      act(A, 'turn', 'fold'),
    ],
    community_cards: RAINBOW,
    community_cards2: ['Qspades', 'Qhearts', '2clubs'],
  },
  {
    name: 'a second board that shares the flop (run twice after the flop): the texture stands',
    actions: [
      act(A, 'preflop', 'raise'),
      act(B, 'preflop', 'call'),
      act(B, 'flop', 'check'),
      act(A, 'flop', 'check'),
    ],
    community_cards: [...RAINBOW, '2hearts', '9clubs'],
    community_cards2: [...RAINBOW, 'Aspades', 'Jclubs'],
  },
  {
    name: 'no flop cards on file: street cells only',
    actions: [act(A, 'flop', 'bet'), act(B, 'flop', 'fold')],
    community_cards: [],
    community_cards2: null,
  },
  {
    name: 'a card not written as the history writes it: no texture',
    actions: [act(A, 'flop', 'bet'), act(B, 'flop', 'fold')],
    community_cards: ['10spades', '8hearts', '3clubs'],
    community_cards2: null,
  },
  {
    name: 'an action with no player, a numeric player and an unknown action are skipped',
    actions: [
      { stage: 'flop', action: 'bet', origin: 'player' },
      { userId: 7, stage: 'flop', action: 'bet', origin: 'player' },
      act(A, 'flop', 'post_blind'),
      act(A, 'flop', 'check'),
      act(B, 'flop', 'bet'),
      act(A, 'flop', 'call'),
      null,
      'not an action',
    ],
    community_cards: ['Kspades', 'Kspades', 'Kspades'],
    community_cards2: null,
  },
  {
    name: 'a preflop re-raiser is the last preflop raiser; the opener who checks has no continuation bet opportunity',
    actions: [
      act(A, 'preflop', 'raise'),
      act(B, 'preflop', 'raise'),
      act(A, 'preflop', 'call'),
      act(A, 'flop', 'check'),
      act(B, 'flop', 'check'),
      act(A, 'turn', 'bet'),
      act(B, 'turn', 'raise'),
      act(A, 'turn', 'call'),
      act(A, 'river', 'check'),
      act(B, 'river', 'bet'),
      act(A, 'river', 'fold', { origin: 'pre_action' }),
    ],
    community_cards: ['Aspades', '7hearts', '7clubs', '2diamonds', '9hearts'],
    community_cards2: null,
  },
];

// ── seeded random public action logs, compact (see decodeStreetReadLog) ──
let seed = 20261117;
const rnd = (): number => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
const RANKS = '23456789TJQKA'.split('');
const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'];
const card = (): string => pick(RANKS) + pick(SUITS);
const IDS = ['a0', 'a1', 'a2', 'a3'];
const random: Array<{ log: string; community_cards: unknown; community_cards2: unknown }> = [];
for (let n = 0; n < 240; n++) {
  const tokens: string[] = [];
  const stages = ['preflop', 'flop', 'turn', 'river'].slice(0, pick([2, 3, 4, 4, 4]));
  // now and then a street is revisited out of order
  if (rnd() < 0.05) stages.push(pick(['flop', 'turn']));
  for (const stage of stages) {
    const count = 1 + Math.floor(rnd() * 7);
    for (let i = 0; i < count; i++) {
      const uid = rnd() < 0.03 ? '-' : pick(IDS);
      const action = pick([
        'bet',
        'raise',
        'raise',
        'all_in',
        'call',
        'call',
        'check',
        'check',
        'fold',
        'fold',
        'post_blind',
      ]);
      const origin =
        rnd() < 0.78
          ? pick(['player', 'pre_action', 'horse_policy'])
          : pick(['forced', 'unknown', 'horse_fallback', '-']);
      const full = action === 'all_in' ? pick(['1', '0', '-']) : '-';
      tokens.push([uid, stage, action, origin, full].join(','));
    }
  }
  const shape = rnd();
  const flop =
    shape < 0.25
      ? (() => {
          const r = pick(RANKS);
          return [r + pick(SUITS), r + pick(SUITS), card()];
        })()
      : shape < 0.4
        ? (() => {
            const s = pick(SUITS);
            return [pick(RANKS) + s, pick(RANKS) + s, pick(RANKS) + s];
          })()
        : [card(), card(), card()];
  const kind = rnd();
  const community_cards =
    kind < 0.04
      ? null
      : kind < 0.08
        ? flop.slice(0, 2)
        : kind < 0.1
          ? ['10hearts', flop[1], flop[2]]
          : [...flop, card(), card()].slice(0, pick([3, 4, 5]));
  const second = rnd();
  const community_cards2 =
    second < 0.85
      ? null
      : second < 0.9
        ? []
        : second < 0.95 && Array.isArray(community_cards)
          ? [...community_cards.slice(0, 3), card()]
          : [card(), card(), card(), card(), card()];
  random.push({ log: tokens.join(' '), community_cards, community_cards2 });
}

const flags = (r: StreetReadCounters): string => streetReadRow(r).join('');
const expectedOf = (actions: unknown, cc: unknown, cc2: unknown): Record<string, string> =>
  Object.fromEntries(
    [...engineStreetReadIncrements(actions, cc, cc2)].map(([id, r]) => [id, flags(r)])
  );

// ── the add rule through a chain of hands ──
const chainSteps: string[] = [];
const checkpoints: Array<{ after: number; row: number[] | null }> = [];
let chained: StreetReadCounters | null = null;
const pool = random.flatMap((v) =>
  Object.values(expectedOf(decodeStreetReadLog(v.log), v.community_cards, v.community_cards2))
);
for (let k = 0; k < 120; k++) {
  const inc = k === 0 ? '0'.repeat(34) : pick(pool);
  chainSteps.push(inc);
  const cells = inc.split('').map(Number);
  const row = {
    bet: {},
    foldToBet: {},
    foldToRaise: {},
    cbet: {},
    flopBet: {},
  } as unknown as StreetReadCounters;
  const groups: Array<[keyof StreetReadCounters, string[]]> = [
    ['bet', ['flop', 'turn', 'river']],
    ['foldToBet', ['flop', 'turn', 'river']],
    ['foldToRaise', ['flop', 'turn', 'river']],
    ['cbet', ['paired', 'rainbow', 'twoTone', 'monotone']],
    ['flopBet', ['paired', 'rainbow', 'twoTone', 'monotone']],
  ];
  let i = 0;
  for (const [stat, keys] of groups)
    for (const key of keys) {
      (row[stat] as Record<string, { hit: number; opp: number }>)[key] = {
        hit: cells[i]!,
        opp: cells[i + 1]!,
      };
      i += 2;
    }
  chained = addStreetReadEvidence(chained, row);
  if (k === 0 || k % 20 === 19)
    checkpoints.push({ after: k + 1, row: chained ? streetReadRow(chained) : null });
}

const out = {
  _comment:
    'Generated by server/scripts/generate-horse-street-read-vectors.ts from the engine reducer (HorseOmahaStreetRead). expected: per player, the 17 cells as 34 digits [hit, opp] in streetReadCells order (bet flop/turn/river, foldToBet flop/turn/river, foldToRaise flop/turn/river, cbet paired/rainbow/twoTone/monotone, flopBet paired/rainbow/twoTone/monotone). random[].log: one action per token "userId,stage,action,origin,isFullRaise" with "-" for an absent field and 1/0 for true/false.',
  named: named.map((v) => ({
    ...v,
    expected: expectedOf(v.actions, v.community_cards, v.community_cards2),
  })),
  random: random.map((v) => ({
    ...v,
    expected: expectedOf(decodeStreetReadLog(v.log), v.community_cards, v.community_cards2),
  })),
  chain: { steps: chainSteps, checkpoints },
};
writeFileSync(
  resolve(process.cwd(), '..', 'scripts/ci/fixtures/horse-street-read-vectors.json'),
  JSON.stringify(out, null, 2) + '\n'
);
console.log(
  `named ${out.named.length}, random ${out.random.length} (${out.random.filter((v) => Object.keys(v.expected).length).length} with a learned player), chain ${chainSteps.length}`
);
