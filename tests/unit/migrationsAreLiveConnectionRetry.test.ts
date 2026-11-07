/**
 * ONE CONNECTION FAILURE IS NOT A VERDICT, AND NEITHER ARE THREE (2026-11-07).
 *
 * scripts/ci/check-migrations-are-live.mjs answered
 * `COULD NOT ASK: spawnSync psql ETIMEDOUT` twice today (18:00Z, 18:09Z) and
 * `Installed and merged migrations agree` was red on main for ~45 minutes.
 * psql had no connect_timeout, so a pooler that did not answer the handshake
 * held the process until the 60 s budget killed it, and that single lost
 * handshake was the run's answer.
 *
 * The repair is narrow and these pins keep it narrow: a bounded number of
 * re-attempts (CONNECT_RETRIES = 2) for failures BEFORE any query was
 * answered, each attempt logged, a libpq connect_timeout on every attempt,
 * and never a second copy of a query the server answered or rejected.
 * COULD NOT ASK stays its own outcome (CLAUDE.md 10.86): the retries can turn
 * a lost handshake into an answer, never into a pass.
 */
import { describe, it, expect } from 'vitest';
import {
  CONNECT_RETRIES,
  CONNECT_TIMEOUT_SECONDS,
  isConnectionPhaseFailure,
  runPsql,
} from '../../scripts/ci/check-migrations-are-live.mjs';

type Failure = Partial<{ code: string; status: number; stdout: string; stderr: string; message: string }>;

const failure = (f: Failure) => Object.assign(new Error(f.message ?? 'spawnSync psql failed'), f);

/** An execFileSync stand-in that fails `outcomes.length - 1` times, then answers. */
function scripted(outcomes: Array<Failure | { out: string }>) {
  const calls: Array<{ bin: string; args: string[]; env: Record<string, string | undefined> }> = [];
  const spawn = (bin: string, args: string[], options: { env: Record<string, string | undefined> }) => {
    calls.push({ bin, args, env: options.env });
    const next = outcomes[Math.min(calls.length - 1, outcomes.length - 1)];
    if ('out' in next) return next.out;
    throw failure(next);
  };
  return { spawn, calls };
}

const ARGS = ['postgres://x', '-Atc', 'select 1'];
const env = { PSQL_BIN: 'psql-stub' };

describe('a connection-phase failure is recognised by what libpq said, not guessed', () => {
  it.each([
    [{ code: 'ETIMEDOUT' }],
    [{ code: 'ECONNRESET' }],
    [{ code: 'ECONNREFUSED' }],
    [{ status: 2, stderr: 'psql: error: connection to server at "db" (1.2.3.4), port 6543 failed: timeout expired' }],
    [{ status: 2, stderr: 'psql: error: connection to server at "db", port 6543 failed: server closed the connection unexpectedly' }],
    [{ status: 1, stderr: 'psql: error: could not translate host name "db" to address: Name or service not known' }],
    [{ status: 1, stderr: 'ERROR:  08006: connection failure' }],
    [{ status: 1, stderr: 'FATAL:  08P01: protocol violation' }],
  ])('%j happened before any query was answered', (f) => {
    expect(isConnectionPhaseFailure(failure(f))).toBe(true);
  });

  it.each([
    // The server answered: psql rejected the SQL.
    [{ status: 1, stderr: 'ERROR:  42883: function public.fn_x() does not exist' }],
    // The server answered: an ordinary query error without a connection class.
    [{ status: 1, stderr: 'ERROR:  42P01: relation "nope" does not exist' }],
    // The process was killed after the server had produced output: a slow
    // query, not a lost handshake. A second copy is a second slow query.
    [{ code: 'ETIMEDOUT', stdout: 'row-1\nrow-2\n' }],
    [{ code: 'ECONNRESET', stdout: 'partial' }],
    // psql exit 2 with no connection language is not assumed to be one.
    [{ status: 2, stderr: 'psql: error: something else entirely' }],
    // Not an error object at all.
    [null],
    [undefined],
  ])('%j is not a connection-phase failure', (f) => {
    expect(isConnectionPhaseFailure(f === null || f === undefined ? f : failure(f))).toBe(false);
  });
});

