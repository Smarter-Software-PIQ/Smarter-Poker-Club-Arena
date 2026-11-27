import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * THE DRAIN HAS A LIVE CHECK (2026-11-26). The first live read of the variety
 * drain after a seal found its churn in ten minutes, by hand. The same read is
 * scripts/sql/variety-drain-live-check.sql so every seal gets it from any
 * session. It must stay one read-only statement and keep the checks the
 * regression method names (docs/HORSE-DECISIONS-REGRESSION-METHOD.md, R11).
 */
const ROOT = resolve(__dirname, '..', '..');
const sql = readFileSync(resolve(ROOT, 'scripts/sql/variety-drain-live-check.sql'), 'utf8');
const body = sql
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');
const method = readFileSync(resolve(ROOT, 'docs/HORSE-DECISIONS-REGRESSION-METHOD.md'), 'utf8');

describe('the variety drain live check', () => {
  it('is one read-only statement', () => {
    expect(body).toMatch(/^\s*WITH\s/i);
    expect(body).not.toMatch(
      /\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|ALTER|CREATE|DROP|GRANT|REVOKE|COPY|CALL|DO)\b/i
    );
    const code = body.replace(/'[^']*'/g, "''");
    expect(code.trim().replace(/;\s*$/, '')).not.toContain(';');
  });

  it('never reads a dealt card', () => {
    expect(body).not.toMatch(/hole|hand_cards|dealt_cards|chips_in_cards/i);
  });

  it('keeps every check, each with a verdict', () => {
    for (const check of [
      'heartbeats',
      'released_tables',
      'no_person_released',
      'no_rejoin_while_named',
      'named_tables_closed',
      'fresh_releases_in_window',
      'tables_within_cap',
      'horse_error_log',
    ]) {
      expect(body).toContain(`'${check}'`);
    }
    expect(body).toContain('variety_drain_tables');
    expect(body).toContain('variety_drain_table');
  });

  it('review 2026-11-26: judges every naming, not one first-to-last block, and fails closed with no release', () => {
    /* a Horse re-joining after the LAST naming (the walk refilling an un-named table) is counted */
    expect(body).toMatch(
      /n\.beat_at < s\.joined_at AND n\.beat_at >= s\.joined_at - interval '10 minutes'/
    );
    /* only Horses count as re-joins; a person sitting down is the person rule, not churn */
    expect(body).toMatch(/is_horse, false\) = true/);
    expect(body).toMatch(/is_horse, false\) = false/);
    /* a person who sat down inside the last fleet cycle is not yet the fleet's to see */
    expect(body).toContain("interval '35 seconds'");
    /* no shipped release, or no heartbeat since it, is a FAIL, never a PASS on zero rows */
    expect(body).toContain(
      "CASE WHEN (SELECT count(*) FROM rel) = 1 AND count(*) > 0 THEN 'PASS' ELSE 'FAIL' END"
    );
    expect(body).toContain(
      "CASE WHEN (SELECT count(*) FROM rel) = 1 AND count(*) = 0 THEN 'PASS' ELSE 'FAIL' END"
    );
    expect(body).not.toMatch(/first_named AND|BETWEEN n\.first_named/);
  });

  it('is the R11 read the regression method names', () => {
    expect(method).toContain('scripts/sql/variety-drain-live-check.sql');
  });
});
