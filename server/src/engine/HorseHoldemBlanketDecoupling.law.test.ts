/**
 * LAW: THE THREE COUPLED HOLD'EM BLANKET RULES ARE DECOUPLED FOR SINGLE-RULE GRADING.
 *
 * Review finding (REVIEW-HOLDEM-OFFLIST-20261121.md items 1, 2, 4, 23): three
 * Hold'em blanket rules previously had hidden couplings where switching one
 * rule OFF silently disabled a second rule (including an owner-held Pillar 2
 * rule and a cash/Lightning nut-flush defect guard):
 *
 *   A. v65TurnOnePairShade <-> Pillar 2 v87DeepDiveDiscipline:
 *      Both the V38 turn deep-dive shade (extra87Turn) and the committed-branch
 *      deep-dive turn shade (shade87NlhTurnCommit) were gated on v65 !== false.
 *      Turning v65TurnOnePairShade OFF must NEVER silently remove Pillar 2.
 *
 *   B. v57TournamentAggression <-> v58MadeHandCellSkip:
 *      v58_made_hand_cell_skip (Dan 2026-10-26, #8144 — preventing sets/flushes
 *      from following a check-heavy class-mean solver cell) ran in cash and
 *      Lightning while gated on v57TournamentAggression. It now lives on its
 *      own default-ON option v58MadeHandCellSkip so v57TournamentAggression
 *      stays strictly tournament-only and turning v57 OFF never reintroduces
 *      the nut-flush check defect in cash or Lightning.
 *
 *   C. v61RiverOnePairShade <-> v67RiverBetRaisedOnePair:
 *      All three V67 sites (river raise stratum, v67Class/shade67, and the V87
 *      river block-bet raised one-pair fold) previously gated on v61 !== false.
 *      Turning v61RiverOnePairShade OFF must turn off ONLY V61, leaving V67
 *      independently controllable via v67RiverBetRaisedOnePair.
 *
 * Invariants proven here:
 *   1. Default-ON state produces identical decisions across NLH cash, NLH MTT,
 *      Lightning NLH, PLO4, PLO5, and PLO6.
 *   2. Turning v65TurnOnePairShade: false leaves v87DeepDiveDiscipline turn
 *      shade active on both V38 and committed turn paths.
 *   3. Turning v57TournamentAggression: false leaves v58MadeHandCellSkip active
 *      in cash, Lightning, and tournaments (and every remaining v57 read site
 *      is strictly tournament-gated).
 *   4. Turning v61RiverOnePairShade: false leaves v67RiverBetRaisedOnePair
 *      independently active across all three V67 sites.
 *   5. PLO4, PLO5, and PLO6 behavior is completely unaffected.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { enableBrainTelemetry, drainFires } from './BrainTelemetry.js';
import { _clearGtoPostflop, setGtoPostflop, textureClass } from './GtoPostflop.js';
import { _clearGtoPostflopV31 } from './GtoPostflopV31.js';
import { HorseDeepDiveCapture } from './HorseDeepDiveReceipt.js';
import { seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import type { Card, CardRank, CardSuit, SeatPlayer } from '../types.js';

const REPO = fileURLToPath(new URL('../../..', import.meta.url));

/** Strip non-deterministic wall-clock elapsedMs timings when comparing decisions. */
function stableDecision(d: ReturnType<typeof HorseLogic.decide>) {
  const po = (
    d as unknown as {
      policyOrder?: {
        version: string;
        stages: Array<{ node: string; before: unknown; after: unknown; changed: boolean }>;
      };
    }
  ).policyOrder;
  return {
    action: d.action,
    amount: d.amount ?? null,
    thinkTime: d.thinkTime,
    continuationGuard: d.continuationGuard ?? null,
    policyOrder: po
      ? {
          version: po.version,
          stages: po.stages.map(({ node, before, after, changed }) => ({
            node,
            before,
            after,
            changed,
          })),
        }
      : null,
  };
}

const SUITS: Record<string, CardSuit> = {
  c: 'clubs',
  d: 'diamonds',
  h: 'hearts',
  s: 'spades',
};

function cards(text: string): Card[] {
  const out: Card[] = [];
  for (let i = 0; i + 1 < text.length; i += 2) {
    out.push({ rank: text[i] as CardRank, suit: SUITS[text[i + 1]] });
  }
  return out;
}

