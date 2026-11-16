/**
 * OMAHA WAVE TWO: THE PUBLIC BET SIZE WITH THE PRICING RULES (2026-11-16).
 *
 * With omahaBetSizeByPublicState on, the public size is final for every own
 * bet that stands, so the rules that price bet against check price that size:
 * the street plan's flop layer prices the public size alone (no smaller size:
 * the public size would replace it), and a bet that stands carries it. The
 * decision's one size draw serves the plan and the final size alike.
 *
 *  - every flop bet that stands is the public size the plan priced, and the
 *    plan re-asked at that size keeps it; a plan check re-asked at the
 *    recorded public size is a check; one final receipt each (a plan check:
 *    the plan's; a bet: the size's);
 *  - short stacks, where the public size commits the stack: the plan's check
 *    wins before the size, and no bet stands that the plan, asked at the
 *    committing size, rejects;
 *  - the receipt validator re-runs a plan check at the recorded public size
 *    (a recorded size beyond the seat's chips is refused);
 *  - with all 39 options on, a public state still has one size per public
 *    draw over 200 private hands.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import {
  omahaFlopPlanChoice,
  omahaFlopPlanInputAt,
  omahaStreetPlanDomain,
  omahaStreetPlanFlop,
  omahaStreetPlanFlopAdmitsCheck,
  omahaStreetPlanFlopSpot,
} from './HorseOmahaStreetPlan.js';
import { omahaStrategyConstant } from './HorseOmahaStrategyGame.js';
import { horsePublicBetSizeTo, seedHorseBetSizeRandom } from './horsePublicBetSize.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import { replayProfiles, stateAt, type ComplaintFixture } from './HorseComplaintReplay.js';
import type { Card, CardRank, CardSuit, HorseDecision } from '../types.js';
import STRAIGHT from './horseComplaints/plo5-straight-barrels-the-board-pairing-turn-then-folds-the-river.fixture.json';
import ACES from './horseComplaints/plo5-aces-up-leads-the-board-pairing-river-into-a-two-street-caller.fixture.json';
import SUITED_ACES from './horseComplaints/plo5-suited-aces-flat-vs-3bet.fixture.json';
import SET_LEADS from './horseComplaints/plo5-set-leads-the-straight-card-out-of-position.fixture.json';

const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (spec: string): Card[] =>
  (spec.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUIT[x[1]] }));
const key = (c: Card) => `${c.rank}${c.suit[0]}`;
const LIVE = replayProfiles('cash').find((p) => p.live)!;
const SEEDS = [1, 7, 42, 99, 2026, 3];

const LIVE32 = [
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
const NEW = [
  'omahaMultiwayRiverCallNeedsStrength',
  'omahaNoRiverBluffIntoValueLeader',
  'omahaMultiwayWeakHandNoBet',
  'omahaStreetPlanFlop',
  'omahaStreetPlanThreeWay',
  'omahaPreflopStackPlan',
  'omahaBetSizeByPublicState',
];
const ALL39 = Object.fromEntries([...LIVE32, ...NEW].map((o) => [o, true])) as HorseDecideOpts;
const SIZED: HorseDecideOpts = { omahaStreetPlanFlop: true, omahaBetSizeByPublicState: true };

afterEach(() => {
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

type Node = ReturnType<typeof stateAt>;
/** A fixture node with the actor's hole re-dealt (deal > 0) and stacks set. */
function node(fx: unknown, ord: number, deal: number, stack?: number): Node {
  const f = JSON.parse(JSON.stringify(fx)) as ComplaintFixture & {
    hole: Record<string, Card[]>;
    variant: string;
  };
  const action = (f.actions as { ord: number; seat: number }[]).find((a) => a.ord === ord)!;
  if (deal > 0 || !f.hole[String(action.seat)]) {
    deal = deal + 1;
    const used = new Set<string>();
    for (const h of Object.values(f.hole ?? {})) for (const c of h) used.add(key(c));
    for (const a of f.actions as { publicNode?: { boards?: string[] } }[])
      for (const b of a.publicNode?.boards ?? [])
        for (const c of cards(String(b).replace(/[^2-9TJQKAcdhs]/g, ''))) used.add(key(c));
    const deck: Card[] = [];
    for (const s of 'cdhs') for (const r of '23456789TJQKA') deck.push(...cards(r + s));
    const free = deck.filter((c) => !used.has(key(c)));
    let x = (deal * 2654435761) >>> 0 || 1;
    for (let i = free.length - 1; i > 0; i--) {
      x ^= x << 13;
      x >>>= 0;
      x ^= x >>> 17;
      x ^= x << 5;
      x >>>= 0;
      const j = Math.floor((x / 4294967296) * (i + 1));
      [free[i], free[j]] = [free[j], free[i]];
    }
    f.hole[String(action.seat)] = free.slice(0, f.variant === 'plo4' ? 4 : 5);
  }
  const st = stateAt(f, f.actions.find((a) => a.ord === ord)!);
  if (stack !== undefined) st.hero.stack = stack;
  return st;
}
function decide(build: () => Node, opts: HorseDecideOpts, seed: number, sizeSeed: number) {
  enableBrainTelemetry();
  HorseMind.reset();
  drainFires();
  seedFastRandom(seed);
  seedHorseBetSizeRandom(sizeSeed);
  const st = build();
  const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
    telemetry: true,
    ...opts,
  } as never);
  return { d, st, fires: drainFires().map((f) => f.feature) };
}
const FLOPS: [unknown, number][] = [
  [ACES, 14],
  [SUITED_ACES, 11],
  [STRAIGHT, 12],
];
const isWager = (a: string) => a === 'bet' || a === 'all_in' || a === 'raise';
const PLAN = [
  'omaha_street_plan_flop_checked',
  'omaha_street_plan_flop_commit_avoided',
  'omaha_street_plan_flop_resized',
];
const flopVerdictAt = (st: Node, amount: number, tendency: unknown) => {
  const opp = omahaStreetPlanDomain(st.hero, st.gs)!;
  const plan = omahaStreetPlanFlop(
    omahaFlopPlanInputAt(st.hero, opp, st.gs, amount, tendency as never, true)
  )!;
  return omahaFlopPlanChoice(
    plan,
    omahaStrategyConstant('streetPlanFlopMarginPotShare', st.gs) * st.gs.pot
  );
};
const recordedTendency = (t: unknown) =>
  Array.isArray(t)
    ? { foldToBet: t[0], aggression: t[1], riverCall: t[2], valueLeader: t[3] === 1 }
    : null;

