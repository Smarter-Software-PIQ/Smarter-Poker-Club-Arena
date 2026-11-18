/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A FINISH THAT TIMES OUT BACKS OFF (2026-11-17)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Tournament 4cea3f54 (Afternoon Free Buy, 547 entries) was decided and could
 * not settle: every terminal attempt ran its whole 45-second statement ceiling
 * in the database, was cancelled (57014) and rolled back. `timeout` is a
 * transient refusal, so the manager asked again on the flat five seconds, for
 * more than ninety minutes: 15 requests, about 100 attempts. Each attempt held
 * a shared wallet row lock for its whole run, so one event that could not
 * settle stalled every cash table on the platform.
 *
 * Owner ruling: a tournament problem is isolated; it never affects another
 * tournament or a cash game.
 *
 * So consecutive statement timeouts of the SAME finish wait base, 2x, 4x ...
 * up to five minutes. A lock timeout (the lane is busy, 55P03) and the
 * maintenance break's own deferrals keep the five-second pass, because they
 * clear by themselves in seconds and hold nothing while they are refused.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  FINISH_STATEMENT_TIMEOUT_BACKOFF_CAP_MS,
  finishRefusalIsMaintenanceDeferral,
  finishRefusalIsStatementTimeout,
} from '../observability/engineInstruments.js';
import { TournamentManagerBase } from './TournamentManagerBase.js';
import { TournamentManagerEliminations } from './TournamentManagerEliminations.js';

const BASE = TournamentManagerBase.UNRESOLVED_BUST_RETRY_MS;
const CAP = FINISH_STATEMENT_TIMEOUT_BACKOFF_CAP_MS;
const TOURNAMENT_ID = '4cea3f54-9fce-4bae-a5d5-78a028ed6c75';
const WINNER = 'finish:11111111-1111-4111-8111-111111111111';

// The messages the manager is actually handed: requestTournamentTerminalReceipt
// throws TerminalSettlementRefusedError(lastFailure), the database's own text.
const STATEMENT_TIMEOUT = new Error('canceling statement due to statement timeout');
const LOCK_TIMEOUT = new Error('canceling statement due to lock timeout');
const FROZEN = new Error('PLATFORM_FROZEN: terminal settlement reserve has started');
const RESERVATION_BUSY = new Error('TERMINAL_MAINTENANCE_RESERVATION_BUSY');

function freshManager() {
  const m = Object.create(TournamentManagerEliminations.prototype) as any;
  m.tournamentId = TOURNAMENT_ID;
  m.finishRefusalStreak = 0;
  m.lastFinishRefusalReason = null;
  m.finishRefusalRetryDueAtMs = null;
  m.finishStatementTimeoutStreak = 0;
  m.lastFinishRefusalWasMaintenanceDeferral = false;
  m.finishRefusalAttemptKey = null;
  return m;
}

/** Refuse the same finish `times` running and return the delay asked after each. */
function refuse(m: any, error: Error, times: number, key: string = WINNER): number[] {
  const delays: number[] = [];
  for (let i = 0; i < times; i++) {
    m.noteFinishAttempt(key);
    m.noteFinishRefusal(true, error);
    delays.push(m.finishRetryDelayMs());
  }
  return delays;
}

afterEach(() => vi.restoreAllMocks());

