import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// Transaction behavior is proved by the real PostgreSQL migration and the
// current credit-owner block. This contract keeps that proof wired to CI.
const workflow = readFileSync('.github/workflows/promo-play-through.yml', 'utf8');
const native = readFileSync('scripts/ci/test-signup-promo-identity.py', 'utf8');

describe('signup promo identity is enforced by its credit transaction', () => {
  it('runs the native proof when the migration, fixture or test changes', () => {
    expect(workflow).toContain('supabase/migrations/*_signup_promo_*.sql');
    expect(workflow).toContain('tests/fixtures/signup-promo-identity/**');
    expect(workflow).toContain('scripts/ci/test-signup-promo-identity.py');
    expect(workflow).toContain(
      'run: python3 scripts/ci/test-signup-promo-identity.py --output artifacts/signup-promo-identity'
    );
    expect(workflow).toContain('artifacts/signup-promo-identity/RESULTS.json');
  });
  it('exercises the applied owner block instead of a separate hand-written caller', () => {
    expect(native).toContain('query(MIGRATION.read_text())');
    expect(native).toContain(
      "pg_get_functiondef('fn_sp_signup_welcome_back_run(integer,date)'::regprocedure)"
    );
    expect(native).toContain('block=definition[start:end]');
    expect(native).toContain('concurrent accounts cannot both reserve the same phone');
    expect(native).toContain('a refused payment releases all of its identity reservations');
  });
});
