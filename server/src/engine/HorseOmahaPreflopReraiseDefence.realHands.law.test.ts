/**
 * omahaPreflopReraiseDefencePriced (PLO Strategy lane 2026-11-17, default
 * OFF): eight real PLO5 cash decisions of the 2026-11-17 audit, each a Horse
 * facing a 3-bet or a 4-bet from the measured winning player, replayed with
 * the switch list that was live at the activation of 2026-11-16 (0106z).
 *
 * The fixture (HorseOmahaPreflopReraiseDefence.realHands.fixture.json) was
 * written by toComplaintFixture from the recorded hands: no user id, only
 * the deciding Horse's cards, the re-raiser's recorded preflop counts (hands,
 * VPIP, PFR, 3-bet opportunities and 3-bets, fold-to-3-bet opportunities and
 * folds) under `reraiserRates`.
 *
 * The expected answers are not the module's own output. STEP1_EQUITY is the
 * equity of the Horse's exact hand against the re-raiser's recorded
 * re-raising holdings (1,500 samples, the hand itself left out of the range,
 * an independent Python evaluator: evidence preflop-01BNteGZ/step1,
 * decisions30.csv). Against it, with the realization measured on 1,164 real
 * calls (0.84; 0.77 out of position at depth), the five folds clear the price
 * by 5 to 33 big blinds and the deep out-of-position call does not.
 *
 *  - option unset and false: the decision is byte-identical (timings aside)
 *    and it is what the brain does today (the folds of the audit);
 *  - option on, the re-raised-pot call cell not live (its three options
 *    off): the five folds become calls, the deep out-of-position call
 *    becomes a fold, the deep fold stands, the 4-bet at a ratio under 1
 *    stands; the verdict receipt fires and the changed decision passes the worker
 *    receipt validator;
 *  - ONE OWNER PER CELL (inbox 2026-11-18 00:06Z): with the live switch list
 *    the call cell of HorseOmahaOopReraisedPot (the live implementation, WooWoo
 *    audit lane) judges six of the eight calls. There the option does not
 *    answer: the decision is byte-identical to the option off, the cell's
 *    receipts are counted once and none of this option's fires. On the two it
 *    does not judge, the option answers and the cell's receipts stay silent;
 *  - the equity the verdict prices is within 0.07 of the independent figure.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseLogic } from './HorseLogic.js';
import { HorseMind, readScopeOf } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import {
  horseNodes,
  replayProfiles,
  stateAt,
  type ComplaintFixture,
} from './HorseComplaintReplay.js';
import { freshExploitCounters, type ExploitCounters } from './HorseOpponentExploit.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import {
  PREFLOP_DEFENCE_FALLBACK_RERAISE_RATE,
  omahaPreflopReraiseDefenceAnswer,
  omahaPreflopReraiseDefenceSpot,
} from './HorseOmahaPreflopReraiseDefenceRule.js';
import { omahaPreflopDefenceRangeWidth } from './HorseOmahaPreflopReraiseDefence.js';
import { withoutMeasurements } from './HorseDeclaredWork.test-support.js';
import FIXTURE from './HorseOmahaPreflopReraiseDefence.realHands.fixture.json';

interface RealHand extends ComplaintFixture {
  handNumber: number;
  reraiserSeat: number;
  reraiserRates: {
    n: number;
    vpip: number;
    pfr: number;
    tbo: number;
    tb: number;
    f3: number;
    fo3: number;
  };
}
const HANDS = FIXTURE as unknown as RealHand[];

/** The Omaha switch list live at the activation of 2026-11-16 (evidence activation-0106z/ON-LIST.txt). */
const LIVE_OMAHA_SWITCHES = [
  'horseActionTimeIsPublicOnly',
  'omahaBareOverpairOopFlopCheck',
  'omahaBigBetIsPotShare',
  'omahaBigDrawAggression',
  'omahaBluffCatcherFoldVsValueLeader',
  'omahaCardImpact',
  'omahaEliteContinuesVsMeasuredWideThreeBettor',
  'omahaFacingBetEv',
  'omahaMadeHandDefenseVsValueLeader',
  'omahaManiacReRaiseWidthMeasured',
  'omahaNoCallColdFourBetWithoutPremium',
  'omahaNoDrawRaiseOutOfPosition',
  'omahaOopReraisedPotStrongRange',
  'omahaOopTurnCheckAfterFlopCall',
  'omahaOverpairNoOopBarrelVsValueLeader',
  'omahaPairedBoardFoldRespectsPrice',
  'omahaPairedRiverNoThinLeadVsValueLeader',
  'omahaPairedTurnNoBarrelWithoutBoatVsValueLeader',
  'omahaPressureNeedsPostflopAggression',
  'omahaReraiseRangeEarlyPosition',
  'omahaReraiseRangeOutOfPosition',
  'omahaReraisedPotFlopContinueNeedsEquityShape',
  'omahaRiverMediumBetStrongHandCalls',
  'omahaRiverNutBlockerBluffReachable',
  'omahaStrategyInTournaments',
  'omahaStreetPlan',
  'omahaStrongHandSlowplayMix',
  'omahaStrongHandValue',
  'omahaTurnBetNeedsRiverPlan',
  'omahaTurnRiverRaiseNeedsNuts',
  'omahaUnderpairNoMultiwayFlopContinue',
  'omahaVpipFloorByLimp',
];
const LIVE = Object.fromEntries(LIVE_OMAHA_SWITCHES.map((o) => [o, true]));

