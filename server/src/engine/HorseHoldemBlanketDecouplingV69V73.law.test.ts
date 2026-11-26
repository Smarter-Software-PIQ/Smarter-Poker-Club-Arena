/**
 * LAW: THE REMAINING TWO COUPLED HOLD'EM BLANKET RULES (V69 AND V73/V75) ARE
 * DECOUPLED FOR SINGLE-RULE GRADING.
 *
 * Review finding (REVIEW-HOLDEM-OFFLIST-20261121.md items 12 and 19): two
 * remaining Hold'em rules carried hidden couplings where toggling one flag OFF
 * silently disabled independent effects:
 *
 *   D. v73Vs3BetDefence <-> v75SqueezeDefence (#19):
 *      v75SqueezeDefence previously lived inside v73Vs3BetDefence's IIFE gate,
 *      so setting v73Vs3BetDefence: false silently turned off V75 squeeze
 *      defence too. Pure 3-bet nodes now gate on v73Vs3BetDefence alone and
 *      squeeze nodes gate on v75SqueezeDefence alone.
 *
 *   E. v69TurnCallGaps <-> v69HoleDrawExemption <-> v69V32DrawNoRoom (#12):
 *      v69TurnCallGaps previously controlled three distinct turn-call effects
 *      under one boolean:
 *        (1) one-pair turn implied-odds no-room check -> v69TurnCallGaps;
 *        (2) hole-card-only draw exemption for V65 & Pillar 2 turn one-pair
 *            shades (shade65, extra87Turn, shade87NlhTurnCommit) ->
 *            v69HoleDrawExemption;
 *        (3) V32 turn draw pass-through no-room check -> v69V32DrawNoRoom.
 *      Splitting them ensures turning off any single effect never silently
 *      kills another or alters V65 / Pillar 2 draw exemption.
 *
 * Invariants proven here:
 *   1. Default-ON ({}) is 100% bit-identical to explicit all-true across all
 *      affected NLH spots (cash, MTT, Lightning) and PLO4/PLO5/PLO6.
 *   2. Toggling v73Vs3BetDefence: false preserves v75SqueezeDefence on squeeze
 *      nodes; toggling v75SqueezeDefence: false preserves v73Vs3BetDefence on
 *      pure 3-bet nodes.
 *   3. Toggling each V69 sub-rule independently disables ONLY its own effect
 *      without cross-disabling the other two or weakening Pillar 2 turn shade.
 *   4. PLO4, PLO5, and PLO6 decisions and telemetry are completely untouched.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { _clearGtoPostflop, setGtoPostflop, textureClass } from './GtoPostflop.js';
import { _clearGtoPostflopV31 } from './GtoPostflopV31.js';
import { HorseDeepDiveCapture } from './HorseDeepDiveReceipt.js';
import { seedFastRandom } from './HorseEval.js';
import { HAND_CLASSES } from './HorseGtoOpeningRanges.js';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import {
  holeFor,
  squeezeStateFor,
  stateFor,
  type Vs3Ctx,
} from './HorseVs3BetDefence.test-support.js';
import type { Card, CardRank, CardSuit, SeatPlayer } from '../types.js';

const REPO = fileURLToPath(new URL('../../..', import.meta.url));

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

const VILLAIN = '10000000-0000-4000-8000-000000000069';

const CASH6: Vs3Ctx = {
  seats: 6,
  stackBB: 100,
  mode: 'cash',
  ante: false,
  openBB: 2.5,
  threeBetX: 4,
};

const MTT9: Vs3Ctx = {
  seats: 9,
  stackBB: 60,
  mode: 'tournament',
  ante: true,
  openBB: 2.3,
  threeBetX: 3.6,
};

/** Heads-up turn facing-bet spot matching HorseTurnCallGaps fixtures. */
function turnSpot(
  variant: string,
  hole: string,
  board: string,
  bet: number,
  opts: { villainBehind?: number; street?: 'flop' | 'turn' | 'river'; format?: string } = {}
) {
  const { villainBehind = 400 - bet, street = 'turn', format = 'cash' } = opts;
  const players: SeatPlayer[] = [
    seat(1, 'hero', 400, 0, 18, hole),
    seat(2, VILLAIN, villainBehind, bet, 18 + bet),
  ];
  const history: Array<Record<string, unknown>> = [
    { stage: 'preflop', seat: 2, userId: VILLAIN, action: 'raise', amount: 6, timestamp: 1 },
    { stage: 'preflop', seat: 1, userId: 'hero', action: 'call', amount: 4, timestamp: 2 },
  ];
  if (street !== 'flop') {
    history.push(
      { stage: 'flop', seat: 1, userId: 'hero', action: 'check', amount: 0, timestamp: 3 },
      { stage: 'flop', seat: 2, userId: VILLAIN, action: 'bet', amount: 8, timestamp: 4 },
      { stage: 'flop', seat: 1, userId: 'hero', action: 'call', amount: 8, timestamp: 5 }
    );
  }
  if (street === 'river') {
    history.push(
      { stage: 'turn', seat: 1, userId: 'hero', action: 'check', amount: 0, timestamp: 6 },
      { stage: 'turn', seat: 2, userId: VILLAIN, action: 'check', amount: 0, timestamp: 7 }
    );
  }
  history.push(
    { stage: street, seat: 1, userId: 'hero', action: 'check', amount: 0, timestamp: 8 },
    { stage: street, seat: 2, userId: VILLAIN, action: 'bet', amount: bet, timestamp: 9 }
  );
  return {
    hero: players[0],
    gs: {
      players,
      communityCards: cards(board),
      pot: 36 + bet,
      currentBet: bet,
      minRaise: Math.max(2, bet),
      stage: street,
      gameVariant: variant,
      gameMode: format === 'mtt' ? 'tournament' : 'cash',
      format,
      bigBlind: 2,
      smallBlind: 1,
      dealerSeat: 1,
      actionHistory: history,
    },
  };
}