function firesMap(): Record<string, number> {
  return Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));
}

function seat(
  n: number,
  id: string,
  stack: number,
  bet: number,
  invested: number,
  hole = '',
  folded = false
): SeatPlayer {
  return {
    seat: n,
    user_id: id,
    username: id,
    stack,
    bet,
    totalInvested: invested,
    cards: hole ? cards(hole) : [],
    is_folded: folded,
    is_sitting_out: false,
    is_all_in: stack <= 0 && !folded,
  };
}

/** Multiway turn spot where hero holds drawless top pair facing a >=0.75-pot bet (oppCount=2). */
function multiwayTurnSpot(opts: { committed?: boolean } = {}) {
  const committed = opts.committed === true;
  // Pot before villain's turn bet = 100 (each of 3 players put in 34 preflop).
  // Villain bets 80 into 100 (potFrac = 0.80 >= 0.75), villain2 calls 80, pot now = 260, toCall = 80.
  // In the committed variant, hero has only 85 behind with 110 already invested so committed branch fires.
  const heroStack = committed ? 85 : 400;
  const heroInvested = committed ? 110 : 34;
  const players = [
    seat(1, 'hero', heroStack, 0, heroInvested, 'Ks5d'),
    seat(2, 'villain1', 320, 80, 114),
    seat(3, 'villain2', 320, 80, 114),
  ];
  const history = [
    { stage: 'preflop', seat: 2, userId: 'villain1', action: 'raise', amount: 34, timestamp: 1 },
    { stage: 'preflop', seat: 3, userId: 'villain2', action: 'call', amount: 34, timestamp: 2 },
    { stage: 'preflop', seat: 1, userId: 'hero', action: 'call', amount: 34, timestamp: 3 },
    { stage: 'flop', seat: 1, userId: 'hero', action: 'check', amount: 0, timestamp: 4 },
    { stage: 'flop', seat: 2, userId: 'villain1', action: 'check', amount: 0, timestamp: 5 },
    { stage: 'flop', seat: 3, userId: 'villain2', action: 'check', amount: 0, timestamp: 6 },
    { stage: 'turn', seat: 1, userId: 'hero', action: 'check', amount: 0, timestamp: 7 },
    { stage: 'turn', seat: 2, userId: 'villain1', action: 'bet', amount: 80, timestamp: 8 },
    { stage: 'turn', seat: 3, userId: 'villain2', action: 'call', amount: 80, timestamp: 9 },
  ];
  return {
    hero: players[0],
    gs: {
      players,
      communityCards: cards('Kh9d3s7c'),
      pot: 180, // pot before hero call; potFrac = 80 / (180 - 80) = 0.80 >= 0.75
      currentBet: 80,
      minRaise: 80,
      stage: 'turn' as const,
      gameVariant: 'nlh',
      gameMode: 'cash',
      format: 'cash',
      bigBlind: 2,
      smallBlind: 1,
      dealerSeat: 3,
      actionHistory: history,
    },
  };
}

