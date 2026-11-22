/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  EVERY SPIN & HEADS-UP OPTION OPEN EMPTY + MIXED HORSE OCCUPANCY
 *  (Dan, 2026-11-22, binding)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Dan, verbatim (2026-11-22):
 * "1, NOT EVERY SPIN 'AVAILABLE' SHOULD HAVE 2 OF 3 PLAYERS. SOME SHOULD ONLY
 * HAVE 1 OF 3 PLAYERS. SOME SHOULD BE 'EMPTY' FOR A HUMAN TO SIT DOWN AND
 * START. CURRENTLY THERE IS 11 SITTING WITH 2 OF 3. AND NONE WITH 0 OF 3.
 * THERE SHOULD BE EVERY OPTION OF SPIN AVAILABLE AS 0 OF 3 FOR HUMANS TO SIT
 * DOWN AND PLAY. SAME THING FOR HEADS UP SIT N GO'S. THERE SHOULD BE ONLY A
 * COUPLE OF 1 OF 2'S AVAILABLE AND MAJORITY 0 OF 2 FOR HUMAN PLAYERS TO SIT
 * DOWN AT AND PLAY."
 *
 * Root causes pinned by this regression suite:
 *   1. checkAndLaunchSpins / checkAndLaunchSNGs returned early when `room <= 0`,
 *      so once 11 Spins / 6 Heads-Ups held a horse, zero 0/3 or 0/2 boards were
 *      created for the rest of the 64-Spin / 32-Heads-Up catalogue.
 *   2. SNG_BOARD_OPEN_TARGET was 6 instead of a couple (2).
 *   3. All 11 Spins opened in a single 30-second lockstep tick at 6:00 AM CST,
 *      so by T+80 min (before the earliest T+90 min deal) 11 of 11 sat at 2/3
 *      with 0 at 1/3. Staggered seeding + SPIN_MAX_TWO_OF_THREE = 5 (with
 *      envelope-safe defer/clamp) prevents lockstep 2/3 bunching without ever
 *      tripping SpinUnfilledBacklog, SpinFleetProducingNothing, or
 *      fn_spin_expire_unfilled.
 *   4. GameServer.discoverTournaments past-start walk previously fell through
 *      for empty (roster === 0) seat-first boards and would auto-fill 0/3 and
 *      0/2 boards to 3/3 and 2/2 once start_time passed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SPIN_BOARD_OPEN_TARGET,
  SNG_BOARD_OPEN_TARGET,
  SPIN_MAX_TWO_OF_THREE,
  SPIN_IMMEDIATE_SEED_FLOOR,
  SPIN_SEED_SPACING_MS,
  SPIN_LADDER,
  SPIN_LADDER_MAX_TOTAL_MS,
  SPIN_ENVELOPE_SAFETY_MARGIN_MS,
  SPIN_TWO_OF_THREE_DEFER_MIN_MS,
  SPIN_TWO_OF_THREE_DEFER_MAX_MS,
  spinSeedsAllowedThisTick,
  seatFirstSeedsAllowedThisTick,
  spinTwoOfThreeDeferMs,
  clampSpinRungWaitMs,
  openingRungMs,
  nextRungMs,
} from '../config/seatFirstLadder.js';
import { shouldCancelEmptyPastStartEvent } from '../tournament/emptyPastStartEvent.js';

const MIN = 60_000;
const RECURRING = readFileSync(
  join(process.cwd(), 'src/services/TournamentRecurringService.ts'),
  'utf8'
);
const GAME_SERVER = readFileSync(join(process.cwd(), 'src/GameServer.ts'), 'utf8');

function deterministicRand(seedInit: number): (spanInclusive: number) => number {
  let state = seedInit >>> 0;
  return (spanInclusive: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return spanInclusive <= 0 ? 0 : state % (spanInclusive + 1);
  };
}

