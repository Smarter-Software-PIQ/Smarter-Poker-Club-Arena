import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Card, SeatPlayer } from '../types.js';
import { HorseLogic, plo6FacingBetPricedV2VerdictOf, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import {
  plo6FacingBetPricedV2,
  plo6FacingBetPricedV2Scope,
  plo6V2Spot,
} from './HorsePlo6FacingBetPricedV2.js';
import { withFrozenDecisionClock } from './testing/frozenDecisionClock.js';
import {
  actionKind,
  replayProfiles,
  stateAt,
  type ComplaintAction,
  type ExtractedHand,
} from './HorseComplaintReplay.js';
import { withoutMeasurements } from './HorseDeclaredWork.test-support.js';
import {
  horseDecisionReceiptRefusal,
  horseDecisionReceiptRefusalForGates,
  plo6FacingBetIsPricedV2GateCandidates,
} from './horseDecision/responseValidation.js';
import {
  OPTION_SWITCH_ON_SHADOW_NAMES,
  OPTION_SWITCH_PLAIN_NAMES,
  OPTION_SWITCH_SHADOW_NAMES,
} from './HorseOptionSwitch.js';

const FIXTURE = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'Plo6FacingBetIsPriced.fixture.json'),
    'utf8'
  )
) as { hands: { hand: ExtractedHand; ords: number[]; ids: Record<string, string> }[] };
const LIVE = replayProfiles('cash').find((p) => p.live)!;

const card = (s: string): Card => {
  const map: Record<string, Card['suit']> = {
    c: 'clubs',
    d: 'diamonds',
    h: 'hearts',
    s: 'spades',
  };
  return { rank: s[0] as Card['rank'], suit: map[s[1]]! };
};
const cards = (spec: string): Card[] => spec.trim().split(/\s+/).map(card);

afterEach(() => {
  HorseMind.reset();
});