function flopClass(stack?: number) {
  let bets = 0;
  let planChecks = 0;
  let commits = 0;
  for (const [fx, ord] of FLOPS)
    for (let deal = 0; deal < 6; deal++)
      for (const seed of SEEDS) {
        const build = () => node(fx, ord, deal, stack);
        const st0 = build();
        if (!omahaStreetPlanFlopSpot(st0.hero, st0.gs)) continue;
        const { d, st, fires } = decide(build, SIZED, seed, seed * 31);
        const label = `${ord} #${deal} seed ${seed}: ${d.action} ${d.amount ?? ''}`;
        const rec = (
          d as HorseDecision & {
            streetPlan?: { publicSize?: number; tendency?: unknown; chosen?: string };
          }
        ).streetPlan;
        const sizeReceipts = fires.filter((f) => f.startsWith('omaha_public_bet_size_'));
        const planReceipts = fires.filter((f) => PLAN.includes(f));
        expect(
          planReceipts.filter((f) => f.endsWith('_resized')),
          label
        ).toEqual([]);
        expect(
          horseDecisionReceiptRefusal(structuredClone(d), String(st.gs.gameVariant).toLowerCase(), {
            player: st.hero,
            gameState: st.gs,
          }),
          label
        ).toBeNull();
        if (rec?.publicSize !== undefined) {
          const verdict = flopVerdictAt(st, rec.publicSize, recordedTendency(rec.tendency));
          if (d.action === 'check') {
            planChecks++;
            expect(verdict.index, label).toBe(0);
            expect(planReceipts.length, label).toBe(1);
            expect(sizeReceipts, label).toEqual([]);
          } else if (isWager(d.action)) {
            bets++;
            const chips = d.action === 'all_in' ? st.hero.stack : (d.amount as number);
            expect(chips, label).toBeCloseTo(rec.publicSize, 2);
            expect(verdict.index, label).toBe(1);
            expect(planReceipts, label).toEqual([]);
            if (d.action === 'all_in') commits++;
            // the size the plan priced is the public draw of this decision
            seedHorseBetSizeRandom(seed * 31);
            const want = horsePublicBetSizeTo(
              HorseLogic.publicBetSizeSpot(st.gs, st.hero.user_id, 'bet', true)!
            );
            if (d.action === 'bet')
              expect(Math.abs((d.amount as number) - (want as number)), label).toBeLessThanOrEqual(
                Math.max(0.01, 0.1 * st.gs.pot)
              );
          }
        }
      }
  return { bets, planChecks, commits };
}

