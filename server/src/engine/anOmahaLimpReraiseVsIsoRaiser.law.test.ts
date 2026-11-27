/**
 * LAW (owner order 2026-11-27 12:48 PM Chicago, lead-8 lane limprr): omahaLimpReraiseVsIsoRaiser (default OFF).
 *
 * "Limp re-raises in position when you know you have a player that will always raise when the Horse has a strong
 * hand, but always in position or with a connected rundown hand." Synthetic cards and synthetic players only.
 *
 *  1. THE LIMP. Every change it makes is a first-in raise that became the limp of exactly the price to call, with a
 *     strong hand, in position against the likeliest raiser behind or with a connected rundown; out of position
 *     (the small blind against the big blind) only rundowns ever limp. More limps against a measured habitual
 *     raiser than against a measured tight one: the price follows his own record.
 *  2. THE RE-RAISE. Every change is the Horse's own limp, raised once heads-up, becoming a raise or all-in; never out
 *     of position without a connected rundown; never a hand the VPIP floor limped (ownVpipFloorLimpThisHand).
 *  3. Off (absent, false, a truthy non-boolean) every decision is byte for byte the one it was; a tournament, a
 *     multiway pot behind the raise, or a pot with two raises is outside the spot.
 *  4. The prior is the people-only prior.
 *  5. COST (src/testing/relativeCost.ts): the applicable decisions with the option on cost a bounded multiple of the
 *     sibling re-raised-pot price (the same equity sampler) on the same hands.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SeatPlayer } from '../types.js';
import { HorseLogic, type HorseDecideOpts, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind, readScopeOf } from './HorseMind.js';
import { enableBrainTelemetry, drainFires } from './BrainTelemetry.js';
import { seedFastRandom } from './HorseEval.js';
import { freshExploitCounters, type ExploitCounters } from './HorseOpponentExploit.js';
import {
  LIMP_RERAISE_PEOPLE_PRIOR,
  limpReraiseFoldToReraiseOf,
  limpReraiseRaiseRateOf,
  limpReraiseRundown,
  limpReraiseStrongHand,
} from './HorseOmahaLimpReraise.js';
import {
  RR_LIVE_OPTS,
  RR_PROFILE,
  cards,
  rrDecide,
  rrHands,
} from './HorseOmahaReraisedPotPriced.test-support.js';
import { measureRelativeCost } from '../testing/relativeCost.js';

enableBrainTelemetry();
afterEach(() => {
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

const OFF: HorseDecideOpts = { ...RR_LIVE_OPTS };
const ON = { ...RR_LIVE_OPTS, omahaLimpReraiseVsIsoRaiser: true } as HorseDecideOpts;
const HERO = '86000001-0000-4000-8000-00000000d1d1';
const pid = (n: number) => `5000000${n}-0000-4000-8000-00000000e${n}e${n}`;
type Variant = 'plo4' | 'plo5';
type Kind =
  /** six-max: 3, 4, 5 fold; the button (hero, seat 6) first in; the blinds behind: in position against both */
  | 'btnFirstIn'
  /** six-max: 3..6 fold; the small blind (hero, seat 1) first in; the big blind behind: out of position */
  | 'sbFirstIn'
  /** heads-up: the button / small blind (hero, seat 1) first in; the big blind behind: in position */
  | 'huFirstIn'
  /** the button limped, the small blind folded, the big blind raised the pot: hero in position, heads-up */
  | 'btnLimpRaised'
  /** the small blind limped (completed), the big blind raised the pot: hero out of position, heads-up */
  | 'sbLimpRaised'
  /** heads-up: the button limped, the big blind raised: hero in position */
  | 'huLimpRaised'
  /** the cutoff limped, the button raised, the blinds folded: hero out of position, heads-up */
  | 'coLimpRaised'
  /** the button limped, the small blind called the big blind's raise: multiway */
  | 'btnLimpRaisedMw'
  /** the button limped, the big blind raised, the button re-raised and the big blind 4-bet */
  | 'btnLimpFourBet';

