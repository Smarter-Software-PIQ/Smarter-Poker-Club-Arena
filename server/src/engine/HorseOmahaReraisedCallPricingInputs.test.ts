/**
 * omahaReraisedCallPricingOf (HorseLogic): the inputs of the priced call of a
 * re-raise, from the public table alone. Seat layouts for the position held,
 * the other players in, what the re-raiser has behind, the rate chain
 * (measured -> population -> fallback) and the rake.
 *
 * Six seats, blinds 1/2, dealer on seat 6: seat 1 is the small blind and acts
 * first on every later street, seat 6 acts last. No cards are involved: the
 * function reads none.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./HorseOpponentExploit.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('./HorseOpponentExploit.js')>();
  return { ...real, exploitEnvelopeFor: vi.fn(real.exploitEnvelopeFor) };
});

import {
  omahaReraisedCallPricingOf,
  type HorseDecideOpts,
  type HorseGameStateV2,
} from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { exploitEnvelopeFor } from './HorseOpponentExploit.js';
import { RERAISE_RATE_FALLBACK } from './HorseOmahaOopReraisedPot.js';
import type { ActionRecord, SeatPlayer } from '../types.js';

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

const uid = (seat: number) => `0000000${seat}-0000-4000-8000-00000000000${seat}`;
interface SeatSpec {
  bet?: number;
  stack?: number;
  folded?: boolean;
  allIn?: boolean;
  sittingOut?: boolean;
}
/** [seat, action, amount-to] in order; the blinds are posted for seats 1 and 2. */
type Act = [number, 'raise' | 'call' | 'all_in' | 'fold', number];
function table(
  heroSeat: number,
  acts: Act[],
  seats: Record<number, SeatSpec> = {},
  over: Partial<HorseGameStateV2> = {}
) {
  const bet = new Map<number, number>([
    [1, 1],
    [2, 2],
  ]);
  const folded = new Set<number>();
  const history: ActionRecord[] = [
    { stage: 'preflop', seat: 1, userId: uid(1), action: 'sb', amount: 1, timestamp: 1 },
    { stage: 'preflop', seat: 2, userId: uid(2), action: 'bb', amount: 2, timestamp: 2 },
  ] as unknown as ActionRecord[];
  let ts = 3;
  for (const [seat, action, amount] of acts) {
    if (action === 'fold') folded.add(seat);
    else bet.set(seat, amount);
    history.push({
      stage: 'preflop',
      seat,
      userId: uid(seat),
      action,
      amount,
      timestamp: ts++,
      ...(action === 'raise' ? { isFullRaise: true } : {}),
    } as ActionRecord);
  }
  const players = [1, 2, 3, 4, 5, 6].map((seat) => {
    const s = seats[seat] ?? {};
    const b = s.bet ?? bet.get(seat) ?? 0;
    return {
      seat,
      user_id: uid(seat),
      username: `P${seat}`,
      stack: s.stack ?? 200 - b,
      bet: b,
      totalInvested: b,
      cards: [],
      is_folded: s.folded ?? folded.has(seat),
      is_all_in: s.allIn ?? false,
      is_sitting_out: s.sittingOut ?? false,
      is_horse: seat === heroSeat,
    } as SeatPlayer;
  });
  const currentBet = Math.max(...players.map((p) => p.bet ?? 0));
  const hero = players.find((p) => p.seat === heroSeat)!;
  const gs = {
    stateSchemaVersion: 1,
    gameVariant: 'plo5',
    gameMode: 'cash',
    bettingStructure: 'pot_limit',
    stage: 'preflop',
    pot: players.reduce((n, p) => n + (p.bet ?? 0), 0),
    bigBlind: 2,
    smallBlind: 1,
    currentBet,
    toCall: currentBet - (hero.bet ?? 0),
    legalActions: ['fold', 'call', 'raise', 'all_in'],
    dealerSeat: 6,
    communityCards: [],
    players,
    actionHistory: history,
    ...over,
  } as unknown as HorseGameStateV2;
  return { hero, gs, seat: (n: number) => players.find((p) => p.seat === n)! };
}
const OFF: HorseDecideOpts = { mind: false };
const pricingOf = (t: ReturnType<typeof table>, raiserSeat: number, opts: HorseDecideOpts = OFF) =>
  omahaReraisedCallPricingOf(
    t.hero,
    t.gs,
    opts,
    t.seat(raiserSeat),
    t.gs.toCall as number,
    t.hero.stack,
    t.hero.bet ?? 0
  )!;
