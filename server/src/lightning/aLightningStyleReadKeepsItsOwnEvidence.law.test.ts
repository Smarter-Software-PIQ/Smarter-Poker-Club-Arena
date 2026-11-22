/**
 * LAW (L-016, Lightning lane, 2026-11-15): A LIGHTNING STYLE READ CAN KEEP ITS
 * OWN EVIDENCE.
 *
 * The defect (probe 2026-11-14 on a7965514): the Lightning host sends its
 * completed hands with publicMemoryDomain {speed:'lightning'} and
 * styleMemoryMode 'cash' (buildLightningObservation, "F1: Lightning is cash").
 * The style learner's three maps (postflop street aggression, river size
 * buckets, the Horse population reference) are keyed variant|mode|size, never
 * by speed, and the decision sandbox does not swap them; so a Lightning style
 * read pooled Lightning and Classic (table-speed) cash evidence, while the
 * exploit and profile counters it reads beside them are per domain.
 *
 * The fix (default OFF, decide option lightningStyleReadSeparate):
 *   - the learner ALSO files a Lightning hand (the worker passes the hand's
 *     speed, styleSpeedOf) into Lightning-only maps with the same keys and
 *     their own caps; the pooled maps are filled exactly as before;
 *   - on a Lightning decision (gs.publicMemoryDomain.speed 'lightning') with
 *     the option on, the style read takes aggression, size buckets and the
 *     Horse reference from the Lightning-only maps.
 *
 * What this law pins:
 *   1. option off: the pooled behaviour exactly as today (the probe's flip
 *      still happens: a Lightning 4x turn check-raise folded on the Lightning
 *      record alone is called once the same player's Classic raises pool in);
 *      and every decision is byte-identical (action, amount, RNG) whatever the
 *      Lightning-only maps hold;
 *   2. option on: the Lightning decision reads only Lightning evidence and
 *      folds 24 of 24, as with the Lightning-only record;
 *   3. Classic decisions are unchanged with the option on or off;
 *   4. the pooled maps are byte-identical whether or not the learner is given
 *      the speed (the Lightning maps are additive).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseLogic } from '../engine/HorseLogic.js';
import { HorseMind } from '../engine/HorseMind.js';
import { addStreetAggression, type StreetAggression } from '../engine/HorseOpponentStyle.js';
import {
  cards,
  decide,
  HERO,
  VILLAIN,
  type Spot,
} from '../engine/HorseOpponentStyle.contexts.test-support.js';
import { counters } from '../engine/HorseOpponentStyle.test-support.js';
import { buildLightningObservation } from './LightningHorseObservation.js';
import { styleMemoryModeOf, styleSpeedOf } from '../engine/horseDecision/workerRuntime.js';
import type { SeatPlayer } from '../types.js';

afterEach(() => {
  HorseMind.setDecisionScope(null);
  HorseMind.enableHarnessStyleLearning(false);
  HorseMind.reset();
});

const PEER = 'eeeeeeee-0000-4000-8000-00000000000e';
/** One public hand: VILLAIN check-raises the turn against a Horse's bet (PEER). */
function turnRaiseHand(i: number) {
  const t = i * 100;
  return [
    {
      stage: 'preflop',
      seat: 1,
      userId: PEER,
      action: 'raise',
      amount: 6,
      isFullRaise: true,
      origin: 'horse_policy',
      timestamp: t + 1,
    },
    {
      stage: 'preflop',
      seat: 2,
      userId: VILLAIN,
      action: 'call',
      amount: 6,
      origin: 'player',
      timestamp: t + 2,
    },
    {
      stage: 'flop',
      seat: 2,
      userId: VILLAIN,
      action: 'check',
      amount: 0,
      origin: 'player',
      timestamp: t + 3,
    },
    {
      stage: 'flop',
      seat: 1,
      userId: PEER,
      action: 'bet',
      amount: 8,
      isFullRaise: true,
      origin: 'horse_policy',
      timestamp: t + 4,
    },
    {
      stage: 'flop',
      seat: 2,
      userId: VILLAIN,
      action: 'call',
      amount: 8,
      origin: 'player',
      timestamp: t + 5,
    },
    {
      stage: 'turn',
      seat: 2,
      userId: VILLAIN,
      action: 'check',
      amount: 0,
      origin: 'player',
      timestamp: t + 6,
    },
    {
      stage: 'turn',
      seat: 1,
      userId: PEER,
      action: 'bet',
      amount: 20,
      isFullRaise: true,
      origin: 'horse_policy',
      timestamp: t + 7,
    },
    {
      stage: 'turn',
      seat: 2,
      userId: VILLAIN,
      action: 'raise',
      amount: 60,
      isFullRaise: true,
      origin: 'player',
      timestamp: t + 8,
    },
    {
      stage: 'turn',
      seat: 1,
      userId: PEER,
      action: 'fold',
      amount: 0,
      origin: 'horse_policy',
      timestamp: t + 9,
    },
  ];
}
/** One public hand with a river first bet that reaches showdown (size buckets). */
function riverBetHand(i: number) {
  const t = i * 100;
  return [
    {
      stage: 'preflop',
      seat: 1,
      userId: PEER,
      action: 'raise',
      amount: 6,
      isFullRaise: true,
      origin: 'horse_policy',
      timestamp: t + 1,
    },
    {
      stage: 'preflop',
      seat: 2,
      userId: VILLAIN,
      action: 'call',
      amount: 6,
      origin: 'player',
      timestamp: t + 2,
    },
    {
      stage: 'flop',
      seat: 2,
      userId: VILLAIN,
      action: 'check',
      amount: 0,
      origin: 'player',
      timestamp: t + 3,
    },
    {
      stage: 'flop',
      seat: 1,
      userId: PEER,
      action: 'check',
      amount: 0,
      origin: 'horse_policy',
      timestamp: t + 4,
    },
    {
      stage: 'turn',
      seat: 2,
      userId: VILLAIN,
      action: 'check',
      amount: 0,
      origin: 'player',
      timestamp: t + 5,
    },
    {
      stage: 'turn',
      seat: 1,
      userId: PEER,
      action: 'check',
      amount: 0,
      origin: 'horse_policy',
      timestamp: t + 6,
    },
    {
      stage: 'river',
      seat: 2,
      userId: VILLAIN,
      action: 'bet',
      amount: 10,
      isFullRaise: true,
      origin: 'player',
      timestamp: t + 7,
    },
    {
      stage: 'river',
      seat: 1,
      userId: PEER,
      action: 'call',
      amount: 10,
      origin: 'horse_policy',
      timestamp: t + 8,
    },
  ];
}

