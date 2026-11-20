/**
 * COREGUARD (lane COREGUARD 2026-11-19; owner 8:48 PM Chicago): at the
 * Lightning door an applied omahaMathCore choice is the size the core priced
 * (the exact-nuts rule never rewrites it), and a worker failure in the core's
 * scope with the switch on is priced by the minimal exact computation, never
 * an automatic fold. Switch off: exactly as before. Fixture: the public node
 * of hand 54876348 (aFastTableNutBandBetKeepsItsSize.test.ts), no opponent
 * cards.
 */
import { describe, expect, it } from 'vitest';
import { HandController } from '../engine/HandController.js';
import { decideLightningHorse, shapeLightningHorseAction } from './LightningHorse.js';
import type { Card, GameState, SeatPlayer } from '../types.js';
import { OMAHA_MATH_CORE_ALL_STREETS } from '../engine/omahaMathCore/OmahaMathCoreRule.js';

const cards = (text: string): Card[] =>
  text.split(' ').map((c) => ({
    rank: c[0] as Card['rank'],
    suit: ({ c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' } as const)[c[1] as 'c'],
  }));

function incident(facing: number) {
  const players = [1, 4, 6].map(
    (seat): SeatPlayer => ({
      seat,
      user_id: 'player-' + seat,
      username: 'Fixture',
      stack: seat === 1 ? 117.15 : 95.08 - (seat === 4 ? facing : 0),
      bet: seat === 4 ? facing : 0,
      totalInvested: 5.42 + (seat === 4 ? facing : 0),
      cards: seat === 1 ? cards('4c Ah 8s 3h 9s') : [],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
    })
  );
  const hc = new HandController(
    {
      tableId: 'lightning-coreguard',
      handNumber: 54876348,
      gameVariant: 'plo5',
      smallBlind: 0.25,
      bigBlind: 0.5,
      rakeConfig: { percent: 0, cap: 0, noFlopNoDrop: true },
    },
    players,
    6
  );
  const internal = hc as unknown as { state: GameState; handFSM: { transition(s: string): void } };
  Object.assign(internal.state, {
    players,
    communityCards: cards('Th Kh 4s 6h Js'),
    stage: 'river',
    currentBet: facing,
    pot: 17.26 + facing,
    minRaise: Math.max(0.5, facing),
    lastRaise: Math.max(0.5, facing),
    currentPlayerSeat: 1,
  });
  for (const s of ['posting_blinds', 'dealing', 'preflop', 'flop', 'turn', 'river'])
    internal.handFSM.transition(s);
  const hero = hc.getState().players.find((p) => p.seat === 1)!;
  return { hc, hero };
}

const coreReceipt = (action: string, amount: number | null) => ({
  switch: 'omahaMathCore',
  applied: true,
  action,
  amount,
  incoming: { action: 'check', amount: null },
  error: null,
  core: null,
});

const turnOf = (hc: HandController, hero: SeatPlayer, opts?: Record<string, unknown>) =>
  ({
    hc,
    userId: hero.user_id,
    seat: hero.seat,
    horseProfile: null,
    variant: 'plo5',
    bigBlind: 0.5,
    smallBlind: 0.25,
    ante: 0,
    bigBlindAnte: false,
    allInOrFold: false,
    actionTimeSeconds: 15,
    actions: [],
    generation: 1,
    fence: 'coreguard-fixture',
    turnStartMs: Date.now(),
    now: Date.now(),
    ...(opts ? { horseOpts: opts } : {}),
  }) as never;

describe('the Lightning door keeps an omahaMathCore choice', () => {
  it('a core bet of 15.10 is played as sized (without the receipt the exact-nuts rule makes it the full pot)', () => {
    const { hc, hero } = incident(0);
    const core = {
      action: 'bet',
      amount: 15.1,
      fast: { decision: { omahaMathCore: coreReceipt('bet', 15.1) } },
    } as never;
    expect(shapeLightningHorseAction(hc, hero.user_id, core, false)).toEqual({
      action: 'bet',
      amount: 15.1,
    });
    expect(
      shapeLightningHorseAction(hc, hero.user_id, { action: 'bet', amount: 15.1 }, false)
    ).toEqual({ action: 'bet', amount: 17.26 });
  });
  it('a core check with the nut flush stays a check (the exact-nuts rule would bet it)', () => {
    const { hc, hero } = incident(0);
    const core = {
      action: 'check',
      fast: { decision: { omahaMathCore: coreReceipt('check', null) } },
    } as never;
    expect(shapeLightningHorseAction(hc, hero.user_id, core, false).action).toBe('check');
  });
});

describe('a Lightning worker failure in the core scope is priced, never an automatic fold', () => {
  const failing = { decideFast: async () => Promise.reject(new Error('timeout')) } as never;
  it('switch on (the request option): the nut flush facing a bet calls; the receipt names the failure', async () => {
    const { hc, hero } = incident(10);
    const answer = await decideLightningHorse(
      turnOf(hc, hero, { omahaMathCore: true, ...OMAHA_MATH_CORE_ALL_STREETS }),
      new AbortController().signal,
      () => failing
    );
    expect(answer.workerFallback).toBe(true);
    expect(['call', 'all_in']).toContain(answer.action);
    const rec = answer.omahaMathCore as unknown as {
      applied: boolean;
      recovered: { from: string; method: string; equity: number; price: number };
    };
    expect(rec.applied).toBe(true);
    expect(rec.recovered.from).toBe('worker_failure');
    expect(rec.recovered.method).toBe('minimal');
    expect(rec.recovered.equity).toBeGreaterThan(rec.recovered.price);
  });
  it('switch off: the liveness answer exactly as before (fold when chips are owed)', async () => {
    const { hc, hero } = incident(10);
    const answer = await decideLightningHorse(
      turnOf(hc, hero),
      new AbortController().signal,
      () => failing
    );
    expect(answer).toEqual({ action: 'fold', thinkTime: 0, workerFallback: true, fast: null });
  });
});