describe('HorsePlo6FacingBetPricedV2: root-cause fixes for F6 bleed and HVH48 river', () => {
  it('Defect 1 & 2: low-SPR 3-bet flop all-in jam uses tight native six-card big-bucket range (not under40 stab blowup)', () => {
    const hero: SeatPlayer = {
      seat: 2,
      user_id: '00000000-0000-4000-8000-000000000002',
      name: 'hero',
      stack: 40,
      bet: 0,
      totalInvested: 60,
      cards: cards('Kh Qh 9c 8c 4d 2s'),
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
    } as unknown as SeatPlayer;
    const bettor: SeatPlayer = {
      seat: 1,
      user_id: '00000000-0000-4000-8000-000000000001',
      name: 'bettor',
      stack: 0,
      bet: 40,
      totalInvested: 100,
      cards: [],
      is_folded: false,
      is_all_in: true,
      is_sitting_out: false,
    } as unknown as SeatPlayer;
    const gs: HorseGameStateV2 = {
      gameVariant: 'plo6',
      gameMode: 'cash',
      bettingStructure: 'pot_limit',
      stage: 'flop',
      boardCount: 1,
      bombPot: false,
      allInOrFold: false,
      wagersCapped: false,
      rakeConfig: { percent: 0, cap: 0 },
      bigBlind: 2,
      smallBlind: 1,
      dealerSeat: 2,
      pot: 160,
      currentBet: 40,
      toCall: 40,
      minRaiseTo: 80,
      maxRaiseTo: 40,
      communityCards: cards('As Kd 7s'),
      players: [bettor, hero],
      legalActions: ['fold', 'all_in'],
      actionHistory: [
        { userId: 'u1', seat: 1, stage: 'preflop', action: 'raise', amount: 7, timestamp: 1 },
        { userId: 'u2', seat: 2, stage: 'preflop', action: 'raise', amount: 24, timestamp: 2 },
        { userId: 'u1', seat: 1, stage: 'preflop', action: 'raise', amount: 60, timestamp: 3 },
        { userId: 'u2', seat: 2, stage: 'preflop', action: 'call', amount: 36, timestamp: 4 },
        { userId: 'u1', seat: 1, stage: 'flop', action: 'all_in', amount: 40, timestamp: 5 },
      ],
    } as unknown as HorseGameStateV2;

    const spot = plo6V2Spot(hero, gs);
    expect(spot).not.toBeNull();
    expect(spot!.potFrac).toBeCloseTo(40 / 120, 4);
    expect(spot!.isAllInJam).toBe(true);
    expect(spot!.preRaises).toBe(3);
    expect(spot!.bucket).toBe('big');
    expect(spot!.valueShare).toBeLessThan(0.3);
    expect(spot!.priorBluff).toBeLessThan(0.1);

    const v = plo6FacingBetPricedV2(hero, gs, { rake: 0, inPosition: true, realization: 0.9 });
    expect(v).not.toBeNull();
    expect(v!.action).toBe('fold');
    expect(v!.callPriced).toBe(false);
  });

  it('Defect 3: paired-board fold guard is preserved against committing river bet without a boat', () => {
    const hero: SeatPlayer = {
      seat: 2,
      user_id: '00000000-0000-4000-8000-000000000002',
      name: 'hero',
      stack: 120,
      bet: 0,
      totalInvested: 40,
      cards: cards('Ah Kh Qd Jd 9c 8c'),
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
    } as unknown as SeatPlayer;
    const bettor: SeatPlayer = {
      seat: 1,
      user_id: '00000000-0000-4000-8000-000000000001',
      name: 'bettor',
      stack: 80,
      bet: 40,
      totalInvested: 80,
      cards: [],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
    } as unknown as SeatPlayer;
    const gs: HorseGameStateV2 = {
      gameVariant: 'plo6',
      gameMode: 'cash',
      bettingStructure: 'pot_limit',
      stage: 'river',
      boardCount: 1,
      bombPot: false,
      allInOrFold: false,
      wagersCapped: false,
      rakeConfig: { percent: 0, cap: 0 },
      bigBlind: 2,
      smallBlind: 1,
      dealerSeat: 2,
      pot: 120,
      currentBet: 40,
      toCall: 40,
      minRaiseTo: 80,
      maxRaiseTo: 200,
      communityCards: cards('7h 7s 5h 3h 2c'),
      players: [bettor, hero],
      legalActions: ['fold', 'call', 'raise', 'all_in'],
      actionHistory: [
        { userId: 'u1', seat: 1, stage: 'preflop', action: 'raise', amount: 7, timestamp: 1 },
        { userId: 'u2', seat: 2, stage: 'preflop', action: 'call', amount: 5, timestamp: 2 },
        { userId: 'u1', seat: 1, stage: 'flop', action: 'bet', amount: 10, timestamp: 3 },
        { userId: 'u2', seat: 2, stage: 'flop', action: 'call', amount: 10, timestamp: 4 },
        { userId: 'u1', seat: 1, stage: 'turn', action: 'bet', amount: 23, timestamp: 5 },
        { userId: 'u2', seat: 2, stage: 'turn', action: 'call', amount: 23, timestamp: 6 },
        { userId: 'u1', seat: 1, stage: 'river', action: 'bet', amount: 40, timestamp: 7 },
      ],
    } as unknown as HorseGameStateV2;

    const v = plo6FacingBetPricedV2VerdictOf(hero, gs);
    expect(v).not.toBeNull();
    expect(v!.valueShare).toBeLessThan(0.25);
    expect(v!.action).toBe('fold');
    expect(v!.pairedBoardGuardStands).toBe(true);
    expect(v!.callPriced).toBe(false);
  });

  it('Default OFF: unset, false, and truthy non-boolean produce byte-identical decisions on all audit fixtures', () => {
    withFrozenDecisionClock(() => {
      for (const h of FIXTURE.hands) {
        for (const ord of h.ords) {
          const node = h.hand.actions.find(
            (a) => (a as unknown as { ord: number }).ord === ord
          )! as ComplaintAction;
          const st = stateAt(h.hand, node);
          const run = (opts: Record<string, unknown>) => {
            seedFastRandom(7);
            HorseMind.reset();
            return JSON.stringify(
              withoutMeasurements(
                HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
                  mind: false,
                  ...opts,
                } as never)
              )
            );
          };
          const unset = run({});
          expect(run({ plo6FacingBetIsPricedV2: false })).toBe(unset);
          expect(run({ plo6FacingBetIsPricedV2: 'yes' })).toBe(unset);
          expect(run({ plo6FacingBetIsPricedV2: 1 as unknown as boolean })).toBe(unset);
        }
      }
    });
  });

  it('Scope isolation: returns null and decides byte-identically on PLO4, PLO5, NLH, tournament, hi-lo, multi-board, bomb pot, AoF, and fixed-limit', () => {
    const baseHero: SeatPlayer = {
      seat: 2,
      user_id: '00000000-0000-4000-8000-000000000002',
      name: 'hero',
      stack: 120,
      bet: 0,
      totalInvested: 40,
      cards: cards('Ah Kh Qd Jd 9c 8c'),
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
    } as unknown as SeatPlayer;
    const baseBettor: SeatPlayer = {
      seat: 1,
      user_id: '00000000-0000-4000-8000-000000000001',
      name: 'bettor',
      stack: 80,
      bet: 40,
      totalInvested: 80,
      cards: [],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
    } as unknown as SeatPlayer;
    const baseGs: HorseGameStateV2 = {
      gameVariant: 'plo6',
      gameMode: 'cash',
      bettingStructure: 'pot_limit',
      stage: 'river',
      boardCount: 1,
      bombPot: false,
      allInOrFold: false,
      wagersCapped: false,
      rakeConfig: { percent: 0, cap: 0 },
      bigBlind: 2,
      smallBlind: 1,
      dealerSeat: 2,
      pot: 120,
      currentBet: 40,
      toCall: 40,
      minRaiseTo: 80,
      maxRaiseTo: 200,
      communityCards: cards('7h 7s 5h 3h 2c'),
      players: [baseBettor, baseHero],
      legalActions: ['fold', 'call', 'raise', 'all_in'],
      actionHistory: [
        { userId: 'u1', seat: 1, stage: 'preflop', action: 'raise', amount: 7, timestamp: 1 },
        { userId: 'u2', seat: 2, stage: 'preflop', action: 'call', amount: 5, timestamp: 2 },
        { userId: 'u1', seat: 1, stage: 'river', action: 'bet', amount: 40, timestamp: 3 },
      ],
    } as unknown as HorseGameStateV2;

    const cases: Array<{ label: string; hero: SeatPlayer; gs: HorseGameStateV2 }> = [
      {
        label: 'plo4',
        hero: { ...baseHero, cards: cards('Ah Kh Qd Jd') },
        gs: { ...baseGs, gameVariant: 'plo4' },
      },
      {
        label: 'plo5',
        hero: { ...baseHero, cards: cards('Ah Kh Qd Jd 9c') },
        gs: { ...baseGs, gameVariant: 'plo5' },
      },
      {
        label: 'nlh',
        hero: { ...baseHero, cards: cards('Ah Kh') },
        gs: { ...baseGs, gameVariant: 'nlh' },
      },
      {
        label: 'plo6_tournament',
        hero: baseHero,
        gs: { ...baseGs, gameMode: 'tournament' },
      },
      {
        label: 'plo6_hilo',
        hero: baseHero,
        gs: { ...baseGs, variantRules: { splitLow8OrBetter: true } as never },
      },
      {
        label: 'plo6_multiboard',
        hero: baseHero,
        gs: { ...baseGs, boardCount: 2 },
      },
      {
        label: 'plo6_bomb_pot',
        hero: baseHero,
        gs: { ...baseGs, bombPot: true },
      },
      {
        label: 'plo6_aof',
        hero: baseHero,
        gs: { ...baseGs, allInOrFold: true },
      },
      {
        label: 'plo6_fixed_limit',
        hero: baseHero,
        gs: { ...baseGs, bettingStructure: 'fixed_limit' },
      },
    ];

    withFrozenDecisionClock(() => {
      for (const c of cases) {
        const gsWithHero = { ...c.gs, players: [baseBettor, c.hero] } as HorseGameStateV2;
        expect(plo6FacingBetPricedV2Scope(c.hero, gsWithHero), c.label).toBeNull();
        expect(plo6V2Spot(c.hero, gsWithHero), c.label).toBeNull();
        const decide = (opts: Record<string, unknown>) => {
          seedFastRandom(7);
          HorseMind.reset();
          return JSON.stringify(
            withoutMeasurements(
              HorseLogic.decide(c.hero, gsWithHero, LIVE.style, LIVE.mods, {
                mind: false,
                ...opts,
              } as never)
            )
          );
        };
        expect(decide({ plo6FacingBetIsPricedV2: true }), c.label).toBe(decide({}));
      }
    });
  });

  it('Receipt validator admits every V2 decision under plo6FacingBetIsPricedV2: true and refuses V2 fold->call when gate is off', () => {
    const seeds = [1, 7, 42];
    let totalChecked = 0;
    let gatedFoldToCall = 0;
    for (const h of FIXTURE.hands) {
      for (const ord of h.ords) {
        const node = h.hand.actions.find(
          (a) => (a as unknown as { ord: number }).ord === ord
        )! as ComplaintAction;
        const st = stateAt(h.hand, node);
        for (const seed of seeds) {
          seedFastRandom(seed);
          HorseMind.reset();
          const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
            mind: false,
            plo6FacingBetIsPricedV2: true,
          });
          totalChecked++;
          const baseCtx = { player: st.hero, gameState: st.gs };
          expect(
            horseDecisionReceiptRefusal(structuredClone(d), 'plo6', {
              ...baseCtx,
              plo6FacingBetIsPricedV2: true,
            })
          ).toBeNull();
          expect(
            horseDecisionReceiptRefusalForGates(
              structuredClone(d),
              'plo6',
              baseCtx,
              [false],
              [false],
              [false],
              [false],
              [false],
              [false],
              [false],
              [true]
            )
          ).toBeNull();

          const graph = (d as { policyGraph?: { transitions: Array<Record<string, unknown>> } })
            .policyGraph;
          const wagerNode = graph?.transitions.find((t) => t.node === 'wager_rules');
          const before = wagerNode?.before as { action?: string } | null | undefined;
          const after = wagerNode?.after as { action?: string } | undefined;
          if (
            after?.action === 'call' &&
            before &&
            ['fold', 'raise', 'all_in'].includes(String(before.action))
          ) {
            const refusalOff = horseDecisionReceiptRefusal(structuredClone(d), 'plo6', baseCtx);
            if (refusalOff !== null) {
              gatedFoldToCall++;
              expect(
                horseDecisionReceiptRefusalForGates(
                  structuredClone(d),
                  'plo6',
                  baseCtx,
                  [false],
                  [false],
                  [false],
                  [false],
                  [false],
                  [false],
                  [false],
                  [false]
                )
              ).not.toBeNull();
            }
          }
        }
      }
    }
    expect(totalChecked).toBeGreaterThanOrEqual(36);
    expect(gatedFoldToCall).toBeGreaterThan(0);

    expect(OPTION_SWITCH_PLAIN_NAMES).toContain('plo6FacingBetIsPricedV2');
    expect(OPTION_SWITCH_SHADOW_NAMES).toContain('plo6FacingBetIsPricedV2');
    expect(OPTION_SWITCH_ON_SHADOW_NAMES).toContain('plo6FacingBetIsPricedV2');
    expect(plo6FacingBetIsPricedV2GateCandidates(undefined, null)).toEqual([false]);
    expect(plo6FacingBetIsPricedV2GateCandidates({ plo6FacingBetIsPricedV2: false }, null)).toEqual(
      [false]
    );
    expect(plo6FacingBetIsPricedV2GateCandidates({ plo6FacingBetIsPricedV2: true }, null)).toEqual([
      true,
    ]);
    // Registered v2 live switch config emits true/false candidates matching V1 plo6FacingBetIsPricedGateCandidates.
    const cfgOn = {
      version: 2,
      style: { version: 1, options: {} },
      options: { plo6FacingBetIsPricedV2: 'on' },
    };
    const cfgOff = {
      version: 2,
      style: { version: 1, options: {} },
      options: { plo6FacingBetIsPricedV2: 'off' },
    };
    expect(plo6FacingBetIsPricedV2GateCandidates(undefined, cfgOn, cfgOff)).toEqual([true, false]);
    expect(plo6FacingBetIsPricedV2GateCandidates({ plo6FacingBetIsPricedV2: true }, cfgOn)).toEqual(
      [true]
    );
    expect(plo6FacingBetIsPricedV2GateCandidates(undefined, cfgOff)).toEqual([false]);
    // Malformed switch config (missing version/style) fails closed to [false].
    expect(
      plo6FacingBetIsPricedV2GateCandidates(undefined, {
        options: { plo6FacingBetIsPricedV2: 'on' },
      })
    ).toEqual([false]);
  });

  it('V2-river-fold-only: all-street fold->call and river call->fold fire, while standing flop/turn calls are never folded by V2', () => {
    const byHand = (hn: number) => {
      const h = FIXTURE.hands.find(
        (x) => Number((x.hand as unknown as { handNumber: number }).handNumber) === hn
      );
      if (!h) throw new Error(`missing fixture hand ${hn}`);
      const ord = h.ords[0]!;
      const node = h.hand.actions.find(
        (a) => (a as unknown as { ord: number }).ord === ord
      )! as ComplaintAction;
      return stateAt(h.hand, node);
    };
    const decideKind = (st: ReturnType<typeof stateAt>, v2: boolean) => {
      seedFastRandom(1);
      HorseMind.reset();
      const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
        mind: false,
        ...(v2 ? { plo6FacingBetIsPricedV2: true } : {}),
      });
      return actionKind(d.action, d.amount, st.pn);
    };

    // All-street fold -> call fires on flop (#60067736), turn (#59973455), and river (#59974054).
    for (const hn of [60067736, 59973455, 59974054]) {
      const st = byHand(hn);
      expect(decideKind(st, false)).toBe('fold');
      expect(decideKind(st, true)).toBe('call');
    }

    // River call -> fold fires on dominated underboat (#59973335).
    const riverDom = byHand(59973335);
    expect(decideKind(riverDom, false)).toBe('call');
    expect(decideKind(riverDom, true)).toBe('fold');

    // Standing flop/turn call is NOT downgraded to fold even when V2 marks foldPriced = true.
    const flopStandingCallHero: SeatPlayer = {
      seat: 2,
      user_id: '00000000-0000-4000-8000-000000000002',
      name: 'hero',
      stack: 190,
      bet: 0,
      totalInvested: 10,
      cards: cards('As Kc Qd Jc 9d 4c'),
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
    } as unknown as SeatPlayer;
    const flopBettor: SeatPlayer = {
      seat: 1,
      user_id: '00000000-0000-4000-8000-000000000001',
      name: 'bettor',
      stack: 182,
      bet: 8,
      totalInvested: 18,
      cards: [],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
    } as unknown as SeatPlayer;
    const flopGs: HorseGameStateV2 = {
      gameVariant: 'plo6',
      gameMode: 'cash',
      bettingStructure: 'pot_limit',
      stage: 'flop',
      boardCount: 1,
      bombPot: false,
      allInOrFold: false,
      wagersCapped: false,
      rakeConfig: { percent: 0, cap: 0 },
      bigBlind: 2,
      smallBlind: 1,
      dealerSeat: 2,
      pot: 28,
      currentBet: 8,
      toCall: 8,
      minRaiseTo: 16,
      maxRaiseTo: 44,
      communityCards: cards('Ah 8s 3h'),
      players: [flopBettor, flopStandingCallHero],
      legalActions: ['fold', 'call', 'raise', 'all_in'],
      actionHistory: [
        { userId: 'u1', seat: 1, stage: 'preflop', action: 'raise', amount: 7, timestamp: 1 },
        { userId: 'u2', seat: 2, stage: 'preflop', action: 'call', amount: 5, timestamp: 2 },
        { userId: 'u1', seat: 1, stage: 'flop', action: 'bet', amount: 8, timestamp: 3 },
      ],
    } as unknown as HorseGameStateV2;

    const flopV2Verdict = plo6FacingBetPricedV2VerdictOf(flopStandingCallHero, flopGs);
    expect(flopV2Verdict).not.toBeNull();
    expect(flopV2Verdict!.foldPriced).toBe(true);
    seedFastRandom(1);
    HorseMind.reset();
    const baseFlop = HorseLogic.decide(flopStandingCallHero, flopGs, LIVE.style, LIVE.mods, {
      mind: false,
    });
    seedFastRandom(1);
    HorseMind.reset();
    const v2Flop = HorseLogic.decide(flopStandingCallHero, flopGs, LIVE.style, LIVE.mods, {
      mind: false,
      plo6FacingBetIsPricedV2: true,
    });
    expect(baseFlop.action).toBe('call');
    expect(v2Flop.action).toBe('call');
  });
});
