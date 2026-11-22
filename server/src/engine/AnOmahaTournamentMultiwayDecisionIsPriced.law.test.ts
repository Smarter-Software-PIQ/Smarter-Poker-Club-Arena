/**
 * LAW: AN OMAHA TOURNAMENT MULTIWAY DECISION IS PRICED (HORSE DECISIONS lane,
 * builder F-FIX, 2026-11-19).
 *
 * Auditor F (archive plo-handoff-review-01a1cbbd/hvh48-audit-01TLQer7J/
 * F-plo-tournament/REPORT.md) measured, in PLO4/5/6/8 tournaments against
 * people, Horses calling off their stacks multiway with dead equity (class 2)
 * and betting into several opponents with less than the check was worth
 * (class 3), and Horses folding their last crumbs or a big blind at exactly
 * 3.5 to 1 (root cause 6). This law pins the repair on the auditor's hands:
 *
 *  1. omahaMultiwayIsPricedInTournaments (default OFF): each recorded
 *     call-off and bet stands with the option off (red) and is folded or
 *     checked with it on (green); off and unset are the same object; cash
 *     and heads-up spots are never touched.
 *     Review N2: only a call (or an all-in that only calls) is priced as a
 *     call-off; a raise or an all-in raise is worth its fold equity and is
 *     left to the rules that price raises. Review N1: every decision it
 *     makes with the option on passes the live receipt validator, and its
 *     conversions are admitted only under the decision's own option.
 *  2. Plain bug fixes, no option: the V11 one-big-blind line is 3.5 to 1
 *     exactly (0d1f980b), and the crumbs fold of the class gate is called
 *     (84233985, 6e17fcee, 83b469ee).
 */
import { describe, expect, it } from 'vitest';
import type { HorseDecision } from '../types.js';
import {
  decidePreflopV7,
  type PreflopCtx,
  PRICE_IN_ONE_BB_ODDS,
  priceInOneBbOdds,
} from './HorsePreflop.js';
import {
  omahaMwBetVerdict,
  omahaMwCallOffSpot,
  omahaMwCallOffVerdict,
  omahaMwTourneyAdmits,
} from './HorseOmahaMultiwayPricedInTournaments.js';
import {
  horseDecisionReceiptRefusal,
  omahaMultiwayIsPricedInTournamentsGateCandidates,
} from './horseDecision/responseValidation.js';
import {
  BET_FIXTURES,
  CALL_OFF_FIXTURES,
  fixtureSpot,
  type MwFixture,
} from './HorseOmahaMultiwayPricedInTournaments.test-support.js';
import { tournamentCrumbsCallFloor } from './HorseTournamentCrumbsCallFloor.js';
import { HorseLogic } from './HorseLogic.js';
import { seedFastRandom } from './HorseEval.js';

/** The option's verdict on a fixture (null when off: nothing is priced). */
function ruled(f: MwFixture, on: boolean): HorseDecision {
  const { hero, state, decision } = fixtureSpot(f);
  if (!on) return decision;
  if (f.street === 'preflop') {
    const v = omahaMwCallOffVerdict(hero, state, decision, f.bubbleFactor);
    expect(v).not.toBeNull();
    return v!.action === 'fold' ? { ...decision, action: 'fold' } : decision;
  }
  const v = omahaMwBetVerdict(hero, state, decision);
  expect(v).not.toBeNull();
  return v!.action === 'check' ? { ...decision, action: 'check' } : decision;
}