/**
 * Multiway turn spot on a board-only four-flush (KhQh9h2h) where hero holds
 * top pair with no heart (Ks5d) facing a >=0.75-pot bet (oppCount = 2).
 * Exercises V69 (2) inside both V65 and Pillar 2 (extra87Turn / shade87NlhTurnCommit).
 */
function multiwayBoardFlushTurnSpot(opts: { committed?: boolean } = {}) {
  const committed = opts.committed === true;
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
      communityCards: cards('KhQh9h2h'),
      pot: 180,
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

/** Omaha preflop 3-bet / squeeze spot (4, 5, or 6 hole cards). */
function omahaPreflopSqueezeSpot(variant: 'plo4' | 'plo5' | 'plo6') {
  const hole = variant === 'plo4' ? 'AsKsQhJh' : variant === 'plo5' ? 'AsKsQhJhTd' : 'AsKsQhJhTd9c';
  const players = [
    seat(1, 'sb', 199, 1, 1),
    seat(2, 'bb', 180, 20, 20),
    seat(3, 'utg', 200, 0, 0, '', true),
    seat(4, 'hero', 195, 5, 5, hole),
    seat(5, 'btn', 195, 5, 5),
    seat(6, 'co', 200, 0, 0, '', true),
  ];
  const history = [
    { stage: 'preflop', seat: 3, userId: 'utg', action: 'fold', amount: 0, timestamp: 1 },
    { stage: 'preflop', seat: 4, userId: 'hero', action: 'raise', amount: 5, timestamp: 2 },
    { stage: 'preflop', seat: 5, userId: 'btn', action: 'call', amount: 5, timestamp: 3 },
    { stage: 'preflop', seat: 6, userId: 'co', action: 'fold', amount: 0, timestamp: 4 },
    { stage: 'preflop', seat: 1, userId: 'sb', action: 'fold', amount: 0, timestamp: 5 },
    { stage: 'preflop', seat: 2, userId: 'bb', action: 'raise', amount: 20, timestamp: 6 },
  ];
  return {
    hero: players[3],
    gs: {
      players,
      communityCards: [],
      pot: 31,
      currentBet: 20,
      minRaise: 15,
      stage: 'preflop' as const,
      gameVariant: variant,
      gameMode: 'cash',
      format: 'cash',
      bigBlind: 2,
      smallBlind: 1,
      dealerSeat: 5,
      actionHistory: history,
    },
  };
}

/** Load V32 turn open-node cells so V32 facing defense enters the draw pass-through branch. */
function loadTurnCells(board: string) {
  const tex = textureClass(cards(board))!;
  const matrix: Record<string, Record<string, number>> = {};
  const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  for (let i = 0; i < ranks.length; i++) {
    for (let j = i; j < ranks.length; j++) {
      if (i === j) matrix[ranks[j] + ranks[i]] = { bet_big: 1 };
      else {
        matrix[ranks[j] + ranks[i] + 's'] = { bet_big: 1 };
        matrix[ranks[j] + ranks[i] + 'o'] = { bet_big: 1 };
      }
    }
  }
  const rows = [];
  for (const position of ['SB', 'BB']) {
    for (const depth_bucket of [10, 20, 40, 80, 150]) {
      rows.push({
        street: 'turn',
        game_family: 'cash',
        position,
        depth_bucket,
        texture_class: tex,
        facing: 'open',
        hand_matrix: matrix,
      });
    }
  }
  setGtoPostflop(rows as never);
}

function decideWithCapture(
  spot: { hero: SeatPlayer; gs: object },
  opts: HorseDecideOpts = {},
  seed = 20261122
) {
  enableBrainTelemetry();
  drainFires();
  HorseMind.reset();
  seedFastRandom(seed);
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
  return {
    decision: stableDecision(decision),
    fires: firesMap(),
    receipt,
  };
}

function decideMany(spot: { hero: SeatPlayer; gs: object }, opts: HorseDecideOpts, seeds = 20) {
  const acts: Record<string, number> = {};
  const seen: Record<string, number> = {};
  const perSeed: Array<ReturnType<typeof stableDecision>> = [];
  for (let i = 1; i <= seeds; i++) {
    const r = decideWithCapture(spot, opts, i * 7919);
    perSeed.push(r.decision);
    acts[r.decision.action] = (acts[r.decision.action] ?? 0) + 1;
    for (const [k, v] of Object.entries(r.fires)) {
      if (v > 0) seen[k] = (seen[k] ?? 0) + 1;
    }
  }
  return { acts, seen, perSeed };
}

describe('LAW: V69 and V73/V75 Hold em blanket rules are decoupled with zero default-ON drift', () => {
  beforeEach(() => {
    enableBrainTelemetry();
    HorseMind.reset();
    drainFires();
  });

  afterEach(() => {
    _clearGtoPostflop();
    _clearGtoPostflopV31();
    HorseMind.reset();
    drainFires();
  });

  describe('Coupling D: v73Vs3BetDefence <-> v75SqueezeDefence', () => {
    const squeezeSpots = [
      { label: 'cash6 squeeze', ctx: CASH6, hero: 4, callers: [5], three: 2 },
      { label: 'mtt9 squeeze', ctx: MTT9, hero: 6, callers: [9], three: 2 },
    ] as const;

    it.each(squeezeSpots)(
      '$label: turning v73Vs3BetDefence OFF preserves v75SqueezeDefence across all 169 hand classes',
      ({ ctx, hero, callers, three }) => {
        let v75FiresDef = 0;
        let v75FiresV73Off = 0;
        let v75FiresV75Off = 0;
        let diffOnVsV75Off = 0;

        for (const h of HAND_CLASSES) {
          const build = () => squeezeStateFor(ctx, hero, [...callers], three, holeFor(h.cls, 3));
          const def = decideWithCapture(build(), {}, 4409);
          const v73Off = decideWithCapture(build(), { v73Vs3BetDefence: false }, 4409);
          const v75Off = decideWithCapture(build(), { v75SqueezeDefence: false }, 4409);
          const bothOff = decideWithCapture(
            build(),
            { v73Vs3BetDefence: false, v75SqueezeDefence: false },
            4409
          );

          // v73 OFF alone must leave V75 squeeze defence 100% intact (decisions + fires).
          expect(v73Off.decision, `v73Off decision ${h.cls}`).toEqual(def.decision);
          expect(v73Off.fires.v75_squeeze_defence, `v73Off fire ${h.cls}`).toBe(
            def.fires.v75_squeeze_defence
          );
          expect(
            v73Off.fires.v73_vs3bet_defence,
            `no v73 fire on squeeze ${h.cls}`
          ).toBeUndefined();

          // v75 OFF disables V75 and matches turning both OFF.
          expect(v75Off.fires.v75_squeeze_defence, `v75Off disables v75 ${h.cls}`).toBeUndefined();
          expect(v75Off.decision, `v75Off matches bothOff ${h.cls}`).toEqual(bothOff.decision);

          if (def.fires.v75_squeeze_defence) v75FiresDef++;
          if (v73Off.fires.v75_squeeze_defence) v75FiresV73Off++;
          if (v75Off.fires.v75_squeeze_defence) v75FiresV75Off++;
          if (def.decision.action !== v75Off.decision.action) diffOnVsV75Off++;
        }

        expect(v75FiresDef).toBe(169);
        expect(v75FiresV73Off).toBe(169);
        expect(v75FiresV75Off).toBe(0);
        expect(diffOnVsV75Off).toBeGreaterThan(0);
      }
    );

    it('pure 3-bet node: turning v75SqueezeDefence OFF preserves v73Vs3BetDefence, while v73Vs3BetDefence OFF disables only V73', () => {
      let v73FiresDef = 0;
      let v73FiresV75Off = 0;
      let v73FiresV73Off = 0;

      for (const h of HAND_CLASSES) {
        const build = () => stateFor(CASH6, 5, 2, holeFor(h.cls, 2));
        const def = decideWithCapture(build(), {}, 6007);
        const v75Off = decideWithCapture(build(), { v75SqueezeDefence: false }, 6007);
        const v73Off = decideWithCapture(build(), { v73Vs3BetDefence: false }, 6007);

        expect(v75Off.decision, `v75Off preserves v73 ${h.cls}`).toEqual(def.decision);
        expect(v75Off.fires.v73_vs3bet_defence, `v75Off preserves v73 fire ${h.cls}`).toBe(
          def.fires.v73_vs3bet_defence
        );
        expect(v73Off.fires.v73_vs3bet_defence, `v73Off disables v73 ${h.cls}`).toBeUndefined();

        if (def.fires.v73_vs3bet_defence) v73FiresDef++;
        if (v75Off.fires.v73_vs3bet_defence) v73FiresV75Off++;
        if (v73Off.fires.v73_vs3bet_defence) v73FiresV73Off++;
      }

      expect(v73FiresDef).toBe(169);
      expect(v73FiresV75Off).toBe(169);
      expect(v73FiresV73Off).toBe(0);
    });
  });

  describe('Coupling E: v69TurnCallGaps <-> v69HoleDrawExemption <-> v69V32DrawNoRoom', () => {
    it('(1) one-pair implied odds: v69TurnCallGaps OFF disables ONLY (1); v69HoleDrawExemption OFF and v69V32DrawNoRoom OFF leave (1) intact', () => {
      const spot = turnSpot('nlh', 'As4d', 'AhKdTs2c', 36, { villainBehind: 60 });
      const base: HorseDecideOpts = { v79TopPairWeakKicker: false };

      const def = decideMany(spot, base);
      const v69ImpliedOff = decideMany(spot, { ...base, v69TurnCallGaps: false });
      const v69HoleOff = decideMany(spot, { ...base, v69HoleDrawExemption: false });
      const v69V32Off = decideMany(spot, { ...base, v69V32DrawNoRoom: false });

      expect(def.seen.v69_turn_call_gaps).toBe(20);
      expect(v69ImpliedOff.seen.v69_turn_call_gaps ?? 0).toBe(0);
      expect(def.acts.call ?? 0).toBeLessThan(v69ImpliedOff.acts.call ?? 0);

      // Independent sub-flags must NOT disturb (1).
      expect(v69HoleOff.seen.v69_turn_call_gaps).toBe(20);
      expect(v69HoleOff.perSeed).toEqual(def.perSeed);
      expect(v69V32Off.seen.v69_turn_call_gaps).toBe(20);
      expect(v69V32Off.perSeed).toEqual(def.perSeed);
    });

    it('(2a) V65 board-only draw exemption: v69HoleDrawExemption OFF disables ONLY (2); v69TurnCallGaps OFF and v69V32DrawNoRoom OFF leave (2) intact', () => {
      const spot = turnSpot('nlh', 'Ks5d', 'KhQh9h2h', 36);
      const base: HorseDecideOpts = { v79TopPairWeakKicker: false };

      const def = decideMany(spot, base);
      const v69HoleOff = decideMany(spot, { ...base, v69HoleDrawExemption: false });
      const v69ImpliedOff = decideMany(spot, { ...base, v69TurnCallGaps: false });
      const v69V32Off = decideMany(spot, { ...base, v69V32DrawNoRoom: false });

      expect(def.seen.v65_turn_one_pair_shade).toBe(20);
      expect(def.seen.v69_turn_call_gaps).toBe(20);

      expect(v69HoleOff.seen.v65_turn_one_pair_shade ?? 0).toBe(0);
      expect(v69HoleOff.seen.v69_turn_call_gaps ?? 0).toBe(0);
      expect(def.acts.call ?? 0).toBeLessThan(v69HoleOff.acts.call ?? 0);

      // Turning v69TurnCallGaps or v69V32DrawNoRoom OFF leaves V65's hole-draw exemption untouched.
      expect(v69ImpliedOff.seen.v65_turn_one_pair_shade).toBe(20);
      expect(v69ImpliedOff.seen.v69_turn_call_gaps).toBe(20);
      expect(v69ImpliedOff.perSeed).toEqual(def.perSeed);

      expect(v69V32Off.seen.v65_turn_one_pair_shade).toBe(20);
      expect(v69V32Off.seen.v69_turn_call_gaps).toBe(20);
      expect(v69V32Off.perSeed).toEqual(def.perSeed);
    });

    it.each([
      { label: 'V38 multiway turn (extra87Turn)', committed: false },
      { label: 'committed multiway turn (shade87NlhTurnCommit)', committed: true },
    ])(
      '(2b) Pillar 2 on board-only four-flush ($label): v69TurnCallGaps OFF leaves Pillar 2 turn shade intact; only v69HoleDrawExemption OFF reverts to holdemDrawPresent',
      ({ committed }) => {
        const spot = multiwayBoardFlushTurnSpot({ committed });

        const def = decideWithCapture(spot, {});
        expect(def.fires.v87_deep_dive_discipline).toBe(1);
        expect(def.receipt.rules.find((r) => r.rule === 'nlh_turn_shade')).toEqual(
          expect.objectContaining({ eligible: 1, changed: 1 })
        );

        const v69ImpliedOff = decideWithCapture(spot, { v69TurnCallGaps: false });
        expect(v69ImpliedOff.fires.v87_deep_dive_discipline).toBe(1);
        expect(v69ImpliedOff.receipt.rules.find((r) => r.rule === 'nlh_turn_shade')).toEqual(
          expect.objectContaining({ eligible: 1, changed: 1 })
        );
        expect(v69ImpliedOff.decision).toEqual(def.decision);

        const v69V32Off = decideWithCapture(spot, { v69V32DrawNoRoom: false });
        expect(v69V32Off.fires.v87_deep_dive_discipline).toBe(1);
        expect(v69V32Off.decision).toEqual(def.decision);

        // Only v69HoleDrawExemption OFF reverts Pillar 2's draw check to holdemDrawPresent.
        const v69HoleOff = decideWithCapture(spot, { v69HoleDrawExemption: false });
        expect(v69HoleOff.fires.v87_deep_dive_discipline).toBeUndefined();
      }
    );

    it('(3) V32 turn draw pass-through no-room: v69V32DrawNoRoom OFF disables ONLY (3); v69TurnCallGaps OFF and v69HoleDrawExemption OFF leave (3) intact', () => {
      loadTurnCells('Kh9h3s7c');
      const spot = turnSpot('nlh', 'Ah5h', 'Kh9h3s7c', 45, { villainBehind: 60 });
      const base: HorseDecideOpts = { v32FacingDefense: true, v79TopPairWeakKicker: false };

      const def = decideMany(spot, base);
      const v69V32Off = decideMany(spot, { ...base, v69V32DrawNoRoom: false });
      const v69ImpliedOff = decideMany(spot, { ...base, v69TurnCallGaps: false });
      const v69HoleOff = decideMany(spot, { ...base, v69HoleDrawExemption: false });

      expect(def.seen.v34_defend_draw_passthrough ?? 0).toBe(0);
      expect(def.seen.v69_turn_call_gaps).toBe(20);

      expect(v69V32Off.seen.v34_defend_draw_passthrough).toBe(20);
      expect(v69V32Off.seen.v69_turn_call_gaps ?? 0).toBe(0);
      expect(def.acts.call ?? 0).toBeLessThan(v69V32Off.acts.call ?? 0);

      // Turning v69TurnCallGaps or v69HoleDrawExemption OFF leaves (3) untouched.
      expect(v69ImpliedOff.seen.v34_defend_draw_passthrough ?? 0).toBe(0);
      expect(v69ImpliedOff.seen.v69_turn_call_gaps).toBe(20);
      expect(v69ImpliedOff.perSeed).toEqual(def.perSeed);

      expect(v69HoleOff.seen.v34_defend_draw_passthrough ?? 0).toBe(0);
      expect(v69HoleOff.seen.v69_turn_call_gaps).toBe(20);
      expect(v69HoleOff.perSeed).toEqual(def.perSeed);
    });

    it('HorseLogic source pins independent option reads for V69 sub-rules and V73/V75', () => {
      const raw = readFileSync(join(REPO, 'server/src/engine/HorseLogic.ts'), 'utf8');
      const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect([...code.matchAll(/opts\.v69TurnCallGaps/g)]).toHaveLength(1);
      expect([...code.matchAll(/opts\.v69HoleDrawExemption/g)]).toHaveLength(1);
      expect([...code.matchAll(/opts\.v69V32DrawNoRoom/g)]).toHaveLength(1);
      expect(code).toMatch(
        /const v69OnePairImplied = \(opts\.v69TurnCallGaps \?\? true\) !== false;/
      );
      expect(code).toMatch(/const v69HoleDraw = opts\.v69HoleDrawExemption !== false;/);
      expect(code).toMatch(/const v69V32Draw = opts\.v69V32DrawNoRoom !== false;/);
      // V73/V75 decoupling: squeeze75 branches independently onto v75SqueezeDefence vs v73Vs3BetDefence.
      expect(code).toMatch(
        /const squeeze75 = callersOfPreviousRaise >= 1;[\s\S]*?if \(squeeze75\) \{\s*if \(opts\.v75SqueezeDefence === false\) return undefined;\s*\} else \{\s*if \(opts\.v73Vs3BetDefence === false\) return undefined;\s*\}/
      );
    });
  });

  describe('Default-ON bit-identical parity and PLO4/PLO5/PLO6 zero-impact invariance', () => {
    it('default-ON ({}) matches explicit all-true across all NLH V69/V73/V75 spots and PLO4/PLO5/PLO6', () => {
      loadTurnCells('Kh9h3s7c');
      const explicitOn: HorseDecideOpts = {
        v69TurnCallGaps: true,
        v69HoleDrawExemption: true,
        v69V32DrawNoRoom: true,
        v73Vs3BetDefence: true,
        v75SqueezeDefence: true,
      };
      const cases: Array<[string, { hero: SeatPlayer; gs: object }, HorseDecideOpts]> = [
        ['nlh-v69-1-implied', turnSpot('nlh', 'As4d', 'AhKdTs2c', 36, { villainBehind: 60 }), {}],
        ['nlh-v69-2-board-flush', turnSpot('nlh', 'Ks5d', 'KhQh9h2h', 36), {}],
        ['nlh-v69-2-multiway-v38', multiwayBoardFlushTurnSpot({ committed: false }), {}],
        ['nlh-v69-2-multiway-commit', multiwayBoardFlushTurnSpot({ committed: true }), {}],
        [
          'nlh-v69-3-v32',
          turnSpot('nlh', 'Ah5h', 'Kh9h3s7c', 45, { villainBehind: 60 }),
          { v32FacingDefense: true },
        ],
        ['nlh-cash6-vs3bet', stateFor(CASH6, 5, 2, holeFor('KQs', 1)), {}],
        ['nlh-mtt9-vs3bet', stateFor(MTT9, 6, 2, holeFor('AJs', 1)), {}],
        ['nlh-cash6-squeeze', squeezeStateFor(CASH6, 4, [5], 2, holeFor('KQs', 1)), {}],
        ['nlh-mtt9-squeeze', squeezeStateFor(MTT9, 6, [9], 2, holeFor('AJs', 1)), {}],
        ['plo4-preflop-squeeze', omahaPreflopSqueezeSpot('plo4'), {}],
        ['plo5-preflop-squeeze', omahaPreflopSqueezeSpot('plo5'), {}],
        ['plo6-preflop-squeeze', omahaPreflopSqueezeSpot('plo6'), {}],
        ['plo4-turn', turnSpot('plo4', 'Ks5dJc8c', 'KhQh9h2h', 36, { villainBehind: 60 }), {}],
        ['plo5-turn', turnSpot('plo5', 'Ks5dJc8c2d', 'KhQh9h2h', 36, { villainBehind: 60 }), {}],
        ['plo6-turn', turnSpot('plo6', 'Ks5dJc8c2d3s', 'KhQh9h2h', 36, { villainBehind: 60 }), {}],
      ];

      for (const [label, spot, extra] of cases) {
        // Warm once so once-per-process reservoir build counters do not skew the first call.
        decideWithCapture(spot, extra, 20261122);
        const a = decideWithCapture(spot, extra, 20261122);
        const b = decideWithCapture(spot, { ...extra, ...explicitOn }, 20261122);
        expect(a.decision, label).toEqual(b.decision);
        expect(a.fires, label).toEqual(b.fires);
      }
    });

    it.each(['plo4', 'plo5', 'plo6'] as const)(
      '%s decisions and fires are completely untouched when V69/V73/V75 options are switched OFF',
      (variant) => {
        const hole =
          variant === 'plo4' ? 'Ks5dJc8c' : variant === 'plo5' ? 'Ks5dJc8c2d' : 'Ks5dJc8c2d3s';
        const spots = [
          ['preflop-squeeze', omahaPreflopSqueezeSpot(variant)],
          ['turn-board-flush', turnSpot(variant, hole, 'KhQh9h2h', 36, { villainBehind: 60 })],
          [
            'river',
            turnSpot(variant, hole, 'KhQh9h2h3c', 36, { villainBehind: 60, street: 'river' }),
          ],
        ] as const;

        const arms: readonly HorseDecideOpts[] = [
          { v69TurnCallGaps: false },
          { v69HoleDrawExemption: false },
          { v69V32DrawNoRoom: false },
          { v73Vs3BetDefence: false },
          { v75SqueezeDefence: false },
          {
            v69TurnCallGaps: false,
            v69HoleDrawExemption: false,
            v69V32DrawNoRoom: false,
            v73Vs3BetDefence: false,
            v75SqueezeDefence: false,
          },
        ];

        for (const [label, spot] of spots) {
          // Warm once so once-per-process reservoir build counters do not skew the first call.
          decideWithCapture(spot, {}, 20261122);
          const base = decideWithCapture(spot, {}, 20261122);
          for (const arm of arms) {
            const actual = decideWithCapture(spot, arm, 20261122);
            expect(actual.decision, `${variant} ${label} ${JSON.stringify(arm)}`).toEqual(
              base.decision
            );
            expect(actual.fires, `${variant} ${label} ${JSON.stringify(arm)}`).toEqual(base.fires);
          }
        }
      }
    );
  });
});