describe('1. horse-seeded occupancy targets (Dan 2026-11-22)', () => {
  it('caps horse-seeded Heads-Up SNGs to a couple (2) so the vast majority stay 0/2', () => {
    expect(SNG_BOARD_OPEN_TARGET).toBe(2);
    expect(seatFirstSeedsAllowedThisTick('sng', 0, null, 1_000_000, 12)).toBe(2);
    expect(seatFirstSeedsAllowedThisTick('sng', 1, null, 1_000_000, 12)).toBe(1);
    expect(seatFirstSeedsAllowedThisTick('sng', 2, null, 1_000_000, 12)).toBe(0);
    expect(seatFirstSeedsAllowedThisTick('sng', 6, null, 1_000_000, 12)).toBe(0);
  });

  it('keeps 11 horse-seeded Spins with at most 5 at 2/3 so at least 6 sit at 1/3', () => {
    expect(SPIN_BOARD_OPEN_TARGET).toBe(11);
    expect(SPIN_MAX_TWO_OF_THREE).toBe(5);
    expect(SPIN_MAX_TWO_OF_THREE).toBeLessThan(SPIN_BOARD_OPEN_TARGET);
  });
});

describe('2. staggered Spin horse-seeding breaks 6:00 AM lockstep waves', () => {
  it('seeds SPIN_IMMEDIATE_SEED_FLOOR immediately at cold start, then 1 per 8 minutes up to 11', () => {
    const t0 = Date.UTC(2026, 10, 22, 12, 0, 0);
    expect(SPIN_IMMEDIATE_SEED_FLOOR).toBe(3);
    expect(SPIN_SEED_SPACING_MS).toBe(8 * MIN);

    // Cold start: 0 opened -> allows 3 immediately (not all 11 at once)
    expect(spinSeedsAllowedThisTick(0, null, t0, 12)).toBe(3);
    expect(spinSeedsAllowedThisTick(1, t0, t0 + 30_000, 12)).toBe(2);
    expect(spinSeedsAllowedThisTick(2, t0, t0 + 30_000, 12)).toBe(1);

    // Once at floor (3+), waits 8 full minutes from the most recent opening seat
    expect(spinSeedsAllowedThisTick(3, t0, t0 + 30_000, 12)).toBe(0);
    expect(spinSeedsAllowedThisTick(3, t0, t0 + 7 * MIN + 59_000, 12)).toBe(0);
    expect(spinSeedsAllowedThisTick(3, t0, t0 + 8 * MIN, 12)).toBe(1);
    expect(spinSeedsAllowedThisTick(10, t0, t0 + 8 * MIN, 12)).toBe(1);

    // Full quota: never exceeds 11
    expect(spinSeedsAllowedThisTick(11, t0, t0 + 60 * MIN, 12)).toBe(0);
    expect(spinSeedsAllowedThisTick(12, t0, t0 + 60 * MIN, 12)).toBe(0);

    // Respects maxPerTick and invalid inputs fail closed to 0
    expect(spinSeedsAllowedThisTick(0, null, t0, 2)).toBe(2);
    expect(spinSeedsAllowedThisTick(0, null, t0, 0)).toBe(0);
    expect(spinSeedsAllowedThisTick(NaN, null, t0, 12)).toBe(0);
  });
});

