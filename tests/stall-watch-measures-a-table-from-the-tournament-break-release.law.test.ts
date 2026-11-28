/**
 * A STOPPED TOURNAMENT TABLE IS MEASURED FROM THE END OF ITS HOURLY BREAK
 * (2026-11-23, Production Alerts fleet, incident stall-after-tournament-break).
 *
 * All 65 TableStoppedDealing alerts raised by ca-stall-watch from 2026-11-20
 * to 2026-11-23 (operational_alert_events 446358 .. 447723) were raised at
 * :00-:01, the first watch tick after the engine released the synchronized
 * :55 tournament break. The release writes on_break = false and
 * break_ends_at = NULL, and fn_ca_table_stall_decide excused a tournament
 * table only while on_break was true, so every table was called stopped
 * before it had had one second in which it was supposed to deal.
 *
 * Migration 20261123025029 excuses such a table only while now is under
 * break_started_at + 8 min (LAST_HAND_GRACE_MS 2 min + BREAK_DURATION_MS
 * 5 min + the 60 s every table gets) and only when its last progress falls in
 * [break_started_at - 60 s, break_started_at + 2 min). A table silent past
 * that, or already silent before the break, is raised exactly as before.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT_DIR = join(__dirname, '..');
const DIR = join(ROOT_DIR, 'supabase', 'migrations');
const FIX = '20261123025029_stall_watch_gives_a_table_its_resume_minute_after_the_tourna.sql';
const files = readdirSync(DIR)
  .filter((f) => /^\d{14}_.+\.sql$/.test(f))
  .sort();

describe('stall watch measures a tournament table from the break release', () => {
  it('the fix migration exists', () => {
    expect(files).toContain(FIX);
  });

  const fix = files.includes(FIX) ? readFileSync(join(DIR, FIX), 'utf8') : '';

  it('patches the measured live definition and nothing else', () => {
    expect(fix).toContain("IS DISTINCT FROM '077f272a204d8392dc292a49d1eec168'");
    expect(fix).toContain("RETURN 'tournament_break'; END IF;$a$");
    expect(fix).toContain('EXECUTE replace(definition, anchor, anchor || addition);');
    expect(fix).not.toMatch(/\b(UPDATE|INSERT|DELETE)\s+(INTO\s+)?public\./i);
  });

  it('the excuse is bounded by the engine worst-case break end plus 60 seconds', () => {
    expect(fix).toContain(
      "p_now < (p_facts->>'break_started_at')::timestamptz + interval '8 minutes'"
    );
    expect(fix).toContain(
      ">= (p_facts->>'break_started_at')::timestamptz - interval '60 seconds'"
    );
    expect(fix).toContain("< (p_facts->>'break_started_at')::timestamptz + interval '2 minutes'");
    expect(fix).toContain("RETURN 'resuming_after_tournament_break';");
  });

  it('the bound is derived from the engine constants it names', () => {
    const tm = readFileSync(
      join(ROOT_DIR, 'server', 'src', 'tournament', 'TournamentManagerBase.ts'),
      'utf8'
    );
    expect(tm).toContain('static readonly LAST_HAND_GRACE_MS = 2 * 60 * 1000;');
    expect(tm).toContain('static readonly BREAK_DURATION_MS = 5 * 60 * 1000;');
  });

  it('the migration proves the measured case, the bound and the pre-break stall', () => {
    expect(fix).toContain("fn_ca_table_stall_decide(f, 306736, '2026-11-23 02:00:41Z', false, false)");
    expect(fix).toContain(
      "fn_ca_table_stall_decide(f, 451000, bs + interval '8 minutes 1 second', false, false) IS NOT NULL"
    );
    expect(fix).toContain(
      "fn_ca_table_stall_decide(f, 450000, bs + interval '6 minutes', false, false) IS NOT NULL"
    );
    expect(fix).toContain('resuming_after_maintenance');
  });

  it('no later migration redefines the decision without the tournament-break bound', () => {
    for (const f of files.slice(files.indexOf(FIX) + 1)) {
      const sql = readFileSync(join(DIR, f), 'utf8');
      if (/FUNCTION public\.fn_ca_table_stall_decide\(/.test(sql)) {
        expect(sql, `${f} redefines the stall decision`).toContain(
          'resuming_after_tournament_break'
        );
      }
    }
  });
});
