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
