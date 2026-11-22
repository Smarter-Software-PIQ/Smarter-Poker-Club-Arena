/**
 * LAW (EMERG lanes STAB-DEFENCE / STAB-DEFENCE-2, 2026-11-20): omahaStrongHandCheckIsPriced (the priced check of a
 * value bet, HorseOmahaStrongHandCheck) and the decision-level laws of omahaStabDefenceIsPriced (HorseOmahaStabDefence)
 * behind the lifetime street record provider (HorseMind.setOmahaLifetimeStreetRecordProvider). Both default OFF.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Card, CardRank, HorseDecision, SeatPlayer } from '../types.js';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind, OmahaLifetimeStreetRecordMemory } from './HorseMind.js';
import { omahaLifetimeProviderFromHud } from './HorseOmahaLifetimeHudAdapter.js';
import { seedFastRandom } from './HorseEval.js';
import { omahaEvPriorBluffShare } from './HorseOmahaFacingBetEv.js';
import {
  OMAHA_STAB_DEFENCE_TABLE,
  omahaStabDefencePriorOpps,
  omahaStabDefenceShare,
} from './HorseOmahaStabDefence.js';
import {
  OMAHA_STRONG_HAND_CHECK_FOLD_POPULATION,
  OMAHA_STRONG_HAND_CHECK_FOLD_PRIOR_OPPS,
  OMAHA_STRONG_HAND_CHECK_STAB_SIZE,
  OMAHA_STRONG_HAND_CHECK_STAB_SIZE_PRIOR_STABS,
  OMAHA_STRONG_HAND_CHECK_STAB_SIZE_TABLE,
  OMAHA_STRONG_HAND_CHECK_TURN_RESPONSE,
  omahaStrongHandCheckCurveOf,
  omahaStrongHandCheckFoldMultiplier,
  omahaStrongHandCheckStabSize,
  omahaStrongHandCheck,
  omahaStrongHandCheckRule,
  omahaStrongHandCheckSpot,
  omahaStrongHandCheckStab,
} from './HorseOmahaStrongHandCheck.js';

const SUIT: Record<string, Card['suit']> = {
  h: 'hearts',
  d: 'diamonds',
  c: 'clubs',
  s: 'spades',
} as Record<string, Card['suit']>;
function cards(text: string): Card[] {
  const out: Card[] = [];
  for (let i = 0; i + 1 < text.length; i += 2)
    out.push({ rank: text[i] as CardRank, suit: SUIT[text[i + 1]] });
  return out;
}
const VILLAIN = '10000000-0000-4000-8000-00000000sd02';
const TIMING_KEYS = new Set(['latencyMs', 'elapsedMs', 'simulationMs', 'policyMs', 'thinkTime']);

interface Spot {
  hero: SeatPlayer;
  gs: HorseGameStateV2;
}
/** Heads-up, hero (seat 1) out of position. `facing` > 0: the opponent bet that much after the hero's check. */
function spot(
  variant: string,
  hole: string,
  board: string,
  stage: 'turn' | 'river',
  facing = 0,
  mode = 'cash'
): Spot {
  const pre = 15;
  const pot0 = 60;
  const players = [
    {
      seat: 1,
      user_id: 'hero',
      username: 'h',
      stack: 370,
      bet: 0,
      totalInvested: 30,
      cards: cards(hole),
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
    },
    {
      seat: 2,
      user_id: VILLAIN,
      username: 'v',
      stack: 370 - facing,
      bet: facing,
      totalInvested: 30 + facing,
      cards: [],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: false,
    },
  ] as SeatPlayer[];
  const history: Array<Record<string, unknown>> = [
    { stage: 'preflop', seat: 2, userId: VILLAIN, action: 'raise', amount: pre },
    { stage: 'preflop', seat: 1, userId: 'hero', action: 'call', amount: pre - 2 },
    { stage: 'flop', seat: 1, userId: 'hero', action: 'bet', amount: pre },
    { stage: 'flop', seat: 2, userId: VILLAIN, action: 'call', amount: pre },
  ];
  if (stage === 'river')
    history.push(
      { stage: 'turn', seat: 1, userId: 'hero', action: 'check', amount: 0 },
      { stage: 'turn', seat: 2, userId: VILLAIN, action: 'check', amount: 0 }
    );
  if (facing > 0)
    history.push(
      { stage, seat: 1, userId: 'hero', action: 'check', amount: 0 },
      { stage, seat: 2, userId: VILLAIN, action: 'bet', amount: facing }
    );
  const gs = {
    players,
    communityCards: cards(board).slice(0, stage === 'turn' ? 4 : 5),
    pot: pot0 + facing,
    currentBet: facing,
    toCall: facing,
    minRaiseTo: facing > 0 ? facing * 2 : 2,
    maxRaiseTo: facing > 0 ? Math.min(370, pot0 + 3 * facing) : pot0,
    legalActions: facing > 0 ? ['fold', 'call', 'raise', 'all_in'] : ['check', 'bet', 'all_in'],
    stage,
    gameVariant: variant,
    bettingStructure: 'pot_limit',
    gameMode: mode,
    bigBlind: 2,
    dealerSeat: 2,
    actionHistory: history.map((a, k) => ({ ...a, timestamp: k })),
  };
  return { hero: players[0], gs: gs as unknown as HorseGameStateV2 };
}
const BOARD = 'Ah7d2c9s3h';
/** the wheel: the current nuts on both streets of BOARD? (river: 4-5 makes A-5) */
const STRONG = '4c5dKsQd8h';
const MEDIUM = 'AsKc8d6h4s';
const WEAK = 'KsQdJc8h6d';
const FIRST: Spot[] = [STRONG, MEDIUM, WEAK].flatMap((h) => [
  spot('plo5', h, BOARD, 'river'),
  spot('plo5', h, BOARD, 'turn'),
  spot('plo4', h.slice(0, 8), BOARD, 'river'),
]);
const FACING: Spot[] = [STRONG, MEDIUM, WEAK].flatMap((h) => [
  spot('plo5', h, BOARD, 'river', 60),
  spot('plo5', h, BOARD, 'turn', 60),
  spot('plo4', h.slice(0, 8), BOARD, 'river', 45),
]);
const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

