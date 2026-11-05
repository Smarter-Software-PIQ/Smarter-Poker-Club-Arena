import { describe, expect, it } from 'vitest';
import { decidePreflopV7, type PreflopCtx } from './HorsePreflop.js';
import { cashNlhThreeBetRaiseTo } from './HorseCashThreeBetSize.js';
import { HorseLogic, holdemPremiumAggression, type HorseGameStateV2 } from './HorseLogic.js';
import { resolveHorseHybridProfile } from './HorseHybridProfile.js';
import { seedFastRandom } from './HorseEval.js';
import type { ActionRecord, HandConfig, SeatPlayer } from '../types.js';
import { HandController } from './HandController.js';

const ctx = (extra: Record<string, unknown> = {}): PreflopCtx =>
  ({
    position: 'late',
    raiserPosition: 'early',
    strength: 0.99,
    raises: 1,
    limpers: 0,
    callers: 0,
    oppsLeft: 3,
    toCall: 3,
    currentBet: 3,
    pot: 4.5,
    contestablePot: 4.5,
    bigBlind: 1,
    stack: 100,
    stackBB: 100,
    effectiveStackBB: 100,
    tightness: 1,
    bluffFreq: 0,
    aggression: 1,
    slowplayFreq: 0,
    sizingMultiplier: 0.88 * 0.94,
    isOmaha: false,
    isPotLimit: false,
    riskAdd: 0,
    mode: 'cash',
    tableSize: 6,
    rand: () => 0.25,
    cashThreeBetSizing: { inPosition: true, depthBB: 100 },
    ...extra,
  }) as PreflopCtx;

describe('cash 3-bets keep their position-specific size after profile dials', () => {
  it('the hybrid raises a 3BB open to at least 9BB in position', () => {
    const d = decidePreflopV7(ctx());
    expect(d.a).toBe('raiseTo');
    expect(d.to).toBeGreaterThanOrEqual(9);
  });

  it('the hybrid raises a 3BB button open to at least 12BB from the blinds', () => {
    const d = decidePreflopV7(
      ctx({
        position: 'sb',
        raiserPosition: 'late',
        toCall: 2.5,
        cashThreeBetSizing: { inPosition: false, depthBB: 100 },
      })
    );
    expect(d.a).toBe('raiseTo');
    expect(d.to).toBeGreaterThanOrEqual(12);
  });

  it('a small opening size does not drag a normal-depth 3-bet down to 5BB', () => {
    const d = decidePreflopV7(ctx({ currentBet: 2, toCall: 2, pot: 3.5 }));
    expect(d.a).toBe('raiseTo');
    expect(d.to).toBeGreaterThanOrEqual(8);
  });
});

describe('one cash sizing rule for value, bluffs and squeezes', () => {
  it.each([0, 1, 2])('value and bluff sizes match with %i callers', (callers) => {
    const common = { callers, rand: () => 0.01, bluffFreq: 1, holdsAce: true };
    const value = decidePreflopV7(ctx({ ...common, strength: 0.99 }));
    const bluff = decidePreflopV7(ctx({ ...common, strength: 0.6 }));
    expect(value.a).toBe('raiseTo');
    expect(bluff.a).toBe('raiseTo');
    expect(bluff.to).toBe(value.to);
  });

  it('each cold caller adds one opening raise', () => {
    const args = {
      inPosition: true,
      depthBB: 100,
      openTo: 3,
      bigBlind: 1,
      rand: () => 0.25,
    };
    const base = cashNlhThreeBetRaiseTo({ ...args, callers: 0 });
    for (const callers of [1, 2, 3])
      expect(cashNlhThreeBetRaiseTo({ ...args, callers }) - base).toBe(callers * 3);
  });

  it('short stacks use smaller sizes and deep stacks larger sizes', () => {
    const args = {
      inPosition: false,
      callers: 0,
      openTo: 3,
      bigBlind: 1,
      rand: () => 0.5,
    };
    const size = (depthBB: number) => cashNlhThreeBetRaiseTo({ ...args, depthBB });
    expect(size(35)).toBeLessThan(size(100));
    expect(size(250)).toBeGreaterThan(size(100));
  });

  it('all draws stay above the cash floor on both grids and extreme dials', () => {
    for (const bigBlind of [0.1, 1, 2, 100])
      for (const inPosition of [true, false])
        for (const sizingMultiplier of [0.1, 0.8272, 1, 3])
          for (const u of [0, 0.1, 0.5, 0.99, 1]) {
            const d = decidePreflopV7(
              ctx({
                bigBlind,
                currentBet: 3 * bigBlind,
                toCall: 3 * bigBlind,
                stack: 100 * bigBlind,
                cashThreeBetSizing: { inPosition, depthBB: 100 },
                sizingMultiplier,
                rand: () => u,
              })
            );
            expect(d.a).toBe('raiseTo');
            const size = d.to!;
            expect(size / bigBlind).toBeGreaterThanOrEqual((inPosition ? 9 : 12) - 1e-9);
            expect(size / bigBlind).toBeLessThanOrEqual((inPosition ? 10.5 : 13.5) + 1 / bigBlind);
          }
  });

  it.each([
    { mode: 'tournament' },
    { isPotLimit: true, isOmaha: true },
    { isFixedLimit: true },
    { isShortDeck: true },
  ])('leaves other game owners unchanged: %o', (extra) => {
    expect(decidePreflopV7(ctx(extra))).toEqual(
      decidePreflopV7(ctx({ ...extra, cashThreeBetSizing: undefined }))
    );
  });
});

