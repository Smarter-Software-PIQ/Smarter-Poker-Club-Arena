/**
 * Regression suite for all 5 live PLO5 defects surfaced on 2026-11-16
 * (#59717970, #59719509, #59694892, #59725321, #59728213, #59728571, #59730132):
 *  - BUG-1: 1 BB ($2) postflop leads in single-board PLO5/PLO6 cash (joint_policy),
 *    multi-board bomb pots (jointSelectedRow), Phase 7 tournaments, and undersized
 *    strong-hand river/turn bets (omahaStrongHandValue).
 *  - BUG-2 (#59725321): non-final paired-turn call with 0 full-house/quad outs
 *    facing a >=40%-pot bet when villain has river barrel chips behind.
 *  - BUG-3 (#59728213): OOP 4-bet call at low post-call SPR (<=2.5) with non-AA
 *    paired KKxx / dominated key card that auto-folds bare overpairs on the flop.
 *  - BUG-3B (#59728571): sandwiched BB cold-calling an SB 3-bet with live EP/MP
 *    openers/callers acting behind BB postflop (while keeping postflop 13-nut-out
 *    turn peel + missed-river fold intact).
 *  - BUG-4 (#59730132): calling a >=40%-pot paired-river donk-lead into the turn
 *    aggressor after villain check-called earlier street(s).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { evaluateJointLivePolicy, jointSelectedRow } from './multiway/JointLivePolicy.js';
import { JOINT_SELECTION_RULE, jointSingleBoardCashActs } from './multiway/JointActionModel.js';
import { jointPolicyFixture } from './multiway/JointRangeFixture.test-support.js';
import {
  omahaStrongHandValueDecision,
  type OmahaStrongHandValueReads,
} from './HorseOmahaStrongHandValue.js';
import {
  omahaFacingBetEvSpot,
  omahaFacingBetEvVerdict,
  type OmahaFacingBetEvRead,
} from './HorseOmahaFacingBetEv.js';
import { omahaOopReraisedCallCell } from './HorseOmahaOopReraisedPot.js';
import {
  evaluateTournamentUtilityDetailed,
  type TournamentUtilityContext,
  type TournamentUtilityInput,
} from './HorseTournamentUtility.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import { calculatePots } from './PokerEngine.js';
import type { ActionRecord, Card, HorseDecision, SeatPlayer } from '../types.js';

const c = (s: string): Card => ({
  rank: s[0] as Card['rank'],
  suit: ({ c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' } as const)[
    s[1] as 'c' | 'd' | 'h' | 's'
  ],
});
const cards = (spec: string): Card[] => spec.trim().split(/\s+/).map(c);

const VALUE_LEADER_READ: OmahaFacingBetEvRead = {
  measured: true,
  betCheckedToRatio: 0.7675,
  postflopManiac: false,
  valueLeader: true,
  sizeShown: null,
};

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

describe('Live PLO5 Madness regressions (#59717970, #59725321, #59728213, #59728571, #59730132)', () => {
  it('BUG-1A: keeps the variant brain in single-board PLO5 and PLO6 cash (#59717970 turn 888AA)', () => {
    expect(JOINT_SELECTION_RULE.singleBoardCashKeepsVariantBrain).toEqual([
      'nlh',
      'plo4',
      'plo5',
      'plo6',
    ]);
    for (const v of ['nlh', 'plo4', 'plo5', 'plo6'] as const) {
      expect(jointSingleBoardCashActs(v)).toBe(false);
    }
    const { hero, state } = jointPolicyFixture('plo5', 1, 'cash', 'turn');
    hero.cards = cards('Ad 5d 7c 8s Th');
    state.communityCards = cards('Qs 8c 8h Ac');
    seedFastRandom(59717970);
    const baseline: HorseDecision = { action: 'check', thinkTime: 0 };
    const res = evaluateJointLivePolicy(hero, state, baseline, 'candidate', () => 0);
    expect(res.receipt.fired).toBe(true);
    expect(res.receipt.changed).toBe(false);
    expect(res.receipt.applied).toBe(false);
    expect(res.decision).toEqual(baseline);
  });

  it('BUG-1B: never selects an unforced <25%-pot 1 BB bet on multi-board bomb pots (#59719509)', () => {
    const { hero, state } = jointPolicyFixture('plo5', 2, 'cash', 'flop');
    state.pot = 36;
    state.bigBlind = 2;
    state.currentBet = 0;
    state.toCall = 0;
    state.minRaiseTo = 2;
    state.maxRaiseTo = 36;
    state.bettingStructure = 'pot_limit';
    const model = {
      baselineCandidateId: 'check',
      candidates: [
        { id: 'check', action: 'check', amount: null, pairedEdge: 0, pairedStandardError: 0 },
        { id: 'bet:2', action: 'bet', amount: 2, pairedEdge: 2.5, pairedStandardError: 0.2 },
        { id: 'bet:18', action: 'bet', amount: 18, pairedEdge: 8, pairedStandardError: 3.2 },
      ],
    } as unknown as Parameters<typeof jointSelectedRow>[0];
    const chosen = jointSelectedRow(model, hero, state)!;
    expect(chosen.id).toBe('bet:18');
  });

  it('BUG-1B: never selects an unforced <25%-pot 1 BB postflop bet in Phase 7 tournament utility', () => {
    const hero: SeatPlayer = {
      seat: 1,
      user_id: 'hero',
      username: 'hero',
      stack: 900,
      bet: 0,
      totalInvested: 100,
      cards: cards('As Ah Ks Kh Qd'),
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
    };
    const villain: SeatPlayer = {
      seat: 2,
      user_id: 'villain',
      username: 'villain',
      stack: 900,
      bet: 0,
      totalInvested: 100,
      cards: [],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
    };
    const players = [hero, villain];
    const ctx: TournamentUtilityContext = {
      format: 'mtt',
      playersLeft: 2,
      spotsPaid: 1,
      satellite: false,
      satelliteSeats: 0,
      payoutPct: [100],
      fieldStacks: [1000, 1000],
      fieldStackByUser: { hero: 1000, villain: 1000 },
      isPko: false,
      isBounty: false,
      isMysteryBounty: false,
      mysteryBountyStage: 'none',
      bountyFactor: 0,
      bountyByUser: {},
      mysteryMeanCents: 0,
      meanBountyCents: 0,
      prizePoolCents: 10_000,
      bountyPoolCents: 0,
      reentryOpen: false,
      rebuyOpen: false,
      maxReentries: 0,
      maxRebuys: 0,
      addOnPeriodOpen: false,
      addOnCostCents: null,
      addOnChips: null,
      buyInCents: null,
      startingStackChips: null,
      rebuyCostCents: null,
      rebuyChips: null,
      rebuyPrizeContributionCents: null,
      rebuyBountyContributionCents: null,
      reloadsUsed: 0,
      addOnTaken: false,
      rebuyAffordable: false,
      addOnAffordable: false,
    };
    const samples: TournamentUtilityInput['showdownSamples'] = Array.from(
      { length: 48 },
      (_, idx) => ({
        boards: [
          {
            heroHigh: idx < 42 ? 2 : 1,
            opponentHigh: [idx < 42 ? 1 : 2],
            opponentDecisionStrength: [0.4],
            heroLow: null,
            opponentLow: [null],
          },
        ],
      })
    );
    const input: TournamentUtilityInput = {
      street: 'turn',
      bettingStructure: 'pot_limit',
      hero,
      players,
      pots: calculatePots(players),
      pot: 200,
      currentBet: 0,
      toCall: 0,
      legalActions: ['check', 'bet'],
      minRaiseTo: 20,
      maxRaiseTo: 200,
      baseline: { action: 'check', thinkTime: 0 },
      heroEquity: 0.875,
      equitySampleSize: 48,
      equityStandardError: 0.03,
      opponents: [{ userId: 'villain', range: [0, 1], foldMul: 1, actsAfterHero: true }],
      sampledOpponentIds: ['villain'],
      showdownSamples: samples,
      context: ctx,
    };
    const evalRes = evaluateTournamentUtilityDetailed(input);
    expect(evalRes.unavailableReason).toBeNull();
    if (evalRes.result!.decision.action === 'bet') {
      expect(evalRes.result!.decision.amount).toBeGreaterThanOrEqual(50);
    }
  });

  it('BUG-1C: re-prices an undersized 1 BB river full-house bet into a real value bet (#59694892 KKKAA into $204)', () => {
    const hero: SeatPlayer = {
      seat: 5,
      user_id: '0362d601-0000-4000-8000-000000000005',
      username: 'RAKEHAWK',
      stack: 400,
      bet: 0,
      totalInvested: 102,
      cards: cards('9d Ah 5h 8d Kh'),
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
    };
    const opp: SeatPlayer = {
      seat: 2,
      user_id: '11111111-0000-4000-8000-000000000002',
      username: 'V2',
      stack: 400,
      bet: 0,
      totalInvested: 102,
      cards: [],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
    };
    const gs = {
      stateSchemaVersion: 1,
      gameVariant: 'plo5',
      gameMode: 'cash',
      bettingStructure: 'pot_limit',
      stage: 'river',
      pot: 204,
      bigBlind: 2,
      smallBlind: 1,
      currentBet: 0,
      toCall: 0,
      minRaiseTo: 2,
      maxRaiseTo: 204,
      legalActions: ['check', 'bet', 'all_in'],
      dealerSeat: 5,
      communityCards: cards('Kd 7s Ac 5d Kc'),
      players: [{ ...hero, cards: [] }, opp],
      actionHistory: [
        { stage: 'river', seat: 2, userId: opp.user_id, action: 'check', amount: 0, timestamp: 1 },
      ] as ActionRecord[],
    } as unknown as HorseGameStateV2;

    const reads: OmahaStrongHandValueReads = {
      conditional: () => null,
      facingBet: () => null,
      rake: 0,
    };
    const res = omahaStrongHandValueDecision(
      { action: 'bet', amount: 2, thinkTime: 0 },
      hero,
      gs,
      reads
    );
    expect(res.priced).toBe(true);
    expect(res.changed).toBe('value_bet');
    expect(res.decision.action).toBe('bet');
    expect(res.decision.amount).toBeGreaterThanOrEqual(67);

    seedFastRandom(59694892);
    const live = structuredClone(
      HorseLogic.decide(
        hero,
        gs,
        'balanced',
        {},
        {
          mind: false,
          telemetry: false,
          omahaStrongHandValue: true,
        }
      )
    );
    expect(live.action).toBe('bet');
    expect(live.amount).toBeGreaterThanOrEqual(67);
    expect(horseDecisionReceiptRefusal(live, 'plo5', { player: hero, gameState: gs })).toBeNull();
  });

  it('BUG-2 (#59725321): folds non-final paired turn with 0 full-house outs instead of calling $55 to fold blank rivers', () => {
    const hero: SeatPlayer = {
      seat: 4,
      user_id: '22222222-0000-4000-8000-000000000004',
      username: 'MrFox',
      stack: 382,
      bet: 0,
      totalInvested: 55,
      cards: cards('As Kc Ts 4c 7c'),
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
    };
    const villain: SeatPlayer = {
      seat: 2,
      user_id: '33333333-0000-4000-8000-000000000002',
      username: 'V2',
      stack: 1100,
      bet: 55,
      totalInvested: 110,
      cards: [],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
    };
    const gs = {
      stateSchemaVersion: 1,
      gameVariant: 'plo5',
      gameMode: 'cash',
      bettingStructure: 'pot_limit',
      stage: 'turn',
      pot: 165,
      bigBlind: 2,
      smallBlind: 1,
      currentBet: 55,
      toCall: 55,
      minRaiseTo: 110,
      maxRaiseTo: 275,
      legalActions: ['fold', 'call', 'raise', 'all_in'],
      dealerSeat: 4,
      communityCards: cards('5s 8s 6c 6s'),
      players: [villain, hero],
      actionHistory: [
        {
          stage: 'flop',
          seat: 2,
          userId: villain.user_id,
          action: 'bet',
          amount: 36,
          isFullRaise: true,
          timestamp: 1,
        },
        { stage: 'flop', seat: 4, userId: hero.user_id, action: 'call', amount: 36, timestamp: 2 },
        {
          stage: 'turn',
          seat: 2,
          userId: villain.user_id,
          action: 'bet',
          amount: 55,
          isFullRaise: true,
          timestamp: 3,
        },
      ] as ActionRecord[],
    } as unknown as HorseGameStateV2;

    const spot = omahaFacingBetEvSpot(hero, gs)!;
    expect(spot.final).toBe(false);
    expect(spot.bettorCanBarrelRiver).toBe(true);
    const vUnknown = omahaFacingBetEvVerdict(spot, hero.cards, gs.communityCards, [], null, {
      realization: 0.9,
    })!;
    expect(vUnknown.realization).toBeLessThanOrEqual(0.42);
    expect(vUnknown.call).toBe(false);

    const vLeader = omahaFacingBetEvVerdict(
      spot,
      hero.cards,
      gs.communityCards,
      [],
      VALUE_LEADER_READ,
      { realization: 0.9 }
    )!;
    expect(vLeader.call).toBe(false);

    vi.spyOn(HorseMind, 'omahaFacingBetEvReadOf').mockImplementation(() => VALUE_LEADER_READ);
    seedFastRandom(59725321);
    const d = structuredClone(
      HorseLogic.decide(hero, gs, 'balanced', {}, {
        observeMind: false,
        omahaFacingBetEv: true,
        omahaPairedBoardFoldRespectsPrice: true,
      } as never)
    );
    expect(d.action).toBe('fold');
    expect(horseDecisionReceiptRefusal(d, 'plo5', { player: hero, gameState: gs })).toBeNull();
  });

  it('BUG-3 (#59728213): folds KKxx double-suited + single A OOP facing a pot 4-bet to SPR 1.60 instead of calling $147 to check-fold flop', () => {
    const hole = cards('Kh Js 9h Ks As');
    // Even with a loose raiser band (lo < 0.86), OOP 4-bet call at SPR 1.60 with KK + single A folds.
    const verdict = omahaOopReraisedCallCell({
      variant: 'plo5',
      hole,
      dead: [],
      outOfPosition: true,
      preflopRaises: 3,
      toCall: 147,
      stack: 854.1,
      pot: 294,
      band: [0.42, 1],
      hiLo: false,
      multiBoard: false,
      bombPot: false,
      tournament: false,
      allInOrFold: false,
    })!;
    expect(verdict.fold).toBe(true);
    expect(verdict.sprAfter).toBeCloseTo(707.1 / 441, 4);

    const hero: SeatPlayer = {
      seat: 1,
      user_id: 'ac4873a3-0000-4000-8000-000000000001',
      username: 'TaliaK',
      stack: 854.1,
      bet: 58,
      totalInvested: 58,
      cards: hole,
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
    };
    const utg: SeatPlayer = {
      seat: 3,
      user_id: '44444444-0000-4000-8000-000000000003',
      username: 'UTG4B',
      stack: 900,
      bet: 205,
      totalInvested: 205,
      cards: [],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
    };
    const gs = {
      stateSchemaVersion: 1,
      gameVariant: 'plo5',
      gameMode: 'cash',
      bettingStructure: 'pot_limit',
      stage: 'preflop',
      pot: 294,
      bigBlind: 2,
      smallBlind: 1,
      currentBet: 205,
      toCall: 147,
      minRaiseTo: 352,
      maxRaiseTo: 646,
      legalActions: ['fold', 'call', 'raise', 'all_in'],
      dealerSeat: 6,
      communityCards: [],
      players: [hero, utg],
      actionHistory: [
        { stage: 'preflop', seat: 1, userId: hero.user_id, action: 'sb', amount: 1, timestamp: 1 },
        {
          stage: 'preflop',
          seat: 3,
          userId: utg.user_id,
          action: 'raise',
          amount: 9,
          isFullRaise: true,
          timestamp: 2,
        },
        {
          stage: 'preflop',
          seat: 1,
          userId: hero.user_id,
          action: 'raise',
          amount: 58,
          isFullRaise: true,
          timestamp: 3,
        },
        {
          stage: 'preflop',
          seat: 3,
          userId: utg.user_id,
          action: 'raise',
          amount: 205,
          isFullRaise: true,
          timestamp: 4,
        },
      ] as ActionRecord[],
    } as unknown as HorseGameStateV2;

    seedFastRandom(59728213);
    const d = structuredClone(
      HorseLogic.decide(
        hero,
        gs,
        'balanced',
        {},
        {
          mind: false,
          omahaOopReraisedPotStrongRange: true,
        }
      )
    );
    expect(d.action).not.toBe('call');
    expect(horseDecisionReceiptRefusal(d, 'plo5', { player: hero, gameState: gs })).toBeNull();
  });

  it('BUG-3B (#59728571): folds sandwiched BB uncoordinated cold-call preflop while preserving 13-nut-out turn peel + brick river fold', () => {
    const hole = cards('Ks 7s Ah 4h Jc');
    // dealerSeat = 2 -> SB = 3 (3-bet $36), BB = 4 (hero), UTG = 5 (opened $8), CO = 1 (called $8)
    const co: SeatPlayer = {
      seat: 1,
      user_id: '10000001-0000-4000-8000-000000000001',
      username: 'CO',
      stack: 699.1,
      bet: 8,
      totalInvested: 8,
      cards: [],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
    };
    const sb: SeatPlayer = {
      seat: 3,
      user_id: '10000003-0000-4000-8000-000000000003',
      username: 'SB3B',
      stack: 900,
      bet: 36,
      totalInvested: 36,
      cards: [],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
    };
    const hero: SeatPlayer = {
      seat: 4,
      user_id: '33ce9b58-0000-4000-8000-000000000004',
      username: 'Utg Chad',
      stack: 396,
      bet: 2,
      totalInvested: 4,
      cards: hole,
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
    };
    const utg: SeatPlayer = {
      seat: 5,
      user_id: '10000005-0000-4000-8000-000000000005',
      username: 'UTGOpen',
      stack: 1550.7,
      bet: 8,
      totalInvested: 8,
      cards: [],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
    };
    const preGs = {
      stateSchemaVersion: 1,
      gameVariant: 'plo5',
      gameMode: 'cash',
      bettingStructure: 'pot_limit',
      stage: 'preflop',
      pot: 56,
      bigBlind: 2,
      smallBlind: 1,
      currentBet: 36,
      toCall: 34,
      minRaiseTo: 64,
      maxRaiseTo: 126,
      legalActions: ['fold', 'call', 'raise', 'all_in'],
      dealerSeat: 2,
      communityCards: [],
      players: [co, sb, hero, utg],
      actionHistory: [
        { stage: 'preflop', seat: 3, userId: sb.user_id, action: 'sb', amount: 1, timestamp: 1 },
        { stage: 'preflop', seat: 4, userId: hero.user_id, action: 'bb', amount: 2, timestamp: 2 },
        {
          stage: 'preflop',
          seat: 5,
          userId: utg.user_id,
          action: 'raise',
          amount: 8,
          isFullRaise: true,
          timestamp: 3,
        },
        { stage: 'preflop', seat: 1, userId: co.user_id, action: 'call', amount: 8, timestamp: 4 },
        {
          stage: 'preflop',
          seat: 3,
          userId: sb.user_id,
          action: 'raise',
          amount: 36,
          isFullRaise: true,
          timestamp: 5,
        },
      ] as ActionRecord[],
    } as unknown as HorseGameStateV2;

    for (const s of [1, 2, 3, 59728571]) {
      seedFastRandom(s);
      const pre = structuredClone(
        HorseLogic.decide(
          hero,
          preGs,
          'balanced',
          {},
          {
            mind: false,
            omahaOopReraisedPotStrongRange: true,
          }
        )
      );
      expect(pre.action).toBe('fold');
      expect(
        horseDecisionReceiptRefusal(pre, 'plo5', { player: hero, gameState: preGs })
      ).toBeNull();
    }

    // Postflop soundness check: on turn 4c Ad Th 8h (AA44 + Ah4h NFD = 13 nut outs),
    // calling $118 pot bet stays +EV, and brick river 7d folds cleanly.
    const turnHero: SeatPlayer = { ...hero, stack: 362, bet: 0, totalInvested: 38 };
    const turnSb: SeatPlayer = { ...sb, stack: 782, bet: 118, totalInvested: 154 };
    const turnGs = {
      ...preGs,
      stage: 'turn',
      pot: 236,
      currentBet: 118,
      toCall: 118,
      minRaiseTo: 236,
      maxRaiseTo: 362,
      communityCards: cards('4c Ad Th 8h'),
      players: [turnSb, turnHero],
      actionHistory: [
        { stage: 'flop', seat: 3, userId: sb.user_id, action: 'check', amount: 0, timestamp: 6 },
        { stage: 'flop', seat: 4, userId: hero.user_id, action: 'check', amount: 0, timestamp: 7 },
        {
          stage: 'turn',
          seat: 3,
          userId: sb.user_id,
          action: 'bet',
          amount: 118,
          isFullRaise: true,
          timestamp: 8,
        },
      ] as ActionRecord[],
    } as unknown as HorseGameStateV2;
    const turnSpot = omahaFacingBetEvSpot(turnHero, turnGs)!;
    const turnVerdict = omahaFacingBetEvVerdict(
      turnSpot,
      hole,
      turnGs.communityCards,
      [],
      VALUE_LEADER_READ,
      { realization: 0.9 }
    )!;
    expect(turnVerdict.call).toBe(true);
  });

  it('BUG-4 (#59730132): folds Ac5c Nut Flush facing a $415 paired-river donk-lead into the 2-street aggressor after flop+turn check-calls', () => {
    const hero: SeatPlayer = {
      seat: 4,
      user_id: '2430ef3a-0000-4000-8000-000000000004',
      username: 'draw888',
      stack: 559.25,
      bet: 0,
      totalInvested: 374,
      cards: cards('Qs Td Ac Jd 5c'),
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
    };
    const sb: SeatPlayer = {
      seat: 3,
      user_id: '55555555-0000-4000-8000-000000000003',
      username: 'SBDonk',
      stack: 319.5,
      bet: 415,
      totalInvested: 787,
      cards: [],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
    };
    const gs = {
      stateSchemaVersion: 1,
      gameVariant: 'plo5',
      gameMode: 'cash',
      bettingStructure: 'pot_limit',
      stage: 'river',
      pot: 1245,
      bigBlind: 2,
      smallBlind: 1,
      currentBet: 415,
      toCall: 415,
      minRaiseTo: null,
      maxRaiseTo: null,
      legalActions: ['fold', 'call', 'all_in'],
      dealerSeat: 2,
      communityCards: cards('8c Kc 2c 5d 5h'),
      players: [sb, hero],
      actionHistory: [
        { stage: 'preflop', seat: 3, userId: sb.user_id, action: 'call', amount: 7, timestamp: 1 },
        {
          stage: 'preflop',
          seat: 4,
          userId: hero.user_id,
          action: 'raise',
          amount: 42,
          isFullRaise: true,
          timestamp: 2,
        },
        { stage: 'preflop', seat: 3, userId: sb.user_id, action: 'call', amount: 34, timestamp: 3 },
        { stage: 'flop', seat: 3, userId: sb.user_id, action: 'check', amount: 0, timestamp: 4 },
        {
          stage: 'flop',
          seat: 4,
          userId: hero.user_id,
          action: 'bet',
          amount: 96,
          isFullRaise: true,
          timestamp: 5,
        },
        { stage: 'flop', seat: 3, userId: sb.user_id, action: 'call', amount: 96, timestamp: 6 },
        { stage: 'turn', seat: 3, userId: sb.user_id, action: 'check', amount: 0, timestamp: 7 },
        {
          stage: 'turn',
          seat: 4,
          userId: hero.user_id,
          action: 'bet',
          amount: 234,
          isFullRaise: true,
          timestamp: 8,
        },
        { stage: 'turn', seat: 3, userId: sb.user_id, action: 'call', amount: 234, timestamp: 9 },
        {
          stage: 'river',
          seat: 3,
          userId: sb.user_id,
          action: 'bet',
          amount: 415,
          isFullRaise: true,
          timestamp: 10,
        },
      ] as ActionRecord[],
    } as unknown as HorseGameStateV2;

    const spot = omahaFacingBetEvSpot(hero, gs)!;
    expect(spot.aggressorStreets).toBe(0);
    expect(spot.callerStreets).toBe(2);
    expect(spot.valueShare).toBeLessThanOrEqual(0.08);
    expect(spot.priorBluff).toBe(0.08);

    const vUnknown = omahaFacingBetEvVerdict(spot, hero.cards, gs.communityCards, [], null)!;
    expect(vUnknown.call).toBe(false);
    expect(vUnknown.ev).toBeLessThan(-100);

    const vLeader = omahaFacingBetEvVerdict(
      spot,
      hero.cards,
      gs.communityCards,
      [],
      VALUE_LEADER_READ
    )!;
    expect(vLeader.call).toBe(false);

    vi.spyOn(HorseMind, 'omahaFacingBetEvReadOf').mockImplementation(() => VALUE_LEADER_READ);
    seedFastRandom(59730132);
    const d = structuredClone(
      HorseLogic.decide(hero, gs, 'balanced', {}, {
        observeMind: false,
        omahaFacingBetEv: true,
        omahaPairedBoardFoldRespectsPrice: true,
        omahaStreetPlan: true,
      } as never)
    );
    expect(d.action).toBe('fold');
    expect(horseDecisionReceiptRefusal(d, 'plo5', { player: hero, gameState: gs })).toBeNull();

    // Hole 2 check: even with omahaFacingBetEv OFF, omahaPairedBoardFoldRespectsPrice
    // does not bypass ploPairedBoardMustFold on a paired-river >=40%-pot donk-lead
    // into the turn aggressor after check-calling.
    seedFastRandom(59730132);
    const cf = structuredClone(
      HorseLogic.decide(hero, gs, 'balanced', {}, {
        observeMind: false,
        omahaFacingBetEv: false,
        omahaPairedBoardFoldRespectsPrice: true,
      } as never)
    );
    expect(cf.action).toBe('fold');
    expect(horseDecisionReceiptRefusal(cf, 'plo5', { player: hero, gameState: gs })).toBeNull();
  });
});
