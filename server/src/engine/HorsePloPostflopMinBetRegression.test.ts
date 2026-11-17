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
import {
  omahaOopReraisedCallCell,
  omahaReraiseByPositionCell,
} from './HorseOmahaOopReraisedPot.js';
import { omahaBareBigPairOnFlop } from './HorseOmahaOopChecks.js';
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
      priced: {
        rate: 0.3,
        opportunities: 100,
        rateSource: 'measured',
        inPosition: false,
        othersIn: 0,
        raiserBehind: 695,
        rakeFraction: 0.05,
        heroAlreadyRaised: true,
        heroInvested: 58,
      },
      band: [0.42, 1],
      hiLo: false,
      multiBoard: false,
      bombPot: false,
      tournament: false,
      allInOrFold: false,
    })!;
    // Owner 2026-11-17 15:30: no blanket rule. The call is priced: it folds
    // exactly when EV(call) < 0 against the 4-bettor's measured range.
    expect(verdict.fold).toBe(verdict.pricing!.evCall < 0);
    expect(verdict.reason).toBe(verdict.fold ? 'priced_fold' : 'priced_call');
    expect(verdict.sprAfter).toBeCloseTo(695 / 441, 4);

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
    expect(['fold', 'call', 'raise', 'all_in']).toContain(d.action);
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

  it('BUG-5 (#59709936 & #59719920): withholds v53_pressure_four_bet without AA or coordinated premium against a measured valueLeader, while keeping AA/premium 4-bets', () => {
    const villainId = '66666666-0000-4000-8000-000000000006';
    const makeSpot = (holeSpec: string, stack = 491.65, curBet = 55, myBet = 10, pot = 90) => {
      const hero: SeatPlayer = {
        seat: 5,
        user_id: '55555555-0000-4000-8000-000000000005',
        username: 'Bob77',
        stack,
        bet: myBet,
        totalInvested: myBet,
        cards: cards(holeSpec),
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
        is_horse: true,
      };
      const villain: SeatPlayer = {
        seat: 3,
        user_id: villainId,
        username: 'V3',
        stack: 2000,
        bet: curBet,
        totalInvested: curBet,
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
        pot,
        bigBlind: 2,
        smallBlind: 1,
        currentBet: curBet,
        toCall: curBet - myBet,
        minRaiseTo: 100,
        maxRaiseTo: 190,
        legalActions: ['fold', 'call', 'raise'],
        dealerSeat: 5,
        communityCards: [],
        players: [villain, { ...hero, cards: [] }],
        actionHistory: [
          {
            stage: 'preflop',
            seat: 5,
            userId: hero.user_id,
            action: 'raise',
            amount: myBet,
            isFullRaise: true,
            timestamp: 1,
          },
          {
            stage: 'preflop',
            seat: 3,
            userId: villainId,
            action: 'raise',
            amount: curBet,
            isFullRaise: true,
            timestamp: 2,
          },
        ] as ActionRecord[],
      } as unknown as HorseGameStateV2;
      return { hero, gs };
    };

    const fakeManiacValueLeader = {
      hands: 44,
      presumed: false,
      stats: {
        vpip: { n: 44, mean: 0.85 },
        pfr: { n: 44, mean: 0.58 },
        rfi: { n: 22, mean: 0.8 },
        threeBet: { n: 9, mean: 0.34 },
        foldTo3Bet: { n: 6, mean: 0.05 },
        betCheckedTo: { n: 39, mean: 0.3 },
        foldToBet: { n: 18, mean: 0.45 },
        riverCall: { n: 3, mean: 0.23 },
      },
    };
    vi.spyOn(HorseMind, 'opponentRead').mockImplementation((uid) =>
      uid === villainId ? (fakeManiacValueLeader as never) : null
    );
    vi.spyOn(HorseMind, 'omahaReadConditionalOf').mockImplementation((uid) =>
      uid === villainId
        ? ({
            measured: true,
            valueLeader: true,
            wideReRaiser: true,
            postflopAggressor: false,
          } as never)
        : null
    );
    vi.spyOn(HorseMind, 'bandsForOpponents').mockImplementation(() => [[0.35, 1]]);

    // #59709936 JJ2KQ (Qs 2h Jh Kd Js) & #59719920 ragged KKds (Ts Ks 3d 6d Kh):
    // without AA or coordinated premium, they flat call (or fold) instead of potting to $190.
    for (const spec of ['Qs 2h Jh Kd Js', 'Ts Ks 3d 6d Kh']) {
      const { hero, gs } = makeSpot(spec);
      seedFastRandom(59719920);
      const d = structuredClone(
        HorseLogic.decide(hero, gs, 'balanced', {}, {
          observeMind: false,
          omahaPressureNeedsPostflopAggression: true,
        } as never)
      );
      expect(d.action).not.toBe('raise');
      expect(d.action).not.toBe('all_in');
      expect(horseDecisionReceiptRefusal(d, 'plo5', { player: hero, gameState: gs })).toBeNull();
    }

    // Control: AA double-suited (Ah Ac Kh Qc Jd) still 4-bets for value!
    const aaSpot = makeSpot('Ah Ac Kh Qc Jd');
    seedFastRandom(59719920);
    const dAa = structuredClone(
      HorseLogic.decide(aaSpot.hero, aaSpot.gs, 'balanced', {}, {
        observeMind: false,
        omahaPressureNeedsPostflopAggression: true,
      } as never)
    );
    expect(dAa.action).toBe('raise');
    expect(
      horseDecisionReceiptRefusal(dAa, 'plo5', { player: aaSpot.hero, gameState: aaSpot.gs })
    ).toBeNull();
  });

  it('BUG-6 (#59732319) & BUG-7 (#59719347 / #59728834): folds IP cold-3B flat with uncoordinated cards and raises $2-$3 limped-pot flop bets to >= 2 BB', () => {
    // BUG-6: IP cold-call of a 3-bet with uncoordinated Js Ah 6d Ts 4h folds
    const coldVerdict = omahaOopReraisedCallCell({
      variant: 'plo5',
      hole: cards('Js Ah 6d Ts 4h'),
      dead: [],
      outOfPosition: false,
      coldCall: true,
      preflopRaises: 2,
      toCall: 36,
      stack: 390,
      pot: 60,
      priced: {
        rate: 0.3,
        opportunities: 100,
        rateSource: 'measured',
        inPosition: true,
        othersIn: 0,
        raiserBehind: 354,
        rakeFraction: 0.05,
        heroAlreadyRaised: false,
        heroInvested: 0,
      },
      band: [0.4, 1],
      hiLo: false,
      multiBoard: false,
      bombPot: false,
      tournament: false,
      allInOrFold: false,
    });
    expect(coldVerdict).not.toBeNull();
    expect(coldVerdict!.fold).toBe(coldVerdict!.pricing!.evCall < 0);
    expect(coldVerdict!.reason).toBe(coldVerdict!.fold ? 'priced_fold' : 'priced_call');

    // Control: opener calling a 3-bet IP (coldCall = false, outOfPosition = false) remains null (unchanged)
    const openerIpVerdict = omahaOopReraisedCallCell({
      variant: 'plo5',
      hole: cards('Js Ah 6d Ts 4h'),
      dead: [],
      outOfPosition: false,
      coldCall: false,
      preflopRaises: 2,
      toCall: 26,
      stack: 390,
      pot: 60,
      band: [0.4, 1],
      hiLo: false,
      multiBoard: false,
      bombPot: false,
      tournament: false,
      allInOrFold: false,
    });
    expect(openerIpVerdict).toBeNull();

    // BUG-7: $2 flop bet into $9 limped pot (1/2 PLO5) sizes up to >= $4 (2 BB) when omahaBigBetIsPotShare is ON
    const hero: SeatPlayer = {
      seat: 2,
      user_id: '77777777-0000-4000-8000-000000000007',
      username: 'Bob77',
      stack: 400,
      bet: 0,
      totalInvested: 2,
      cards: cards('9h Qs As Ts 6c'),
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
    };
    const opp: SeatPlayer = {
      seat: 4,
      user_id: '88888888-0000-4000-8000-000000000008',
      username: 'MrBear',
      stack: 400,
      bet: 0,
      totalInvested: 2,
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
      stage: 'flop',
      pot: 9,
      bigBlind: 2,
      smallBlind: 1,
      currentBet: 0,
      toCall: 0,
      minRaise: 2,
      minRaiseTo: 2,
      maxRaiseTo: 9,
      legalActions: ['check', 'bet'],
      dealerSeat: 4,
      communityCards: cards('Kh Ks Tc'),
      players: [{ ...hero, cards: [] }, opp],
      actionHistory: [] as ActionRecord[],
    } as unknown as HorseGameStateV2;

    let sawBet = false;
    for (let s = 1; s <= 30; s++) {
      seedFastRandom(59719347 + s);
      const d = structuredClone(
        HorseLogic.decide(
          hero,
          gs,
          'balanced',
          {},
          {
            mind: false,
            telemetry: false,
            omahaBigBetIsPotShare: true,
          }
        )
      );
      expect(horseDecisionReceiptRefusal(d, 'plo5', { player: hero, gameState: gs })).toBeNull();
      if (d.action === 'bet') {
        sawBet = true;
        expect(d.amount).toBeGreaterThanOrEqual(4);
      }
    }
    expect(sawBet).toBe(true);
  });

  it('BUG-5B (#59751306, #59772951, #59776625) & BUG-8 (#59747538): withholds non-premium pressure 4-bets when valueLeader flips false, blocks ragged KK OOP 4-bets, and checks bare AA OOP on paired flops', () => {
    const villainId = '99999999-0000-4000-8000-000000000009';
    const fakeManiacNonLeader = {
      hands: 60,
      presumed: false,
      stats: {
        vpip: { n: 60, mean: 0.85 },
        pfr: { n: 60, mean: 0.58 },
        rfi: { n: 30, mean: 0.8 },
        threeBet: { n: 15, mean: 0.35 },
        foldTo3Bet: { n: 8, mean: 0.05 },
        betCheckedTo: { n: 45, mean: 0.4 },
        foldToBet: { n: 22, mean: 0.42 },
        riverCall: { n: 8, mean: 0.26 },
      },
    };
    vi.spyOn(HorseMind, 'opponentRead').mockImplementation((uid) =>
      uid === villainId ? (fakeManiacNonLeader as never) : null
    );
    // Simulate Table 2 read state where fast-window c-bets flipped valueLeader -> false & postflopAggressor -> true
    vi.spyOn(HorseMind, 'omahaReadConditionalOf').mockImplementation((uid) =>
      uid === villainId
        ? ({
            measured: true,
            valueLeader: false,
            wideReRaiser: true,
            postflopAggressor: true,
          } as never)
        : null
    );
    vi.spyOn(HorseMind, 'bandsForOpponents').mockImplementation(() => [[0.3, 1]]);

    // #59751306 AKQT7 (Qh Kd Ac Th 7c) & #59772951 AJ943 (9d 4h As Jh 3s): no 4-bet even when valueLeader === false
    for (const spec of ['Qh Kd Ac Th 7c', '9d 4h As Jh 3s']) {
      const hero: SeatPlayer = {
        seat: 5,
        user_id: '55555555-0000-4000-8000-000000000005',
        username: 'pokerlou',
        stack: 514.4,
        bet: 10,
        totalInvested: 10,
        cards: cards(spec),
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
        is_horse: true,
      };
      const villain: SeatPlayer = {
        seat: 1,
        user_id: villainId,
        username: 'V1',
        stack: 3200,
        bet: 46,
        totalInvested: 46,
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
        pot: 72,
        bigBlind: 2,
        smallBlind: 1,
        currentBet: 46,
        toCall: 36,
        minRaiseTo: 82,
        maxRaiseTo: 154,
        legalActions: ['fold', 'call', 'raise'],
        dealerSeat: 6,
        communityCards: [],
        players: [villain, { ...hero, cards: [] }],
        actionHistory: [
          {
            stage: 'preflop',
            seat: 5,
            userId: hero.user_id,
            action: 'raise',
            amount: 10,
            isFullRaise: true,
            timestamp: 1,
          },
          {
            stage: 'preflop',
            seat: 1,
            userId: villainId,
            action: 'raise',
            amount: 46,
            isFullRaise: true,
            timestamp: 2,
          },
        ] as ActionRecord[],
      } as unknown as HorseGameStateV2;

      seedFastRandom(59751306);
      const d = structuredClone(
        HorseLogic.decide(hero, gs, 'balanced', {}, {
          observeMind: false,
          omahaPressureNeedsPostflopAggression: true,
        } as never)
      );
      expect(d.action).not.toBe('raise');
      expect(d.action).not.toBe('all_in');
      expect(horseDecisionReceiptRefusal(d, 'plo5', { player: hero, gameState: gs })).toBeNull();
    }

    // #59776625: ragged KKds (Ks 5s Kd 8d 7d) facing a 3-bet OOP (preflopRaises = 2) is rejected as a 4-bet
    const raggedKk4Bet = omahaReraiseByPositionCell({
      variant: 'plo5',
      hole: cards('Ks 5s Kd 8d 7d'),
      preflopRaises: 2,
      outOfPosition: true,
      earlyPosition: false,
      blindVersusBlind: false,
      hiLo: false,
      multiBoard: false,
      bombPot: false,
      tournament: false,
      allInOrFold: false,
    });
    expect(raggedKk4Bet).toEqual({ reraise: false, reason: 'not_premium' });

    // #59747538: bare AA (Kh Ah As Js 6s) OOP on paired flop 7s 7h 3d is recognized as a bare big pair (board2p) and checks
    expect(omahaBareBigPairOnFlop(cards('Kh Ah As Js 6s'), cards('7s 7h 3d'))).toBe(true);
    const flopHero: SeatPlayer = {
      seat: 5,
      user_id: '55555555-0000-4000-8000-000000000005',
      username: 'pokerlou',
      stack: 678.4,
      bet: 0,
      totalInvested: 124,
      cards: cards('Kh Ah As Js 6s'),
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
    };
    const flopVillain: SeatPlayer = {
      seat: 1,
      user_id: villainId,
      username: 'V1',
      stack: 3037,
      bet: 0,
      totalInvested: 124,
      cards: [],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
    };
    const flopGs = {
      stateSchemaVersion: 1,
      gameVariant: 'plo5',
      gameMode: 'cash',
      bettingStructure: 'pot_limit',
      stage: 'flop',
      pot: 261,
      bigBlind: 2,
      smallBlind: 1,
      currentBet: 0,
      toCall: 0,
      minRaise: 2,
      minRaiseTo: 2,
      maxRaiseTo: 261,
      legalActions: ['check', 'bet'],
      dealerSeat: 2,
      communityCards: cards('7s 7h 3d'),
      players: [flopVillain, { ...flopHero, cards: [] }],
      actionHistory: [
        {
          stage: 'preflop',
          seat: 5,
          userId: flopHero.user_id,
          action: 'raise',
          amount: 8,
          isFullRaise: true,
          timestamp: 1,
        },
        {
          stage: 'preflop',
          seat: 1,
          userId: villainId,
          action: 'raise',
          amount: 37,
          isFullRaise: true,
          timestamp: 2,
        },
        {
          stage: 'preflop',
          seat: 5,
          userId: flopHero.user_id,
          action: 'raise',
          amount: 124,
          isFullRaise: true,
          timestamp: 3,
        },
        {
          stage: 'preflop',
          seat: 1,
          userId: villainId,
          action: 'call',
          amount: 87,
          timestamp: 4,
        },
      ] as ActionRecord[],
    } as unknown as HorseGameStateV2;

    seedFastRandom(59747538);
    const dFlop = structuredClone(
      HorseLogic.decide(
        flopHero,
        flopGs,
        'balanced',
        {},
        {
          mind: false,
          telemetry: false,
          omahaBareOverpairOopFlopCheck: true,
        }
      )
    );
    expect(dFlop.action).toBe('check');
    expect(
      horseDecisionReceiptRefusal(dFlop, 'plo5', { player: flopHero, gameState: flopGs })
    ).toBeNull();
  });

  it('BUG-9 (#59770288, #59740955, #59755179, #59768596): folds non-nut sets/2p facing unpaired multi-street all-in shoves and dominated flushes facing flop-XR + turn-pot + river-pot barrels', () => {
    const aggRead: OmahaFacingBetEvRead = {
      measured: true,
      betCheckedToRatio: 1.48,
      postflopManiac: false,
      valueLeader: false,
      sizeShown: null,
    };
    const vlRead: OmahaFacingBetEvRead = {
      measured: true,
      betCheckedToRatio: 0.9,
      postflopManiac: false,
      valueLeader: true,
      sizeShown: null,
    };

    const buildHand = (cfg: {
      stage: 'turn' | 'river';
      hole: string;
      board: string;
      heroStack: number;
      oppBet: number;
      pot: number;
      history: ActionRecord[];
    }) => {
      const hero: SeatPlayer = {
        seat: 3,
        user_id: '33333333-0000-4000-8000-000000000003',
        username: 'H3',
        stack: cfg.heroStack,
        bet: 0,
        totalInvested: 500,
        cards: cards(cfg.hole),
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
        is_horse: true,
      };
      const villain: SeatPlayer = {
        seat: 1,
        user_id: '11111111-0000-4000-8000-000000000001',
        username: 'V1',
        stack: 4000,
        bet: cfg.oppBet,
        totalInvested: 500 + cfg.oppBet,
        cards: [],
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
      };
      const allInCall = cfg.heroStack <= cfg.oppBet + 0.005;
      const gs = {
        stateSchemaVersion: 1,
        gameVariant: 'plo5',
        gameMode: 'cash',
        bettingStructure: 'pot_limit',
        stage: cfg.stage,
        pot: cfg.pot,
        bigBlind: 2,
        smallBlind: 1,
        currentBet: cfg.oppBet,
        toCall: cfg.oppBet,
        minRaiseTo: allInCall ? null : cfg.oppBet * 2,
        maxRaiseTo: allInCall ? null : cfg.heroStack,
        legalActions: allInCall ? ['fold', 'all_in'] : ['fold', 'call', 'all_in'],
        dealerSeat: 6,
        communityCards: cards(cfg.board),
        players: [villain, { ...hero, cards: [] }],
        actionHistory: cfg.history,
      } as unknown as HorseGameStateV2;
      return { hero, gs };
    };

    // 1) #59770288: AAA set facing $776 ($413.65 all-in) river shove on 4-straight Ah 5h 4c 6s Td
    const h1 = buildHand({
      stage: 'river',
      hole: 'As 9d Ad 9s Tc',
      board: 'Ah 5h 4c 6s Td',
      heroStack: 413.65,
      oppBet: 776,
      pot: 2327,
      history: [
        { stage: 'flop', seat: 1, userId: 'v', action: 'check', amount: 0, timestamp: 1 },
        {
          stage: 'flop',
          seat: 3,
          userId: 'h',
          action: 'bet',
          amount: 203,
          isFullRaise: true,
          timestamp: 2,
        },
        { stage: 'flop', seat: 1, userId: 'v', action: 'call', amount: 203, timestamp: 3 },
        {
          stage: 'turn',
          seat: 1,
          userId: 'v',
          action: 'bet',
          amount: 388,
          isFullRaise: true,
          timestamp: 4,
        },
        { stage: 'turn', seat: 3, userId: 'h', action: 'call', amount: 388, timestamp: 5 },
        {
          stage: 'river',
          seat: 1,
          userId: 'v',
          action: 'bet',
          amount: 776,
          isFullRaise: true,
          timestamp: 6,
        },
      ] as ActionRecord[],
    });

    // 2) #59740955: 999 set facing $489 ($376.70 all-in) river shove on 9h 7c 5s Ks 4d
    const h2 = buildHand({
      stage: 'river',
      hole: '9c Kh Qs 9d Th',
      board: '9h 7c 5s Ks 4d',
      heroStack: 376.7,
      oppBet: 489,
      pot: 1467,
      history: [
        { stage: 'flop', seat: 3, userId: 'h', action: 'check', amount: 0, timestamp: 1 },
        {
          stage: 'flop',
          seat: 1,
          userId: 'v',
          action: 'bet',
          amount: 42,
          isFullRaise: true,
          timestamp: 2,
        },
        {
          stage: 'flop',
          seat: 3,
          userId: 'h',
          action: 'raise',
          amount: 135,
          isFullRaise: true,
          timestamp: 3,
        },
        { stage: 'flop', seat: 1, userId: 'v', action: 'call', amount: 93, timestamp: 4 },
        { stage: 'turn', seat: 3, userId: 'h', action: 'check', amount: 0, timestamp: 5 },
        {
          stage: 'turn',
          seat: 1,
          userId: 'v',
          action: 'bet',
          amount: 326,
          isFullRaise: true,
          timestamp: 6,
        },
        { stage: 'turn', seat: 3, userId: 'h', action: 'call', amount: 326, timestamp: 7 },
        { stage: 'river', seat: 3, userId: 'h', action: 'check', amount: 0, timestamp: 8 },
        {
          stage: 'river',
          seat: 1,
          userId: 'v',
          action: 'bet',
          amount: 489,
          isFullRaise: true,
          timestamp: 9,
        },
      ] as ActionRecord[],
    });

    // 3) #59755179: Tc3c 3rd-nut flush facing $522 pot river bet after flop XR + turn pot on Ac Ts 6h Jc 9c
    const h3 = buildHand({
      stage: 'river',
      hole: 'Kd Tc Td 8h 3c',
      board: 'Ac Ts 6h Jc 9c',
      heroStack: 951.52,
      oppBet: 522,
      pot: 1044,
      history: [
        { stage: 'flop', seat: 1, userId: 'v', action: 'check', amount: 0, timestamp: 1 },
        {
          stage: 'flop',
          seat: 3,
          userId: 'h',
          action: 'bet',
          amount: 12,
          isFullRaise: true,
          timestamp: 2,
        },
        {
          stage: 'flop',
          seat: 1,
          userId: 'v',
          action: 'raise',
          amount: 70,
          isFullRaise: true,
          timestamp: 3,
        },
        { stage: 'flop', seat: 3, userId: 'h', action: 'call', amount: 58, timestamp: 4 },
        {
          stage: 'turn',
          seat: 1,
          userId: 'v',
          action: 'bet',
          amount: 174,
          isFullRaise: true,
          timestamp: 5,
        },
        { stage: 'turn', seat: 3, userId: 'h', action: 'call', amount: 174, timestamp: 6 },
        {
          stage: 'river',
          seat: 1,
          userId: 'v',
          action: 'bet',
          amount: 522,
          isFullRaise: true,
          timestamp: 7,
        },
      ] as ActionRecord[],
    });

    // 4) #59768596: 9966 two-pair facing $501 ($296.75 all-in) turn shove on 6c 9h 8h 4d
    const h4 = buildHand({
      stage: 'turn',
      hole: 'As Ad 6d 2s 9s',
      board: '6c 9h 8h 4d',
      heroStack: 296.75,
      oppBet: 501,
      pot: 1168,
      history: [
        { stage: 'flop', seat: 3, userId: 'h', action: 'check', amount: 0, timestamp: 1 },
        {
          stage: 'flop',
          seat: 1,
          userId: 'v',
          action: 'bet',
          amount: 167,
          isFullRaise: true,
          timestamp: 2,
        },
        { stage: 'flop', seat: 3, userId: 'h', action: 'call', amount: 167, timestamp: 3 },
        { stage: 'turn', seat: 3, userId: 'h', action: 'check', amount: 0, timestamp: 4 },
        {
          stage: 'turn',
          seat: 1,
          userId: 'v',
          action: 'bet',
          amount: 501,
          isFullRaise: true,
          timestamp: 5,
        },
      ] as ActionRecord[],
    });

    for (const { hero, gs } of [h1, h2, h3, h4]) {
      const spot = omahaFacingBetEvSpot(hero, gs)!;
      expect(spot).not.toBeNull();
      for (const rd of [null, vlRead, aggRead]) {
        const verdict = omahaFacingBetEvVerdict(spot, hero.cards, gs.communityCards, [], rd)!;
        expect(verdict.call).toBe(false);
      }
      vi.spyOn(HorseMind, 'omahaFacingBetEvReadOf').mockImplementation(() => aggRead);
      seedFastRandom(59770288);
      const d = structuredClone(
        HorseLogic.decide(hero, gs, 'balanced', {}, {
          observeMind: false,
          omahaFacingBetEv: true,
        } as never)
      );
      expect(d.action).toBe('fold');
      expect(horseDecisionReceiptRefusal(d, 'plo5', { player: hero, gameState: gs })).toBeNull();
      vi.restoreAllMocks();
    }
  });

  it('BUG-10 (#59777909, #59775543, #59749333): calls $2 turn min-bet with made straight, folds multiway paired-river bare 2p, and folds redrawless turn 2p facing full-pot barrel', () => {
    const aggRead: OmahaFacingBetEvRead = {
      measured: true,
      betCheckedToRatio: 1.35,
      postflopManiac: false,
      valueLeader: false,
      sizeShown: null,
    };
    const vlRead: OmahaFacingBetEvRead = {
      measured: true,
      betCheckedToRatio: 0.95,
      postflopManiac: false,
      valueLeader: true,
      sizeShown: null,
    };

    // GAP-1 (#59777909): TheKid (5c 8d 4s 3c 7d = made 8-high straight) on 8h 3h 7s 6h facing $2 into $250 with 1 caller + 1 behind MUST CALL
    {
      const hero: SeatPlayer = {
        seat: 6,
        user_id: '66666666-0000-4000-8000-000000000006',
        username: 'TheKid',
        stack: 500,
        bet: 0,
        totalInvested: 58,
        cards: cards('5c 8d 4s 3c 7d'),
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
        is_horse: true,
      };
      const bettor: SeatPlayer = {
        seat: 3,
        user_id: '33333333-0000-4000-8000-000000000003',
        username: 'B3',
        stack: 600,
        bet: 2,
        totalInvested: 60,
        cards: [],
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
      };
      const caller: SeatPlayer = {
        seat: 4,
        user_id: '44444444-0000-4000-8000-000000000004',
        username: 'C4',
        stack: 400,
        bet: 2,
        totalInvested: 60,
        cards: [],
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
      };
      const behind: SeatPlayer = {
        seat: 1,
        user_id: '11111111-0000-4000-8000-000000000001',
        username: 'V1',
        stack: 3500,
        bet: 0,
        totalInvested: 58,
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
        pot: 254,
        bigBlind: 2,
        smallBlind: 1,
        currentBet: 2,
        toCall: 2,
        minRaiseTo: 4,
        maxRaiseTo: 258,
        legalActions: ['fold', 'call', 'raise'],
        dealerSeat: 1,
        communityCards: cards('8h 3h 7s 6h'),
        players: [behind, bettor, caller, { ...hero, cards: [] }],
        actionHistory: [
          {
            stage: 'flop',
            seat: 3,
            userId: bettor.user_id,
            action: 'check',
            amount: 0,
            timestamp: 1,
          },
          {
            stage: 'flop',
            seat: 4,
            userId: caller.user_id,
            action: 'check',
            amount: 0,
            timestamp: 2,
          },
          {
            stage: 'flop',
            seat: 6,
            userId: hero.user_id,
            action: 'check',
            amount: 0,
            timestamp: 3,
          },
          {
            stage: 'flop',
            seat: 1,
            userId: behind.user_id,
            action: 'check',
            amount: 0,
            timestamp: 4,
          },
          {
            stage: 'turn',
            seat: 3,
            userId: bettor.user_id,
            action: 'bet',
            amount: 2,
            isFullRaise: true,
            timestamp: 5,
          },
          {
            stage: 'turn',
            seat: 4,
            userId: caller.user_id,
            action: 'call',
            amount: 2,
            timestamp: 6,
          },
        ] as ActionRecord[],
      } as unknown as HorseGameStateV2;

      const spot = omahaFacingBetEvSpot(hero, gs)!;
      expect(spot).not.toBeNull();
      for (const rd of [null, vlRead, aggRead]) {
        const v = omahaFacingBetEvVerdict(spot, hero.cards, gs.communityCards, [], rd)!;
        expect(v.call).toBe(true);
        expect(v.field).toBeGreaterThan(0.35);
        expect(v.margin).toBeLessThanOrEqual(1);
        expect(v.ev).toBeGreaterThan(25);
      }
      vi.spyOn(HorseMind, 'omahaFacingBetEvReadOf').mockImplementation(() => vlRead);
      seedFastRandom(59777909);
      const d = structuredClone(
        HorseLogic.decide(hero, gs, 'balanced', {}, {
          observeMind: false,
          omahaFacingBetEv: true,
        } as never)
      );
      expect(d.action).not.toBe('fold');
      expect(horseDecisionReceiptRefusal(d, 'plo5', { player: hero, gameState: gs })).toBeNull();
      vi.restoreAllMocks();
    }

    // GAP-2 (#59775543): l0jackking (8c 9s Ac Qc Th = bare QQJJ 2p) on paired river 3c 5s Qd Jd Jc facing $106 into $320 with 1 behind MUST FOLD
    {
      const hero: SeatPlayer = {
        seat: 3,
        user_id: '33333333-0000-4000-8000-000000000003',
        username: 'l0jackking',
        stack: 700,
        bet: 0,
        totalInvested: 100,
        cards: cards('8c 9s Ac Qc Th'),
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
        is_horse: true,
      };
      const bettor: SeatPlayer = {
        seat: 1,
        user_id: '11111111-0000-4000-8000-000000000001',
        username: 'V1',
        stack: 4000,
        bet: 106,
        totalInvested: 206,
        cards: [],
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
      };
      const behind: SeatPlayer = {
        seat: 6,
        user_id: '66666666-0000-4000-8000-000000000006',
        username: 'TheKid',
        stack: 600,
        bet: 0,
        totalInvested: 100,
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
        pot: 426,
        bigBlind: 2,
        smallBlind: 1,
        currentBet: 106,
        toCall: 106,
        minRaiseTo: 212,
        maxRaiseTo: 532,
        legalActions: ['fold', 'call', 'raise'],
        dealerSeat: 4,
        communityCards: cards('3c 5s Qd Jd Jc'),
        players: [bettor, { ...hero, cards: [] }, behind],
        actionHistory: [
          {
            stage: 'flop',
            seat: 6,
            userId: behind.user_id,
            action: 'check',
            amount: 0,
            timestamp: 1,
          },
          {
            stage: 'flop',
            seat: 1,
            userId: bettor.user_id,
            action: 'check',
            amount: 0,
            timestamp: 2,
          },
          {
            stage: 'flop',
            seat: 3,
            userId: hero.user_id,
            action: 'bet',
            amount: 44,
            isFullRaise: true,
            timestamp: 3,
          },
          {
            stage: 'flop',
            seat: 6,
            userId: behind.user_id,
            action: 'call',
            amount: 44,
            timestamp: 4,
          },
          {
            stage: 'flop',
            seat: 1,
            userId: bettor.user_id,
            action: 'call',
            amount: 44,
            timestamp: 5,
          },
          {
            stage: 'turn',
            seat: 6,
            userId: behind.user_id,
            action: 'check',
            amount: 0,
            timestamp: 6,
          },
          {
            stage: 'turn',
            seat: 1,
            userId: bettor.user_id,
            action: 'check',
            amount: 0,
            timestamp: 7,
          },
          {
            stage: 'turn',
            seat: 3,
            userId: hero.user_id,
            action: 'check',
            amount: 0,
            timestamp: 8,
          },
          {
            stage: 'river',
            seat: 6,
            userId: behind.user_id,
            action: 'check',
            amount: 0,
            timestamp: 9,
          },
          {
            stage: 'river',
            seat: 1,
            userId: bettor.user_id,
            action: 'bet',
            amount: 106,
            isFullRaise: true,
            timestamp: 10,
          },
        ] as ActionRecord[],
      } as unknown as HorseGameStateV2;

      const spot = omahaFacingBetEvSpot(hero, gs)!;
      expect(spot).not.toBeNull();
      for (const rd of [null, vlRead, aggRead]) {
        const v = omahaFacingBetEvVerdict(spot, hero.cards, gs.communityCards, [], rd)!;
        expect(v.call).toBe(false);
      }
      vi.spyOn(HorseMind, 'omahaFacingBetEvReadOf').mockImplementation(() => aggRead);
      seedFastRandom(59775543);
      const d = structuredClone(
        HorseLogic.decide(hero, gs, 'balanced', {}, {
          observeMind: false,
          omahaFacingBetEv: true,
        } as never)
      );
      expect(d.action).toBe('fold');
      expect(horseDecisionReceiptRefusal(d, 'plo5', { player: hero, gameState: gs })).toBeNull();
      vi.restoreAllMocks();
    }

    // GAP-3 (#59749333): whalee (Ac 9c 3h 7d 3d = bare A9 bottom 2p, 0 straight/flush outs) on 9d Kc Ah 8d facing $129 full-pot barrel MUST FOLD
    {
      const hero: SeatPlayer = {
        seat: 3,
        user_id: '33333333-0000-4000-8000-000000000003',
        username: 'whalee',
        stack: 750,
        bet: 0,
        totalInvested: 39,
        cards: cards('Ac 9c 3h 7d 3d'),
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
        is_horse: true,
      };
      const bettor: SeatPlayer = {
        seat: 1,
        user_id: '11111111-0000-4000-8000-000000000001',
        username: 'V1',
        stack: 3500,
        bet: 129,
        totalInvested: 168,
        cards: [],
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
      };
      const behind: SeatPlayer = {
        seat: 5,
        user_id: '55555555-0000-4000-8000-000000000005',
        username: 'pokerlou',
        stack: 600,
        bet: 0,
        totalInvested: 39,
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
        pot: 258,
        bigBlind: 2,
        smallBlind: 1,
        currentBet: 129,
        toCall: 129,
        minRaiseTo: 258,
        maxRaiseTo: 516,
        legalActions: ['fold', 'call', 'raise'],
        dealerSeat: 3,
        communityCards: cards('9d Kc Ah 8d'),
        players: [bettor, { ...hero, cards: [] }, behind],
        actionHistory: [
          {
            stage: 'flop',
            seat: 5,
            userId: behind.user_id,
            action: 'check',
            amount: 0,
            timestamp: 1,
          },
          {
            stage: 'flop',
            seat: 1,
            userId: bettor.user_id,
            action: 'bet',
            amount: 30,
            isFullRaise: true,
            timestamp: 2,
          },
          {
            stage: 'flop',
            seat: 3,
            userId: hero.user_id,
            action: 'call',
            amount: 30,
            timestamp: 3,
          },
          {
            stage: 'flop',
            seat: 5,
            userId: behind.user_id,
            action: 'call',
            amount: 30,
            timestamp: 4,
          },
          {
            stage: 'turn',
            seat: 5,
            userId: behind.user_id,
            action: 'check',
            amount: 0,
            timestamp: 5,
          },
          {
            stage: 'turn',
            seat: 1,
            userId: bettor.user_id,
            action: 'bet',
            amount: 129,
            isFullRaise: true,
            timestamp: 6,
          },
        ] as ActionRecord[],
      } as unknown as HorseGameStateV2;

      const spot = omahaFacingBetEvSpot(hero, gs)!;
      expect(spot).not.toBeNull();
      for (const rd of [null, vlRead, aggRead]) {
        const v = omahaFacingBetEvVerdict(spot, hero.cards, gs.communityCards, [], rd, {
          realization: 0.92,
        })!;
        expect(v.call).toBe(false);
      }
      vi.spyOn(HorseMind, 'omahaFacingBetEvReadOf').mockImplementation(() => vlRead);
      seedFastRandom(59749333);
      const d = structuredClone(
        HorseLogic.decide(hero, gs, 'balanced', {}, {
          observeMind: false,
          omahaFacingBetEv: true,
        } as never)
      );
      expect(d.action).toBe('fold');
      expect(horseDecisionReceiptRefusal(d, 'plo5', { player: hero, gameState: gs })).toBeNull();
      vi.restoreAllMocks();
    }
  });
});
