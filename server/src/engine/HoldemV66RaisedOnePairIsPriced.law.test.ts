/**
 * LAW: v66BetRaisedOnePairIsPriced (2026-11-21, Horse Switch lane, DARK / DEFAULT OFF).
 *
 * Proves every invariant of the dark default-OFF priced replacement for V66 (flop/turn bet-then-raised one pair):
 *  1. Pure pricing math: EV(call) = R * eq * netPotAfterCall - callable vs EV(fold) = 0; NO fixed 0.42 floor, NO
 *     hardcoded class fold/jam; exact tie folds; all-in realizes 100%; realization tapers smoothly with SPR, street,
 *     position, and board scare texture; raise line range narrows monotonically with raise size.
 *  2. Strictly dark & default OFF (`=== true`): absent, false, or truthy non-boolean values are 100% bit-identical
 *     to main across NLH cash, MTT, Lightning, PLO4, PLO5, PLO6, and PLO8 (Hi-Lo).
 *  3. ON behavior: calls good-price flop/turn raises with top pair top kicker, folds weak/dominated pairs and air
 *     facing expensive raises, adapts monotonically to raise size and wet/scare boards, never jams/re-raises as a
 *     bluff-catcher, works identically whether v66BetRaisedOnePair is true OR false (independent of parent), draws
 *     nothing from fastRandom, and leaves PLO4/5/6, Hi-Lo, river, real draws, two pair, sets, and multiway untouched.
 *  4. Registration: flag + receipts in HorseDataLedger, source in HorseReferenceDecisionSources, and dark refusal in
 *     HorseOptionSwitch (zero SQL migrations until graded).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { HORSE_DATA_LEDGER } from './HorseDataLedger.js';
import { seedFastRandom } from './HorseEval.js';
import { HorseLogic } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { OPTION_SWITCH_REFUSED } from './HorseOptionSwitch.js';
import { HORSE_REFERENCE_DECISION_SOURCE_REASONS } from './HorseReferenceDecisionSources.js';
import {
  V66_PRICED_REALIZATION_FLOOR,
  V66_RAISED_ONE_PAIR_PRICED_RECEIPTS,
  v66BoardScareTexture,
  v66RaiseLineKeep,
  v66RaisedOnePairPricedApplies,
  v66RaisedOnePairPricedVerdict,
} from './HorseHoldemV66RaisedOnePairIsPriced.js';
import type { Card, CardRank, CardSuit, SeatPlayer } from '../types.js';

const SUITS: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
function cards(text: string): Card[] {
  const out: Card[] = [];
  for (let i = 0; i + 1 < text.length; i += 2) {
    out.push({ rank: text[i] as CardRank, suit: SUITS[text[i + 1]] });
  }
  return out;
}

const fireCounts = () => Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));

interface RaisedSpot {
  variant?: string;
  hole: string;
  board: string;
  street: 'flop' | 'turn' | 'river';
  mode?: 'cash' | 'tournament';
  lightning?: boolean;
  stackChips?: number;
  villainStackChips?: number;
  heroBet?: number;
  raiseTo?: number;
  heroOop?: boolean;
  multiway?: boolean;
  hiLo?: boolean;
}

function buildBetRaisedSpot(f: RaisedSpot) {
  const stackChips = f.stackChips ?? 200;
  const villainStackChips = f.villainStackChips ?? stackChips;
  const heroBet = f.heroBet ?? 8;
  const raiseTo = f.raiseTo ?? 24;
  const heroSeat = f.heroOop ? 2 : 1;
  const villainSeat = f.heroOop ? 1 : 2;
  const hero: SeatPlayer = {
    seat: heroSeat,
    user_id: 'hero',
    username: 'h',
    stack: Math.max(0, stackChips - 6 - heroBet),
    bet: heroBet,
    totalInvested: 6 + heroBet,
    cards: cards(f.hole),
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
  };
  const villain: SeatPlayer = {
    seat: villainSeat,
    user_id: 'villain',
    username: 'v',
    stack: Math.max(0, villainStackChips - 6 - raiseTo),
    bet: raiseTo,
    totalInvested: 6 + raiseTo,
    cards: [],
    is_folded: false,
    is_all_in: villainStackChips - 6 - raiseTo <= 0,
    is_sitting_out: false,
  };
  const players: SeatPlayer[] = [hero, villain];
  if (f.multiway) {
    players.push({
      seat: 3,
      user_id: 'third',
      username: 't',
      stack: stackChips - 6,
      bet: 0,
      totalInvested: 6,
      cards: [],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
    });
  }
  const history: Array<Record<string, unknown>> = [
    { stage: 'preflop', seat: heroSeat, userId: 'hero', action: 'raise', amount: 6, timestamp: 1 },
    {
      stage: 'preflop',
      seat: villainSeat,
      userId: 'villain',
      action: 'call',
      amount: 4,
      timestamp: 2,
    },
  ];
  if (f.multiway) {
    history.push({
      stage: 'preflop',
      seat: 3,
      userId: 'third',
      action: 'call',
      amount: 4,
      timestamp: 3,
    });
  }
  const streets: Array<'flop' | 'turn' | 'river'> = ['flop', 'turn', 'river'];
  for (const st of streets) {
    if (st === f.street) break;
    history.push({
      stage: st,
      seat: villainSeat,
      userId: 'villain',
      action: 'check',
      amount: 0,
      timestamp: 4,
    });
    history.push({
      stage: st,
      seat: heroSeat,
      userId: 'hero',
      action: 'check',
      amount: 0,
      timestamp: 5,
    });
  }
  if (!f.heroOop) {
    history.push({
      stage: f.street,
      seat: villainSeat,
      userId: 'villain',
      action: 'check',
      amount: 0,
      timestamp: 6,
    });
  }
  history.push({
    stage: f.street,
    seat: heroSeat,
    userId: 'hero',
    action: 'bet',
    amount: heroBet,
    timestamp: 7,
  });
  history.push({
    stage: f.street,
    seat: villainSeat,
    userId: 'villain',
    action: 'raise',
    amount: raiseTo,
    timestamp: 8,
  });
  const potBase = f.multiway ? 18 : 12;
  return {
    hero,
    gs: {
      players,
      communityCards: cards(f.board),
      pot: potBase + heroBet + raiseTo,
      currentBet: raiseTo,
      minRaise: raiseTo - heroBet,
      stage: f.street,
      gameVariant: f.variant ?? 'nlh',
      gameMode: f.mode ?? 'cash',
      bigBlind: 2,
      dealerSeat: 2,
      actionHistory: history,
      ...(f.lightning ? { publicMemoryDomain: { speed: 'lightning' } } : {}),
      ...(f.hiLo ? { variantRules: { splitLow8OrBetter: true } } : {}),
    },
  };
}

function decideOne(f: RaisedSpot, opts: Record<string, unknown>, seed = 0x66123) {
  seedFastRandom(seed);
  HorseMind.reset();
  drainFires();
  const spot = buildBetRaisedSpot(f);
  const decision = HorseLogic.decide(spot.hero, spot.gs as never, 'balanced', {}, {
    telemetry: true,
    observeMind: false,
    ...opts,
  } as never);
  const fires = fireCounts();
  // Strip one-time per-process reservoir init receipts so first-call vs second-call comparisons are pure.
  for (const k of Object.keys(fires)) {
    if (/^upgrade04_omaha_reservoir_\d+_seen$/.test(k)) delete fires[k];
  }
  return {
    decision: {
      action: decision.action,
      amount: decision.amount ?? null,
      thinkTime: decision.thinkTime,
    },
    fires,
  };
}

describe('HorseHoldemV66RaisedOnePairIsPriced: pure pricing math', () => {
  it('gate requires strict boolean true and single-board 2-card NLH flop/turn bluff-catch without draws', () => {
    const base = {
      enabled: true,
      street: 'flop',
      raisedAfterAggr: true,
      isTournament: false,
      isOmaha: false,
      isShortDeck: false,
      isFixedLimit: false,
      holeCount: 2,
      playerCardCount: 2,
      multiBoard: false,
      bombPot: false,
      cat: 2,
      pairedBoard: false,
      hasRealDraw: false,
      toCall: 16,
      pot: 44,
    };
    expect(v66RaisedOnePairPricedApplies(base)).toBe(true);
    expect(v66RaisedOnePairPricedApplies({ ...base, street: 'turn' })).toBe(true);
    expect(v66RaisedOnePairPricedApplies({ ...base, cat: 3, pairedBoard: true })).toBe(true);
    // Strict dark default OFF: only literal true enables it
    for (const disabled of [undefined, false, 1, 'true', {}]) {
      expect(v66RaisedOnePairPricedApplies({ ...base, enabled: disabled })).toBe(false);
    }
    // Exclusions: tournaments (ICM guard), Omaha, Short Deck, Fixed Limit, river, real draw, two pair on unpaired board, multi-board, bomb pot
    expect(v66RaisedOnePairPricedApplies({ ...base, isTournament: true })).toBe(false);
    expect(v66RaisedOnePairPricedApplies({ ...base, isOmaha: true })).toBe(false);
    expect(v66RaisedOnePairPricedApplies({ ...base, isShortDeck: true })).toBe(false);
    expect(v66RaisedOnePairPricedApplies({ ...base, isFixedLimit: true })).toBe(false);
    expect(v66RaisedOnePairPricedApplies({ ...base, street: 'river' })).toBe(false);
    expect(v66RaisedOnePairPricedApplies({ ...base, hasRealDraw: true })).toBe(false);
    expect(v66RaisedOnePairPricedApplies({ ...base, cat: 3, pairedBoard: false })).toBe(false);
    expect(v66RaisedOnePairPricedApplies({ ...base, multiBoard: true })).toBe(false);
    expect(v66RaisedOnePairPricedApplies({ ...base, bombPot: true })).toBe(false);
  });

  it('verdict prices strictly by EV(call) vs 0 with NO fixed 0.42 floor and smooth SPR/scare realization', () => {
    // Below 0.42 raw equity (0.26), facing cheap all-in pot odds (20 / 100 = 0.20): EV > 0 -> CALLS (no 0.42 floor!)
    const cheapAllIn = v66RaisedOnePairPricedVerdict({
      street: 'turn',
      inPosition: true,
      pot: 80,
      toCall: 20,
      heroStack: 20,
      villainStack: 0,
      rawEquity: 0.26,
      scareTexture: 0,
    });
    expect(cheapAllIn.realization).toBe(1);
    expect(cheapAllIn.potOdds).toBeCloseTo(0.2, 6);
    expect(cheapAllIn.evCall).toBeGreaterThan(0);
    expect(cheapAllIn.decision).toBe('call');

    // Above 0.42 raw equity (0.43), facing expensive raise pot odds (45 / 100 = 0.45): EV < 0 -> FOLDS!
    const expensive = v66RaisedOnePairPricedVerdict({
      street: 'turn',
      inPosition: true,
      pot: 55,
      toCall: 45,
      heroStack: 45,
      villainStack: 0,
      rawEquity: 0.43,
      scareTexture: 0,
    });
    expect(expensive.evCall).toBeLessThan(0);
    expect(expensive.decision).toBe('fold');

    // Exact break-even tie folds
    const tie = v66RaisedOnePairPricedVerdict({
      street: 'flop',
      inPosition: true,
      pot: 75,
      toCall: 25,
      heroStack: 25,
      villainStack: 0,
      rawEquity: 0.25,
      scareTexture: 0,
    });
    expect(tie.evCall).toBeCloseTo(0, 9);
    expect(tie.decision).toBe('fold');

    // Deep OOP on a scary flop realizes strictly less than IP on a dry turn, bounded above floor
    const dryTurnIp = v66RaisedOnePairPricedVerdict({
      street: 'turn',
      inPosition: true,
      pot: 40,
      toCall: 16,
      heroStack: 300,
      villainStack: 300,
      rawEquity: 0.4,
      scareTexture: 0,
    });
    const wetFlopOop = v66RaisedOnePairPricedVerdict({
      street: 'flop',
      inPosition: false,
      pot: 40,
      toCall: 16,
      heroStack: 300,
      villainStack: 300,
      rawEquity: 0.4,
      scareTexture: 0.9,
    });
    expect(wetFlopOop.realization).toBeLessThan(dryTurnIp.realization);
    expect(wetFlopOop.realization).toBeGreaterThanOrEqual(V66_PRICED_REALIZATION_FLOOR);

    // Over-shove unmatched excess: villain shoves 200 over hero's bet of 8 into pre-raise pot 12 (pot = 220,
    // toCall = 192), while hero has only 30 behind. Unmatched excess is 162, so effective potAfterCall is
    // (220 - 162) + 30 = 88 and potOdds = 30 / 88 (~0.3409), NOT 30 / 250 (0.12). With 0.25 equity hero folds.
    const overShove = v66RaisedOnePairPricedVerdict({
      street: 'turn',
      inPosition: true,
      pot: 220,
      toCall: 192,
      heroStack: 30,
      villainStack: 0,
      rawEquity: 0.25,
      scareTexture: 0,
    });
    expect(overShove.callable).toBe(30);
    expect(overShove.potAfterCall).toBe(88);
    expect(overShove.potOdds).toBeCloseTo(30 / 88, 6);
    expect(overShove.realization).toBe(1);
    expect(overShove.evCall).toBeLessThan(0);
    expect(overShove.decision).toBe('fold');
  });

  it('board scare texture and raise-line narrowing respond monotonically to wetness, raise size, street, and style', () => {
    const dry = v66BoardScareTexture(cards('Qh7d2s'));
    const paired = v66BoardScareTexture(cards('QhQd2s'));
    const monotoneWet = v66BoardScareTexture(cards('QhJhTh9h'));
    expect(dry).toBe(0);
    expect(paired).toBeGreaterThan(dry);
    expect(monotoneWet).toBeGreaterThan(paired);
    expect(monotoneWet).toBeLessThanOrEqual(1);

    const smallFlop = v66RaiseLineKeep({
      street: 'flop',
      betShare: 0.45,
      posteriorBluffShare: 0.4,
      raisePotFrac: 0.35,
      scareTexture: 0,
    });
    const bigFlop = v66RaiseLineKeep({
      street: 'flop',
      betShare: 0.45,
      posteriorBluffShare: 0.4,
      raisePotFrac: 1.5,
      scareTexture: 0,
    });
    const turnSame = v66RaiseLineKeep({
      street: 'turn',
      betShare: 0.45,
      posteriorBluffShare: 0.4,
      raisePotFrac: 0.35,
      scareTexture: 0,
    });
    const tightRaiser = v66RaiseLineKeep({
      street: 'flop',
      betShare: 0.45,
      posteriorBluffShare: 0.4,
      raisePotFrac: 0.35,
      scareTexture: 0,
      raiseAggressionShift: -0.1,
    });
    const aggroRaiser = v66RaiseLineKeep({
      street: 'flop',
      betShare: 0.45,
      posteriorBluffShare: 0.4,
      raisePotFrac: 0.35,
      scareTexture: 0,
      raiseAggressionShift: 0.12,
    });
    expect(bigFlop.keepScale).toBeLessThan(smallFlop.keepScale);
    expect(turnSame.bluffShare).toBeLessThan(smallFlop.bluffShare);
    expect(tightRaiser.bluffShare).toBeLessThan(smallFlop.bluffShare);
    expect(aggroRaiser.bluffShare).toBeGreaterThan(smallFlop.bluffShare);
  });
});

describe('v66BetRaisedOnePairIsPriced: dark default-OFF parity across all formats', () => {
  beforeEach(() => {
    enableBrainTelemetry();
    drainFires();
  });

  const allFormatSpots: Array<[string, RaisedSpot]> = [
    ['NLH cash flop TPTK', { hole: 'AsQd', board: 'Qh7d2s', street: 'flop', mode: 'cash' }],
    ['NLH cash turn underpair', { hole: '7s6d', board: 'Qh7d2s4c', street: 'turn', mode: 'cash' }],
    ['NLH cash flop air', { hole: 'Ks9d', board: 'Qh7d2s', street: 'flop', mode: 'cash' }],
    [
      'NLH MTT flop TPTK',
      { hole: 'AsQd', board: 'Qh7d2s', street: 'flop', mode: 'tournament', raiseTo: 32 },
    ],
    [
      'NLH Lightning turn TPTK',
      { hole: 'AsQd', board: 'Qh7d2s4c', street: 'turn', mode: 'cash', lightning: true },
    ],
    [
      'PLO4 cash flop',
      { variant: 'plo4', hole: 'AsQdTc5c', board: 'Qh7d2s', street: 'flop', mode: 'cash' },
    ],
    [
      'PLO5 cash turn',
      { variant: 'plo5', hole: 'AsQdTc5c3h', board: 'Qh7d2s4c', street: 'turn', mode: 'cash' },
    ],
    [
      'PLO6 cash flop',
      { variant: 'plo6', hole: 'AsQdTc5c3h2c', board: 'Qh7d2s', street: 'flop', mode: 'cash' },
    ],
    [
      'PLO8 Hi-Lo flop',
      {
        variant: 'plo8',
        hole: 'AsQd3c2h',
        board: 'Qh7d2s',
        street: 'flop',
        mode: 'cash',
        hiLo: true,
      },
    ],
  ];

  it('OFF (absent, false, or non-boolean truthy) is 100% bit-identical to main across all formats', () => {
    for (const [label, spot] of allFormatSpots) {
      const baseline = decideOne(spot, {});
      for (const offOpt of [
        { v66BetRaisedOnePairIsPriced: false },
        { v66BetRaisedOnePairIsPriced: undefined },
        { v66BetRaisedOnePairIsPriced: 1 },
        { v66BetRaisedOnePairIsPriced: 'true' },
      ]) {
        const res = decideOne(spot, offOpt);
        expect(res, `${label} ${JSON.stringify(offOpt)}`).toEqual(baseline);
        expect(res.fires[V66_RAISED_ONE_PAIR_PRICED_RECEIPTS.callTaken]).toBeUndefined();
        expect(res.fires[V66_RAISED_ONE_PAIR_PRICED_RECEIPTS.foldTaken]).toBeUndefined();
        expect(res.fires[V66_RAISED_ONE_PAIR_PRICED_RECEIPTS.unpriced]).toBeUndefined();
      }
    }
  });
});

describe('v66BetRaisedOnePairIsPriced: ON behavior, pricing, independence, and isolation', () => {
  beforeEach(() => {
    enableBrainTelemetry();
    drainFires();
  });

  it('calls cheap flop raises with TPTK and folds weak pairs / air facing expensive raises without jamming', () => {
    // Cheap flop min-raise (hero bets 8 into 12, villain raises to 16 -> toCall 8 into 36, potOdds ~ 18.2%)
    const cheapTptk = decideOne(
      { hole: 'AsQd', board: 'Qh7d2s', street: 'flop', heroBet: 8, raiseTo: 16 },
      { v66BetRaisedOnePairIsPriced: true }
    );
    expect(cheapTptk.decision.action).toBe('call');
    expect(cheapTptk.fires[V66_RAISED_ONE_PAIR_PRICED_RECEIPTS.callTaken]).toBe(1);

    // Expensive flop raise with underpair (7s6d on Qh7d2s facing 4x raise to 32)
    const expUnderpair = decideOne(
      { hole: '7s6d', board: 'Qh7d2s', street: 'flop', heroBet: 8, raiseTo: 32 },
      { v66BetRaisedOnePairIsPriced: true }
    );
    expect(expUnderpair.decision.action).toBe('fold');
    expect(expUnderpair.fires[V66_RAISED_ONE_PAIR_PRICED_RECEIPTS.foldTaken]).toBe(1);

    // Expensive flop raise with air (Ks9d on Qh7d2s facing 3x raise to 24)
    const expAir = decideOne(
      { hole: 'Ks9d', board: 'Qh7d2s', street: 'flop', heroBet: 8, raiseTo: 24 },
      { v66BetRaisedOnePairIsPriced: true }
    );
    expect(expAir.decision.action).toBe('fold');
    expect(expAir.fires[V66_RAISED_ONE_PAIR_PRICED_RECEIPTS.foldTaken]).toBe(1);

    // Expensive OOP turn over-raise on a scary monotone/connected board folds weak top pair
    const scaryTurnFold = decideOne(
      {
        hole: 'Qc8d',
        board: 'QhJhTh4h',
        street: 'turn',
        heroBet: 8,
        raiseTo: 56,
        heroOop: true,
      },
      { v66BetRaisedOnePairIsPriced: true }
    );
    expect(scaryTurnFold.decision.action).toBe('fold');
    expect(scaryTurnFold.fires[V66_RAISED_ONE_PAIR_PRICED_RECEIPTS.foldTaken]).toBe(1);
  });

  it('is independent of v66BetRaisedOnePair: identical call/fold and never jams when parent V66 is OFF', () => {
    const spots: RaisedSpot[] = [
      { hole: 'AsQd', board: 'Qh7d2s', street: 'flop', heroBet: 8, raiseTo: 16 },
      { hole: '7s6d', board: 'Qh7d2s', street: 'flop', heroBet: 8, raiseTo: 32 },
      { hole: 'Ks9d', board: 'Qh7d2s4c', street: 'turn', heroBet: 8, raiseTo: 24 },
      // Short-stack committed spot where turning V66 off would otherwise hit the fixed 0.42 floor / jam
      { hole: '7s6d', board: 'Qh7d2s4c', street: 'turn', stackChips: 46, heroBet: 12, raiseTo: 32 },
    ];
    for (const spot of spots) {
      const parentOn = decideOne(spot, {
        v66BetRaisedOnePair: true,
        v66BetRaisedOnePairIsPriced: true,
      });
      const parentOff = decideOne(spot, {
        v66BetRaisedOnePair: false,
        v66BetRaisedOnePairIsPriced: true,
      });
      expect(parentOff.decision.action).toBe(parentOn.decision.action);
      expect(parentOff.decision.amount).toBe(parentOn.decision.amount);
      expect(['call', 'fold']).toContain(parentOff.decision.action);
    }
  });

  it('is 100% deterministic across fastRandom seeds (draws nothing from fastRandom)', () => {
    const spot: RaisedSpot = {
      hole: 'AsQd',
      board: 'Qh7d2s4c',
      street: 'turn',
      heroBet: 8,
      raiseTo: 24,
    };
    const first = decideOne(spot, { v66BetRaisedOnePairIsPriced: true }, 101);
    for (const seed of [202, 303, 99999, 0xdeadbeef]) {
      const next = decideOne(spot, { v66BetRaisedOnePairIsPriced: true }, seed);
      expect(next.decision.action).toBe(first.decision.action);
      expect(next.decision.amount).toBe(first.decision.amount);
    }
  });

  it('never alters PLO4/5/6, Hi-Lo, river, real draws, two pair, sets, or multiway spots', () => {
    const excluded: Array<[string, RaisedSpot]> = [
      ['PLO4', { variant: 'plo4', hole: 'AsQdTc5c', board: 'Qh7d2s', street: 'flop' }],
      ['PLO5', { variant: 'plo5', hole: 'AsQdTc5c3h', board: 'Qh7d2s4c', street: 'turn' }],
      ['PLO6', { variant: 'plo6', hole: 'AsQdTc5c3h2c', board: 'Qh7d2s', street: 'flop' }],
      ['PLO8', { variant: 'plo8', hole: 'AsQd3c2h', board: 'Qh7d2s', street: 'flop', hiLo: true }],
      ['NLH river', { hole: 'AsQd', board: 'Qh7d2s4c9h', street: 'river' }],
      ['NLH flush draw', { hole: 'AhJh', board: 'Qh7h2s', street: 'flop' }],
      ['NLH OESD', { hole: 'Ts9d', board: 'Jh8d2s', street: 'flop' }],
      ['NLH two pair', { hole: 'Qs7c', board: 'Qh7d2s', street: 'flop' }],
      ['NLH set', { hole: '7s7c', board: 'Qh7d2s', street: 'flop' }],
    ];
    for (const [label, spot] of excluded) {
      const off = decideOne(spot, { v66BetRaisedOnePairIsPriced: false });
      const on = decideOne(spot, { v66BetRaisedOnePairIsPriced: true });
      expect(on, label).toEqual(off);
    }

    // Multiway falls through unpriced (fires unpriced receipt, preserves exact OFF decision)
    const mwSpot: RaisedSpot = { hole: 'AsQd', board: 'Qh7d2s', street: 'flop', multiway: true };
    const mwOff = decideOne(mwSpot, { v66BetRaisedOnePairIsPriced: false });
    const mwOn = decideOne(mwSpot, { v66BetRaisedOnePairIsPriced: true });
    expect(mwOn.decision).toEqual(mwOff.decision);
    expect(mwOn.fires[V66_RAISED_ONE_PAIR_PRICED_RECEIPTS.unpriced]).toBe(1);
  });

  it('prices over-shove unmatched excess accurately and never bypasses tournament ICM', () => {
    // Villain covers hero and over-shoves 180 over hero's bet of 8 when hero only has 8 chips behind (toCall = 172):
    // effective potAfterCall is 44 (potOdds = 8 / 44 = 18.2%); TPTK takes the priced call (clamped to stack before
    // legalize normalizes an all-in call to action 'all_in', never leaking raw toCall = 172).
    const overShoveCall = decideOne(
      {
        hole: 'AsQd',
        board: 'Qh7d2s',
        street: 'flop',
        stackChips: 22,
        villainStackChips: 200,
        heroBet: 8,
        raiseTo: 180,
      },
      { v66BetRaisedOnePairIsPriced: true }
    );
    expect(overShoveCall.decision.action).toBe('all_in');
    expect(overShoveCall.decision.amount).not.toBe(172);
    expect(overShoveCall.fires[V66_RAISED_ONE_PAIR_PRICED_RECEIPTS.callTaken]).toBe(1);

    // Over-shove unmatched excess fold: weak pair facing villain's 200 over-shove with only 30 behind folds once
    // the 162 uncallable excess is subtracted from the pot (true potOdds 30 / 88 = 34.1%, not fake 30 / 250 = 12%).
    const overShoveFold = decideOne(
      {
        hole: '7s6d',
        board: 'Qh7d2s4c',
        street: 'turn',
        stackChips: 44,
        villainStackChips: 210,
        heroBet: 8,
        raiseTo: 200,
      },
      { v66BetRaisedOnePairIsPriced: true }
    );
    expect(overShoveFold.decision.action).toBe('fold');
    expect(overShoveFold.fires[V66_RAISED_ONE_PAIR_PRICED_RECEIPTS.foldTaken]).toBe(1);

    // Tournament mode (regular raise AND all-in raise): gate refuses so tournament ICM/survival arbiter is never bypassed
    const tourneySpots: Array<[string, RaisedSpot]> = [
      [
        'MTT flop raise',
        {
          hole: 'AsQd',
          board: 'Qh7d2s',
          street: 'flop',
          mode: 'tournament',
          heroBet: 8,
          raiseTo: 16,
        },
      ],
      [
        'MTT all-in over-shove',
        {
          hole: 'AsQd',
          board: 'Qh7d2s',
          street: 'flop',
          mode: 'tournament',
          stackChips: 30,
          villainStackChips: 200,
          heroBet: 8,
          raiseTo: 180,
        },
      ],
    ];
    for (const [label, spot] of tourneySpots) {
      const off = decideOne(spot, { v66BetRaisedOnePairIsPriced: false });
      const on = decideOne(spot, { v66BetRaisedOnePairIsPriced: true });
      expect(on, label).toEqual(off);
      expect(on.fires[V66_RAISED_ONE_PAIR_PRICED_RECEIPTS.callTaken]).toBeUndefined();
      expect(on.fires[V66_RAISED_ONE_PAIR_PRICED_RECEIPTS.foldTaken]).toBeUndefined();
      expect(on.fires[V66_RAISED_ONE_PAIR_PRICED_RECEIPTS.unpriced]).toBeUndefined();
    }
  });

  it('is registered in HorseDataLedger, HorseReferenceDecisionSources, and OPTION_SWITCH_REFUSED', () => {
    expect(
      HORSE_DATA_LEDGER.some((e) => e.kind === 'flag' && e.key === 'v66BetRaisedOnePairIsPriced')
    ).toBe(true);
    for (const receiptKey of Object.values(V66_RAISED_ONE_PAIR_PRICED_RECEIPTS)) {
      expect(
        HORSE_DATA_LEDGER.some((e) => e.kind === 'receipt' && e.key === receiptKey),
        receiptKey
      ).toBe(true);
    }
    expect(
      HORSE_REFERENCE_DECISION_SOURCE_REASONS['src/engine/HorseHoldemV66RaisedOnePairIsPriced.ts']
    ).toBeDefined();
    expect(OPTION_SWITCH_REFUSED.v66BetRaisedOnePairIsPriced).toBeDefined();
  });
});
