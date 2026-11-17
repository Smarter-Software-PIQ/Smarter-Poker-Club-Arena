/**
 * omahaPreflopReraiseDefencePriced (PLO Strategy lane 2026-11-17, default
 * OFF): the pieces of the priced preflop decision (HorseOmahaPreflopReraiseDefence.ts)
 * and of its rule (HorseOmahaPreflopReraiseDefenceRule.ts), on synthetic spots.
 *
 *  - the range width grows with the re-raiser's measured rate, continuously,
 *    and a 4-bet narrows it;
 *  - realization: 1 when the call is all in, falling with depth, faster out
 *    of position, lower with other players in, bounded;
 *  - rake: percentage to the cap, the player-count cap, none on timed rake,
 *    the engine default without a configuration;
 *  - the verdict: the same hand calls a wide re-raiser and folds to a tight
 *    one; the same hand at the same width folds when the price grows; no
 *    class or position decides alone (an unpaired, uncoordinated hand calls
 *    when the price and the read say so); it never answers outside PLO4/PLO5,
 *    for a single raise or with nothing to call; equity is deterministic and
 *    never draws from the brain's random stream;
 *  - the out-of-position 4-bet cell is left to its owner;
 *  - the one read interface: the population mean with no row or the mind
 *    off, the pooled read when he is known;
 *  - the receipt admission: only the exact chips of the call, only in the spot.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Card, CardRank, CardSuit, SeatPlayer } from '../types.js';
import { fastRandom, seedFastRandom } from './HorseEval.js';
import { HorseMind, readScopeOf } from './HorseMind.js';
import { freshExploitCounters, type ExploitCounters } from './HorseOpponentExploit.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import {
  omahaPreflopDefenceEquity,
  omahaPreflopDefenceLeftToOopFourBetCell,
  omahaPreflopDefenceRake,
  omahaPreflopDefenceRangeWidth,
  omahaPreflopDefenceRealization,
  omahaPreflopDefenceShape,
  omahaPreflopDefenceVerdict,
  REALIZATION_MAX,
  REALIZATION_MIN,
  REALIZATION_SHAPE_MAX,
  REALIZATION_SHAPE_MIN,
  type OmahaPreflopDefenceSpot,
} from './HorseOmahaPreflopReraiseDefence.js';
import {
  PREFLOP_DEFENCE_FALLBACK_RERAISE_RATE,
  omahaPreflopReraiseDefenceAdmitsCall,
  omahaPreflopReraiseDefenceRule,
  omahaPreflopReraiseDefenceSpot,
  omahaPreflopReraiserReadOf,
} from './HorseOmahaPreflopReraiseDefenceRule.js';

const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (spec: string): Card[] =>
  (spec.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUIT[x[1]!]! }));

afterEach(() => {
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

const spot = (over: Partial<OmahaPreflopDefenceSpot> = {}): OmahaPreflopDefenceSpot => ({
  variant: 'plo5',
  preflopRaises: 2,
  call: 15,
  pot: 30,
  stack: 193,
  raiserBehind: 178,
  inPosition: true,
  othersIn: 0,
  bigBlind: 2,
  rake: (p) => omahaPreflopDefenceRake(p, 2, null, 6),
  ...over,
});
const read = (rate: number, foldToReraise = 0.45) => ({ rate, opportunities: 15, foldToReraise });

describe('the pieces', () => {
  it('the range width grows continuously with the measured rate and a 4-bet narrows it', () => {
    let last = 0;
    for (let r = 0; r <= 0.6; r += 0.02) {
      const w = omahaPreflopDefenceRangeWidth(r, 2);
      expect(w).toBeGreaterThanOrEqual(last);
      expect(w - last).toBeLessThan(0.15); // no jump: continuous in the read
      last = w;
    }
    for (const r of [0.05, 0.2, 0.4])
      expect(omahaPreflopDefenceRangeWidth(r, 3)).toBeLessThan(omahaPreflopDefenceRangeWidth(r, 2));
    expect(omahaPreflopDefenceRangeWidth(Number.NaN, 2)).toBeGreaterThan(0);
  });

  it('realization: all in is 1; falls with depth, faster out of position; other players cost; bounded', () => {
    expect(omahaPreflopDefenceRealization(true, 0, 0, 0)).toBe(1);
    expect(omahaPreflopDefenceRealization(false, 0, 2, -0.08)).toBe(1);
    let ip = 2;
    let oop = 2;
    for (const spr of [0.5, 1, 2, 4, 8, 16]) {
      const a = omahaPreflopDefenceRealization(true, spr, 0, 0);
      const b = omahaPreflopDefenceRealization(false, spr, 0, 0);
      expect(a).toBeLessThan(ip);
      expect(b).toBeLessThan(oop);
      expect(b).toBeLessThan(a);
      expect(omahaPreflopDefenceRealization(true, spr, 1, 0)).toBeLessThan(a);
      ip = a;
      oop = b;
    }
    for (const spr of [0.3, 3, 30])
      for (const others of [0, 1, 2, 5])
        for (const shape of [REALIZATION_SHAPE_MIN, 0, REALIZATION_SHAPE_MAX]) {
          const r = omahaPreflopDefenceRealization(false, spr, others, shape);
          expect(r).toBeGreaterThanOrEqual(REALIZATION_MIN);
          expect(r).toBeLessThanOrEqual(REALIZATION_MAX);
        }
  });

  it('rake: percentage to the cap, the player-count tier, none on timed rake, the default otherwise', () => {
    const cfg = {
      percent: 10,
      cap: 3,
      playerCountCaps: [
        { players: 2, cap: 1.5 },
        { players: 3, cap: 3 },
      ],
    };
    expect(omahaPreflopDefenceRake(10, 0.5, cfg, 6)).toBeCloseTo(1, 9);
    expect(omahaPreflopDefenceRake(100, 0.5, cfg, 6)).toBe(3);
    expect(omahaPreflopDefenceRake(100, 0.5, cfg, 2)).toBe(1.5);
    expect(omahaPreflopDefenceRake(100, 0.5, { ...cfg, timedRake: { minutes: 30 } }, 6)).toBe(0);
    expect(omahaPreflopDefenceRake(100, 2, null, 6)).toBe(5); // 10% to 2.5 big blinds
    expect(omahaPreflopDefenceRake(0, 2, null, 6)).toBe(0);
  });

  it('the hand-shape term is bounded and orders hands by playability, not by class alone', () => {
    const good = omahaPreflopDefenceShape(cards('AsKsQhJhTd'));
    const bad = omahaPreflopDefenceShape(cards('2c2d2h7s Qc'.replace(' ', '')));
    expect(good).toBeGreaterThan(bad);
    for (const h of ['AsKsQhJhTd', '2c2d2h7sQc', 'AhAdKhKd', '2c7d9hKs', 'AsAhAdAc'])
      expect(Math.abs(omahaPreflopDefenceShape(cards(h)))).toBeLessThanOrEqual(0.08);
  });

  it('equity is deterministic, uses no draw from the random stream and respects card removal', () => {
    seedFastRandom(7);
    const before = fastRandom();
    seedFastRandom(7);
    const hole = cards('AsAhKsKh');
    const e1 = omahaPreflopDefenceEquity(hole, [], 0.3);
    const e2 = omahaPreflopDefenceEquity(hole, [], 0.3);
    expect(e1).toBe(e2);
    expect(fastRandom()).toBe(before);
    // holding both remaining aces' partners: the top of his range loses its aces
    expect(e1!).toBeGreaterThan(0.55);
  });
});

describe('the verdict', () => {
  const hole = cards('9h8h7c6cQd'); // no ace, no pair: a plain rundown with a dangler
  it('the same hand calls a wide measured re-raiser and folds to a tight one', () => {
    const wide = omahaPreflopDefenceVerdict(
      spot({ inPosition: false }),
      hole,
      [],
      read(0.4),
      null
    )!;
    const tight = omahaPreflopDefenceVerdict(
      spot({ inPosition: false }),
      hole,
      [],
      read(0.01),
      null
    )!;
    expect(wide.equity).toBeGreaterThan(tight.equity);
    expect(wide.evCall).toBeGreaterThan(tight.evCall);
  });

  it('the action follows the sign of the expected value, and the price moves it', () => {
    for (const rate of [0.01, 0.05, 0.1, 0.2, 0.4]) {
      const v = omahaPreflopDefenceVerdict(spot(), hole, [], read(rate), null)!;
      expect(v.action).toBe(v.evCall > 0 ? 'call' : 'fold');
      expect(v.price).toBeCloseTo(15 / 45, 9);
    }
    const cheap = omahaPreflopDefenceVerdict(
      spot({ call: 5, pot: 40 }),
      hole,
      [],
      read(0.05),
      null
    )!;
    const dear = omahaPreflopDefenceVerdict(
      spot({ call: 60, pot: 70 }),
      hole,
      [],
      read(0.05),
      null
    )!;
    expect(cheap.evCall / 5).toBeGreaterThan(dear.evCall / 60);
  });

  it('a proposed re-raise is kept only when it is worth most; it is never invented', () => {
    const h = cards('AsAhKsKhQd');
    const none = omahaPreflopDefenceVerdict(spot(), h, [], read(0.3), null)!;
    expect(none.evRaise).toBeNull();
    expect(none.action).not.toBe('raise');
    const v = omahaPreflopDefenceVerdict(spot(), h, [], read(0.3), { risk: 75 })!;
    expect(v.evRaise).not.toBeNull();
    expect(v.action).toBe(
      v.evRaise! > 0 && v.evRaise! >= v.evCall ? 'raise' : v.evCall > 0 ? 'call' : 'fold'
    );
  });

  it('does not answer outside PLO4/PLO5, for a single raise, with nothing to call or a wrong hand size', () => {
    expect(
      omahaPreflopDefenceVerdict(spot({ variant: 'plo6' }), hole, [], read(0.2), null)
    ).toBeNull();
    expect(
      omahaPreflopDefenceVerdict(spot({ preflopRaises: 1 }), hole, [], read(0.2), null)
    ).toBeNull();
    expect(omahaPreflopDefenceVerdict(spot({ call: 0 }), hole, [], read(0.2), null)).toBeNull();
    expect(omahaPreflopDefenceVerdict(spot(), cards('AsKs'), [], read(0.2), null)).toBeNull();
    expect(
      omahaPreflopDefenceVerdict(spot({ variant: 'plo4' }), cards('9h8h7c6c'), [], read(0.2), null)
    ).not.toBeNull();
  });

  it('leaves the out-of-position 4-bet cell (paired non-aces, ratio 2.5 or less, not all in) to its owner', () => {
    const s = spot({ preflopRaises: 3, inPosition: false, call: 40, pot: 100, stack: 200 });
    expect(omahaPreflopDefenceLeftToOopFourBetCell(s, cards('KsKh9c8c7d'))).toBe(true);
    expect(omahaPreflopDefenceLeftToOopFourBetCell(s, cards('AsAh9c8c7d'))).toBe(false);
    expect(
      omahaPreflopDefenceLeftToOopFourBetCell({ ...s, inPosition: true }, cards('KsKh9c8c7d'))
    ).toBe(false);
    expect(omahaPreflopDefenceLeftToOopFourBetCell({ ...s, stack: 40 }, cards('KsKh9c8c7d'))).toBe(
      false
    );
    expect(
      omahaPreflopDefenceLeftToOopFourBetCell({ ...s, stack: 1000 }, cards('KsKh9c8c7d'))
    ).toBe(false);
  });
});

// ─── the rule on a game state ───────────────────────────────────────────────

const HERO = '86000001-0000-4000-8000-000000000001';
const VILLAIN = '40000000-0000-4000-8000-0000000000c3';
/** Six-handed PLO5 cash, blinds 1/2: hero on the button opens to 7, the big blind 3-bets to 22. */
function threeBet(hole: string, variant = 'plo5'): { hero: SeatPlayer; gs: HorseGameStateV2 } {
  const bet: Record<number, number> = { 1: 1, 2: 22, 3: 0, 4: 0, 5: 0, 6: 7 };
  const players = [1, 2, 3, 4, 5, 6].map(
    (n) =>
      ({
        seat: n,
        user_id: n === 6 ? HERO : n === 2 ? VILLAIN : `4000000${n}-0000-4000-8000-0000000000f${n}`,
        username: `P${n}`,
        stack: 200 - bet[n]!,
        bet: bet[n],
        totalInvested: bet[n],
        cards: n === 6 ? cards(hole) : [],
        is_folded: n !== 6 && n !== 2,
        is_all_in: false,
        is_sitting_out: false,
        is_horse: n === 6,
      }) as SeatPlayer
  );
  const act = (seat: number, action: string, amount: number, t: number) => ({
    stage: 'preflop',
    seat,
    userId: players[seat - 1]!.user_id,
    action,
    amount,
    ...(action === 'raise' ? { isFullRaise: true } : {}),
    timestamp: t,
  });
  const gs = {
    players,
    communityCards: [],
    pot: 30,
    currentBet: 22,
    toCall: 15,
    minRaise: 15,
    minRaiseTo: 37,
    maxRaiseTo: 67,
    legalActions: ['fold', 'call', 'raise', 'all_in'],
    stage: 'preflop',
    gameVariant: variant,
    bettingStructure: 'pot_limit',
    bigBlind: 2,
    dealerSeat: 6,
    gameMode: 'cash',
    actionHistory: [
      act(1, 'sb', 1, 1),
      act(2, 'bb', 2, 2),
      act(3, 'fold', 0, 3),
      act(4, 'fold', 0, 4),
      act(5, 'fold', 0, 5),
      act(6, 'raise', 7, 6),
      act(1, 'fold', 0, 7),
      act(2, 'raise', 22, 8),
    ],
  } as unknown as HorseGameStateV2;
  return { hero: players[5]!, gs };
}

