import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    __dirname,
    '../supabase/migrations/20261108185440_bound_weekly_cash_assertion_and_name_timeout_frame.sql'
  ),
  'utf8'
);

it('checks each in-week original rake record for its optional batch receipt', () => {
  const join = migration.split('$new_join$')[1];
  expect(join).toContain('LEFT JOIN LATERAL');
  expect(join).toContain('WHERE a.rake_record_id=r.id');
  expect(join).toContain('OFFSET 0');
  expect(join).toContain('b ON true');
  expect(join).not.toContain("a.status='accrued'");
});

it('preserves operator cancellation and records only the timeout function and line', () => {
  const handler = migration.split('$new_handler$')[1];
  expect(handler).toContain(
    "IF v_msg IS DISTINCT FROM 'canceling statement due to statement timeout' THEN RAISE; END IF"
  );
  expect(handler).toContain('v_context=PG_EXCEPTION_CONTEXT');
  expect(handler).toContain("'timeout_function',v_timeout_frame[1]");
  expect(handler).toContain("'timeout_line',v_timeout_frame[2]");
  expect(handler.split('v_scope_error:=')[1]).not.toContain('v_context');
});
