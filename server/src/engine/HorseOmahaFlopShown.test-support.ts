/**
 * The vectors on which the engine reducers of the flop-shown record and of the fold-to-raise price record and
 * their database twins must agree
 * (scripts/ci/fixtures/horse-flop-shown-vectors.json; written by
 * server/scripts/generate-horse-flop-shown-vectors.ts, checked by HorseOmahaFlopShown.test.ts and by
 * scripts/ci/test-horse-exact-public-memory.py). Deterministic. Every card here is invented.
 */
import {
  addFlopShownEvidence,
  emptyFlopShown,
  flopShownClassOf,
  flopShownHandIncrements,
  flopShownRow,
  type FlopShownCounters,
  type FlopShownHand,
} from './HorseOmahaFlopShown.js';
import {
  addStreetPriceEvidence,
  emptyStreetPrice,
  streetPriceHandIncrements,
  streetPriceRow,
  type StreetPriceCounters,
} from './HorseOmahaStreetReadPrice.js';

const SUIT_OF: Record<string, string> = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' };
/** "As" -> {rank:'A', suit:'spades'} (hand_history.hole_cards' form). */
export const holeCardOf = (code: string): { rank: string; suit: string } => ({
  rank: code[0],
  suit: SUIT_OF[code[1]] ?? code.slice(1),
});
/** "As" -> "Aspades" (hand_history.community_cards' form). */
export const boardCardOf = (code: string): string => code[0] + (SUIT_OF[code[1]] ?? code.slice(1));
const cards = (codes: string): string[] => codes.split(' ').filter(Boolean);

/** What the engine names a hand on a flop: "bet:caller", or "null". Codes are two characters, e.g. "As Kd". */
export function engineFlopShownClass(hole: string, flop: string): string {
  const k = flopShownClassOf(cards(hole).map(holeCardOf), cards(flop).map(holeCardOf));
  return k ? `${k.bet}:${k.caller}` : 'null';
}

/** One hand of public history as the fixture writes it (hand_history's own column names). */
export interface FlopShownVectorHand {
  actions: unknown;
  community_cards: unknown;
  community_cards2: unknown;
  hole_cards: unknown;
  showdown: unknown;
  winners: unknown;
  big_blind: unknown;
}
/** What the engine computes for one hand: per player (at most one, the flop bettor), his 80 numbers. */
export function engineFlopShownIncrements(h: FlopShownVectorHand): Record<string, number[]> {
  const hand: FlopShownHand = {
    actions: h.actions,
    communityCards: h.community_cards,
    communityCards2: h.community_cards2,
    holeCards: h.hole_cards,
    showdown: h.showdown,
    winners: h.winners,
    bigBlind: h.big_blind,
  };
  const out: Record<string, number[]> = {};
  for (const [id, r] of flopShownHandIncrements(hand)) out[id] = flopShownRow(r);
  return out;
}

/** The compact log of the random vectors: `uid,stage,action,origin,full,amount` tokens, `-` for an absent field. */
export function decodeFlopShownLog(log: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const token of log.split(' ')) {
    if (!token) continue;
    const [uid, stage, action, origin, full, amount] = token.split(',');
    const a: Record<string, unknown> = { stage, action };
    if (uid !== '-') a.userId = uid;
    if (origin !== '-') a.origin = origin;
    if (full !== '-') a.isFullRaise = full === '1';
    if (amount !== '-') a.amount = Number(amount);
    out.push(a);
  }
  return out;
}
/** A random vector as the fixture writes it, compact. `hole`: "uid=As Kd Qc Jh;uid=..."; `shown`: "uid:0 uid:1"
 *  (1 mucked); `won`: "uid:amount ..."; `board` and `board2`: two-character codes. */