describe('3. 2/3 cap defers safely inside the 140-minute SPIN_LADDER envelope', () => {
  const lo = () => 0;
  const hi = (span: number) => span;

  it('never defers when fewer than SPIN_MAX_TWO_OF_THREE Spins sit at 2/3', () => {
    const oldest = 1_000_000;
    const now = oldest + 70 * MIN;
    for (let count = 0; count < SPIN_MAX_TWO_OF_THREE; count++) {
      expect(
        spinTwoOfThreeDeferMs({
          twoOfThreeCount: count,
          oldestSeatAtMs: oldest,
          nowMs: now,
          rand: hi,
        })
      ).toBeNull();
    }
  });

  it('defers 5-10 minutes when 2/3 cap is reached and envelope headroom remains', () => {
    const oldest = 1_000_000;
    const now = oldest + 70 * MIN;
    expect(
      spinTwoOfThreeDeferMs({
        twoOfThreeCount: SPIN_MAX_TWO_OF_THREE,
        oldestSeatAtMs: oldest,
        nowMs: now,
        rand: lo,
      })
    ).toBe(SPIN_TWO_OF_THREE_DEFER_MIN_MS);
    expect(
      spinTwoOfThreeDeferMs({
        twoOfThreeCount: SPIN_MAX_TWO_OF_THREE,
        oldestSeatAtMs: oldest,
        nowMs: now,
        rand: hi,
      })
    ).toBe(SPIN_TWO_OF_THREE_DEFER_MAX_MS);
  });

  it('stops deferring before rung 2 + safety margin could exceed SPIN_LADDER_MAX_TOTAL_MS', () => {
    const oldest = 1_000_000;
    // Safe ceiling is 130 min (140 - 10), rung 2 min is 30 min -> latest defer start is 95 min.
    const at96Min = oldest + 96 * MIN;
    expect(
      spinTwoOfThreeDeferMs({
        twoOfThreeCount: SPIN_MAX_TWO_OF_THREE,
        oldestSeatAtMs: oldest,
        nowMs: at96Min,
        rand: lo,
      })
    ).toBeNull();

    // Unknown oldestSeatAtMs fails safe (never defers blindly into an expiry).
    expect(
      spinTwoOfThreeDeferMs({
        twoOfThreeCount: SPIN_MAX_TWO_OF_THREE,
        oldestSeatAtMs: NaN,
        nowMs: at96Min,
        rand: lo,
      })
    ).toBeNull();
  });

  it('clamps rung-2 wait strictly inside safe envelope ceiling (130m < 140m alert / 150m expiry)', () => {
    const oldest = 1_000_000;
    const now = oldest + 95 * MIN;
    // Drawn rung-2 of 60 min would hit 155 min (> 140 min envelope); clamped to 35 min (130 min total).
    expect(clampSpinRungWaitMs(60 * MIN, oldest, now)).toBe(
      SPIN_LADDER_MAX_TOTAL_MS - SPIN_ENVELOPE_SAFETY_MARGIN_MS - 95 * MIN
    );
    // Unclamped when plenty of envelope remains (age 60m + 45m = 105m <= 130m).
    expect(clampSpinRungWaitMs(45 * MIN, oldest, oldest + 60 * MIN)).toBe(45 * MIN);
  });
});

