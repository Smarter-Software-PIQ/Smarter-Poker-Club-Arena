// Main freeze labelling and the read-only status helper (2026-11-19).
// Fixtures only: no network, no gh, no token. The GitHub transport is a fake.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  KNOWN_RULESET_ID,
  RULESET_NAME_MAX,
  VARIABLE_NAME,
  describeStatus,
  findWindow,
  freezeMain,
  freezeRulesetName,
  loadWindows,
  parseFreezeRulesetName,
  thawMain,
} from '../../scripts/ci/main-freeze.mjs';
import { formatStatus, run } from '../../scripts/ci/main-freeze-status.mjs';
import { decide, isGuarded } from '../../scripts/ci/release-freeze-scope.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const helper = path.join(root, 'scripts/ci/main-freeze-status.mjs');

const W1030 = {
  id: '2026-11-19-owner-no-notice-engine-1030z',
  notBefore: '2026-11-19T10:30:00Z',
  notAfter: '2026-11-19T16:20:00Z',
  contains: 'f3e99378ccbb0000000000000000000000000000',
};
const W1510 = {
  id: '2026-11-19-owner-no-notice-engine-1510z',
  notBefore: '2026-11-19T15:10:00Z',
  notAfter: '2026-11-19T21:00:00Z',
  contains: '7add8b42c83b8bc867b01b88bb52c9e31e1df55c',
};
const WNEXT = {
  id: '2026-11-20-owner-engine-0300z',
  notBefore: '2026-11-20T03:00:00Z',
  notAfter: '2026-11-20T05:00:00Z',
  contains: 'abcdef0123456789abcdef0123456789abcdef01',
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'main-freeze-'));
const windowsFile = path.join(tmp, 'windows.json');
fs.writeFileSync(
  windowsFile,
  JSON.stringify({ version: 1, windows: [W1030, W1510, WNEXT].map((w) => ({ ownerOrder: 'x', ...w })), databaseWindows: [] }),
);
const windows = loadWindows(windowsFile);
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// The shape of 27627940 as the custodian made it by hand on 2026-11-19.
const ruleset = (name, enforcement = 'active', extra = {}) => ({
  id: KNOWN_RULESET_ID,
  name,
  target: 'branch',
  enforcement,
  conditions: { ref_name: { include: ['refs/heads/main'], exclude: [] } },
  rules: [{ type: 'update' }, { type: 'non_fast_forward' }, { type: 'deletion' }],
  bypass_actors: [],
  ...extra,
});
const mainProtection = {
  id: 21163380,
  name: 'main protection',
  target: 'branch',
  enforcement: 'active',
  conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
  rules: [{ type: 'pull_request' }, { type: 'deletion' }],
};

test('the ruleset name states the window, its end and the release, and parses back', () => {
  const name = freezeRulesetName(W1510);
  assert.equal(name, 'RELEASE FREEZE until 2026-11-19T21:00Z (2026-11-19-owner-no-notice-engine-1510z) 7add8b42');
  assert.ok(name.startsWith('RELEASE FREEZE'), 'existing greps for the prefix keep matching');
  assert.deepEqual(parseFreezeRulesetName(name), {
    until: '2026-11-19T21:00:00.000Z',
    windowId: W1510.id,
    release: '7add8b42',
  });
  assert.equal(parseFreezeRulesetName('RELEASE FREEZE'), null);
  assert.equal(parseFreezeRulesetName('main protection'), null);
});

test('a long window id is truncated to fit the ruleset name and still resolves', () => {
  const long = { id: '2026-10-30-horse-host-retirement-receipt-recovery-next-55-and-a-much-longer-tail-x', notBefore: W1510.notBefore, notAfter: '2026-11-19T21:00:30Z', contains: null };
  const name = freezeRulesetName(long);
  assert.ok(name.length <= RULESET_NAME_MAX, `${name.length} chars`);
  const p = parseFreezeRulesetName(name);
  assert.equal(p.until, '2026-11-19T21:00:30.000Z', 'booked seconds are kept');
  assert.equal(findWindow([long, W1510], p.windowId).id, long.id);
});