/** The style learner exactly as the worker calls it (workerRuntime observeCompletedHandInMind). */
function learnLikeTheWorker(request: any, withSpeed = true): void {
  HorseMind.observeHandComplete(
    request.handKey,
    request.actions,
    request.bigBlind,
    request.showdown ?? null,
    request.scope,
    request.durableOpponentProfiles !== undefined,
    request.riverCallContext,
    request.retainedRiverCalls,
    styleMemoryModeOf(request),
    request.styleHasHuman === true,
    // withSpeed false: the worker as it was before L-016 (no speed argument)
    ...((withSpeed ? [styleSpeedOf(request)] : []) as [])
  );
}

function lightningObservation(n: number, actions: unknown[]) {
  return buildLightningObservation(
    {
      hostTableId: '11111111-0000-4000-8000-000000000001',
      handNumber: n,
      leaseGeneration: 'g',
      handHistoryId: `22222222-0000-4000-8000-${String(n).padStart(12, '0')}`,
      actions,
      bigBlind: 2,
      variant: 'nlh',
      publicMemoryDomain: { version: 1, speed: 'lightning', ante: 'big_blind' },
      hasHuman: true,
      dealtCount: 4,
      showdown: [{ user_id: VILLAIN, mucked: false, hand_name: 'Flush' }],
    } as never,
    undefined
  ) as any;
}
function classicObservation(lightning: any, n: number, actions: unknown[]) {
  return {
    ...lightning,
    handKey: `33333333-0000-4000-8000-000000000003:${n}`,
    fence: 'classic',
    publicMemoryDomain: { version: 1, speed: 'table', ante: 'none' },
    actions,
    styleMemoryMode: 'cash',
  };
}

const privateMap = (name: string) => (HorseMind as any)[name] as Map<string, unknown>;
const POOLED = ['styleAggression', 'styleSizeShown', 'styleHorseReference'];
const LIGHTNING = [
  'styleAggressionLightning',
  'styleSizeShownLightning',
  'styleHorseReferenceLightning',
];
const dump = (names: string[]) =>
  JSON.stringify(names.map((n) => [n, [...privateMap(n).entries()]]));

