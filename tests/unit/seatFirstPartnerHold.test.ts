/**
 * The seat's view of the partner hold (2026-10-04): a seated player waiting
 * for a second person sees the wait named and counted down, never a felt that
 * looks frozen. Mirrors TournamentRecurringService.seatFirstHumanPartnerHoldUntilMs.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  seatFirstPartnerHoldClock,
  seatFirstPartnerHoldEndsAtMs,
  seatFirstPartnerHoldLabel,
  seatFirstPartnerHoldStatus,
} from '../../src/utils/seatFirstPartnerHold';
import { sliceEnclosingBlock } from '../helpers/sourceWindow';

const TABLE_PAGE = readFileSync(
  join(__dirname, '..', '..', 'src', 'pages', 'TablePage.tsx'),
  'utf8'
);
const SERVER = readFileSync(
  join(__dirname, '..', '..', 'server', 'src', 'services', 'TournamentRecurringService.ts'),
  'utf8'
);

describe('seatFirstPartnerHoldEndsAtMs', () => {
  const sat = 1_000_000;
  it('counts to the end of the whole 3-7 band, whatever the board window says', () => {
    /* 2026-11-08: the board's own window no longer enters into it. A
       horse-opened board now waits HOURS for a person (the ladder), so taking
       the later of the two would have stranded the one person who sat down.
       Every case below is the same instant on purpose - that is the rule.

       2026-11-09: that instant moved from 3:30 to 7:00. The engine now draws
       the fill across the whole band Dan gave ("WITHIN 3-7 MIN") instead of
       its first thirty seconds, and this countdown says "At The Latest", so
       it has to name the latest the engine is allowed to be. */
    expect(seatFirstPartnerHoldEndsAtMs(sat + 15_000, sat)).toBe(sat + 420_000);
    expect(seatFirstPartnerHoldEndsAtMs(sat + 200_000, sat)).toBe(sat + 420_000);
    expect(seatFirstPartnerHoldEndsAtMs(sat + 4 * 3_600_000, sat)).toBe(sat + 420_000);
  });

  it('never holds a seated person longer than 7 minutes', () => {
    expect(seatFirstPartnerHoldEndsAtMs(sat, sat)).toBeLessThanOrEqual(sat + 420_000);
  });
  it('with no seat time at all it is still an upper bound on the window', () => {
    expect(seatFirstPartnerHoldEndsAtMs(sat, null)).toBe(sat + 240_000);
    expect(seatFirstPartnerHoldEndsAtMs(null, null)).toBe(-Infinity);
  });
  it('uses the same spread as the engine', () => {
    expect(SERVER).toContain(
      'export const SEAT_FIRST_HUMAN_PARTNER_HOLD_SPREAD_MS =\n  SEAT_FIRST_HUMAN_WINDOW_MAX_MS - SEAT_FIRST_HUMAN_WINDOW_MIN_MS;'
    );
  });
  it('uses the same constants as the engine', () => {
    expect(SERVER).toContain(
      'export const SEAT_FIRST_HUMAN_PARTNER_HOLD_MS = SEAT_FIRST_HUMAN_WINDOW_MIN_MS;'
    );
    /* 2026-11-08: the two window constants now carry Dan's 3-7 minute human
       rule rather than the retired 90-350 second board window. */
    expect(SERVER).toContain('export const SEAT_FIRST_HUMAN_WINDOW_MIN_MS = HUMAN_ARRIVAL_MIN_MS;');
    expect(SERVER).toContain('export const SEAT_FIRST_HUMAN_WINDOW_MAX_MS = HUMAN_ARRIVAL_MAX_MS;');
  });
});

describe('copy', () => {
  it('counts down in whole seconds and never reads 0:00 while waiting', () => {
    expect(seatFirstPartnerHoldClock(65_000)).toBe('1:05');
    expect(seatFirstPartnerHoldClock(1)).toBe('0:01');
    expect(seatFirstPartnerHoldStatus(30_500)).toBe('Deals In 0:31 At The Latest');
  });
  it('names one seat or several', () => {
    expect(seatFirstPartnerHoldLabel(1)).toBe('Seat Reserved, Holding The Other Seat For A Player');
    expect(seatFirstPartnerHoldLabel(2)).toBe('Seat Reserved, Holding 2 Seats For Other Players');
  });
});