function facingOpen(
  heroSeat: number,
  openerSeat: number,
  options: {
    seats?: number;
    dealer?: number;
    bb?: number;
    openBB?: number;
    depthBB?: number;
    callers?: number[];
  } = {}
) {
  const n = options.seats ?? 6;
  const bb = options.bb ?? 1;
  const open = (options.openBB ?? 3) * bb;
  const depth = (options.depthBB ?? 100) * bb;
  const dealer = options.dealer ?? n;
  const callers = options.callers ?? [];
  const players = Array.from({ length: n }, (_, i) => {
    const seat = i + 1;
    const entered = seat === openerSeat || callers.includes(seat);
    const bet = entered ? open : seat === 1 ? bb / 2 : seat === 2 ? bb : 0;
    return {
      seat,
      user_id: `cash-size-${seat}`,
      username: `Seat${seat}`,
      stack: depth - bet,
      bet,
      totalInvested: bet,
      cards:
        seat === heroSeat
          ? [
              { rank: 'A', suit: 'spades' },
              { rank: 'A', suit: 'hearts' },
            ]
          : [],
      is_folded: !entered && seat !== heroSeat,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
    } as SeatPlayer;
  });
  const history = [
    {
      seat: openerSeat,
      userId: players[openerSeat - 1].user_id,
      action: 'raise',
      amount: open,
      stage: 'preflop',
      isFullRaise: true,
      timestamp: 1,
    },
    ...callers.map((seat, i) => ({
      seat,
      userId: players[seat - 1].user_id,
      action: 'call',
      amount: open,
      stage: 'preflop',
      timestamp: i + 2,
    })),
  ] as ActionRecord[];
  const hero = players[heroSeat - 1];
  const gs = {
    players,
    communityCards: [],
    pot: players.reduce((sum, p) => sum + p.bet, 0),
    currentBet: open,
    minRaise: open - bb,
    lastRaise: open - bb,
    stage: 'preflop',
    gameVariant: 'nlh',
    bettingStructure: 'no_limit',
    gameMode: 'cash',
    format: 'cash',
    bigBlind: bb,
    dealerSeat: dealer,
    actionHistory: history,
    dealtSeatIds: players.map((p) => p.seat),
    legalActions: ['fold', 'call', 'raise', 'all_in'],
    toCall: open - hero.bet,
    minRaiseTo: 2 * open - bb,
    maxRaiseTo: depth,
  } as HorseGameStateV2;
  return { hero, gs };
}