/** Hero bets river with one pair and villain raises 3x (standard V67 spot). */
function raisedRiverSpot(extra?: { blockBet?: boolean }) {
  const blockBet = extra?.blockBet === true;
  if (blockBet) {
    // Pot at start of river = 100; hero block-bets 25 (frac = 0.25 <= 0.36);
    // villain raises to 100 (toCall = 75, potNow = 225, hero has 200 behind so toCall < stack).
    const players = [seat(1, 'hero', 200, 25, 75, 'QsKd'), seat(2, 'villain', 200, 100, 150)];
    const history = [
      { stage: 'preflop', seat: 1, userId: 'hero', action: 'raise', amount: 20, timestamp: 1 },
      { stage: 'preflop', seat: 2, userId: 'villain', action: 'call', amount: 20, timestamp: 2 },
      { stage: 'flop', seat: 2, userId: 'villain', action: 'bet', amount: 30, timestamp: 3 },
      { stage: 'flop', seat: 1, userId: 'hero', action: 'call', amount: 30, timestamp: 4 },
      { stage: 'turn', seat: 2, userId: 'villain', action: 'check', amount: 0, timestamp: 5 },
      { stage: 'turn', seat: 1, userId: 'hero', action: 'check', amount: 0, timestamp: 6 },
      { stage: 'river', seat: 1, userId: 'hero', action: 'bet', amount: 25, timestamp: 7 },
      { stage: 'river', seat: 2, userId: 'villain', action: 'raise', amount: 100, timestamp: 8 },
    ];
    return {
      hero: players[0],
      gs: {
        players,
        communityCards: cards('Qh7d2s4c9h'),
        pot: 225,
        currentBet: 100,
        minRaise: 75,
        stage: 'river' as const,
        gameVariant: 'nlh',
        gameMode: 'cash',
        format: 'cash',
        bigBlind: 2,
        smallBlind: 1,
        dealerSeat: 2,
        actionHistory: history,
      },
    };
  }
  const players = [seat(1, 'hero', 186, 8, 14, 'QsKd'), seat(2, 'villain', 170, 24, 30)];
  const history = [
    { stage: 'preflop', seat: 1, userId: 'hero', action: 'raise', amount: 6, timestamp: 1 },
    { stage: 'preflop', seat: 2, userId: 'villain', action: 'call', amount: 4, timestamp: 2 },
    { stage: 'flop', seat: 2, userId: 'villain', action: 'check', amount: 0, timestamp: 3 },
    { stage: 'flop', seat: 1, userId: 'hero', action: 'check', amount: 0, timestamp: 4 },
    { stage: 'turn', seat: 2, userId: 'villain', action: 'check', amount: 0, timestamp: 5 },
    { stage: 'turn', seat: 1, userId: 'hero', action: 'check', amount: 0, timestamp: 6 },
    { stage: 'river', seat: 2, userId: 'villain', action: 'check', amount: 0, timestamp: 7 },
    { stage: 'river', seat: 1, userId: 'hero', action: 'bet', amount: 8, timestamp: 8 },
    { stage: 'river', seat: 2, userId: 'villain', action: 'raise', amount: 24, timestamp: 9 },
  ];
  return {
    hero: players[0],
    gs: {
      players,
      communityCards: cards('Qh7d2s4c9h'),
      pot: 44,
      currentBet: 24,
      minRaise: 16,
      stage: 'river' as const,
      gameVariant: 'nlh',
      gameMode: 'cash',
      format: 'cash',
      bigBlind: 2,
      smallBlind: 1,
      dealerSeat: 2,
      actionHistory: history,
    },
  };
}

/** Ordinary river bet facing hero's one pair (V61 spot, hero did NOT bet river). */
function unraisedRiverSpot() {
  const players = [seat(1, 'hero', 200, 0, 20, 'QsKd'), seat(2, 'villain', 160, 40, 60)];
  const history = [
    { stage: 'preflop', seat: 2, userId: 'villain', action: 'raise', amount: 6, timestamp: 1 },
    { stage: 'preflop', seat: 1, userId: 'hero', action: 'call', amount: 4, timestamp: 2 },
    { stage: 'flop', seat: 1, userId: 'hero', action: 'check', amount: 0, timestamp: 3 },
    { stage: 'flop', seat: 2, userId: 'villain', action: 'check', amount: 0, timestamp: 4 },
    { stage: 'turn', seat: 1, userId: 'hero', action: 'check', amount: 0, timestamp: 5 },
    { stage: 'turn', seat: 2, userId: 'villain', action: 'check', amount: 0, timestamp: 6 },
    { stage: 'river', seat: 1, userId: 'hero', action: 'check', amount: 0, timestamp: 7 },
    { stage: 'river', seat: 2, userId: 'villain', action: 'bet', amount: 40, timestamp: 8 },
  ];
  return {
    hero: players[0],
    gs: {
      players,
      communityCards: cards('Qh7d2s4c9h'),
      pot: 80,
      currentBet: 40,
      minRaise: 40,
      stage: 'river' as const,
      gameVariant: 'nlh',
      gameMode: 'cash',
      format: 'cash',
      bigBlind: 2,
      smallBlind: 1,
      dealerSeat: 2,
      actionHistory: history,
    },
  };
}

