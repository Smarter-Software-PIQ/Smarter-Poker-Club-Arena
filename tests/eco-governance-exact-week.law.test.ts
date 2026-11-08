import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('checks ECO evidence against both canonical closed-week boundaries', () => {
  const sql = readFileSync(
    resolve(
      __dirname,
      '../supabase/migrations/20261108172301_eco_governance_reads_the_exact_closed_accounting_week.sql'
    ),
    'utf8'
  );
  const predicate = sql.split('$new$')[1];
  expect(predicate).toContain('l.period_start = fn_union_prev_week_start()');
  expect(predicate).toContain('l.period_end = fn_union_week_start()');
});

it('looks up one immutable receipt per blocked work item before reading details', () => {
  const sql = readFileSync(
    resolve(
      __dirname,
      '../supabase/migrations/20261108172301_eco_governance_reads_the_exact_closed_accounting_week.sql'
    ),
    'utf8'
  );
  const source = sql.split(
    'CREATE OR REPLACE FUNCTION public.fn_cash_source_refusals_for_period'
  )[1];
  expect(source).toContain("WHERE status='blocked'");
  expect(source).toContain('CROSS JOIN LATERAL');
  expect(source).toContain('WHERE r.id=w.receipt_id');
  expect(source).toContain("ARRAY['unknown','union:'||p_union_id::text,'club:'||p_club_id::text]");
  expect(source).toContain('r.earned_at>=p_from AND r.earned_at<p_to');
  expect(source).toContain("ARRAY['-infinity','infinity']::timestamptz[]");
  expect(source).toContain('OFFSET 0');
  expect(source).not.toContain('UNION ALL');
});
