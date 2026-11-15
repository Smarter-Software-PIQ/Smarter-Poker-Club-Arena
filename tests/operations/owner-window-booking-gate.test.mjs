/**
 * A BAD BOOKING CANNOT MERGE (Dan 2026-11-10).
 *
 * The 2026-11-10-owner-asap-engine-0440z booking passed its pull request
 * checks while playerNoticeAt 2026-11-10T04:20:00Z was still ahead, merged at
 * 04:43:28Z, and the after-merge check
 * (scripts/ci/check-owner-window-notice-after-merge.mjs) then failed on every
 * pull request in the repository. scripts/ci/check-owner-window-booking.mjs
 * validates the booking in its own pull request: every record the change adds
 * or edits must still be bookable at validation time. Unchanged records are
 * immutable history and are never re-judged.
 */
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  bookedRecords,
  bookingRecordViolations,
  FILE,
  TOLERANCE_MS,
} from '../../scripts/ci/check-owner-window-booking.mjs';
import { bookingAdmission } from '../../scripts/ci/check-owner-window-notice-after-merge.mjs';

const at = (s) => Date.parse(s);
const doc = (windows = [], databaseWindows = []) => ({ version: 1, windows, databaseWindows });

/** The record that merged broken on 2026-11-10, exactly as main holds it. */
const TONIGHTS_BAD_RECORD = {
  id: '2026-11-10-owner-asap-engine-0440z',
  contains: 'de2e79762d5ec60b9b37792ed4e9acda83b25cab',
  playerNoticeAt: '2026-11-10T04:20:00Z',
  notBefore: '2026-11-10T04:40:00Z',
  notAfter: '2026-11-10T06:30:00Z',
  announcementPolicy: 'earliest-certified',
  supersedesPhase1Schedule: true,
  migrations: [],
};
/** The first-parent merge instant of that record on main. */
const MERGE_INSTANT = at('2026-11-10T04:43:28Z');

const HISTORICAL = {
  id: '2026-11-09-owner-asap-engine-1530z',
  playerNoticeAt: '2026-11-09T15:10:00Z',
  notBefore: '2026-11-09T15:30:00Z',
  notAfter: '2026-11-09T21:30:00Z',
};

test("tonight's exact bad record fails in its own booking pull request", () => {
  const failures = bookingRecordViolations(doc(), doc([TONIGHTS_BAD_RECORD]), MERGE_INSTANT);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /2026-11-10-owner-asap-engine-0440z/);
  assert.match(failures[0], /playerNoticeAt 2026-11-10T04:20:00Z is in the past/);
});

test('a good future-dated booking passes', () => {
  const now = at('2026-11-10T04:43:28Z');
  const good = {
    ...TONIGHTS_BAD_RECORD,
    id: '2026-11-10-owner-good-engine-0530z',
    playerNoticeAt: '2026-11-10T05:10:00Z',
    notBefore: '2026-11-10T05:30:00Z',
    notAfter: '2026-11-10T07:30:00Z',
  };
  assert.deepEqual(bookingRecordViolations(doc(), doc([good]), now), []);
});

test('an unchanged historical record is immutable history, never re-judged', () => {
  const base = doc([HISTORICAL]);
  const head = doc([
    { ...HISTORICAL },
    {
      ...TONIGHTS_BAD_RECORD,
      id: '2026-11-10-owner-next-engine-0600z',
      playerNoticeAt: '2026-11-10T05:40:00Z',
      notBefore: '2026-11-10T06:00:00Z',
      notAfter: '2026-11-10T08:00:00Z',
    },
  ]);
  const now = at('2026-11-10T04:50:00Z');
  assert.deepEqual(bookingRecordViolations(base, head, now), []);
  assert.deepEqual(
    bookedRecords(base, head).map(({ record }) => record.id),
    ['2026-11-10-owner-next-engine-0600z']
  );
  // Reordered fields are still the same record, not an edit.
  const reordered = doc([
    {
      notAfter: HISTORICAL.notAfter,
      id: HISTORICAL.id,
      notBefore: HISTORICAL.notBefore,
      playerNoticeAt: HISTORICAL.playerNoticeAt,
    },
  ]);
  assert.deepEqual(bookedRecords(doc([HISTORICAL]), reordered), []);
});