export interface FlopShownRandomVector {
  log: string;
  board: string;
  board2: string;
  hole: string;
  shown: string;
  won: string;
  bb: number;
}
export function decodeFlopShownRandom(v: FlopShownRandomVector): FlopShownVectorHand {
  const hole: Record<string, unknown> = {};
  for (const part of v.hole.split(';').filter(Boolean)) {
    const [uid, codes] = part.split('=');
    hole[uid] = cards(codes).map(holeCardOf);
  }
  return {
    actions: decodeFlopShownLog(v.log),
    community_cards: cards(v.board).map(boardCardOf),
    community_cards2: v.board2 ? cards(v.board2).map(boardCardOf) : null,
    hole_cards: v.hole ? hole : null,
    showdown: v.shown
      ? v.shown.split(' ').map((s, i) => {
          const [user_id, mucked] = s.split(':');
          return { user_id, seat: i, reveal_order: i, mucked: mucked === '1' };
        })
      : null,
    winners: v.won
      .split(' ')
      .filter(Boolean)
      .map((s) => {
        const [userId, amount] = s.split(':');
        return { userId, amount: Number(amount) };
      }),
    big_blind: v.bb,
  };
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
const DECK: string[] = [...'23456789TJQKA'].flatMap((r) => [...'shdc'].map((s) => r + s));
function deal(rnd: () => number, n: number, from: string[] = DECK): string[] {
  const d = [...from];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d.slice(0, n);
}

const A = '00000000-0000-4000-8000-0000000000a1';
const B = '00000000-0000-4000-8000-0000000000a2';
const C = '00000000-0000-4000-8000-0000000000a3';
const act = (
  userId: string,
  stage: string,
  action: string,
  amount: number,
  extra: Record<string, unknown> = {}
): Record<string, unknown> => ({ userId, stage, action, amount, origin: 'player', ...extra });
const horse = { origin: 'horse_policy' };
const hand = (
  actions: unknown[],
  board: string,
  hole: Record<string, string>,
  shown: [string, boolean][],
  winners: [string, number][],
  extra: Partial<FlopShownVectorHand> = {}
): FlopShownVectorHand => ({
  actions,
  community_cards: cards(board).map(boardCardOf),
  community_cards2: null,
  hole_cards: Object.fromEntries(
    Object.entries(hole).map(([u, c]) => [u, cards(c).map(holeCardOf)])
  ),
  showdown: shown.map(([user_id, mucked], i) => ({ user_id, seat: i, reveal_order: i, mucked })),
  winners: winners.map(([userId, amount]) => ({ userId, amount })),
  big_blind: 2,
  ...extra,
});
/** A raises before the flop, B calls; B checks, A bets 10, B calls; the turn and river are checked. */
const cbetCalled = (callerExtra: Record<string, unknown> = {}): unknown[] => [
  { userId: B, stage: 'preflop', action: 'bb', amount: 2, origin: 'forced' },
  act(A, 'preflop', 'raise', 6),
  act(B, 'preflop', 'call', 4),
  act(B, 'flop', 'check', 0),
  act(A, 'flop', 'bet', 10),
  act(B, 'flop', 'call', 10, callerExtra),
  act(B, 'turn', 'check', 0),
  act(A, 'turn', 'check', 0),
  act(B, 'river', 'check', 0),
  act(A, 'river', 'check', 0),
];
const BOARD = 'Ks 8h 3c 2d 2c';
const SET = 'Kh Kd 9s 4s';
const PAIR = 'Ac 8c 7d 6d';

export const FLOP_SHOWN_VECTOR_NAMED: { name: string; hand: FlopShownVectorHand }[] = [
  {
    name: 'a continuation bet shown as top set; a person calls out of position with one pair, shown, and loses the call',
    hand: hand(
      cbetCalled(),
      BOARD,
      { [A]: SET, [B]: PAIR },
      [
        [A, false],
        [B, false],
      ],
      [[A, 30.5]]
    ),
  },
  {
    name: 'the same hand, the caller a Horse: the same cell of the other kind',
    hand: hand(
      cbetCalled(horse),
      BOARD,
      { [A]: SET, [B]: PAIR },
      [
        [A, false],
        [B, false],
      ],
      [[A, 30.5]]
    ),
  },
  {
    name: 'the caller mucks: his cards are not on the record and he is counted unshown',
    hand: hand(
      cbetCalled(),
      BOARD,
      { [A]: SET },
      [
        [A, false],
        [B, true],
      ],
      [[A, 30.5]]
    ),
  },
  {
    name: 'a mucked showdown entry is never read, even if cards were written for him',
    hand: hand(
      cbetCalled(),
      BOARD,
      { [A]: SET, [B]: PAIR },
      [
        [A, false],
        [B, true],
      ],
      [[A, 30.5]]
    ),
  },
  {
    name: 'the bettor mucks: his bet has no class; the shown caller wins and his return is counted',
    hand: hand(
      cbetCalled(),
      BOARD,
      { [B]: PAIR },
      [
        [A, true],
        [B, false],
      ],
      [[B, 30.5]]
    ),
  },
  {
    name: 'cards without a showdown entry are not public: nothing about the bettor, the caller unshown',
    hand: hand(cbetCalled(), BOARD, { [A]: SET, [B]: PAIR }, [], [[A, 30.5]]),
  },
  {
    name: 'hole cards written on the actions change nothing',
    hand: hand(
      cbetCalled().map((a) => ({ ...(a as object), holeCards: ['Aspades', 'Ahearts'] })),
      BOARD,
      { [A]: SET },
      [
        [A, false],
        [B, true],
      ],
      [[A, 30.5]]
    ),
  },
  {
    name: 'a lead by the caller is a first bet, not a continuation bet; the raiser calls in position with a draw',
    hand: hand(
      [
        act(A, 'preflop', 'raise', 6),
        act(B, 'preflop', 'call', 6),
        act(B, 'flop', 'bet', 9),
        act(A, 'flop', 'call', 9, horse),
        act(B, 'turn', 'bet', 20),
        act(A, 'turn', 'call', 20, horse),
        act(B, 'river', 'check', 0),
        act(A, 'river', 'bet', 40, horse),
        act(B, 'river', 'fold', 0),
        {
          userId: A,
          stage: 'river',
          action: 'return',
          amount: 40,
          historyEvent: 'uncalled_bet_returned',
        },
      ],
      'Ts 9s 4d 2c 7h',
      {},
      [],
      [[A, 67]]
    ),
  },
  {
    name: 'a raise closes the calls: a call after the raise is not a call of his bet; the caller before it is',
    hand: hand(
      [
        act(A, 'preflop', 'raise', 6),
        act(B, 'preflop', 'call', 6),
        act(C, 'preflop', 'call', 6),
        act(A, 'flop', 'bet', 12),
        act(B, 'flop', 'call', 12),
        act(C, 'flop', 'raise', 48),
        act(A, 'flop', 'call', 36),
        act(B, 'flop', 'fold', 0),
      ],
      'Qd Jd 5s 5c 2h',
      { [A]: 'Qs Qh 9c 8c', [C]: 'Jc Js 5d 4d' },
      [
        [A, false],
        [C, false],
      ],
      [[A, 120]]
    ),
  },
  {
    name: 'two callers of one bet: the first out of position to the second, both counted; one shown in position with a draw',
    hand: hand(
      [
        act(A, 'preflop', 'raise', 6),
        act(B, 'preflop', 'call', 6),
        act(C, 'preflop', 'call', 6),
        act(A, 'flop', 'bet', 12),
        act(B, 'flop', 'call', 12, horse),
        act(C, 'flop', 'call', 12, horse),
        act(A, 'turn', 'check', 0),
        act(B, 'turn', 'check', 0),
        act(C, 'turn', 'check', 0),
        act(A, 'river', 'check', 0),
        act(B, 'river', 'check', 0),
        act(C, 'river', 'check', 0),
      ],
      'Ah 7h 6c 2s 9d',
      { [A]: 'As Ad Kc Qc', [B]: 'Kh Qh Jc Tc', [C]: 'Td 9c 8s 5h' },
      [
        [A, false],
        [B, false],
        [C, false],
      ],
      [[C, 51.5]]
    ),
  },
  {
    name: 'a double-board hand with two flops has no single flop: nothing',
    hand: hand(cbetCalled(), BOARD, { [A]: SET }, [[A, false]], [[A, 30.5]], {
      community_cards2: cards('Qs 8h 3c 2d 2c').map(boardCardOf),
    }),
  },
  {
    name: 'a second board that shares the flop keeps it',
    hand: hand(cbetCalled(), BOARD, { [A]: SET }, [[A, false]], [[A, 30.5]], {
      community_cards2: cards('Ks 8h 3c 9d 9c').map(boardCardOf),
    }),
  },
  {
    name: 'a bomb pot is not read',
    hand: hand(
      [
        { userId: A, stage: 'preflop', action: 'bomb_ante', amount: 4, origin: 'forced' },
        ...cbetCalled(),
      ],
      BOARD,
      { [A]: SET },
      [[A, false]],
      [[A, 30.5]]
    ),
  },
  {
    name: 'no winners list or no big blind: the bet is still classed, the calls are not counted',
    hand: hand(
      cbetCalled(),
      BOARD,
      { [A]: SET, [B]: PAIR },
      [
        [A, false],
        [B, false],
      ],
      [],
      {
        winners: null,
        big_blind: null,
      }
    ),
  },
  {
    name: 'a hold-em hand (two hole cards) has no class; its call is still counted, unshown',
    hand: hand(
      cbetCalled(),
      BOARD,
      { [A]: 'Kh Kd', [B]: 'Ac 8c' },
      [
        [A, false],
        [B, false],
      ],
      [[A, 30.5]]
    ),
  },
  {
    name: 'a first flop wager that is an all-in short of a bet: the flop has no clean first bet',
    hand: hand(
      [
        act(A, 'preflop', 'raise', 6),
        act(B, 'preflop', 'call', 6),
        act(B, 'flop', 'all_in', 3, { isFullRaise: false }),
        act(A, 'flop', 'raise', 12),
      ],
      BOARD,
      { [A]: SET, [B]: PAIR },
      [
        [A, false],
        [B, false],
      ],
      [[A, 15]]
    ),
  },
  {
    name: 'damaged amounts, a caller with an unknown origin, a card that is not a card: no error',
    hand: hand(
      [
        act(A, 'preflop', 'raise', 6),
        act(B, 'preflop', 'call', 6),
        act(C, 'preflop', 'call', 6),
        act(A, 'flop', 'bet', 1e300),
        act(B, 'flop', 'call', 10, { origin: 'timeout' }),
        { userId: C, stage: 'flop', action: 'call', amount: 'ten', origin: 'player' },
        7,
        null,
        { userId: 5, stage: 'flop', action: 'call' },
      ],
      BOARD,
      { [A]: 'Kh Kd 9s 1x' },
      [[A, false]],
      [[C, 1e300]]
    ),
  },
  {
    name: 'a showdown entry shows a hand only with mucked: false written out; no flag, null or a string is not shown',
    hand: {
      ...hand(cbetCalled(), BOARD, { [A]: SET, [B]: PAIR }, [], [[A, 30.5]]),
      showdown: [
        { user_id: A, seat: 0, reveal_order: 0 },
        { user_id: B, seat: 1, reveal_order: 1, mucked: 'false' },
      ],
    },
  },
  {
    name: 'the bettor shown with mucked: false; the caller listed with mucked: null is counted unshown',
    hand: {
      ...hand(cbetCalled(), BOARD, { [A]: SET, [B]: PAIR }, [], [[A, 30.5]]),
      showdown: [
        { user_id: A, seat: 0, reveal_order: 0, mucked: false },
        { user_id: B, seat: 1, reveal_order: 1, mucked: null },
      ],
    },
  },
];

/** What the engine computes for one action log and pot size: per player, [sum, opp] of the flop, turn and river. */
export function engineStreetPriceIncrements(
  actions: unknown,
  potSize: unknown
): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const [id, r] of streetPriceHandIncrements(actions, potSize)) out[id] = streetPriceRow(r);
  return out;
}

