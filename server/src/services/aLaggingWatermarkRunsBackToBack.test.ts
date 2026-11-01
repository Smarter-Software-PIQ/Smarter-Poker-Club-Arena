/**
 * A WATERMARK MORE THAN ONE INTERVAL BEHIND RUNS BACK TO BACK (Phase 6,
 * 2026-10-31). The rakeback settler's watermark stalled 61 minutes when the
 * fixed 30-minute interval skipped a cycle.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CATCH_UP_BACK_TO_BACK_MAX,
  SETTLER_INTERVAL_MS,
  catchUpDelayMs,
  haltedPageRetryDelayMs,
  watermarkLagMs,
} from './RakebackSettlerService.js';

const LAGGING = SETTLER_INTERVAL_MS + 60_000;

describe('catchUpDelayMs', () => {
  it('no backlog, no catch-up', () => {
    expect(
      catchUpDelayMs({ backlogRemains: false, lagMs: LAGGING, consecutiveStalls: 0, backToBackRuns: 0 })
    ).toBeNull();
  });

  it('a watermark more than one interval behind, with progress, runs the next cycle at once', () => {
    expect(
      catchUpDelayMs({ backlogRemains: true, lagMs: LAGGING, consecutiveStalls: 0, backToBackRuns: 0 })
    ).toBe(0);
  });

  it('within one interval it keeps the ordinary paced catch-up', () => {
    expect(
      catchUpDelayMs({
        backlogRemains: true,
        lagMs: SETTLER_INTERVAL_MS,
        consecutiveStalls: 0,
        backToBackRuns: 0,
      })
    ).toBe(haltedPageRetryDelayMs(0));
    expect(
      catchUpDelayMs({ backlogRemains: true, lagMs: null, consecutiveStalls: 0, backToBackRuns: 0 })
    ).toBe(haltedPageRetryDelayMs(0));
  });

  it('is bounded: after the cap the paced catch-up resumes', () => {
    expect(
      catchUpDelayMs({
        backlogRemains: true,
        lagMs: LAGGING,
        consecutiveStalls: 0,
        backToBackRuns: CATCH_UP_BACK_TO_BACK_MAX,
      })
    ).toBe(haltedPageRetryDelayMs(0));
  });

  it('a cycle that made no progress never runs back to back', () => {
    expect(
      catchUpDelayMs({ backlogRemains: true, lagMs: LAGGING, consecutiveStalls: 3, backToBackRuns: 0 })
    ).toBe(haltedPageRetryDelayMs(3));
  });
});

describe('watermarkLagMs', () => {
  it('reads the raw Postgres timestamp the cursor keeps', () => {
    const now = Date.parse('2026-10-31T12:00:00Z');
    expect(watermarkLagMs('2026-10-31T10:59:00.123456+00:00', now)).toBe(
      now - Date.parse('2026-10-31T10:59:00.123456+00:00')
    );
    expect(watermarkLagMs(null, now)).toBeNull();
    expect(watermarkLagMs('not a time', now)).toBeNull();
  });
});

describe('the back-to-back cycle starts when the settler is idle, not on a timer', () => {
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), 'RakebackSettlerService.ts'),
    'utf8'
  );
  it('is launched from the finally that clears isSettling', () => {
    expect(src).toMatch(
      /finally \{\n\s*this\.isSettling = false;[\s\S]{0,300}const again = this\.runAgainWhenIdle;[\s\S]{0,200}this\.launchSettlement\(again, 'RakebackSettler\.back_to_back_run'\)/
    );
  });
  it('a zero delay never arms a timer (it would be skipped as an overlapping run)', () => {
    const at = src.indexOf('if (delay === 0) {');
    expect(at).toBeGreaterThan(-1);
    const branch = src.slice(at, src.indexOf('this.backToBackRuns = 0;\n    this.catchUpHandle', at));
    expect(branch).toContain('this.runAgainWhenIdle = generation;');
    expect(branch).toContain('return;');
    expect(branch).not.toContain('setTimeout');
  });
});