const others = (...seats: number[]): Act[] => seats.map((s) => [s, 'fold', 0]);

/** Hero on seat 5 opened to 7, the small blind (seat 1) re-raised to 24, everyone else folded. */
const heroOpenedSbReraised = (seats: Record<number, SeatSpec> = {}, over: object = {}) =>
  table(
    5,
    [...others(3, 4), [5, 'raise', 7], ...others(6), [1, 'raise', 24], ...others(2)],
    seats,
    over as never
  );
/** The button (seat 6) opened to 7, the small blind re-raised to 24, hero is the big blind (seat 2). */
const openerBehindHero = (seats: Record<number, SeatSpec> = {}) =>
  table(2, [...others(3, 4, 5), [6, 'raise', 7], [1, 'raise', 24]], seats);

describe('position held after the call, and the other players in', () => {
  it('hero acts after the re-raiser, nobody else in: in position, heads-up, hero had raised', () => {
    expect(pricingOf(heroOpenedSbReraised(), 1)).toEqual({
      rate: 0.046,
      opportunities: 0,
      rateSource: 'population',
      inPosition: true,
      othersIn: 0,
      raiserBehind: 176,
      rakeFraction: 0.1,
      heroAlreadyRaised: true,
      heroInvested: 7,
    });
  });
  it('the re-raiser acts after hero: out of position', () => {
    const t = table(3, [[3, 'raise', 7], ...others(4), [5, 'raise', 24], ...others(6, 1, 2)]);
    const p = pricingOf(t, 5);
    expect([p.inPosition, p.othersIn, p.heroAlreadyRaised]).toEqual([false, 0, true]);
  });
  it('a caller already in for the price who acts after hero: out of position, one other player in', () => {
    const t = table(
      4,
      [...others(3), [4, 'raise', 7], ...others(5), [6, 'call', 7], [1, 'raise', 24], ...others(2)],
      { 6: { bet: 24 } }
    );
    const p = pricingOf(t, 1);
    expect([p.inPosition, p.othersIn]).toEqual([false, 1]);
  });
  it('a caller already in for the price who acts before hero: in position, one other player in', () => {
    const t = table(4, [
      ...others(3),
      [4, 'raise', 7],
      ...others(5, 6),
      [1, 'raise', 24],
      [2, 'call', 24],
    ]);
    const p = pricingOf(t, 1);
    expect([p.inPosition, p.othersIn]).toEqual([true, 1]);
  });
  it('THE OPENER STILL TO ACT BEHIND HERO: counted as another player in, not as position lost (the definition the costs were fitted under)', () => {
    // Review of 97de6c23913, note N4 (23 of 236 recorded fires). The opener has
    // not paid the price: by the measurement's definition (in position = after
    // the re-raiser and after every player ALREADY IN FOR THE PRICE) hero is in
    // position, and the opener is charged as another player in (0.35). Pinned
    // so that a change of this definition is a deliberate, evaluated change.
    const p = pricingOf(openerBehindHero(), 1);
    expect([p.inPosition, p.othersIn, p.heroAlreadyRaised, p.heroInvested]).toEqual([
      true,
      1,
      false,
      2,
    ]);
    // once he has called the price he is in for it, behind hero: out of position
    const called = pricingOf(openerBehindHero({ 6: { bet: 24 } }), 1);
    expect([called.inPosition, called.othersIn]).toEqual([false, 1]);
    // folded or sitting out he is nobody
    for (const gone of [{ folded: true }, { sittingOut: true }]) {
      const q = pricingOf(openerBehindHero({ 6: gone }), 1);
      expect([q.inPosition, q.othersIn]).toEqual([true, 0]);
    }
  });
  it('a third player all in behind hero is in the pot but takes no position (he does not act again)', () => {
    const t = table(2, [...others(3, 4, 5), [6, 'all_in', 15], [1, 'raise', 24]], {
      6: { allIn: true, stack: 0 },
    });
    const p = pricingOf(t, 1);
    expect([p.inPosition, p.othersIn]).toEqual([true, 1]);
  });
  it('a limper still to act who has not raised is not counted at all (measured: no charge)', () => {
    const t = table(2, [...others(3, 4, 5), [6, 'call', 2], [1, 'raise', 9]]);
    const p = pricingOf(t, 1);
    expect([p.inPosition, p.othersIn, p.raiserBehind]).toEqual([true, 0, 191]);
  });
});