describe('omahaMultiwayIsPricedInTournaments: the auditor-F call-offs', () => {
  for (const f of CALL_OFF_FIXTURES) {
    it(`${f.id.slice(0, 8)} (${f.variant}, ${f.opponents.length} opponents): red off, folded on`, () => {
      expect(ruled(f, false).action).toBe(f.decision.action);
      const { hero, state, decision } = fixtureSpot(f);
      const v = omahaMwCallOffVerdict(hero, state, decision, f.bubbleFactor)!;
      expect(v.action).toBe('fold');
      expect(v.share + v.se).toBeLessThan(v.required);
      expect(ruled(f, true).action).toBe('fold');
    });
  }

  it('PLO8 quartering is priced: the hi/lo share is not the hi-only share', () => {
    const f = CALL_OFF_FIXTURES.find((x) => x.id.startsWith('88e6c8f3'))!;
    const hiLo = fixtureSpot(f);
    const asHigh = fixtureSpot({ ...f, variant: 'plo4' });
    const a = omahaMwCallOffVerdict(hiLo.hero, hiLo.state, hiLo.decision, 1)!;
    const b = omahaMwCallOffVerdict(asHigh.hero, asHigh.state, asHigh.decision, 1)!;
    expect(a.share).not.toBe(b.share);
  });

  it('the bubble factor raises the share a call needs', () => {
    const f = CALL_OFF_FIXTURES[0];
    const { hero, state, decision } = fixtureSpot(f);
    const chip = omahaMwCallOffVerdict(hero, state, decision, null)!;
    const icm = omahaMwCallOffVerdict(hero, state, decision, 1.3)!;
    expect(icm.required).toBeGreaterThan(chip.required);
    expect(icm.share).toBe(chip.share);
  });

  it('a premium hand facing the same call-off keeps it (no blanket fold)', () => {
    const f = CALL_OFF_FIXTURES.find((x) => x.id.startsWith('88e6c8f3'))!;
    const { hero, state, decision } = fixtureSpot({ ...f, hero: 'AsAd2s3d' });
    expect(omahaMwCallOffVerdict(hero, state, decision, 1)!.action).toBe('keep');
  });

  it('review N2: a raise or an all-in raise is never priced as a call; the call on the same spot is', () => {
    for (const f of CALL_OFF_FIXTURES) {
      const { hero, state } = fixtureSpot(f);
      const call = { action: 'call' as const, thinkTime: 0 };
      expect(omahaMwCallOffSpot(hero, state, call), f.id).not.toBeNull();
      const raise = { action: 'raise' as const, amount: state.currentBet * 3, thinkTime: 0 };
      expect(omahaMwCallOffSpot(hero, state, raise), f.id).toBeNull();
      expect(omahaMwCallOffVerdict(hero, state, raise, 1), f.id).toBeNull();
      // an all-in that puts in more than the call raises: not priced; an all-in for the call or less is
      const deep = fixtureSpot({ ...f, heroBehindBB: f.toCallBB + 1 });
      const jam = { action: 'all_in' as const, thinkTime: 0 };
      expect(omahaMwCallOffSpot(deep.hero, deep.state, jam), f.id).toBeNull();
      if (f.heroBehindBB <= f.toCallBB)
        expect(omahaMwCallOffSpot(hero, state, jam), f.id).not.toBeNull();
    }
  });

  it('heads-up, cash and a deep call are outside the option', () => {
    const f = CALL_OFF_FIXTURES.find((x) => x.id.startsWith('88e6c8f3'))!;
    const hu = fixtureSpot({ ...f, opponents: [f.opponents[0]], preflop: [[0, 'all_in', true]] });
    expect(omahaMwCallOffVerdict(hu.hero, hu.state, hu.decision, 1)).toBeNull();
    const cash = fixtureSpot(f);
    cash.state.gameMode = 'cash';
    expect(omahaMwCallOffVerdict(cash.hero, cash.state, cash.decision, 1)).toBeNull();
    const deep = fixtureSpot({ ...f, heroBehindBB: 200 });
    expect(omahaMwCallOffVerdict(deep.hero, deep.state, deep.decision, 1)).toBeNull();
  });
});

