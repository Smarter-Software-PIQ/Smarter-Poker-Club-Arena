import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const migration = readFileSync(
  'supabase/migrations/20261106040409_cash_queue_explains_admission_eligibility.sql',
  'utf8'
);
const body = migration.split('AS $function$')[1].split('$function$;')[0];
describe('cash queue eligibility qualification remains connected', () => {
  it('runs the native SQL fixture in the existing required accounting lane', () => {
    expect(readFileSync('.github/workflows/ci.yml', 'utf8')).toContain(
      'run: python3 -B scripts/ci/test-cash-queue-feedback-postgres.py'
    );
    expect(readFileSync('scripts/ci/test-cash-queue-feedback-postgres.py', 'utf8')).toContain(
      '20261106040409_cash_queue_explains_admission_eligibility.sql'
    );
  });
  it('reads the authenticated viewer and existing financial authority without repairing queues', () => {
    expect(body).toContain('auth.uid()');
    expect(body).toContain('public.fn_ca_cash_wallet_covers');
    expect(body).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
    expect(migration).toContain("SET search_path TO 'public', 'pg_temp'");
  });
});
