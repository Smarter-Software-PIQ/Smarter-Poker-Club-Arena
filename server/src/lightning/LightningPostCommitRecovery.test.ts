import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  POST_COMMIT_PENDING_COUNT_CAP,
  POST_COMMIT_RECOVERY_MIN_AGE_MS,
  drainPendingPostCommitObligations,
  observePendingPostCommitObligations,
  pendingPostCommitObservation,
  pendingPostCommitPrometheusLines,
  resetPendingPostCommitObservationForTests,
} from './LightningPostCommitRecovery.js';
import { blankNonCode, sliceMethod } from '../testHelpers/sourceWindow.js';

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

/**
 * Operator policy (2026-10-31): no new recurring drain. At a break
 * announcement the leader only counts what is pending, publishes the count on
 * /health and /metrics, and alerts when it is non-zero.
 */
describe('observePendingPostCommitObligations (detection only)', () => {
  const quiet = () => undefined;
  beforeEach(() => resetPendingPostCommitObservationForTests());

  it('counts pending envelopes older than the min age and never processes one', async () => {
    let before: Date | null = null;
    let limit = 0;
    const seen = await observePendingPostCommitObligations('break_announcement', {
      listPending: async (b, l) => {
        before = b;
        limit = l;
        return ['h1', 'h2', 'h2'];
      },
      now: () => 200_000,
      log: quiet,
    });
    expect(seen).toEqual({
      trigger: 'break_announcement',
      count: 2,
      capped: false,
      observedAtMs: 200_000,
    });
    expect(before!.getTime()).toBe(200_000 - POST_COMMIT_RECOVERY_MIN_AGE_MS);
    expect(limit).toBe(POST_COMMIT_PENDING_COUNT_CAP + 1);
    expect(pendingPostCommitObservation()).toEqual(seen);
  });

  it('says "at least" when the bounded scan hits its cap', async () => {
    const seen = await observePendingPostCommitObligations(
      'break_announcement',
      { listPending: async () => ['a', 'b', 'c', 'd'], log: quiet },
      { cap: 3 }
    );
    expect(seen).toMatchObject({ count: 3, capped: true });
  });

  it('an unreadable count is null, never thrown', async () => {
    const seen = await observePendingPostCommitObligations('break_announcement', {
      listPending: async () => {
        throw new Error('down');
      },
      log: quiet,
    });
    expect(seen.count).toBeNull();
    expect(pendingPostCommitPrometheusLines()).toEqual([]);
  });

  it('publishes the count as a /metrics gauge', async () => {
    expect(pendingPostCommitPrometheusLines(), 'nothing before the first count').toEqual([]);
    await observePendingPostCommitObligations('startup', {
      listPending: async () => ['x'],
      now: () => 5_000,
      log: quiet,
    });
    const lines = pendingPostCommitPrometheusLines();
    expect(lines).toContain('poker_lightning_post_commit_pending{trigger="startup",capped="0"} 1');
    expect(lines).toContain('poker_lightning_post_commit_pending_observed_at_seconds 5');
  });
});

describe('GameServer wiring: the break announcement counts and alerts, it never drains', () => {
  const SRC = readFileSync(resolve(__dirname, '../GameServer.ts'), 'utf8');
  const CODE = blankNonCode(SRC);
  /** Comments removed, string literals kept. */
  const noComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');
  const CODE_WITH_STRINGS = noComments(SRC);

  it('the only drain trigger is the one-shot startup pass', () => {
    const triggers = [...CODE_WITH_STRINGS.matchAll(/recoverPendingPostCommitObligations\(\s*'([a-z_]+)'/g)].map(
      (m) => m[1]
    );
    expect(triggers).toEqual(['startup']);
  });

  it('the announcement hook counts, publishes and alerts', () => {
    expect(CODE).toMatch(/onAnnounced: \(\) => \{[^}]*this\.alertOnPendingPostCommitObligations\(\)/);
    const alert = noComments(sliceMethod(SRC, 'private async alertOnPendingPostCommitObligations('));
    expect(alert).toContain("readPendingPostCommitCount('break_announcement')");
    expect(alert).toContain('raiseEngineAlert(');
    expect(alert).toContain('resolveEngineAlert(');
    expect(alert).not.toContain('recoverPendingPostCommitObligations');
    expect(alert).not.toContain('drainPendingPostCommitObligations');
    expect(CODE).toContain('lightningPostCommitPending: pendingPostCommitObservation()');
    expect(CODE).toContain('freeze.push(...pendingPostCommitPrometheusLines())');
  });
});