/** hand number -> [today's decision, the priced decision, the independent Step 1 equity] */
const EXPECTED: Record<number, ['fold' | 'call' | 'raise', 'fold' | 'call' | 'raise', number]> = {
  59799408: ['fold', 'call', 0.548], // opener, 3-bet, in position
  59793017: ['fold', 'call', 0.553], // opener, 3-bet, in position, suited ace
  59830020: ['fold', 'call', 0.555], // opener, 3-bet, out of position, ratio 2.6
  59853239: ['fold', 'call', 0.553], // 3-bettor, 4-bet, in position
  59819475: ['fold', 'call', 0.568], // 3-bettor, 4-bet, out of position, ratio 4
  51520556: ['call', 'fold', 0.513], // opener, 3-bet, out of position, ratio 10.7: the reverse error
  59800400: ['fold', 'fold', 0.459], // opener, 3-bet, out of position, ratio 18: the fold stands
  50162905: ['raise', 'raise', 0.553], // 3-bettor 4-bets in position under a ratio of 1: stands
};

/**
 * The receipts that say the re-raised-pot call cell judged the call (HorseOmahaOopReraisedPot through
 * HorseLogic): its own two, and the two of a re-raise range rule whose downgraded re-raise, facing a
 * 3-bet or more, was handed to that cell (the cell runs silent there; the range rule reports).
 */
const CELL_RECEIPTS = [
  'omaha_oop_reraised_call_kept',
  'omaha_oop_reraised_call_folded',
  'omaha_reraise_by_position_called',
  'omaha_reraise_by_position_folded',
];
/** The live list without the three options that reach that cell: the cell is not live. */
const CELL_NOT_LIVE = {
  ...LIVE,
  omahaOopReraisedPotStrongRange: false,
  omahaReraiseRangeEarlyPosition: false,
  omahaReraiseRangeOutOfPosition: false,
};
/**
 * The seeds (of 1 and 42) on which the cell judges each hand's call under the live list (measured by
 * this test, pinned). 59830020: on seed 1 the reference brain folds before any rule, so no call
 * reaches the cell and the option answers; on seed 42 it calls and the cell folds the call.
 */
const CELL_JUDGES_LIVE: Readonly<Record<number, readonly number[]>> = {
  51520556: [1, 42],
  59819475: [1, 42],
  59799408: [1, 42],
  59793017: [1, 42],
  59853239: [1, 42],
  59830020: [42],
  59800400: [],
  50162905: [],
};