describe('4. 12-hour simulation from 6:00 AM cold start proves mixed 0/3, 1/3, 2/3 all day', () => {
  it('maintains 53+ empty 0/3 boards, healthy 1/3 + 2/3 mix, never 11 at 2/3, and zero envelope breaches', () => {
    const rand = deterministicRand(20261122);
    const TOTAL_CONFIGS = 64;
    type Board = {
      id: number;
      paid: number;
      openedAtMs: number | null;
      startTimeMs: number;
    };
    const boards: Board[] = Array.from({ length: TOTAL_CONFIGS }, (_, i) => ({
      id: i,
      paid: 0,
      openedAtMs: null,
      startTimeMs: 0,
    }));

    const STEP_MS = 30_000;
    const TWELVE_HOURS_MS = 12 * 60 * MIN;
    let nextId = TOTAL_CONFIGS;
    let maxTwoOfThree = 0;
    let maxSeatAgeMs = 0;
    let totalDeals = 0;
    let minutesWithFullSeed = 0;
    let minutesWithMix = 0;

    for (let now = 0; now <= TWELVE_HOURS_MS; now += STEP_MS) {
      // 1. Recurring service seeds empty boards according to spinSeedsAllowedThisTick
      const openedBoards = boards.filter((b) => b.paid > 0);
      let mostRecentOpenedAt: number | null = null;
      for (const b of openedBoards) {
        if (
          b.openedAtMs !== null &&
          (mostRecentOpenedAt === null || b.openedAtMs > mostRecentOpenedAt)
        ) {
          mostRecentOpenedAt = b.openedAtMs;
        }
      }
      const allowed = spinSeedsAllowedThisTick(openedBoards.length, mostRecentOpenedAt, now, 12);
      const empties = boards.filter((b) => b.paid === 0);
      for (let k = 0; k < Math.min(allowed, empties.length); k++) {
        const b = empties[k];
        b.paid = 1;
        b.openedAtMs = now;
        b.startTimeMs = now + openingRungMs(3, rand);
      }

      // 2. GameServer fast lane advances due horse-only boards
      for (const b of boards) {
        if (b.paid === 0 || b.startTimeMs > now) continue;
        if (b.paid === 1) {
          const twoCount = boards.filter((x) => x.paid === 2).length;
          const defer = spinTwoOfThreeDeferMs({
            twoOfThreeCount: twoCount,
            oldestSeatAtMs: b.openedAtMs ?? NaN,
            nowMs: now,
            rand,
          });
          if (defer !== null) {
            b.startTimeMs = now + defer;
            continue;
          }
          b.paid = 2;
          const rawNext = nextRungMs(3, 2, rand)!;
          b.startTimeMs = now + clampSpinRungWaitMs(rawNext, b.openedAtMs ?? NaN, now);
        } else if (b.paid === 2) {
          const age = now - (b.openedAtMs ?? now);
          if (age > maxSeatAgeMs) maxSeatAgeMs = age;
          totalDeals++;
          // Board starts & leaves REGISTERING; replaced by a fresh empty 0/3 board
          b.id = nextId++;
          b.paid = 0;
          b.openedAtMs = null;
          b.startTimeMs = now + openingRungMs(3, rand);
        }
      }

      // 3. Measure invariants every tick
      const zeros = boards.filter((b) => b.paid === 0).length;
      const ones = boards.filter((b) => b.paid === 1).length;
      const twos = boards.filter((b) => b.paid === 2).length;
      expect(zeros).toBeGreaterThanOrEqual(TOTAL_CONFIGS - SPIN_BOARD_OPEN_TARGET);
      expect(ones + twos).toBeLessThanOrEqual(SPIN_BOARD_OPEN_TARGET);
      if (twos > maxTwoOfThree) maxTwoOfThree = twos;
      if (now >= 90 * MIN && ones + twos >= SPIN_BOARD_OPEN_TARGET - 1) {
        minutesWithFullSeed++;
        if (ones > 0 && twos > 0) minutesWithMix++;
      }
    }

    expect(totalDeals).toBeGreaterThan(40);
    // Soft-bounded by the envelope safety valve: never all 11 at 2/3, at least
    // ~half of the 11 horse-seeded Spins stay at 1/3 even in worst-case draws.
    expect(maxTwoOfThree).toBeLessThanOrEqual(SPIN_MAX_TWO_OF_THREE + 1);
    expect(maxTwoOfThree).toBeLessThan(SPIN_BOARD_OPEN_TARGET);
    expect(maxSeatAgeMs).toBeLessThanOrEqual(SPIN_LADDER_MAX_TOTAL_MS);
    expect(minutesWithFullSeed).toBeGreaterThan(0);
    // Genuine mix of 1/3 and 2/3 across virtually the entire steady-state day
    expect(minutesWithMix / minutesWithFullSeed).toBeGreaterThan(0.95);
    // SPIN_LADDER itself stays unchanged (60-80m + 30-60m = 140m max)
    expect(SPIN_LADDER).toEqual([
      { minMs: 60 * MIN, maxMs: 80 * MIN },
      { minMs: 30 * MIN, maxMs: 60 * MIN },
    ]);
  });
});