test('a labelled freeze reports its window and end from the ruleset name', () => {
  const st = describeStatus({
    rulesets: [mainProtection, ruleset(freezeRulesetName(W1510))],
    variable: null,
    windows,
    now: '2026-11-19T17:48:00Z',
  });
  assert.equal(st.frozen, true);
  assert.equal(st.source, 'ruleset-name');
  assert.equal(st.windowId, W1510.id);
  assert.equal(st.until, '2026-11-19T21:00:00.000Z');
  assert.equal(st.release, '7add8b42');
  assert.equal(st.overdue, false);
  assert.equal(st.next.id, WNEXT.id);
  const text = formatStatus(st);
  assert.match(text, /^main: FROZEN/);
  assert.match(text, /until: {3}2026-11-19T21:00:00.000Z \(in 3h12m\)/);
  assert.match(text, /next booked window: 2026-11-20-owner-engine-0300z/);
});

test('the hand-made unlabelled freeze is bounded by the latest booked window covering now, marked inferred', () => {
  // 16:00Z: both 1030z (to 16:20) and 1510z (to 21:00) are open.
  const st = describeStatus({ rulesets: [mainProtection, ruleset('RELEASE FREEZE')], variable: null, windows, now: '2026-11-19T16:00:00Z' });
  assert.equal(st.source, 'booking-inferred');
  assert.equal(st.windowId, W1510.id);
  assert.equal(st.until, '2026-11-19T21:00:00.000Z');
  assert.equal(st.activeWindows.length, 2);
  assert.match(formatStatus(st), /INFERRED/);
});

test('an unlabelled ruleset falls back to the published variable', () => {
  const variable = JSON.stringify({ state: 'frozen', windowId: W1030.id, notAfter: W1030.notAfter, release: W1030.contains });
  const st = describeStatus({ rulesets: [ruleset('RELEASE FREEZE')], variable, windows, now: '2026-11-19T11:00:00Z' });
  assert.equal(st.source, 'variable');
  assert.equal(st.windowId, W1030.id);
  const lifted = describeStatus({ rulesets: [ruleset('RELEASE FREEZE')], variable: JSON.stringify({ state: 'lifted', notAfter: W1030.notAfter }), windows, now: '2026-11-19T11:00:00Z' });
  assert.equal(lifted.source, 'booking-inferred', 'a lifted variable is never read as a live end time');
});

test('a disabled freeze ruleset, or none, is OPEN; the next booking is still shown', () => {
  for (const rulesets of [[mainProtection], [mainProtection, ruleset('RELEASE FREEZE', 'disabled')]]) {
    const st = describeStatus({ rulesets, variable: null, windows, now: '2026-11-19T22:00:00Z' });
    assert.equal(st.frozen, false);
    assert.match(formatStatus(st), /^main: OPEN/);
    assert.match(formatStatus(st), /next booked window: 2026-11-20-owner-engine-0300z .* \(starts in 5h00m\)/);
  }
  const none = describeStatus({ rulesets: [], variable: null, windows, now: '2026-11-21T00:00:00Z' });
  assert.match(formatStatus(none), /next booked window: none booked/);
});

test('a freeze past its window is OVERDUE, and an unreadable ruleset list is UNKNOWN, never OPEN', () => {
  const st = describeStatus({ rulesets: [ruleset(freezeRulesetName(W1510))], variable: null, windows, now: '2026-11-19T21:30:00Z' });
  assert.equal(st.overdue, true);
  assert.match(formatStatus(st), /OVERDUE: the window ended 30m ago/);
  const unk = describeStatus({ rulesets: null, variable: null, windows, now: '2026-11-19T21:30:00Z' });
  assert.equal(unk.frozen, null);
  assert.match(formatStatus(unk), /^main: UNKNOWN/);
});

