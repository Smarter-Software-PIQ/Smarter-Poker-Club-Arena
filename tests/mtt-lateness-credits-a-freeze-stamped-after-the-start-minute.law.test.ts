/**
 * A MAINTENANCE FREEZE STAMPED JUST AFTER THE START MINUTE STILL COVERS THE START
 * (2026-11-28, Production Alerts row 450128).
 *
 * 20261128075041 credited a bounded maintenance thaw only when the freeze began
 * at or before tournaments.start_time. The engine stamps each cutover freeze a
 * millisecond after the boundary (16:00:00.001 for a 16:00:00 start), so the
 * credit never matched an on-the-hour start: "Mid-Morning Turbo (6-Max NLH)"
 * dealt 1 s after the 16:05 thaw and MttStartedLate fired with 301 s.
 * 20261128160858 credits a bounded freeze that began no later than the late bar
 * after start_time. This law reads the NEWEST definition of
 * fn_tournament_launch_lateness_metrics on main, so any later migration that
 * returns to the exact-start predicate fails here.
 *
 * The same migration stops late_waiting counting an event NOBODY entered
 * (row 450194): the daily empty "Daily 25 Chip Freezeout" of a horseless pilot
 * club is cancelled at start + 30 m by tournament/emptyPastStartEvent.ts, and
 * fn_tournament_metrics (TournamentNeverStarted) already exempts that shape;
 * an event with one registered or playing entrant still alerts.
 * Behavioural proof: docs/production-alerts/evidence/450128-mtt-late-freeze-boundary/native-proof.sh.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(__dirname, '..', 'supabase', 'migrations');
const DEF = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?:public\.)?fn_tournament_launch_lateness_metrics\b/i;
const files = readdirSync(DIR)
  .filter((f) => /^\d{14}_.+\.sql$/.test(f))
  .sort();
const newest = [...files].reverse().find((f) => DEF.test(readFileSync(join(DIR, f), 'utf8')));
const body = newest ? readFileSync(join(DIR, newest), 'utf8') : '';
const fn = body.slice(body.search(DEF));

describe('MTT launch lateness credits a cutover freeze stamped just after the start minute', () => {
  it('has a newest definition on main', () => {
    expect(newest).toBeTruthy();
  });

  it('credits a break-log freeze that began within the late bar after start_time', () => {
    expect(fn).toContain('AND l.break_started_at <= t.start_time + b.late');
    expect(fn).not.toMatch(/l\.break_started_at\s*<=\s*t\.start_time\s*\n/);
  });

  it('credits a v3 thaw whose freeze began within the late bar after start_time', () => {
    expect(fn).toContain('AND th.freeze_started_at <= t.start_time + b.late');
    expect(fn).not.toMatch(/th\.freeze_started_at\s*<=\s*t\.start_time\s*\n/);
  });

  it('counts a waiting event only when it has a registered or playing entrant', () => {
    expect(fn).toContain("tp.status IN ('registered','playing'))) AS has_entrant");
    expect(fn).toContain('COALESCE(t.current_players, 0) <> 0');
    expect(fn).toMatch(/c\.first_created IS NULL\s+AND c\.has_entrant\s+AND c\.status IN/);
  });

  it('keeps the 12 minute cap, the late bar and the post-thaw stall alarm', () => {
    expect(fn).toContain("l.break_ended_at <= l.break_started_at + interval '12 minutes'");
    expect(fn).toContain("th.release_target_at <= th.freeze_started_at + interval '12 minutes'");
    expect(fn).toContain('AND l.break_ended_at > t.start_time');
    expect(fn).toContain('AND th.release_target_at > t.start_time');
    expect(fn).toContain('c.first_started > c.effective_start_time + b.late AS late_dealt');
    expect(fn).toContain('c.effective_start_time < b.now_at - b.late - b.headroom AS late_waiting');
  });
});