describe('omahaMultiwayIsPricedInTournaments: the auditor-F multiway bets', () => {
  for (const f of BET_FIXTURES.filter((x) => !x.id.startsWith('583495d0'))) {
    it(`${f.id.slice(0, 8)} (${f.street}, ${f.opponents.length} opponents): red off, checked on`, () => {
      expect(ruled(f, false).action).toBe(f.decision.action);
      const { hero, state, decision } = fixtureSpot(f);
      const v = omahaMwBetVerdict(hero, state, decision)!;
      expect(v.evBet).toBeLessThan(v.evCheck - v.margin);
      expect(ruled(f, true).action).toBe('check');
    });
  }

  it('583495d0: the jam priced equal to the check is kept (the margin, not a blanket rule)', () => {
    const f = BET_FIXTURES.find((x) => x.id.startsWith('583495d0'))!;
    const { hero, state, decision } = fixtureSpot(f);
    const v = omahaMwBetVerdict(hero, state, decision)!;
    expect(Math.abs(v.evBet - v.evCheck)).toBeLessThanOrEqual(v.margin);
    expect(v.action).toBe('keep');
  });

  it('the nuts keeps its multiway bet', () => {
    const f = BET_FIXTURES.find((x) => x.id.startsWith('f9962d3c'))!;
    // 7-6 on 4-8-5 is the nut straight
    const { hero, state, decision } = fixtureSpot({ ...f, hero: '7c6sAhKd' });
    expect(omahaMwBetVerdict(hero, state, decision)!.action).toBe('keep');
  });
});

describe('omahaMultiwayIsPricedInTournaments through HorseLogic.decide', () => {
  const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
  const decide = (f: MwFixture, seed: number, on?: boolean) => {
    const { hero, state } = fixtureSpot(f);
    seedFastRandom(seed);
    const d = HorseLogic.decide(
      hero,
      state,
      'balanced',
      {},
      {
        mind: false,
        telemetry: false,
        ...(on === undefined ? {} : { omahaMultiwayIsPricedInTournaments: on }),
      }
    );
    return { action: d.action, amount: d.amount ?? null };
  };
  for (const f of [...CALL_OFF_FIXTURES, ...BET_FIXTURES]) {
    it(`${f.id.slice(0, 8)}: off and unset decide alike`, () => {
      for (const seed of SEEDS) expect(decide(f, seed, false)).toEqual(decide(f, seed));
    });
  }
  it('on, every call-off and bet the brain makes on a fixture spot is folded or checked', () => {
    let judged = 0;
    for (const f of [
      ...CALL_OFF_FIXTURES,
      ...BET_FIXTURES.filter((x) => !x.id.startsWith('583495d0')),
    ])
      for (const seed of SEEDS) {
        const unset = decide(f, seed);
        const on = decide(f, seed, true);
        // review N2: preflop only a call (or an all-in that only calls) is a call-off
        const { hero, state } = fixtureSpot(f);
        const continues =
          f.street === 'preflop'
            ? omahaMwCallOffSpot(hero, state, { ...unset, thinkTime: 0 } as HorseDecision) !== null
            : ['bet', 'raise', 'all_in'].includes(String(unset.action));
        if (!continues) {
          expect(on).toEqual(unset);
          continue;
        }
        judged++;
        expect(on.action).toBe(f.street === 'preflop' ? 'fold' : 'check');
      }
    // not vacuous: the brain makes some of the recorded continues on these spots
    expect(judged).toBeGreaterThan(0);
  });
});

