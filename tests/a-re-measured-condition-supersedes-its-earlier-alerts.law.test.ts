import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * A RE-MEASURED CONDITION SUPERSEDES ITS EARLIER ALERTS (2026-11-24).
 * The daily chip-integrity attestation and the Daily Digest attention rules
 * re-evaluate on a schedule but never resolved what they raised before, so
 * incidents 6ed756e0, 9b667bc4 and 6aeff72f could never clear. This law fails
 * the build if the newest definition of either producer drops its supersede step.
 */
const DIR = join(__dirname, '..', 'supabase', 'migrations');

function newest(fn: string): string {
  const files = readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const hits = files.filter((f) => {
    const sql = readFileSync(join(DIR, f), 'utf8');
    return (
      sql.includes(fn) &&
      (/CREATE\s+OR\s+REPLACE\s+FUNCTION/i.test(sql) || sql.includes('pg_get_functiondef'))
    );
  });
  return readFileSync(join(DIR, hits[hits.length - 1]), 'utf8');
}

describe('a re-measured condition supersedes its earlier alerts', () => {
  it('a newer chip-integrity attestation supersedes the older ones', () => {
    const sql = newest('fn_try_record_owner_notification');
    expect(sql).toContain('A NEWER CHIP-INTEGRITY ATTESTATION SUPERSEDES');
    expect(sql).toMatch(/e\.id < v_id/);
  });
  it('a newer digest evaluation supersedes an earlier day, except stuck_tournament', () => {
    const sql = newest('fn_sp_dispatch_attention');
    expect(sql).toContain('A NEWER DIGEST EVALUATION SUPERSEDES');
    expect(sql).toContain('DailyDigest.stuck_tournament');
  });
});
