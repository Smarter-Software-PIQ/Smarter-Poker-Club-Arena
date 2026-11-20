/**
 * omahaBluffIsPricedAgainstTheTarget (default OFF; HORSE DECISIONS lane 2026-11-19, audit hvh48 A
 * classes 2 and 4). The pieces (his measured fold, the share against the strongest part of his
 * holdings, the closed form), the rule's scope, and the whole decision: off byte-identical, on legal
 * and admitted by the receipt validator. The audit fixtures are in
 * ABluffOrThinBetIsPricedAgainstTheTarget.law.test.ts.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { withoutMeasurements } from './HorseDeclaredWork.test-support.js';
import { seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { omahaBigDrawRiverShares } from './HorseOmahaBigDrawAggression.js';
import {
  OMAHA_TARGET_FOLD_PRIOR_STRENGTH,
  OMAHA_TARGET_FOLD_REFERENCE_BET_POT,
  omahaBluffBetPrice,
  omahaBluffBetVerdict,
  omahaBluffIsPricedAgainstTheTargetRule,
  omahaRiverShareAgainstStrongest,
  omahaShareAgainstStrongest,
  omahaTargetFoldRead,
  omahaTargetFoldShare,
} from './HorseOmahaBluffPricedAgainstTheTarget.js';
import { auditRecordOf, auditSpot } from './HorseOmahaBluffPricedAgainstTheTarget.test-support.js';
import { omahaPricedKindPrior } from './HorseOmahaPricedMode.js';
import {
  LIVE,
  LIVE_OPTIONS,
  allPriced,
  cards,
  decideAt,
  pricedSpot,
  type PricedSpot,
} from './HorseOmahaPricedRules.test-support.js';
import { OPTION_SWITCH_RELEASE_DEFAULT_OFF } from './HorseOptionSwitch.js';
import { HORSE_DATA_LEDGER } from './HorseDataLedger.js';
import {
  OMAHA_PRICED_RAISE_GATE_OPTIONS,
  horseDecisionReceiptRefusal,
  omahaBluffPricedAgainstTheTargetGateCandidates,
} from './horseDecision/responseValidation.js';

afterEach(() => {
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

const OPTION = 'omahaBluffIsPricedAgainstTheTarget';
const ON = { [OPTION]: true } as HorseDecideOpts;

describe('his measured fold to a bet', () => {
  it("with no record it is his kind's measured street rate; a record is shrunk toward it by 16", () => {
    expect(OMAHA_TARGET_FOLD_PRIOR_STRENGTH).toBe(16);
    const K = omahaPricedKindPrior('person').foldToBet;
    for (const st of ['flop', 'turn', 'river'] as const) {
      expect(omahaTargetFoldRead('person', st, null)).toEqual({
        rate: K[st],
        source: 'prior',
        opportunities: 0,
      });
      const r = omahaTargetFoldRead('person', st, { street: { hit: 2, opp: 20 }, pooled: null });
      expect(r.source).toBe('street');
      expect(r.rate).toBeCloseTo((2 + 16 * K[st]) / 36, 10);
    }
    // a Horse reads the Horse rates
    expect(omahaTargetFoldRead('horse', 'flop', null).rate).toBe(
      omahaPricedKindPrior('horse').foldToBet.flop
    );
  });
  it("a pooled record is carried to the street by his kind's street-over-pooled log-odds", () => {
    const K = omahaPricedKindPrior('person').foldToBet;
    const logit = (p: number) => Math.log(p / (1 - p));
    const r = omahaTargetFoldRead('person', 'river', {
      street: null,
      pooled: { hit: 13.9, opp: 40.8 },
    });
    const d = (13.9 + 16 * K.pooled) / (40.8 + 16);
    expect(r.source).toBe('pooled');
    expect(logit(r.rate)).toBeCloseTo(logit(d) + logit(K.river) - logit(K.pooled), 9);
    // his record at the pooled rate reads exactly his kind's street rate
    const atPop = omahaTargetFoldRead('person', 'turn', {
      street: null,
      pooled: { hit: 40 * K.pooled, opp: 40 },
    });
    expect(atPop.rate).toBeCloseTo(K.turn, 9);
    // a street record takes precedence over the pooled one
    expect(
      omahaTargetFoldRead('person', 'turn', {
        street: { hit: 1, opp: 4 },
        pooled: { hit: 30, opp: 40 },
      }).source
    ).toBe('street');
  });
  it('the share is the read at the reference size and rises continuously with the price', () => {
    const read = omahaTargetFoldRead('person', 'flop', null);
    const ref = OMAHA_TARGET_FOLD_REFERENCE_BET_POT.flop;
    expect(omahaTargetFoldShare(read, 'flop', 100, 100 * ref)).toBeCloseTo(read.rate, 9);
    let last = 0;
    for (let s = 5; s <= 300; s += 5) {
      const f = omahaTargetFoldShare(read, 'flop', 100, s)!;
      expect(f).toBeGreaterThan(last);
      expect(f - last).toBeLessThan(0.1);
      last = f;
    }
    expect(omahaTargetFoldShare(read, 'flop', 0, 10)).toBeNull();
    expect(omahaTargetFoldShare(read, 'flop', 100, 0)).toBeNull();
  });
});

describe('the share against the strongest part of his holdings', () => {
  it('nested classes: the strongest class first, then the next, each class one figure', () => {
    const counts = { got: [100, 40, 10], won: [60, 12, 1] };
    expect(omahaShareAgainstStrongest(counts, 0.1)).toBeCloseTo(0.1, 9);
    expect(omahaShareAgainstStrongest(counts, 0.05)).toBeCloseTo(0.1, 9);
    // 10 of class 2 (1 won) + 30 of class 1 only (11 won)
    expect(omahaShareAgainstStrongest(counts, 0.4)).toBeCloseTo(12 / 40, 9);
    expect(omahaShareAgainstStrongest(counts, 1)).toBeCloseTo(0.6, 9);
    expect(omahaShareAgainstStrongest({ got: [], won: [] }, 0.5)).toBeNull();
  });
  it('the river: ordered by his strength on the board, so a tighter continue is a stronger one', () => {
    const r = omahaBigDrawRiverShares(cards('KsKcJs9s6c'), cards('KdTcJh5h3s'), [], 700)!;
    expect(r.strongestFirst).toHaveLength(700);
    const wide = omahaRiverShareAgainstStrongest(r.strongestFirst, 0.9)!;
    const tight = omahaRiverShareAgainstStrongest(r.strongestFirst, 0.1)!;
    expect(tight).toBeLessThan(wide);
    expect(omahaRiverShareAgainstStrongest(r.strongestFirst, 1)).toBeCloseTo(r.all, 9);
    // the nuts (the royal) wins against every holding
    const nuts = omahaBigDrawRiverShares(cards('AhKh2c3d4s'), cards('QhJhTh5c6d'), [], 300)!;
    expect(nuts.all).toBe(1);
    // seeded from the cards: the same sample twice
    expect(omahaBigDrawRiverShares(cards('KsKcJs9s6c'), cards('KdTcJh5h3s'), [], 700)).toEqual(r);
  });
});

describe('the closed form', () => {
  it('EV(bet) = f.P - (1 - f).(b - r.e.(P + 2b)); EV(check) = r.e_all.P', () => {
    // a pot bluff with no showdown value breaks even at a fold share of one half
    const even = omahaBluffBetPrice({
      pot: 100,
      wager: 100,
      fold: 0.5,
      equityAll: 0,
      equityCalled: 0,
      realizationCheck: 1,
      realizationCalled: 1,
    });
    expect(even.evBet).toBeCloseTo(0, 9);
    expect(even.bet).toBe(false);
    // against a measured one-third folder it loses a third of the pot
    const third = omahaBluffBetPrice({
      pot: 100,
      wager: 100,
      fold: 1 / 3,
      equityAll: 0.2,
      equityCalled: 0,
      realizationCheck: 1,
      realizationCalled: 1,
    });
    expect(third.evBet).toBeCloseTo(100 / 3 - (2 / 3) * 100, 1);
    expect(third.evCheck).toBe(20);
    expect(third.bet).toBe(false);
    // a value bet: 0.6 against the calling range, 0.8 against all
    const value = omahaBluffBetPrice({
      pot: 100,
      wager: 75,
      fold: 0.3,
      equityAll: 0.8,
      equityCalled: 0.6,
      realizationCheck: 1,
      realizationCalled: 1,
    });
    expect(value.evBet).toBeCloseTo(30 - 0.7 * (75 - 0.6 * 250), 1);
    expect(value.bet).toBe(true);
  });
});

describe('the rule: scope and identity', () => {
  const W = auditSpot({
    hand: 'x',
    street: 'river',
    ip: true,
    opps: 1,
    woowoo: true,
    cards: '6s5d9hTs7h',
    board: 'Ks7sAhKh7d',
    pot: 207.5,
    toCall: 0,
    stack: 537.98,
    eff: 537.98,
    action: 'bet:170.0',
  });
  it('unset, false and a truthy non-boolean return the decision itself', () => {
    for (const opts of [{}, { [OPTION]: false }, { [OPTION]: 1 }] as HorseDecideOpts[])
      expect(
        omahaBluffIsPricedAgainstTheTargetRule(W.decision, W.player, W.gs, opts, auditRecordOf)
      ).toBe(W.decision);
  });
  it('a check, a fold and a call off the flop are never touched', () => {
    for (const d of [
      { action: 'check', thinkTime: 0 },
      { action: 'fold', thinkTime: 0 },
    ] as const)
      expect(
        omahaBluffIsPricedAgainstTheTargetRule({ ...d }, W.player, W.gs, ON, auditRecordOf).action
      ).toBe(d.action);
    const turnCall = auditSpot({
      hand: 'x',
      street: 'turn',
      ip: true,
      opps: 1,
      woowoo: true,
      cards: 'As9h2s4sAc',
      board: '2h7cKd5h',
      pot: 210.5,
      toCall: 52.5,
      stack: 157.3,
      eff: 157.3,
      action: 'call',
    });
    expect(
      omahaBluffIsPricedAgainstTheTargetRule(
        turnCall.decision,
        turnCall.player,
        turnCall.gs,
        ON,
        auditRecordOf
      )
    ).toBe(turnCall.decision);
  });
  it('out of scope (a tournament, PLO6, fixed limit, multiway bet) the decision is kept', () => {
    const cases = [
      { ...W.gs, gameMode: 'tournament' },
      { ...W.gs, gameVariant: 'plo6' },
      { ...W.gs, bettingStructure: 'fixed_limit' },
    ] as Array<typeof W.gs>;
    for (const gs of cases)
      expect(
        omahaBluffIsPricedAgainstTheTargetRule(W.decision, W.player, gs, ON, auditRecordOf)
      ).toBe(W.decision);
    const multi = auditSpot({
      hand: 'x',
      street: 'river',
      ip: true,
      opps: 2,
      woowoo: true,
      cards: '6s5d9hTs7h',
      board: 'Ks7sAhKh7d',
      pot: 207.5,
      toCall: 0,
      stack: 537.98,
      eff: 537.98,
      action: 'bet:170.0',
    });
    expect(omahaBluffBetVerdict(multi.decision, multi.player, multi.gs, auditRecordOf)).toEqual({
      kind: 'unpriced',
      reason: 'spot',
    });
    expect(
      omahaBluffIsPricedAgainstTheTargetRule(
        multi.decision,
        multi.player,
        multi.gs,
        ON,
        auditRecordOf
      )
    ).toBe(multi.decision);
  });
  it('his measured record decides: the same bluff stands against a measured over-folder', () => {
    // 59971022: two pair, 85 into 207.5 on the river. Against WooWoo's record: the check.
    expect(
      omahaBluffIsPricedAgainstTheTargetRule(W.decision, W.player, W.gs, ON, auditRecordOf).action
    ).toBe('check');
    const folder = () => ({ street: { hit: 90, opp: 100 }, pooled: null });
    expect(omahaBluffIsPricedAgainstTheTargetRule(W.decision, W.player, W.gs, ON, folder)).toBe(
      W.decision
    );
  });
});

describe('the whole decision', () => {
  const SPOTS: PricedSpot[] = [
    // river, no bet faced: air, a thin pair, the nuts
    { hole: '9h8h4c3d2s', board: 'AsKd7c5hQs', bet: 0 },
    { hole: 'Kh9h4c3d2s', board: 'AsKd7c5hQs', bet: 0, inPosition: true },
    { hole: 'JhTh4c3d2s', board: 'AsKd7c5hQs', bet: 0, heroBetTurn: true },
    // flop, no bet faced and facing a bet: a set, a draw, air
    { hole: 'QcQs8d4h2c', board: 'Qh9h3d', bet: 0 },
    { hole: 'QcQs8d4h2c', board: 'Qh9h3d', potBefore: 216, bet: 100 },
    { hole: 'AhKhJcTc2s', board: 'Qh9h3d', potBefore: 216, bet: 100 },
    { hole: '7c6d5s4c2d', board: 'Qh9h3d', potBefore: 120, bet: 60, inPosition: true },
    // turn, facing a bet
    { hole: 'QcQs8d4h2c', board: 'Qh9h3d2s', potBefore: 216, bet: 150 },
  ];
  const SEEDS = [1, 7, 42];
  const bytes = (d: unknown) =>
    JSON.stringify(withoutMeasurements({ ...(d as object), thinkTime: 0 }));
  it('unset, false and a truthy non-boolean are byte-identical', () => {
    for (const s of SPOTS) {
      const st = pricedSpot(s);
      for (const seed of SEEDS.slice(0, 2))
        for (const base of [
          LIVE_OPTIONS,
          { ...LIVE_OPTIONS, ...allPriced(true) },
          {},
        ] as HorseDecideOpts[]) {
          const want = bytes(decideAt(st, base, seed));
          expect(bytes(decideAt(st, { ...base, [OPTION]: false }, seed))).toBe(want);
          expect(bytes(decideAt(st, { ...base, [OPTION]: 1 } as never, seed))).toBe(want);
        }
    }
  });
  it('on: every decision is legal and passes the receipt validator, and some decisions change', () => {
    let changed = 0;
    for (const s of SPOTS) {
      const st = pricedSpot(s);
      for (const seed of SEEDS)
        for (const base of [
          LIVE_OPTIONS,
          { ...LIVE_OPTIONS, ...allPriced(true) },
        ] as HorseDecideOpts[]) {
          const without = decideAt(st, base, seed);
          const opts = { ...base, [OPTION]: true } as HorseDecideOpts;
          const d = decideAt(st, opts, seed);
          expect(st.gs.legalActions).toContain(d.action);
          if (d.action === 'raise') {
            expect(d.amount!).toBeGreaterThanOrEqual((st.gs.minRaiseTo as number) - 1e-9);
            expect(d.amount!).toBeLessThanOrEqual((st.gs.maxRaiseTo as number) + 1e-9);
          }
          expect(
            horseDecisionReceiptRefusal(structuredClone(d), 'plo5', {
              player: st.hero,
              gameState: st.gs,
              omahaPricedRaise: OMAHA_PRICED_RAISE_GATE_OPTIONS.some(
                (name) => (opts as Record<string, unknown>)[name] === true
              ),
              omahaBluffPricedAgainstTheTarget: true,
            })
          ).toBeNull();
          if (bytes(d) !== bytes(without)) changed++;
        }
    }
    // eslint-disable-next-line no-console
    console.log(`[bluff priced against the target, whole decision] decisions changed: ${changed}`);
    expect(changed).toBeGreaterThan(0);
  });
  it('on, with telemetry: every receipt it fires is registered in the ledger', () => {
    const keys = new Set(HORSE_DATA_LEDGER.filter((e) => e.kind === 'receipt').map((e) => e.key));
    const seen = new Set<string>();
    for (const s of SPOTS) {
      const st = pricedSpot(s);
      HorseMind.reset();
      const now = st.fresh();
      enableBrainTelemetry();
      drainFires();
      seedFastRandom(7);
      HorseLogic.decide(now.hero, now.gs, LIVE.style, LIVE.mods, {
        observeMind: false,
        decisionTimeMs: 1794938400000,
        telemetry: true,
        ...LIVE_OPTIONS,
        [OPTION]: true,
      } as never);
      for (const f of drainFires())
        if (f.feature.startsWith('omaha_bluff_priced_against_target')) seen.add(f.feature);
    }
    expect(seen.size).toBeGreaterThan(0);
    for (const k of seen) expect(keys.has(k), k).toBe(true);
  });
  it('the validator gate: the request option, else the delivered switch row', () => {
    expect(omahaBluffPricedAgainstTheTargetGateCandidates({}, null)).toEqual([false]);
    expect(omahaBluffPricedAgainstTheTargetGateCandidates({ [OPTION]: true }, null)).toEqual([
      true,
    ]);
    expect(omahaBluffPricedAgainstTheTargetGateCandidates({ [OPTION]: 1 } as never, null)).toEqual([
      false,
    ]);
  });
  it('is registered default OFF with an authority file', () => {
    expect(OPTION_SWITCH_RELEASE_DEFAULT_OFF).toContain(OPTION);
    expect(HORSE_DATA_LEDGER.some((e) => e.kind === 'flag' && e.key === OPTION)).toBe(true);
  });
});