describe('omahaMultiwayIsPricedInTournaments: the live receipt validator (review N1)', () => {
  const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
  const decideFull = (f: MwFixture, seed: number, on: boolean): HorseDecision => {
    const { hero, state } = fixtureSpot(f);
    seedFastRandom(seed);
    return structuredClone(
      HorseLogic.decide(
        hero,
        state,
        'balanced',
        {},
        { mind: false, telemetry: false, omahaMultiwayIsPricedInTournaments: on }
      )
    );
  };
  it('every decision it makes with the option on passes the validator under its own option', () => {
    let converted = 0;
    let graphs = 0;
    for (const f of [...CALL_OFF_FIXTURES, ...BET_FIXTURES])
      for (const seed of SEEDS) {
        const d = decideFull(f, seed, true);
        const { hero, state } = fixtureSpot(f);
        if (d.policyGraph !== undefined) graphs++;
        expect(
          horseDecisionReceiptRefusal(structuredClone(d), f.variant, {
            player: hero,
            gameState: state,
            omahaMultiwayPricedInTournaments: true,
          }),
          `${f.id.slice(0, 8)} seed ${seed}`
        ).toBeNull();
        const off = decideFull(f, seed, false);
        if (d.action !== off.action) converted++;
      }
    // not vacuous: decisions carry the signed graph and some are converted by the option
    expect(graphs).toBeGreaterThan(0);
    expect(converted).toBeGreaterThan(0);
  });
  it('its PLO8 fold and its tournament check are admitted only under the decision own option', () => {
    // the rule's own spot, re-derived from the request
    const f8 = CALL_OFF_FIXTURES.find((x) => x.variant === 'plo8')!;
    const s8 = fixtureSpot(f8);
    expect(omahaMwTourneyAdmits(s8.hero, s8.state, { action: 'call' }, 'fold')).toBe(true);
    expect(omahaMwTourneyAdmits(s8.hero, s8.state, { action: 'call' }, 'check')).toBe(false);
    const fb = BET_FIXTURES[0];
    const sb = fixtureSpot(fb);
    expect(
      omahaMwTourneyAdmits(
        sb.hero,
        sb.state,
        { action: 'bet', amount: sb.decision.amount },
        'check'
      )
    ).toBe(true);
    expect(omahaMwTourneyAdmits(sb.hero, sb.state, { action: 'bet', amount: 1 }, 'fold')).toBe(
      false
    );
    // The fixture brain already folds or checks these spots, so the rule's conversion is written into the
    // decision's own signed graph: the wager_rules node turns the recorded wager into the rule's answer.
    const converted = (
      d: HorseDecision,
      from: { action: string; amount: number | null },
      to: string
    ) => {
      const out = structuredClone(d) as unknown as {
        policyGraph: { transitions: Array<Record<string, unknown>>; finalAction: unknown };
        action: string;
        amount?: number;
      };
      const fin = { action: to, amount: null };
      let seen = false;
      out.policyGraph.transitions = out.policyGraph.transitions.map((t, i) => {
        const wr = t.node === 'wager_rules';
        const before = i === 0 ? null : seen ? fin : from;
        const after = wr || seen ? fin : from;
        if (wr) seen = true;
        return { ...t, before, after, changed: wr };
      });
      out.policyGraph.finalAction = fin;
      out.action = to;
      delete out.amount;
      return out as unknown as HorseDecision;
    };
    let refusedOff = 0;
    for (const f of [f8, ...BET_FIXTURES]) {
      const d = decideFull(f, 1, true);
      expect(d.policyGraph).toBeDefined();
      const { hero, state, decision } = fixtureSpot(f);
      const preflop = f.street === 'preflop';
      const conv = preflop
        ? converted(d, { action: 'call', amount: state.toCall ?? null }, 'fold')
        : converted(d, { action: decision.action, amount: decision.amount ?? null }, 'check');
      const ctx = { player: hero, gameState: state };
      if (horseDecisionReceiptRefusal(structuredClone(conv), f.variant, ctx) !== null) refusedOff++;
      expect(
        horseDecisionReceiptRefusal(structuredClone(conv), f.variant, {
          ...ctx,
          omahaMultiwayPricedInTournaments: true,
        }),
        f.id.slice(0, 8)
      ).toBeNull();
    }
    // PLO8's fold is outside the paired-board fold admission: without its option it was refused
    expect(refusedOff).toBeGreaterThan(0);
  });
  it('gate candidates: the delivered switch row first, then the request own option', () => {
    expect(omahaMultiwayIsPricedInTournamentsGateCandidates({}, null)).toEqual([false]);
    expect(
      omahaMultiwayIsPricedInTournamentsGateCandidates(
        { omahaMultiwayIsPricedInTournaments: true },
        null
      )
    ).toEqual([true]);
  });
});

