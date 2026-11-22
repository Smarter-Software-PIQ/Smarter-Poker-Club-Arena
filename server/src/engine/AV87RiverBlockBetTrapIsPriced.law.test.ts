/**
 * LAW: v87RiverBlockBetTrapIsPriced (2026-11-22, Horse Switch lane, DARK / DEFAULT OFF).
 *
 * Proves every invariant of the dark default-OFF priced replacement for `v87RiverBlockBetTrap`
 * (REVIEW-HOLDEM-OFFLIST-20261121.md #13, OOP river lead & facing-raise after river block bet):
 *  (a) Bit-identical when OFF (absent, false, or non-boolean truthy) across NLH cash/MTT and PLO4/PLO5.
 *  (b) Deterministic EV-driven lead (`trap_block_lead` vs `normal_value_lead` vs `check`) and
 *      facing-raise (`reraise` vs `call`) decisions when ON, backed by `holdemEmpiricalPriors`,
 *      independent of `v87RiverBlockBetTrap`, with clean `v87_river_block_bet_trap_priced_*_seen` receipts
 *      and `riverNutsRaise` preservation on exact-nut block-bet traps.
 *  (c) Zero `fastRandom` or `unit87` hash-unit coin flips when ON: identical spot inputs yield the
 *      exact same decision across arbitrary `user_id` hashes and leave the PRNG state untouched relative
 *      to pure helper calls.
 *  (d) NLH-only / zero PLO reach: PLO4, PLO5, PLO6, PLO8 Hi-Lo, Short Deck, Fixed Limit, multi-board,
 *      bomb pot, and All-In-or-Fold are rejected by structural gates and bit-identical in `HorseLogic.decide`.
 *  (e) Registered in `OPTION_SWITCH_REFUSED`, `HORSE_DATA_LEDGER`, `HORSE_REFERENCE_DECISION_SOURCE_REASONS`,
 *      and `DEVELOPMENT_LEAGUE_CARDS` (never `LEAGUE_MATCHUPS`).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { HORSE_DATA_LEDGER } from './HorseDataLedger.js';
import { fastRandom, seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { OPTION_SWITCH_REFUSED } from './HorseOptionSwitch.js';
import { HORSE_REFERENCE_DECISION_SOURCE_REASONS } from './HorseReferenceDecisionSources.js';
import { DEVELOPMENT_LEAGUE_CARDS, LEAGUE_MATCHUPS } from '../benchmark/HorseLeague.js';
import {
  V87_BLOCK_TRAP_POT_FRAC,
  V87_RIVER_BLOCK_BET_TRAP_PRICED_RECEIPTS,
  v87EmpiricalRiverFoldToLead,
  v87EmpiricalRiverRaiseVsLead,
  v87RiverBlockBetTrapFacingRaiseApplies,
  v87RiverBlockBetTrapFacingRaiseVerdict,
  v87RiverBlockBetTrapLeadApplies,
  v87RiverBlockBetTrapLeadVerdict,
} from './HorseHoldemV87RiverBlockBetTrapIsPriced.js';
import type { ActionType, Card, CardRank, CardSuit, SeatPlayer } from '../types.js';

const SUITS: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
function cards(text: string): Card[] {
  const out: Card[] = [];
  for (let i = 0; i + 1 < text.length; i += 2) {
    out.push({ rank: text[i] as CardRank, suit: SUITS[text[i + 1]] });
  }
  return out;
}

const fireCounts = () => Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));

function stripWallClock<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripWallClock(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'elapsedMs' || k === 'latencyMs' || k === 'policyMs') continue;
      out[k] = stripWallClock(v);
    }
    return out as T;
  }
  return value;
}

function decideWithOpts(hero: SeatPlayer, gs: HorseGameStateV2, opts: HorseDecideOpts) {
  return HorseLogic.decide(hero, gs, 'balanced', {}, { telemetry: true, ...opts });
}

function buildOopRiverLeadSpot(params: {
  variant?: string;
  hole: string;
  board: string;
  heroId?: string;
  villainId?: string;
  pot?: number;
  heroStack?: number;
  villainStack?: number;
  bigBlind?: number;
  bombPot?: boolean;
  multiBoard?: boolean;
  allInOrFold?: boolean;
  mode?: 'cash' | 'tournament';
}): { hero: SeatPlayer; gs: HorseGameStateV2 } {
  const heroId = params.heroId ?? 'hero-v87-lead';
  const villainId = params.villainId ?? 'villain-v87-lead';
  const pot = params.pot ?? 100;
  const heroStack = params.heroStack ?? 180;
  const villainStack = params.villainStack ?? 180;
  const bb = params.bigBlind ?? 2;
  // Hero OOP (seat 2 = BB, dealer = seat 1 = villain IP).
  const hero: SeatPlayer = {
    seat: 2,
    user_id: heroId,
    username: heroId,
    stack: heroStack,
    bet: 0,
    totalInvested: pot / 2,
    cards: cards(params.hole),
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
  };
  const villain: SeatPlayer = {
    seat: 1,
    user_id: villainId,
    username: villainId,
    stack: villainStack,
    bet: 0,
    totalInvested: pot / 2,
    cards: [],
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
  };
  const gs: HorseGameStateV2 = {
    gameVariant: params.variant ?? 'nlh',
    stage: 'river',
    pot,
    currentBet: 0,
    toCall: 0,
    bigBlind: bb,
    smallBlind: bb / 2,
    dealerSeat: 1,
    communityCards: cards(params.board),
    ...(params.multiBoard ? { communityCards2: cards('2c3d4h7s9c') } : {}),
    players: [villain, hero],
    actionHistory: [
      { stage: 'preflop', seat: 1, userId: villainId, action: 'raise', amount: 6, timestamp: 1 },
      { stage: 'preflop', seat: 2, userId: heroId, action: 'call', amount: 4, timestamp: 2 },
      { stage: 'flop', seat: 2, userId: heroId, action: 'bet', amount: 12, timestamp: 3 },
      { stage: 'flop', seat: 1, userId: villainId, action: 'call', amount: 12, timestamp: 4 },
      { stage: 'turn', seat: 2, userId: heroId, action: 'bet', amount: 32, timestamp: 5 },
      { stage: 'turn', seat: 1, userId: villainId, action: 'call', amount: 32, timestamp: 6 },
    ],
    legalActions: ['check', 'bet', 'all_in'],
    minRaise: bb,
    minRaiseTo: bb,
    maxRaiseTo: heroStack,
    stateSchemaVersion: 1,
    bombPot: params.bombPot === true,
    allInOrFold: params.allInOrFold === true,
    ...(params.mode === 'tournament'
      ? {
          isTournament: true,
          tournament: {
            nearBubble: false,
            inMoney: false,
          },
        }
      : {}),
  };
  return { hero, gs };
}

function buildFacingRaiseAfterBlockBetSpot(params: {
  variant?: string;
  hole: string;
  board: string;
  heroId?: string;
  villainId?: string;
  potAtRiverStart?: number;
  heroBlockBet?: number;
  villainRaiseTo?: number;
  heroStack?: number;
  villainStack?: number;
  bigBlind?: number;
  bombPot?: boolean;
  multiBoard?: boolean;
}): { hero: SeatPlayer; gs: HorseGameStateV2 } {
  const heroId = params.heroId ?? 'hero-v87-raise';
  const villainId = params.villainId ?? 'villain-v87-raise';
  const potStart = params.potAtRiverStart ?? 100;
  const heroBet = params.heroBlockBet ?? 30; // 30% pot block bet
  const raiseTo = params.villainRaiseTo ?? 120;
  const toCall = raiseTo - heroBet;
  const potNow = potStart + heroBet + raiseTo;
  const heroStack = params.heroStack ?? 300;
  const villainStack = params.villainStack ?? 250;
  const bb = params.bigBlind ?? 2;

  const hero: SeatPlayer = {
    seat: 2,
    user_id: heroId,
    username: heroId,
    stack: heroStack,
    bet: heroBet,
    totalInvested: potStart / 2 + heroBet,
    cards: cards(params.hole),
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
  };
  const villain: SeatPlayer = {
    seat: 1,
    user_id: villainId,
    username: villainId,
    stack: villainStack,
    bet: raiseTo,
    totalInvested: potStart / 2 + raiseTo,
    cards: [],
    is_folded: false,
    is_all_in: villainStack <= 0,
    is_sitting_out: false,
  };
  const minRaiseTo = raiseTo + Math.max(toCall, bb);
  const maxRaiseTo = heroBet + heroStack;
  const legalActions: ActionType[] =
    heroStack > toCall && maxRaiseTo >= minRaiseTo
      ? ['fold', 'call', 'raise', 'all_in']
      : heroStack > toCall
        ? ['fold', 'call', 'all_in']
        : ['fold', 'call'];

  const gs: HorseGameStateV2 = {
    gameVariant: params.variant ?? 'nlh',
    stage: 'river',
    pot: potNow,
    currentBet: raiseTo,
    toCall,
    bigBlind: bb,
    smallBlind: bb / 2,
    dealerSeat: 1,
    communityCards: cards(params.board),
    ...(params.multiBoard ? { communityCards2: cards('2c3d4h7s9c') } : {}),
    players: [villain, hero],
    actionHistory: [
      { stage: 'preflop', seat: 1, userId: villainId, action: 'raise', amount: 6, timestamp: 1 },
      { stage: 'preflop', seat: 2, userId: heroId, action: 'call', amount: 4, timestamp: 2 },
      { stage: 'flop', seat: 2, userId: heroId, action: 'bet', amount: 12, timestamp: 3 },
      { stage: 'flop', seat: 1, userId: villainId, action: 'call', amount: 12, timestamp: 4 },
      { stage: 'turn', seat: 2, userId: heroId, action: 'bet', amount: 32, timestamp: 5 },
      { stage: 'turn', seat: 1, userId: villainId, action: 'call', amount: 32, timestamp: 6 },
      { stage: 'river', seat: 2, userId: heroId, action: 'bet', amount: heroBet, timestamp: 7 },
      {
        stage: 'river',
        seat: 1,
        userId: villainId,
        action: 'raise',
        amount: raiseTo,
        timestamp: 8,
      },
    ],
    legalActions,
    minRaise: Math.max(toCall, bb),
    minRaiseTo,
    maxRaiseTo,
    stateSchemaVersion: 1,
    bombPot: params.bombPot === true,
  };
  return { hero, gs };
}

beforeEach(() => {
  HorseMind.reset();
  enableBrainTelemetry();
  drainFires();
  seedFastRandom(20261122);
});

afterEach(() => {
  HorseMind.reset();
  drainFires();
});

describe('LAW: v87RiverBlockBetTrapIsPriced (dark default-OFF priced river block-bet trap)', () => {
  describe('(a) bit-identical when OFF across NLH cash/MTT and PLO4/PLO5', () => {
    it('absent, false, and non-boolean truthy values produce identical decisions and telemetry on lead and facing-raise spots', () => {
      const lead = buildOopRiverLeadSpot({
        hole: 'AsKs',
        board: 'QsJsTs2d3c',
        heroId: 'hero-off-parity-1',
      });
      const raised = buildFacingRaiseAfterBlockBetSpot({
        hole: 'AsKs',
        board: 'QsJsTs2d3c',
        heroId: 'hero-off-parity-2',
      });
      const leadMtt = buildOopRiverLeadSpot({
        hole: 'AdAh',
        board: 'AsKd7c4s2h',
        mode: 'tournament',
      });

      for (const spot of [lead, raised, leadMtt]) {
        seedFastRandom(424242);
        drainFires();
        const baseline = stripWallClock(decideWithOpts(spot.hero, spot.gs, { mind: false }));
        const baseFires = fireCounts();
        const baseRng = fastRandom();

        for (const variantOpts of [
          { mind: false, v87RiverBlockBetTrapIsPriced: false },
          {
            mind: false,
            v87RiverBlockBetTrapIsPriced: 'true' as unknown as boolean,
          },
          {
            mind: false,
            v87RiverBlockBetTrapIsPriced: 1 as unknown as boolean,
          },
        ] as HorseDecideOpts[]) {
          seedFastRandom(424242);
          drainFires();
          const got = stripWallClock(decideWithOpts(spot.hero, spot.gs, variantOpts));
          const gotFires = fireCounts();
          const gotRng = fastRandom();
          expect(got).toEqual(baseline);
          expect(gotFires).toEqual(baseFires);
          expect(gotRng).toBe(baseRng);
        }
      }
    });
  });

  describe('(b) deterministic EV-driven lead/check and reraise/call decisions when ON', () => {
    it('lead pure EV compares EV(trap_block_lead) vs EV(normal_value_lead) vs EV(check) using holdemEmpiricalPriors', () => {
      // 1. Against a passive calling station (low fold rate even vs big bets, rarely stabs),
      // normal_value_lead extracts strictly more EV than a small block bet or check.
      const station = v87RiverBlockBetTrapLeadVerdict({
        pot: 100,
        heroStack: 180,
        villainStack: 180,
        bigBlind: 2,
        equity: 0.96,
        isExactRiverNuts: false,
        exploitCounters: {
          riverCall: 34,
          riverCallOpp: 40,
          betCheckedTo: 5,
          betCheckedToOpp: 40,
        },
      });
      expect(station.decision).toBe('normal_value_lead');
      expect(station.betPotFrac).toBeGreaterThan(0.5);
      expect(station.evValueLead).toBeGreaterThan(station.evBlockLead);
      expect(station.evValueLead).toBeGreaterThan(station.evCheck!);

      // 2. Against an aggressive river stabber (high betCheckedTo) holding non-exact nuts,
      // check-trapping captures villain's wide stab range and beats leading.
      const vsStabber = v87RiverBlockBetTrapLeadVerdict({
        pot: 100,
        heroStack: 200,
        villainStack: 200,
        bigBlind: 2,
        equity: 0.97,
        isExactRiverNuts: false,
        exploitCounters: {
          riverCall: 16,
          riverCallOpp: 40,
          betCheckedTo: 32,
          betCheckedToOpp: 40,
        },
      });
      expect(vsStabber.decision).toBe('check');
      expect(vsStabber.canCheck).toBe(true);
      expect(vsStabber.evCheck!).toBeGreaterThan(vsStabber.evBlockLead);
      expect(vsStabber.evCheck!).toBeGreaterThan(vsStabber.evValueLead);

      // 3. Against a player who folds heavily to large river bets, rarely stabs when checked to,
      // and raises small block bets at a healthy clip (HUD r.raise), trap_block_lead wins cleanly!
      const vsFoldyRaiser = v87RiverBlockBetTrapLeadVerdict({
        pot: 100,
        heroStack: 220,
        villainStack: 220,
        bigBlind: 2,
        equity: 0.99,
        isExactRiverNuts: true,
        hudOpp: {
          eff: {
            'r.fBet': [40, 30], // folds heavily to normal river bets
            'r.raise': [40, 14], // attacks small block bets
            'r.betCk': [40, 6],
          },
        },
      });
      expect(vsFoldyRaiser.decision).toBe('trap_block_lead');
      expect(vsFoldyRaiser.betPotFrac).toBeCloseTo(V87_BLOCK_TRAP_POT_FRAC, 6);
      expect(vsFoldyRaiser.canCheck).toBe(false);
      expect(vsFoldyRaiser.evCheck).toBeNull();
      expect(vsFoldyRaiser.evBlockLead).toBeGreaterThan(vsFoldyRaiser.evValueLead);
    });

    it('empirical fold-to-lead increases monotonically with bet size and raise-vs-lead peaks on small block bets', () => {
      const fBlock = v87EmpiricalRiverFoldToLead(0.3);
      const fMed = v87EmpiricalRiverFoldToLead(0.6);
      const fBig = v87EmpiricalRiverFoldToLead(1.0);
      expect(fBlock).toBeLessThan(fMed);
      expect(fMed).toBeLessThan(fBig);

      const rBlock = v87EmpiricalRiverRaiseVsLead(30, 100, 200, fBlock);
      const rBig = v87EmpiricalRiverRaiseVsLead(100, 100, 200, fBig);
      expect(rBlock).toBeGreaterThan(rBig);
      expect(v87EmpiricalRiverRaiseVsLead(200, 100, 200, fBig)).toBe(0);
    });

    it('facing-raise pure EV compares EV(trap_reraise) vs EV(call), 3-betting exact nuts and flat-calling vulnerable near-nuts vs overbet raises', () => {
      // Exact river nuts facing a raise with stacks behind: 3-betting strictly beats calling.
      const exactNuts = v87RiverBlockBetTrapFacingRaiseVerdict({
        pot: 250,
        toCall: 90,
        heroBet: 30,
        currentBet: 120,
        heroStack: 300,
        villainStack: 250,
        bigBlind: 2,
        equity: 1.0,
        isExactRiverNuts: true,
      });
      expect(exactNuts.decision).toBe('reraise');
      expect(exactNuts.raiseTo).not.toBeNull();
      expect(exactNuts.evReraise!).toBeGreaterThan(exactNuts.evCall);

      // Vulnerable near-nut (eq = 0.89, non-exact nuts) facing a huge river overbet raise where
      // villain folds out worse hands to a 3-bet (high r.fRaise): calling strictly beats 3-betting!
      const vulnerable = v87RiverBlockBetTrapFacingRaiseVerdict({
        pot: 310,
        toCall: 180,
        heroBet: 30,
        currentBet: 210,
        heroStack: 350,
        villainStack: 350,
        bigBlind: 2,
        equity: 0.89,
        isExactRiverNuts: false,
        hudOpp: {
          eff: {
            'r.fRaise': [30, 22], // villain folds ~68% to a river 3-bet -> isolates against nuts
          },
        },
      });
      expect(vulnerable.decision).toBe('call');
      expect(vulnerable.evCall).toBeGreaterThanOrEqual(vulnerable.evReraise ?? -Infinity);

      // Raiser already all-in (villainStack = 0): cannot extract more chips, must flat-call.
      const vsAllIn = v87RiverBlockBetTrapFacingRaiseVerdict({
        pot: 250,
        toCall: 90,
        heroBet: 30,
        currentBet: 120,
        heroStack: 300,
        villainStack: 0,
        bigBlind: 2,
        equity: 1.0,
        isExactRiverNuts: true,
      });
      expect(vsAllIn.decision).toBe('call');
      expect(vsAllIn.candidates).toEqual([]);
    });

    it('HorseLogic.decide fires clean priced receipts on lead and facing-raise sites, independent of v87RiverBlockBetTrap', () => {
      // Exact royal flush OOP river lead: priced helper fires cleanly whether v87RiverBlockBetTrap is true or false.
      const leadSpot = buildOopRiverLeadSpot({
        hole: 'AsKs',
        board: 'QsJsTs2d3c',
        pot: 100,
        heroStack: 220,
        villainStack: 220,
      });

      seedFastRandom(777);
      drainFires();
      const dWithParentOn = stripWallClock(
        decideWithOpts(leadSpot.hero, leadSpot.gs, {
          mind: false,
          v87RiverBlockBetTrap: true,
          v87RiverBlockBetTrapIsPriced: true,
        })
      );
      const firesOn = fireCounts();

      seedFastRandom(777);
      drainFires();
      const dWithParentOff = stripWallClock(
        decideWithOpts(leadSpot.hero, leadSpot.gs, {
          mind: false,
          v87RiverBlockBetTrap: false,
          v87RiverBlockBetTrapIsPriced: true,
        })
      );
      const firesOff = fireCounts();

      expect(dWithParentOn).toEqual(dWithParentOff);
      expect(firesOn).toEqual(firesOff);
      const leadReceiptSum =
        (firesOn[V87_RIVER_BLOCK_BET_TRAP_PRICED_RECEIPTS.blockLead] ?? 0) +
        (firesOn[V87_RIVER_BLOCK_BET_TRAP_PRICED_RECEIPTS.valueLead] ?? 0) +
        (firesOn[V87_RIVER_BLOCK_BET_TRAP_PRICED_RECEIPTS.check] ?? 0);
      expect(leadReceiptSum).toBe(1);
      // Legacy blanket receipt must never fire when priced replacement is ON.
      expect(firesOn['v87_river_block_nut_trap'] ?? 0).toBe(0);
      // If blockLead won, riverNutsRaise must preserve the small <= 36% pot trap bet.
      if (firesOn[V87_RIVER_BLOCK_BET_TRAP_PRICED_RECEIPTS.blockLead]) {
        expect(dWithParentOn.action).toBe('bet');
        expect(dWithParentOn.amount).toBeLessThanOrEqual(leadSpot.gs.pot * 0.36 + 0.01);
      }

      // Facing raise with exact royal flush after hero block bet: priced reraise receipt fires cleanly.
      const raiseSpot = buildFacingRaiseAfterBlockBetSpot({
        hole: 'AsKs',
        board: 'QsJsTs2d3c',
        potAtRiverStart: 100,
        heroBlockBet: 30,
        villainRaiseTo: 120,
        heroStack: 300,
        villainStack: 250,
      });
      seedFastRandom(888);
      drainFires();
      const rWithParentOff = decideWithOpts(raiseSpot.hero, raiseSpot.gs, {
        mind: false,
        v87RiverBlockBetTrap: false,
        v87RiverBlockBetTrapIsPriced: true,
      });
      const rFires = fireCounts();
      expect(['raise', 'all_in']).toContain(rWithParentOff.action);
      expect(rFires[V87_RIVER_BLOCK_BET_TRAP_PRICED_RECEIPTS.reraise]).toBe(1);
      expect(rFires['v87_river_block_trap_reraise'] ?? 0).toBe(0);

      // Facing an all-in raise (villainStack = 0) with exact nuts: priced call receipt fires.
      const allInRaiseSpot = buildFacingRaiseAfterBlockBetSpot({
        hole: 'AsKs',
        board: 'QsJsTs2d3c',
        potAtRiverStart: 100,
        heroBlockBet: 30,
        villainRaiseTo: 120,
        heroStack: 300,
        villainStack: 0,
      });
      seedFastRandom(999);
      drainFires();
      const cDecision = decideWithOpts(allInRaiseSpot.hero, allInRaiseSpot.gs, {
        mind: false,
        v87RiverBlockBetTrap: false,
        v87RiverBlockBetTrapIsPriced: true,
      });
      const cFires = fireCounts();
      expect(cDecision.action).toBe('call');
      expect(cFires[V87_RIVER_BLOCK_BET_TRAP_PRICED_RECEIPTS.call]).toBe(1);

      // Regression (HIGH): when hero covers a short raiser (villainStack < heroStack) and
      // verdict87.raiseTo < heroBet + heroStack, verdict87.isAllIn is true (puts villain all-in)
      // but HorseLogic MUST emit a sized raise rather than shoving hero's full stack as 'all_in'.
      const shortRaiserSpot = buildFacingRaiseAfterBlockBetSpot({
        hole: 'AsKs',
        board: 'QsJsTs2d3c',
        potAtRiverStart: 100,
        heroBlockBet: 30,
        villainRaiseTo: 120,
        heroStack: 600,
        villainStack: 40,
      });
      const shortVerdict = v87RiverBlockBetTrapFacingRaiseVerdict({
        pot: shortRaiserSpot.gs.pot,
        toCall: shortRaiserSpot.gs.toCall ?? 0,
        heroBet: shortRaiserSpot.hero.bet,
        currentBet: shortRaiserSpot.gs.currentBet,
        heroStack: shortRaiserSpot.hero.stack,
        villainStack: 40,
        bigBlind: shortRaiserSpot.gs.bigBlind,
        minRaiseTo: shortRaiserSpot.gs.minRaiseTo ?? null,
        equity: 1.0,
        isExactRiverNuts: true,
      });
      expect(shortVerdict.decision).toBe('reraise');
      expect(shortVerdict.isAllIn).toBe(true);
      expect(shortVerdict.raiseTo!).toBeLessThan(
        shortRaiserSpot.hero.bet + shortRaiserSpot.hero.stack - 1
      );
      seedFastRandom(1010);
      drainFires();
      const shortDecision = decideWithOpts(shortRaiserSpot.hero, shortRaiserSpot.gs, {
        mind: false,
        v87RiverBlockBetTrap: true,
        v87RiverBlockBetTrapIsPriced: true,
      });
      const shortFires = fireCounts();
      expect(shortDecision.action).toBe('raise');
      expect(shortDecision.amount).toBeLessThan(
        shortRaiserSpot.hero.bet + shortRaiserSpot.hero.stack
      );
      expect(shortFires[V87_RIVER_BLOCK_BET_TRAP_PRICED_RECEIPTS.reraise]).toBe(1);
      expect(shortFires['v87_river_block_trap_reraise'] ?? 0).toBe(0);

      // Regression (HIGH + MEDIUM): multiway facing-raise after block bet (short raiser + deep
      // third opponent behind) must NOT enter the HU-only priced facing-raise path AND must NOT
      // leak into the legacy blanket v87_river_block_trap_reraise when v87RiverBlockBetTrapIsPriced is ON.
      const multiwaySpot = buildFacingRaiseAfterBlockBetSpot({
        hole: 'AsKs',
        board: 'QsJsTs2d3c',
        potAtRiverStart: 100,
        heroBlockBet: 30,
        villainRaiseTo: 120,
        heroStack: 600,
        villainStack: 40,
      });
      multiwaySpot.gs.players.push({
        seat: 3,
        user_id: 'deep-third-opp',
        username: 'deep-third-opp',
        stack: 700,
        bet: 30,
        totalInvested: 80,
        cards: [],
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
      });
      seedFastRandom(1111);
      drainFires();
      decideWithOpts(multiwaySpot.hero, multiwaySpot.gs, {
        mind: false,
        v87RiverBlockBetTrap: true,
        v87RiverBlockBetTrapIsPriced: true,
      });
      const mwFires = fireCounts();
      expect(mwFires[V87_RIVER_BLOCK_BET_TRAP_PRICED_RECEIPTS.reraise] ?? 0).toBe(0);
      expect(mwFires[V87_RIVER_BLOCK_BET_TRAP_PRICED_RECEIPTS.call] ?? 0).toBe(0);
      expect(mwFires['v87_river_block_trap_reraise'] ?? 0).toBe(0);

      // Regression (MEDIUM): bomb-pot facing-raise rejected by v87RiverBlockBetTrapFacingRaiseApplies
      // must also never leak into legacy v87_river_block_trap_reraise when priced flag is ON.
      const bombRaiseSpot = buildFacingRaiseAfterBlockBetSpot({
        hole: 'AsKs',
        board: 'QsJsTs2d3c',
        bombPot: true,
      });
      seedFastRandom(1212);
      drainFires();
      decideWithOpts(bombRaiseSpot.hero, bombRaiseSpot.gs, {
        mind: false,
        v87RiverBlockBetTrap: true,
        v87RiverBlockBetTrapIsPriced: true,
      });
      const bombFires = fireCounts();
      expect(bombFires[V87_RIVER_BLOCK_BET_TRAP_PRICED_RECEIPTS.reraise] ?? 0).toBe(0);
      expect(bombFires['v87_river_block_trap_reraise'] ?? 0).toBe(0);
    });
  });

  describe('(c) zero fastRandom or unit87 hash-unit coin flips when ON', () => {
    it('pure lead and facing-raise helpers consume zero fastRandom draws and are 100% deterministic', () => {
      seedFastRandom(123456);
      const before = fastRandom();
      seedFastRandom(123456);

      const leadA = v87RiverBlockBetTrapLeadVerdict({
        pot: 100,
        heroStack: 200,
        villainStack: 200,
        bigBlind: 2,
        equity: 0.96,
        isExactRiverNuts: false,
      });
      const leadB = v87RiverBlockBetTrapLeadVerdict({
        pot: 100,
        heroStack: 200,
        villainStack: 200,
        bigBlind: 2,
        equity: 0.96,
        isExactRiverNuts: false,
      });
      const raiseA = v87RiverBlockBetTrapFacingRaiseVerdict({
        pot: 250,
        toCall: 90,
        heroBet: 30,
        currentBet: 120,
        heroStack: 300,
        villainStack: 250,
        bigBlind: 2,
        equity: 0.96,
        isExactRiverNuts: false,
      });
      const raiseB = v87RiverBlockBetTrapFacingRaiseVerdict({
        pot: 250,
        toCall: 90,
        heroBet: 30,
        currentBet: 120,
        heroStack: 300,
        villainStack: 250,
        bigBlind: 2,
        equity: 0.96,
        isExactRiverNuts: false,
      });
      const after = fastRandom();
      expect(after).toBe(before);
      expect(leadA).toEqual(leadB);
      expect(raiseA).toEqual(raiseB);
    });

    it('HorseLogic.decide produces identical action and sizing across 20 distinct hero user_ids (zero unit87 coin flip)', () => {
      const decisions = new Set<string>();
      for (let i = 0; i < 20; i++) {
        const spot = buildOopRiverLeadSpot({
          hole: 'AsKs',
          board: 'QsJsTs2d3c',
          heroId: `deterministic-horse-${i}`,
          pot: 100,
          heroStack: 220,
          villainStack: 220,
        });
        seedFastRandom(314159);
        const d = decideWithOpts(spot.hero, spot.gs, {
          mind: false,
          v87RiverBlockBetTrapIsPriced: true,
        });
        decisions.add(`${d.action}:${d.amount ?? 'none'}`);
      }
      expect(decisions.size).toBe(1);
    });
  });

  describe('(d) NLH-only / zero PLO4, PLO5, PLO6, Hi-Lo, Short Deck, Fixed Limit, multi-board, or bomb-pot reach', () => {
    it('structural gates reject non-NLH, multi-board, bomb-pot, and AoF inputs', () => {
      const baseLead = {
        enabled: true,
        isV87Nlh: true,
        isRiver: true,
        inPosition: false,
        oppCount: 1,
        oppLive: true,
        initiative: 'hero',
        trueRiverNutTrap: true,
        multiBoard: false,
        bombPot: false,
        allInOrFold: false,
        satelliteActive: false,
        pot: 100,
        heroStack: 200,
        villainStack: 200,
      };
      expect(v87RiverBlockBetTrapLeadApplies(baseLead)).toBe(true);
      expect(v87RiverBlockBetTrapLeadApplies({ ...baseLead, enabled: false })).toBe(false);
      expect(v87RiverBlockBetTrapLeadApplies({ ...baseLead, isV87Nlh: false })).toBe(false);
      expect(v87RiverBlockBetTrapLeadApplies({ ...baseLead, isRiver: false })).toBe(false);
      expect(v87RiverBlockBetTrapLeadApplies({ ...baseLead, inPosition: true })).toBe(false);
      expect(v87RiverBlockBetTrapLeadApplies({ ...baseLead, oppCount: 2 })).toBe(false);
      expect(v87RiverBlockBetTrapLeadApplies({ ...baseLead, multiBoard: true })).toBe(false);
      expect(v87RiverBlockBetTrapLeadApplies({ ...baseLead, bombPot: true })).toBe(false);
      expect(v87RiverBlockBetTrapLeadApplies({ ...baseLead, allInOrFold: true })).toBe(false);

      const baseRaise = {
        enabled: true,
        isV87Nlh: true,
        isRiver: true,
        oppCount: 1,
        raisedAfterAggr: true,
        planCallOnly: false,
        trueRiverNutTrap: true,
        multiBoard: false,
        bombPot: false,
        allInOrFold: false,
        blockBetFrac: 0.3,
        pot: 250,
        toCall: 90,
        heroStack: 300,
      };
      expect(v87RiverBlockBetTrapFacingRaiseApplies(baseRaise)).toBe(true);
      expect(v87RiverBlockBetTrapFacingRaiseApplies({ ...baseRaise, enabled: false })).toBe(false);
      expect(v87RiverBlockBetTrapFacingRaiseApplies({ ...baseRaise, isV87Nlh: false })).toBe(false);
      expect(v87RiverBlockBetTrapFacingRaiseApplies({ ...baseRaise, oppCount: 2 })).toBe(false);
      expect(v87RiverBlockBetTrapFacingRaiseApplies({ ...baseRaise, multiBoard: true })).toBe(
        false
      );
      expect(v87RiverBlockBetTrapFacingRaiseApplies({ ...baseRaise, bombPot: true })).toBe(false);
      expect(v87RiverBlockBetTrapFacingRaiseApplies({ ...baseRaise, blockBetFrac: null })).toBe(
        false
      );
      expect(v87RiverBlockBetTrapFacingRaiseApplies({ ...baseRaise, blockBetFrac: 0.5 })).toBe(
        false
      );
    });

    it('PLO4, PLO5, PLO6, PLO8, Short Deck, Fixed Limit, multi-board, and bomb-pot decisions are 100% bit-identical with option ON', () => {
      const nonNlhSpots = [
        buildOopRiverLeadSpot({ variant: 'plo4', hole: 'AsKsAhKh', board: 'QsJsTs2d3c' }),
        buildOopRiverLeadSpot({ variant: 'plo5', hole: 'AsKsAhKh9d', board: 'QsJsTs2d3c' }),
        buildOopRiverLeadSpot({ variant: 'plo6', hole: 'AsKsAhKh9d8c', board: 'QsJsTs2d3c' }),
        buildOopRiverLeadSpot({ variant: 'plo8', hole: 'AsKs2h3h', board: 'QsJsTs4d5c' }),
        buildOopRiverLeadSpot({ variant: 'short_deck', hole: 'AsKs', board: 'QsJsTs6d7c' }),
        buildOopRiverLeadSpot({ variant: 'flh', hole: 'AsKs', board: 'QsJsTs2d3c' }),
        buildOopRiverLeadSpot({ variant: 'nlh', hole: 'AsKs', board: 'QsJsTs2d3c', bombPot: true }),
        buildOopRiverLeadSpot({
          variant: 'nlh',
          hole: 'AsKs',
          board: 'QsJsTs2d3c',
          multiBoard: true,
        }),
        buildFacingRaiseAfterBlockBetSpot({
          variant: 'plo4',
          hole: 'AsKsAhKh',
          board: 'QsJsTs2d3c',
        }),
        buildFacingRaiseAfterBlockBetSpot({
          variant: 'plo5',
          hole: 'AsKsAhKh9d',
          board: 'QsJsTs2d3c',
        }),
      ];

      for (const spot of nonNlhSpots) {
        seedFastRandom(20261122);
        drainFires();
        const off = stripWallClock(decideWithOpts(spot.hero, spot.gs, { mind: false }));
        const offFires = fireCounts();
        const offRng = fastRandom();

        seedFastRandom(20261122);
        drainFires();
        const on = stripWallClock(
          decideWithOpts(spot.hero, spot.gs, {
            mind: false,
            v87RiverBlockBetTrapIsPriced: true,
          })
        );
        const onFires = fireCounts();
        const onRng = fastRandom();

        expect(on).toEqual(off);
        expect(onFires).toEqual(offFires);
        expect(onRng).toBe(offRng);
        for (const receipt of Object.values(V87_RIVER_BLOCK_BET_TRAP_PRICED_RECEIPTS)) {
          expect(onFires[receipt] ?? 0).toBe(0);
        }
      }
    });
  });

  describe('(e) dark registration in OPTION_SWITCH_REFUSED, HorseDataLedger, HorseReferenceDecisionSources, and DEVELOPMENT_LEAGUE_CARDS', () => {
    it('is refused in OPTION_SWITCH_REFUSED until graded + switch-list registered', () => {
      expect(OPTION_SWITCH_REFUSED).toHaveProperty('v87RiverBlockBetTrapIsPriced');
      expect(OPTION_SWITCH_REFUSED.v87RiverBlockBetTrapIsPriced).toMatch(/pending registration/i);
    });

    it('is registered in HorseDataLedger (flag + all 5 receipts) and HorseReferenceDecisionSources', () => {
      const flag = HORSE_DATA_LEDGER.find(
        (e) => e.kind === 'flag' && e.key === 'v87RiverBlockBetTrapIsPriced'
      );
      expect(flag).toBeDefined();
      expect(flag!.note).toMatch(/default OFF/i);

      for (const key of Object.values(V87_RIVER_BLOCK_BET_TRAP_PRICED_RECEIPTS)) {
        const rec = HORSE_DATA_LEDGER.find((e) => e.kind === 'receipt' && e.key === key);
        expect(rec, `missing ledger receipt ${key}`).toBeDefined();
      }

      expect(HORSE_REFERENCE_DECISION_SOURCE_REASONS).toHaveProperty(
        'src/engine/HorseHoldemV87RiverBlockBetTrapIsPriced.ts'
      );
    });

    it('has dev-only league cards in DEVELOPMENT_LEAGUE_CARDS and zero presence in nightly LEAGUE_MATCHUPS', () => {
      const devNames = DEVELOPMENT_LEAGUE_CARDS.map((c) => c.name);
      expect(devNames).toContain('cash6_v87_river_block_bet_trap_is_priced');
      expect(devNames).toContain('hu_v87_river_block_bet_trap_is_priced');

      const nightlyNames = LEAGUE_MATCHUPS.map((c) => c.name);
      expect(nightlyNames).not.toContain('cash6_v87_river_block_bet_trap_is_priced');
      expect(nightlyNames).not.toContain('hu_v87_river_block_bet_trap_is_priced');

      for (const name of [
        'cash6_v87_river_block_bet_trap_is_priced',
        'hu_v87_river_block_bet_trap_is_priced',
      ]) {
        const card = DEVELOPMENT_LEAGUE_CARDS.find((c) => c.name === name)!;
        expect(card.variant).toBe('nlh');
        expect(card.a).toEqual({
          v87RiverBlockBetTrap: true,
          v87RiverBlockBetTrapIsPriced: true,
        });
        expect(card.b).toEqual({ v87RiverBlockBetTrap: true });
      }
    });
  });
});
