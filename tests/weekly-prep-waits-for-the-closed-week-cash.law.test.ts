/**
 * LAW: WEEKLY PREPARATION WAITS FOR THE CLOSED WEEK'S CASH (2026-11-26,
 * incident 6377941a, Monday 2026-11-23).
 *
 * A preparation unit holds the scope's 'club-accounting:' key (shared) while it
 * computes, and every closed-week cash accrual only try-locks that key
 * (weekly_payout_source_changed). Preparing while the settler still owed the
 * last half hour of the week refused 1,619 sources, which came back on the
 * settler's 30-minute retry cycles and restarted the week's counts until
 * 05:45 Chicago. Preparation therefore waits until the settler's cursor has
 * passed the week and no cash source of the week waits in the retry queue,
 * with a fallback an hour before the payout. The two per-source admissions
 * that wiped a club's whole week of split parts drop only the source's own
 * window plus the whole-week aggregates.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SQL = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20261126175930_weekly_prep_waits_for_the_closed_week_cash_and_late_admissio.sql'
  ),
  'utf8'
);

describe('weekly preparation waits for the closed week cash (incident 6377941a)', () => {
  it('is one transaction with lock and statement timeouts and a live proof', () => {
    expect(SQL.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(SQL.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(SQL).toContain("SET LOCAL lock_timeout = '5s';");
    expect(SQL).toContain("SET LOCAL statement_timeout = '10s';");
    expect(SQL).toMatch(/^-- @live-proof: /m);
  });

  it('settled means: settler cursor past every positive cash record of the week, and no retryable blocked source', () => {
    expect(SQL).toContain("WHERE d.daemon = 'rakeback_settler'");
    expect(SQL).toContain('AND (rr.created_at > hw OR hid IS NULL OR rr.id > hid)');
    expect(SQL).toContain("AND w.next_attempt_at < 'infinity'::timestamptz");
    expect(SQL).toContain("w.status = 'blocked'");
    // An unknown cursor or an open week is never settled.
    expect(SQL).toMatch(/IF hw IS NULL THEN\s+RETURN false;/);
    expect(SQL).toContain('p_end > clock_timestamp() THEN');
  });

  it('the preparation gate keeps a fallback an hour before the payout', () => {
    expect(SQL).toContain(
      " IF n<due-interval ''1 hour'' AND smarter_private.weekly_closed_week_cash_settled(e) IS DISTINCT FROM true THEN RETURN; END IF;"
    );
  });

  it('rewrites each function from its pinned live definition and proves the postimage', () => {
    expect(SQL).toContain("old_prep constant text := 'f412aa3847adec2b5a50cff631074502'");
    expect(SQL).toContain("old_fund constant text := '7e474a2d701a3b4475d2b3070d5ad661'");
    expect(SQL).toContain("old_adm constant text := '48733d7e37ad8cd532a9c7973cf3bfe0'");
    expect(SQL).toContain('CLOSED_WEEK_CASH_FIRST_ANCHOR_COUNT');
    expect(SQL).toContain('CLOSED_WEEK_CASH_FIRST_POSTIMAGE');
  });

  it('admissions no longer delete a whole club-week of split parts', () => {
    const repl = SQL.slice(SQL.indexOf('repls := ARRAY['), SQL.indexOf('FOR i IN 1..3 LOOP'));
    expect(repl.match(/weekly_split_part_covers\(sp\.kind,sp\.part,w_from,w_to,s\.earned_at,/g)).toHaveLength(2);
    expect(repl).toContain("p_type=''tournament_fee_accrual''");
  });

  it('keeps the window numbering of weekly_refresh_changed_payout_windows and the one-minute margin', () => {
    expect(SQL).toContain("p_start + p_part * interval '2 hours' <= p_at + interval '1 minute'");
    expect(SQL).toContain("LEAST(p_start + (p_part + 1) * interval '2 hours', p_end) > p_at - interval '1 minute'");
    expect(SQL).toContain("p_start + p_part * interval '6 hours' <= p_at + interval '1 minute'");
  });

  it('revokes the new helpers from PUBLIC, anon and authenticated', () => {
    expect(SQL).toContain(
      'REVOKE ALL ON FUNCTION smarter_private.weekly_closed_week_cash_settled(timestamptz)\n  FROM PUBLIC, anon, authenticated;'
    );
    expect(SQL).toContain(
      'REVOKE ALL ON FUNCTION smarter_private.weekly_split_part_covers(text, integer, timestamptz, timestamptz, timestamptz, boolean)\n  FROM PUBLIC, anon, authenticated;'
    );
  });
});
