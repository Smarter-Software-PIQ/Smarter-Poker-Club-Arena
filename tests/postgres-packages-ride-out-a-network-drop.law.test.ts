/**
 * POSTGRES PACKAGES RIDE OUT A NETWORK DROP (2026-11-07).
 *
 * The PGDG signing key now comes from the checkout (#9950); the packages
 * still come from apt.postgresql.org. On 2026-11-07 accounting shard 5 of
 * #9933 failed before any test ran: every postgresql-17 package fetch failed
 * in the same second with "connect (101: Network is unreachable)" and apt
 * gave up. Each workflow's PostgreSQL apt option array now asks apt to retry
 * a failed fetch eight times with its exponential back-off capped at sixty
 * seconds, so a drop of a few minutes is ridden out inside the job instead of
 * failing it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const DIR = join(__dirname, '..', '.github', 'workflows');
const files = readdirSync(DIR).filter((f) => f.endsWith('.yml'));
const arrays = files.flatMap((f) =>
  [...readFileSync(join(DIR, f), 'utf8').matchAll(/(pg_apt|pg_ci_apt)=\(([^)]*)\)/g)].map(
    (m) => [f, m[2]] as const
  )
);

describe('postgres packages ride out a network drop', () => {
  it('finds every PostgreSQL apt option array', () => {
    expect(arrays.length).toBeGreaterThanOrEqual(66);
  });
  it.each(arrays.map(([f, a], i) => [`${f}#${i}`, a]))(
    '%s retries a failed fetch with capped back-off',
    (_name, a) => {
      expect(a).toContain('-o "Dir::Etc::sourcelist=/dev/null"');
      expect(a).toContain('-o "Acquire::Retries=8"');
      expect(a).toContain('-o "Acquire::Retries::Delay::Maximum=60"');
    }
  );
  it('every workflow that adds the PGDG repository uses such an array for apt', () => {
    for (const f of files) {
      const s = readFileSync(join(DIR, f), 'utf8');
      if (!s.includes('https://apt.postgresql.org/pub/repos/apt')) continue;
      const pgdgInstalls = s
        .split('\n')
        .filter((l) => /apt-get\b.*\binstall\b.*postgresql-1[67]/.test(l));
      for (const line of pgdgInstalls)
        expect(line, `${f}: ${line.trim()}`).toMatch(/"\$\{(pg_apt|pg_ci_apt)\[@\]\}"/);
    }
  });
});
