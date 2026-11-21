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
import { seedFastRandom } from './HorseEval.js';
import { omahaEvPriorBluffShare } from './HorseOmahaFacingBetEv.js';
import {
  OMAHA_STAB_DEFENCE_TABLE,
  omahaStabDefencePriorOpps,
  omahaStabDefenceShare,
} from './HorseOmahaStabDefence.js';
import {
  OMAHA_STRONG_HAND_CHECK_STAB_SIZE,
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
      expect(omahaStrongHandCheckRule(chk, s.hero, s.gs, true, 0.05, () => null).decision).toBe(chk);
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
    for (const banned of ['is_horse', 'isHorse', 'kind', 'person', 'username', 'user_id', 'Math.random'])
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