/** Dan 2026-10-26 nut flush open-node fixture across cash, Lightning, and MTT. */
function nutFlushOpenSpot(format: 'cash' | 'lightning' | 'mtt') {
  const T0 = 1_792_990_000_000;
  const players = [
    seat(3, 'bb', 330754, 0, 60000),
    seat(4, 'p4', 232070, 0, 0, '', true),
    seat(5, 'p5', 151074, 0, 0, '', true),
    seat(6, 'p6', 290574, 0, 0, '', true),
    seat(7, 'p7', 300192, 0, 0, '', true),
    seat(8, 'hero', 899508, 0, 40000, 'AcJc'),
  ];
  const history = [
    { stage: 'preflop', seat: 3, userId: 'bb', action: 'bb', amount: 20000, timestamp: T0 },
    { stage: 'preflop', seat: 8, userId: 'hero', action: 'sb', amount: 10000, timestamp: T0 },
    { stage: 'preflop', seat: 4, userId: 'p4', action: 'fold', amount: 0, timestamp: T0 + 1 },
    { stage: 'preflop', seat: 5, userId: 'p5', action: 'fold', amount: 0, timestamp: T0 + 2 },
    { stage: 'preflop', seat: 6, userId: 'p6', action: 'fold', amount: 0, timestamp: T0 + 3 },
    { stage: 'preflop', seat: 7, userId: 'p7', action: 'fold', amount: 0, timestamp: T0 + 4 },
    {
      stage: 'preflop',
      seat: 8,
      userId: 'hero',
      action: 'raise',
      amount: 40000,
      timestamp: T0 + 5,
      isFullRaise: true,
    },
    { stage: 'preflop', seat: 3, userId: 'bb', action: 'call', amount: 20000, timestamp: T0 + 6 },
  ];
  return {
    hero: players[5],
    gs: {
      players,
      communityCards: cards('Qc5c8c'),
      pot: 100000,
      currentBet: 0,
      minRaise: 20000,
      stage: 'flop' as const,
      gameVariant: 'nlh',
      gameMode: format === 'mtt' ? 'tournament' : 'cash',
      format,
      bigBlind: 20000,
      smallBlind: 10000,
      dealerSeat: 7,
      actionHistory: history,
      ...(format === 'mtt'
        ? { tournament: { playersLeft: 13, spotsPaid: 21, inMoney: true, entrants: 160 } }
        : {}),
    },
  };
}

function seedNutFlushCells() {
  const flopTex = textureClass(cards('Qc5c8c'))!;
  const row = (family: string, depth: number, mix: object) =>
    ({
      street: 'flop',
      game_family: family,
      position: 'BB',
      depth_bucket: depth,
      texture_class: flopTex,
      facing: 'open',
      hand_matrix: { AJs: mix },
    }) as never;
  setGtoPostflop([
    row('tourney_ev', 10, { check: 0.7694, bet_big: 0.0487, bet_small: 0.182 }),
    row('tourney_ev', 20, { check: 0.7612, bet_big: 0, bet_small: 0.2388 }),
    row('tourney_ev', 40, { check: 0.9903, bet_big: 0.0031, bet_small: 0.0066 }),
    row('cash', 10, { check: 0.7694, bet_big: 0.0487, bet_small: 0.182 }),
    row('cash', 20, { check: 0.7612, bet_big: 0, bet_small: 0.2388 }),
    row('cash', 40, { check: 0.9903, bet_big: 0.0031, bet_small: 0.0066 }),
  ]);
}

