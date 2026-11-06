/**
 * LAW: a complaint replay rebuilds the position read the live engine used.
 *
 * The live engine hands every horse decision the dealt census
 * (`dealtSeatIds`) and the seats that posted the blinds (`blindSeats`)
 * (ServerTableEngineTurns). HorseComplaintReplay.stateAt rebuilt the state
 * from the recorded snapshot without either, so the position read fell back
 * to "live or invested" seats. Folded to the small blind, every uninvested
 * folder dropped out, the ring shrank to the two blinds, and the small blind
 * replayed as a heads-up big blind: the V70 opening range never applied and
 * the replay folded K9o and Q8s that the live small blind opens. Measured on
 * 2026-11-05: replayed 9-max cash SB first-in raised 19.5% against a 42%
 * target while live horses raised 46.7% (n=210) of the same spots.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseMind } from '../HorseMind.js';
import { HorseLogic, type HorseGameStateV2 } from '../HorseLogic.js';
import { seedFastRandom } from '../HorseEval.js';
import { drainFires, enableBrainTelemetry } from '../BrainTelemetry.js';
import {
  replayProfiles,
  stateAt,
  type ComplaintAction,
  type ExtractedHand,
} from '../HorseComplaintReplay.js';
import type { Card } from '../../types.js';

const BB = 0.5;
const CLOCK = Date.UTC(2026, 10, 5, 18, 0, 0);

/** Nine-handed cash, dealer 9, blinds 1 and 2, folded to the small blind. */
function foldedToSmallBlind(
  hole: Card[],
  sittingOutSeat?: number
): { hand: ExtractedHand; node: ComplaintAction } {
  const seats = Array.from({ length: 9 }, (_, i) => i + 1);
  const status = (s: number) => (s === sittingOutSeat ? 5 : s >= 3 ? 1 : 0);
  const actions: ComplaintAction[] = [
    { ord: 1, seat: 1, stage: 'preflop', action: 'sb', amount: BB / 2, origin: 'forced' },
    { ord: 2, seat: 2, stage: 'preflop', action: 'bb', amount: BB, origin: 'forced' },
  ];
  let ord = 3;
  for (const s of seats.slice(2)) {
    if (s === sittingOutSeat) continue;
    actions.push({
      ord: ord++,
      seat: s,
      stage: 'preflop',
      action: 'fold',
      amount: 0,
      origin: 'horse_policy',
    });
  }
  const node: ComplaintAction = {
    ord: ord++,
    seat: 1,
    stage: 'preflop',
    action: 'fold',
    amount: 0,
    origin: 'horse_policy',
    publicNode: {
      pot: BB * 1.5,
      ante: 0,
      mode: 'cash',
      seats: seats.map((s) => [
        s,
        s === 1 ? 50 - BB / 2 : s === 2 ? 50 - BB : 50,
        s === 1 ? BB / 2 : s === 2 ? BB : 0,
        s === 1 ? BB / 2 : s === 2 ? BB : 0,
        0,
        0,
        status(s),
      ]),
      street: 'preflop',
      toCall: BB / 2,
      currentBet: BB,
      minRaiseTo: BB * 2,
      maxRaiseTo: 50,
      legalActions: ['fold', 'call', 'raise', 'all_in'],
      dealerSeat: 9,
      chipUnit: 0.01,
      bigBlind: BB,
      smallBlind: BB / 2,
      variant: 'nlh',
      structure: 'no_limit',
      actorSeat: 1,
    },
  };
  actions.push(node);
  const hand: ExtractedHand = {
    handId: 'law-small-blind-ring',
    tournamentId: null,
    variant: 'nlh',
    bigBlind: BB,
    smallBlind: BB / 2,
    players: seats.map((s) => ({ seat: s, userId: `p${s}`, isHorse: true })),
    horseHoleCards: { p1: hole },
    actions,
  };
  return { hand, node };
}

const K9o: Card[] = [
  { rank: 'K', suit: 'spades' },
  { rank: '9', suit: 'hearts' },
];

describe('a replayed small blind keeps its ring', () => {
  afterEach(() => HorseMind.reset());

  it('carries the dealt census and the blind seats the live engine supplies', () => {
    const { hand, node } = foldedToSmallBlind(K9o);
    const { gs } = stateAt(hand, node);
    const g = gs as HorseGameStateV2 & { dealtSeatIds?: number[]; blindSeats?: unknown };
    expect(g.dealtSeatIds).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(g.blindSeats).toEqual({ smallBlind: 1, bigBlind: 2 });
  });

  it('every seat in the snapshot was dealt, a sitting-out seat included', () => {
    // The snapshot is HandController's dealt roster: a tournament sit-out is
    // dealt, posts and is auto-folded, exactly as the live census counts it.
    const { hand, node } = foldedToSmallBlind(K9o, 6);
    const g = stateAt(hand, node).gs as HorseGameStateV2 & { dealtSeatIds?: number[] };
    expect(g.dealtSeatIds).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('a tournament hand replays in the format its snapshot recorded', () => {
    const { hand, node } = foldedToSmallBlind(K9o);
    const pn = {
      ...node.publicNode!,
      mode: 'tournament' as const,
      tournamentStage: { status: 'captured', format: 'spin' },
    };
    const g = stateAt({ ...hand, tournamentId: 't' }, { ...node, publicNode: pn })
      .gs as HorseGameStateV2 & { format?: string };
    expect(g.format).toBe('spin');
    const cash = stateAt(hand, node).gs as HorseGameStateV2 & { format?: string };
    expect(cash.format).toBeUndefined();
  });

  it('folded to the small blind, the replay reads the V70 opening range of the small blind', () => {
    enableBrainTelemetry();
    const { hand, node } = foldedToSmallBlind(K9o);
    const st = stateAt(hand, node);
    const live = replayProfiles('cash').find((p) => p.live)!;
    for (const seed of [11, 23, 37]) {
      seedFastRandom(seed);
      HorseMind.reset();
      drainFires();
      HorseLogic.decide(st.hero, st.gs as HorseGameStateV2, live.style, live.mods, {
        mind: false,
        telemetry: true,
        decisionTimeMs: CLOCK,
      } as never);
      const fires = drainFires().map((f) => f.feature);
      expect(fires).toContain('v70_gto_open');
    }
  });
});
