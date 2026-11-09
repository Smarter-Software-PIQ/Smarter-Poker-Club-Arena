import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    __dirname,
    '../supabase/migrations/20261108214628_cover_weekly_club_statement_cash_source_basis.sql'
  ),
  'utf8'
);

it('covers the original club, coordinator and earning window with a concurrent index', () => {
  const [preamble, transaction] = migration.split('BEGIN;');
  expect(preamble).toMatch(
    /CREATE INDEX CONCURRENTLY IF NOT EXISTS accounting_cash_weekly_statement_basis_cover\s+ON public\.accounting_cash_rake_sources \(club_id, coordinator_union_id, earned_at\)\s+INCLUDE \(id, rake_record_id, union_id, rake_credit\);/
  );
  expect(transaction).toContain('i.indisvalid AND i.indisready AND i.indislive');
  expect(transaction).toContain('WEEKLY_STATEMENT_BASIS_COVER_EXACT_INDEX_REQUIRED');
  expect(transaction).not.toMatch(/CREATE OR REPLACE (FUNCTION|VIEW)/);
});