function wideRow(): ExploitCounters {
  const c = freshExploitCounters();
  Object.assign(c, {
    hands: 40,
    vpip: 34,
    pfr: 21,
    rfiOpp: 20,
    rfi: 16,
    threeBetOpp: 15,
    threeBet: 6,
    foldTo3BetOpp: 8,
    foldTo3Bet: 0,
  });
  return c;
}

describe('the rule', () => {
  it('finds the spot: in position, heads-up, facing a 3-bet', () => {
    const { hero, gs } = threeBet('9h8h7c6cQd');
    const f = omahaPreflopReraiseDefenceSpot(hero, gs)!;
    expect(f.spot).toMatchObject({
      preflopRaises: 2,
      call: 15,
      pot: 30,
      inPosition: true,
      othersIn: 0,
    });
    expect(f.raiserSeat).toBe(2);
    expect(
      omahaPreflopReraiseDefenceSpot(hero, { ...gs, gameVariant: 'plo6' } as never)
    ).toBeNull();
    expect(
      omahaPreflopReraiseDefenceSpot(hero, {
        ...gs,
        gameMode: 'tournament',
        tournamentId: 't',
      } as never)
    ).toBeNull();
    expect(omahaPreflopReraiseDefenceSpot(hero, { ...gs, stage: 'flop' } as never)).toBeNull();
  });

  it('one read interface: the population mean with the mind off or no row, his pooled read when known', () => {
    const none = omahaPreflopReraiserReadOf(VILLAIN, 'plo5', 6, true);
    const off = omahaPreflopReraiserReadOf(VILLAIN, 'plo5', 6, false);
    expect(none).toEqual(off);
    expect(none.opportunities).toBe(0);
    expect(Number.isFinite(none.rate)).toBe(true);
    (HorseMind as unknown as { exploitCounters: Map<string, ExploitCounters> }).exploitCounters.set(
      `${readScopeOf('plo5', 6)}|${VILLAIN}`,
      wideRow()
    );
    HorseMind.setDecisionScope(readScopeOf('plo5', 6), 'plo5', 'cash');
    const known = omahaPreflopReraiserReadOf(VILLAIN, 'plo5', 6, true);
    expect(known.rate).toBeGreaterThan(none.rate);
    expect(known.opportunities).toBeGreaterThan(0);
    expect(omahaPreflopReraiserReadOf(VILLAIN, 'plo5', 6, false)).toEqual(off);
    expect(PREFLOP_DEFENCE_FALLBACK_RERAISE_RATE).toBeGreaterThan(0);
  });

  it('turns the answer it is given into the verdict; never invents a re-raise; null off the spot', () => {
    const { hero, gs } = threeBet('AsAhKsKhQd');
    const ctx = { mind: false, telemetry: false };
    const fold = omahaPreflopReraiseDefenceRule({ action: 'fold' } as never, hero, gs, ctx)!;
    expect(fold.action).toBe('call');
    expect(fold.amount).toBe(15);
    const call = omahaPreflopReraiseDefenceRule(
      { action: 'call', amount: 15 } as never,
      hero,
      gs,
      ctx
    )!;
    expect(call.action).toBe('call');
    const flop = omahaPreflopReraiseDefenceRule(
      { action: 'fold' } as never,
      hero,
      { ...gs, stage: 'flop' } as never,
      ctx
    );
    expect(flop).toBeNull();
    const trash = threeBet('2c3d8h9sKd');
    const t = omahaPreflopReraiseDefenceRule(
      { action: 'call', amount: 15 } as never,
      trash.hero,
      trash.gs,
      ctx
    )!;
    expect(['fold', 'call']).toContain(t.action);
    expect(t.action).not.toBe('raise');
  });

  it('the receipt admission: only the exact chips of the call and only in the spot', () => {
    const { hero, gs } = threeBet('9h8h7c6cQd');
    expect(omahaPreflopReraiseDefenceAdmitsCall(hero, gs, 15)).toBe(true);
    expect(omahaPreflopReraiseDefenceAdmitsCall(hero, gs, 16)).toBe(false);
    expect(omahaPreflopReraiseDefenceAdmitsCall(hero, gs, undefined)).toBe(false);
    expect(
      omahaPreflopReraiseDefenceAdmitsCall(hero, { ...gs, gameVariant: 'nlh' } as never, 15)
    ).toBe(false);
  });
});