/** A bets 10 into 12, B raises to 30, A acts: A must add 20 to a pot of 12 + 10 + 30 = 52. */
const raisedBet = (answer: string, amount: number): unknown[] => [
  act(A, 'preflop', 'raise', 6),
  act(B, 'preflop', 'call', 6),
  act(A, 'flop', 'bet', 10),
  act(B, 'flop', 'raise', 30),
  act(A, 'flop', answer, amount),
];
export const STREET_PRICE_VECTOR_NAMED: { name: string; actions: unknown[]; pot_size: unknown }[] =
  [
    {
      name: 'a bettor is raised and folds: 20 to add over a pot of 52',
      actions: raisedBet('fold', 0),
      pot_size: 52,
    },
    { name: 'the same raise called: the same price', actions: raisedBet('call', 20), pot_size: 72 },
    {
      name: 'a caller in between: his chips are in the pot the bettor is offered',
      actions: [
        act(A, 'flop', 'bet', 10),
        act(B, 'flop', 'raise', 30),
        act(C, 'flop', 'call', 30),
        act(A, 'flop', 'fold', 0),
      ],
      pot_size: 82,
    },
    {
      name: 'a turn check-raise, an uncalled bet returned on the river, and a raiser who is raised back',
      actions: [
        act(A, 'flop', 'bet', 10),
        act(B, 'flop', 'call', 10),
        act(B, 'turn', 'check', 0),
        act(A, 'turn', 'bet', 20),
        act(B, 'turn', 'raise', 60),
        act(A, 'turn', 'raise', 180),
        act(B, 'turn', 'call', 120),
        act(B, 'river', 'bet', 100),
        act(A, 'river', 'fold', 0),
        {
          userId: B,
          stage: 'river',
          action: 'return',
          amount: 100,
          historyEvent: 'uncalled_bet_returned',
        },
      ],
      pot_size: 392,
    },
    { name: 'no pot size on the record: nothing', actions: raisedBet('fold', 0), pot_size: null },
    {
      name: 'a pot size smaller than the postflop streets added: nothing',
      actions: raisedBet('fold', 0),
      pot_size: 30,
    },
    {
      name: 'a forced fold is not an answer; an unattributed fold is not admitted',
      actions: [
        act(A, 'flop', 'bet', 10),
        act(B, 'flop', 'raise', 30),
        act(A, 'flop', 'fold', 0, { origin: 'forced' }),
        act(A, 'turn', 'bet', 10),
        act(B, 'turn', 'raise', 30),
        act(A, 'turn', 'fold', 0, { origin: 'timeout' }),
      ],
      pot_size: 92,
    },
  ];

