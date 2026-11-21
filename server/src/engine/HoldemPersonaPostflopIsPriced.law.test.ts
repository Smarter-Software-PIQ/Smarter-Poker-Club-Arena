/**
 * LAW: THE FOUR V87 PERSONA POSTFLOP SPOTS ARE PRICED WHEN holdemPersonaPostflopIsPriced IS ON, AND NOTHING CHANGES
 * WHEN IT IS OFF (2026-11-21, Horse Switch lane; option default OFF, read === true;
 * HorseHoldemPersonaPostflopIsPriced).
 *
 *  1. The take rule: a bet spot bets only when EV(bet) beats EV(check); the trap checks when the check is worth at
 *     least every priced bet; the check-raise raises only when the raise beats fold and call.
 *  2. Off (absent, false, or any value that is not true): every decision and every receipt is what it was, seed for
 *     seed, with holdemPersonaPostflop off and on.
 *  3. Independent of the parent: on, the result is the same whether holdemPersonaPostflop is on, off or absent, and no
 *     persona receipt fires.
 *  4. It acts, with receipts, and draws nothing: the same spot gives the same priced answer on every seed.
 *  5. It reads the opponent: a measured over-folder gets a c-bet the population price declines.
 *
 * Synthetic spots (no recorded hand, card or identity): 1/2 cash, three seats, button raises to 5, small blind folds,
 * big blind calls; opponent memory on, the opponent's counters written directly.
 */
import { describe, expect, it } from 'vitest';
import {
  replayProfiles,
  stateAt,
  type ComplaintAction,
  type ExtractedHand,
} from './HorseComplaintReplay.js';
import { holdemPersonaPricedTakes } from './HorseHoldemPersonaPostflopIsPriced.js';
import type { HoldemPricedVerdict } from './HorseHoldemValueAndCallsArePriced.js';
import { HorseLogic } from './HorseLogic.js';
import { HorseMind, readScopeOf } from './HorseMind.js';
import { freshExploitCounters, type ExploitCounters } from './HorseOpponentExploit.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { seedFastRandom } from './HorseEval.js';
import type { Card } from '../types.js';

const SUIT = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' } as const;
const cards = (text: string): Card[] =>
  (text.match(/.{2}/g) ?? []).map((t) => ({
    rank: (t[0] === 'T' ? '10' : t[0]) as Card['rank'],
    suit: SUIT[t[1] as keyof typeof SUIT],
  }));

const PREFLOP: ComplaintAction[] = [
  { ord: 1, seat: 1, stage: 'preflop', action: 'sb', amount: 1 },
  { ord: 2, seat: 2, stage: 'preflop', action: 'bb', amount: 2 },
  { ord: 3, seat: 3, stage: 'preflop', action: 'raise', amount: 5, isFullRaise: true },
  { ord: 4, seat: 1, stage: 'preflop', action: 'fold', amount: 0 },
  { ord: 5, seat: 2, stage: 'preflop', action: 'call', amount: 3 },
];