test('editing a historical record re-judges it as a new booking', () => {
  const edited = { ...HISTORICAL, notAfter: '2026-11-09T23:30:00Z' };
  const failures = bookingRecordViolations(
    doc([HISTORICAL]),
    doc([edited]),
    at('2026-11-10T04:50:00Z')
  );
  assert.ok(failures.length >= 1);
  assert.match(failures.join('\n'), /2026-11-09-owner-asap-engine-1530z/);
});

test('boundary: the tolerance window holds exactly', () => {
  const now = at('2026-11-10T05:00:00Z');
  const w = (playerNoticeAt, notBefore = '2026-11-10T05:40:00Z') => ({
    id: 'b',
    playerNoticeAt,
    notBefore,
    notAfter: '2026-11-10T07:40:00Z',
  });
  // Exactly TOLERANCE_MS in the past still passes: an in-flight PR must not flake.
  assert.equal(TOLERANCE_MS, 5 * 60 * 1000);
  assert.deepEqual(bookingRecordViolations(doc(), doc([w('2026-11-10T04:55:00.000Z')]), now), []);
  // One millisecond beyond the tolerance fails.
  const late = bookingRecordViolations(doc(), doc([w('2026-11-10T04:54:59.999Z')]), now);
  assert.equal(late.length, 1);
  assert.match(late[0], /playerNoticeAt .* is in the past at validation time/);
  // notBefore is held to the same clock.
  const pastStart = bookingRecordViolations(
    doc(),
    doc([
      {
        id: 'b',
        playerNoticeAt: '2026-11-10T05:10:00Z',
        notBefore: '2026-11-10T04:54:00Z',
        notAfter: '2026-11-10T07:40:00Z',
      },
    ]),
    now
  );
  assert.match(pastStart.join('\n'), /notBefore 2026-11-10T04:54:00Z is in the past/);
});

test('ordering: notBefore >= playerNoticeAt, notAfter > notBefore', () => {
  const now = at('2026-11-10T05:00:00Z');
  const backward = bookingRecordViolations(
    doc(),
    doc([
      {
        id: 'o',
        playerNoticeAt: '2026-11-10T06:00:00Z',
        notBefore: '2026-11-10T05:40:00Z',
        notAfter: '2026-11-10T07:40:00Z',
      },
    ]),
    now
  );
  assert.match(backward.join('\n'), /notBefore .* is before playerNoticeAt/);
  const sameInstant = bookingRecordViolations(
    doc(),
    doc([
      {
        id: 'o',
        playerNoticeAt: '2026-11-10T05:40:00Z',
        notBefore: '2026-11-10T05:40:00Z',
        notAfter: '2026-11-10T05:40:00Z',
      },
    ]),
    now
  );
  assert.deepEqual(sameInstant, [
    'o (windows): notAfter 2026-11-10T05:40:00Z must be after notBefore 2026-11-10T05:40:00Z',
  ]);
});

test('structure: missing or unparseable timestamps are refused, ids are required', () => {
  const now = at('2026-11-10T05:00:00Z');
  const missing = bookingRecordViolations(
    doc(),
    doc([{ id: 'm', notBefore: '2026-11-10T05:40:00Z', notAfter: '2026-11-10T07:40:00Z' }]),
    now
  );
  assert.deepEqual(missing, [
    'm (windows): playerNoticeAt is required and must be an ISO timestamp',
  ]);
  const garbage = bookingRecordViolations(
    doc(),
    doc([
      {
        id: 'g',
        playerNoticeAt: 'soon',
        notBefore: '2026-11-10T05:40:00Z',
        notAfter: '2026-11-10T07:40:00Z',
      },
    ]),
    now
  );
  assert.match(garbage.join('\n'), /playerNoticeAt is required/);
  const anonymous = bookingRecordViolations(
    doc(),
    doc([{ playerNoticeAt: '2026-11-10T05:40:00Z' }]),
    now
  );
  assert.deepEqual(anonymous, ['windows: every record needs a string id']);
});