describe('a finish cancelled at its statement ceiling backs off', () => {
  it('consecutive timeouts wait base, 2x, 4x ... and stop at five minutes', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const m = freshManager();
    expect(CAP).toBe(5 * 60 * 1000);
    expect(refuse(m, STATEMENT_TIMEOUT, 10)).toEqual([
      BASE,
      BASE * 2,
      BASE * 4,
      BASE * 8,
      BASE * 16,
      BASE * 32,
      CAP,
      CAP,
      CAP,
      CAP,
    ]);
  });

  it('the first retry is the unchanged base delay, and nothing is waited before a finish is first asked', () => {
    const m = freshManager();
    expect(m.finishRetryDelayMs()).toBe(BASE);
    expect(m.awaitsItsOwnFinishRetry()).toBe(false);
    expect(refuse(m, STATEMENT_TIMEOUT, 1)).toEqual([BASE]);
  });

  it('the retry the decided recoveries respect is due at the backed-off delay', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const m = freshManager();
    const t0 = Date.now();
    refuse(m, STATEMENT_TIMEOUT, 4);
    expect(m.finishRefusalRetryDueAtMs).toBeGreaterThanOrEqual(t0 + BASE * 8);
    expect(m.awaitsItsOwnFinishRetry(t0 + BASE * 8 - 1_000)).toBe(true);
  });

  it('a committed settlement resets it', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const m = freshManager();
    refuse(m, STATEMENT_TIMEOUT, 5);
    m.clearFinishRefusalStreak();
    expect(m.finishRetryDelayMs()).toBe(BASE);
    expect(refuse(m, STATEMENT_TIMEOUT, 2)).toEqual([BASE, BASE * 2]);
  });

  it('a materially different finish starts again from the base', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const m = freshManager();
    refuse(m, STATEMENT_TIMEOUT, 5);
    expect(refuse(m, STATEMENT_TIMEOUT, 2, 'finish:22222222-2222-4222-8222-222222222222')).toEqual([
      BASE,
      BASE * 2,
    ]);
  });

  it('a different answer in between ends the run of timeouts', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const m = freshManager();
    refuse(m, STATEMENT_TIMEOUT, 5);
    expect(refuse(m, LOCK_TIMEOUT, 1)).toEqual([BASE]);
    expect(refuse(m, STATEMENT_TIMEOUT, 2)).toEqual([BASE, BASE * 2]);
  });

  it('says so once each time the delay grows, naming the tournament and the new delay', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const m = freshManager();
    refuse(m, STATEMENT_TIMEOUT, 9);
    const lines = warn.mock.calls.map(([line]) => String(line));
    // 10s, 20s, 40s, 80s, 160s, 300s: six growths, then silent on the cap.
    expect(lines).toHaveLength(6);
    for (const line of lines) expect(line).toContain(TOURNAMENT_ID);
    expect(lines[0]).toContain('statement timeout');
    expect(lines[0]).toContain('next attempt in 10s');
    expect(lines[5]).toContain('next attempt in 300s');
  });
});

describe('refusals that clear in seconds keep the five-second pass', () => {
  it('a busy lane (lock timeout, 55P03) never grows the delay', () => {
    const m = freshManager();
    expect(finishRefusalIsStatementTimeout(LOCK_TIMEOUT.message)).toBe(false);
    expect(refuse(m, LOCK_TIMEOUT, 40).every((delay) => delay === BASE)).toBe(true);
  });

  it('the maintenance break deferring a finish never grows the delay', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const error of [FROZEN, RESERVATION_BUSY]) {
      const m = freshManager();
      expect(finishRefusalIsMaintenanceDeferral(error.message)).toBe(true);
      expect(refuse(m, error, 40).every((delay) => delay === BASE)).toBe(true);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('a manager that predates these fields still answers the base for a transient', () => {
    const m = Object.create(TournamentManagerEliminations.prototype) as any;
    m.lastFinishRefusalReason = 'timeout';
    m.finishRefusalStreak = 12;
    expect(m.finishRetryDelayMs()).toBe(BASE);
  });
});

describe('one admission asks a timed-out settlement once', () => {
  it('the write loop stops at a statement timeout and still goes to the resolver', () => {
    const rpc = readFileSync(resolve(__dirname, './terminalSettlementRpc.ts'), 'utf8');
    const loop = rpc.slice(
      rpc.indexOf('for (let attempt = 1; attempt <= attempts; attempt++)'),
      rpc.indexOf('const resolved = await resolveOriginalTerminalOutcomeWithArgs(')
    );
    const counted = loop.indexOf('if (!databaseStatedRollback(error)) unprovenAttempts++;');
    const stop = loop.indexOf('if (isStatementTimeoutCancel(error)) break;');
    expect(counted).toBeGreaterThan(0);
    // Counted as unproven first, so the resolver below still decides it.
    expect(stop).toBeGreaterThan(counted);
  });
});