function spot(
  heroSeat: 2 | 3,
  hole: string,
  board: string,
  street: 'flop' | 'turn',
  after: Omit<ComplaintAction, 'ord'>[],
  pot: number,
  stacks: readonly [number, number]
): ReturnType<typeof stateAt> {
  const node = {
    ord: 6 + after.length,
    seat: heroSeat,
    stage: street,
    action: 'check',
    amount: 0,
    origin: 'horse_policy',
    publicNode: {
      pot,
      ante: 0,
      anteType: 'none',
      mode: 'cash',
      seats: [
        [1, 199, 0, 1, 0, 0, 1],
        [2, stacks[0], 0, 0, 0, 0, 0],
        [3, stacks[1], 0, 0, 0, 0, 0],
      ],
      boards: [board],
      street,
      toCall: 0,
      currentBet: 0,
      minRaiseTo: 2,
      maxRaiseTo: stacks[heroSeat - 2],
      legalActions: ['fold', 'check', 'bet', 'all_in'],
      dealerSeat: 3,
      chipUnit: 1,
      bigBlind: 2,
      smallBlind: 1,
      variant: 'nlh',
      structure: 'no_limit',
      actorSeat: heroSeat,
      bombPot: false,
      allInOrFold: false,
      tournamentStage: null,
    },
  } as unknown as ComplaintAction;
  const hand = {
    handId: 'persona-postflop-priced',
    variant: 'nlh',
    bigBlind: 2,
    smallBlind: 1,
    buttonSeat: 3,
    players: [1, 2, 3].map((seat) => ({ seat, userId: `p${seat}`, isHorse: true })),
    horseHoleCards: { [`p${heroSeat}`]: cards(hole) },
    actions: [...PREFLOP, ...after.map((a, i) => ({ ...a, ord: 6 + i })), node],
  } as unknown as ExtractedHand;
  return stateAt(hand, node);
}

/** Button (hero) on a flop the big blind checked to it. */
const cbet = (hole: string, board: string) =>
  spot(
    3,
    hole,
    board,
    'flop',
    [{ seat: 2, stage: 'flop', action: 'check', amount: 0 }],
    11,
    [195, 195]
  );
/** Button (hero) on the turn after the big blind led the flop (called) and checked the turn. */
const takeaway = (hole: string, board: string) =>
  spot(
    3,
    hole,
    board,
    'turn',
    [
      { seat: 2, stage: 'flop', action: 'bet', amount: 5, isFullRaise: true },
      { seat: 3, stage: 'flop', action: 'call', amount: 5 },
      { seat: 2, stage: 'turn', action: 'check', amount: 0 },
    ],
    21,
    [190, 190]
  );
/** Big blind (hero) first to act on the flop against the button. */
const trap = (hole: string, board: string) => spot(2, hole, board, 'flop', [], 11, [195, 195]);

const LIVE = replayProfiles('cash')[0];
const SCOPE = readScopeOf('nlh', 3);
type Setup = (() => void) | null;
/** A measured high-frequency flop stabber (24 of 30 checked-to flops; bets 28 of 40 checked-to spots, folds 8 of
 *  20 bets), as the street bully read sees one. */
const stabber =
  (id: string): Setup =>
  () => {
    const c: ExploitCounters = freshExploitCounters();
    c.hands = 40;
    c.betCheckedToOpp = 40;
    c.betCheckedTo = 28;
    c.foldToBetOpp = 20;
    c.foldToBet = 8;
    (HorseMind as unknown as { exploitCounters: Map<string, ExploitCounters> }).exploitCounters.set(
      `${SCOPE}|${id}`,
      c
    );
    (
      HorseMind as unknown as {
        flopStabCounters: Map<string, Record<string, number>>;
      }
    ).flopStabCounters.set(`${SCOPE}|${id}`, {
      flopCheckedToOpps: 30,
      flopBetCheckedTo: 24,
      fFlopCheckedToOpps: 30,
      fFlopBetCheckedTo: 24,
    });
  };
const counters =
  (id: string, foldToBet: number): Setup =>
  () => {
    const c: ExploitCounters = freshExploitCounters();
    c.hands = 60;
    c.foldToBetOpp = 60;
    c.foldToBet = foldToBet;
    c.betCheckedToOpp = 60;
    c.betCheckedTo = 18;
    (HorseMind as unknown as { exploitCounters: Map<string, ExploitCounters> }).exploitCounters.set(
      `${SCOPE}|${id}`,
      c
    );
  };