test('databaseWindows are held to the same rule; certified recovery stays exempt', () => {
  const now = at('2026-11-10T05:00:00Z');
  const db = bookingRecordViolations(doc([], []), doc([], [TONIGHTS_BAD_RECORD]), MERGE_INSTANT);
  assert.equal(db.length, 1);
  assert.match(db[0], /databaseWindows/);
  const recovery = bookingRecordViolations(
    doc(),
    doc([{ id: 'r', certifiedRecoveryProfile: 'p' }]),
    now
  );
  assert.deepEqual(recovery, []);
});

test('the gate actually runs, with this test, in the required compilation job', () => {
  const ci = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const start = ci.indexOf('\n  typecheck_compile:\n');
  assert.ok(start !== -1);
  const rest = ci.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z0-9_-]+:\n/);
  const job = next === -1 ? rest : rest.slice(0, next + 1);
  const step = job.slice(
    job.indexOf('- name: Owner maintenance bookings are valid before they merge')
  );
  // Merge queue (2026-11-11): the step also reads a merge group's base.
  assert.ok(step.includes('CI_BASE_SHA: ${{ (github.event.pull_request.base.sha || github.event.merge_group.base_sha) }}'));
  assert.ok(step.includes('node --test tests/operations/owner-window-booking-gate.test.mjs'));
  assert.ok(step.includes('node scripts/ci/check-owner-window-booking.mjs'));
});

test('the after-merge backstop is untouched and still judges merged windows', async () => {
  const backstop = await import('../../scripts/ci/check-owner-window-notice-after-merge.mjs');
  // #10xxx's shape tonight: merged after its own notice instant - the backstop
  // still refuses it, exactly as before this gate existed.
  const failures = backstop.bookingViolations(
    { windows: [TONIGHTS_BAD_RECORD], databaseWindows: [] },
    () => MERGE_INSTANT,
    at('2026-11-10T05:00:00Z')
  );
  assert.equal(failures.length, 1);
  assert.match(failures[0], /is before the booking merged/);
  assert.equal(backstop.FILE, FILE);
});

// A historical finding is never a new authorization or a reason to rewrite
// consumed history. Only exact, expired base records are non-blocking for a PR.
test('PR admission retains expired history but refuses active, changed, missing-expiry and removed bad records', () => {
  const now = at('2026-11-10T06:00:00Z');
  const expired = { ...TONIGHTS_BAD_RECORD, notAfter: '2026-11-10T05:30:00Z' };
  const base = doc([expired]);
  assert.deepEqual(bookingAdmission(base, base, () => MERGE_INSTANT, now), {
    failures: [], historical: [assertionFinding(expired, now)],
  });
  const future = { ...expired, id: 'future-booking', playerNoticeAt: '2026-11-10T07:00:00Z',
    notBefore: '2026-11-10T07:20:00Z', notAfter: '2026-11-10T08:00:00Z' };
  const withFuture = bookingAdmission(base, doc([expired, future]),
    (id) => id === expired.id ? MERGE_INSTANT : null, now);
  assert.equal(withFuture.failures.length, 0);
  assert.equal(withFuture.historical.length, 1);
  const boundary = doc([{ ...expired, notAfter: new Date(now).toISOString() }]);
  assert.equal(bookingAdmission(boundary, boundary, () => MERGE_INSTANT, now - 1).failures.length, 1);
  assert.equal(bookingAdmission(boundary, boundary, () => MERGE_INSTANT, now).historical.length, 1);
  for (const change of [
    { ...expired, notAfter: '2026-11-10T07:00:00Z' },
    { ...expired, ownerOrder: 'different authority' },
    { ...expired, notAfter: undefined },
    { ...expired, id: 'new-booking' },
  ]) {
    const result = bookingAdmission(base, doc([change]), () => MERGE_INSTANT, now);
    assert.ok(result.failures.length, JSON.stringify(change));
  }
  const active = doc([{ ...expired, notAfter: '2026-11-10T07:00:00Z' }]);
  assert.ok(bookingAdmission(active, active, () => MERGE_INSTANT, now).failures.length);
  const missing = doc([{ ...expired, notAfter: undefined }]);
  assert.ok(bookingAdmission(missing, missing, () => MERGE_INSTANT, now).failures.length);
  assert.match(bookingAdmission(base, doc(), () => MERGE_INSTANT, now).failures.join(), /retain.*historical/);
  const db = doc([], [expired]);
  assert.equal(bookingAdmission(db, db, () => MERGE_INSTANT, now).historical.length, 1);
  assert.throws(() => bookingAdmission(base, doc([expired, expired]), () => MERGE_INSTANT, now), /Duplicate/);
  assert.throws(() => bookingAdmission(base, { windows: {} }, () => MERGE_INSTANT, now), /Invalid/);
});

