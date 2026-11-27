/**
 * vpipFloorLimpFoldsToARaise (default OFF; lead-8 lane preflop, 2026-11-27).
 *
 * Owner, 2026-11-17 14:34 America/Chicago: "Table VPIP must limp fold for a bb. smh nothing else if there vpip
 * drops." And 18:38: the floor never buys a call of a raise. The limp-only floors made the limp and forgot it: raised,
 * the unfloored decision stood, and in production 322 of 2,407 floor limps that faced a raise called it and 1
 * re-raised (PLO4/PLO5 cash hands with a person, 2026-11-20 to 11-27).
 *
 * THE LAW: with the option on, a Horse whose own accepted limp of the hand was the floor's (the mark the limp-only
 * step sets, remembered by the engine as gs.ownVpipFloorLimpThisHand) never calls and never re-raises a raise made
 * after that limp: every seed, every style, on 13 real production nodes where the live Horse did (fixture
 * aVpipFloorLimpFoldsToARaise.realHands.fixture.json: written by toComplaintFixture, no user id, only the deciding
 * Horse's own cards) and on built tables of every game that has a floor (hold'em, PLO4, PLO5, PLO6; a thirty-hand
 * table, a ten-hand table under vpipFloorLimpOnlyTenHandWindow, and a Lightning pool). Off (unset, false, a truthy
 * non-boolean) every decision is byte for byte and draw for draw the one it was, the mark is never set, and a limp
 * the unfloored brain chose keeps the unfloored answer with the option on. It adds no floor: a game without one
 * never sets the mark.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  HorseLogic,
  vpipFloorLimpFacesARaise,
  vpipFloorLimpFoldsToARaiseStep,
  type HorseDecideOpts,
} from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { fastRandom, seedFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import {
  BASE_STYLES,
  replayProfiles,
  stateAt,
  type ComplaintFixture,
} from './HorseComplaintReplay.js';
import { seedHorseTimingRandom } from './horsePublicActionTime.js';
import { withoutMeasurements } from './HorseDeclaredWork.test-support.js';
import {
  LIVE,
  PRODUCTION_28372C9A,
  SPOTS,
  decideAt,
  limpedThenRaised,
  type FloorVariant,
  type Table,
} from './HorseVpipFloorLimpOnly.test-support.js';
import {
  buildHorseDecisionKey,
  validatedHorsePolicySamplingKey,
} from './horseDecision/protocol.js';
import { measureRelativeCost } from '../testing/relativeCost.js';
import type { HorseDecision } from '../types.js';
import FIXTURE from './aVpipFloorLimpFoldsToARaise.realHands.fixture.json';

interface RealHand extends ComplaintFixture {
  limpOrd: number;
  raiseOrd: number;
  recorded: 'call' | 'raise';
}
const HANDS = FIXTURE as unknown as RealHand[];
const SEEDS = [1, 7, 42, 99, 2026];

/** The options production decided with when the nodes were read (switch rows 'on', 2026-11-27 05:00Z). */
const LIVE_ON: readonly string[] = [
  'cashDefenceTrimColdCalls',
  'holdemCallDownExcludesCurrentHand',
  'holdemCallDownNeedsStyleEvidence',
  'holdemGearShiftReach',
  'holdemManiacSampleGate',
  'holdemManiacShortHandedReach',
  'holdemPersonaPostflop',
  'holdemProfileCompletenessCap',
  'holdemRiverFullHouseValue',
  'holdemRiverFullHouseValueIsPriced',
  'holdemTournamentAllInCallIsPriced',
  'horseActionTimeIsPublicOnly',
  'huBbDefendsUnreadToPrice',
  'icmBustPaysPlace',
  'omahaBareOverpairOopFlopCheck',
  'omahaBigBetIsPotShare',
  'omahaBigDrawAggression',
  'omahaBlanketRowsOffInPlo45Cash',
  'omahaCardImpact',
  'omahaEliteContinuesVsMeasuredWideThreeBettor',
  'omahaFacingBetEv',
  'omahaMadeHandDefenseVsValueLeader',
  'omahaManiacReRaiseWidthMeasured',
  'omahaMathCorePlo5Flop',
  'omahaNoCallColdFourBetWithoutPremium',
  'omahaNoDrawRaiseOutOfPosition',
  'omahaOopReraisedPotStrongRange',
  'omahaOpponentLifetimeHud',
  'omahaOverpairNoOopBarrelVsValueLeader',
  'omahaPairedBoardFoldRespectsPrice',
  'omahaPairedRiverNoThinLeadVsValueLeader',
  'omahaPairedTurnNoBarrelWithoutBoatVsValueLeader',
  'omahaPreflopReraiseDefencePricedInPosition',
  'omahaPricedRaiseNeverMakesNonNutRaise',
  'omahaReraiseRangeEarlyPosition',
  'omahaRiverCurrentNutsCallFloor',
  'omahaRiverMediumBetStrongHandCalls',
  'omahaStrategyInTournaments',
  'omahaStrongHandValue',
  'omahaTurnRiverRaiseIsPriced',
  'omahaTurnRiverRaiseNeedsNuts',
  'omahaValueSizeIsUnreadable',
  'omahaVpipFloorByLimp',
  'styleBigBetHonesty',
  'styleFoldBluff',
  'styleFoldRatePreRepair',
  'styleLongShownMemory',
  'styleRaiseRespect',
  'styleTightMultiSignal',
  'styleTightPlayerExploit',
  'styleTightReRaiserRespect',
  'styleValueBettorNotManiac',
  'styleValueExtraction',
  'tournamentUtilityStackScaledMargin',
  'vpipFloorLimpOnly',
];
const TODAY = {
  ...Object.fromEntries(LIVE_ON.map((o) => [o, true])),
  mind: false,
  telemetry: true,
} as unknown as HorseDecideOpts;
const ON = { ...TODAY, vpipFloorLimpFoldsToARaise: true } as HorseDecideOpts;