const kind = (a: string): 'fold' | 'call' | 'raise' =>
  a === 'fold' ? 'fold' : a === 'call' ? 'call' : 'raise';

/** The re-raiser's recorded counts as the mind's decayed counters (at most 40 hands of weight). */
function counters(r: RealHand['reraiserRates']): ExploitCounters {
  const c = freshExploitCounters();
  const n = Math.max(1, r.n);
  const k = Math.min(1, n / 40);
  c.hands = 40 * k;
  c.vpip = (c.hands * r.vpip) / n;
  c.pfr = (c.hands * r.pfr) / n;
  c.rfiOpp = 20 * k;
  c.rfi = c.rfiOpp * Math.min(0.95, r.pfr / n);
  c.threeBetOpp = Math.min(15, r.tbo) * k;
  c.threeBet = r.tbo > 0 ? (c.threeBetOpp * r.tb) / r.tbo : 0;
  c.foldTo3BetOpp = Math.min(8, r.f3) * k;
  c.foldTo3Bet = r.f3 > 0 ? (c.foldTo3BetOpp * r.fo3) / r.f3 : 0;
  return c;
}
function setRead(h: RealHand): void {
  HorseMind.reset();
  const map = (HorseMind as unknown as { exploitCounters: Map<string, ExploitCounters> })
    .exploitCounters;
  for (const size of [2, 4, 6])
    map.set(`${readScopeOf(h.variant, size)}|p${h.reraiserSeat}`, counters(h.reraiserRates));
}

const PROFILE = replayProfiles('cash').find((p) => p.live)!;
/** The decision's bytes, its timings (thinkTime, latencies, elapsed times) aside. */
const bytes = (d: unknown) =>
  JSON.stringify(withoutMeasurements(d), (k, v) => (k === 'thinkTime' ? 0 : v));

function decide(h: RealHand, opts: Record<string, unknown>, seed = 1) {
  const node = horseNodes(h).find((n) => n.ord === h.forbidden[0]!.ord)!;
  const st = stateAt(h, node);
  setRead(h);
  drainFires();
  seedFastRandom(seed);
  const d = HorseLogic.decide(st.hero, st.gs, PROFILE.style, PROFILE.mods, {
    telemetry: true,
    observeMind: false,
    ...opts,
  } as never);
  return { d, st, fires: drainFires().map((f) => f.feature) };
}

function decideCounted(h: RealHand, opts: Record<string, unknown>, seed = 1) {
  const node = horseNodes(h).find((n) => n.ord === h.forbidden[0]!.ord)!;
  const st = stateAt(h, node);
  setRead(h);
  drainFires();
  seedFastRandom(seed);
  const d = HorseLogic.decide(st.hero, st.gs, PROFILE.style, PROFILE.mods, {
    telemetry: true,
    observeMind: false,
    ...opts,
  } as never);
  const fires = drainFires().sort((a, b) => a.feature.localeCompare(b.feature));
  return { d, st, fires };
}

