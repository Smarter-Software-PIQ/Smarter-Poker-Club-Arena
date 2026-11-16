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
  WITNESS_FILE,
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
    expect(job).toContain(
      "if: (github.event_name == 'pull_request' || github.event_name == 'merge_group')"
    );
    expect(job).toContain('fetch-depth: 0');
    const step = job.slice(
      job.indexOf('- name: Owner maintenance bookings give notice after they merge')
    );
    expect(step).toContain(
      'CI_BASE_SHA: ${{ (github.event.pull_request.base.sha || github.event.merge_group.base_sha) }}'
    );
    expect(step).toContain('run: node scripts/ci/check-owner-window-notice-after-merge.mjs');
  });
});

describe('a consumed window that merged after its notice passes only on its public witness (2026-11-15)', () => {
  const ID = '2026-11-15-owner-offcycle-engine-1206z';
  // The window exactly as main holds it; #10959 merged it at 11:59:42Z (committer time).
  const W = {
    id: ID,
    playerNoticeAt: '2026-11-15T11:40:00Z',
    notBefore: '2026-11-15T12:06:00Z',
    notAfter: '2026-11-15T15:00:00Z',
  };
  const MERGED = at('2026-11-15T11:59:42Z');
  const NOW = at('2026-11-15T16:00:00Z');
  const witnessDoc = JSON.parse(readFileSync(WITNESS_FILE, 'utf8'));
  const real = witnessDoc.witnesses.find((w: { windowId: string }) => w.windowId === ID);
  const withWitness = (extra: Record<string, unknown> = {}) => ({
    version: 1,
    witnesses: [{ ...real, ...extra }],
  });
  const merged = () => MERGED;

  it('records the witnessed times and their runs', () => {
    expect(witnessDoc.witnesses).toHaveLength(1);
    expect(real.publicNoticeAt).toBe('2026-11-15T12:06:39.256Z');
    expect(real.publicNoticeEvidence.runId).toBe(43711575766);
    expect(real.activatedAt).toBe('2026-11-15T13:13:09Z');
    expect(real.activationEvidence.runId).toBe(43717613638);
    expect(real.activationEvidence.resultLogLine).toContain('ENGINE_RELEASE_RESULT=sealed');
  });

  it('fails without its witness and passes with it', () => {
    expect(bookingViolations(doc(W), merged, NOW)).toEqual([
      expect.stringContaining('is before the booking merged'),
    ]);
    expect(bookingViolations(doc(W), merged, NOW, witnessDoc)).toEqual([]);
  });

  it('the window record main holds is the one the witness excuses, unchanged', () => {
    const windows = JSON.parse(
      readFileSync('server/release/owner-maintenance-windows.json', 'utf8')
    );
    const own = windows.windows.find((w: { id: string }) => w.id === ID);
    expect([own.playerNoticeAt, own.notBefore, own.notAfter]).toEqual([
      W.playerNoticeAt,
      W.notBefore,
      W.notAfter,
    ]);
  });

  it('refuses a witness with less than the twenty-minute lead', () => {
    const v = bookingViolations(
      doc(W),
      merged,
      NOW,
      withWitness({ activatedAt: '2026-11-15T12:26:39.255Z' })
    );
    expect(v.join('\n')).toMatch(/less than 20 minutes after notice/);
    expect(v.join('\n')).toMatch(/is before the booking merged/);
    expect(
      bookingViolations(
        doc(W),
        merged,
        NOW,
        withWitness({ activatedAt: '2026-11-15T12:26:39.256Z' })
      )
    ).toEqual([]);
  });

  it('refuses a witnessed notice that precedes the merge', () => {
    const v = bookingViolations(
      doc(W),
      merged,
      NOW,
      withWitness({ publicNoticeAt: '2026-11-15T11:59:41Z' })
    );
    expect(v.join('\n')).toMatch(/precedes the merge/);
  });

  it('refuses an activation after notAfter, before notBefore, or not yet happened', () => {
    const late = bookingViolations(
      doc(W),
      merged,
      NOW,
      withWitness({ activatedAt: '2026-11-15T15:00:01Z' })
    );
    expect(late.join('\n')).toMatch(/is after notAfter/);
    const early = bookingViolations(
      doc({ ...W, notBefore: '2026-11-15T13:30:00Z' }),
      merged,
      NOW,
      withWitness()
    );
    expect(early.join('\n')).toMatch(/precedes notBefore/);
    const future = bookingViolations(doc(W), merged, at('2026-11-15T13:00:00Z'), witnessDoc);
    expect(future.join('\n')).toMatch(/has not happened/);
  });

  it('cannot excuse a window being booked in the same change', () => {
    const v = bookingViolations(doc(W), () => null, NOW, witnessDoc);
    expect(v.join('\n')).toMatch(/cannot excuse a window this change is booking/);
    expect(v.join('\n')).toMatch(/is before the booking lands/);
  });

  it('never excuses a missing notice, and refuses orphan, duplicate or malformed witnesses', () => {
    expect(
      bookingViolations(doc({ ...W, playerNoticeAt: undefined }), merged, NOW, witnessDoc)
    ).toEqual([`${ID}: playerNoticeAt is required`]);
    const orphan = bookingViolations(
      doc({ ...W, id: 'other' }),
      () => at('2026-11-15T11:00:00Z'),
      NOW,
      witnessDoc
    );
    expect(orphan).toEqual([expect.stringContaining('names no booked window')]);
    const dup = bookingViolations(doc(W), merged, NOW, {
      version: 1,
      witnesses: [real, real],
    });
    expect(dup).toEqual([expect.stringContaining('duplicate witness')]);
    const bare = bookingViolations(doc(W), merged, NOW, {
      version: 1,
      witnesses: [
        { windowId: ID, publicNoticeAt: real.publicNoticeAt, activatedAt: real.activatedAt },
      ],
    });
    expect(bare.join('\n')).toMatch(/must name its workflow and integer runId/);
    expect(bare.join('\n')).toMatch(/is before the booking merged/);
    expect(bookingViolations(doc(W), merged, NOW, { witnesses: [] })).toEqual([
      expect.stringContaining('version 1 with a witnesses array is required'),
      expect.stringContaining('is before the booking merged'),
    ]);
    for (const field of ['publicNoticeAt', 'activatedAt']) {
      const invalidDate = bookingViolations(
        doc(W),
        merged,
        NOW,
        withWitness({ [field]: '2026-99-15T12:06:39Z' })
      );
      expect(invalidDate.join('\n')).toContain(`${field} must be an ISO UTC timestamp`);
      expect(invalidDate.join('\n')).toContain('is before the booking merged');
    }
  });

  it('the witness file is outside the server tree, so it is never an engine release input', () => {
    expect(WITNESS_FILE.startsWith('server/')).toBe(false);
  });
});
