import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  clampSyntheticIncidentTimestampMs,
  computeUnionWeekStartLaEpochMs,
  evaluateWorktreeStorageCompliance,
} from '../../scripts/ci/verify-worktree-storage-and-dst-bounds.mjs';

describe('verify-worktree-storage-and-dst-bounds (Phase 5 CI & storage guard)', () => {
  it('enforces external SSD worktree paths and rejects boot-disk paths when SSD is mounted', () => {
    expect(
      evaluateWorktreeStorageCompliance({
        worktreePath: '/Volumes/SmarterWork/agent-work/shared-capacity/horse-phase2-01a182fe/wt',
      }).compliant
    ).toBe(true);

    const internalTrees = evaluateWorktreeStorageCompliance({
      worktreePath: path.posix.join(
        '/',
        'Users',
        'smarter.poker',
        'Documents',
        '.agent-trees',
        'club-arena',
        'probe'
      ),
    });
    expect(internalTrees.compliant).toBe(false);
    expect(internalTrees.reason).toBe('forbidden_internal_drive_path');

    const tmpPath = evaluateWorktreeStorageCompliance({
      worktreePath: path.posix.join('/', 'tmp', 'scratch-worktree'),
    });
    expect(tmpPath.compliant).toBe(false);
    expect(tmpPath.reason).toBe('forbidden_internal_drive_path');

    const internalRepo = evaluateWorktreeStorageCompliance({
      worktreePath: path.posix.join('/', 'Users', 'smarter.poker', 'Documents', 'club-arena'),
      ssdMounted: true,
    });
    expect(internalRepo.compliant).toBe(false);
    expect(internalRepo.reason).toBe('not_on_mounted_external_ssd');
  });

  it('computes exact Monday 00:00 America/Los_Angeles week boundaries across fall-back and spring-forward DST', () => {
    // Monday 2026-11-02 08:01:25 UTC (1 minute 25 seconds after Monday 00:00 PST following Nov 1 DST fall-back)
    const nov2JustAfterMidnightLa = Date.parse('2026-11-02T08:01:25Z');
    const weekStartNov2 = computeUnionWeekStartLaEpochMs(nov2JustAfterMidnightLa);
    expect(new Date(weekStartNov2).toISOString()).toBe('2026-11-02T08:00:00.000Z');

    // Without clamping, now - 10min (07:51:25 UTC) would fall into Sunday 23:51:25 PST (previous week!)
    // With clamping, it stays at 2026-11-02T08:00:00.000Z in the same union week
    const clamped = clampSyntheticIncidentTimestampMs(nov2JustAfterMidnightLa, -10 * 60 * 1000);
    expect(clamped).toBe(weekStartNov2);
    expect(computeUnionWeekStartLaEpochMs(clamped)).toBe(weekStartNov2);

    // Prior Monday 2026-10-26 was still in PDT (UTC-7 -> 07:00:00Z)
    const oct26AfterMidnightLa = Date.parse('2026-10-26T07:05:00Z');
    const weekStartOct26 = computeUnionWeekStartLaEpochMs(oct26AfterMidnightLa);
    expect(new Date(weekStartOct26).toISOString()).toBe('2026-10-26T07:00:00.000Z');
  });
});