export interface FlopShownVectors {
  _comment: string;
  classes: { hole: string; flop: string; expected: string }[];
  named: { name: string; hand: FlopShownVectorHand; expected: Record<string, number[]> }[];
  random: (FlopShownRandomVector & {
    expected: Record<string, number[]>;
    /** the same log through the fold-to-raise price reducer at this pot size */
    pot: number;
    price: Record<string, number[]>;
  })[];
  chain: { steps: number[][]; checkpoints: { after: number; row: number[] | null }[] };
  priceNamed: {
    name: string;
    actions: unknown[];
    pot_size: unknown;
    expected: Record<string, number[]>;
  }[];
  /** each step: [sum, opp] of the flop, turn and river for one hand */
  priceChain: { steps: number[][]; checkpoints: { after: number; row: number[] | null }[] };
}

/** Hands chosen to stand on each rule of the class, then dealt ones. */
const CLASS_NAMED: [string, string][] = [
  ['Kh Kd 9s 4s', 'Ks 8h 3c'], // top set
  ['8s 8d 9s 4s', 'Ks 8h 3c'], // middle set
  ['Kh Kd 9s 4s', 'Ks 8s 3s'], // top set on a monotone flop
  ['As Qs 9d 4d', 'Ks 8s 3s'], // nut flush
  ['Qs Js 9d 4d', 'Ks 8s 3s'], // second flush
  ['Qs Js 9d 4d', 'Ks Ts 9s'], // straight flush
  ['Qd Jh 9d 4d', 'Kc Ts 9s'], // nut straight
  ['8d 7h 2d 2c', 'Jc Ts 9s'], // low end of the straight
  ['Ad 5h Kd Kc', '4c 3s 2s'], // wheel side: the six-high straight is the nut
  ['6d 5h Kd Kc', '4c 3s 2s'],
  ['Kh 8d 9s 4s', 'Ks 8h 3c'], // top two
  ['Kh 3d 9s 4s', 'Ks 8h 3c'],
  ['Ah Kd 9s 4s', 'Ks 8h 3c'], // one pair
  ['Ah Ad 9s 4s', 'Ks 8h 3c'], // overpair
  ['Ah Qd 9s 4s', 'Ks 8h 3c'], // nothing
  ['Ah Qh 9s 4s', 'Kh 8h 3c'], // nut flush draw
  ['Qh Jh 9s 4s', 'Kh 8h 3c'], // bare second flush draw
  ['Qh Jh Ts 9s', 'Kh 8h 7c'], // flush draw with a straight draw
  ['Qd Jh Ts 9s', 'Kh 8c 7c'], // wrap
  ['6d 5h As Ks', 'Qh 8c 7c'], // open-ended straight draw
  ['Kh 9d 9s 4s', 'Ks Kd 3c'], // trips on a paired flop
  ['3h 3d 9s 4s', 'Ks Kd 3c'], // full house under
  ['Kh 3d 9s 4s', 'Ks Kd 3c'], // full house
  ['Kh Kc 9s 4s', 'Ks Kd 3c'], // four of a kind
  ['Ah Ad 9s 4s', 'Ks Kd 3c'], // pocket pair on a paired flop
  ['Ah 3d 9s 4s', 'Ks Kd 3c'], // pairs the kicker of a paired flop
  ['Ah Qd 9s 4s', 'Ks Kd 3c'], // the board's pair alone
  ['Ah Qd 9s 4s', 'Ks Kd Kc'], // the board's three of a kind alone
  ['Ah Ad 9s 4s', 'Ks Kd Kc'], // full house on a trips flop
  ['Ah Kh 9s 4s', 'Ks Kd Kc'], // four of a kind on a trips flop
  ['Ah Kd 9s 4s Qc', 'Ks 8h 3c'], // five cards
  ['Ah Kd 9s 4s Qc Jc', 'Ks 8h 3c'], // six cards
  ['Ah Kd 9s', 'Ks 8h 3c'], // three cards: no class
  ['Ah Kd 9s Ks', 'Ks 8h 3c'], // a card dealt twice: no class
];

