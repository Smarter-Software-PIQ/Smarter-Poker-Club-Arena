import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// Repeated website-host TLS EOFs prevented these required native checks from
// starting. Use the same PGDG authority for its key and signed package index.
describe('required PostgreSQL installers retain signed repository authority', () => {
  it.each([
    ['.github/workflows/ci.yml', 'accounting_postgres'],
    ['.github/workflows/production-e2e-synthetic-hand-guard.yml', 'daily-missions-hand-trigger'],
  ])('%s fetches its signing key from the package repository', (file, jobId) => {
    const job = parse(readFileSync(file, 'utf8')).jobs[jobId];
    const setup = job.steps.find((step: { run?: string }) =>
      step.run?.includes('/pgdg/apt.postgresql.org.asc')
    );
    expect(setup).toBeDefined();
    expect(setup.run).toContain('https://apt.postgresql.org/pub/repos/apt/ACCC4CF8.asc');
    expect(setup.run).not.toContain('https://www.postgresql.org/');
    expect(setup.run).toContain('sudo curl --fail --silent --show-error --location');
    expect(setup.run).toContain('URIs: https://apt.postgresql.org/pub/repos/apt');
    expect(setup.run).toContain(
      'Signed-By: /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc'
    );
    expect(setup.run).toContain('install -y --no-install-recommends postgresql-17');
    expect(setup.run).toContain('set -euo pipefail');
    expect(setup.run).not.toMatch(/--insecure|--allow-unauthenticated|trusted=yes/);
    expect(setup['continue-on-error']).not.toBe(true);
  });
});