test('the CLI reads fixture files with no network and prints JSON', () => {
  const rf = path.join(tmp, 'rulesets.json');
  fs.writeFileSync(rf, JSON.stringify([mainProtection, ruleset(freezeRulesetName(W1510))]));
  const r = spawnSync(process.execPath, [helper, '--rulesets-file', rf, '--windows-file', windowsFile, '--now', '2026-11-19T17:00:00Z', '--json'], {
    encoding: 'utf8',
    env: { PATH: '/nonexistent' },
  });
  assert.equal(r.status, 0, r.stderr);
  const st = JSON.parse(r.stdout);
  assert.equal(st.frozen, true);
  assert.equal(st.windowId, W1510.id);
});

test('live mode reads list, details and the variable through gh, read-only', () => {
  const calls = [];
  const fake = (args) => {
    calls.push(args.join(' '));
    const route = args[args.length - 1];
    if (args.includes('-X')) throw new Error('status helper must not write');
    if (route.endsWith('/rulesets')) return { status: 0, stdout: JSON.stringify([{ id: KNOWN_RULESET_ID, target: 'branch', enforcement: 'active' }, { id: 5, target: 'branch', enforcement: 'disabled' }]) };
    if (route.endsWith(`/rulesets/${KNOWN_RULESET_ID}`)) return { status: 0, stdout: JSON.stringify(ruleset('RELEASE FREEZE')) };
    if (route.endsWith(`/variables/${VARIABLE_NAME}`)) return { status: 0, stdout: JSON.stringify({ value: JSON.stringify({ state: 'frozen', windowId: W1510.id, notAfter: W1510.notAfter, release: W1510.contains }) }) };
    return { status: 1, stdout: '', stderr: '404' };
  };
  let out = '';
  const code = run(['--windows-file', windowsFile, '--now', '2026-11-19T17:00:00Z'], { gh: fake, log: (s) => (out = s) });
  assert.equal(code, 0);
  assert.match(out, /window: {2}2026-11-19-owner-no-notice-engine-1510z \(from the MAIN_RELEASE_FREEZE variable\)/);
  assert.ok(!calls.some((c) => c.includes('/rulesets/5')), 'disabled rulesets are not fetched');
  const failing = () => ({ status: 1, stdout: '', stderr: 'HTTP 403' });
  assert.equal(run(['--windows-file', windowsFile], { gh: failing, log: () => {} }), 1);
});

function fakeGh(existing) {
  const writes = [];
  const gh = (args, input) => {
    const method = args[args.indexOf('-X') + 1];
    const route = args[args.indexOf('-X') + 2];
    if (method === 'GET' && route.endsWith('/rulesets')) return { status: 0, stdout: JSON.stringify(existing ? [{ id: KNOWN_RULESET_ID, name: 'RELEASE FREEZE' }] : []) };
    if (method === 'GET') return { status: 0, stdout: JSON.stringify(ruleset(freezeRulesetName(W1510))) };
    writes.push({ method, route, body: JSON.parse(input) });
    if (method === 'PATCH') return { status: 1, stdout: '', stderr: 'HTTP 404' };
    return { status: 0, stdout: JSON.stringify({ id: existing ? KNOWN_RULESET_ID : 999 }) };
  };
  return { gh, writes };
}

test('freezing never writes a ruleset; unbooked or ended windows are refused', () => {
  const { gh, writes } = fakeGh(true);
  const r = freezeMain({ gh, windows, windowId: W1510.id, now: '2026-11-19T15:10:00Z' });
  assert.equal(r.scoped, true);
  assert.ok(!writes.some((w) => w.route.includes('/rulesets')), 'main is never blocked');
  const v = JSON.parse(writes.find((w) => w.route.endsWith('/actions/variables')).body.value);
  assert.equal(v.state, 'frozen');
  assert.equal(v.scope, 'release-controls');
  assert.equal(v.windowId, W1510.id);
  assert.equal(v.notAfter, '2026-11-19T21:00:00.000Z');
  assert.equal(v.release, W1510.contains);
  assert.throws(() => freezeMain({ gh, windows, windowId: 'not-booked', now: '2026-11-19T15:10:00Z' }), /not booked/);
  assert.throws(() => freezeMain({ gh, windows, windowId: W1030.id, now: '2026-11-19T16:20:00Z' }), /must not outlive/);
});