describe('5. empty 0/3 & 0/2 boards stay open for humans and never auto-cancel or auto-fill', () => {
  it('shouldCancelEmptyPastStartEvent never cancels an empty 0/3 Spin or 0/2 Heads-Up', () => {
    const now = Date.UTC(2026, 10, 22, 18, 0, 0);
    expect(
      shouldCancelEmptyPastStartEvent({
        seatFirst: true,
        poolFinalized: false,
        rosterCount: 0,
        currentPlayers: 0,
        startTimeMs: now - 8 * 60 * MIN,
        nowMs: now,
        emptyTopUps: 5,
        hostPoolHasHorse: false,
      })
    ).toBe(false);
  });

  it('ensureBoardOpen creates missing options empty (seedOpeningHorse: false) even when seedBudget is 0', () => {
    expect(RECURRING).toMatch(/this\.createSpin\(c as any, o, \{ seedOpeningHorse: false \}\)/);
    expect(RECURRING).toMatch(/this\.createSNG\(c as any, o, \{ seedOpeningHorse: false \}\)/);
    expect(RECURRING).not.toMatch(/if \(room === null \|\| room <= 0\) return;/);
    expect(RECURRING).toMatch(/if \(room === null\) return;/);
  });

  it('GameServer only applies the 2/3 cap to horse-only 1/3 Spins (humans always overtake immediately)', () => {
    const fill = GAME_SERVER.slice(
      GAME_SERVER.indexOf('private async fillPartialSeatFirstGame('),
      GAME_SERVER.indexOf('private async seatFirstNextWaitMs(')
    );
    expect(fill).toContain('if (!hasHuman && seats >= 3 && paid === 1)');
    expect(fill).toContain('spinTwoOfThreeDeferMs(');
    expect(fill).toContain('await this.deferSpinTwoOfThreeRung(');
    // And rung 2 clamps strictly inside the ladder envelope
    const advance = GAME_SERVER.slice(
      GAME_SERVER.indexOf('private async advanceSeatFirstRung('),
      GAME_SERVER.indexOf('/** Last "is a human seated here" answer')
    );
    expect(advance).toContain('clampSpinRungWaitMs(');
  });
});

describe('6. concurrency hardening: same-pass 2/3 tracker & human-seat race protection (2026-11-22)', () => {
  it('discoverSeatFirstStarts shares one mutable spinTwoOfThreeTracker across sibling jobs and increments before releasing in-flight claim', () => {
    const discover = GAME_SERVER.slice(
      GAME_SERVER.indexOf('private async discoverSeatFirstStarts('),
      GAME_SERVER.indexOf('private async fillPartialSeatFirstGame(')
    );
    expect(discover).toContain('const spinTwoOfThreeTracker = { count: spinTwoOfThreeCount };');
    expect(discover).toContain("t.variant === 'spin' ? spinTwoOfThreeTracker : undefined");

    const fill = GAME_SERVER.slice(
      GAME_SERVER.indexOf('private async fillPartialSeatFirstGame('),
      GAME_SERVER.indexOf('private async seatFirstNextWaitMs(')
    );
    expect(fill).toContain('spinTwoOfThreeTracker: { count: number } = { count: 0 }');
    expect(fill).toContain(
      'spinTwoOfThreeTracker.count + this.spinTwoOfThreePromotionsInFlight.size'
    );
    const incAt = fill.indexOf('spinTwoOfThreeTracker.count++;');
    const delAt = fill.indexOf('this.spinTwoOfThreePromotionsInFlight.delete(tournamentId);');
    expect(incAt).toBeGreaterThan(-1);
    expect(delAt).toBeGreaterThan(incAt);
  });

  it('reopenEmptySeatFirstBoard guards on current_players = 0 and returns typed seeded/no_horses/skipped outcomes', () => {
    const reopen = RECURRING.slice(
      RECURRING.indexOf('private async reopenEmptySeatFirstBoard('),
      RECURRING.indexOf('private async seedOpenSeatTable(')
    );
    expect(reopen).toContain("Promise<'seeded' | 'no_horses' | 'skipped'>");
    expect(reopen).toContain(".eq('status', 'REGISTERING')");
    expect(reopen).toContain(".eq('current_players', 0)");
    expect(reopen).toContain("return 'no_horses';");
    expect(reopen).toContain("return 'skipped';");
    expect(reopen).toContain("return 'seeded';");

    // A 'skipped' board (human raced in) does not break the owner loop and spends 0 seedBudget.
    const open = RECURRING.slice(
      RECURRING.indexOf('private async ensureBoardOpen<'),
      RECURRING.indexOf('private async checkAndLaunchXMTTs(')
    );
    expect(open).toMatch(
      /const outcome = await this\.reopenEmptySeatFirstBoard\(board\);\s*if \(outcome === 'no_horses'\) break;\s*if \(outcome === 'seeded'\) seedBudget\.left--;/
    );
  });
});