/** A mixed stream: Lightning and Classic hands of the same player, both kinds of evidence. */
function learnMixedStream(withSpeed: boolean): void {
  HorseMind.reset();
  const scope = 'holdem:short';
  for (let i = 1; i <= 12; i++) {
    const actions = i % 3 === 0 ? riverBetHand(i) : turnRaiseHand(i);
    const l = lightningObservation(i, actions);
    learnLikeTheWorker({ ...l, scope }, withSpeed);
    if (i % 2 === 0) learnLikeTheWorker({ ...classicObservation(l, i, actions), scope }, withSpeed);
  }
}

describe('L-016: the learner keeps a Lightning-only copy of the style evidence', () => {
  it('a Lightning hand is filed into both maps, a Classic hand into the pooled map only', () => {
    const lightning = lightningObservation(1, turnRaiseHand(1));
    expect(lightning.publicMemoryDomain).toEqual({
      version: 1,
      speed: 'lightning',
      ante: 'big_blind',
    });
    expect(styleMemoryModeOf(lightning)).toBe('cash');
    expect(styleSpeedOf(lightning)).toBe('lightning');
    const classic = classicObservation(lightning, 7, turnRaiseHand(2));
    expect(styleSpeedOf(classic)).toBe('table');
    expect(styleSpeedOf({})).toBeUndefined();
    expect(styleSpeedOf({ publicMemoryDomain: { speed: 'lightning' } })).toBeUndefined();
    const scope = 'holdem:short';
    const key = `nlh|cash|short|${VILLAIN.toLowerCase()}`;
    HorseMind.reset();
    learnLikeTheWorker({ ...lightning, scope });
    learnLikeTheWorker({ ...classic, scope });
    const pooled = privateMap('styleAggression').get(key) as StreetAggression;
    const apart = privateMap('styleAggressionLightning').get(key) as StreetAggression;
    // the defect, unchanged: one pooled record of both speeds
    expect(pooled.turn.raises).toBe(2);
    // the fix: the Lightning-only record holds the Lightning hand alone
    expect(apart.turn.raises).toBe(1);
    expect(HorseMind.styleHorseReferenceOf('nlh', 'cash', 'short')?.turn.aggr).toBe(2);
    expect(HorseMind.styleHorseReferenceOf('nlh', 'cash', 'short', 'lightning')?.turn.aggr).toBe(1);
  });

  it('the pooled maps are byte-identical with or without the speed (the Lightning maps are additive)', () => {
    learnMixedStream(false);
    const before = dump(POOLED);
    expect(dump(LIGHTNING)).toBe(JSON.stringify(LIGHTNING.map((n) => [n, []])));
    learnMixedStream(true);
    expect(dump(POOLED)).toBe(before);
    for (const n of LIGHTNING) expect(privateMap(n).size, n).toBeGreaterThan(0);
  });
});

// ── The decision: the reviewed #4b node, styleRaiseRespect ──
const THIRD = 'cccccccc-0000-4000-8000-000000000003';
const FOLDED = [1, 2, 3, 5, 9].map((s) => ({
  seat: s,
  id: `dddddddd-0000-4000-8000-00000000000${s}`,
}));
const SEEDS = Array.from({ length: 24 }, (_, i) => 0x57e1e + i * 7919);
const ON = { styleRaiseRespect: true, styleBigBetHonesty: true, styleValueBettorNotManiac: true };
const SEPARATE = { ...ON, lightningStyleReadSeparate: true };
const LIGHTNING_DOMAIN = { version: 1, speed: 'lightning', ante: 'big_blind' };
const TABLE_DOMAIN = { version: 1, speed: 'table', ante: 'none' };
const seatOf = (
  n: number,
  id: string,
  stack: number,
  bet: number,
  inv: number,
  hole = '',
  folded = false
) =>
  ({
    seat: n,
    user_id: id,
    username: `p${n}`,
    stack,
    bet,
    totalInvested: inv,
    cards: hole ? cards(hole) : [],
    is_folded: folded,
    is_all_in: false,
    is_sitting_out: false,
  }) as unknown as SeatPlayer;
const stamp = (acts: Array<Record<string, unknown>>) =>
  acts.map((a, i) => ({ ...a, timestamp: (i + 1) * 4000 }));
