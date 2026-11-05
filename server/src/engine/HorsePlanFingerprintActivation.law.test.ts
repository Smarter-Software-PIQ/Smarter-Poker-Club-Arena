/**
 * LAW: the dormant decision-readiness layers run on every real hand.
 * ═══════════════════════════════════════════════════════════════════════════
 * Dan (2026-11-05): the horses must use every tool, skill and ability that
 * was built, in real time, on every hand and every street. The fleet audit
 * of release 71087373 found three merged layers no live decision ever
 * reached: the Items 21 and 23 plan fingerprint
 * (HorseContinuationPlanInvalidation.computeContinuationContenderFingerprint
 * and evaluateMultiStreetBarrelContinuation), the Item 12 opportunity-scoped
 * exploit decay (HorseOpponentExploit.decayAndAddOpportunityScoped, never
 * selected by HorseMind) and the Item 12 donor staleness blend
 * (HorseOpponentMemory.blendOpponentMemoryWithExpiry and
 * computeDonorHandClockStaleness). This law proves each is reached from
 * HorseLogic.decide (or the completed-hand observation the decision reads)
 * on a realistic hand with a pinned decision clock, leaves its receipt, and
 * keeps the public-information and label-neutrality boundaries.
 *
 * Horses are the platform's AI players. Never call them anything else.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind, type HorseMindDecisionEffect } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { horseDecisionEffectsAreValid } from './HorseDecisionEffects.js';
import {
  EXPLOIT_DECAY,
  freshExploitCounters,
  type ExploitCounters,
} from './HorseOpponentExploit.js';
import { OPPONENT_MEMORY_THIN_HANDS, type DurableOpponentProfile } from './HorseOpponentMemory.js';
import type { ActionRecord, Card, SeatPlayer } from '../types.js';

const T0 = Date.UTC(2026, 10, 5, 15, 30);
const HERO = '11111111-1111-4111-8111-111111111111';
const VILLAIN = '22222222-2222-4222-8222-222222222222';
const THIRD = '33333333-3333-4333-8333-333333333333';

const c = (s: string): Card => ({
  rank: s[0] as Card['rank'],
  suit: ({ c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' } as const)[s[1] as 'c'],
});

function seat(user: string, seatNo: number, stack: number, cards: string[] = []): SeatPlayer {
  return {
    seat: seatNo,
    user_id: user,
    username: `p${seatNo}`,
    stack,
    bet: 0,
    totalInvested: 10,
    cards: cards.map(c),
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
    is_horse: user === HERO,
  };
}

/** Hero opened, villain called; the flop is checked to hero (hero in position). */
function flopSpot(heroCards: string[], board: string[], extraSeat?: SeatPlayer) {
  const hist: ActionRecord[] = [
    { seat: 2, userId: HERO, action: 'raise', amount: 6, timestamp: T0 + 1, stage: 'preflop' },
    { seat: 5, userId: VILLAIN, action: 'call', amount: 6, timestamp: T0 + 2, stage: 'preflop' },
    { seat: 5, userId: VILLAIN, action: 'check', amount: 0, timestamp: T0 + 3, stage: 'flop' },
  ];
  const hero = seat(HERO, 2, 200, heroCards);
  const villain = seat(VILLAIN, 5, 200);
  const players = extraSeat ? [hero, villain, extraSeat] : [hero, villain];
  const gs = {
    players,
    communityCards: board.map(c),
    pot: 13,
    currentBet: 0,
    minRaise: 2,
    stage: 'flop' as const,
    gameVariant: 'nlh',
    bigBlind: 2,
    dealerSeat: 2,
    actionHistory: hist,
  };
  return { hero, gs, key: HorseMind.handKeyOf(hist)! };
}

