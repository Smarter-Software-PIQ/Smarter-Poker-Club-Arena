/**
 * A HANDOFF SUCCESSOR LEADS ONLY WHEN IT IS GRANTED LEADERSHIP (2026-11-19,
 * docs/ENGINE-ROLLING-HANDOFF.md).
 *
 * The successor deals tables handed to it while the serving engine still
 * leads and runs every singleton job. If it ever believed it led while that
 * engine was alive, two engines would run discovery, sweeps and the weekly
 * jobs at once. So its claim is the strict half of renewLeadership: only an
 * explicit grant makes it leader, and the unknown-streak self-promotion an
 * ordinary standby has after ~30 s of database silence never applies.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('./supabase/client.js', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock('./tableLease.js', () => ({ INSTANCE_ID: 'successor', INSTANCE_VERSION: 'v2' }));
vi.mock('./errorReporter.js', () => ({ reportError: () => {} }));

let exitSpy: any;
beforeEach(() => {
  vi.resetModules();
  rpc.mockReset();
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
});
afterEach(() => exitSpy.mockRestore());

describe('claimLeadershipAsHandoffSuccessor', () => {
  it('never promotes on errors, throws, empty answers or a named holder, however many', async () => {
    const leadership = await import('./leadership.js');
    leadership.__resetLeadership();
    const answers = [
      () => Promise.resolve({ data: null, error: { message: 'statement timeout' } }),
      () => Promise.reject(new Error('network down')),
      () => Promise.resolve({ data: [], error: null }),
      () =>
        Promise.resolve({
          data: [{ granted: false, holder: 'serving-engine', holder_age_seconds: 2 }],
          error: null,
        }),
    ];
    for (let round = 0; round < 3; round++) {
      for (const answer of answers) {
        rpc.mockImplementationOnce(answer);
        await expect(leadership.claimLeadershipAsHandoffSuccessor()).resolves.toBe(false);
        expect(leadership.isLeader()).toBe(false);
      }
    }
    expect(leadership.leadershipDiagnostics().holder).toBe('serving-engine');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('leads on an explicit grant, in place, without restarting the process', async () => {
    const leadership = await import('./leadership.js');
    leadership.__resetLeadership();
    rpc.mockResolvedValueOnce({
      data: [{ granted: true, holder: 'successor', holder_age_seconds: 0 }],
      error: null,
    });
    await expect(leadership.claimLeadershipAsHandoffSuccessor()).resolves.toBe(true);
    expect(leadership.isLeader()).toBe(true);
    expect(rpc).toHaveBeenCalledWith('claim_engine_leadership', {
      p_instance_id: 'successor',
      p_version: 'v2',
      p_stale_seconds: leadership.LEADERSHIP_STALE_SECONDS,
    });
    // The ordinary renewal that follows keeps it, and nothing asked to restart.
    rpc.mockResolvedValueOnce({
      data: [{ granted: true, holder: 'successor', holder_age_seconds: 0 }],
      error: null,
    });
    await expect(leadership.renewLeadership()).resolves.toBe('leader');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
