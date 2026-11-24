/**
 * LAW: a realistic worst-case DECIDE_FAST carrying BOTH a near-256 KiB
 * ownPublicHistory packet AND a full OpponentHudPacket (6-max and 9-max)
 * fits inside HORSE_REQUEST_MAX_BYTES / HORSE_REQUEST_MAX_NODES with headroom.
 *
 * Production incident (2026-11-24): live 6-max PLO5 cash tables hit 55+
 * HorseRequestCapacityError refusals when opponentHud (~704 KiB allowance on
 * 6-max, ~1.15 MiB on 9-max) + ownPublicHistory (~1.40-1.85 MiB allowance at
 * the 256 KiB UTF-8 cap) + gameState (~40 KiB) exceeded the old 2 MiB ceiling,
 * trapping horses in sticky unacknowledged check/fold fallback loops.
 */
import { describe, expect, it } from 'vitest';
import {
  HORSE_REQUEST_MAX_BYTES,
  HORSE_REQUEST_MAX_NODES,
  HorseRequestCapacityError,
  HorseRequestRetentionBudget,
  horseRequestAllowance,
} from './requestRetentionBudget.js';
import {
  buildHudPacket,
  HUD_PACKET_MAX_FINE_CELLS,
  type HudPriors,
} from '../opponentHud/OpponentHud.js';
import {
  HUD_BANDS,
  HUD_CONTEXT_STATS,
  HUD_DEPTHS,
  HUD_EXACT_COUNTERS,
  HUD_POSITIONS,
  HUD_PROFILE_VERSION,
  HUD_SESSION_STATS,
  HUD_STATS,
  HUD_TEXTURES,
  type HudCount,
  type HudRecallCell,
  type OpponentHudProfile,
} from '../opponentHud/OpponentHudProfile.js';
import { HISTORY_PACKET_MAX_BYTES, HISTORY_WINDOW_MAX_BYTES } from './ownPublicHistoryBudget.js';
import type { FastHorseDecisionRequest } from './protocol.js';
import type { HorseOwnPublicHand, HorseOwnPublicHistoryPacket } from './ownPublicHistory.js';

