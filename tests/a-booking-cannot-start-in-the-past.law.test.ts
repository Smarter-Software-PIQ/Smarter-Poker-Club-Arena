/**
 * A BOOKING CANNOT START IN THE PAST (Dan 2026-11-07).
 * scripts/ci/check-owner-window-notice-after-merge.mjs refuses an owner
 * maintenance window whose playerNoticeAt is earlier than the moment it merges
 * to main. #9903 (notBefore already past at merge) froze the platform at 13:16
 * Chicago with two minutes' warning; #9969 merged a window 85 minutes after its
 * own playerNoticeAt.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  bookingViolations,
  RULE_FROM,
} from '../scripts/ci/check-owner-window-notice-after-merge.mjs';

const at = (iso: string) => Date.parse(iso);
const window = (extra: Record<string, unknown> = {}) => ({
  id: 'w',
  playerNoticeAt: '2026-11-09T18:00:00Z',
  notBefore: '2026-11-09T18:30:00Z',
  notAfter: '2026-11-09T23:00:00Z',
  ...extra,
});
const doc = (w: Record<string, unknown>) => ({ windows: [w], databaseWindows: [] });

describe('a booking cannot give notice before it lands', () => {
  it('a new booking (not on main yet) is judged against now', () => {
    const notOnMain = () => null;
    expect(bookingViolations(doc(window()), notOnMain, at('2026-11-09T17:00:00Z'))).toEqual([]);
    const late = bookingViolations(doc(window()), notOnMain, at('2026-11-09T18:05:00Z'));
    expect(late).toHaveLength(1);
    expect(late[0]).toContain('is before the booking lands');
  });

  it('a booking on main is judged against its own merge, forever', () => {
    const mergedAt = (ms: number) => () => ms;
    expect(
      bookingViolations(
        doc(window()),
        mergedAt(at('2026-11-09T17:59:00Z')),
        at('2026-11-10T00:00:00Z')
      )
    ).toEqual([]);
    // #9969's shape: merged 85 minutes after its own notice instant.
    const shape = window({
      playerNoticeAt: '2026-11-09T22:10:00Z',
      notBefore: '2026-11-09T22:30:00Z',
    });
    expect(
      bookingViolations(
        doc(shape),
        mergedAt(at('2026-11-09T23:35:54Z')),
        at('2026-11-10T00:00:00Z')
      )
    ).toEqual([expect.stringContaining('is before the booking merged')]);
  });

  it('a database window is held to the same rule, and a missing notice is refused', () => {
    const d = { windows: [], databaseWindows: [window({ playerNoticeAt: undefined })] };
    expect(bookingViolations(d, () => null, at('2026-11-09T17:00:00Z'))).toEqual([
      'w: playerNoticeAt is required',
    ]);
  });

  it('exempts the certified emergency path and what main held before the rule', () => {
    expect(
      bookingViolations(
        doc(window({ certifiedRecoveryProfile: 'p', playerNoticeAt: undefined })),
        () => null,
        at('2026-11-09T20:00:00Z')
      )
    ).toEqual([]);
    expect(
      bookingViolations(doc(window({ playerNoticeAt: undefined })), () => RULE_FROM - 1, Date.now())
    ).toEqual([]);
  });

  it('runs on every pull request with full history, against the PR base', () => {
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    const start = ci.indexOf('\n  typecheck_compile:\n');
    const rest = ci.slice(start + 1);
    const next = rest.slice(1).search(/\n {2}[a-z0-9_-]+:\n/);
    const job = next === -1 ? rest : rest.slice(0, next + 1);
    expect(job).toContain("if: github.event_name == 'pull_request'");
    expect(job).toContain('fetch-depth: 0');
    const step = job.slice(
      job.indexOf('- name: Owner maintenance bookings give notice after they merge')
    );
    expect(step).toContain('CI_BASE_SHA: ${{ github.event.pull_request.base.sha }}');
    expect(step).toContain('run: node scripts/ci/check-owner-window-notice-after-merge.mjs');
  });
});