function turnCheckRaise(domain: unknown): Spot {
  const raiseTo = 120;
  const acts = stamp([
    { stage: 'preflop', seat: 8, userId: HERO, action: 'raise', amount: 5, isFullRaise: true },
    { stage: 'preflop', seat: 6, userId: VILLAIN, action: 'call', amount: 4.5 },
    { stage: 'preflop', seat: 7, userId: THIRD, action: 'call', amount: 4 },
    { stage: 'flop', seat: 6, userId: VILLAIN, action: 'check', amount: 0 },
    { stage: 'flop', seat: 7, userId: THIRD, action: 'check', amount: 0 },
    { stage: 'flop', seat: 8, userId: HERO, action: 'bet', amount: 11, isFullRaise: true },
    { stage: 'flop', seat: 6, userId: VILLAIN, action: 'call', amount: 11 },
    { stage: 'flop', seat: 7, userId: THIRD, action: 'call', amount: 11 },
    { stage: 'turn', seat: 6, userId: VILLAIN, action: 'check', amount: 0 },
    { stage: 'turn', seat: 7, userId: THIRD, action: 'check', amount: 0 },
    { stage: 'turn', seat: 8, userId: HERO, action: 'bet', amount: 30, isFullRaise: true },
    {
      stage: 'turn',
      seat: 6,
      userId: VILLAIN,
      action: 'raise',
      amount: raiseTo,
      isFullRaise: true,
    },
    { stage: 'turn', seat: 7, userId: THIRD, action: 'fold', amount: 0 },
  ]);
  const players = [
    ...FOLDED.map((f) => seatOf(f.seat, f.id, 200, 0, 0, '', true)),
    seatOf(6, VILLAIN, 37.65, raiseTo, 16 + raiseTo),
    seatOf(7, THIRD, 70.65, 0, 16, '', true),
    seatOf(8, HERO, 401.95, 30, 46, 'QdTc'),
  ].sort((a, b) => a.seat - b.seat);
  return {
    name: 'turn_4x_checkraise',
    hero: seatOf(8, HERO, 401.95, 30, 46, 'QdTc'),
    gs: {
      stateSchemaVersion: 1,
      players,
      communityCards: cards('Qs8hTdKs'),
      stage: 'turn',
      gameVariant: 'nlh',
      gameMode: 'cash',
      format: 'cash',
      publicMemoryDomain: domain,
      bettingStructure: 'no_limit',
      chipUnit: 0.01,
      asset: 'chips',
      bigBlind: 1,
      smallBlind: 0.5,
      dealerSeat: 5,
      heroSeat: 8,
      currentPlayerSeat: 8,
      legalActions: ['fold', 'call', 'raise', 'all_in'],
      wagersCapped: false,
      pot: 78 + raiseTo,
      currentBet: raiseTo,
      minRaise: raiseTo - 30,
      lastRaise: raiseTo - 30,
      toCall: raiseTo - 30,
      minRaiseTo: 2 * raiseTo - 30,
      maxRaiseTo: 431.95,
      actionHistory: acts,
    },
  } as unknown as Spot;
}
const agg = (f: number[], t: number[], r: number[]): StreetAggression => ({
  flop: { aggr: f[0], passive: f[1], raiseOpps: f[2], raises: f[3] },
  turn: { aggr: t[0], passive: t[1], raiseOpps: t[2], raises: t[3] },
  river: { aggr: r[0], passive: r[1], raiseOpps: r[2], raises: r[3] },
});
/** The Horse population reference used by the reviewed #4b test. */
const HORSE_REFERENCE = agg([500, 230, 700, 45], [380, 170, 520, 40], [400, 150, 460, 36]);
/** Lightning: passive, value-heavy (the #4b passive regular's record). */
const LIGHTNING_AGG = agg([14, 16, 44, 2], [10, 14, 34, 1], [5, 9, 18, 1]);
/** The same person at Classic tables: raises the turn 12 times in 40 chances and bets most streets. */
const CLASSIC_AGG = agg([40, 12, 30, 6], [30, 10, 40, 12], [12, 6, 10, 3]);
const POOLED_AGG = addStreetAggression(LIGHTNING_AGG, CLASSIC_AGG);
/** The domain profile: the partitioned counters the decision reads beside the style maps. */
const profileOf = (domain: unknown) => ({
  mode: 'cash',
  variant: 'nlh',
  size: 'full',
  observed_hands: 500,
  initialized: true,
  public_memory_domain: domain,
  counters: counters({
    hands: 60,
    vpip: 0.26,
    pfr: 0.09,
    threeBetOpp: 24,
    threeBet: 0,
    betCheckedToOpp: 18,
    betCheckedTo: 5,
    foldToBetOpp: 14,
    foldToBet: 7,
  }),
  user_id: VILLAIN,
});