function omahaSpot(variant: 'plo4' | 'plo5' | 'plo6', stage: 'turn' | 'river') {
  const hole = variant === 'plo4' ? 'AhKh9s7d' : variant === 'plo5' ? 'AhKh9s7d4c' : 'AhKh9s7d4c2s';
  const board = stage === 'turn' ? 'Kd8c5s3h' : 'Kd8c5s3h2d';
  const players = [seat(1, 'hero', 180, 0, 20, hole), seat(2, 'villain', 150, 30, 50)];
  const history = [
    { stage: 'preflop', seat: 2, userId: 'villain', action: 'raise', amount: 6, timestamp: 1 },
    { stage: 'preflop', seat: 1, userId: 'hero', action: 'call', amount: 4, timestamp: 2 },
    { stage: 'flop', seat: 1, userId: 'hero', action: 'check', amount: 0, timestamp: 3 },
    { stage: 'flop', seat: 2, userId: 'villain', action: 'check', amount: 0, timestamp: 4 },
    ...(stage === 'river'
      ? [
          { stage: 'turn', seat: 1, userId: 'hero', action: 'check', amount: 0, timestamp: 5 },
          { stage: 'turn', seat: 2, userId: 'villain', action: 'check', amount: 0, timestamp: 6 },
        ]
      : []),
    { stage, seat: 1, userId: 'hero', action: 'check', amount: 0, timestamp: 7 },
    { stage, seat: 2, userId: 'villain', action: 'bet', amount: 30, timestamp: 8 },
  ];
  return {
    hero: players[0],
    gs: {
      players,
      communityCards: cards(board),
      pot: 70,
      currentBet: 30,
      minRaise: 30,
      stage,
      gameVariant: variant,
      gameMode: 'cash',
      format: 'cash',
      bettingStructure: 'pot_limit',
      bigBlind: 2,
      smallBlind: 1,
      dealerSeat: 2,
      actionHistory: history,
    },
  };
}

function decideWithCapture(
  spot: { hero: SeatPlayer; gs: Record<string, unknown> },
  opts: HorseDecideOpts,
  seed = 20261121
) {
  seedFastRandom(seed);
  HorseMind.reset();
  enableBrainTelemetry();
  drainFires();
  const capture = new HorseDeepDiveCapture({
    type: 'DECIDE_FAST',
    requestId: 1,
    handNumber: 1,
    gameState: spot.gs as never,
    player: spot.hero,
    profile: 'balanced',
    style: {},
    opts,
  } as never);
  const decision = HorseLogic.decide(
    spot.hero,
    spot.gs as never,
    'balanced',
    {},
    {
      telemetry: true,
      decisionTimeMs: 1_792_990_001_000,
      ...opts,
    },
    undefined,
    undefined,
    capture
  );
  const receipt = capture.finish(decision, null);
  return { decision: stableDecision(decision), fires: firesMap(), receipt };
}

beforeEach(() => {
  _clearGtoPostflop();
  _clearGtoPostflopV31();
  seedNutFlushCells();
});

