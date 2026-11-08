/**
 * LAW: A WINDOW INSTALL ENDS AN IDLE HOLDER ONLY INSIDE THE FREEZE (2026-11-08).
 *
 * A daily-maintenance window file gets ONE attempt with a 1 s lock_timeout.
 * A session left idle in transaction on the file's relation never finishes on
 * its own, so before this change it refused the file and cost it a full day.
 * Immediately before a file that declares "-- @locks:", the installer now
 * runs ONE statement that, only while the same statement confirms the daily
 * window with its start reserve, terminates exactly the sessions that:
 *   - hold or queue for a conflicting lock on a DECLARED relation;
 *   - are 'idle in transaction', idle and in their transaction for at least
 *     IDLE_HOLDER_MIN_IDLE_MS (never an active query);
 *   - are client backends of the postgres role family, never a superuser, a
 *     supabase_* role, pg_cron, PostgREST, or the installer and applier;
 * and records each in public.ca_window_install_terminations in that same
 * statement. Never for an undeclared file, never in an owner window, never a
 * retry: the one attempt and every budget are unchanged.
 * Native proof: case 13 of scripts/ci/test-maintenance-window-migrations.sh.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  IDLE_BLOCKERS_TERMINATE_QUERY,
  IDLE_HOLDER_MIN_IDLE_MS,
  TERMINATE_RESERVE_SECONDS,
  TERMINATE_WAIT_MS,
  START_RESERVE_SECONDS,
  TERMINATION_TABLE,
  OWN_APPLICATIONS,
  QUIET_HOLDER_AGE_MS,
  WINDOW_LOCK_TIMEOUT_MS,
  windowOpenPredicate,
  idleBlockerTargets,
  quietHoldersAreIdleOnDeclared,
} from '../scripts/ci/maintenance-window-migrations.mjs';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const installer = read('scripts/ci/install-window-migrations.mjs');
const q = IDLE_BLOCKERS_TERMINATE_QUERY;

describe('the statement terminates nothing outside the confirmed daily window', () => {
  it('gates every candidate on the same window predicate the install asserts, with more reserve', () => {
    expect(q).toContain(windowOpenPredicate(TERMINATE_RESERVE_SECONDS));
    expect(TERMINATE_RESERVE_SECONDS).toBeGreaterThan(START_RESERVE_SECONDS);
    expect(q).toMatch(/WHERE \(SELECT open FROM gate\)\n/);
    // One statement: the gate, the signal and the record cannot disagree.
    expect(q.match(/pg_terminate_backend\(/g)).toHaveLength(1);
    expect(q).toMatch(/ended AS \(\n  SELECT c\.\*, pg_terminate_backend\(c\.pid, \$4::bigint\) AS terminated FROM cand c\)/);
    expect(q).not.toMatch(/pg_cancel_backend|pg_sleep|LOCK TABLE|ALTER|DROP|CREATE/i);
  });
});

describe('it terminates only idle sessions of the postgres role family', () => {
  it('requires idle in transaction, idle and open for the minimum, and a client backend', () => {
    expect(q).toContain("AND a.state = 'idle in transaction'");
    expect(q).toContain("AND a.backend_type = 'client backend'");
    expect(q).toContain('AND a.state_change < clock_timestamp() - make_interval(secs => $3::float8 / 1000)');
    expect(q).toContain('AND a.xact_start < clock_timestamp() - make_interval(secs => $3::float8 / 1000)');
    expect(q).toContain('AND a.pid <> pg_backend_pid()');
    // Longer than the quiet wait's own age and the lock_timeout: never the
    // gap between two statements of a working transaction.
    expect(IDLE_HOLDER_MIN_IDLE_MS).toBeGreaterThan(QUIET_HOLDER_AGE_MS);
    expect(IDLE_HOLDER_MIN_IDLE_MS).toBeGreaterThan(WINDOW_LOCK_TIMEOUT_MS);
    expect(TERMINATE_WAIT_MS).toBeLessThanOrEqual(1000);
  });

  it('never a superuser, a Supabase role, pg_cron, PostgREST or the installer itself', () => {
    expect(q).toContain('AND NOT r.rolsuper');
    expect(q).toContain("AND r.rolname NOT LIKE 'supabase\\_%'");
    expect(q).toContain("AND pg_has_role(r.oid, 'postgres', 'MEMBER')");
    expect(q).toContain(`<> ALL (ARRAY['pg_cron','${OWN_APPLICATIONS.join("','")}'])`);
    for (const app of [
      'install-window-migrations',
      'install-window-migrations-quiet',
      'install-window-migrations-terminate',
      'apply-recorded-migration',
    ])
      expect(OWN_APPLICATIONS).toContain(app);
    expect(installer).toContain("application_name: 'install-window-migrations-terminate'");
  });

  it('only on the relations the file declares, against the modes its lock conflicts with', () => {
    expect(q).toContain("JOIN pg_locks l ON l.locktype = 'relation' AND l.relation = t.oid");
    expect(q).not.toMatch(/l\.granted\b(?!\))/); // holders AND queued waiters are examined
    expect(
      idleBlockerTargets(['public.clubs', 'public.tables'], [
        { relation: 'public.clubs', mode: 'ShareRowExclusiveLock' },
        { relation: 'public.hand_history', mode: 'AccessExclusiveLock' },
      ])
    ).toEqual([
      { relation: 'public.clubs', mode: 'ShareRowExclusiveLock' },
      { relation: 'public.tables', mode: 'AccessExclusiveLock' },
    ]);
    expect(idleBlockerTargets([], [{ relation: 'public.clubs', mode: 'AccessExclusiveLock' }])).toEqual([]);
  });
});

describe('every termination is recorded by the statement that sends it', () => {
  it('inserts one row per session into the durable table, with no foreign key', () => {
    expect(TERMINATION_TABLE).toBe('public.ca_window_install_terminations');
    expect(q).toMatch(/rec AS \(\n  INSERT INTO public\.ca_window_install_terminations/);
    for (const col of ['pid', 'session_role', 'application_name', 'state', 'relation', 'xact_age', 'idle_for', 'terminated'])
      expect(q).toContain(col);
    const file = readdirSync(resolve(root, 'supabase/migrations')).find((f) =>
      f.endsWith('_a_window_install_records_every_idle_session_it_terminates.sql')
    );
    expect(file).toBeTruthy();
    const sql = read(`supabase/migrations/${file}`);
    expect(sql).toContain('CREATE TABLE public.ca_window_install_terminations');
    expect(sql).not.toMatch(/REFERENCES/i);
    expect(sql).not.toMatch(/@install-window/);
    expect(read('scripts/ci/fixtures/maintenance-window-migrations/schema.sql')).toContain(
      'CREATE TABLE public.ca_window_install_terminations'
    );
  });
});

describe('the installer: declared files only, daily window only, still one attempt', () => {
  const loop = installer.slice(installer.indexOf('for (const f of queued) {\n  const started'));
  const step = installer.slice(
    installer.indexOf('async function terminateIdleBlockers'),
    installer.indexOf('async function holdersAfterRefusal')
  );

  it('runs immediately before the one spawnSync, after the quiet wait', () => {
    const wait = loop.indexOf('await awaitQuietMoment(f, targets, declared);');
    const end = loop.indexOf('await terminateIdleBlockers(f, targets, declared);');
    expect(wait).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(wait);
    expect(end).toBeLessThan(loop.indexOf('spawnSync('));
    expect(loop.match(/spawnSync\(/g)).toHaveLength(1);
    // Runs only after the freeze was confirmed by the bounded wait.
    expect(installer.indexOf('async function terminateIdleBlockers')).toBeGreaterThan(
      installer.indexOf('if (!open)\n  finish(')
    );
  });

  it('refuses an owner window and an undeclared file, and never ends the run', () => {
    expect(step).toContain('if (ownerWindow || declared.length === 0) return;');
    expect(step).not.toMatch(/\bfinish\(/);
    expect(step).toContain('nothing terminated, sending it once');
    expect(step).toContain('if (row.open !== true)');
  });

  it('stops the quiet wait only when every holder is idle on a declared relation', () => {
    expect(installer).toContain('if (!ownerWindow && quietHoldersAreIdleOnDeclared(held, declared)) {');
    const idle = { relation: 'public.clubs', state: 'idle in transaction', idle_ms: IDLE_HOLDER_MIN_IDLE_MS };
    expect(quietHoldersAreIdleOnDeclared([idle], ['public.clubs'])).toBe(true);
    expect(quietHoldersAreIdleOnDeclared([idle], [])).toBe(false);
    expect(quietHoldersAreIdleOnDeclared([idle], ['public.tables'])).toBe(false);
    expect(quietHoldersAreIdleOnDeclared([{ ...idle, state: 'active' }], ['public.clubs'])).toBe(false);
    expect(quietHoldersAreIdleOnDeclared([{ ...idle, idle_ms: 100 }], ['public.clubs'])).toBe(false);
    expect(quietHoldersAreIdleOnDeclared([idle, { ...idle, state: 'active' }], ['public.clubs'])).toBe(false);
    expect(quietHoldersAreIdleOnDeclared([], ['public.clubs'])).toBe(false);
  });
});