/** The same hand on the turn: hero's flop bet was called, villain checks. */
function turnSpot(heroCards: string[], board: string[], extraSeat?: SeatPlayer) {
  const hist: ActionRecord[] = [
    { seat: 2, userId: HERO, action: 'raise', amount: 6, timestamp: T0 + 1, stage: 'preflop' },
    { seat: 5, userId: VILLAIN, action: 'call', amount: 6, timestamp: T0 + 2, stage: 'preflop' },
    { seat: 5, userId: VILLAIN, action: 'check', amount: 0, timestamp: T0 + 3, stage: 'flop' },
    { seat: 2, userId: HERO, action: 'bet', amount: 8, timestamp: T0 + 4, stage: 'flop' },
    { seat: 5, userId: VILLAIN, action: 'call', amount: 8, timestamp: T0 + 5, stage: 'flop' },
    { seat: 5, userId: VILLAIN, action: 'check', amount: 0, timestamp: T0 + 6, stage: 'turn' },
  ];
  const hero = seat(HERO, 2, 186, heroCards);
  const villain = seat(VILLAIN, 5, 186);
  const players = extraSeat ? [hero, villain, extraSeat] : [hero, villain];
  const gs = {
    players,
    communityCards: board.map(c),
    pot: 29,
    currentBet: 0,
    minRaise: 2,
    stage: 'turn' as const,
    gameVariant: 'nlh',
    bigBlind: 2,
    dealerSeat: 2,
    actionHistory: hist,
  };
  return { hero, gs, key: HorseMind.handKeyOf(hist)! };
}

const LIVE: HorseDecideOpts = { telemetry: true, decisionTimeMs: T0 + 10 };

function fires(): Map<string, number> {
  return new Map(drainFires().map((r) => [r.feature, r.fires]));
}

beforeEach(() => {
  enableBrainTelemetry();
  drainFires();
  HorseMind.reset();
});
afterEach(() => {
  drainFires();
  HorseMind.reset();
});