/** The live state after the fix: the pooled maps as today, the Lightning-only maps beside them. */
function install(
  pooled: StreetAggression,
  lightning: StreetAggression | null,
  domain: unknown = LIGHTNING_DOMAIN,
  lightningReference = true
): void {
  HorseMind.reset();
  const ref = [
    { variant: 'nlh', mode: 'cash' as const, size: 'full' as const, reference: HORSE_REFERENCE },
  ];
  HorseMind.importStyleHorseReference(ref);
  if (lightningReference) HorseMind.importStyleHorseReference(ref, 'lightning');
  HorseMind.importDurableOpponentProfiles([profileOf(domain) as never]);
  HorseMind.importStyleAggression([
    { user_id: VILLAIN, variant: 'nlh', mode: 'cash', size: 'full', aggression: pooled },
  ]);
  if (lightning)
    HorseMind.importStyleAggression(
      [{ user_id: VILLAIN, variant: 'nlh', mode: 'cash', size: 'full', aggression: lightning }],
      'lightning'
    );
}
function tally(spot: () => Spot, setup: () => void, opts: Record<string, unknown>) {
  const actions: Record<string, number> = {};
  const digests: string[] = [];
  let respect = 0;
  let separate = 0;
  let empty = 0;
  for (const seed of SEEDS) {
    setup();
    const d = decide(spot(), opts, seed);
    actions[d.decision.action] = (actions[d.decision.action] ?? 0) + 1;
    digests.push(d.digest);
    respect += d.fires.style_value_raise_respect_seen ?? 0;
    separate += d.fires.style_lightning_separate_read_seen ?? 0;
    empty += d.fires.style_lightning_separate_empty_seen ?? 0;
  }
  return { actions, digests, respect, separate, empty };
}
const lightningSpot = () => turnCheckRaise(LIGHTNING_DOMAIN);
const classicSpot = () => turnCheckRaise(TABLE_DOMAIN);