afterEach(() => {
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

describe('omahaPreflopReraiseDefencePriced on eight real audited decisions', () => {
  enableBrainTelemetry();

  it('the fixture is the recorded sample: eight PLO5 cash decisions, anonymised', () => {
    expect(HANDS.map((h) => h.handNumber).sort()).toEqual(Object.keys(EXPECTED).map(Number).sort());
    for (const h of HANDS) {
      expect([h.fmt, h.variant]).toEqual(['cash', 'plo5']);
      expect(JSON.stringify(h)).not.toMatch(/userId|user_id/);
      expect(Object.keys(h.hole)).toHaveLength(1);
    }
  });

  for (const h of HANDS) {
    const [today, priced, step1Equity] = EXPECTED[h.handNumber]!;
    it(`hand ${h.handNumber}: ${h.title}; today ${today}, priced ${priced}`, () => {
      for (const seed of [1, 42]) {
        const unset = decide(h, LIVE, seed);
        const off = decide(h, { ...LIVE, omahaPreflopReraiseDefencePriced: false }, seed);
        expect(bytes(off.d)).toBe(bytes(unset.d));
        expect(kind(unset.d.action)).toBe(today);
        expect(unset.fires.some((f) => f.startsWith('omaha_preflop_reraise_defence_'))).toBe(false);

        // The rule's own answer: the re-raised-pot call cell not live (its three options off), so
        // no other rule owns the decision.
        const on = decide(h, { ...CELL_NOT_LIVE, omahaPreflopReraiseDefencePriced: true }, seed);
        expect(on.fires.some((f) => CELL_RECEIPTS.includes(f))).toBe(false);
        expect(kind(on.d.action)).toBe(priced);
        expect(on.fires).toContain(`omaha_preflop_reraise_defence_${priced}`);
        // (omaha_preflop_reraise_defence_changed compares with the answer handed to the rule, the
        // reference brain's, which the re-raise rules it replaces would have changed after it.)
        expect(on.fires).not.toContain('omaha_strategy_rule_failed');
        if (priced === 'call') {
          expect(on.d.amount).toBeCloseTo(on.st.gs.toCall!, 2);
        }
        expect(
          horseDecisionReceiptRefusal(structuredClone(on.d), h.variant, {
            player: on.st.hero,
            gameState: on.st.gs,
          } as never)
        ).toBeNull();
      }
    });
    it(`hand ${h.handNumber}: one owner; the call cell judges it on seeds [${CELL_JUDGES_LIVE[h.handNumber]!.join(', ')}] of the live list, the option answers on the others`, () => {
      for (const seed of [1, 42]) {
        const off = decideCounted(h, { ...LIVE, omahaPreflopReraiseDefencePriced: false }, seed);
        const on = decideCounted(h, { ...LIVE, omahaPreflopReraiseDefencePriced: true }, seed);
        const judged = off.fires.some((f) => CELL_RECEIPTS.includes(f.feature));
        expect(judged).toBe(CELL_JUDGES_LIVE[h.handNumber]!.includes(seed));
        const mine = on.fires.filter((f) => f.feature.startsWith('omaha_preflop_reraise_defence_'));
        if (judged) {
          // the cell owns the decision: the same bytes, the same receipts counted once each,
          // none of this option's
          expect(bytes(on.d)).toBe(bytes(off.d));
          expect(on.fires).toEqual(off.fires);
          expect(mine).toEqual([]);
        } else {
          // nobody else owns it: the option answers, and the cell's receipts stay silent
          expect(kind(on.d.action)).toBe(priced);
          expect(mine.map((f) => f.feature)).toContain(`omaha_preflop_reraise_defence_${priced}`);
          expect(on.fires.some((f) => CELL_RECEIPTS.includes(f.feature))).toBe(false);
        }
      }
    });
    it(`hand ${h.handNumber}: the priced equity is within 0.07 of the independent ${step1Equity}`, () => {
      const node = horseNodes(h).find((n) => n.ord === h.forbidden[0]!.ord)!;
      const st = stateAt(h, node);
      setRead(h);
      const found = omahaPreflopReraiseDefenceSpot(st.hero, st.gs as never)!;
      HorseMind.setDecisionScope(readScopeOf(h.variant, found.dealt), h.variant, 'cash');
      const ans = omahaPreflopReraiseDefenceAnswer(st.hero, st.gs as never, { mind: true }, null);
      expect(ans).not.toBeNull();
      expect(Math.abs(ans!.verdict.equity - step1Equity)).toBeLessThanOrEqual(0.07);
      // the read is his measured one (a wide re-raiser), not the population mean
      expect(ans!.verdict.width).toBeGreaterThan(
        omahaPreflopDefenceRangeWidth(
          PREFLOP_DEFENCE_FALLBACK_RERAISE_RATE,
          found.spot.preflopRaises
        )
      );
    });
  }
});
