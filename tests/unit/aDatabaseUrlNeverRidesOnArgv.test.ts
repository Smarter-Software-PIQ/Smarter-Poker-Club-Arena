/**
 * A connection URL with a password must never be a process argument: every
 * process listing on the machine (`pgrep -fl`, `ps aux`) prints arguments.
 * .agent/audits/2026-11-10-SECURITY-INCIDENT-process-listing-credential-exposure.md
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const HELPER = 'scripts/lib/pg-env-from-url.sh';
const run = (env: Record<string, string>, body: string) =>
  execFileSync('bash', ['-c', `source ${HELPER}\n${body}`], {
    env: { PATH: process.env.PATH ?? '', ...env },
    encoding: 'utf8',
  });

describe('pg_env_from_url', () => {
  it('moves every URL part into libpq variables and prints nothing itself', () => {
    const out = run(
      { FAKE_URL: 'postgresql://reader%40x:p%40ss%20w@db.example.test:6543/app?sslmode=require' },
      'pg_env_from_url FAKE_URL >/tmp/pg-env-from-url-stdout.$$; printf "%s|" "$(cat /tmp/pg-env-from-url-stdout.$$)" "$PGHOST" "$PGPORT" "$PGUSER" "$PGPASSWORD" "$PGDATABASE" "$PGSSLMODE"; rm -f /tmp/pg-env-from-url-stdout.$$'
    );
    expect(out).toBe('|db.example.test|6543|reader@x|p@ss w|app|require|');
  });

  it('refuses an unset variable and a non-postgres URL', () => {
    expect(() => run({}, 'pg_env_from_url MISSING_URL')).toThrow();
    expect(() => run({ FAKE_URL: 'https://example.test/x' }, 'pg_env_from_url FAKE_URL')).toThrow();
  });

  it('never hands the URL to a child as an argument', () => {
    const src = readFileSync(HELPER, 'utf8');
    expect(src).toMatch(/python3 -I - <<'PY'/);
    expect(src).toMatch(/os\.environ\[os\.environ\["PG_ENV_FROM_URL_NAME"\]\]/);
    expect(src).not.toMatch(/python3[^\n]*\$\{!name/);
  });
});

describe('scripts that connect with DATABASE_URL', () => {
  for (const path of [
    'scripts/dev/export-applied-migrations.sh',
    'scripts/verification-harness/run-all.sh',
  ]) {
    it(`${path} passes no URL to psql`, () => {
      const lines = readFileSync(path, 'utf8')
        .split('\n')
        .filter((l) => /\bpsql\b/.test(l) && !l.trim().startsWith('#'));
      expect(lines.length).toBeGreaterThan(0);
      for (const l of lines) expect(l).not.toMatch(/psql[^|]*\$\{?DATABASE_URL/);
      expect(readFileSync(path, 'utf8')).toMatch(/pg_env_from_url DATABASE_URL/);
    });
  }
});
