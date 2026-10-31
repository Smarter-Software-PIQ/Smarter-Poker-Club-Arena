import { describe, expect, it } from 'vitest';
import {
  POST_COMMIT_RECOVERY_MIN_AGE_MS,
  drainPendingPostCommitObligations,
} from './LightningPostCommitRecovery.js';

/**
 * Phase 6 (2026-10-31): LightningHandHost.post_commit_obligations_pending fired
 * 33 times and the envelopes stayed pending until the restart. The leader now
 * drains them at startup and before a break freeze.
 */
describe('drainPendingPostCommitObligations', () => {
  const quiet = () => undefined;

  it('asks every pending envelope once, oldest first, and counts the outcomes', async () => {
    const asked: string[] = [];
    let before: Date | null = null;
    const out = await drainPendingPostCommitObligations('startup', {
      listPending: async (b) => {
        before = b;
        return ['h1', 'h2', 'h2', 'h3'];
      },
      process: async (id) => {
        asked.push(id);
        if (id === 'h2') return { ok: false, reason: 'predecessor_pending' };
        if (id === 'h3') throw new Error('timeout');
        return { ok: true };
      },
      now: () => 100_000,
      log: quiet,
    });
    expect(asked).toEqual(['h1', 'h2', 'h3']);
    expect(out).toMatchObject({ found: 3, completed: 1, stillPending: 1, failed: 1 });
    // Never races a host's own first attempt.
    expect(before!.getTime()).toBe(100_000 - POST_COMMIT_RECOVERY_MIN_AGE_MS);
  });

  it('is idempotent: a second pass over completed envelopes completes nothing new', async () => {
    const done = new Set<string>();
    const deps = {
      listPending: async () => ['a', 'b'].filter((id) => !done.has(id)),
      process: async (id: string) => {
        done.add(id);
        return { ok: true };
      },
      log: quiet,
    };
    expect((await drainPendingPostCommitObligations('startup', deps)).completed).toBe(2);
    expect(await drainPendingPostCommitObligations('break_announcement', deps)).toMatchObject({
      found: 0,
      completed: 0,
    });
  });

  it('stays inside its budget and leaves the rest for the next pass', async () => {
    let t = 0;
    const out = await drainPendingPostCommitObligations(
      'break_announcement',
      {
        listPending: async () => ['a', 'b', 'c'],
        process: async () => {
          t += 600;
          return { ok: true };
        },
        now: () => t,
        log: quiet,
      },
      { budgetMs: 1_000 }
    );
    expect(out).toMatchObject({ completed: 2, stillPending: 1, outOfBudget: true });
  });

  it('an unreadable scan is reported, never thrown', async () => {
    const out = await drainPendingPostCommitObligations('startup', {
      listPending: async () => {
        throw new Error('down');
      },
      process: async () => ({ ok: true }),
      log: quiet,
    });
    expect(out).toMatchObject({ listFailed: true, found: 0 });
  });
});
