/**
 * The daily window has one source of truth, and tournament hours are enforced
 * (owner, 2026-11-03): games close 4:00 to 6:00 AM Chicago, tournaments start
 * 6:00 AM to 11:00 PM, Spins and Sit & Gos stop at 3:00 AM.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';

const dir = 'supabase/migrations';
const file = fs
  .readdirSync(dir)
  .find((f) => f.endsWith('_daily_window_policy_and_tournament_hours.sql'));
const sql = file ? fs.readFileSync(`${dir}/${file}`, 'utf8') : '';

describe('the daily window has one source of truth', () => {
  it('holds every time in one Chicago policy row', () => {
    for (const [col, t] of [
      ['spin_sng_stop', '03:00'],
      ['last_hand', '03:58'],
      ['window_start', '04:00'],
      ['window_end', '06:00'],
      ['first_tournament_start', '06:00'],
      ['last_tournament_start', '23:00'],
      ['monday_reopen_limit', '07:00'],
    ])
      expect(sql).toContain(`${col} time NOT NULL DEFAULT '${t}'`);
    expect(sql).toContain("time_zone text NOT NULL DEFAULT 'America/Chicago'");
  });
  it('refuses only NEW entries, at the one door every registration passes', () => {
    expect(sql).toContain("tp.status IN ('registered','playing')) THEN");
    expect(sql).toContain(
      'v_window_refusal := public.fn_daily_window_entry_refusal(p_tournament_id);'
    );
    expect(sql).toContain("kind IN ('SPIN','SNG') AND local_t >= p.spin_sng_stop");
  });
  it('refuses schedule times outside the daily hours, and retires the 1 AM events', () => {
    expect(sql).toContain("'tournament_start_outside_daily_hours'");
    expect(sql).toContain("s.start_times_utc='{01:00}'");
  });
  it('is guarded, exact and moves no money', () => {
    expect(sql).toContain("'aa265e27cee6b1ae2fd06a9f729d7903'");
    expect(sql).toContain("'a09f6bb1f74305694c18a437e01b39bb'");
    expect(sql).not.toMatch(/chip_ledger|fn_club_bank_send|wallet_transactions/);
  });
});
