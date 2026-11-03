/**
 * The Phase 2 audit of the daily window (owner, 2026-11-03) closed five gaps
 * found against production after the window shipped:
 *  1. a Spin or Sit & Go seat purchase names only its table, and the 3:00 AM
 *     refusal ran only when a tournament id was passed;
 *  2. a heads-up SATELLITE was not a seat-first game to the window;
 *  3. a schedule in another zone (or UTC in summer) was judged on the wrong clock;
 *  4. a one-off tournament could start at any hour;
 *  5. the engine published interval-schedule and union events at any hour, and
 *     a horse pass kept asking every horse after the window said no.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';

const dir = 'supabase/migrations';
const file = fs
  .readdirSync(dir)
  .find((f) => f.endsWith('_daily_window_audit_closes_seat_first_and_zone_gaps.sql'));
const sql = file ? fs.readFileSync(`${dir}/${file}`, 'utf8') : '';
const read = (p: string) => fs.readFileSync(p, 'utf8');

describe('the daily window audit closes the seat-first and zone gaps', () => {
  it('reads a seat purchase tournament from its table and never refuses a seated player', () => {
    expect(file).toBeTruthy();
    expect(sql).toContain(
      'v_window_tournament := COALESCE(p_tournament_id,(SELECT tb.tournament_id FROM public.tables tb WHERE tb.id=p_table_id));'
    );
    expect(sql).toContain("tp.status IN ('registered','playing'))");
    expect(sql).toContain('ts.user_id=p_user_id AND ts.left_at IS NULL');
    expect(sql).toContain('v_window_refusal := public.fn_daily_window_entry_refusal(v_window_tournament);');
    expect(sql).toContain("IS DISTINCT FROM 'b0f09e751bb0f551c0abcc4e0f3161a2'");
  });

  it('decides seat-first games with one predicate everywhere', () => {
    expect(sql).toContain(
      "SELECT upper(coalesce(p_type,'')) IN ('SPIN','SNG')\n     OR (upper(coalesce(p_type,''))='SATELLITE' AND p_max_players IS NOT NULL)"
    );
    // the 3:00 AM refusal, the lobby close (scan and recount) and the watchdog
    expect(sql.match(/fn_daily_window_seat_first_kind\(t\.tournament_type, t\.max_players\)/g)?.length).toBe(4);
    expect(sql).not.toContain("upper(coalesce(t.tournament_type,'')) IN ('SPIN','SNG')");
  });

  it('judges every schedule start on the Chicago clock in winter and summer', () => {
    expect(sql).toContain("unnest(ARRAY['2026-01-15'::date,'2026-07-15'::date]) dd");
    expect(sql).toContain(
      "(((dd + tm::time) AT TIME ZONE coalesce(v_zone,'UTC')) AT TIME ZONE pol.time_zone)::time"
    );
    expect(sql).toContain('pg_catalog.pg_timezone_names z WHERE z.name=v_zone');
    expect(sql).toContain("IS DISTINCT FROM '8f89aa16ea2987b4acc2f9efa407ed3e'");
  });

  it('refuses a one-off tournament outside 6:00 AM to 11:00 PM, database and browser alike', () => {
    expect(sql).toContain("RETURN 'tournament_start_outside_daily_hours';");
    expect(sql).toContain("IS DISTINCT FROM 'c1a376cb8d9a01b4ba9db181c7ab9e50'");
    const rules = read('src/lib/tournamentCreationRules.ts');
    expect(rules).toContain("return 'tournament_start_outside_daily_hours';");
    expect(rules).toContain('tournament_start_outside_daily_hours:');
  });

  it('keeps every engine spawner inside the hours and stops a refused horse pass', () => {
    const scheduled = read('server/src/services/ScheduledTournamentService.ts');
    expect(scheduled).toContain('if (!tournamentStartAllowed(startTime)) return;');
    const recurring = read('server/src/services/TournamentRecurringService.ts');
    expect(recurring).toContain(
      'if (!tournamentStartAllowed(startTime)) return { tournamentId: null, registered: 0 };'
    );
    expect(recurring).toContain("'daily_maintenance_window',\n              'spin_sng_closed_until_reopen',");
  });

  it('carries a live proof and moves no money', () => {
    expect(sql).toMatch(/^-- @live-proof: .*fn_daily_window_seat_first_kind/m);
    expect(sql).not.toMatch(/INSERT INTO public\.(chip_ledger|wallets)/i);
  });
});
