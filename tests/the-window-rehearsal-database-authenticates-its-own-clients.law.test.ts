/**
 * LAW - THE WINDOW REHEARSAL DATABASE AUTHENTICATES ITS OWN CLIENTS
 *
 * window-migrations-install-before-merge.yml (added 2026-11-18, #11268)
 * restores production's schema into a throwaway supabase/postgres container
 * and installs the pull request's migrations into it. That image asks
 * supabase_admin (and postgres) for a password even on its local socket, and
 * every client call in the rehearsal is a `docker exec ... psql`. The container
 * was started with POSTGRES_PASSWORD only, so every call stopped at
 * "Password for user supabase_admin:" and failed with fe_sendauth: no password
 * supplied. Every migration-bearing pull request failed the rehearsal (16
 * branches on 2026-11-18) before one migration was read.
 *
 * `docker exec` inherits the container's environment, so the container carries
 * PGPASSWORD equal to POSTGRES_PASSWORD, and every exec'd client authenticates.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const SCRIPT = readFileSync(resolve(ROOT, 'scripts/ci/restore-schema-for-rehearsal.sh'), 'utf8');
const WORKFLOW = readFileSync(resolve(ROOT, '.github/workflows/window-migrations-install-before-merge.yml'), 'utf8');

describe('the window rehearsal database authenticates its own clients', () => {
  it('starts the container with PGPASSWORD equal to POSTGRES_PASSWORD', () => {
    const run = SCRIPT.split('\n').find((l) => /^\s*docker run\b/.test(l));
    expect(run, 'the restore script must start its container with docker run').toBeTruthy();
    const pg = /-e POSTGRES_PASSWORD=("?)(\$\{?\w+\}?|[\w-]+)\1/.exec(run!);
    const cl = /-e PGPASSWORD=("?)(\$\{?\w+\}?|[\w-]+)\1/.exec(run!);
    expect(pg, 'docker run sets POSTGRES_PASSWORD').not.toBeNull();
    expect(cl, 'docker run sets PGPASSWORD so every docker exec client authenticates').not.toBeNull();
    expect(cl![2]).toBe(pg![2]);
  });

  it('every database client in the rehearsal reaches the server through docker exec on that container', () => {
    expect(SCRIPT).toMatch(/docker exec "\$NAME" pg_restore -U supabase_admin/);
    expect(WORKFLOW).toContain('REHEARSAL_PSQL: docker exec -i window-rehearsal-db psql');
    expect(WORKFLOW).toContain('scripts/ci/restore-schema-for-rehearsal.sh "$RUNNER_TEMP/in/schema.dump" window-rehearsal-db');
  });
});