function spot(
  hole: string,
  kind: Kind,
  o: { variant?: Variant; stack?: number; tournament?: boolean; floorLimp?: boolean } = {}
): { hero: SeatPlayer; gs: HorseGameStateV2 } {
  const variant = o.variant ?? 'plo5';
  const S = o.stack ?? 200;
  const hu = kind.startsWith('hu');
  const seats = hu ? [1, 2] : [1, 2, 3, 4, 5, 6];
  const dealer = hu ? 1 : 6;
  const heroSeat =
    kind === 'btnFirstIn' || kind.startsWith('btnLimp') ? 6 : kind === 'coLimpRaised' ? 5 : 1;
  const bet: Record<number, number> = {};
  for (const n of seats) bet[n] = 0;
  bet[1] = 1;
  bet[2] = 2;
  const folded = new Set<number>();
  const hist: Array<Record<string, unknown>> = [];
  let t = 0;
  const uid = (s: number) => (s === heroSeat ? HERO : pid(s));
  const act = (seat: number, action: string, amount: number) => {
    hist.push({
      stage: 'preflop',
      seat,
      userId: uid(seat),
      action,
      amount,
      ...(action === 'raise' ? { isFullRaise: true } : {}),
      timestamp: ++t,
    });
    if (action === 'fold') folded.add(seat);
    else bet[seat] = amount;
  };
  let currentBet = 2;
  if (kind === 'btnFirstIn') {
    act(3, 'fold', 0);
    act(4, 'fold', 0);
    act(5, 'fold', 0);
  } else if (kind === 'sbFirstIn') {
    for (const n of [3, 4, 5, 6]) act(n, 'fold', 0);
  } else if (kind === 'btnLimpRaised' || kind === 'btnLimpRaisedMw' || kind === 'btnLimpFourBet') {
    for (const n of [3, 4, 5]) act(n, 'fold', 0);
    act(6, 'call', 2);
    if (kind === 'btnLimpRaisedMw') {
      act(1, 'call', 2);
      act(2, 'raise', 10);
      currentBet = 10;
    } else {
      act(1, 'fold', 0);
      act(2, 'raise', 7);
      currentBet = 7;
      if (kind === 'btnLimpFourBet') {
        act(6, 'raise', 23);
        act(2, 'raise', 71);
        currentBet = 71;
      }
    }
  } else if (kind === 'sbLimpRaised') {
    for (const n of [3, 4, 5, 6]) act(n, 'fold', 0);
    act(1, 'call', 2);
    act(2, 'raise', 6);
    currentBet = 6;
  } else if (kind === 'huLimpRaised') {
    act(1, 'call', 2);
    act(2, 'raise', 6);
    currentBet = 6;
  } else if (kind === 'coLimpRaised') {
    act(3, 'fold', 0);
    act(4, 'fold', 0);
    act(5, 'call', 2);
    act(6, 'raise', 9);
    act(1, 'fold', 0);
    act(2, 'fold', 0);
    currentBet = 9;
  }
  const players = seats.map(
    (n) =>
      ({
        seat: n,
        user_id: uid(n),
        username: `P${n}`,
        stack: S - bet[n]!,
        bet: bet[n],
        totalInvested: bet[n],
        cards: n === heroSeat ? cards(hole) : [],
        is_folded: folded.has(n),
        is_all_in: false,
        is_sitting_out: false,
        is_horse: n === heroSeat,
      }) as SeatPlayer
  );
  const heroBet = bet[heroSeat]!;
  const pot = seats.reduce((a, n) => a + bet[n]!, 0);
  const toCall = currentBet - heroBet;
  const gs = {
    players,
    communityCards: [],
    pot,
    currentBet,
    toCall,
    minRaise: Math.max(2, toCall),
    minRaiseTo: currentBet + Math.max(2, toCall),
    maxRaiseTo: Math.min(S, currentBet + pot + toCall),
    legalActions: ['fold', 'call', 'raise', 'all_in'],
    stage: 'preflop',
    gameVariant: variant,
    bettingStructure: 'pot_limit',
    bigBlind: 2,
    smallBlind: 1,
    dealerSeat: dealer,
    dealtSeatIds: seats,
    humanUserIds: seats.filter((n) => n !== heroSeat).map(uid),
    gameMode: o.tournament ? 'tournament' : 'cash',
    ...(o.tournament ? { tournamentId: 't-1' } : {}),
    ...(o.floorLimp ? { ownVpipFloorLimpThisHand: true } : {}),
    publicMemoryDomain: { speed: 'table' },
    actionHistory: hist,
  } as unknown as HorseGameStateV2;
  return { hero: players.find((p) => p.seat === heroSeat)!, gs };
}