describe('final hybrid decisions use actual public position and legal wagers', () => {
  it.each(['open', 'isolate', 'three-bet'] as const)(
    'the real hand controller accepts the hybrid %s at its chosen size',
    (spot) => {
      const { gs: fixture } = facingOpen(6, 3);
      const hc = new HandController(
        {
          tableId: 'cash-sizing-local',
          handNumber: 1,
          gameVariant: 'nlh',
          smallBlind: 0.5,
          bigBlind: 1,
          rakeConfig: { percent: 0, cap: 0, noFlopNoDrop: true },
        } as HandConfig,
        fixture.players.map((p) => ({
          ...p,
          stack: 100,
          bet: 0,
          totalInvested: 0,
          is_folded: false,
          cards: [],
        })),
        6
      );
      hc.start();
      expect(hc.getState().currentPlayerSeat).toBe(3);
      expect(
        hc.performAction(
          3,
          spot === 'three-bet' ? 'raise' : spot === 'isolate' ? 'call' : 'fold',
          spot === 'three-bet' ? 3 : undefined
        )
      ).toBe(true);
      expect(hc.performAction(4, spot === 'isolate' ? 'call' : 'fold')).toBe(true);
      expect(hc.performAction(5, 'fold')).toBe(true);
      const state = hc.getState();
      expect(state.currentPlayerSeat).toBe(6);
      const actualHero = state.players.find((p) => p.seat === 6)!;
      // Local decision fixture uses a premium; acceptance is through the real
      // hand's legal wager owner. No settlement or production money is involved.
      const hero = { ...actualHero, cards: fixture.players[5].cards };
      const gs = {
        ...state,
        players: state.players.map((p) => (p.seat === 6 ? hero : { ...p, cards: [] })),
        gameVariant: 'nlh',
        gameMode: 'cash',
        format: 'cash',
        bigBlind: 1,
        bettingStructure: 'no_limit',
        dealerSeat: 6,
        dealtSeatIds: state.players.map((p) => p.seat),
        legalActions: ['fold', 'call', 'raise', 'all_in'],
        toCall: state.currentBet - hero.bet,
        minRaiseTo: state.currentBet + state.minRaise,
        maxRaiseTo: hero.stack + hero.bet,
      } as HorseGameStateV2;
      const { style, mods } = resolveHorseHybridProfile({}, 'sizing-test', 'cash');
      seedFastRandom(91);
      const d = HorseLogic.decide(hero, gs, style, mods, { mind: false, telemetry: false });
      expect(d.action).toBe('raise');
      expect(d.amount!).toBeGreaterThanOrEqual(
        spot === 'three-bet' ? 9 : spot === 'isolate' ? 4.5 : 2.5
      );
      expect(hc.performAction(6, 'raise', d.amount, 'horse_policy')).toBe(true);
      expect(hc.getState().actionHistory.at(-1)).toMatchObject({
        seat: 6,
        action: 'raise',
        amount: d.amount,
      });
    }
  );
  it.each([
    [6, 5, 9],
    [4, 3, 9],
    [1, 6, 12],
    [2, 6, 12],
    [2, 1, 9],
  ])('hero seat %i versus opener %i keeps floor %iBB', (heroSeat, openerSeat, floor) => {
    const { style, mods } = resolveHorseHybridProfile({}, 'sizing-test', 'cash');
    for (const bb of [0.1, 1, 2])
      for (let seed = 1; seed <= 12; seed++) {
        const { hero, gs } = facingOpen(heroSeat, openerSeat, { bb });
        seedFastRandom(seed);
        const d = HorseLogic.decide(hero, gs, style, mods, { mind: false, telemetry: false });
        expect(d.action).toBe('raise');
        expect(d.amount! / bb).toBeGreaterThanOrEqual(floor - 1e-9);
        expect(d.amount!).toBeLessThanOrEqual(gs.maxRaiseTo!);
      }
  });

  it('the genuinely heads-up BB is out of position to the button/SB', () => {
    const { style, mods } = resolveHorseHybridProfile({}, 'sizing-test', 'cash');
    const { hero, gs } = facingOpen(2, 1, { seats: 2, dealer: 1 });
    seedFastRandom(17);
    const d = HorseLogic.decide(hero, gs, style, mods, { mind: false, telemetry: false });
    expect(d.action).toBe('raise');
    expect(d.amount!).toBeGreaterThanOrEqual(12);
  });

  it('premium passive-action correction uses the same OOP squeeze size', () => {
    const { hero, gs } = facingOpen(1, 4, { callers: [5, 6] });
    seedFastRandom(17);
    const d = holdemPremiumAggression(
      { action: 'call', amount: gs.toCall, thinkTime: 0 },
      hero,
      gs,
      { telemetry: false }
    );
    expect(d.action).toBe('raise');
    expect(d.amount!).toBeGreaterThanOrEqual(18);
  });

  it('the final wager respects a short stack even when the band exceeds it', () => {
    const { hero, gs } = facingOpen(1, 6, { depthBB: 10 });
    const d = holdemPremiumAggression(
      { action: 'call', amount: gs.toCall, thinkTime: 0 },
      hero,
      gs,
      { telemetry: false }
    );
    expect(['raise', 'all_in']).toContain(d.action);
    if (d.action === 'raise') expect(d.amount!).toBeLessThanOrEqual(10);
  });
});
