/**
 * LAW: THE FOUR V87 PERSONA POSTFLOP SPOTS ARE PRICED WITH MEASURED LIVE NLH EMPIRICAL PRIORS WHEN
 * holdemPersonaPostflopIsPriced IS ON, AND NOTHING CHANGES WHEN IT IS OFF (2026-11-21, Horse Switch lane;
 * V2 empirical priors, EMPIRICAL-PRIORS-AUDIT.md Patch 2; option default OFF, read === true;
 * HorseHoldemPersonaPostflopIsPriced, holdemEmpiricalPriors).
 *
 *  1. The take rule: a bet spot bets only when EV(bet) beats EV(check); the trap checks when the check is worth at
 *     least every priced bet; the check-raise raises only when the raise beats fold and call.
 *  2. Off (absent, false, or any value that is not true): every decision and every receipt is what it was, seed for
 *     seed, with holdemPersonaPostflop off and on.
 *  3. Independent of the parent: on, the result is the same whether holdemPersonaPostflop is on, off or absent, and no
 *     persona receipt fires.
 *  4. It acts, with receipts, and draws nothing: the same spot gives the same priced answer on every seed; multiway
 *     pots decline cleanly with `holdem_persona_postflop_priced_unpriced`.
 *  5. It reads the opponent: a measured over-folder gets a c-bet declined against a stickier opponent.
 *  6. V2 empirical priors (Patch 2):
 *     - IP dry/paired c-bets receive strictly higher measured fold equity than OOP leads, monotone boards, or
 *       low-SPR (< 3) boards;
 *     - Turn stab uses measured turn IP/OOP fold rate;
 *     - Trap uses measured flop `betWhenCheckedTo` (33.50%) and OOP flop fold rate;
 *     - Check-raise uses OOP flop fold at villain's true incremental call pot fraction (no raise-price overestimate).
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
import {
  HOLDEM_PERSONA_PRICED_CBET_FRACTION,
  HOLDEM_PERSONA_PRICED_STAB_FRACTION,
  holdemFlopTexture,
  holdemPersonaPricedAdjustSpot,
  holdemPersonaPricedTakes,
} from './HorseHoldemPersonaPostflopIsPriced.js';
import {
  holdemPricedFold,
  type HoldemPricedSpot,
  type HoldemPricedVerdict,
} from './HorseHoldemValueAndCallsArePriced.js';
import {
  HOLDEM_EMPIRICAL_BET_WHEN_CHECKED_TO,
  HOLDEM_EMPIRICAL_FLOP_FOLD_TO_CBET,
  HOLDEM_EMPIRICAL_TURN_FOLD_TO_BET,
  estimateHoldemFoldToRaisePrior,
  holdemEmpiricalFlopCbetFoldPrior,
} from './holdemEmpiricalPriors.js';
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

/** Multiway (3-way) flop trap spot: SB called preflop too so oppCount = 2. */
function multiwayTrap(hole: string, board: string): ReturnType<typeof stateAt> {
  const preflopMw: ComplaintAction[] = [
    { ord: 1, seat: 1, stage: 'preflop', action: 'sb', amount: 1 },
    { ord: 2, seat: 2, stage: 'preflop', action: 'bb', amount: 2 },
    { ord: 3, seat: 3, stage: 'preflop', action: 'raise', amount: 5, isFullRaise: true },
    { ord: 4, seat: 1, stage: 'preflop', action: 'call', amount: 4 },
    { ord: 5, seat: 2, stage: 'preflop', action: 'call', amount: 3 },
  ];
  const node = {
    ord: 7,
    seat: 2,
    stage: 'flop',
    action: 'check',
    amount: 0,
    origin: 'horse_policy',
    publicNode: {
      pot: 15,
      ante: 0,
      anteType: 'none',
      mode: 'cash',
      seats: [
        [1, 195, 0, 0, 0, 0, 0],
        [2, 195, 0, 0, 0, 0, 0],
        [3, 195, 0, 0, 0, 0, 0],
      ],
      boards: [board],
      street: 'flop',
      toCall: 0,
      currentBet: 0,
      minRaiseTo: 2,
      maxRaiseTo: 195,
      legalActions: ['fold', 'check', 'bet', 'all_in'],
      dealerSeat: 3,
      chipUnit: 1,
      bigBlind: 2,
      smallBlind: 1,
      variant: 'nlh',
      structure: 'no_limit',
      actorSeat: 2,
      bombPot: false,
      allInOrFold: false,
      tournamentStage: null,
    },
  } as unknown as ComplaintAction;
  const hand = {
    handId: 'persona-postflop-priced-mw',
    variant: 'nlh',
    bigBlind: 2,
    smallBlind: 1,
    buttonSeat: 3,
    players: [1, 2, 3].map((seat) => ({ seat, userId: `p${seat}`, isHorse: true })),
    horseHoleCards: { p2: cards(hole) },
    actions: [...preflopMw, { ord: 6, seat: 1, stage: 'flop', action: 'check', amount: 0 }, node],
  } as unknown as ExtractedHand;
  return stateAt(hand, node);
}