describe('plain bug fixes (no option)', () => {
  const ctx: PreflopCtx = {
    strength: 0,
    position: 'bb',
    raiserPosition: 'late',
    raises: 1,
    limpers: 0,
    callers: 0,
    oppsLeft: 1,
    toCall: 100,
    currentBet: 200,
    pot: 350,
    bigBlind: 100,
    stack: 7926,
    stackBB: 79.26,
    tightness: 1,
    bluffFreq: 0,
    aggression: 1,
    slowplayFreq: 0,
    sizingMultiplier: 1,
    isOmaha: true,
    isPotLimit: true,
    riskAdd: 0,
    mode: 'tournament',
    tableSize: 6,
    rand: () => 0.5,
  };

  it('0d1f980b: a big blind folding 1 bb into 3.5 bb (price 0.2222) is priced in', () => {
    expect(100 / (350 + 100)).toBeLessThanOrEqual(PRICE_IN_ONE_BB_ODDS);
    expect(100 / (350 + 100)).toBeGreaterThan(0.22); // the old line folded it
    expect(decidePreflopV7(ctx).a).toBe('call');
    // a worse price than 3.5 to 1 is not
    expect(decidePreflopV7({ ...ctx, pot: 340 }).a).toBe('fold');
    // other games keep the 0.22 line they have played (their owners decide)
    expect(priceInOneBbOdds({ isOmaha: false })).toBe(0.22);
    expect(priceInOneBbOdds({ isOmaha: true, isFixedLimit: true })).toBe(0.22);
  });

  const crumbs = (stackBB: number, potBB: number, opponents: number) => {
    const f: MwFixture = {
      id: 'crumbs',
      ordinal: 0,
      variant: 'plo4',
      street: 'preflop',
      hero: 'AsAdAh2c',
      board: '',
      heroInBB: 0,
      heroBehindBB: stackBB,
      potBB,
      toCallBB: stackBB,
      bubbleFactor: 1,
      opponents: Array.from({ length: opponents }, () => ({ inBB: 1, behindBB: 30 })),
      preflop: [[0, 'raise']],
      decision: { action: 'fold' },
    };
    return fixtureSpot(f);
  };

  for (const [id, stackBB, potBB, opponents] of [
    ['84233985', 0.55, 4, 4],
    ['6e17fcee', 0.55, 4.5, 3],
    ['83b469ee', 0.92, 4, 4],
  ] as const) {
    it(`${id}: the class gate's fold of the last ${stackBB} bb is called`, () => {
      const { hero, state, decision } = crumbs(stackBB, potBB, opponents);
      // the V46 class gate folds before the guard (red without the floor)
      expect(
        decidePreflopV7({
          ...ctx,
          classFoldAlways: true,
          stack: stackBB * 100,
          stackBB,
          toCall: stackBB * 100,
          pot: potBB * 100,
          oppsLeft: opponents,
        }).a
      ).toBe('fold');
      const floored = tournamentCrumbsCallFloor(decision, hero, state);
      expect(floored.action).toBe('all_in');
    });
  }

  it('the crumbs floor stays priced: a price worse than the field share, a deeper stack or cash keeps the fold', () => {
    const multi = crumbs(1.5, 3, 5); // price 1.5 / 4.5 = 0.333 > 1/6
    expect(tournamentCrumbsCallFloor(multi.decision, multi.hero, multi.state)).toBe(multi.decision);
    const deep = crumbs(3, 20, 3);
    expect(tournamentCrumbsCallFloor(deep.decision, deep.hero, deep.state)).toBe(deep.decision);
    const cash = crumbs(0.55, 4, 4);
    cash.state.gameMode = 'cash';
    expect(tournamentCrumbsCallFloor(cash.decision, cash.hero, cash.state)).toBe(cash.decision);
    const holdem = crumbs(0.55, 4, 4);
    holdem.state.gameVariant = 'nlh';
    expect(tournamentCrumbsCallFloor(holdem.decision, holdem.hero, holdem.state)).toBe(
      holdem.decision
    );
  });
});
