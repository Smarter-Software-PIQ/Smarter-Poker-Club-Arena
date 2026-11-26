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

  it('is the R11 read the regression method names', () => {
    expect(method).toContain('scripts/sql/variety-drain-live-check.sql');
  });
});