/** Button (hero) on a flop the big blind checked to it. */
const cbet = (hole: string, board: string, stacks: readonly [number, number] = [195, 195]) =>
  spot(
    3,
    hole,
    board,
    'flop',
    [{ seat: 2, stage: 'flop', action: 'check', amount: 0 }],
    11,
    stacks
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
/** A measured high-frequency flop stabber (24 of 30 checked-to flops; bets 28 of 40 checked-to spots),
 *  optionally carrying a measured fold-to-bet sample (`foldToBet` / `foldToBetOpp`). */
const stabber =
  (id: string, foldToBet = 8, foldToBetOpp = 20): Setup =>
  () => {
    const c: ExploitCounters = freshExploitCounters();
    c.hands = 40;
    c.betCheckedToOpp = 40;
    c.betCheckedTo = 28;
    c.foldToBetOpp = foldToBetOpp;
    c.foldToBet = foldToBet;
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
  ['c-bet declined by price', cbet('Ah3c', 'Kd8h2s'), counters('p2', 12)],
  ['turn takeaway declined by price', takeaway('Qs9d', 'Kd7h2c5s'), stabber('p2')],
  ['turn takeaway taken by price', takeaway('5s4d', 'Kd7h2c9s'), stabber('p2', 0, 0)],
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
    expect(new Set(actions(run(takeaway('5s4d', 'Kd7h2c9s'), ON, stabber('p2', 0, 0))))).toEqual(
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
  it('multiway (3-way) trap declines cleanly with holdem_persona_postflop_priced_unpriced', () => {
    const r = run(multiwayTrap('7s7c', 'Kd7h2c'), ON, stabber('p3'), 4);
    expect(count(r, 'holdem_persona_postflop_priced_unpriced')).toBe(r.length);
    expect(count(r, 'v87_oop_stab_trap')).toBe(0);
  });
});

describe('5. it reads the opponent', () => {
  it('a sticky caller (12 of 60 folds) declines the ace-high c-bet; an over-folder (54 of 60) gets it', () => {
    const st = cbet('Ah3c', 'Kd8h2s');
    expect(
      count(run(st, ON, counters('p2', 12)), 'holdem_persona_postflop_priced_cbet_declined')
    ).toBe(24);
    expect(
      count(run(st, ON, counters('p2', 54)), 'holdem_persona_postflop_priced_cbet_taken')
    ).toBe(24);
  });
});

describe('6. V2 measured live NLH empirical priors (EMPIRICAL-PRIORS-AUDIT.md Patch 2)', () => {
  const baseSpot = (over: Partial<HoldemPricedSpot> = {}): HoldemPricedSpot => ({
    street: 'flop',
    pot: 10,
    currentBet: 0,
    heroIn: 0,
    villainIn: 0,
    heroStack: 100,
    villainStack: 100,
    inPosition: true,
    villainToAct: false,
    foldAtReference: 0.4347,
    betWhenCheckedTo: 0.3115,
    bluffShare: 0.25,
    heroMade: false,
    ...over,
  });

  it('classifies flop texture cleanly (unpaired_nonmono, paired, mono)', () => {
    expect(holdemFlopTexture(cards('Kd7h2c'))).toBe('unpaired_nonmono');
    expect(holdemFlopTexture(cards('Kd7h7c'))).toBe('paired');
    expect(holdemFlopTexture(cards('Kd7d2d'))).toBe('mono');
    expect(holdemFlopTexture(cards('Kd7h'))).toBeUndefined();
  });

  it('IP dry and paired flop c-bets receive higher measured fold equity than OOP leads, monotone boards, or low-SPR boards', () => {
    const pot = 10;
    const bet = pot * HOLDEM_PERSONA_PRICED_CBET_FRACTION;
    const ipPaired = holdemPersonaPricedAdjustSpot(
      'cbet',
      baseSpot(),
      cards('Kd7h7c'),
      bet,
      null,
      null
    );
    const ipDry = holdemPersonaPricedAdjustSpot(
      'cbet',
      baseSpot(),
      cards('Kd7h2c'),
      bet,
      null,
      null
    );
    const ipMono = holdemPersonaPricedAdjustSpot(
      'cbet',
      baseSpot(),
      cards('Kd7d2d'),
      bet,
      null,
      null
    );
    const ipLowSpr = holdemPersonaPricedAdjustSpot(
      'cbet',
      baseSpot({ heroStack: 20, villainStack: 20 }),
      cards('Kd7h2c'),
      bet,
      null,
      null
    );
    const oopDry = holdemPersonaPricedAdjustSpot(
      'cbet',
      baseSpot({ inPosition: false }),
      cards('Kd7h2c'),
      bet,
      null,
      null
    );

    const fIpPaired = holdemPricedFold(ipPaired.foldAtReference, bet, pot);
    const fIpDry = holdemPricedFold(ipDry.foldAtReference, bet, pot);
    const fIpMono = holdemPricedFold(ipMono.foldAtReference, bet, pot);
    const fIpLowSpr = holdemPricedFold(ipLowSpr.foldAtReference, bet, pot);
    const fOopDry = holdemPricedFold(oopDry.foldAtReference, bet, pot);

    // Exact recovery of measured live NLH empirical priors at 0.33 pot:
    expect(fIpDry).toBeCloseTo(
      holdemEmpiricalFlopCbetFoldPrior({
        bettorInPosition: true,
        potFraction: HOLDEM_PERSONA_PRICED_CBET_FRACTION,
        texture: 'unpaired_nonmono',
        spr: 10,
      }),
      6
    );
    expect(fIpPaired).toBeCloseTo(
      holdemEmpiricalFlopCbetFoldPrior({
        bettorInPosition: true,
        potFraction: HOLDEM_PERSONA_PRICED_CBET_FRACTION,
        texture: 'paired',
        spr: 10,
      }),
      6
    );
    expect(fIpDry).toBeGreaterThan(0.36); // fixes v1's biased 28.6%-32.0% under-prediction
    expect(fIpPaired).toBeGreaterThan(fIpDry);
    expect(fIpDry).toBeGreaterThan(fIpMono);
    expect(fIpDry).toBeGreaterThan(fIpLowSpr);
    expect(fIpDry).toBeGreaterThan(fOopDry);
    expect(fIpMono).toBeLessThan(0.31);
    expect(fIpLowSpr).toBeLessThan(0.29);
    expect(fOopDry).toBeCloseTo(HOLDEM_EMPIRICAL_FLOP_FOLD_TO_CBET.oop.small.rate, 6);
  });

  it('turn stab uses empirical turn IP/OOP fold rate', () => {
    const pot = 20;
    const bet = pot * HOLDEM_PERSONA_PRICED_STAB_FRACTION;
    const ipStab = holdemPersonaPricedAdjustSpot(
      'stab',
      baseSpot({ street: 'turn', pot, inPosition: true }),
      cards('Kd7h2c9s'),
      bet,
      null,
      null
    );
    const oopStab = holdemPersonaPricedAdjustSpot(
      'stab',
      baseSpot({ street: 'turn', pot, inPosition: false }),
      cards('Kd7h2c9s'),
      bet,
      null,
      null
    );
    const fIp = holdemPricedFold(ipStab.foldAtReference, bet, pot);
    const fOop = holdemPricedFold(oopStab.foldAtReference, bet, pot);
    expect(fIp).toBeCloseTo(HOLDEM_EMPIRICAL_TURN_FOLD_TO_BET.ip.medium.rate, 6);
    expect(fOop).toBeCloseTo(HOLDEM_EMPIRICAL_TURN_FOLD_TO_BET.oop.medium.rate, 6);
    expect(fIp).toBeGreaterThan(fOop);
  });

  it('trap uses empirical flop betWhenCheckedTo (33.50%) and OOP flop fold rate', () => {
    const pot = 10;
    const adj = holdemPersonaPricedAdjustSpot(
      'trap',
      baseSpot({ inPosition: false, villainToAct: true }),
      cards('Kd7h2c'),
      null,
      null,
      null
    );
    expect(adj.betWhenCheckedTo).toBeCloseTo(HOLDEM_EMPIRICAL_BET_WHEN_CHECKED_TO.flop.rate, 10);
    expect(adj.betWhenCheckedTo).toBeCloseTo(4548 / 13575, 10);
    // Half-pot OOP flop lead fold rate recovers measured OOP medium fold (35.0%), not pooled 43.5%:
    expect(holdemPricedFold(adj.foldAtReference, 0.5 * pot, pot)).toBeCloseTo(
      HOLDEM_EMPIRICAL_FLOP_FOLD_TO_CBET.oop.medium.rate,
      6
    );
  });

  it('check_raise consumes estimateHoldemFoldToRaisePrior (#11759) on flop raises instead of hero-add/pot overestimate', () => {
    // Pot 15 (includes villain's 5 bet: villainIn=5, heroIn=0). Hero check-raises to 23 (matched=23, villainCall=18).
    const xrSpot = baseSpot({
      pot: 15,
      currentBet: 5,
      heroIn: 0,
      villainIn: 5,
      heroStack: 100,
      villainStack: 100,
      inPosition: false,
      heroMade: true,
    });
    const adj = holdemPersonaPricedAdjustSpot(
      'check_raise',
      xrSpot,
      cards('Kd7h2c'),
      23,
      null,
      null
    );
    const expected = estimateHoldemFoldToRaisePrior({
      street: 'flop',
      raiseToBetRatio: 23 / 5,
      raiseToPotRatio: 23 / 15,
      opponentsInPot: 1,
      spr: 100 / 15,
      isAllInRaise: false,
      hudOpp: null,
    });
    const f = holdemPricedFold(adj.foldAtReference, 23, 15);
    expect(f).toBeCloseTo(expected.mean, 6);
    expect(f).toBeLessThan(0.5); // eliminates the ~0.78 raise-price overestimate

    // Low-SPR / all-in check-raise reduces villain fold-to-raise prior monotonically:
    const jamSpot = baseSpot({
      pot: 15,
      currentBet: 5,
      heroIn: 0,
      villainIn: 5,
      heroStack: 23,
      villainStack: 23,
      inPosition: false,
      heroMade: true,
    });
    const adjJam = holdemPersonaPricedAdjustSpot(
      'check_raise',
      jamSpot,
      cards('Kd7h2c'),
      23,
      null,
      null
    );
    expect(holdemPricedFold(adjJam.foldAtReference, 23, 15)).toBeLessThan(f);

    // OpponentHud f.fRaise ([opportunities, hits]) shrinks the check-raise fold rate smoothly toward the opponent's rate:
    const stickyHud = { eff: { 'f.fRaise': [20, 2] as const } };
    const adjSticky = holdemPersonaPricedAdjustSpot(
      'check_raise',
      xrSpot,
      cards('Kd7h2c'),
      23,
      stickyHud,
      null
    );
    expect(holdemPricedFold(adjSticky.foldAtReference, 23, 15)).toBeLessThan(f);
  });

  it('end-to-end: low SPR (< 3) lowers fold equity relative to deep SPR on an IP dry flop c-bet', () => {
    // Deep SPR (195/11 = 17.7) vs low SPR (22/11 = 2.0) on the exact same marginal hand Ah3c on Kd8h2s:
    // at deep SPR the empirical IP small c-bet prior (~37.9%) is higher than at low SPR (~27.3%).
    const deep = run(cbet('Ah3c', 'Kd8h2s', [195, 195]), ON, null, 4);
    const lowSpr = run(cbet('Ah3c', 'Kd8h2s', [22, 22]), ON, null, 4);
    const deepTaken = count(deep, 'holdem_persona_postflop_priced_cbet_taken');
    const lowSprDeclined = count(lowSpr, 'holdem_persona_postflop_priced_cbet_declined');
    expect(deepTaken + count(deep, 'holdem_persona_postflop_priced_cbet_declined')).toBe(4);
    expect(lowSprDeclined).toBe(4);
  });
});