describe('what the re-raiser has behind, and the rake', () => {
  it('his stack; nothing when it is not a number', () => {
    expect(pricingOf(heroOpenedSbReraised(), 1).raiserBehind).toBe(176);
    expect(pricingOf(heroOpenedSbReraised({ 1: { stack: NaN, bet: 24 } }), 1).raiserBehind).toBe(0);
  });
  it("the table's rake when it is known, the engine's default drag when not, none in a tournament", () => {
    expect(pricingOf(heroOpenedSbReraised(), 1).rakeFraction).toBe(0.1);
    expect(
      pricingOf(heroOpenedSbReraised({}, { rakeConfig: { percent: 4, cap: 6 } }), 1).rakeFraction
    ).toBeCloseTo(0.04, 6);
    expect(pricingOf(heroOpenedSbReraised({}, { gameMode: 'tournament' }), 1).rakeFraction).toBe(0);
  });
});

describe('the rate chain: measured -> population -> fallback', () => {
  it("measured: the re-raiser's own posterior mean with its opportunities (his read, nobody else's)", () => {
    const spy = vi
      .spyOn(HorseMind, 'omahaReadConditionalOf')
      .mockImplementation(() => ({ threeBet: { mean: 0.31, n: 42 } }) as never);
    const p = pricingOf(heroOpenedSbReraised(), 1, {});
    expect([p.rate, p.opportunities, p.rateSource]).toEqual([0.31, 42, 'measured']);
    expect(spy.mock.calls.map((c) => c[0])).toEqual([uid(1)]);
  });
  it("population: no read of him, or the mind off (then no read is taken): the game's own mean", () => {
    const spy = vi.spyOn(HorseMind, 'omahaReadConditionalOf').mockImplementation(() => null);
    const none = pricingOf(heroOpenedSbReraised(), 1, {});
    expect([none.rate, none.opportunities, none.rateSource]).toEqual([0.046, 0, 'population']);
    spy.mockClear();
    const off = pricingOf(heroOpenedSbReraised(), 1, OFF);
    expect([off.rate, off.opportunities, off.rateSource]).toEqual([0.046, 0, 'population']);
    expect(spy).not.toHaveBeenCalled();
    // PLO4 has its own mean
    const plo4 = pricingOf(heroOpenedSbReraised({}, { gameVariant: 'plo4' }), 1);
    expect([plo4.rate, plo4.rateSource]).toEqual([0.047, 'population']);
  });
  it('a read with no opportunities behind it is not called measured (its prior mean is used, labelled population)', () => {
    // Known quirk (review note N5): the rate is the read's prior mean, the label stays "population".
    vi.spyOn(HorseMind, 'omahaReadConditionalOf').mockImplementation(
      () => ({ threeBet: { mean: 0.09, n: 0 } }) as never
    );
    const p = pricingOf(heroOpenedSbReraised(), 1, {});
    expect([p.rate, p.opportunities, p.rateSource]).toEqual([0.09, 0, 'population']);
  });
  it('fallback: no envelope for the game: the stated constant', () => {
    vi.mocked(exploitEnvelopeFor).mockReturnValueOnce(undefined);
    const p = pricingOf(heroOpenedSbReraised(), 1, OFF);
    expect([p.rate, p.opportunities, p.rateSource]).toEqual([RERAISE_RATE_FALLBACK, 0, 'fallback']);
    expect(RERAISE_RATE_FALLBACK).toBe(0.046);
    // a measured read still wins over a missing envelope
    vi.mocked(exploitEnvelopeFor).mockReturnValueOnce(undefined);
    vi.spyOn(HorseMind, 'omahaReadConditionalOf').mockImplementation(
      () => ({ threeBet: { mean: 0.2, n: 9 } }) as never
    );
    const q = pricingOf(heroOpenedSbReraised(), 1, {});
    expect([q.rate, q.opportunities, q.rateSource]).toEqual([0.2, 9, 'measured']);
  });
});
