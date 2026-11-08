import { describe, expect, it } from 'vitest';
import { classifyChangedPaths } from '../../scripts/ci/classify-ci-changes.mjs';

describe('Midway weekly proposal qualification routing', () => {
  it.each([
    'scripts/tournament-schedules/review-midway-weekly.py',
    'scripts/tournament-schedules/midway-live-snapshot.sql',
    'scripts/tournament-schedules/test_review_midway_weekly.py',
    'scripts/ci/test-midway-bounty-freezeout.py',
    'scripts/ci/test-midway-weekly-schedule.py',
    'scripts/ci/fixtures/midway-weekly/production-creation-contract.json',
    'docs/tournament-schedules/midway-weekly-2026-11-07.json',
  ])('runs the existing required PostgreSQL route for %s', (path) => {
    expect(classifyChangedPaths([path])).toMatchObject({ server: true, tests: true });
  });
});