function stabber(): OmahaLifetimeStreetRecordMemory {
  const m = new OmahaLifetimeStreetRecordMemory();
  for (const game of ['plo4', 'plo5', 'plo6'])
    for (const street of ['flop', 'turn', 'river'])
      for (const players of ['hu', 'mw'] as const)
        for (let i = 0; i < 400; i++) m.note(VILLAIN, game, street, players, true);
  return m;
}
function decide(s: Spot, opts: Record<string, unknown>, seed: number): string {
  const c = copy(s);
  seedFastRandom(seed * 7919 + 21);
  HorseMind.reset();
  const d = HorseLogic.decide(c.hero, c.gs as never, 'balanced', {}, {
    observeMind: false,
    omahaFacingBetEv: true,
    ...opts,
  } as never);
  return JSON.stringify(d, (k, v) => (TIMING_KEYS.has(k) ? 0 : v));
}
const bet = (amount: number): HorseDecision => ({ action: 'bet', amount, thinkTime: 1 });

afterEach(() => {
  HorseMind.setOmahaLifetimeStreetRecordProvider(null);
  HorseMind.reset();
  vi.restoreAllMocks();
});

describe('omahaStrongHandCheckIsPriced: the comparison (HorseOmahaStrongHandCheck)', () => {
  it('1. off, or any decision that is not a bet: the same object; never outside the first-to-act spot', () => {
    for (const s of FIRST) {
      const d = bet(40);
      expect(omahaStrongHandCheckRule(d, s.hero, s.gs, false, 0.05, () => null).decision).toBe(d);
      const chk: HorseDecision = { action: 'check', thinkTime: 1 };
      expect(omahaStrongHandCheckRule(chk, s.hero, s.gs, true, 0.05, () => null).decision).toBe(
        chk
      );
    }
    for (const s of FACING) expect(omahaStrongHandCheckSpot(s.hero, s.gs)).toBeNull();
    const six = spot('plo5', STRONG, BOARD, 'river');
    six.gs.gameVariant = 'plo6';
    six.hero.cards = cards(STRONG + '2d');
    expect(omahaStrongHandCheckSpot(six.hero, six.gs)).toBeNull();
    const tour = spot('plo5', STRONG, BOARD, 'river', 0, 'tournament');
    expect(omahaStrongHandCheckSpot(tour.hero, tour.gs)).toBeNull();
  });

  it('2. no record: his stab frequency and its non-value share are the population exactly', () => {
    for (const variant of ['plo4', 'plo5'])
      for (const street of ['turn', 'river'] as const) {
        const st = omahaStrongHandCheckStab(variant, street, null)!;
        const q0 = omahaEvPriorBluffShare(street, OMAHA_STRONG_HAND_CHECK_STAB_SIZE, false);
        expect(st.s).toBeCloseTo(OMAHA_STAB_DEFENCE_TABLE[`${variant}|${street}|hu`].betRate, 10);
        expect(st.q).toBeCloseTo(q0, 10);
        expect(st.weight).toBe(0);
        const empty = omahaStrongHandCheckStab(variant, street, { bets: 0, opps: 0 })!;
        expect(empty.s).toBe(st.s);
        expect(empty.q).toBe(st.q);
      }
  });

  it('3. the record moves the frequency by n / (n + k) with the k of its street', () => {
    for (const street of ['turn', 'river'] as const) {
      const k = omahaStabDefencePriorOpps(street, 1);
      const pop = OMAHA_STAB_DEFENCE_TABLE[`plo5|${street}|hu`].betRate;
      const st = omahaStrongHandCheckStab('plo5', street, { bets: 50, opps: 50 })!;
      expect(st.weight).toBeCloseTo(50 / (50 + k), 10);
      expect(st.s).toBeCloseTo((50 + k * pop) / (50 + k), 6);
      expect(st.q).toBeGreaterThan(omahaStrongHandCheckStab('plo5', street, null)!.q);
    }
    expect(omahaStabDefencePriorOpps('turn', 1)).toBe(43);
    expect(omahaStabDefencePriorOpps('river', 1)).toBe(33);
    expect(omahaStabDefencePriorOpps('turn', 3)).toBe(62);
    expect(omahaStabDefencePriorOpps('river', 3)).toBe(45);
  });

  it('4. the check is worth more against a frequent stabber; the mix is the comparison, the draw decides', () => {
    let priced = 0;
    for (const s of FIRST) {
      const sp = omahaStrongHandCheckSpot(s.hero, s.gs);
      expect(sp).not.toBeNull();
      const pop = omahaStrongHandCheck(s.hero, s.gs, sp!, 40, 0.05, null, 0.5);
      const hot = omahaStrongHandCheck(s.hero, s.gs, sp!, 40, 0.05, { bets: 400, opps: 400 }, 0.5);
      if (!pop || !hot) continue;
      priced++;
      for (const v of [pop, hot]) {
        expect(v.mix).toBeGreaterThanOrEqual(0);
        expect(v.mix).toBeLessThanOrEqual(1);
        expect(v.error).toBeGreaterThan(0);
        expect(v.mix).toBeCloseTo(
          Math.max(0, Math.min(1, 0.5 + (v.evCheck - v.evBet) / (2 * v.error))),
          1
        );
      }
      // his frequency also re-weights his earlier checks in the range model: the bet moves little, the check more
      expect(Math.abs(hot.evBet - pop.evBet)).toBeLessThan(0.05 * s.gs.pot);
      const never = omahaStrongHandCheck(s.hero, s.gs, sp!, 40, 0.05, null, 1);
      expect(never!.action).toBe('bet');
      const always = omahaStrongHandCheck(s.hero, s.gs, sp!, 40, 0.05, null, -1);
      expect(always!.action).toBe(always!.value && always!.mix > 0 ? 'check' : 'bet');
    }
    expect(priced).toBeGreaterThan(0);
  });

  it('5. a change is only bet -> check; deterministic', () => {
    for (const s of FIRST)
      for (const rec of [null, { bets: 400, opps: 400 }]) {
        const d = bet(40);
        const a = omahaStrongHandCheckRule(d, s.hero, s.gs, true, 0.05, () => rec);
        const b = omahaStrongHandCheckRule(d, s.hero, s.gs, true, 0.05, () => rec);
        expect(JSON.stringify(a.decision)).toBe(JSON.stringify(b.decision));
        if (a.changed) {
          expect(a.decision.action).toBe('check');
          expect(a.decision.amount).toBeUndefined();
        } else expect(a.decision).toBe(d);
      }
  });

  it('6. source law: counts and frequencies only; no identity, no random stream', () => {
    const src = readFileSync(new URL('./HorseOmahaStrongHandCheck.ts', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const banned of [
      'is_horse',
      'isHorse',
      'kind',
      'person',
      'username',
      'user_id',
      'Math.random',
    ])
      expect(code.includes(banned), banned).toBe(false);
  });
});

describe('the decision-level laws of the two options', () => {
  const B = { omahaStrongHandCheckIsPriced: true };
  const A = { omahaStabDefenceIsPriced: true };

  it('7. omahaStrongHandCheckIsPriced off is identical to absent, with a provider holding a heavy record', () => {
    HorseMind.setOmahaLifetimeStreetRecordProvider(stabber());
    const spy = vi.spyOn(HorseMind, 'omahaStabDefenceRecordOf');
    for (const s of [...FIRST, ...FACING])
      for (const seed of [1, 2])
        expect(decide(s, { omahaStrongHandCheckIsPriced: false }, seed)).toBe(decide(s, {}, seed));
    expect(spy).not.toHaveBeenCalled();
  });

  it('8. omahaStabDefenceIsPriced off is identical to absent and never reads the record', () => {
    HorseMind.setOmahaLifetimeStreetRecordProvider(stabber());
    const spy = vi.spyOn(HorseMind, 'omahaStabDefenceRecordOf');
    for (const s of [...FACING, ...FIRST])
      for (const seed of [1, 2])
        expect(decide(s, { omahaStabDefenceIsPriced: false }, seed)).toBe(decide(s, {}, seed));
    expect(spy).not.toHaveBeenCalled();
  });

  it('9. no provider: the price is the population prior exactly and both options decide as off', () => {
    for (const q0 of [0.13, 0.19, 0.22, 0.4])
      for (const cell of Object.keys(OMAHA_STAB_DEFENCE_TABLE)) {
        const [variant, street, players] = cell.split('|');
        expect(
          omahaStabDefenceShare(
            q0,
            HorseMind.omahaStabDefenceRecordOf(VILLAIN, variant, street, players === 'hu' ? 1 : 3),
            variant,
            street,
            players === 'hu' ? 1 : 3
          )!.q
        ).toBeCloseTo(q0, 12);
      }
    for (const s of FACING)
      for (const seed of [1, 2]) expect(decide(s, A, seed)).toBe(decide(s, {}, seed));
  });

  it('10. PLO6 and tournaments decide alike with both options on and a heavy record', () => {
    HorseMind.setOmahaLifetimeStreetRecordProvider(stabber());
    for (const base of [...FIRST.slice(0, 2), ...FACING.slice(0, 2)]) {
      const six = copy(base);
      six.gs.gameVariant = 'plo6';
      six.hero.cards = [...six.hero.cards, ...cards('2d')];
      six.gs.players[0].cards = six.hero.cards;
      expect(decide(six, { ...A, ...B }, 1)).toBe(decide(six, {}, 1));
      const tour = copy(base);
      tour.gs.gameMode = 'tournament';
      expect(decide(tour, { ...A, ...B }, 1)).toBe(decide(tour, {}, 1));
    }
  });

  it('11. on, with the record: no fold with nothing to call, no illegal action; the record is read', () => {
    HorseMind.setOmahaLifetimeStreetRecordProvider(stabber());
    const spy = vi.spyOn(HorseMind, 'omahaStabDefenceRecordOf');
    for (const s of FIRST)
      for (const seed of [1, 2, 3]) {
        const d = JSON.parse(decide(s, { ...A, ...B }, seed)) as HorseDecision;
        expect(['check', 'bet', 'all_in']).toContain(d.action);
      }
    for (const s of FACING)
      for (const seed of [1, 2]) {
        const d = JSON.parse(decide(s, { ...A, ...B }, seed)) as HorseDecision;
        expect(['fold', 'call', 'raise', 'all_in']).toContain(d.action);
      }
    expect(spy).toHaveBeenCalled();
  });
});

describe('omahaStrongHandCheckIsPriced: his own fold record and stab size (STAB-DEFENCE-3)', () => {
  it('12. no fold record: the multiplier is 1 and the curve is the population curve exactly', () => {
    for (const variant of ['plo4', 'plo5'])
      for (const street of ['turn', 'river'] as const) {
        for (const rec of [
          null,
          undefined,
          {},
          { foldSmall: { folds: 0, opps: 0 }, foldBig: null },
        ]) {
          const m = omahaStrongHandCheckFoldMultiplier(variant, street, rec);
          expect(m.m).toBe(1);
          expect(m.weight).toBe(0);
          expect(m.se).toBe(0);
        }
      }
    expect(omahaStrongHandCheckCurveOf(OMAHA_STRONG_HAND_CHECK_TURN_RESPONSE, 1)).toEqual(
      OMAHA_STRONG_HAND_CHECK_TURN_RESPONSE.map((p) => ({ ...p }))
    );
    expect(
      omahaStrongHandCheckFoldMultiplier('plo6', 'turn', { foldBig: { folds: 9, opps: 9 } }).m
    ).toBe(1);
  });

  it('13. the record moves the fold share by n / (n + k): population-like counts give 1, a non-folder goes to 0', () => {
    for (const street of ['turn', 'river'] as const) {
      const pop = OMAHA_STRONG_HAND_CHECK_FOLD_POPULATION[`plo5|${street}`];
      const k = OMAHA_STRONG_HAND_CHECK_FOLD_PRIOR_OPPS[street];
      const like = omahaStrongHandCheckFoldMultiplier('plo5', street, {
        foldSmall: { folds: 100 * pop.small, opps: 100 },
        foldBig: { folds: 60 * pop.big, opps: 60 },
      });
      expect(like.m).toBeCloseTo(1, 10);
      expect(like.weight).toBeCloseTo(160 / (160 + k), 10);
      let last = 1;
      for (const n of [5, 20, 80, 320, 5000]) {
        const st = omahaStrongHandCheckFoldMultiplier('plo5', street, {
          foldSmall: { folds: 0, opps: n },
          foldBig: { folds: 0, opps: n },
        });
        expect(st.m).toBeCloseTo((k * pop.all) / (n * (pop.small + pop.big) + k * pop.all), 10);
        expect(st.m).toBeLessThan(last);
        expect(st.se).toBeGreaterThanOrEqual(0);
        last = st.m;
      }
      expect(last).toBeLessThan(0.02);
      const over = omahaStrongHandCheckFoldMultiplier('plo5', street, {
        foldSmall: { folds: 300, opps: 300 },
      });
      expect(over.m).toBeGreaterThan(1);
    }
  });

  it('14. the moved curve keeps shares legal and the raise share of his continues', () => {
    for (const m of [0, 0.3, 1, 1.7, 9]) {
      const c = omahaStrongHandCheckCurveOf(OMAHA_STRONG_HAND_CHECK_TURN_RESPONSE, m);
      c.forEach((p, i) => {
        const o = OMAHA_STRONG_HAND_CHECK_TURN_RESPONSE[i];
        expect(p.cont).toBeGreaterThanOrEqual(0);
        expect(p.cont).toBeLessThanOrEqual(1);
        expect(1 - p.cont).toBeCloseTo(Math.min(1, m * (1 - o.cont)), 10);
        expect(p.raise).toBeLessThanOrEqual(p.cont + 1e-12);
        if (p.cont > 0) expect(p.raise / p.cont).toBeCloseTo(o.raise / o.cont, 10);
      });
    }
  });

  it('15. his fold record moves only the bet side of the comparison; the check keeps its price', () => {
    let priced = 0;
    let moved = 0;
    for (const s of FIRST) {
      const sp = omahaStrongHandCheckSpot(s.hero, s.gs);
      const pop = omahaStrongHandCheck(s.hero, s.gs, sp!, 40, 0.05, null, 0.5, null);
      const none = omahaStrongHandCheck(s.hero, s.gs, sp!, 40, 0.05, null, 0.5);
      const station = omahaStrongHandCheck(s.hero, s.gs, sp!, 40, 0.05, null, 0.5, {
        foldSmall: { folds: 0, opps: 400 },
        foldBig: { folds: 0, opps: 400 },
      });
      const nit = omahaStrongHandCheck(s.hero, s.gs, sp!, 40, 0.05, null, 0.5, {
        foldSmall: { folds: 400, opps: 400 },
        foldBig: { folds: 400, opps: 400 },
      });
      if (!pop || !station || !none || !nit) continue;
      priced++;
      expect(none).toEqual(pop);
      expect(pop.foldMultiplier).toBe(1);
      expect(pop.foldWeight).toBe(0);
      expect(station.foldMultiplier).toBeLessThan(0.1);
      expect(nit.foldMultiplier).toBeGreaterThan(1);
      // the check is priced on his stab record, not on his fold record
      expect(station.evCheck).toBe(pop.evCheck);
      expect(nit.evCheck).toBe(pop.evCheck);
      const a = station.evBet - pop.evBet;
      const b = nit.evBet - pop.evBet;
      if (Math.abs(a) > 0.02 || Math.abs(b) > 0.02) moved++;
      for (const v of [station, nit]) {
        expect(v.mix).toBeGreaterThanOrEqual(0);
        expect(v.mix).toBeLessThanOrEqual(1);
        expect(v.error).toBeGreaterThan(0);
      }
    }
    expect(priced).toBeGreaterThan(0);
    expect(moved).toBeGreaterThan(0);
  });

  it('16. stab size: the population size with no record, his own mean by stabs / (stabs + k), capped at 2 pots', () => {
    for (const variant of ['plo4', 'plo5'])
      for (const street of ['turn', 'river'] as const) {
        const pop = OMAHA_STRONG_HAND_CHECK_STAB_SIZE_TABLE[`${variant}|${street}`];
        const k = OMAHA_STRONG_HAND_CHECK_STAB_SIZE_PRIOR_STABS[street];
        expect(pop).toBeGreaterThan(0.3);
        expect(pop).toBeLessThan(1.2);
        expect(omahaStrongHandCheckStabSize(variant, street, null)).toEqual({
          size: pop,
          weight: 0,
        });
        expect(omahaStrongHandCheckStabSize(variant, street, { stabs: 0, sizeSum: 0 })!.size).toBe(
          pop
        );
        const big = omahaStrongHandCheckStabSize(variant, street, { stabs: 40, sizeSum: 40 })!;
        expect(big.size).toBeCloseTo((40 + k * pop) / (40 + k), 10);
        expect(big.weight).toBeCloseTo(40 / (40 + k), 10);
        const wild = omahaStrongHandCheckStabSize(variant, street, { stabs: 10, sizeSum: 999 })!;
        expect(wild.size).toBeCloseTo((20 + k * pop) / (10 + k), 10);
      }
    expect(omahaStrongHandCheckStabSize('plo6', 'turn', null)).toBeNull();
  });

  it('17. the HUD adapter maps counts only, and a missing or throwing read is no record', () => {
    const calls: string[] = [];
    const p = omahaLifetimeProviderFromHud({
      hudFirstWagerRecord: (id, fam, street, players) => {
        calls.push(`fw|${id}|${fam}|${street}|${players}`);
        if (id === 'none') return null;
        if (id === 'boom') throw new Error('x');
        return {
          bets: 30,
          opps: 50,
          checkedTo: { bets: 20, opps: 30, sizeSum: 15 },
          firstToAct: { bets: 10, opps: 20 },
        };
      },
      hudLifetimeCount: (id, fam, alias, ctx) => {
        calls.push(`lc|${id}|${fam}|${alias}|${ctx.street}|${ctx.players}`);
        if (id === 'boom') throw new Error('x');
        return id === 'none'
          ? { n: 0, hits: 0 }
          : { n: 12, hits: alias === 'x.foldToBet.big' ? 9 : 3 };
      },
    });
    expect(p.unopenedWagerRecord('a', 'plo5', 'river', 'hu')).toEqual({ bets: 30, opps: 50 });
    expect(p.firstWagerFoldRecord!('a', 'plo5', 'river', 'hu', 'big')).toEqual({
      folds: 9,
      opps: 12,
    });
    expect(p.firstWagerFoldRecord!('a', 'plo4', 'turn', 'mw', 'small')).toEqual({
      folds: 3,
      opps: 12,
    });
    expect(p.stabSizeRecord!('a', 'plo5', 'river', 'hu')).toEqual({ stabs: 20, sizeSum: 15 });
    for (const id of ['none', 'boom']) {
      expect(p.unopenedWagerRecord(id, 'plo5', 'turn', 'hu')).toBeNull();
      expect(p.firstWagerFoldRecord!(id, 'plo5', 'turn', 'hu', 'big')).toBeNull();
      expect(p.stabSizeRecord!(id, 'plo5', 'turn', 'hu')).toBeNull();
    }
    expect(calls).toContain('lc|a|plo4|x.foldToBet.small|turn|mw');
    HorseMind.setOmahaLifetimeStreetRecordProvider(p);
    try {
      expect(HorseMind.omahaStabDefenceRecordOf('a', 'PLO5', 'river', 1)).toEqual({
        bets: 30,
        opps: 50,
      });
      expect(HorseMind.omahaStrongHandCheckRecordsOf('a', 'plo5', 'river', 1)).toEqual({
        foldSmall: { folds: 3, opps: 12 },
        foldBig: { folds: 9, opps: 12 },
        stabSize: { stabs: 20, sizeSum: 15 },
      });
      expect(HorseMind.omahaStrongHandCheckRecordsOf('a', 'plo6', 'river', 1).foldBig).toBeNull();
      expect(HorseMind.omahaStrongHandCheckRecordsOf('boom', 'plo5', 'river', 1)).toEqual({
        foldSmall: null,
        foldBig: null,
        stabSize: null,
      });
    } finally {
      HorseMind.setOmahaLifetimeStreetRecordProvider(null);
    }
    const mem = new OmahaLifetimeStreetRecordMemory();
    mem.noteFirstWagerAnswer('u', 'plo5', 'turn', 'hu', 'big', true);
    mem.noteFirstWagerAnswer('u', 'plo5', 'turn', 'hu', 'big', false);
    mem.noteStab('u', 'plo5', 'turn', 'hu', 3);
    expect(mem.firstWagerFoldRecord('u', 'plo5', 'turn', 'hu', 'big')).toEqual({
      folds: 1,
      opps: 2,
    });
    expect(mem.firstWagerFoldRecord('u', 'plo5', 'turn', 'hu', 'small')).toBeNull();
    expect(mem.stabSizeRecord('u', 'plo5', 'turn', 'hu')).toEqual({ stabs: 1, sizeSum: 2 });
  });
});