function decide(
  h: RealHand,
  ord: number,
  opts: HorseDecideOpts,
  seed: number,
  style = replayProfiles('cash').find((p) => p.live)!,
  mutate?: (gs: Record<string, unknown>) => void
): { d: HorseDecision; next: number; fires: Record<string, number> } {
  const st = stateAt(h, h.actions.find((a) => a.ord === ord)!);
  mutate?.(st.gs as unknown as Record<string, unknown>);
  HorseMind.reset();
  seedFastRandom(seed);
  seedHorseTimingRandom(seed);
  drainFires();
  const d = HorseLogic.decide(st.hero, st.gs, style.style, style.mods, opts);
  const fires: Record<string, number> = {};
  for (const f of drainFires()) fires[f.feature] = (fires[f.feature] ?? 0) + f.fires;
  return { d, next: fastRandom(), fires };
}
const limped = (gs: Record<string, unknown>) => {
  gs.ownVpipFloorLimpThisHand = true;
};
const underTheLine = (gs: Record<string, unknown>) => {
  gs.ownVpip = { hands: Number(gs.vpipWindowHands ?? 30), vpip: 10 };
};

afterEach(() => HorseMind.reset());

describe('vpipFloorLimpFoldsToARaise: a floor limp, raised, folds (real production nodes)', () => {
  enableBrainTelemetry();

  it('the fixture holds PLO4 and PLO5, thirty-hand and ten-hand tables, a call and a re-raise, and no user id', () => {
    expect(HANDS.length).toBe(13);
    expect(new Set(HANDS.map((h) => h.variant))).toEqual(new Set(['plo4', 'plo5']));
    expect(JSON.stringify(HANDS)).not.toMatch(/userId|username/);
    for (const h of HANDS) expect(Object.keys(h.hole).length).toBe(1);
  });

  it('non-vacuous: with the option off the brain calls or re-raises these raises, flag or no flag', () => {
    let continued = 0;
    for (const h of HANDS)
      for (const seed of SEEDS) {
        const off = decide(h, h.raiseOrd, TODAY, seed, undefined, limped);
        if (off.d.action !== 'fold') continued++;
      }
    expect(continued).toBeGreaterThanOrEqual(40);
  }, 240_000);

  it('on, with the limp remembered: fold on every node, every seed and every style; the receipt fires', () => {
    let changed = 0;
    for (const h of HANDS)
      for (const style of replayProfiles('cash'))
        for (const seed of SEEDS) {
          const on = decide(h, h.raiseOrd, ON, seed, style, limped);
          expect([h.slug, style.name, seed, on.d.action]).toEqual([
            h.slug,
            style.name,
            seed,
            'fold',
          ]);
          expect(on.d.amount).toBeUndefined();
          const f =
            (on.fires.vpip_floor_limp_raised_fold ?? 0) +
            (on.fires.vpip_floor_limp_raised_fold_kept ?? 0);
          expect(f).toBe(1);
          changed += on.fires.vpip_floor_limp_raised_fold ?? 0;
        }
    expect(changed).toBeGreaterThanOrEqual(40);
    expect(BASE_STYLES.length).toBeGreaterThan(0);
  }, 480_000);

  it('off (unset, false, a truthy non-boolean): byte for byte and draw for draw, with or without the remembered limp', () => {
    for (const h of HANDS)
      for (const seed of SEEDS.slice(0, 2)) {
        const base = decide(h, h.raiseOrd, TODAY, seed);
        for (const v of [undefined, false, 'yes', 1])
          for (const m of [undefined, limped]) {
            const o = { ...TODAY, vpipFloorLimpFoldsToARaise: v } as unknown as HorseDecideOpts;
            const got = decide(h, h.raiseOrd, o, seed, undefined, m);
            expect(withoutMeasurements(got.d)).toEqual(withoutMeasurements(base.d));
            expect(got.next).toBe(base.next);
            expect(got.fires.vpip_floor_limp_raised_fold).toBeUndefined();
          }
      }
  }, 240_000);

  it("on, a limp the engine did not remember as the floor's (a natural limp) keeps the unfloored answer", () => {
    for (const h of HANDS)
      for (const seed of SEEDS.slice(0, 2)) {
        const base = decide(h, h.raiseOrd, TODAY, seed);
        const got = decide(h, h.raiseOrd, ON, seed);
        expect(withoutMeasurements(got.d)).toEqual(withoutMeasurements(base.d));
        expect(got.next).toBe(base.next);
      }
  }, 240_000);

  it("the limp itself: on, the floor's limp carries the mark; off it never does; the action and amount are the same", () => {
    let marked = 0;
    for (const h of HANDS)
      for (const seed of SEEDS.slice(0, 3)) {
        const floor = { vpipFloorLimpOnly: true, vpipFloorLimpOnlyTenHandWindow: true };
        const off = decide(
          h,
          h.limpOrd,
          { ...TODAY, ...floor } as HorseDecideOpts,
          seed,
          undefined,
          underTheLine
        );
        const on = decide(
          h,
          h.limpOrd,
          { ...ON, ...floor } as HorseDecideOpts,
          seed,
          undefined,
          underTheLine
        );
        expect(off.d.vpipFloorLimp).toBeUndefined();
        expect([on.d.action, on.d.amount]).toEqual([off.d.action, off.d.amount]);
        expect(on.next).toBe(off.next);
        const floorLimp = (on.fires.vpip_floor_limp_only_limp ?? 0) > 0;
        expect(on.d.vpipFloorLimp === true).toBe(floorLimp && on.d.action === 'call');
        if (on.d.vpipFloorLimp) marked++;
        // no judged sample (no floor action): never a mark
        const none = decide(h, h.limpOrd, { ...ON, ...floor } as HorseDecideOpts, seed);
        expect(none.d.vpipFloorLimp).toBeUndefined();
      }
    expect(marked).toBeGreaterThanOrEqual(20);
  }, 240_000);
});

