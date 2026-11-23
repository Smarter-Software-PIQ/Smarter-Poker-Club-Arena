/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  HEADS-UP WAIT MODE: REAL ENGINE BACKING FOR "PLAY ANYONE" vs "SPECIFIC PLAYER"
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Pins the server-side contract of `public.heads_up_wait_holds` across:
 *   1. `seatFirstHumanPartnerHoldUntilMs` with `play_anyone`, active bounded
 *      `specific_player`, expired `specific_player`, malformed/far-future
 *      `specific_player` (clamped at 5 min), and omitted default mode.
 *   2. `resolveHeadsUpWaitHoldOverride` ignoring stale holds when the creator
 *      has already left the table.
 *   3. `TournamentRecurringService.topUpWithHorses` filling immediately on
 *      `play_anyone`, holding on active `specific_player`, and falling open
 *      cleanly once the bounded hold expires.
 *   4. `GameServer.fillPartialSeatFirstGame` reading `heads_up_wait_holds`
 *      only for 2-max boards with a seated human and forwarding the override.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const rpcMock = vi.fn();
type TableAnswer = { data: unknown; error: { message: string } | null };
let tableResults: Record<string, TableAnswer> = {};

vi.mock('./supabase/client.js', () => {
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'is', 'in', 'limit', 'order', 'neq', 'not', 'update', 'gt']) {
      b[m] = () => b;
    }
    const answer = () =>
      Promise.resolve(
        tableResults[table] ?? { data: null, error: { message: `no mock for ${table}` } }
      );
    b.maybeSingle = answer;
    b.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => answer().then(ok, bad);
    return b;
  };
  const client = {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (table: string) => builder(table),
  };
  return { supabase: client, maintenanceSupabase: client };
});
const reportErrorMock = vi.fn();
vi.mock('./errorReporter.js', () => ({ reportError: (...a: unknown[]) => reportErrorMock(...a) }));

import {
  HEADS_UP_SPECIFIC_HOLD_MAX_MS,
  SEAT_FIRST_HUMAN_PARTNER_HOLD_MS,
  TournamentRecurringService,
  resolveHeadsUpWaitHoldOverride,
  seatFirstHumanPartnerHoldUntilMs,
} from './TournamentRecurringService.js';

const GAME_SERVER = readFileSync(join(__dirname, '..', 'GameServer.ts'), 'utf8');

const SAT = Date.parse('2026-11-22T02:00:00.000Z');
const WINDOW = SAT + 3_600_000;