/** Every other seat measured: `rfi` raises of `opp` unraised chances, and `f3` folds of `f3opp` re-raises. */
function setRead(variant: string, rfi: number, opp: number, f3 = 0, f3opp = 0): void {
  HorseMind.reset();
  if (opp <= 0) return;
  const c: ExploitCounters = freshExploitCounters();
  Object.assign(c, {
    hands: opp * 2,
    vpip: opp,
    pfr: rfi,
    rfiOpp: opp,
    rfi,
    threeBetOpp: opp,
    threeBet: opp * 0.2,
    foldTo3BetOpp: f3opp,
    foldTo3Bet: f3,
  });
  const map = (HorseMind as unknown as { exploitCounters: Map<string, ExploitCounters> })
    .exploitCounters;
  for (const size of [2, 4, 6])
    for (const n of [1, 2, 3, 4, 5, 6])
      map.set(`${readScopeOf(variant, size)}|${pid(n)}`, { ...c });
}

const HABITUAL: [number, number] = [54, 60];
const TIGHT: [number, number] = [6, 60];

function decide(
  hole: string,
  kind: Kind,
  opts: HorseDecideOpts,
  o: Parameters<typeof spot>[2] = {},
  read: [number, number] = HABITUAL,
  seed = 7
) {
  const { hero, gs } = spot(hole, kind, o);
  setRead(o.variant ?? 'plo5', read[0], read[1]);
  drainFires();
  seedFastRandom(seed);
  const d = HorseLogic.decide(hero, gs, RR_PROFILE.style, { ...RR_PROFILE.mods }, {
    telemetry: true,
    observeMind: false,
    ...opts,
  } as never);
  const fires = drainFires().map((f) => f.feature);
  return { d, fires, gs, hero };
}

const isRaise = (a: string) => a === 'raise' || a === 'all_in';
/** the decision without its clock readings (elapsed / latency milliseconds differ run to run) */
const bytes = (d: unknown) =>
  JSON.stringify(d, (k, v) => (/(Ms|elapsed|latency)$/i.test(k) && typeof v === 'number' ? 0 : v));
const strongHands = (variant: Variant, n: number, seed: number) =>
  rrHands(n * 8, variant === 'plo4' ? 4 : 5, seed)
    .filter((h) => limpReraiseStrongHand(cards(h)))
    .slice(0, n);

describe('omahaLimpReraiseVsIsoRaiser: the limp', () => {
  for (const variant of ['plo5', 'plo4'] as const)
    it(`${variant}: every change is a strong first-in raise -> the limp of the price; out of position only rundowns`, () => {
      const hands = rrHands(160, variant === 'plo4' ? 4 : 5, 20261127);
      let limped = 0;
      for (const kind of ['btnFirstIn', 'sbFirstIn', 'huFirstIn'] as const)
        for (const h of hands) {
          const off = decide(h, kind, OFF, { variant });
          const on = decide(h, kind, ON, { variant });
          if (on.d.action === off.d.action && on.d.amount === off.d.amount) continue;
          limped++;
          expect(isRaise(off.d.action)).toBe(true);
          expect(on.d.action).toBe('call');
          expect(on.d.amount).toBeCloseTo(on.gs.currentBet - Number(on.hero.bet), 6);
          expect(limpReraiseStrongHand(cards(h))).toBe(true);
          expect(on.fires).toContain('omaha_limp_reraise_limped');
          if (kind === 'sbFirstIn') expect([h, limpReraiseRundown(cards(h))]).toEqual([h, true]);
        }
      expect(limped).toBeGreaterThan(0);
    }, 240_000);

  it('the price follows his own record: more limps against a measured habitual raiser than a measured tight one', () => {
    let habitual = 0;
    let tight = 0;
    for (const h of strongHands('plo5', 40, 77)) {
      if (decide(h, 'btnFirstIn', ON, {}, HABITUAL).d.action === 'call') habitual++;
      if (decide(h, 'btnFirstIn', ON, {}, TIGHT).d.action === 'call') tight++;
    }
    expect(habitual).toBeGreaterThan(tight);
  }, 240_000);
});