describe('Items 21 and 23: a planned barrel records the next-street state it expects', () => {
  it('a planned flop semi-bluff records its contender and exposure fingerprint beside the plan, through the effect sink, with its receipt', () => {
    let found: { effects: HorseMindDecisionEffect[]; amount: number } | null = null;
    for (let seed = 1; seed <= 400 && !found; seed++) {
      HorseMind.reset();
      drainFires();
      seedFastRandom(seed);
      const f = flopSpot(['9c', '8c'], ['Kd', '7s', '2c']);
      const captured = HorseMind.captureDecisionEffects(() =>
        HorseLogic.decide(f.hero, f.gs as never, 'balanced', {}, { ...LIVE })
      );
      const plan = captured.effects.find((e) => e.type === 'plan');
      if (plan && plan.type === 'plan' && plan.barrelIntent && captured.value.action === 'bet') {
        found = { effects: captured.effects, amount: captured.value.amount ?? 0 };
        const fp = captured.effects.find((e) => e.type === 'plan_fingerprint');
        expect(fp).toBeDefined();
        if (!fp || fp.type !== 'plan_fingerprint') throw new Error('unreachable');
        expect(fp.handKey).toBe(f.key);
        expect(fp.userId).toBe(HERO);
        expect(fp.street).toBe('flop');
        // Public information only: seat occupancy and chip counts.
        expect(fp.contenderIds).toEqual([HERO, VILLAIN]);
        expect(fp.bigBlindChips).toBe(2);
        // The next-street state the wager expects: matched once by villain.
        expect(fp.potChips).toBeCloseTo(13 + 2 * found.amount, 6);
        expect(fp.effectiveStackChips).toBeCloseTo(200 - found.amount, 6);
        expect(horseDecisionEffectsAreValid(captured.effects)).toBe(true);
        const f1 = fires();
        expect(f1.get('plan_fingerprint_recorded')).toBe(1);
        // It lands only on acceptance, like the plan it belongs to.
        expect(HorseMind.planFingerprintOf(f.key, HERO, 'flop')).toBeUndefined();
        HorseMind.applyDecisionEffects(captured.effects);
        const stored = HorseMind.planFingerprintOf(f.key, HERO, 'flop');
        expect(stored?.activeContenderCount).toBe(2);
        expect(stored?.effectiveSpr).toBeCloseTo((200 - found.amount) / (13 + 2 * found.amount), 6);
      }
    }
    expect(found, 'no seed produced a planned flop semi-bluff bet').not.toBeNull();
  });

  it('the off arm records no fingerprint and the plan stays as before', () => {
    let planned = 0;
    for (let seed = 1; seed <= 120; seed++) {
      HorseMind.reset();
      seedFastRandom(seed);
      const f = flopSpot(['9c', '8c'], ['Kd', '7s', '2c']);
      const captured = HorseMind.captureDecisionEffects(() =>
        HorseLogic.decide(
          f.hero,
          f.gs as never,
          'balanced',
          {},
          { ...LIVE, planFingerprint: false }
        )
      );
      if (captured.effects.some((e) => e.type === 'plan' && e.barrelIntent)) planned++;
      expect(captured.effects.some((e) => e.type === 'plan_fingerprint')).toBe(false);
    }
    expect(planned).toBeGreaterThan(0);
    expect(fires().get('plan_fingerprint_recorded')).toBeUndefined();
  });

  it('the turn reads the fingerprint the flop planned and keeps the plan when the street matches it', () => {
    let read = 0;
    for (let seed = 1; seed <= 40; seed++) {
      HorseMind.reset();
      drainFires();
      seedFastRandom(seed);
      const f = turnSpot(['9c', '8c'], ['Kd', '7s', '2c', '5h']);
      HorseMind.notePlan(f.key, HERO, true);
      HorseMind.noteOutlook(f.key, HERO, 'flop', ['6h', 'Th'], ['Ah', 'As']);
      // Exactly the state the flop wager planned for: the same two contenders,
      // 186 behind over a 29 pot.
      HorseMind.notePlanFingerprint(f.key, HERO, 'flop', {
        contenderIds: [HERO, VILLAIN],
        effectiveStackChips: 186,
        potChips: 29,
        bigBlindChips: 2,
      });
      const on = HorseLogic.decide(f.hero, f.gs as never, 'balanced', {}, { ...LIVE });
      const f1 = fires();
      if (f1.get('plan_fingerprint_continued_on_blank')) {
        read++;
        expect(f1.get('plan_fingerprint_absent')).toBeUndefined();
        for (const k of f1.keys()) expect(k.startsWith('plan_fingerprint_aborted')).toBe(false);
        // The same seed without the layer decides the same way: a matching
        // street never changes the plan.
        HorseMind.reset();
        seedFastRandom(seed);
        HorseMind.notePlan(f.key, HERO, true);
        HorseMind.noteOutlook(f.key, HERO, 'flop', ['6h', 'Th'], ['Ah', 'As']);
        const off = HorseLogic.decide(
          f.hero,
          f.gs as never,
          'balanced',
          {},
          { ...LIVE, planFingerprint: false }
        );
        expect({ action: on.action, amount: on.amount ?? null }).toEqual({
          action: off.action,
          amount: off.amount ?? null,
        });
      }
    }
    expect(read).toBeGreaterThan(0);
  });

  it('a good or scare turn card is tagged by the fingerprint while V39 keeps the card read', () => {
    seedFastRandom(7);
    const f = turnSpot(['9c', '8c'], ['Kd', '7s', '2c', '6h']);
    HorseMind.notePlan(f.key, HERO, true);
    HorseMind.noteOutlook(f.key, HERO, 'flop', ['6h', 'Th'], ['Ah', 'As']);
    HorseMind.notePlanFingerprint(f.key, HERO, 'flop', {
      contenderIds: [HERO, VILLAIN],
      effectiveStackChips: 186,
      potChips: 29,
      bigBlindChips: 2,
    });
    HorseLogic.decide(f.hero, f.gs as never, 'balanced', {}, { ...LIVE });
    const f1 = fires();
    expect(f1.get('plan_fingerprint_improved_on_good_card')).toBe(1);
    expect(f1.get('v39_outlook_good')).toBe(1);
  });

  it('a contender the plan never expected withdraws the planned barrel before it fires', () => {
    let aborted = 0;
    for (let seed = 1; seed <= 40; seed++) {
      HorseMind.reset();
      drainFires();
      seedFastRandom(seed);
      const third = seat(THIRD, 8, 186);
      const f = turnSpot(['9c', '8c'], ['Kd', '7s', '2c', '5h'], third);
      HorseMind.notePlan(f.key, HERO, true);
      HorseMind.noteOutlook(f.key, HERO, 'flop', ['6h', 'Th'], ['Ah', 'As']);
      // The flop plan expected villain alone to continue.
      HorseMind.notePlanFingerprint(f.key, HERO, 'flop', {
        contenderIds: [HERO, VILLAIN],
        effectiveStackChips: 186,
        potChips: 29,
        bigBlindChips: 2,
      });
      HorseLogic.decide(f.hero, f.gs as never, 'balanced', {}, { ...LIVE });
      const f1 = fires();
      if (f1.get('plan_fingerprint_aborted_multiway_contender_shift')) aborted++;
      expect(f1.get('plan_fingerprint_continued_on_blank')).toBeUndefined();
    }
    expect(aborted).toBeGreaterThan(0);
  });

  it('a stack-to-pot exposure far from the planned one withdraws the plan, and the withdrawal is not vacuous', () => {
    let aborted = 0;
    let withdrawnBarrel = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const run = (planFingerprint: boolean) => {
        HorseMind.reset();
        drainFires();
        seedFastRandom(seed);
        const f = turnSpot(['9c', '8c'], ['Kd', '7s', '2c', '5h']);
        HorseMind.notePlan(f.key, HERO, true);
        HorseMind.noteOutlook(f.key, HERO, 'flop', ['6h', 'Th'], ['Ah', 'As']);
        // The flop plan expected to be nearly all-in on the turn (20 behind
        // over 29); the turn arrived with 186 behind instead.
        HorseMind.notePlanFingerprint(f.key, HERO, 'flop', {
          contenderIds: [HERO, VILLAIN],
          effectiveStackChips: 20,
          potChips: 29,
          bigBlindChips: 2,
        });
        const d = HorseLogic.decide(
          f.hero,
          f.gs as never,
          'balanced',
          {},
          { ...LIVE, planFingerprint }
        );
        return { d, f: fires() };
      };
      const on = run(true);
      const off = run(false);
      if (on.f.get('plan_fingerprint_aborted_stack_exposure_shift')) aborted++;
      expect(off.f.get('plan_fingerprint_aborted_stack_exposure_shift')).toBeUndefined();
      if (off.d.action === 'bet' && on.d.action === 'check') withdrawnBarrel++;
    }
    expect(aborted).toBe(200);
    expect(withdrawnBarrel).toBeGreaterThan(0);
  });

  it('a plan recorded without a fingerprint is answered as before and says so', () => {
    seedFastRandom(3);
    const f = turnSpot(['9c', '8c'], ['Kd', '7s', '2c', '5h']);
    HorseMind.notePlan(f.key, HERO, true);
    HorseLogic.decide(f.hero, f.gs as never, 'balanced', {}, { ...LIVE });
    expect(fires().get('plan_fingerprint_absent')).toBe(1);
  });

  it('the fingerprint effect is validated like every other intent and never carries anything but identities and chips', () => {
    const ok: HorseMindDecisionEffect = {
      type: 'plan_fingerprint',
      handKey: 'h',
      userId: HERO,
      street: 'flop',
      contenderIds: [HERO, VILLAIN],
      effectiveStackChips: 100,
      potChips: 30,
      bigBlindChips: 2,
    };
    expect(horseDecisionEffectsAreValid([ok])).toBe(true);
    expect(horseDecisionEffectsAreValid([{ ...ok, street: 'preflop' }])).toBe(false);
    expect(horseDecisionEffectsAreValid([{ ...ok, contenderIds: [] }])).toBe(false);
    expect(horseDecisionEffectsAreValid([{ ...ok, contenderIds: [HERO, HERO] }])).toBe(false);
    expect(horseDecisionEffectsAreValid([{ ...ok, potChips: -1 }])).toBe(false);
    expect(horseDecisionEffectsAreValid([{ ...ok, cards: ['Ah'] } as never])).toBe(false);
  });
});