describe('vpipFloorLimpFoldsToARaise: every game that has a floor (built tables)', () => {
  const P: HorseDecideOpts = { ...PRODUCTION_28372C9A, vpipFloorLimpOnly: true };
  const HOLES: Record<FloorVariant, string[]> = {
    nlh: ['AsKs', 'QdQc', '7h2c', 'Ts9s'],
    plo4: ['AsAdKsKd', 'JsTs9d8d', '7h2c9d4s', 'KhQhJdTd'],
    plo5: ['AsAdKsKdQh', 'JsTs9d8d7c', '7h2c9d4sKd', 'KhQhJdTd9s'],
    plo6: ['AsAdKsKdQhJh', 'JsTs9d8d7c6c', '7h2c9d4sKd3h', 'KhQhJdTd9s8s'],
  };
  const FLOOR: Record<FloorVariant, number> = { nlh: 20, plo4: 30, plo5: 40, plo6: 40 };
  const tables = (
    v: FloorVariant
  ): Array<[string, Table, HorseDecideOpts, ((gs: Record<string, unknown>) => void)?]> => [
    [
      'thirty-hand table',
      { variant: v, floor: FLOOR[v], window: 30, ownVpip: { hands: 30, vpip: 10 } },
      P,
    ],
    [
      'ten-hand table (window option on)',
      { variant: v, floor: 40, window: 10, ownVpip: { hands: 10, vpip: 10 } },
      { ...P, vpipFloorLimpOnlyTenHandWindow: true },
    ],
    [
      'Lightning pool',
      { variant: v, floor: 0 },
      { ...P, lightningVpipFloorLimpOnly: true },
      (gs) => {
        gs.publicMemoryDomain = { ...(gs.publicMemoryDomain as object), speed: 'lightning' };
        gs.lightningVpipFloor = {
          floor: 40,
          windowHands: 10,
          own: { hands: 9, vpipHands: 0, leavingEntered: false, fromFirstHand: false },
        };
      },
    ],
  ];

  it('on: limped for the floor, then raised, the answer is a fold for every hand, seat and seed; off it is the unfloored answer', () => {
    let offContinues = 0;
    for (const v of Object.keys(HOLES) as FloorVariant[])
      for (const [name, table, opts, more] of tables(v))
        for (const spotName of ['btnFirstIn', 'coFirstIn', 'sbFirstIn', 'hjLimped'] as const)
          for (const hole of HOLES[v])
            for (const seed of [1, 7, 42]) {
              const spot = limpedThenRaised(SPOTS[spotName]);
              const mut = (gs: Record<string, unknown>) => {
                more?.(gs);
                limped(gs);
              };
              const off = decideAt(spot, table, hole, opts, seed, mut);
              const on = decideAt(
                spot,
                table,
                hole,
                { ...opts, vpipFloorLimpFoldsToARaise: true },
                seed,
                mut
              );
              expect([v, name, spotName, hole, seed, on.decision.action]).toEqual([
                v,
                name,
                spotName,
                hole,
                seed,
                'fold',
              ]);
              if (off.decision.action !== 'fold') offContinues++;
              // off, the remembered limp is not read
              const plain = decideAt(spot, table, hole, opts, seed, more);
              expect(withoutMeasurements(off.decision)).toEqual(
                withoutMeasurements(plain.decision)
              );
              expect(off.next).toBe(plain.next);
            }
    expect(offContinues).toBeGreaterThan(20);
  }, 600_000);

  it("the mark is set only by the floor's own limp: never at an unfloored table, never over the line, never with the option off", () => {
    for (const v of Object.keys(HOLES) as FloorVariant[])
      for (const hole of HOLES[v])
        for (const seed of [1, 7]) {
          const on = { ...P, vpipFloorLimpFoldsToARaise: true };
          const under: Table = {
            variant: v,
            floor: FLOOR[v],
            window: 30,
            ownVpip: { hands: 30, vpip: 10 },
          };
          const a = decideAt(SPOTS.btnFirstIn, under, hole, on, seed);
          const b = decideAt(SPOTS.btnFirstIn, under, hole, P, seed);
          expect(b.decision.vpipFloorLimp).toBeUndefined();
          expect([a.decision.action, a.decision.amount, a.next]).toEqual([
            b.decision.action,
            b.decision.amount,
            b.next,
          ]);
          if (a.decision.vpipFloorLimp) expect(a.decision.action).toBe('call');
          for (const t of [
            { variant: v, floor: 0 } as Table,
            { variant: v, floor: FLOOR[v], window: 30, ownVpip: { hands: 30, vpip: 90 } } as Table,
          ])
            expect(
              decideAt(SPOTS.btnFirstIn, t, hole, on, seed).decision.vpipFloorLimp
            ).toBeUndefined();
        }
  }, 240_000);
});