describe('omahaLimpReraiseVsIsoRaiser: the re-raise', () => {
  for (const variant of ['plo5', 'plo4'] as const)
    it(`${variant}: every change is the Horse's own limp, raised heads-up, -> a re-raise; in position or a rundown only`, () => {
      const hands = strongHands(variant, 40, 20261128);
      let reraised = 0;
      for (const read of [HABITUAL, TIGHT, [0, 0] as [number, number]])
        for (const kind of [
          'btnLimpRaised',
          'huLimpRaised',
          'sbLimpRaised',
          'coLimpRaised',
        ] as const)
          for (const h of hands) {
            const off = decide(h, kind, OFF, { variant }, read);
            const on = decide(h, kind, ON, { variant }, read);
            if (on.d.action === off.d.action && on.d.amount === off.d.amount) continue;
            reraised++;
            expect(isRaise(off.d.action)).toBe(false);
            expect(isRaise(on.d.action)).toBe(true);
            expect(on.fires).toContain('omaha_limp_reraise_reraised');
            const oop = kind === 'sbLimpRaised' || kind === 'coLimpRaised';
            if (oop) expect([h, kind, limpReraiseRundown(cards(h))]).toEqual([h, kind, true]);
          }
      expect(reraised).toBeGreaterThan(0);
    }, 240_000);

  it('a limp the VPIP floor made (ownVpipFloorLimpThisHand) is never re-raised', () => {
    for (const h of strongHands('plo5', 30, 99))
      for (const kind of ['btnLimpRaised', 'huLimpRaised'] as const) {
        const off = decide(h, kind, OFF, { floorLimp: true });
        const on = decide(h, kind, ON, { floorLimp: true });
        expect([h, on.d.action, on.d.amount]).toEqual([h, off.d.action, off.d.amount]);
        expect(on.fires.some((f) => f.startsWith('omaha_limp_reraise_'))).toBe(false);
      }
  }, 240_000);

  it('multiway behind the raise, a 4-bet pot and a tournament are outside the spot', () => {
    for (const h of strongHands('plo5', 20, 101)) {
      for (const kind of ['btnLimpRaisedMw', 'btnLimpFourBet'] as const) {
        const off = decide(h, kind, OFF);
        const on = decide(h, kind, ON);
        expect([h, kind, on.d.action, on.d.amount]).toEqual([h, kind, off.d.action, off.d.amount]);
      }
      for (const kind of ['btnLimpRaised', 'btnFirstIn'] as const) {
        const off = decide(h, kind, OFF, { tournament: true });
        const on = decide(h, kind, ON, { tournament: true });
        expect([h, kind, on.d.action, on.d.amount]).toEqual([h, kind, off.d.action, off.d.amount]);
      }
    }
  }, 240_000);
});

describe('off is byte-identical', () => {
  it('absent, false and a truthy non-boolean decide exactly as today', () => {
    for (const h of rrHands(30, 5, 4242))
      for (const kind of ['btnFirstIn', 'btnLimpRaised', 'sbLimpRaised'] as const) {
        const base = bytes(decide(h, kind, OFF).d);
        expect(
          bytes(
            decide(h, kind, { ...OFF, omahaLimpReraiseVsIsoRaiser: false } as HorseDecideOpts).d
          )
        ).toBe(base);
        expect(
          bytes(
            decide(h, kind, {
              ...OFF,
              omahaLimpReraiseVsIsoRaiser: 1,
            } as unknown as HorseDecideOpts).d
          )
        ).toBe(base);
      }
  }, 240_000);
});

