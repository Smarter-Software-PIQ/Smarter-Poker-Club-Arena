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
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, unlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  bookedRecords,
  bookingRecordViolations,
  FILE,
  NOTICE_HEADROOM_MS,
  TOLERANCE_MS,
} from '../../scripts/ci/check-owner-window-booking.mjs';

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
    id: '2026-11-10-owner-good-engine-0535z',
    playerNoticeAt: '2026-11-10T05:15:00Z',
    notBefore: '2026-11-10T05:35:00Z',
    notAfter: '2026-11-10T07:35:00Z',
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
  // Exactly TOLERANCE_MS in the past is not yet "in the past"; since
  // 2026-11-15 such a notice is still refused, for lacking headroom.
  assert.equal(TOLERANCE_MS, 5 * 60 * 1000);
  const edge = bookingRecordViolations(doc(), doc([w('2026-11-10T04:55:00.000Z')]), now);
  assert.equal(edge.length, 1);
  assert.match(edge[0], /less than 30 minutes ahead of validation time/);
  // One millisecond beyond the tolerance is in the past (one finding, not two).
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

test('the notice must still be thirty minutes ahead when the booking is checked (2026-11-15)', () => {
  // #10959: checks passed with the 11:40Z notice inside the old tolerance,
  // then the pull request merged at 11:59:43Z, after its own notice.
  assert.equal(NOTICE_HEADROOM_MS, 30 * 60 * 1000);
  const record = (playerNoticeAt) => ({
    id: '2026-11-15-owner-offcycle-engine-1206z',
    playerNoticeAt,
    notBefore: '2026-11-15T12:06:00Z',
    notAfter: '2026-11-15T15:00:00Z',
  });
  const checkedAt = at('2026-11-15T11:40:00Z');
  const exact = bookingRecordViolations(doc(), doc([record('2026-11-15T11:40:00Z')]), checkedAt);
  assert.deepEqual(exact.length, 1);
  assert.match(exact[0], /less than 30 minutes ahead/);
  const now = at('2026-11-10T05:00:00Z');
  const w = (playerNoticeAt) => ({
    id: 'h',
    playerNoticeAt,
    notBefore: '2026-11-10T05:50:00Z',
    notAfter: '2026-11-10T07:50:00Z',
  });
  assert.deepEqual(bookingRecordViolations(doc(), doc([w('2026-11-10T05:30:00.000Z')]), now), []);
  const short = bookingRecordViolations(doc(), doc([w('2026-11-10T05:29:59.999Z')]), now);
  assert.equal(short.length, 1);
  assert.match(short[0], /h \(windows\): playerNoticeAt .* is less than 30 minutes ahead/);
  // An unchanged record is never re-judged, so consumed history is unaffected.
  const old = record('2026-11-15T11:40:00Z');
  assert.deepEqual(bookingRecordViolations(doc([old]), doc([{ ...old }]), now), []);
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

test('actual CLI requires a valid on-main public witness and fails closed on unknown history', () => {
  const dir = mkdtempSync(join(tmpdir(), 'booking-witness-cli-'));
  const script = 'scripts/ci/check-owner-window-notice-after-merge.mjs';
  const witnessPath = 'scripts/ci/owner-window-notice-witnesses.json';
  try {
    mkdirSync(join(dir, 'scripts/ci'), { recursive: true });
    mkdirSync(join(dir, 'server/release'), { recursive: true });
    writeFileSync(join(dir, script), readFileSync(new URL(`../../${script}`, import.meta.url)));
    const windows = JSON.parse(readFileSync(new URL(`../../${FILE}`, import.meta.url), 'utf8'));
    const record = windows.windows.find(w => w.id === '2026-11-15-owner-offcycle-engine-1206z');
    const witness = JSON.parse(readFileSync(new URL(`../../${witnessPath}`, import.meta.url), 'utf8'));
    assert.ok(record);
    const source = JSON.stringify(doc([record]));
    const file = join(dir, FILE);
    writeFileSync(file, source);
    const git = (...args) => {
      const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8', env: {
        ...process.env, GIT_AUTHOR_DATE: '2026-11-15T11:59:42Z', GIT_COMMITTER_DATE: '2026-11-15T11:59:42Z',
      } });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    git('init', '-q'); git('add', '.');
    git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'original consumed booking');
    const base = git('rev-parse', 'HEAD');
    git('update-ref', 'refs/remotes/origin/main', base);
    const cli = explicitBase => {
      const env = { ...process.env };
      delete env.CI_BASE_SHA;
      if (explicitBase !== undefined) env.CI_BASE_SHA = explicitBase;
      return spawnSync(process.execPath, [script], { cwd: dir, env, encoding: 'utf8' });
    };
    assert.equal(cli(base).status, 1, 'a consumed record alone is never proof');
    writeFileSync(join(dir, witnessPath), JSON.stringify(witness));
    const accepted = cli(base);
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.equal(cli().status, 0, 'full audit accepts the independently evidenced lead');
    assert.equal(readFileSync(file, 'utf8'), source, 'no original record is rewritten');
    const invalid = structuredClone(witness);
    invalid.witnesses[0].activatedAt = invalid.witnesses[0].publicNoticeAt;
    writeFileSync(join(dir, witnessPath), JSON.stringify(invalid));
    assert.equal(cli(base).status, 1, 'a zero-lead witness cannot excuse a violation');
    for (const field of ['publicNoticeAt', 'activatedAt']) {
      const unparseable = structuredClone(witness);
      unparseable.witnesses[0][field] = '2026-99-15T12:06:39Z';
      writeFileSync(join(dir, witnessPath), JSON.stringify(unparseable));
      const refused = cli(base);
      assert.equal(refused.status, 1, `${field} must not bypass lead comparisons through NaN`);
      assert.match(refused.stderr, /must be an ISO UTC timestamp/);
    }
    const fresh = structuredClone(witness);
    fresh.witnesses[0].windowId = 'new-window';
    writeFileSync(join(dir, witnessPath), JSON.stringify(fresh));
    writeFileSync(file, JSON.stringify(doc([{ ...record, id: 'new-window' }])));
    const newWindow = cli(base);
    assert.equal(newWindow.status, 1);
    assert.match(newWindow.stderr, /cannot excuse a window this change is booking/);
    writeFileSync(file, source);
    writeFileSync(join(dir, witnessPath), JSON.stringify(witness));
    assert.notEqual(cli('missing-base').status, 0, 'unreadable provenance refuses admission');
    unlinkSync(join(dir, witnessPath));
    assert.equal(cli().status, 1, 'removing the proof restores the full audit refusal');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