describe('vpipFloorLimpFoldsToARaise: the pure step', () => {
  const hist = [
    { stage: 'preflop', seat: 4, action: 'call' },
    { stage: 'preflop', seat: 6, action: 'raise', isFullRaise: true },
  ];
  const gs = {
    stage: 'preflop',
    currentBet: 9,
    ownVpipFloorLimpThisHand: true,
    actionHistory: hist,
  };
  const me = { seat: 4, bet: 2 };
  const call: HorseDecision = { action: 'call', amount: 7, thinkTime: 1 };

  it('read === true; needs the remembered limp, preflop, a raise after the limp and chips to call', () => {
    expect(vpipFloorLimpFacesARaise(me, gs)).toBe(true);
    expect(vpipFloorLimpFacesARaise(me, { ...gs, ownVpipFloorLimpThisHand: undefined })).toBe(
      false
    );
    expect(vpipFloorLimpFacesARaise(me, { ...gs, stage: 'flop' })).toBe(false);
    expect(vpipFloorLimpFacesARaise({ seat: 4, bet: 9 }, gs)).toBe(false);
    expect(vpipFloorLimpFacesARaise({ seat: 5, bet: 2 }, gs)).toBe(false);
    for (const v of [undefined, false, 'yes', 1])
      expect(
        vpipFloorLimpFoldsToARaiseStep(call, me, gs, { vpipFloorLimpFoldsToARaise: v as never })
      ).toEqual({ decision: call, receipt: null });
  });

  it('a call, a raise and an all-in become the fold; a fold is kept and guarded; nothing else changes', () => {
    for (const d of [
      call,
      { action: 'raise', amount: 30, thinkTime: 1 } as HorseDecision,
      { action: 'all_in', thinkTime: 1 } as HorseDecision,
    ]) {
      const r = vpipFloorLimpFoldsToARaiseStep(d, me, gs, { vpipFloorLimpFoldsToARaise: true });
      expect(r.receipt).toBe('vpip_floor_limp_raised_fold');
      expect(r.decision).toEqual({
        action: 'fold',
        thinkTime: 1,
        continuationGuard: 'preflop_priced_refusal',
      });
    }
    const f = vpipFloorLimpFoldsToARaiseStep({ action: 'fold', thinkTime: 1 }, me, gs, {
      vpipFloorLimpFoldsToARaise: true,
    });
    expect(f.receipt).toBe('vpip_floor_limp_raised_fold_kept');
    expect(f.decision.action).toBe('fold');
  });

  it('the remembered limp is outside the policy sampling key (carrying it resamples nothing)', () => {
    const h = HANDS[0];
    const st = stateAt(h, h.actions.find((a) => a.ord === h.raiseOrd)!);
    const input = (gameState: unknown) =>
      ({
        decisionKey: 'k',
        fence: 'f',
        decisionTimeMs: 0,
        player: st.hero,
        gameState,
        style: LIVE.style,
        mods: LIVE.mods,
        opts: {},
      }) as never;
    const withFlag = { ...st.gs, ownVpipFloorLimpThisHand: true };
    const plain = validatedHorsePolicySamplingKey(input(st.gs));
    expect(validatedHorsePolicySamplingKey(input(withFlag))).toBe(plain);
    // not vacuous: the full request key does bind the field
    expect(buildHorseDecisionKey(input(withFlag))).not.toBe(buildHorseDecisionKey(input(st.gs)));
  });
});

describe('vpipFloorLimpFoldsToARaise: cheap where it applies', () => {
  it('the real raised floor-limp nodes cost no more with the option on than off (relative, same machine)', () => {
    const states = HANDS.map((h) => {
      const st = stateAt(h, h.actions.find((a) => a.ord === h.raiseOrd)!);
      limped(st.gs as unknown as Record<string, unknown>);
      return st;
    });
    const quiet = { ...TODAY, telemetry: false } as HorseDecideOpts;
    const run = (opts: HorseDecideOpts) => () => {
      for (let r = 0; r < 4; r++)
        for (const st of states) {
          HorseMind.reset();
          seedFastRandom(7);
          HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, opts);
        }
    };
    const cost = measureRelativeCost(
      run({ ...quiet, vpipFloorLimpFoldsToARaise: true } as HorseDecideOpts),
      run(quiet)
    );
    // measured about 1.0 (the option adds one frame and one comparison); the bound leaves room for a loaded host
    expect(cost.ratio).toBeLessThan(2.5);
  }, 120_000);
});
