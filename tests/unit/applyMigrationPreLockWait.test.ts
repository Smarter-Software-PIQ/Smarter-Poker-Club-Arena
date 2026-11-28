import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// @ts-expect-error plain ESM helper shared with scripts/ci/apply-recorded-migration.mjs
import {
  PRE_DDL_LOCK_MAX_CHECKS,
  PRE_DDL_LOCK_INTERVAL_MS,
  PRE_DDL_LOCK_CHECK_SQL,
  extractLockTargetTables,
  waitForPreDdlLocks,
} from '../../scripts/ci/migration-pre-lock-wait.mjs';

const ROOT = resolve(__dirname, '../..');
const installer = readFileSync(resolve(ROOT, 'scripts/ci/apply-recorded-migration.mjs'), 'utf8');

afterEach(() => vi.useRealTimers());

describe('pre-DDL transient lock-contention backoff', () => {
  it('enforces bounded wait constants (3 checks x 5s = max 15s) and read-only lock inspection SQL', () => {
    expect(PRE_DDL_LOCK_MAX_CHECKS).toBe(3);
    expect(PRE_DDL_LOCK_INTERVAL_MS).toBe(5_000);
    expect(PRE_DDL_LOCK_MAX_CHECKS * PRE_DDL_LOCK_INTERVAL_MS).toBe(15_000);

    expect(PRE_DDL_LOCK_CHECK_SQL.trim()).toMatch(/^SELECT\b/i);
    expect(PRE_DDL_LOCK_CHECK_SQL).toContain('pg_catalog.pg_locks');
    expect(PRE_DDL_LOCK_CHECK_SQL).toContain('pg_catalog.pg_stat_activity');
    expect(PRE_DDL_LOCK_CHECK_SQL).toContain('AccessExclusiveLock');
    expect(PRE_DDL_LOCK_CHECK_SQL).toContain('ShareLock');
    expect(PRE_DDL_LOCK_CHECK_SQL).toContain('ExclusiveLock');
    expect(PRE_DDL_LOCK_CHECK_SQL).toContain('to prevent wraparound');
    const sqlWithoutLiterals = PRE_DDL_LOCK_CHECK_SQL.replace(/'(?:[^']|'')*'/g, "''");
    expect(sqlWithoutLiterals).not.toMatch(
      /\b(INSERT|UPDATE|DELETE|ALTER|DROP|LOCK\s+TABLE|pg_terminate_backend|pg_cancel_backend)\b/i
    );
  });

  it('extracts target tables from table-altering/locking DDL while ignoring comments and function bodies', () => {
    const sql = `
-- ALTER TABLE public.commented_out ADD COLUMN x int;
BEGIN;
CREATE TABLE public.brand_new_tbl (id int);
CREATE OR REPLACE FUNCTION public.fn_demo() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  LOCK TABLE public.inside_function_body IN ACCESS EXCLUSIVE MODE;
END;
$$;
ALTER TABLE public.tables ADD COLUMN note text;
CREATE TRIGGER trg_x AFTER INSERT ON public.hand_history FOR EACH ROW EXECUTE FUNCTION public.fn_demo();
ALTER TABLE pg_temp.scratch ADD COLUMN y int;
COMMIT;
`;
    expect(extractLockTargetTables(sql)).toEqual(['public.tables', 'public.hand_history']);

    const fnOnly = `BEGIN;\nCREATE OR REPLACE FUNCTION public.f() RETURNS int LANGUAGE sql AS $$ SELECT 1; $$;\nCOMMIT;\n`;
    expect(extractLockTargetTables(fnOnly)).toEqual([]);
  });

  it('skips querying when a migration has no table-locking DDL and returns immediately when uncontended', async () => {
    const query = vi.fn();
    const resNone = await waitForPreDdlLocks({ query }, 'BEGIN;\nSELECT 1;\nCOMMIT;\n');
    expect(resNone).toMatchObject({ checked: false, cleared: true, checks: 0, waitedMs: 0 });
    expect(query).not.toHaveBeenCalled();

    query.mockResolvedValueOnce({ rows: [] });
    const resFree = await waitForPreDdlLocks(
      { query },
      'BEGIN;\nALTER TABLE public.clubs ADD COLUMN x int;\nCOMMIT;\n'
    );
    expect(resFree).toMatchObject({
      checked: true,
      cleared: true,
      checks: 1,
      waitedMs: 0,
      targetTables: ['public.clubs'],
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('backs off cleanly when a conflicting lock is held, logs blocking PID/wait_event, and proceeds once cleared', async () => {
    vi.useFakeTimers();
    const logs: string[] = [];
    const blocker = {
      pid: 4242,
      relation: 'public.clubs',
      mode: 'AccessExclusiveLock',
      wait_event_type: 'Lock',
      wait_event: 'relation',
      state: 'active',
      backend_type: 'client backend',
      application_name: 'other-ddl',
      age_seconds: 7,
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [blocker] })
      .mockResolvedValueOnce({ rows: [blocker] })
      .mockResolvedValueOnce({ rows: [] });

    const promise = waitForPreDdlLocks(
      { query },
      'BEGIN;\nALTER TABLE public.clubs ADD COLUMN z int;\nCOMMIT;\n',
      { log: (m: string) => logs.push(m) }
    );
    await vi.advanceTimersByTimeAsync(10_000);
    const res = await promise;

    expect(res).toMatchObject({
      checked: true,
      cleared: true,
      checks: 3,
      waitedMs: 10_000,
    });
    expect(query).toHaveBeenCalledTimes(3);
    expect(logs.join('\n')).toContain('pid=4242');
    expect(logs.join('\n')).toContain('AccessExclusiveLock');
    expect(logs.join('\n')).toContain('Lock:relation');
  });

  it('caps backoff strictly at 3 checks x 5s = 15s total and never loops indefinitely', async () => {
    vi.useFakeTimers();
    const logs: string[] = [];
    const autovac = {
      pid: 9001,
      relation: 'public.hand_history',
      mode: 'ShareUpdateExclusiveLock',
      wait_event_type: 'IO',
      wait_event: 'DataFileRead',
      state: 'active',
      backend_type: 'autovacuum worker',
      application_name: '',
      age_seconds: 320,
    };
    const query = vi.fn().mockResolvedValue({ rows: [autovac] });

    const promise = waitForPreDdlLocks(
      { query },
      'BEGIN;\nALTER TABLE public.hand_history ADD COLUMN tag text;\nCOMMIT;\n',
      { log: (m: string) => logs.push(m) }
    );
    await vi.advanceTimersByTimeAsync(20_000);
    const res = await promise;

    expect(res).toMatchObject({
      checked: true,
      cleared: false,
      checks: 3,
      waitedMs: 15_000,
    });
    expect(query).toHaveBeenCalledTimes(3);
    expect(logs.join('\n')).toContain('pid=9001');
    expect(logs.join('\n')).toContain('IO:DataFileRead');
  });

  it('wires into apply-recorded-migration.mjs strictly before BEGIN and preserves single-attempt semantics', () => {
    expect(installer).toContain("from './migration-pre-lock-wait.mjs'");
    const preLockIdx = installer.indexOf('waitForPreDdlLocks(');
    const startedIdx = installer.indexOf('const started = Date.now()');
    const sendIdx = installer.indexOf('client.query(transactionSQL)');
    expect(preLockIdx).toBeGreaterThan(-1);
    expect(preLockIdx).toBeLessThan(startedIdx);
    expect(preLockIdx).toBeLessThan(sendIdx);
    // Exact one-attempt transactional semantics preserved: still exactly 2 sends (settlement vs normal).
    expect(installer.match(/client\.query\(transactionSQL\)/g)).toHaveLength(2);
  });
});