describe('the prior is the people-only prior', () => {
  it('no record reads the people rates; his own record outweighs them within twenty chances', () => {
    HorseMind.reset();
    HorseMind.setDecisionScope(readScopeOf('plo5', 6), 'plo5', 'cash');
    expect(limpReraiseRaiseRateOf(pid(2), 'plo5', true)).toBeCloseTo(
      LIMP_RERAISE_PEOPLE_PRIOR.raiseRate.plo5,
      9
    );
    expect(limpReraiseRaiseRateOf(pid(2), 'plo4', true)).toBeCloseTo(
      LIMP_RERAISE_PEOPLE_PRIOR.raiseRate.plo4,
      9
    );
    expect(limpReraiseFoldToReraiseOf(pid(2), true)).toBeCloseTo(
      LIMP_RERAISE_PEOPLE_PRIOR.foldToReraise.people,
      9
    );
    setRead('plo5', 2, 20);
    HorseMind.setDecisionScope(readScopeOf('plo5', 6), 'plo5', 'cash');
    expect(limpReraiseRaiseRateOf(pid(2), 'plo5', true)).toBeLessThan(0.25);
    expect(limpReraiseRaiseRateOf(pid(2), 'plo5', false)).toBeCloseTo(
      LIMP_RERAISE_PEOPLE_PRIOR.raiseRate.plo5,
      9
    );
  });
  it('a connected rundown: four distinct ranks in a five-rank window, nine-high or better', () => {
    expect(limpReraiseRundown(cards('JhTs9d8c'))).toBe(true);
    expect(limpReraiseRundown(cards('JhTs9d7c'))).toBe(true);
    expect(limpReraiseRundown(cards('JhTs8d7c'))).toBe(true);
    expect(limpReraiseRundown(cards('JhTs7d6c'))).toBe(false);
    expect(limpReraiseRundown(cards('8h7s6d5c'))).toBe(false);
    expect(limpReraiseRundown(cards('AhKsQdJc2h'))).toBe(true);
    expect(limpReraiseRundown(cards('AhAsKdKc'))).toBe(false);
  });
});

describe('LAW: the limp-re-raise price is cheap where it applies', () => {
  it('applicable decisions with omahaLimpReraiseVsIsoRaiser on cost a bounded multiple of the sibling re-raised-pot price', () => {
    const spots: { hole: string; kind: Kind; variant: Variant; stack: number }[] = [];
    for (const variant of ['plo4', 'plo5'] as const)
      for (const stack of [200, 600, 1600])
        for (const kind of ['btnFirstIn', 'btnLimpRaised'] as Kind[]) {
          const hand = strongHands(variant, 30, 700 + stack).find((h) =>
            decide(h, kind, ON, { variant, stack }).fires.some((f) =>
              f.startsWith('omaha_limp_reraise_')
            )
          );
          if (hand) spots.push({ hole: hand, kind, variant, stack });
        }
    expect(spots.length).toBeGreaterThanOrEqual(6);
    const run = (opts: HorseDecideOpts) => () => {
      for (const s of spots) decide(s.hole, s.kind, opts, { variant: s.variant, stack: s.stack });
    };
    // the reference: the sibling re-raised-pot price (omahaReraisedPotFoldReraiseIsPriced and
    // omahaReraisedPotReraiseIsPriced, the same equity sampler) on the same hands facing a 3-bet
    const SIB = {
      ...RR_LIVE_OPTS,
      omahaReraisedPotFoldReraiseIsPriced: true,
      omahaReraisedPotReraiseIsPriced: true,
    } as HorseDecideOpts;
    const sib = () => {
      for (const s of spots)
        rrDecide(s.hole, 'oopHu', SIB, 11, { variant: s.variant, stack: s.stack }, [54, 60]);
    };
    const cost = measureRelativeCost(run(ON), sib, { warmupRounds: 1, rounds: 5 });
    console.info(
      `[limp re-raise price] on ${cost.subjectMs.toFixed(2)} ms, sibling ${cost.referenceMs.toFixed(2)} ms, ratio ${cost.ratio.toFixed(2)} over ${spots.length} spots`
    );
    expect(cost.ratio).toBeLessThan(4);
  }, 240_000);
});