function assertionFinding(record, now) {
  // Independent exact historical witness from the original backstop contract.
  return `${record.id}: playerNoticeAt ${record.playerNoticeAt} is before the booking merged (${new Date(MERGE_INSTANT).toISOString()}); book a later notice and notBefore`;
}

test('actual CLI uses the explicit Git base, keeps full audit strict, and fails closed on unreadable history', () => {
  const dir = mkdtempSync(join(tmpdir(), 'booking-admission-'));
  const script = 'scripts/ci/check-owner-window-notice-after-merge.mjs';
  try {
    mkdirSync(join(dir, 'scripts/ci'), { recursive: true });
    mkdirSync(join(dir, 'server/release'), { recursive: true });
    for (const name of ['check-owner-window-notice-after-merge.mjs', 'check-owner-window-booking.mjs']) {
      writeFileSync(join(dir, 'scripts/ci', name), readFileSync(new URL(`../../scripts/ci/${name}`, import.meta.url)));
    }
    const expired = { ...TONIGHTS_BAD_RECORD, notAfter: '2026-11-10T05:30:00Z' };
    const source = JSON.stringify(doc([expired]));
    const file = join(dir, FILE);
    writeFileSync(file, source);
    const git = (...args) => {
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: {
        ...process.env, GIT_AUTHOR_DATE: '2026-11-10T04:43:28Z', GIT_COMMITTER_DATE: '2026-11-10T04:43:28Z',
      } });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    git('init', '-q'); git('add', '.');
    git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'original booking');
    const base = git('rev-parse', 'HEAD');
    git('update-ref', 'refs/remotes/origin/main', base);
    const cli = (explicitBase) => {
      const env = { ...process.env };
      delete env.CI_BASE_SHA;
      if (explicitBase !== undefined) env.CI_BASE_SHA = explicitBase;
      return spawnSync(process.execPath, [script], { cwd: dir, env, encoding: 'utf8' });
    };
    const scoped = cli(base);
    assert.equal(scoped.status, 0, scoped.stderr);
    assert.match(scoped.stderr, /HISTORICAL VIOLATION.*unchanged and expired/);
    assert.match(scoped.stderr, /04:43:28/);
    assert.equal(readFileSync(file, 'utf8'), source, 'the validator never rewrites history');
    const audit = cli();
    assert.equal(audit.status, 1);
    assert.match(audit.stderr, /is before the booking merged/);
    writeFileSync(file, JSON.stringify(doc([{ ...expired, ownerOrder: 'retargeted' }])));
    assert.equal(cli(base).status, 1, 'editing an expired bad record is still refused');
    writeFileSync(file, source);
    const unknown = cli('missing-base');
    assert.notEqual(unknown.status, 0, 'unreadable base is not an empty/clean history');
    writeFileSync(file, '{');
    assert.notEqual(cli(base).status, 0, 'unparseable source refuses admission');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