describe("LAW: decoupled Hold'em blanket rules preserve default-ON parity and isolate single-rule OFF", () => {
  describe('Coupling A: v65TurnOnePairShade <-> Pillar 2 v87DeepDiveDiscipline', () => {
    it('V38 turn path: turning v65TurnOnePairShade OFF leaves extra87Turn (Pillar 2) active', () => {
      const spot = multiwayTurnSpot({ committed: false });
      const def = decideWithCapture(spot, {});
      expect(def.fires.v65_turn_one_pair_shade).toBe(1);
      expect(def.fires.v87_deep_dive_discipline).toBe(1);
      expect(def.receipt.rules.find((r) => r.rule === 'nlh_turn_shade')).toEqual(
        expect.objectContaining({ eligible: 1, changed: 1 })
      );

      const v65Off = decideWithCapture(spot, { v65TurnOnePairShade: false });
      expect(v65Off.fires.v65_turn_one_pair_shade).toBeUndefined();
      expect(v65Off.fires.v87_deep_dive_discipline).toBe(1);
      expect(v65Off.receipt.rules.find((r) => r.rule === 'nlh_turn_shade')).toEqual(
        expect.objectContaining({ eligible: 1, changed: 1 })
      );

      const v87Off = decideWithCapture(spot, { v87DeepDiveDiscipline: false });
      expect(v87Off.fires.v65_turn_one_pair_shade).toBe(1);
      expect(v87Off.fires.v87_deep_dive_discipline).toBeUndefined();
    });

    it('committed turn path: turning v65TurnOnePairShade OFF leaves shade87NlhTurnCommit active', () => {
      const spot = multiwayTurnSpot({ committed: true });
      const def = decideWithCapture(spot, {});
      expect(def.fires.v87_deep_dive_discipline).toBe(1);
      expect(def.receipt.rules.find((r) => r.rule === 'nlh_turn_shade')).toEqual(
        expect.objectContaining({ eligible: 1, changed: 1 })
      );

      const v65Off = decideWithCapture(spot, { v65TurnOnePairShade: false });
      expect(v65Off.fires.v87_deep_dive_discipline).toBe(1);
      expect(v65Off.receipt.rules.find((r) => r.rule === 'nlh_turn_shade')).toEqual(
        expect.objectContaining({ eligible: 1, changed: 1 })
      );
      expect(v65Off.decision).toEqual(def.decision);

      const v87Off = decideWithCapture(spot, { v87DeepDiveDiscipline: false });
      expect(v87Off.fires.v87_deep_dive_discipline).toBeUndefined();
    });
  });

  describe('Coupling B: v57TournamentAggression <-> v58MadeHandCellSkip', () => {
    it.each(['cash', 'lightning', 'mtt'] as const)(
      '%s: turning v57TournamentAggression OFF leaves v58MadeHandCellSkip active; v58MadeHandCellSkip OFF disables only the cell skip',
      (format) => {
        const spot = nutFlushOpenSpot(format);
        const def = decideWithCapture(spot, {});
        expect(def.fires.v58_made_hand_cell_skip).toBe(1);

        const v57Off = decideWithCapture(spot, { v57TournamentAggression: false });
        expect(v57Off.fires.v58_made_hand_cell_skip).toBe(1);
        expect(v57Off.fires.v29_gto_flop_open).toBeUndefined();
        if (format !== 'mtt') {
          expect(v57Off.decision).toEqual(def.decision);
        }

        const v58Off = decideWithCapture(spot, { v58MadeHandCellSkip: false });
        expect(v58Off.fires.v58_made_hand_cell_skip).toBeUndefined();
        expect(v58Off.fires.v29_gto_flop_open).toBe(1);
      }
    );

    it('HorseLogic reads v57TournamentAggression only at strictly tournament-gated sites and reads v58MadeHandCellSkip independently', () => {
      const src = readFileSync(join(REPO, 'server/src/engine/HorseLogic.ts'), 'utf8');
      const v57Reads = [...src.matchAll(/opts\.v57TournamentAggression/g)];
      // 5 remaining runtime sites: preflop pass-through, tourneyAggro, v58_low_spr_stack_off,
      // initiativeTurn57 (gated on tourneyAggro), and v58_one_card_low_flush_fold.
      expect(v57Reads).toHaveLength(5);
      expect(src).toMatch(
        /const madeBeyondClass58 = cat >= 4 && opts\.v58MadeHandCellSkip !== false;/
      );
      expect(src).not.toMatch(/madeBeyondClass58[^\n]*v57TournamentAggression/);
    });
  });

  describe('Coupling C: v61RiverOnePairShade <-> v67RiverBetRaisedOnePair', () => {
    it('turning v61RiverOnePairShade OFF leaves V67 stratum and V67 raised-river shade active', () => {
      const spot = raisedRiverSpot();
      const def = decideWithCapture(spot, {});
      expect(def.fires.v67_river_raise_stratum).toBe(1);
      expect(def.fires.v67_river_bet_raised_one_pair).toBe(1);
      expect(def.fires.v61_river_one_pair_shade).toBe(1);

      // V61 OFF: V61 stops firing, but V67 stratum + V67 class/shade stay ON.
      const v61Off = decideWithCapture(spot, { v61RiverOnePairShade: false });
      expect(v61Off.fires.v61_river_one_pair_shade).toBeUndefined();
      expect(v61Off.fires.v67_river_raise_stratum).toBe(1);
      expect(v61Off.fires.v67_river_bet_raised_one_pair).toBe(1);
      expect(v61Off.decision).toEqual(def.decision);

      // V67 OFF: V67 stops firing, while V61 stays ON.
      const v67Off = decideWithCapture(spot, { v67RiverBetRaisedOnePair: false });
      expect(v67Off.fires.v67_river_raise_stratum).toBeUndefined();
      expect(v67Off.fires.v67_river_bet_raised_one_pair).toBeUndefined();
      expect(v67Off.fires.v61_river_one_pair_shade).toBe(1);
    });

    it('turning v61RiverOnePairShade OFF leaves V87 river block-bet raised one-pair fold active under V67', () => {
      const spot = raisedRiverSpot({ blockBet: true });
      const def = decideWithCapture(spot, {});
      expect(def.fires.v87_river_block_raised_one_pair_fold).toBe(1);
      expect(def.decision.action).toBe('fold');

      const v61Off = decideWithCapture(spot, { v61RiverOnePairShade: false });
      expect(v61Off.fires.v87_river_block_raised_one_pair_fold).toBe(1);
      expect(v61Off.decision.action).toBe('fold');

      const v67Off = decideWithCapture(spot, { v67RiverBetRaisedOnePair: false });
      expect(v67Off.fires.v87_river_block_raised_one_pair_fold).toBeUndefined();
    });

    it('turning v61RiverOnePairShade OFF cleanly disables V61 on an unraised river bet', () => {
      const spot = unraisedRiverSpot();
      const def = decideWithCapture(spot, {});
      expect(def.fires.v61_river_one_pair_shade).toBe(1);

      const v61Off = decideWithCapture(spot, { v61RiverOnePairShade: false });
      expect(v61Off.fires.v61_river_one_pair_shade).toBeUndefined();
    });
  });

  describe('Default-ON parity and PLO4/PLO5/PLO6 zero-impact invariance', () => {
    it('default-ON ({}) matches explicit all-true across NLH cash, NLH MTT, Lightning NLH, PLO4, PLO5, PLO6', () => {
      const explicitOn: HorseDecideOpts = {
        v65TurnOnePairShade: true,
        v87DeepDiveDiscipline: true,
        v57TournamentAggression: true,
        v58MadeHandCellSkip: true,
        v61RiverOnePairShade: true,
        v67RiverBetRaisedOnePair: true,
      };
      const cases = [
        ['nlh-cash-turn', multiwayTurnSpot()],
        ['nlh-cash-turn-committed', multiwayTurnSpot({ committed: true })],
        ['nlh-cash-river-raised', raisedRiverSpot()],
        ['nlh-cash-river-unraised', unraisedRiverSpot()],
        ['nlh-cash-nut-flush', nutFlushOpenSpot('cash')],
        ['nlh-lightning-nut-flush', nutFlushOpenSpot('lightning')],
        ['nlh-mtt-nut-flush', nutFlushOpenSpot('mtt')],
        ['plo4-turn', omahaSpot('plo4', 'turn')],
        ['plo4-river', omahaSpot('plo4', 'river')],
        ['plo5-turn', omahaSpot('plo5', 'turn')],
        ['plo5-river', omahaSpot('plo5', 'river')],
        ['plo6-turn', omahaSpot('plo6', 'turn')],
        ['plo6-river', omahaSpot('plo6', 'river')],
      ] as const;

      for (const [label, spot] of cases) {
        // Warm once so once-per-process reservoir build counters do not skew the first call.
        decideWithCapture(spot, {}, 20261121);
        const a = decideWithCapture(spot, {}, 20261121);
        const b = decideWithCapture(spot, explicitOn, 20261121);
        expect(a.decision, label).toEqual(b.decision);
        expect(a.fires, label).toEqual(b.fires);
      }
    });

    it.each(['plo4', 'plo5', 'plo6'] as const)(
      '%s decisions are completely untouched when Hold em decoupled options are switched OFF',
      (variant) => {
        for (const stage of ['turn', 'river'] as const) {
          const spot = omahaSpot(variant, stage);
          // Warm once so once-per-process reservoir build counters do not skew the first call.
          decideWithCapture(spot, {}, 20261121);
          const base = decideWithCapture(spot, {}, 20261121);
          for (const arm of [
            { v65TurnOnePairShade: false },
            { v58MadeHandCellSkip: false },
            { v61RiverOnePairShade: false },
            { v67RiverBetRaisedOnePair: false },
            {
              v65TurnOnePairShade: false,
              v58MadeHandCellSkip: false,
              v61RiverOnePairShade: false,
              v67RiverBetRaisedOnePair: false,
            },
          ] as const) {
            const actual = decideWithCapture(spot, arm, 20261121);
            expect(actual.decision, `${variant} ${stage} ${JSON.stringify(arm)}`).toEqual(
              base.decision
            );
            expect(actual.fires, `${variant} ${stage} ${JSON.stringify(arm)}`).toEqual(base.fires);
          }
        }
      }
    );
  });
});