describe('seatFirstHumanPartnerHoldUntilMs wait-mode overrides', () => {
  it('play_anyone releases the partner hold immediately (-Infinity)', () => {
    expect(
      seatFirstHumanPartnerHoldUntilMs(WINDOW, SAT, 45_000, SAT - 10_000, {
        waitMode: 'play_anyone',
        holdExpiresAtMs: SAT,
        nowMs: SAT + 1_000,
      })
    ).toBe(-Infinity);
  });

  it('specific_player with an active hold keeps seat 2 reserved until holdExpiresAtMs', () => {
    const now = SAT + 5_000;
    const expires = now + 240_000;
    expect(
      seatFirstHumanPartnerHoldUntilMs(WINDOW, SAT, 0, SAT - 10_000, {
        waitMode: 'specific_player',
        holdExpiresAtMs: expires,
        nowMs: now,
      })
    ).toBe(expires);
  });

  it('specific_player clamps a far-future timestamp to HEADS_UP_SPECIFIC_HOLD_MAX_MS (anti-lockout)', () => {
    const now = SAT + 5_000;
    const farFuture = now + 24 * 3_600_000;
    expect(
      seatFirstHumanPartnerHoldUntilMs(WINDOW, SAT, 0, SAT - 10_000, {
        waitMode: 'specific_player',
        holdExpiresAtMs: farFuture,
        nowMs: now,
      })
    ).toBe(now + HEADS_UP_SPECIFIC_HOLD_MAX_MS);
    expect(HEADS_UP_SPECIFIC_HOLD_MAX_MS).toBe(5 * 60_000);
  });

  it('specific_player with an expired hold falls open cleanly (-Infinity)', () => {
    const now = SAT + 310_000;
    const expired = SAT + 300_000;
    expect(
      seatFirstHumanPartnerHoldUntilMs(WINDOW, SAT, 0, SAT - 10_000, {
        waitMode: 'specific_player',
        holdExpiresAtMs: expired,
        nowMs: now,
      })
    ).toBe(-Infinity);
  });

  it('specific_player with missing or non-finite holdExpiresAtMs fails open (-Infinity)', () => {
    expect(
      seatFirstHumanPartnerHoldUntilMs(WINDOW, SAT, 0, SAT - 10_000, {
        waitMode: 'specific_player',
        holdExpiresAtMs: null,
        nowMs: SAT + 1_000,
      })
    ).toBe(-Infinity);
  });

  it('omitted or null waitMode preserves the exact default 3-7 minute hold behavior', () => {
    const baseline = seatFirstHumanPartnerHoldUntilMs(WINDOW, SAT, 20_000);
    expect(baseline).toBe(SAT + SEAT_FIRST_HUMAN_PARTNER_HOLD_MS + 20_000);
    expect(seatFirstHumanPartnerHoldUntilMs(WINDOW, SAT, 20_000, NaN, undefined)).toBe(baseline);
    expect(seatFirstHumanPartnerHoldUntilMs(WINDOW, SAT, 20_000, NaN, { waitMode: null })).toBe(
      baseline
    );
  });

  it('never holds a horse-only board even if an override is passed', () => {
    expect(
      seatFirstHumanPartnerHoldUntilMs(WINDOW, NaN, 0, NaN, {
        waitMode: 'specific_player',
        holdExpiresAtMs: SAT + 300_000,
        nowMs: SAT,
      })
    ).toBe(-Infinity);
  });
});

describe('resolveHeadsUpWaitHoldOverride', () => {
  it('ignores stale holds when the creator is no longer seated', () => {
    const override = resolveHeadsUpWaitHoldOverride(
      {
        tournament_id: 't-1',
        creator_user_id: 'alice',
        wait_mode: 'specific_player',
        hold_expires_at: new Date(SAT + 300_000).toISOString(),
      },
      new Set(['bob'])
    );
    expect(override).toBeUndefined();
  });

  it('honors holds whose creator is currently seated', () => {
    const expiresIso = new Date(SAT + 300_000).toISOString();
    const override = resolveHeadsUpWaitHoldOverride(
      {
        tournament_id: 't-1',
        creator_user_id: 'alice',
        wait_mode: 'specific_player',
        hold_expires_at: expiresIso,
      },
      new Set(['alice'])
    );
    expect(override).toEqual({
      waitMode: 'specific_player',
      holdExpiresAtMs: Date.parse(expiresIso),
    });
  });

  it('ignores unknown wait_mode values', () => {
    expect(
      resolveHeadsUpWaitHoldOverride({
        creator_user_id: 'alice',
        wait_mode: 'unknown_mode',
        hold_expires_at: null,
      })
    ).toBeUndefined();
  });
});