describe('Item 12: opportunity-scoped exploit decay runs on every completed hand the mind observes', () => {
  const SCOPE = 'holdem:hu' as const;
  const riverHand = (t: number) => [
    { userId: HERO, action: 'raise', amount: 6, stage: 'preflop', timestamp: t + 1 },
    { userId: VILLAIN, action: 'call', amount: 6, stage: 'preflop', timestamp: t + 2 },
    { userId: VILLAIN, action: 'check', amount: 0, stage: 'flop', timestamp: t + 3 },
    { userId: HERO, action: 'check', amount: 0, stage: 'flop', timestamp: t + 4 },
    { userId: VILLAIN, action: 'check', amount: 0, stage: 'turn', timestamp: t + 5 },
    { userId: HERO, action: 'check', amount: 0, stage: 'turn', timestamp: t + 6 },
    { userId: VILLAIN, action: 'check', amount: 0, stage: 'river', timestamp: t + 7 },
    { userId: HERO, action: 'bet', amount: 10, stage: 'river', timestamp: t + 8 },
    { userId: VILLAIN, action: 'call', amount: 10, stage: 'river', timestamp: t + 9 },
  ];
  const preflopHand = (t: number) => [
    { userId: HERO, action: 'raise', amount: 6, stage: 'preflop', timestamp: t + 1 },
    { userId: VILLAIN, action: 'call', amount: 6, stage: 'preflop', timestamp: t + 2 },
    { userId: VILLAIN, action: 'check', amount: 0, stage: 'flop', timestamp: t + 3 },
    { userId: HERO, action: 'bet', amount: 8, stage: 'flop', timestamp: t + 4 },
    { userId: VILLAIN, action: 'fold', amount: 0, stage: 'flop', timestamp: t + 5 },
  ];

  it('a river call read survives hands that offered no river call, while the per-hand counters still decay', () => {
    HorseMind.observeHandComplete('h1', riverHand(T0), 2, null, SCOPE, false);
    const after1 = { ...HorseMind.getExploitCounters(VILLAIN, SCOPE)! };
    expect(after1.riverCallOpp).toBe(1);
    expect(after1.riverCall).toBe(1);
    for (let i = 2; i <= 30; i++)
      HorseMind.observeHandComplete(`h${i}`, preflopHand(T0 + i * 100), 2, null, SCOPE, false);
    const after30 = HorseMind.getExploitCounters(VILLAIN, SCOPE)!;
    // Opportunity-scoped: the river call sample is untouched by 29 hands with
    // no river call opportunity ...
    expect(after30.riverCallOpp).toBe(1);
    expect(after30.riverCall).toBe(1);
    // ... while the every-hand counters decayed and accumulated as before.
    expect(after30.hands).toBeGreaterThan(1);
    expect(after30.hands).toBeLessThan(30);
    // Under the retired per-hand rule the sample would have halved.
    expect(1 * Math.pow(EXPLOIT_DECAY, 29)).toBeLessThan(0.52);
    expect(fires().get('opponent_exploit_opportunity_scoped_observed')).toBe(30);
  });

  it('a sandbox hand merged into the live mind follows the same rule', () => {
    HorseMind.observeHandComplete('h1', riverHand(T0), 2, null, SCOPE, false);
    const sandbox = HorseMind.createSandbox();
    HorseMind.runInSandbox(sandbox, () => {
      HorseMind.observeHandComplete('h2', preflopHand(T0 + 500), 2, null, SCOPE, false);
    });
    HorseMind.mergeSandboxExploit(sandbox);
    const row = HorseMind.getExploitCounters(VILLAIN, SCOPE)!;
    expect(row.riverCallOpp).toBe(1);
    expect(row.hands).toBeCloseTo(EXPLOIT_DECAY + 1, 9);
  });
});