test('thawing disables the same ruleset id, resets its name and marks the variable lifted', () => {
  const { gh, writes } = fakeGh(true);
  thawMain({ gh, windows, now: '2026-11-19T20:30:00Z' });
  const put = writes.find((w) => w.method === 'PUT');
  assert.equal(put.body.enforcement, 'disabled');
  assert.equal(put.body.name, 'RELEASE FREEZE');
  const v = JSON.parse(writes.find((w) => w.route.endsWith('/actions/variables')).body.value);
  assert.equal(v.state, 'lifted');
  assert.equal(v.windowId, W1510.id);
});

// ── Scoped freeze: only release inputs wait (owner, 2026-11-19) ─────────────

test('a published engine window reads back as open main with release inputs held, and ends on its own', () => {
  const variable = JSON.stringify({ state: 'frozen', scope: 'release-controls', windowId: W1510.id, notBefore: W1510.notBefore, notAfter: W1510.notAfter });
  const st = describeStatus({ rulesets: [], variable, windows, now: '2026-11-19T15:11:00Z' });
  assert.equal(st.frozen, true);
  assert.equal(st.scoped, true);
  assert.match(formatStatus(st), /^main: OPEN/);
  assert.equal(describeStatus({ rulesets: [], variable, windows, now: '2026-11-19T21:01:00Z' }).frozen, false);
});

test('a live release freeze admits client, docs, tests and engine source and holds release inputs', () => {
  const freezeRaw = JSON.stringify({ state: 'frozen', scope: 'release-controls', windowId: W1510.id, notBefore: W1510.notBefore, notAfter: W1510.notAfter });
  const now = '2026-11-19T16:00:00Z';
  for (const f of ['src/components/Table.tsx', 'public/x.png', 'docs/a.md', 'tests/a.test.ts', 'server/src/engine/Hand.ts', 'supabase/migrations/20261119_x.sql']) {
    assert.equal(isGuarded(f), false, f);
    assert.equal(decide({ freezeRaw, files: [f], now }).admitted, true, f);
  }
  for (const f of ['server/release/owner-maintenance-windows.json', 'server/standby/standby-engine.sh', 'server/scripts/engine-release-transaction.sh', '.github/workflows/auto-deploy-hetzner.yml']) {
    assert.equal(decide({ freezeRaw, files: ['src/a.tsx', f], now }).admitted, false, f);
  }
  assert.equal(decide({ freezeRaw, files: null, now }).admitted, false, 'an unreadable diff fails closed while frozen');
  assert.equal(decide({ freezeRaw: '', files: null, now }).admitted, true, 'no freeze admits everything');
  assert.equal(decide({ freezeRaw, files: ['server/release/x.json'], now: '2026-11-19T21:00:01Z' }).admitted, true, 'an ended window admits');
});

test('an active unsealed owner window holds release inputs even when MAIN_RELEASE_FREEZE is unset', () => {
  const now = '2026-11-19T16:00:00Z';
  const floor1510 = {
    schema: 'engine-release-activation-floor/v2-owner-window',
    ownerWindowId: W1510.id,
    activationAt: W1510.notBefore,
    expiresAt: W1510.notAfter,
  };
  for (const f of ['scripts/release/book-owner-engine-window.py', 'server/release/activation-floor.json', '.github/workflows/stage-engine-release.yml']) {
    const r = decide({ freezeRaw: '', windows, floor: floor1510, files: ['docs/a.md', f], now });
    assert.equal(r.admitted, false, f);
    assert.equal(r.source, 'owner-windows');
    assert.equal(r.windowId, W1510.id);
    assert.deepEqual(r.guarded, [f]);
  }
  assert.equal(decide({ freezeRaw: '', windows, floor: floor1510, files: ['src/components/Table.tsx', 'docs/a.md'], now }).admitted, true, 'non-guarded paths still merge');
  assert.equal(decide({ freezeRaw: '', windows, floor: floor1510, files: null, now }).admitted, false, 'unreadable diff fails closed');
  // Even before notBefore (e.g. right after booking merge on main), activation-floor holds release controls until expiresAt.
  assert.equal(decide({ freezeRaw: '', windows, floor: floor1510, files: ['scripts/release/book-owner-engine-window.py'], now: '2026-11-19T13:00:00Z' }).admitted, false);
});