describe('topUpWithHorses honours persisted heads_up_wait_holds', () => {
  const T = 'aaaaaaaa-0000-4000-8000-0000000000bb';
  const TABLE = 'bbbbbbbb-0000-4000-8000-0000000000cc';
  const HUMAN = 'cccccccc-0000-4000-8000-0000000000dd';
  let svc: TournamentRecurringService;
  let pick: ReturnType<typeof vi.spyOn>;

  function setupHeadsUpBoard(humanSatMsAgo: number, holdRow: Record<string, unknown> | null): void {
    tableResults = {
      tournaments: {
        data: {
          variant: 'sng',
          format_contract: 'sng-v1',
          max_players: 2,
          club_id: 'club',
          start_time: new Date(Date.now() + 60_000).toISOString(),
          prize_pool_finalized: false,
        },
        error: null,
      },
      table_seats: {
        data: [
          {
            user_id: HUMAN,
            seat_number: 1,
            joined_at: new Date(Date.now() - humanSatMsAgo).toISOString(),
          },
        ],
        error: null,
      },
      profiles: { data: [{ id: HUMAN, is_horse: false }], error: null },
      tables: { data: { max_players: 2 }, error: null },
      heads_up_wait_holds: { data: holdRow, error: null },
    };
  }

  beforeEach(() => {
    rpcMock.mockReset();
    reportErrorMock.mockReset();
    rpcMock.mockImplementation(async (name: string) => {
      if (name === 'fn_tournament_primary_table') return { data: TABLE, error: null };
      return { data: { ok: true, seat_number: 2 }, error: null };
    });
    svc = new TournamentRecurringService();
    // No game in this file holds a seat for an invited friend (privateGameHolds.ts).
    vi.spyOn(svc.privateGameHolds, 'snapshot').mockResolvedValue(new Map());
    pick = vi
      .spyOn(svc as unknown as { pickFreeHorses: () => Promise<string[]> }, 'pickFreeHorses')
      .mockResolvedValue(['free-1', 'free-2']);
    vi.spyOn(
      svc as unknown as { unseatedRegistrantHorses: () => Promise<string[]> },
      'unseatedRegistrantHorses'
    ).mockResolvedValue([]);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('fills seat 2 immediately when the seated human picked play_anyone', async () => {
    setupHeadsUpBoard(4_000, {
      tournament_id: T,
      creator_user_id: HUMAN,
      wait_mode: 'play_anyone',
      hold_expires_at: new Date(Date.now() - 1_000).toISOString(),
    });
    expect(await svc.topUpWithHorses(T, 2, { forHuman: true })).toBe(1);
    expect(pick).toHaveBeenCalled();
    expect(svc.seatFirstPartnerHoldUntil(T)).toBe(-Infinity);
  });

  it('keeps seat 2 open for the invited friend while specific_player hold is active', async () => {
    const expiresAt = Date.now() + 240_000;
    setupHeadsUpBoard(4_000, {
      tournament_id: T,
      creator_user_id: HUMAN,
      wait_mode: 'specific_player',
      hold_expires_at: new Date(expiresAt).toISOString(),
    });
    expect(await svc.topUpWithHorses(T, 2, { forHuman: true })).toBe(0);
    expect(pick).not.toHaveBeenCalled();
    expect(svc.seatFirstPartnerHoldUntil(T)).toBeGreaterThan(Date.now());
  });

  it('resumes normal fill cleanly once a specific_player hold expires', async () => {
    setupHeadsUpBoard(4_000, {
      tournament_id: T,
      creator_user_id: HUMAN,
      wait_mode: 'specific_player',
      hold_expires_at: new Date(Date.now() - 5_000).toISOString(),
    });
    expect(await svc.topUpWithHorses(T, 2, { forHuman: true })).toBe(1);
    expect(pick).toHaveBeenCalled();
    expect(svc.seatFirstPartnerHoldUntil(T)).toBe(-Infinity);
  });

  it('ignores a stale specific_player hold left behind by a different creator', async () => {
    setupHeadsUpBoard(4_000, {
      tournament_id: T,
      creator_user_id: 'dddddddd-0000-4000-8000-0000000000ee',
      wait_mode: 'play_anyone',
      hold_expires_at: new Date(Date.now() - 1_000).toISOString(),
    });
    // Stale play_anyone from a departed player must NOT skip the new seated human's default hold.
    expect(await svc.topUpWithHorses(T, 2, { forHuman: true })).toBe(0);
    expect(pick).not.toHaveBeenCalled();
  });
});

describe('GameServer fast-lane wiring for heads_up_wait_holds', () => {
  const start = GAME_SERVER.indexOf('private async fillPartialSeatFirstGame(');
  const fill = GAME_SERVER.slice(start, GAME_SERVER.indexOf('\n  private ', start + 10));

  it('reads heads_up_wait_holds only for 2-max boards with a human and passes override to seatFirstHumanPartnerHoldUntilMs', () => {
    expect(fill).toContain('seats === 2');
    expect(fill).toContain('readHeadsUpWaitHoldOverride(tournamentId, occupancy.humanUserIds)');
    expect(fill).toContain('waitOverride');
    expect(GAME_SERVER).toContain(".from('heads_up_wait_holds')");
    expect(GAME_SERVER).toContain('.maybeSingle()');
  });
});
