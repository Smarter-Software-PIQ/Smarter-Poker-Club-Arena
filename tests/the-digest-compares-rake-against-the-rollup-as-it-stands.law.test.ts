/**
 * THE DAILY DIGEST COMPARES RAKE AGAINST THE ROLLUP AS IT STANDS AT SEND TIME
 * (2026-11-23, Production Alerts fleet, incident 271783-digest-rake-rollup).
 *
 * operational_alert_events 271783 (day 2026-10-24) and 281560 (day 2026-10-26)
 * are DailyDigest.rake_rollup_mismatch with rollup 0.00 against a ledger of
 * 343,158.54 and 431,016.15. No chip was missing: club_rake_daily_user for
 * both days now equals the ledger to the cent. Two defects produced the zero:
 *
 * 1. fn_sp_daily_digest compared the ledger with the rollup value frozen in
 *    the day's metrics snapshot, taken before the hourly rollup catch-up had
 *    written the day. 20261025143717 re-reads club_rake_daily_user at send
 *    time and records rollup_rechecked_at.
 * 2. The rollup catch-up itself (cron job 128, club-rake-rollup-catchup)
 *    exhausted its 300 s budget reading the day's facts several times, so on
 *    2026-10-26 the day was still unwritten when the digest re-read it.
 *    20261027005822 reads each club cutoff once and 20261027063331 reads one
 *    day of facts once (MATERIALIZED) for all five report relations.
 *
 * This law keeps both fixes in place.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(__dirname, '..', 'supabase', 'migrations');
const files = readdirSync(DIR)
  .filter((f) => /^\d{14}_.+\.sql$/.test(f))
  .sort();

const RECHECK = '20261025143717_digest_counts_original_alerts_rather_than_source_updates.sql';
const CUTOFF = '20261027005822_reporting_rollups_read_each_club_cutoff_once.sql';
const DAY_FACTS = '20261027063331_reporting_rollups_share_one_bounded_day_fact_read.sql';

const read = (f: string) => (files.includes(f) ? readFileSync(join(DIR, f), 'utf8') : '');

describe('the digest compares rake against the rollup as it stands at send time', () => {
  it('all three fixing migrations are present', () => {
    expect(files).toContain(RECHECK);
    expect(files).toContain(CUTOFF);
    expect(files).toContain(DAY_FACTS);
  });

  it('the digest re-reads the rollup at send time and records when', () => {
    const sql = read(RECHECK);
    expect(sql).toContain(
      'FROM public.club_rake_daily_user WHERE day = v_day)'
    );
    expect(sql).toContain("'rollup_rake_utc_day', v_rake_rollup, 'rollup_rechecked_at', clock_timestamp()");
    // The comparison is made on the refreshed metrics, not the stored snapshot.
    expect(sql).toMatch(/v_live := public\.fn_sp_digest_attention\(v_day, v_row\.metrics\);/);
  });

  it('the recheck changes no money and no snapshot', () => {
    const sql = read(RECHECK);
    expect(sql).not.toMatch(/\b(UPDATE|INSERT INTO|DELETE FROM)\s+public\.(club_rake_daily_user|chip_ledger|club_members)\b/i);
  });

  it('the rollup catch-up reads one day of facts once for every report relation', () => {
    const sql = read(DAY_FACTS);
    expect(sql).toContain('WITH day_facts AS MATERIALIZED (');
    expect((sql.match(/FROM day_facts f/g) || []).length).toBeGreaterThanOrEqual(5);
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.fn_club_rake_rollup_catchup(');
  });

  it('no later migration drops the send-time recheck', () => {
    for (const f of files.slice(files.indexOf(RECHECK) + 1)) {
      const sql = readFileSync(join(DIR, f), 'utf8');
      if (/CREATE OR REPLACE FUNCTION public\.fn_sp_daily_digest\(/.test(sql)) {
        expect(sql, `${f} redefines the digest`).toContain('rollup_rechecked_at');
      }
    }
  });

  it('no later migration un-materializes the shared day fact read', () => {
    for (const f of files.slice(files.indexOf(DAY_FACTS) + 1)) {
      const sql = readFileSync(join(DIR, f), 'utf8');
      if (/CREATE OR REPLACE FUNCTION public\.fn_ca_reporting_rollups_from_facts\(/.test(sql)) {
        expect(sql, `${f} redefines the reporting rollup`).toContain('day_facts AS MATERIALIZED');
      }
    }
  });
});
