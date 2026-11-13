/**
 * THE EVIDENCE COUNTERS ADDED FOR THE UPGRADES THAT HAD NONE (2026-11-12).
 *
 * Range posteriors (01), card removal (02), the Omaha reservoir (04), the
 * public timing hint (06), the fast recency window (10) and persona
 * indifference mixing (11) each ran with nothing the serving engine emitted
 * to show it. Each now counts on its own path. These cases drive the real
 * producers and assert the counter moves when the path does; the
 * telemetry-gated ones are also shown silent with telemetry off, with the
 * same action, amount and think time either way. Side games (08) and the pre-action purge
 * (09) are asserted where their fixtures already live
 * (HorseActionSpaceFreedom.law.test.ts, HorseRealtimeTurnReliability.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { evaluateSpot, riverCallVerdict, type EvSpot } from './HorseEvEngine.js';
import {
  EXPLOIT_FAST_ENGAGE_MIN_N,
  exploitEnvelopeFor,
  flopStabStatRead,
} from './HorseOpponentExploit.js';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import type { Card, SeatPlayer } from '../types.js';

const fires = () => Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));

beforeEach(() => {
  enableBrainTelemetry();
  drainFires();
});

function spot(o: Partial<EvSpot>): EvSpot {
  return {
    equity: 0.5,
    pot: 100,
    toCall: 0,
    stack: 1000,
    effectiveStack: 1000,
    street: 'flop',
    inPosition: true,
    opponents: 1,
    realization: 1,
    minBet: 2,
    maxBet: Infinity,
    rand: () => 0.5,
    ...o,
  };
}
const persona = (telemetry: boolean) => ({
  horseId: '7c9f3b21-4d5e-4a10-9b83-2f6e1d0c8a44',
  mode: 'cash' as const,
  bigBlind: 2,
  telemetry,
});

describe('upgrade 11: a persona-mixed choice is counted, and only on a telemetry-on decision', () => {
  it('counts the pool when more than one candidate sits inside the mix window', () => {
    const withTelemetry = evaluateSpot(spot({ indifference: persona(true) }));
    const counted = fires();
    const withoutTelemetry = evaluateSpot(spot({ indifference: persona(false) }));
    const silent = fires();

    // Same spot, same draw: counting changes neither the pick nor the EVs.
    expect(withTelemetry).toEqual(withoutTelemetry);
    expect(counted.upgrade11_indifference_pool).toBe(1);
    expect(counted.upgrade11_indifference_mixed_pick ?? 0).toBe(
      withTelemetry.pick === withTelemetry.best ? 0 : 1
    );
    expect(silent.upgrade11_indifference_pool).toBeUndefined();
    expect(silent.upgrade11_indifference_mixed_pick).toBeUndefined();
  });

  it('counts nothing without a persona context (non-Hybrid callers)', () => {
    evaluateSpot(spot({}));
    expect(Object.keys(fires()).filter((k) => k.startsWith('upgrade11_'))).toEqual([]);
  });

  it('counts the call-or-fold band only when the price is inside it', () => {
    const args = { pot: 100, toCall: 50, stack: 1000, rand: () => 0.5 };
    // Required equity is 50 / 150; one point above it is inside the band.
    riverCallVerdict({ ...args, equity: 50 / 150 + 0.01, indifference: persona(true) });
    expect(fires().upgrade11_indifference_call_band).toBe(1);
    riverCallVerdict({ ...args, equity: 0.9, indifference: persona(true) });
    expect(fires().upgrade11_indifference_call_band).toBeUndefined();
    riverCallVerdict({ ...args, equity: 50 / 150 + 0.01, indifference: persona(false) });
    expect(fires().upgrade11_indifference_call_band).toBeUndefined();
  });
});

describe('upgrade 10: a read the fast window switches on is counted', () => {
  it('counts exactly the reads the fast window engaged that the long window had not', () => {
    const scope = 'holdem:short' as const;
    const envelope = exploitEnvelopeFor(scope, 'nlh');
    expect(envelope).toBeDefined();
    let engagedByFast = 0;
    let counted = 0;
    for (let opps = 10; opps <= 60; opps += 5) {
      for (let bets = 0; bets <= opps; bets += 1) {
        const long = { flopCheckedToOpps: opps, flopBetCheckedTo: bets };
        const withoutFast = flopStabStatRead(
          { ...long, fFlopCheckedToOpps: 0, fFlopBetCheckedTo: 0 },
          scope,
          'nlh'
        );
        drainFires();
        const n = EXPLOIT_FAST_ENGAGE_MIN_N + 4;
        const withFast = flopStabStatRead(
          { ...long, fFlopCheckedToOpps: n, fFlopBetCheckedTo: n },
          scope,
          'nlh'
        );
        counted += fires().upgrade10_fast_window_engaged ?? 0;
        if (withoutFast?.engaged == null && withFast?.engaged === 'high') engagedByFast += 1;
      }
    }
    // The grid must contain the case, or this proves nothing.
    expect(engagedByFast).toBeGreaterThan(0);
    expect(counted).toBe(engagedByFast);
  });
});

describe('upgrade 04: building an Omaha reservoir is counted once per process', () => {
  it('counts the first ranking against a reservoir and not the second', async () => {
    vi.resetModules();
    const telemetry = await import('./BrainTelemetry.js');
    const evalModule = await import('./HorseEval.js');
    telemetry.enableBrainTelemetry();
    telemetry.drainFires();
    const hand = ['As', 'Ks', 'Qd', 'Jd', 'Th'].map(
      (t) => ({ rank: t[0] === 'T' ? '10' : t[0], suit: suitOf(t[1]) }) as Card
    );
    evalModule.omahaPreflopPercentile(hand, false);
    const first = Object.fromEntries(telemetry.drainFires().map((r) => [r.feature, r.fires]));
    evalModule.omahaPreflopPercentile(hand, false);
    const second = Object.fromEntries(telemetry.drainFires().map((r) => [r.feature, r.fires]));
    expect(first.upgrade04_omaha_reservoir_5_seen).toBe(1);
    expect(second.upgrade04_omaha_reservoir_5_seen).toBeUndefined();
  });
});

const suitOf = (s: string) =>
  ({ s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' })[s] as Card['suit'];
const cards = (list: string[]): Card[] =>
  list.map((t) => ({ rank: t[0] === 'T' ? '10' : t[0], suit: suitOf(t[1]) }) as Card);

function seat(n: number, id: string, stack: number, hole: Card[], bet = 0): SeatPlayer {
  return {
    seat: n,
    user_id: id,
    username: id,
    stack,
    bet,
    totalInvested: bet,
    cards: hole,
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
    is_horse: true,
  } as unknown as SeatPlayer;
}

describe('upgrades 01, 02 and 06: a live postflop decision counts what it used', () => {
  const decide = (telemetry: boolean) => {
    HorseMind.reset();
    seedFastRandom(20261112);
    const hero = seat(1, 'hero', 1000, cards(['Ah', 'Kh']));
    const villain = seat(2, 'villain', 1000, [], 40);
    const gs = {
      stateSchemaVersion: 1,
      players: [hero, villain],
      communityCards: cards(['Qh', '9h', '3s', '2c']),
      pot: 120,
      currentBet: 40,
      minRaise: 40,
      stage: 'turn',
      gameVariant: 'nlh',
      smallBlind: 1,
      bigBlind: 2,
      dealerSeat: 2,
      heroSeat: 1,
      currentPlayerSeat: 1,
      legalActions: ['fold', 'call', 'raise', 'all_in'],
      toCall: 40,
      minRaiseTo: 80,
      maxRaiseTo: 1000,
      gameMode: 'cash',
      format: 'cash',
      actionHistory: [
        { seat: 2, action: 'bet', amount: 20, stage: 'flop' },
        { seat: 1, action: 'call', amount: 20, stage: 'flop' },
        { seat: 2, action: 'bet', amount: 40, stage: 'turn' },
      ],
    } as unknown as HorseGameStateV2;
    const decision = HorseLogic.decide(hero, gs, 'grinder', {}, { telemetry, mind: false });
    return { decision, counted: fires() };
  };

  it('counts the posterior, the card-removal score and the public timing hint once each', () => {
    const on = decide(true);
    expect(on.counted.upgrade01_action_line_posterior).toBe(1);
    expect(on.counted.upgrade02_card_removal_scored).toBe(1);
    expect(on.counted.upgrade06_public_timing_hint).toBe(1);
    // Their opportunity count: one decision entered the postflop brain.
    expect(on.counted.decide_postflop).toBe(1);
  });

  it('counts none of them with telemetry off, and decides the same', () => {
    const on = decide(true);
    const off = decide(false);
    for (const key of [
      'decide_postflop',
      'upgrade01_action_line_posterior',
      'upgrade02_card_removal_scored',
      'upgrade06_public_timing_hint',
    ])
      expect(off.counted[key]).toBeUndefined();
    // Think time is compared too: upgrade 06 is the think-time hint.
    expect({
      action: off.decision.action,
      amount: off.decision.amount,
      thinkTime: off.decision.thinkTime,
    }).toEqual({
      action: on.decision.action,
      amount: on.decision.amount,
      thinkTime: on.decision.thinkTime,
    });
    expect(on.decision.thinkTime).toBeGreaterThan(0);
  });
});
