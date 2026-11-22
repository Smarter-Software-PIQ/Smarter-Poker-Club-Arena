/**
 * HOLD'EM BLANKET-OFF DEV LEAGUE CARDS (2026-11-21, Horse Switch lane).
 *
 * The three clean Hold'em blanket-off candidates identified in
 * REVIEW-HOLDEM-OFFLIST-20261121.md (v80TopPairStrongKicker,
 * v79TopPairWeakKicker, v68TurnAirDrawCalls) each route directly to V38
 * priced logic when switched OFF without coupling a second rule or
 * reinstating another fixed rule.
 *
 * This law guards four invariants:
 *   1. Every candidate's cash6 and hu dev cards live in
 *      DEVELOPMENT_LEAGUE_CARDS, resolve by exact name via resolveLeagueCard,
 *      and NEVER appear in LEAGUE_MATCHUPS or UNMEASURABLE_MATCHUPS (the
 *      #11600 rule: development cards never ride on the nightly card).
 *   2. Each card differs between arm A and arm B in exactly its one blanket
 *      option (arm A sets it false, arm B is `{}` release default ON).
 *   3. Switching each rule OFF cleanly eliminates its receipt and routes
 *      decisions directly to V38 priced logic on its Burls/owner-fix spots
 *      (v79/v80 ring-table cell A/B; v68 turn air/short-behind implied-odds
 *      spots), without widening v80 to weak kickers when v79 is OFF, and
 *      leaves HU tables byte-identical for v79/v80 (where headsUpTable is
 *      outside v79InMeasuredCell / v80InMeasuredCell).
 *   4. A smoke run through runMatchup completes legally with 0 illegal
 *      actions, 0 truncated streets and 0 brain fallbacks.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEVELOPMENT_LEAGUE_CARDS,
  HOLDEM_BLANKET_OFF_CANDIDATE_CARDS,
  LEAGUE_MATCHUPS,
  UNMEASURABLE_MATCHUPS,
  runMatchup,
} from './HorseLeague.js';
import { leagueCardOptionsUnderTest, resolveLeagueCard } from './HorseLeagueCard.js';
import { HorseLogic } from '../engine/HorseLogic.js';
import { HorseMind } from '../engine/HorseMind.js';
import { seedFastRandom } from '../engine/HorseEval.js';
import { drainFires, enableBrainTelemetry } from '../engine/BrainTelemetry.js';
import type { Card, CardRank, CardSuit, SeatPlayer } from '../types.js';

const SUITS: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
function cards(text: string): Card[] {
  const out: Card[] = [];
  for (let i = 0; i + 1 < text.length; i += 2) {
    out.push({ rank: text[i] as CardRank, suit: SUITS[text[i + 1]] });
  }
  return out;
}

const EXPECTED_CARDS = [
  { name: 'cash6_v80_top_pair_strong_kicker_off', seats: 6, option: 'v80TopPairStrongKicker' },
  { name: 'hu_v80_top_pair_strong_kicker_off', seats: 2, option: 'v80TopPairStrongKicker' },
  { name: 'cash6_v79_top_pair_weak_kicker_off', seats: 6, option: 'v79TopPairWeakKicker' },
  { name: 'hu_v79_top_pair_weak_kicker_off', seats: 2, option: 'v79TopPairWeakKicker' },
  { name: 'cash6_v68_turn_air_draw_calls_off', seats: 6, option: 'v68TurnAirDrawCalls' },
  { name: 'hu_v68_turn_air_draw_calls_off', seats: 2, option: 'v68TurnAirDrawCalls' },
] as const;

const VILLAIN_ID = '10000000-0000-4000-8000-000000000099';

function buildRiverTopPairSpot(
  hole: string,
  board: string,
  bet: number,
  headsUpTable: boolean
): { hero: SeatPlayer; gs: Record<string, unknown> } {
  const players: SeatPlayer[] = [
    {
      seat: 1,
      user_id: 'hero',
      username: 'hero',
      stack: 300,
      bet: 0,
      totalInvested: 18,
      cards: cards(hole),
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
    } as SeatPlayer,
    {
      seat: 2,
      user_id: VILLAIN_ID,
      username: 'villain',
      stack: 300 - bet,
      bet,
      totalInvested: 18 + bet,
      cards: [],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: false,
    } as SeatPlayer,
  ];
  const history: Array<Record<string, unknown>> = [];
  if (!headsUpTable) {
    players.push({
      seat: 3,
      user_id: 'folder',
      username: 'folder',
      stack: 300,
      bet: 0,
      totalInvested: 0,
      cards: [],
      is_folded: true,
      is_all_in: false,
      is_sitting_out: false,
      is_horse: true,
    } as SeatPlayer);
    history.push({
      stage: 'preflop',
      seat: 3,
      userId: 'folder',
      action: 'fold',
      amount: 0,
      timestamp: 0,
    });
  }
  history.push(
    { stage: 'preflop', seat: 2, userId: VILLAIN_ID, action: 'raise', amount: 6, timestamp: 1 },
    { stage: 'preflop', seat: 1, userId: 'hero', action: 'call', amount: 4, timestamp: 2 },
    { stage: 'flop', seat: 1, userId: 'hero', action: 'check', amount: 0, timestamp: 3 },
    { stage: 'flop', seat: 2, userId: VILLAIN_ID, action: 'bet', amount: 6, timestamp: 4 },
    { stage: 'flop', seat: 1, userId: 'hero', action: 'call', amount: 6, timestamp: 5 },
    { stage: 'turn', seat: 1, userId: 'hero', action: 'check', amount: 0, timestamp: 6 },
    { stage: 'turn', seat: 2, userId: VILLAIN_ID, action: 'check', amount: 0, timestamp: 7 },
    { stage: 'river', seat: 1, userId: 'hero', action: 'check', amount: 0, timestamp: 8 },
    { stage: 'river', seat: 2, userId: VILLAIN_ID, action: 'bet', amount: bet, timestamp: 9 }
  );
  return {
    hero: players[0],
    gs: {
      players,
      communityCards: cards(board),
      pot: 36 + bet,
      currentBet: bet,
      minRaise: Math.max(2, bet),
      stage: 'river',
      gameVariant: 'nlh',
      gameMode: 'cash',
      bigBlind: 2,
      dealerSeat: 1,
      actionHistory: history,
    },
  };
}

function buildTurnV68Spot(
  hole: string,
  board: string,
  bet: number,
  villainBehind: number
): { hero: SeatPlayer; gs: Record<string, unknown> } {
  const players: SeatPlayer[] = [
    {
      seat: 1,
      user_id: 'hero',
      username: 'hero',
      stack: 400,
      bet: 0,
      totalInvested: 18,
      cards: cards(hole),
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
    } as SeatPlayer,
    {
      seat: 2,
      user_id: VILLAIN_ID,
      username: 'villain',
      stack: villainBehind,
      bet,
      totalInvested: 18 + bet,
      cards: [],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
    } as SeatPlayer,
  ];
  const history = [
    { stage: 'preflop', seat: 2, userId: VILLAIN_ID, action: 'raise', amount: 6, timestamp: 1 },
    { stage: 'preflop', seat: 1, userId: 'hero', action: 'call', amount: 4, timestamp: 2 },
    { stage: 'flop', seat: 1, userId: 'hero', action: 'check', amount: 0, timestamp: 3 },
    { stage: 'flop', seat: 2, userId: VILLAIN_ID, action: 'bet', amount: 8, timestamp: 4 },
    { stage: 'flop', seat: 1, userId: 'hero', action: 'call', amount: 8, timestamp: 5 },
    { stage: 'turn', seat: 1, userId: 'hero', action: 'check', amount: 0, timestamp: 8 },
    { stage: 'turn', seat: 2, userId: VILLAIN_ID, action: 'bet', amount: bet, timestamp: 9 },
  ];
  return {
    hero: players[0],
    gs: {
      players,
      communityCards: cards(board),
      pot: 36 + bet,
      currentBet: bet,
      minRaise: Math.max(2, bet),
      stage: 'turn',
      gameVariant: 'nlh',
      gameMode: 'cash',
      bigBlind: 2,
      dealerSeat: 2,
      actionHistory: history,
    },
  };
}

function runSpotAcrossSeeds(
  spot: { hero: SeatPlayer; gs: Record<string, unknown> },
  opts: Record<string, unknown>,
  seeds = 30
) {
  const decisions: string[] = [];
  const receipts: Record<string, number> = {};
  for (let seed = 1; seed <= seeds; seed++) {
    seedFastRandom(seed * 7919 + 131);
    HorseMind.reset();
    drainFires();
    const d = HorseLogic.decide(spot.hero, spot.gs as never, 'balanced', {}, {
      telemetry: true,
      mind: false,
      ...opts,
    } as never) as { action: string; amount?: number };
    decisions.push(`${d.action}|${d.amount ?? ''}`);
    for (const r of drainFires()) {
      receipts[r.feature] = (receipts[r.feature] ?? 0) + r.fires;
    }
  }
  return {
    decisions,
    calls: decisions.filter((a) => a.startsWith('call')).length,
    receipts,
  };
}

describe("Hold'em blanket-off development league cards (v80, v79, v68)", () => {
  it('registers all 6 dev cards in DEVELOPMENT_LEAGUE_CARDS and never on LEAGUE_MATCHUPS', () => {
    expect(HOLDEM_BLANKET_OFF_CANDIDATE_CARDS).toHaveLength(6);
    const nightlyNames = new Set(LEAGUE_MATCHUPS.map((m) => m.name));
    const refusedNames = new Set(UNMEASURABLE_MATCHUPS.map((u) => u.name));
    const devNames = new Set(DEVELOPMENT_LEAGUE_CARDS.map((m) => m.name));
    const combined = [...LEAGUE_MATCHUPS, ...DEVELOPMENT_LEAGUE_CARDS];

    for (const spec of EXPECTED_CARDS) {
      expect(nightlyNames.has(spec.name), `${spec.name} must stay off LEAGUE_MATCHUPS`).toBe(false);
      expect(refusedNames.has(spec.name), `${spec.name} must not be refused`).toBe(false);
      expect(devNames.has(spec.name), `${spec.name} must be in DEVELOPMENT_LEAGUE_CARDS`).toBe(
        true
      );

      const resolved = resolveLeagueCard(spec.name, combined, UNMEASURABLE_MATCHUPS);
      expect(resolved.variant).toBe('nlh');
      expect(resolved.seats).toBe(spec.seats);
      expect(resolved.pairs).toBe(6000);
      expect(resolved.hybridBaseline).toBe(true);
      expect(resolved.moodClock).toBe('deal_seed');
      expect(resolved.handIdentity).toBe('deal_seed');
      expect(leagueCardOptionsUnderTest(resolved)).toEqual([spec.option]);
      expect((resolved.a as Record<string, unknown>)[spec.option]).toBe(false);
      expect(resolved.b).toEqual({});
    }
  });

  describe('decision-level OFF vs ON verification', () => {
    beforeEach(() => {
      enableBrainTelemetry();
      HorseMind.reset();
      drainFires();
    });
    afterEach(() => {
      HorseMind.reset();
      drainFires();
    });

    it('v80TopPairStrongKicker OFF drops v80 cap on Burls cell A ring spot and is inert on HU tables', () => {
      const ringSpot = buildRiverTopPairSpot('KsQd', 'Kh9d3s7c2h', 36, false);
      const onRing = runSpotAcrossSeeds(ringSpot, {});
      const offRing = runSpotAcrossSeeds(ringSpot, { v80TopPairStrongKicker: false });
      expect(onRing.receipts['v80_top_pair_strong_kicker'] ?? 0).toBeGreaterThan(0);
      expect(offRing.receipts['v80_top_pair_strong_kicker'] ?? 0).toBe(0);
      expect(offRing.calls).toBeGreaterThan(onRing.calls);

      // HU table: v80InMeasuredCell excludes headsUpTable, so OFF === ON byte-identically.
      const huSpot = buildRiverTopPairSpot('KsQd', 'Kh9d3s7c2h', 36, true);
      const onHu = runSpotAcrossSeeds(huSpot, {}, 12);
      const offHu = runSpotAcrossSeeds(huSpot, { v80TopPairStrongKicker: false }, 12);
      expect(onHu.receipts['v80_top_pair_strong_kicker'] ?? 0).toBe(0);
      expect(offHu.decisions).toEqual(onHu.decisions);
    });

    it('v79TopPairWeakKicker OFF drops v79 cap on Burls cell A & B without widening v80, and is inert on HU tables', () => {
      const cellA = buildRiverTopPairSpot('Ks5d', 'Kh9d3s7c2h', 36, false);
      const onA = runSpotAcrossSeeds(cellA, {});
      const offA = runSpotAcrossSeeds(cellA, { v79TopPairWeakKicker: false });
      expect(onA.receipts['v79_top_pair_weak_kicker'] ?? 0).toBeGreaterThan(0);
      expect(offA.receipts['v79_top_pair_weak_kicker'] ?? 0).toBe(0);
      // v79 OFF must NOT widen v80 to weak kickers.
      expect(offA.receipts['v80_top_pair_strong_kicker'] ?? 0).toBe(0);
      expect(offA.calls).toBeGreaterThan(onA.calls);

      // Cell B: 0.75-pot river bet on Ace-high board, HU pot on a ring table.
      const cellB = buildRiverTopPairSpot('As5d', 'Ah9d3s7c2h', 27, false);
      const onB = runSpotAcrossSeeds(cellB, {});
      const offB = runSpotAcrossSeeds(cellB, { v79TopPairWeakKicker: false });
      expect(onB.receipts['v79_top_pair_weak_kicker'] ?? 0).toBeGreaterThan(0);
      expect(offB.receipts['v79_top_pair_weak_kicker'] ?? 0).toBe(0);
      expect(offB.receipts['v80_top_pair_strong_kicker'] ?? 0).toBe(0);

      // HU table: v79InMeasuredCell excludes headsUpTable, so OFF === ON byte-identically.
      const huSpot = buildRiverTopPairSpot('Ks5d', 'Kh9d3s7c2h', 36, true);
      const onHu = runSpotAcrossSeeds(huSpot, {}, 12);
      const offHu = runSpotAcrossSeeds(huSpot, { v79TopPairWeakKicker: false }, 12);
      expect(onHu.receipts['v79_top_pair_weak_kicker'] ?? 0).toBe(0);
      expect(offHu.decisions).toEqual(onHu.decisions);
    });

    it('v68TurnAirDrawCalls OFF drops v68 implied-odds veto and air shade cleanly', () => {
      // Short-behind nut flush draw on turn facing pot bet: part (a) implied-odds veto.
      const shortBehindDraw = buildTurnV68Spot('AhJh', 'Kh9h3s7c', 36, 60);
      const onDraw = runSpotAcrossSeeds(shortBehindDraw, { mind: true });
      const offDraw = runSpotAcrossSeeds(shortBehindDraw, {
        mind: true,
        v68TurnAirDrawCalls: false,
      });
      expect(onDraw.receipts['v68_turn_air_draw_calls'] ?? 0).toBeGreaterThan(0);
      expect(offDraw.receipts['v68_turn_air_draw_calls'] ?? 0).toBe(0);
      expect(offDraw.calls).toBeGreaterThan(onDraw.calls);

      // Gutshot high card on turn facing pot-sized bet: part (b) air shade.
      const gutshotAir = buildTurnV68Spot('AhQd', 'KhTd3s7c', 36, 364);
      const onAir = runSpotAcrossSeeds(gutshotAir, { mind: true });
      const offAir = runSpotAcrossSeeds(gutshotAir, { mind: true, v68TurnAirDrawCalls: false });
      expect(onAir.receipts['v68_turn_air_draw_calls'] ?? 0).toBeGreaterThan(0);
      expect(offAir.receipts['v68_turn_air_draw_calls'] ?? 0).toBe(0);
      expect(offAir.calls).toBeGreaterThan(onAir.calls);
    });
  });

  it(
    'smoke-runs a dev blanket-off card through runMatchup legally',
    { timeout: 60_000 },
    async () => {
      const card = resolveLeagueCard(
        'hu_v68_turn_air_draw_calls_off',
        [...LEAGUE_MATCHUPS, ...DEVELOPMENT_LEAGUE_CARDS],
        UNMEASURABLE_MATCHUPS
      );
      const result = await runMatchup(card, 4, 20261121);
      expect(result.hands).toBe(8);
      expect(result.illegalActions).toBe(0);
      expect(result.truncatedStreets).toBe(0);
      expect(result.brainExceptionFallbacks ?? 0).toBe(0);
    }
  );
});
