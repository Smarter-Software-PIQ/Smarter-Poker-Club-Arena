/**
 * THE WEEKLY CLOSE READS RAKEBACK DAYS THE WAY THEY ARE WRITTEN (2026-11-07).
 *
 * rakeback_periods.period_start/period_end are Los Angeles calendar days: the
 * calculator builds every period from `p_period_start::timestamp AT TIME ZONE
 * 'America/Los_Angeles'`. Midway's 2026-10-19 book refused 190 times with
 * union_rakeback_wrong_club because the close's orphan guard read those same
 * dates as UTC midnights and counted the next week's six periods against it.
 *
 * Pinned here, from the newest migration that installs the close's text:
 *   1. every rakeback_periods date the close turns into a timestamp is read
 *      AT TIME ZONE 'America/Los_Angeles', never 'UTC';
 *   2. the weekly payout plan's pin on the close moves with it in the same
 *      transaction, so the payout engine never refuses on a stale hash.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const MIGRATIONS = join(__dirname, '..', 'supabase', 'migrations');
const FILE = '20261107194020_the_weekly_close_reads_rakeback_days_as_written.sql';
const sql = readFileSync(join(MIGRATIONS, FILE), 'utf8');
const code = sql.replace(/--[^\n]*/g, '');

describe('the weekly close reads rakeback days as written', () => {
  it('replaces every UTC reading of a rakeback period date with Los Angeles days', () => {
    const anchors = [...code.matchAll(/a\d constant text := \$a\$(.*?)\$a\$;/g)].map((m) => m[1]);
    const repl = [...code.matchAll(/r\d constant text := \$a\$(.*?)\$a\$;/g)].map((m) => m[1]);
    expect(anchors).toHaveLength(4);
    expect(repl).toHaveLength(4);
    anchors.forEach((a, i) => {
      expect(a).toMatch(/AT TIME ZONE 'UTC'/);
      expect(a).toMatch(/rp\.period_(start|end)|v_from/);
      expect(repl[i]).toBe(a.replace("AT TIME ZONE 'UTC'", "AT TIME ZONE 'America/Los_Angeles'"));
    });
  });

  it('applies all four replacements and pins both postimages', () => {
    expect(code).toMatch(/replace\(replace\(replace\(replace\(d,a1,r1\),a2,r2\),a3,r3\),a4,r4\)/);
    expect(code).toContain("'12bfc8d8f09be5fa21b951efe3a77d62'");
    expect(code).toContain("'9c5e482c4d435f9c33bcc77a5e46edac'");
  });

  it('moves the payout plan pin in the same transaction, from the old hash only', () => {
    expect(code).toContain("c_scope_pre  constant text := '023efba44914bad5d05e2538e951e59f'");
    expect(code).toMatch(/q := replace\(e, c_scope_pre, s_post\);/);
    expect(code).toMatch(/\(length\(e\)-length\(replace\(e,c_scope_pre,''\)\)\)\/32<>1/);
    expect(sql.indexOf('BEGIN;')).toBeLessThan(sql.indexOf('EXECUTE q;'));
    expect(sql.lastIndexOf('COMMIT;')).toBeGreaterThan(sql.indexOf('EXECUTE q;'));
  });

  it('is the newest migration to install the close text', () => {
    const newer = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith('.sql') && f > FILE)
      .filter((f) => /fn_process_weekly_accounting_scope\(uuid,uuid\)/.test(readFileSync(join(MIGRATIONS, f), 'utf8').replace(/--[^\n]*/g, '')) && /EXECUTE/.test(readFileSync(join(MIGRATIONS, f), 'utf8')));
    for (const f of newer) {
      const text = readFileSync(join(MIGRATIONS, f), 'utf8').replace(/--[^\n]*/g, '');
      expect(text, `${f} must keep rakeback period dates on Los Angeles days`).not.toMatch(/rp\.period_(start|end)(\+1)?\)?::timestamp AT TIME ZONE 'UTC'/);
    }
  });
});