describe('the table wires it', () => {
  it('reads start_time on both seat-first reads and keeps it on the sheet', () => {
    expect(TABLE_PAGE).toContain('startTimeMs: parseStartTimeMs(tournData.start_time)');
    expect(TABLE_PAGE).toContain(
      'startTimeMs: parseStartTimeMs((row as { start_time?: unknown }).start_time)'
    );
    expect(TABLE_PAGE).toMatch(/prize_pool_finalized, start_time, is_rebuy, is_reentry'/);
    expect(TABLE_PAGE).toMatch(/buy_in_fee, starting_chips, start_time'/);
  });
  it('the footer shows the hold, and the stall alarm starts only after it', () => {
    expect(TABLE_PAGE).toContain('return seatFirstPartnerHoldLabel(left);');
    expect(TABLE_PAGE).toContain('seatFirstPartnerHoldStatus(holdEnds - seatFillClock)');
  });
});

describe('the hold is measured from the seat the database holds', () => {
  it('the roster sync reads the hero joined_at and every hold read prefers it', () => {
    expect(TABLE_PAGE).toContain(
      ".select('seat_number, user_id, stack, is_sitting_out, joined_at')"
    );
    expect(TABLE_PAGE).toContain(
      'heroSeatJoinedAtRef.current = Number.isFinite(joined) ? joined : null;'
    );
    // Every hold read goes through the one helper that prefers the database
    // seat time and works on the database clock.
    expect(TABLE_PAGE.split('partnerHoldEndsLocalMs(seatFirstBuyIn').length - 1).toBe(4);
    expect(TABLE_PAGE).toContain('heroSeatJoinedAtRef.current ??');
    expect(TABLE_PAGE).not.toMatch(
      /seatFirstPartnerHoldEndsAtMs\([^)]*,\s*seatAcquiredAtRef\.current\s*\)/
    );
  });
  it('the countdown runs on the database clock, measured once per roster sync', () => {
    expect(TABLE_PAGE).toContain("void Promise.resolve(supabase.rpc('fn_db_now')).then(");
    expect(TABLE_PAGE).toContain('const offset = answeredAt - (at + (answeredAt - askedAt) / 2);');
    expect(TABLE_PAGE).toContain('const offset = dbClockOffsetMsRef.current;');
    // Its own offset: the engine's serverClock is not fed from the database.
    expect(TABLE_PAGE).not.toContain('recordServerTime(');
    expect(TABLE_PAGE).toContain(
      'return Number.isFinite(endsServerMs) ? endsServerMs + offset : endsServerMs;'
    );
  });
  it('the stall timer re-measures the hold when it fires and re-arms while it runs', () => {
    expect(TABLE_PAGE).toContain('timer = window.setTimeout(fire, stillHolding + 30_000);');
    expect(TABLE_PAGE).toContain('timer = window.setTimeout(fire, holdLeftMs() + 30_000);');
  });
  it('the countdown clock decides its pace on every tick', () => {
    expect(TABLE_PAGE).toContain('if (counting || ticks % 15 === 0) setSeatFillClock(Date.now());');
  });
});

describe('the felt deals the moment the game does', () => {
  it('every pre-start path that learns play has begun asks the socket to join', () => {
    expect(TABLE_PAGE.split('seatFirstDealtAtRef.current = Date.now();').length - 1).toBe(3);
  });
  it('a full board re-reads its row each second, bounded, instead of every 10 s', () => {
    expect(TABLE_PAGE).toContain(
      'if (seatRows.length >= seatFirstBuyIn.seats && fullRechecks < 15 && !fullRecheckTimer)'
    );
    expect(TABLE_PAGE).toContain('if (fullRecheckTimer) window.clearTimeout(fullRecheckTimer);');
  });
  it('the socket is asked to join when play begins, until it is up, for at most 30 s', () => {
    expect(TABLE_PAGE).toContain('seatFirstDealtAtRef.current = Date.now();');
    const effect = sliceEnclosingBlock(
      TABLE_PAGE,
      "if (!playHasBegun || began === null || engineWsStatus === 'connected') return;"
    );
    expect(effect).toContain('const began = seatFirstDealtAtRef.current;');
    expect(effect).toContain('reconnectEngineNow();');
    expect(effect).toContain('}, 1_500);');
    expect(effect).toContain('Date.now() - began > 30_000');
    expect(TABLE_PAGE).toContain('}, [playHasBegun, engineWsStatus, reconnectEngineNow]);');
  });
});
