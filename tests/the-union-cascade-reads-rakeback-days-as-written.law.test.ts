/**
 * THE UNION CASCADE READS RAKEBACK DAYS THE WAY THEY ARE WRITTEN (2026-11-07).
 *
 * rakeback_periods.period_start/period_end are Los Angeles calendar days.
 * After 20261107194020 fixed the weekly close's own reading, Midway's
 * 2026-10-19 book stopped on the same union_rakeback_wrong_club refusal raised
 * by fn_union_settlement_cascade, which read those dates as UTC midnights.
 *
 * Pinned here:
 *   1. the cascade's four readings move to 'America/Los_Angeles', anchored and
 *      count-asserted against an md5-pinned preimage;
 *   2. no later migration puts a UTC reading of a rakeback period date back.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const MIGRATIONS = join(__dirname, '..', 'supabase', 'migrations');
const FILE = '20261107204839_the_union_cascade_reads_rakeback_days_as_written.sql';
const sql = readFileSync(join(MIGRATIONS, FILE), 'utf8');
const code = sql.replace(/^--[^\n]*/gm, '');

describe('the union cascade reads rakeback days as written', () => {
  it('replaces every UTC reading of a rakeback period date with Los Angeles days', () => {
    const anchors = [...code.matchAll(/a\d constant text := \$a\$(.*?)\$a\$;/g)].map((m) => m[1]);
    const repl = [...code.matchAll(/r\d constant text := \$a\$(.*?)\$a\$;/g)].map((m) => m[1]);
    expect(anchors).toHaveLength(4);
    expect(repl).toHaveLength(4);
    anchors.forEach((a, i) => {
      expect(a).toMatch(/AT TIME ZONE 'UTC'/);
      expect(a).toMatch(/rp\.period_(start|end)/);
      expect(repl[i]).toBe(a.replace("AT TIME ZONE 'UTC'", "AT TIME ZONE 'America/Los_Angeles'"));
    });
  });

  it('targets the cascade, pins pre and post images and keeps metadata', () => {
    expect(code).toContain("'public.fn_union_settlement_cascade(uuid,timestamptz,timestamptz)'");
    expect(code).toContain("'9dadc71929579ecb5d525f975cce9b49'");
    expect(code).toContain("'a68664588b6e7f83806f10b122a2bccc'");
    expect(code).toMatch(/replace\(replace\(replace\(replace\(d,a1,r1\),a2,r2\),a3,r3\),a4,r4\)/);
    expect(code).toMatch(/IF m2 IS DISTINCT FROM m/);
    expect(sql).toMatch(
      /@live-proof: md5\(pg_get_functiondef\('public\.fn_union_settlement_cascade/
    );
  });

  it('no later migration reads a rakeback period date as a UTC midnight', () => {
    const newer = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql') && f > FILE);
    for (const f of newer) {
      const text = readFileSync(join(MIGRATIONS, f), 'utf8').replace(/^--[^\n]*/gm, '');
      expect(text, `${f} must keep rakeback period dates on Los Angeles days`).not.toMatch(
        /rp\.period_(start|end)\s*(\+\s*1)?\)?::timestamp AT TIME ZONE 'UTC'/
      );
    }
  });
});
