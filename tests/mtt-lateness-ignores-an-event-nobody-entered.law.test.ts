/**
 * MTT LAUNCH LATENESS IGNORES AN EVENT NOBODY ENTERED (2026-11-28, Production
 * Alerts rows 450128 / 450194, incident mtt-started-late-cutover-hour).
 *
 * Every 19:05Z MttStartedLate since 11-24 read "2 MTT(s)" and resolved to "1"
 * at about 19:31Z. The second event was the daily empty "Daily 25 Chip
 * Freezeout" of a one-member, horseless pilot club. late_waiting counted it
 * from start + 240 s until tournament/emptyPastStartEvent.ts cancelled it at
 * start + 30 m. fn_tournament_metrics (TournamentNeverStarted) already exempts
 * that shape. 20261128200707 counts a waiting event only when it has a
 * registered or playing entrant; an event with one entrant still alerts.
 *
 * The first cause in the same incident (the cutover freeze is stamped 1 ms
 * after the start minute) is fixed by 20261128161915 (#12377), and its law
 * (mtt-launch-lateness-measures-from-bounded-maintenance-thaw) keeps it.
 * 20261128200707 is versioned after 161915, pins 161915's installed body as
 * its preimage, and keeps that predicate byte for byte, so the older draft
 * version (160858) can never install after #12377 and replace it.
 *
 * This law reads the NEWEST definition of fn_tournament_launch_lateness_metrics
 * on main, so a later migration that drops the entrant test fails here.
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
const SELF = '20261128200707_mtt_launch_lateness_ignores_an_event_nobody_entered.sql';
const self = readFileSync(join(DIR, SELF), 'utf8');

describe('MTT launch lateness ignores an event nobody entered', () => {
  it('has a newest definition on main', () => {
    expect(newest).toBeTruthy();
  });

  it('follows the 5 s jitter fix and pins its installed body as the preimage', () => {
    expect(SELF > '20261128161915').toBe(true);
    expect(files).not.toContain(
      '20261128160858_mtt_launch_lateness_freeze_starting_at_the_start_minute.sql'
    );
    expect(self).toContain("md5(v_def) IS DISTINCT FROM '19533b7bf3421c6bbbf2e4b1560564f6'");
    expect(self).toMatch(/^-- @live-proof: .*AND c\.has_entrant/m);
    expect(self).toMatch(/^\s*BEGIN\s*;/m);
    expect(self.trim()).toMatch(/COMMIT\s*;$/);
  });

  it('counts a waiting event only when it has a registered or playing entrant', () => {
    expect(fn).toContain("tp.status IN ('registered','playing'))) AS has_entrant");
    expect(fn).toContain('COALESCE(t.current_players, 0) <> 0');
    expect(fn).toMatch(/c\.first_created IS NULL\s+AND c\.has_entrant\s+AND c\.status IN/);
  });

  it('keeps the 5 s freeze-start credit, the 12 minute cap, the late bar and the post-thaw stall alarm', () => {
    expect(fn).toContain("AND l.break_started_at <= t.start_time + interval '5 seconds'");
    expect(fn).toContain("AND th.freeze_started_at <= t.start_time + interval '5 seconds'");
    expect(fn).toContain("l.break_ended_at <= l.break_started_at + interval '12 minutes'");
    expect(fn).toContain("th.release_target_at <= th.freeze_started_at + interval '12 minutes'");
    expect(fn).toContain('AND l.break_ended_at > t.start_time');
    expect(fn).toContain('AND th.release_target_at > t.start_time');
    expect(fn).toContain('c.first_started > c.effective_start_time + b.late AS late_dealt');
    expect(fn).toContain('c.effective_start_time < b.now_at - b.late - b.headroom AS late_waiting');
  });
});