/** Every decision (action and amount) and every receipt, seed by seed. */
function run(
  st: ReturnType<typeof stateAt>,
  opts: Record<string, unknown>,
  setup: Setup,
  seeds = 24
) {
  enableBrainTelemetry();
  const out: { decision: string; receipts: string[] }[] = [];
  for (let seed = 1; seed <= seeds; seed++) {
    HorseMind.reset();
    setup?.();
    drainFires();
    seedFastRandom(seed);
    const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
      telemetry: true,
      ...opts,
    } as never);
    out.push({
      decision: `${d.action}:${d.amount ?? ''}`,
      receipts: drainFires()
        .map((f) => `${f.feature}x${f.fires}`)
        .sort(),
    });
  }
  HorseMind.reset();
  return out;
}
const count = (r: ReturnType<typeof run>, receipt: string) =>
  r.filter((x) => x.receipts.some((f) => f.startsWith(`${receipt}x`))).length;
const actions = (r: ReturnType<typeof run>) => r.map((x) => x.decision.split(':')[0]);

const SPOTS: ReadonlyArray<readonly [string, ReturnType<typeof stateAt>, Setup]> = [
  ['c-bet taken by price', cbet('5s4d', 'Kd7h2c'), null],
  ['c-bet declined by price', cbet('Ah3c', 'Kd8h2s'), null],
  ['turn takeaway declined by price', takeaway('Qs9d', 'Kd7h2c5s'), stabber('p2')],
  ['turn takeaway taken by price', takeaway('5s4d', 'Kd7h2c9s'), stabber('p2')],
  ['flop check-trap taken by price', trap('7s7c', 'Kd7h2c'), stabber('p3')],
];
const ON = { holdemPersonaPostflopIsPriced: true };

describe('1. the take rule', () => {
  const v = (options: HoldemPricedVerdict['options']): HoldemPricedVerdict => ({
    options,
    best: options[0],
    equity: 0.4,
  });
  it('bet spots bet only when the bet at the site size beats the check', () => {
    const ok = v([
      { kind: 'check', to: 0, ev: 4 },
      { kind: 'bet', to: 4, ev: 4.5 },
    ]);
    expect(holdemPersonaPricedTakes('cbet', ok, 4)).toBe(true);
    expect(holdemPersonaPricedTakes('stab', ok, 4)).toBe(true);
    expect(holdemPersonaPricedTakes('cbet', ok, 7)).toBe(false); // no bet priced at the site's size
    expect(holdemPersonaPricedTakes('cbet', ok, null)).toBe(false);
    const tie = v([
      { kind: 'check', to: 0, ev: 4 },
      { kind: 'bet', to: 4, ev: 4 },
    ]);
    expect(holdemPersonaPricedTakes('cbet', tie, 4)).toBe(false); // strictly better is required
  });
  it('the trap checks when the check is worth at least every priced bet (a tie keeps the check)', () => {
    const opts = (check: number) =>
      v([
        { kind: 'check', to: 0, ev: check },
        { kind: 'bet', to: 4, ev: 5 },
        { kind: 'bet', to: 8, ev: 6 },
      ]);
    expect(holdemPersonaPricedTakes('trap', opts(6), null)).toBe(true);
    expect(holdemPersonaPricedTakes('trap', opts(5.9), null)).toBe(false);
    expect(holdemPersonaPricedTakes('trap', v([{ kind: 'check', to: 0, ev: 1 }]), null)).toBe(true);
  });
  it('the check-raise raises only when the raise at the site size beats fold and call', () => {
    const opts = (raise: number) =>
      v([
        { kind: 'fold', to: 0, ev: 0 },
        { kind: 'call', to: 5, ev: 3 },
        { kind: 'raise', to: 20, ev: raise },
      ]);
    expect(holdemPersonaPricedTakes('check_raise', opts(3.5), 20)).toBe(true);
    expect(holdemPersonaPricedTakes('check_raise', opts(3), 20)).toBe(false);
    expect(holdemPersonaPricedTakes('check_raise', opts(9), 25)).toBe(false);
    expect(holdemPersonaPricedTakes('check_raise', v([{ kind: 'call', to: 5, ev: 3 }]), 20)).toBe(
      false
    ); // no value raise priced (equity against the continuing range at most one half)
  });
});