describe('L-016: a Lightning style read can keep its own evidence (lightningStyleReadSeparate, default off)', () => {
  it('option off: the pooled read as today; the probe flip still happens (the defect, documented)', () => {
    const lightningOnly = tally(lightningSpot, () => install(LIGHTNING_AGG, LIGHTNING_AGG), ON);
    const pooled = tally(lightningSpot, () => install(POOLED_AGG, LIGHTNING_AGG), ON);
    expect(lightningOnly.actions).toEqual({ fold: SEEDS.length });
    expect(pooled.actions.fold ?? 0).toBe(0);
    expect(pooled.separate + pooled.empty + lightningOnly.separate).toBe(0);
  });

  it('option off: every decision is byte-identical whatever the Lightning-only maps hold', () => {
    for (const opts of [{}, ON, { ...ON, lightningStyleReadSeparate: false }]) {
      for (const spot of [lightningSpot, classicSpot]) {
        const none = tally(spot, () => install(POOLED_AGG, null, LIGHTNING_DOMAIN, false), opts);
        const filled = tally(spot, () => install(POOLED_AGG, LIGHTNING_AGG), opts);
        const contrary = tally(spot, () => install(POOLED_AGG, CLASSIC_AGG), opts);
        expect(filled.digests).toEqual(none.digests);
        expect(contrary.digests).toEqual(none.digests);
        expect(filled.separate + filled.empty).toBe(0);
      }
    }
    // the option alone (no style consumer on) changes nothing either, even on a Lightning decision
    expect(
      tally(lightningSpot, () => install(POOLED_AGG, LIGHTNING_AGG), {
        lightningStyleReadSeparate: true,
      }).digests
    ).toEqual(tally(lightningSpot, () => install(POOLED_AGG, LIGHTNING_AGG), {}).digests);
  });

  it('option on: the Lightning decision reads only Lightning evidence and folds 24 of 24', () => {
    const r = tally(lightningSpot, () => install(POOLED_AGG, LIGHTNING_AGG), SEPARATE);
    expect(r.actions).toEqual({ fold: SEEDS.length });
    expect(r.respect).toBeGreaterThan(0);
    expect(r.separate).toBeGreaterThanOrEqual(SEEDS.length);
    expect(r.empty).toBe(0);
    // the same decisions as a process whose only record is the Lightning one
    const lightningOnly = tally(lightningSpot, () => install(LIGHTNING_AGG, LIGHTNING_AGG), ON);
    expect(r.digests).toEqual(lightningOnly.digests);
  });

  it('option on, no Lightning evidence where the pooled map has some: the empty receipt fires', () => {
    const r = tally(
      lightningSpot,
      () => install(POOLED_AGG, null, LIGHTNING_DOMAIN, false),
      SEPARATE
    );
    expect(r.separate).toBeGreaterThan(0);
    expect(r.empty).toBeGreaterThan(0);
  });

  it('Classic decisions are unchanged with the option on or off', () => {
    for (const lightning of [LIGHTNING_AGG, CLASSIC_AGG, null]) {
      const setup = () => install(POOLED_AGG, lightning, TABLE_DOMAIN);
      const off = tally(classicSpot, setup, ON);
      const on = tally(classicSpot, setup, SEPARATE);
      expect(on.digests).toEqual(off.digests);
      expect(on.separate + on.empty).toBe(0);
    }
    // a decision with no public memory domain (legacy, tournament feeders) is untouched too
    const legacy = () => turnCheckRaise(undefined);
    const setup = () => install(POOLED_AGG, LIGHTNING_AGG, TABLE_DOMAIN);
    expect(tally(legacy, setup, SEPARATE).digests).toEqual(tally(legacy, setup, ON).digests);
  });

  it('the option reaches the read only on a Lightning decision, and only when explicitly true', () => {
    const readOptionsOf = (spot: Spot, opts: Record<string, unknown>) => {
      install(POOLED_AGG, LIGHTNING_AGG);
      HorseLogic.prepareOriginalReads(
        spot.hero,
        spot.gs as never,
        { ...opts, observeMind: false } as never
      );
      const o = { ...HorseMind.currentDecisionReadOptions() };
      HorseMind.setDecisionScope(null);
      return o;
    };
    expect(readOptionsOf(lightningSpot(), SEPARATE).lightningStyleReadSeparate).toBe(true);
    expect('lightningStyleReadSeparate' in readOptionsOf(lightningSpot(), ON)).toBe(false);
    expect(
      'lightningStyleReadSeparate' in
        readOptionsOf(lightningSpot(), { ...ON, lightningStyleReadSeparate: false })
    ).toBe(false);
    expect('lightningStyleReadSeparate' in readOptionsOf(classicSpot(), SEPARATE)).toBe(false);
    expect('lightningStyleReadSeparate' in readOptionsOf(turnCheckRaise(undefined), SEPARATE)).toBe(
      false
    );
    // with the option off the read options are exactly what they were
    expect(readOptionsOf(lightningSpot(), ON)).toEqual(readOptionsOf(classicSpot(), SEPARATE));
  });

  it('omahaFacingBetEvReadOf reads styleSizeShownLightning on a Lightning decision when lightningStyleReadSeparate is true', () => {
    HorseMind.reset();
    HorseMind.importSizeBuckets([
      {
        user_id: VILLAIN,
        variant: 'plo4',
        mode: 'cash',
        size: 'short',
        buckets: {
          large: { bets: 10, shown: 8, strong: 6, best: 5, second: 2 } as never,
        },
      },
    ]);
    HorseMind.importSizeBuckets(
      [
        {
          user_id: VILLAIN,
          variant: 'plo4',
          mode: 'cash',
          size: 'short',
          buckets: {
            large: { bets: 4, shown: 3, strong: 1, best: 1, second: 1 } as never,
          },
        },
      ],
      'lightning'
    );
    HorseMind.setDecisionScope('omaha:short', 'plo4', 'cash');
    expect(HorseMind.omahaFacingBetEvReadOf(VILLAIN, 'river', 0.75, false)?.sizeShown).toEqual({
      shown: 8,
      best: 5,
      second: 2,
    });
    HorseMind.setDecisionReadOptions({ lightningStyleReadSeparate: true });
    expect(HorseMind.omahaFacingBetEvReadOf(VILLAIN, 'river', 0.75, false)?.sizeShown).toEqual({
      shown: 3,
      best: 1,
      second: 1,
    });
    HorseMind.setDecisionScope(null);
  });
});