export function buildFlopShownVectors(): FlopShownVectors {
  const rnd = rng(20261119);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
  const classes = CLASS_NAMED.map(([hole, flop]) => ({
    hole,
    flop,
    expected: engineFlopShownClass(hole, flop),
  }));
  for (let k = 0; k < 700; k++) {
    const n = 4 + (k % 3);
    // Every third deal draws from two suits and nine ranks, so made hands and draws are common.
    const from =
      k % 3 === 0 ? DECK.filter((c) => 'sh'.includes(c[1]) && '56789TJQK'.includes(c[0])) : DECK;
    const d = deal(rnd, n + 3, from);
    const hole = d.slice(0, n).join(' ');
    const flop = d.slice(n).join(' ');
    classes.push({ hole, flop, expected: engineFlopShownClass(hole, flop) });
  }
  const named = FLOP_SHOWN_VECTOR_NAMED.map((v) => ({
    ...v,
    expected: engineFlopShownIncrements(v.hand),
  }));
  // Random hands: three or four players, a raised pot, a flop bet most of the time, calls, raises, folds, later
  // streets, a showdown list and a winners list that need not be consistent with the cards (the reducers read
  // the record, they do not judge it).
  const uids = ['a0', 'a1', 'a2', 'a3'];
  const random: FlopShownVectors['random'] = [];
  for (let k = 0; k < 260; k++) {
    const players = uids.slice(0, 2 + Math.floor(rnd() * 3));
    const d = deal(rnd, 5 + players.length * 5);
    const board = d.slice(0, 5);
    const tokens: string[] = [];
    const origin = (): string =>
      pick([
        'player',
        'player',
        'horse_policy',
        'horse_policy',
        'horse_policy',
        'pre_action',
        'forced',
        'timeout',
        '-',
      ]);
    const put = (
      uid: string,
      stage: string,
      action: string,
      amount: number | string,
      full = '-'
    ): void => {
      tokens.push([uid, stage, action, origin(), full, String(amount)].join(','));
    };
    if (rnd() < 0.06) put(players[0], 'preflop', 'bomb_ante', 4);
    for (const p of players)
      put(p, 'preflop', rnd() < 0.5 ? 'raise' : 'call', 2 + Math.floor(rnd() * 8));
    let live = [...players];
    for (const stage of ['flop', 'turn', 'river']) {
      let toCall = 0;
      const total = new Map<string, number>();
      const turns = live.length + Math.floor(rnd() * 3);
      for (let t = 0; t < turns && live.length > 1; t++) {
        const p = live[t % live.length];
        const have = total.get(p) ?? 0;
        const r = rnd();
        if (toCall === 0) {
          if (r < 0.5) put(p, stage, 'check', 0);
          else if (r < 0.93) {
            toCall = 4 + Math.floor(rnd() * 20) + (rnd() < 0.2 ? 0.5 : 0);
            total.set(p, toCall);
            put(p, stage, 'bet', toCall, pick(['-', '1']));
          } else {
            toCall = 3;
            total.set(p, 3);
            put(p, stage, 'all_in', 3, pick(['0', '1', '-']));
          }
        } else if (r < 0.5) {
          put(p, stage, 'call', toCall - have);
          total.set(p, toCall);
        } else if (r < 0.72) {
          put(p, stage, 'fold', 0);
          live = live.filter((x) => x !== p);
          t--;
        } else if (r < 0.9) {
          toCall = toCall * 2 + Math.floor(rnd() * 10);
          total.set(p, toCall);
          put(p, stage, pick(['raise', 'raise', 'all_in']), toCall, pick(['1', '1', '0']));
        } else if (r < 0.95) put(p, stage, 'return', 1 + Math.floor(rnd() * 9));
        else put(pick(['-', p]), stage, pick(['show', 'check', 'call']), pick([0, 5, 'x']));
      }
    }
    const boardFor = rnd() < 0.08 ? board.slice(0, 2) : board;
    const board2 =
      rnd() < 0.1 ? (rnd() < 0.5 ? [...board.slice(0, 3), ...d.slice(-2)] : d.slice(-5)) : [];
    const holeParts: string[] = [];
    const shown: string[] = [];
    players.forEach((p, i) => {
      const n = pick([4, 4, 5, 5, 5, 6, 2]);
      const mine = d.slice(5 + i * 5, 5 + i * 5 + Math.min(n, 5));
      if (n === 6) mine.push(d[d.length - 1 - i]);
      const r = rnd();
      if (r < 0.6) {
        holeParts.push(`${p}=${mine.join(' ')}`);
        shown.push(`${p}:${rnd() < 0.1 ? 1 : 0}`);
      } else if (r < 0.7) shown.push(`${p}:1`);
      else if (r < 0.75) holeParts.push(`${p}=${mine.join(' ')}`);
    });
    const won = players
      .filter(() => rnd() < 0.45)
      .map((p) => `${p}:${Math.floor(rnd() * 20000) / 100}`)
      .join(' ');
    const v: FlopShownRandomVector = {
      log: tokens.join(' '),
      board: boardFor.join(' '),
      board2: board2.join(' '),
      hole: holeParts.join(';'),
      shown: shown.join(' '),
      won,
      bb: pick([2, 2, 1, 0.5, 3, 0.25]),
    };
    const pot = pick([0, 40, 400, 400, 900, 900, 2500]) + Math.floor(rnd() * 100);
    random.push({
      ...v,
      expected: engineFlopShownIncrements(decodeFlopShownRandom(v)),
      pot,
      price: engineStreetPriceIncrements(decodeFlopShownLog(v.log), pot),
    });
  }
  // The add rule through a chain of 160 hands: each step is one hand's evidence for one bettor as sparse
  // [index, value] pairs flattened (index 0-39 bet, 40-79 call).
  const steps: number[][] = [];
  const checkpoints: { after: number; row: number[] | null }[] = [];
  let row: FlopShownCounters | null = null;
  for (let k = 1; k <= 160; k++) {
    const inc = emptyFlopShown();
    const step: number[] = [];
    if (rnd() < 0.6) {
      const i = Math.floor(rnd() * 8) * 5 + Math.floor(rnd() * 5);
      inc.bet[i] = 1;
      step.push(i, 1);
    }
    const callers = rnd() < 0.5 ? 0 : 1 + Math.floor(rnd() * 2);
    for (let c = 0; c < callers; c++) {
      const i = Math.floor(rnd() * 10) * 4;
      inc.call[i] += 1;
      inc.call[i + 1] += Math.floor(rnd() * 4000);
      inc.call[i + 2] += Math.floor(rnd() * 30000) - 12000;
      inc.call[i + 3] += 1;
    }
    inc.call.forEach((v, i) => {
      if (v !== 0) step.push(40 + i, v);
    });
    steps.push(step);
    row = addFlopShownEvidence(row, inc);
    if (k % 10 === 0 || k <= 3) checkpoints.push({ after: k, row: row ? flopShownRow(row) : null });
  }
  const priceNamed = STREET_PRICE_VECTOR_NAMED.map((v) => ({
    ...v,
    expected: engineStreetPriceIncrements(v.actions, v.pot_size),
  }));
  const priceSteps: number[][] = [];
  const priceCheckpoints: { after: number; row: number[] | null }[] = [];
  let priceRow: StreetPriceCounters | null = null;
  for (let k = 1; k <= 120; k++) {
    const inc = emptyStreetPrice();
    const step: number[] = [];
    for (const s of ['flop', 'turn', 'river'] as const) {
      const priced = rnd() < 0.4;
      inc.foldToRaise[s] = priced
        ? { sum: Math.floor(rnd() * 900 + 50) / 1000, opp: 1 }
        : { sum: 0, opp: 0 };
      step.push(inc.foldToRaise[s].sum, inc.foldToRaise[s].opp);
    }
    priceSteps.push(step);
    priceRow = addStreetPriceEvidence(priceRow, inc);
    if (k % 10 === 0 || k <= 3)
      priceCheckpoints.push({ after: k, row: priceRow ? streetPriceRow(priceRow) : null });
  }
  return {
    _comment:
      'Engine/database parity vectors of the flop-shown record (HorseOmahaFlopShown) and of the fold-to-raise price record (HorseOmahaStreetReadPrice; random[].pot and price, priceNamed, priceChain), migration 20261119192551. expected = the engine. Written by server/scripts/generate-horse-flop-shown-vectors.ts; every card is invented. Do not edit by hand.',
    classes,
    named,
    random,
    chain: { steps, checkpoints },
    priceNamed,
    priceChain: { steps: priceSteps, checkpoints: priceCheckpoints },
  };
}