const NOW = 1_795_440_000_000;
const uuid = (prefix: string, n: number): string =>
  `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;

function buildWorstCaseProfile(user: string): OpponentHudProfile {
  const life: Record<string, HudCount> = {};
  const rec: Record<string, HudCount> = {};
  for (const stat of HUD_STATS) {
    life[stat] = [400, 180];
    rec[stat] = [120, 54];
  }
  const recall: Record<string, HudRecallCell> = {};
  const cell: HudRecallCell = [40, 12, 14, 6, 4, 4, 10, 5, 6];
  // 22 L0 cells across streets/lines
  const l0Specs: Array<[string, string]> = [
    ['preflop', 'open'],
    ['preflop', 'vsOpen'],
    ['preflop', 'vs3bet'],
    ['preflop', 'limp'],
    ['preflop', 'vsLimp'],
    ['preflop', 'iso'],
    ['flop', 'cbet'],
    ['flop', 'vsCbet'],
    ['flop', 'stab'],
    ['flop', 'vsStab'],
    ['flop', 'donk'],
    ['flop', 'vsDonk'],
    ['flop', 'xr'],
    ['turn', 'barrel'],
    ['turn', 'vsBarrel'],
    ['turn', 'probe'],
    ['turn', 'vsProbe'],
    ['turn', 'stab'],
    ['river', 'barrel'],
    ['river', 'vsBarrel'],
    ['river', 'probe'],
    ['river', 'vsProbe'],
  ];
  for (const [s, ln] of l0Specs) recall[`${s}|${ln}`] = [...cell];
  // 15 L1 cells on flop
  const flopLines = ['cbet', 'vsCbet', 'stab', 'vsStab', 'donk'];
  let l1Count = 0;
  for (const ln of flopLines) {
    for (const band of HUD_BANDS) {
      if (l1Count >= 15) break;
      recall[`flop|${ln}|${band}`] = [...cell];
      l1Count++;
    }
  }
  // > 24 L2 cells on flop (buildHudPacket caps at HUD_PACKET_MAX_FINE_CELLS = 24)
  let l2Count = 0;
  for (const pos of HUD_POSITIONS) {
    for (const tx of HUD_TEXTURES) {
      for (const depth of HUD_DEPTHS) {
        if (l2Count >= HUD_PACKET_MAX_FINE_CELLS + 10) break;
        recall[`flop|vsCbet|m|${pos}|${tx}|${depth}`] = [50 + l2Count, 12, 14, 6, 4, 4, 10, 5, 6];
        l2Count++;
      }
    }
  }
  const xc: Record<string, number> = {};
  for (const key of HUD_EXACT_COUNTERS) xc[key] = 25;
  const st: Record<string, HudCount> = {};
  for (const stat of HUD_SESSION_STATS) st[stat] = [18, 7];
  return {
    v: HUD_PROFILE_VERSION,
    user,
    family: 'plo5',
    hands: 2400,
    wm: NOW - 10_000,
    ids: [],
    life,
    rec,
    recAt: NOW - 10_000,
    recall,
    last: [],
    xc,
    ses: {
      at: NOW - 10_000,
      m: 42,
      sW: 24.512345,
      sSw: 10.123456,
      n: 42,
      f: 17,
      st,
    },
  };
}

function buildNearCapOwnPublicHistory(
  observerId: string,
  seatIds: readonly string[]
): HorseOwnPublicHistoryPacket {
  const tableId = uuid('aaaaaaaa', 1);
  const domain = {
    version: 1 as const,
    speed: 'table' as const,
    ante: 'none' as const,
  };
  const basePacket: HorseOwnPublicHistoryPacket = {
    version: 1,
    source: 'original_dealt_public_v1',
    context: {
      version: 2,
      observerId,
      variant: 'plo5',
      format: 'cash',
      dealtCount: seatIds.length,
      publicMemoryDomain: domain,
    },
    capped: true,
    hands: [],
    availableAtMs: NOW,
    digest: 'a'.repeat(64),
  };

  const stages = ['preflop', 'flop', 'turn', 'river'] as const;
  const actionKinds = ['call', 'raise', 'bet', 'check', 'call', 'fold'] as const;

  for (let h = 0; h < 64; h++) {
    const playedAtMs = NOW - (64 - h) * 60_000;
    const actions: HorseOwnPublicHand['actions'] = [];
    for (let a = 0; a < 24; a++) {
      const seatIdx = a % seatIds.length;
      const stage = stages[Math.min(3, Math.floor(a / 6))];
      actions.push({
        seat: seatIdx + 1,
        userId: seatIds[seatIdx],
        action: actionKinds[a % actionKinds.length],
        amount: 20 + a * 5,
        stage,
        timestamp: playedAtMs - (24 - a) * 1000,
        origin: 'horse_policy',
      } as HorseOwnPublicHand['actions'][number]);
    }
    const hand: HorseOwnPublicHand = {
      handId: uuid('bbbbbbbb', h + 1),
      tableId,
      handNumber: 1_000_000 + h,
      observerId,
      observerSeat: 1,
      position: 'BTN',
      playersDealt: seatIds.length,
      variant: 'plo5',
      format: 'cash',
      playedAtMs,
      bigBlind: 2,
      actions,
      results: seatIds.map((user_id, idx) => ({ user_id, net: idx === 0 ? 40 : -8 })),
      riverNodeEvidence: 'unavailable',
      publicMemoryDomain: domain,
    };
    basePacket.hands.push(hand);
    const encodedBytes = Buffer.byteLength(JSON.stringify(basePacket), 'utf8');
    if (encodedBytes > HISTORY_WINDOW_MAX_BYTES - 1024) {
      if (encodedBytes > HISTORY_PACKET_MAX_BYTES) basePacket.hands.pop();
      break;
    }
  }

  return basePacket;
}

function buildWorstCaseDecisionRequest(seatCount: 6 | 9): FastHorseDecisionRequest {
  const seatIds = Array.from({ length: seatCount }, (_, idx) => uuid('11111111', idx + 1));
  const heroId = seatIds[0];
  const opponentIds = seatIds.slice(1);
  const profiles = opponentIds.map((id) => buildWorstCaseProfile(id));
  const priors: HudPriors = {};
  for (const stat of HUD_STATS) priors[stat] = [0.35, 20];
  const opponentHud = buildHudPacket('plo5', profiles, priors, NOW, 'flop');
  const ownPublicHistory = buildNearCapOwnPublicHistory(heroId, seatIds);

  // Sanity-check that our fixture truly exercises worst-case HUD richness.
  const sampleOpp = opponentHud.opp[opponentIds[0]];
  expect(Object.keys(sampleOpp.eff).length).toBe(HUD_STATS.length);
  expect(Object.keys(sampleOpp.lc ?? {}).length).toBe(HUD_CONTEXT_STATS.length);
  expect(Object.keys(sampleOpp.rc).length).toBe(22 + 15 + HUD_PACKET_MAX_FINE_CELLS);
  expect(Object.keys(sampleOpp.xc ?? {}).length).toBeGreaterThanOrEqual(85);
  expect(sampleOpp.ss).toBeDefined();

  const historyBytes = Buffer.byteLength(JSON.stringify(ownPublicHistory), 'utf8');
  expect(historyBytes).toBeGreaterThan(200 * 1024);
  expect(historyBytes).toBeLessThanOrEqual(HISTORY_PACKET_MAX_BYTES);

  return {
    type: 'DECIDE_FAST',
    requestId: seatCount,
    generation: 1,
    fence: `worst-case-${seatCount}max`,
    decisionTimeMs: NOW,
    decisionKey: `phase5-v1:${'c'.repeat(64)}`,
    player: {
      seat: 1,
      user_id: heroId,
      username: 'hero_horse',
      stack: 400,
      bet: 12,
      cards: [
        { rank: 'A', suit: 's' },
        { rank: 'K', suit: 's' },
        { rank: 'Q', suit: 'h' },
        { rank: 'J', suit: 'd' },
        { rank: 'T', suit: 'c' },
      ],
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
    },
    gameState: {
      heroSeat: 1,
      stage: 'flop',
      pot: 84,
      currentBet: 28,
      minRaise: 56,
      bigBlind: 2,
      smallBlind: 1,
      buttonSeat: 1,
      gameVariant: 'plo5',
      communityCards: [
        { rank: 'Q', suit: 's' },
        { rank: '9', suit: 's' },
        { rank: '4', suit: 'd' },
      ],
      players: seatIds.map((user_id, idx) => ({
        seat: idx + 1,
        user_id,
        username: `seat_${idx + 1}`,
        stack: 380,
        bet: idx === 1 ? 28 : 12,
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
      })),
      actionHistory: Array.from({ length: 18 }, (_, i) => ({
        seat: (i % seatCount) + 1,
        userId: seatIds[i % seatCount],
        action: i % 3 === 0 ? 'raise' : 'call',
        amount: 6 + i * 2,
        stage: i < 12 ? 'preflop' : 'flop',
        timestamp: NOW - (18 - i) * 1000,
      })),
    },
    opponentHud,
    ownPublicHistory,
    ownPublicHistoryState: 'available',
  } as unknown as FastHorseDecisionRequest;
}

describe('worst-case PLO5 opponentHud + ownPublicHistory DECIDE_FAST fits request retention budget', () => {
  it.each([6, 9] as const)(
    '%i-max worst-case request fits HORSE_REQUEST_MAX_BYTES with headroom and reserves cleanly',
    (seatCount) => {
      const req = buildWorstCaseDecisionRequest(seatCount);
      const allowance = horseRequestAllowance(req);
      expect(allowance).toBeLessThanOrEqual(HORSE_REQUEST_MAX_BYTES);
      // Leave meaningful headroom (>= 256 KiB) above the worst-case 9-max envelope.
      expect(HORSE_REQUEST_MAX_BYTES - allowance).toBeGreaterThanOrEqual(256 * 1024);

      const budget = new HorseRequestRetentionBudget();
      expect(() => budget.reserve(req)).not.toThrow();
      expect(budget.status().requestCapacityRefusals).toBe(0);
      budget.release(req.requestId);
      expect(budget.status().retainedRequestBytes).toBe(0);
    }
  );

  it('still rejects requests exceeding HORSE_REQUEST_MAX_BYTES or HORSE_REQUEST_MAX_NODES', () => {
    expect(HORSE_REQUEST_MAX_BYTES).toBe(4 * 1024 * 1024);
    expect(HORSE_REQUEST_MAX_NODES).toBe(65536);
    expect(() =>
      horseRequestAllowance('x'.repeat(Math.ceil(HORSE_REQUEST_MAX_BYTES / 6) + 1))
    ).toThrow(HorseRequestCapacityError);
    expect(() =>
      horseRequestAllowance(Array.from({ length: HORSE_REQUEST_MAX_NODES + 1 }))
    ).toThrow(HorseRequestCapacityError);
  });
});