test('a sealed, lifted, expired or replaced owner window admits release inputs', () => {
  const now = '2026-11-19T16:00:00Z';
  const floor1510 = {
    schema: 'engine-release-activation-floor/v2-owner-window',
    ownerWindowId: W1510.id,
    activationAt: W1510.notBefore,
    expiresAt: W1510.notAfter,
  };
  const guarded = ['scripts/release/resume-migration-installs.sh'];
  assert.equal(decide({ freezeRaw: '', windows, floor: floor1510, sealedWindowIds: [W1510.id], files: guarded, now }).admitted, true, 'sealed window admits');
  assert.equal(
    decide({ freezeRaw: JSON.stringify({ state: 'lifted', windowId: W1510.id, at: now }), windows, floor: floor1510, files: guarded, now }).admitted,
    true,
    'explicitly lifted window admits',
  );
  assert.equal(
    decide({ freezeRaw: JSON.stringify({ state: 'lifted', windowId: W1030.id, at: '2026-11-19T12:00:00Z' }), windows, floor: floor1510, files: guarded, now }).admitted,
    false,
    'lifting an earlier window does not clear a newer active window',
  );
  assert.equal(decide({ freezeRaw: '', windows, floor: floor1510, files: guarded, now: '2026-11-19T21:00:01Z' }).admitted, true, 'expired window admits');
  assert.equal(
    decide({ freezeRaw: '', windows, floor: { schema: 'engine-release-activation-floor/v1-daily' }, files: guarded, now }).admitted,
    true,
    'non-owner floor schema admits',
  );
  // Without floor, falls back to notBefore - 1h .. notAfter across windows.
  assert.equal(decide({ freezeRaw: '', windows, files: guarded, now: '2026-11-20T02:30:00Z' }).admitted, false, 'within 1h lead of WNEXT holds');
  assert.equal(decide({ freezeRaw: '', windows, files: guarded, now: '2026-11-20T01:30:00Z' }).admitted, true, 'more than 1h before WNEXT admits');
});

test('release-freeze-scope CLI detects an active booked window on disk when MAIN_RELEASE_FREEZE is unset', () => {
  const scopeScript = path.join(root, 'scripts/ci/release-freeze-scope.mjs');
  const floorFile = path.join(tmp, 'floor.json');
  const guardedFile = path.join(tmp, 'guarded-files.txt');
  const clientFile = path.join(tmp, 'client-files.txt');
  fs.writeFileSync(
    floorFile,
    JSON.stringify({
      schema: 'engine-release-activation-floor/v2-owner-window',
      ownerWindowId: W1510.id,
      activationAt: W1510.notBefore,
      expiresAt: W1510.notAfter,
    }),
  );
  fs.writeFileSync(guardedFile, 'scripts/release/book-owner-engine-window.py\n');
  fs.writeFileSync(clientFile, 'src/components/Table.tsx\n');
  const baseEnv = {
    PATH: process.env.PATH,
    MAIN_RELEASE_FREEZE: '',
    FREEZE_SCOPE_WINDOWS: windowsFile,
    FREEZE_SCOPE_FLOOR: floorFile,
    FREEZE_SCOPE_NOW: '2026-11-19T16:00:00Z',
    FREEZE_SCOPE_NO_NETWORK: '1',
  };
  const held = spawnSync(process.execPath, [scopeScript], { encoding: 'utf8', env: { ...baseEnv, FREEZE_SCOPE_FILES: guardedFile } });
  assert.equal(held.status, 1, held.stdout + held.stderr);
  assert.match(held.stdout, /HELD: active booked owner window 2026-11-19-owner-no-notice-engine-1510z/);
  const ok = spawnSync(process.execPath, [scopeScript], { encoding: 'utf8', env: { ...baseEnv, FREEZE_SCOPE_FILES: clientFile } });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /ADMITTED: active booked owner window 2026-11-19-owner-no-notice-engine-1510z/);
});