describe('2. off, nothing changes', () => {
  for (const [name, st, setup] of SPOTS) {
    it(`${name}: absent, false and a non-true value are the same decisions and receipts, persona off and on`, () => {
      for (const persona of [{}, { holdemPersonaPostflop: true }]) {
        const base = run(st, persona, setup);
        expect(run(st, { ...persona, holdemPersonaPostflopIsPriced: false }, setup)).toEqual(base);
        expect(run(st, { ...persona, holdemPersonaPostflopIsPriced: 1 }, setup)).toEqual(base);
        for (const r of base)
          expect(r.receipts.filter((f) => f.includes('persona_postflop_priced'))).toEqual([]);
      }
    });
  }
});

describe('3. independent of holdemPersonaPostflop', () => {
  for (const [name, st, setup] of SPOTS) {
    it(`${name}: on, the parent on, off or absent gives the same result, and no persona receipt fires`, () => {
      const alone = run(st, ON, setup);
      expect(run(st, { ...ON, holdemPersonaPostflop: true }, setup)).toEqual(alone);
      expect(run(st, { ...ON, holdemPersonaPostflop: false }, setup)).toEqual(alone);
      for (const r of alone)
        expect(r.receipts.filter((f) => /^holdem_persona_postflop_[a-z_]+_seen/.test(f))).toEqual(
          []
        );
    });
  }
});

describe('4. it acts, with receipts, and draws nothing', () => {
  it('each spot gives one priced answer on every seed', () => {
    const expected: Record<string, string> = {
      'c-bet taken by price': 'holdem_persona_postflop_priced_cbet_taken',
      'c-bet declined by price': 'holdem_persona_postflop_priced_cbet_declined',
      'turn takeaway declined by price': 'holdem_persona_postflop_priced_stab_declined',
      'turn takeaway taken by price': 'holdem_persona_postflop_priced_stab_taken',
      'flop check-trap taken by price': 'holdem_persona_postflop_priced_trap_taken',
    };
    for (const [name, st, setup] of SPOTS) {
      const r = run(st, ON, setup);
      expect(count(r, expected[name]), name).toBe(r.length);
    }
  });
  it('a taken spot plays the site action: the c-bet and takeaway bet, the trap checks', () => {
    expect(new Set(actions(run(cbet('5s4d', 'Kd7h2c'), ON, null)))).toEqual(new Set(['bet']));
    expect(new Set(actions(run(takeaway('5s4d', 'Kd7h2c9s'), ON, stabber('p2'))))).toEqual(
      new Set(['bet'])
    );
    const trapped = run(trap('7s7c', 'Kd7h2c'), ON, stabber('p3'));
    expect(new Set(actions(trapped))).toEqual(new Set(['check']));
    expect(count(trapped, 'v87_oop_stab_trap')).toBe(trapped.length);
  });
  it('a declined takeaway falls through: today it bets every seed, priced it mostly checks', () => {
    const st = takeaway('Qs9d', 'Kd7h2c5s');
    expect(new Set(actions(run(st, { holdemPersonaPostflop: true }, stabber('p2'))))).toEqual(
      new Set(['bet'])
    );
    const priced = actions(run(st, ON, stabber('p2')));
    expect(priced.filter((a) => a === 'check').length).toBeGreaterThan(priced.length / 2);
  });
});

describe('5. it reads the opponent', () => {
  it('the population price declines the ace-high c-bet; a measured over-folder (54 of 60) gets it (the site blocks still apply after it)', () => {
    const st = cbet('Ah3c', 'Kd8h2s');
    expect(count(run(st, ON, null), 'holdem_persona_postflop_priced_cbet_declined')).toBe(24);
    const folder = run(st, ON, counters('p2', 54));
    expect(count(folder, 'holdem_persona_postflop_priced_cbet_taken')).toBe(24);
  });
});
