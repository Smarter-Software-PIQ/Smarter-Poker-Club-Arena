import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// Repeated website-host TLS EOFs prevented these required native checks from
// starting (2026-11-02), and the package-host fetch kept failing the same way
// (curl 55 in at least 11 jobs on 2026-11-07). The key is a static public file,
// so it is installed from the checkout (.github/pgdg, pinned byte-for-byte by
// tests/the-postgres-signing-key-comes-from-the-checkout.law.test.ts); the
// signed PGDG package index and Signed-By verification are unchanged.
describe('required PostgreSQL installers retain signed repository authority', () => {
  // Since 2026-11-07 both run the one shared installer; its bytes carry the
  // signed-source authority (tests/postgres-installs-from-one-shared-action.law.test.ts).
  const shared = readFileSync('.github/actions/install-postgres-17/install.sh', 'utf8');

  it.each([
    ['.github/workflows/ci.yml', 'accounting_postgres'],
    ['.github/workflows/production-e2e-synthetic-hand-guard.yml', 'daily-missions-hand-trigger'],
  ])('%s installs through the shared signed installer', (file, jobId) => {
    const job = parse(readFileSync(file, 'utf8')).jobs[jobId];
    const setup = job.steps.find(
      (step: { run?: string; uses?: string }) =>
        step.uses === './.github/actions/install-postgres-17' ||
        step.run?.includes('bash .github/actions/install-postgres-17/install.sh')
    );
    expect(setup).toBeDefined();
    expect(setup['continue-on-error']).not.toBe(true);
    expect(String(setup.run ?? '')).not.toMatch(/--insecure|--allow-unauthenticated|trusted=yes/);
  });

  it('the shared installer keeps the signed PGDG source and the checkout key', () => {
    expect(shared).toContain('sudo install -m 0644 "$PG_KEY_SRC" "$PG_KEY_DST"');
    expect(shared).toContain('PG_KEY_DST=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc');
    expect(shared).not.toContain('ACCC4CF8.asc');
    expect(shared).not.toContain('https://www.postgresql.org/');
    expect(shared).toContain('URIs: https://apt.postgresql.org/pub/repos/apt');
    expect(shared).toContain('Signed-By: %s');
    expect(shared).toContain('"$codename" "$PG_KEY_DST" > "$pg_sources/pgdg.sources"');
    expect(shared).toContain('install -y --no-install-recommends "${pg_packages[@]}"');
    expect(shared).toContain('set -euo pipefail');
    expect(shared).not.toMatch(/--insecure|--allow-unauthenticated|trusted=yes/);
  });
});