describe('Omaha Wave Two: The Public Bet Size And The Street Plan', () => {
  it('Every Flop Bet That Stands Is The Public Size The Plan Priced; A Plan Check Holds At That Size; One Receipt Each', () => {
    const out = flopClass();
    expect(out.bets).toBeGreaterThan(0);
    expect(out.planChecks).toBeGreaterThan(0);
  });

  it('Short Stacks: The Plan Asked At The Committing Public Size Decides, Its Check Wins Before The Size', () => {
    const out = flopClass(60);
    // the public size commits the stack here, and every such bet the plan priced at that size
    expect(out.commits).toBeGreaterThan(0);
    expect(out.planChecks).toBeGreaterThan(0);
  });

  it('The Validator Re-Runs A Plan Check At The Recorded Public Size, And Refuses One Beyond The Chips', () => {
    let admitted = 0;
    for (const [fx, ord] of FLOPS)
      for (let deal = 0; deal < 6; deal++) {
        const st = node(fx, ord, deal);
        if (!omahaStreetPlanFlopSpot(st.hero, st.gs)) continue;
        for (const size of [0.3, 0.5, 0.75, 1].map((f) => Math.round(f * st.gs.pot * 100) / 100)) {
          if (flopVerdictAt(st, size, null).index !== 0) continue;
          const rec = {
            version: 1,
            street: 'flop',
            chosen: 'check',
            tendency: null,
            publicSize: size,
          };
          expect(omahaStreetPlanFlopAdmitsCheck(st.hero, st.gs, 1, rec)).toBe(true);
          expect(
            omahaStreetPlanFlopAdmitsCheck(st.hero, st.gs, size, {
              ...rec,
              publicSize: st.hero.stack + 1,
            })
          ).toBe(false);
          admitted++;
        }
      }
    expect(admitted).toBeGreaterThan(0);
  });
});

describe('Omaha Wave Two: All 39 On, The Size Still Carries No Hand Information', () => {
  const FX = SET_LEADS as unknown as ComplaintFixture;
  const spot = (ord: number, hole?: Card[]) => {
    const fx = JSON.parse(JSON.stringify(FX)) as ComplaintFixture;
    const nd = fx.actions.find((a) => a.ord === ord)!;
    if (hole) fx.hole[String(nd.seat)] = hole;
    return stateAt(fx, nd);
  };
  const hands = (ord: number, n = 200): Card[][] => {
    const board = new Set(spot(ord).gs.communityCards.map(key));
    const deck: Card[] = [];
    for (const r of '23456789TJQKA')
      for (const s of 'cdhs') if (!board.has(r + s)) deck.push(...cards(r + s));
    let x = 0x3c6ef372 ^ ord;
    const out: Card[][] = [];
    for (let i = 0; i < n; i++) {
      const d = deck.slice();
      for (let j = 0; j < 5; j++) {
        x ^= x << 13;
        x ^= x >>> 17;
        x ^= x << 5;
        x >>>= 0;
        const k = j + Math.floor((x / 4294967296) * (d.length - j));
        [d[j], d[k]] = [d[k], d[j]];
      }
      out.push(d.slice(0, 5));
    }
    return out;
  };
  for (const ord of [18, 16])
    it(`200 Private Hands At Node ${ord}: One Size Per Public Draw, The Public Draw Itself`, () => {
      const bySeed = new Map<string, Set<number>>();
      let wagers = 0;
      hands(ord).forEach((hole, i) => {
        const s = spot(ord, hole);
        const seed = [7, 77, 777, 7777, 77777, 777777][i % 6];
        seedHorseBetSizeRandom(seed);
        seedFastRandom(1000 + i);
        HorseMind.reset();
        const d = HorseLogic.decide(s.hero, s.gs, LIVE.style, LIVE.mods, {
          mind: false,
          ...ALL39,
        } as never);
        if (d.action !== 'bet' && d.action !== 'raise' && d.action !== 'all_in') return;
        wagers++;
        const kind = d.action === 'all_in' ? (s.gs.currentBet > 0 ? 'raise' : 'bet') : d.action;
        const k = `${kind}|${seed}`;
        if (!bySeed.has(k)) bySeed.set(k, new Set());
        bySeed.get(k)!.add(d.action === 'all_in' ? -1 : (d.amount as number));
        seedHorseBetSizeRandom(seed);
        const want = horsePublicBetSizeTo(
          HorseLogic.publicBetSizeSpot(s.gs, s.hero.user_id, kind as 'bet' | 'raise', false)!
        );
        // within the legalizer's chip rounding, as the sizing option's own test
        if (d.action !== 'all_in')
          expect(Math.abs((d.amount as number) - (want as number))).toBeLessThanOrEqual(
            Math.max(0.01, 0.1 * s.gs.pot)
          );
      });
      expect(wagers).toBeGreaterThan(0);
      for (const [k, sizes] of bySeed) expect([...sizes], k).toHaveLength(1);
    });
});