describe('runPsql retries the connection phase a bounded number of times', () => {
  it('sets a libpq connect_timeout on every attempt and never a bare connection', () => {
    const { spawn, calls } = scripted([{ out: 'ok\n' }]);
    expect(CONNECT_TIMEOUT_SECONDS).toBeGreaterThan(0);
    expect(CONNECT_TIMEOUT_SECONDS).toBeLessThan(60);
    runPsql(ARGS, { spawn, env, log: () => {} });
    expect(calls).toHaveLength(1);
    expect(calls[0].bin).toBe('psql-stub');
    expect(calls[0].args).toEqual(ARGS);
    expect(calls[0].env.PGCONNECT_TIMEOUT).toBe(String(CONNECT_TIMEOUT_SECONDS));
  });

  it('keeps an explicit PGCONNECT_TIMEOUT the caller already set', () => {
    const { spawn, calls } = scripted([{ out: 'ok\n' }]);
    runPsql(ARGS, { spawn, env: { ...env, PGCONNECT_TIMEOUT: '7' }, log: () => {} });
    expect(calls[0].env.PGCONNECT_TIMEOUT).toBe('7');
  });

  it('answers after a lost handshake, logging each failed attempt', () => {
    const { spawn, calls } = scripted([{ code: 'ETIMEDOUT' }, { code: 'ECONNRESET' }, { out: 'answer\n' }]);
    const log: string[] = [];
    const result = runPsql(ARGS, { spawn, env, log: (m) => log.push(m) });
    expect(result).toEqual({ out: 'answer\n' });
    expect(calls).toHaveLength(3);
    expect(log).toHaveLength(2);
    expect(log[0]).toContain('connection attempt 1 of 3 failed before any query was answered');
    expect(log[0]).toContain('ETIMEDOUT');
    expect(log[1]).toContain('connection attempt 2 of 3');
    expect(log[1]).toContain('ECONNRESET');
  });

  it(`gives up after CONNECT_RETRIES (${CONNECT_RETRIES}) re-attempts and reports them`, () => {
    expect(CONNECT_RETRIES).toBe(2);
    const { spawn, calls } = scripted([{ code: 'ETIMEDOUT' }]);
    const log: string[] = [];
    let caught: (Error & { attempts?: unknown[] }) | undefined;
    try {
      runPsql(ARGS, { spawn, env, log: (m) => log.push(m) });
    } catch (err) {
      caught = err as Error & { attempts?: unknown[] };
    }
    expect(caught).toBeDefined();
    expect(calls).toHaveLength(CONNECT_RETRIES + 1);
    expect(log).toHaveLength(CONNECT_RETRIES);
    expect(caught!.attempts).toHaveLength(CONNECT_RETRIES + 1);
    // Still the original error, so the caller's COULD NOT ASK keeps its text.
    expect(caught!.message).toBe('spawnSync psql failed');
  });

  it('never re-sends a query the server rejected, and hands the refusal back when asked to', () => {
    const rejected = { status: 1, stderr: 'ERROR:  42883: function public.fn_x() does not exist\n' };
    const { spawn, calls } = scripted([rejected, { out: 'would be wrong\n' }]);
    const result = runPsql(ARGS, { spawn, env, log: () => {}, allowRefusal: true });
    expect(result).toEqual({ error: 'ERROR:  42883: function public.fn_x() does not exist' });
    expect(calls).toHaveLength(1);
  });

  it('never re-sends a rejected query even when refusals are not allowed', () => {
    const rejected = { status: 1, stderr: 'ERROR:  42883: function public.fn_x() does not exist\n' };
    const { spawn, calls } = scripted([rejected, { out: 'would be wrong\n' }]);
    expect(() => runPsql(ARGS, { spawn, env, log: () => {} })).toThrow();
    expect(calls).toHaveLength(1);
  });

  it('never re-sends a query that was killed after the server produced output', () => {
    const slow = { code: 'ETIMEDOUT', stdout: 'row-1\n' };
    const { spawn, calls } = scripted([slow, { out: 'would be wrong\n' }]);
    const log: string[] = [];
    expect(() => runPsql(ARGS, { spawn, env, log: (m) => log.push(m) })).toThrow();
    expect(calls).toHaveLength(1);
    expect(log).toEqual([]);
  });

  it('does not treat a class-08 SQLSTATE as a refusal to hand back', () => {
    const lost = { status: 1, stderr: 'ERROR:  08006: connection failure\n' };
    const { spawn, calls } = scripted([lost, { out: 'answer\n' }]);
    const result = runPsql(ARGS, { spawn, env, log: () => {}, allowRefusal: true });
    expect(result).toEqual({ out: 'answer\n' });
    expect(calls).toHaveLength(2);
  });

  it('a successful first attempt is one spawn and no log line', () => {
    const { spawn, calls } = scripted([{ out: '1\n' }]);
    const log: string[] = [];
    expect(runPsql(ARGS, { spawn, env, log: (m) => log.push(m) })).toEqual({ out: '1\n' });
    expect(calls).toHaveLength(1);
    expect(log).toEqual([]);
  });
});