describe("Item 12: a borrowed table-size bucket is weighed by its staleness on the player's own hand clock", () => {
  function profile(size: 'short' | 'full', hands: number): DurableOpponentProfile {
    const counters: ExploitCounters = freshExploitCounters();
    counters.hands = hands;
    counters.vpip = hands * 0.9;
    counters.pfr = hands * 0.8;
    counters.rfiOpp = hands;
    counters.rfi = hands * 0.9;
    counters.threeBetOpp = hands;
    counters.threeBet = hands * 0.6;
    return {
      user_id: VILLAIN,
      variant: 'nlh',
      mode: 'cash',
      size,
      observed_hands: hands,
      initialized: true,
      counters,
    };
  }
  /** A three-handed flop (short) so the full-ring bucket is the donor. */
  function shortSpot() {
    const third = seat(THIRD, 8, 200);
    return flopSpot(['Ah', 'Kh'], ['Kd', '7s', '2c'], third);
  }
  function play(seed: number) {
    seedFastRandom(seed);
    const f = shortSpot();
    HorseLogic.decide(f.hero, f.gs as never, 'balanced', {}, { ...LIVE, observeMind: false });
    return fires();
  }

  it('a donor refreshed on the current clock is fresh; hands played since make it stale', () => {
    HorseMind.importDurableOpponentProfiles([profile('short', 3), profile('full', 60)]);
    expect(3).toBeLessThan(OPPONENT_MEMORY_THIN_HANDS);
    const fresh = play(1);
    expect(fresh.get('opponent_memory_donor_fresh')).toBeGreaterThan(0);
    expect(fresh.get('opponent_memory_donor_stale')).toBeUndefined();
    // Villain plays on: twenty hands observed since the donor was imported.
    for (let i = 1; i <= 20; i++) {
      const t = T0 + 10_000 * i;
      HorseMind.observe(
        [
          { seat: 5, userId: VILLAIN, action: 'raise', amount: 6, timestamp: t, stage: 'preflop' },
          { seat: 2, userId: HERO, action: 'fold', amount: 0, timestamp: t + 1, stage: 'preflop' },
        ],
        []
      );
    }
    expect(HorseMind.getStats(VILLAIN)?.hands).toBe(20);
    const stale = play(2);
    expect(stale.get('opponent_memory_donor_stale')).toBeGreaterThan(0);
    expect(stale.get('opponent_memory_donor_fresh')).toBeUndefined();
    // A re-imported donor (its row changed on the database) is fresh again.
    HorseMind.importDurableOpponentProfiles([profile('full', 61)]);
    const refreshed = play(3);
    expect(refreshed.get('opponent_memory_donor_fresh')).toBeGreaterThan(0);
  });

  it('a thick exact row never borrows, and an absent donor leaves no donor receipt', () => {
    HorseMind.importDurableOpponentProfiles([profile('short', 40), profile('full', 60)]);
    const thick = play(1);
    for (const k of thick.keys()) expect(k.startsWith('opponent_memory_donor')).toBe(false);
    HorseMind.reset();
    enableBrainTelemetry();
    HorseMind.importDurableOpponentProfiles([profile('short', 3)]);
    const alone = play(1);
    for (const k of alone.keys()) expect(k.startsWith('opponent_memory_donor')).toBe(false);
  });
});
