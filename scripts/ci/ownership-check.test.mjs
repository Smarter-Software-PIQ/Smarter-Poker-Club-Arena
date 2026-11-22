// scripts/ci/ownership-check.mjs and ops/ownership.json (Dan, 2026-11-19).
// Fixtures only; no network. Run: node --test scripts/ci/ownership-check.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import {
  loadOwnershipMap,
  validateOwnershipMap,
  ownerOfPath,
  ownerOfFunction,
  functionsDefinedIn,
  declaredLane,
  evaluate,
  renderComment,
  pathPatternToRegExp,
  COMMENT_MARKER,
  currentDescription,
} from './ownership-check.mjs';

const map = loadOwnershipMap();

test('the map is valid and every lane cites documents that exist', () => {
  validateOwnershipMap(map);
  for (const [id, lane] of Object.entries(map.lanes)) {
    for (const source of lane.sources) assert.ok(existsSync(source), `${id} cites ${source}, which does not exist`);
  }
  assert.ok(map.areas.some((a) => a.locked && a.lane === 'release-custody'), 'release controls are a locked area');
});

test('every lane owns at least one area, and no locked area is empty', () => {
  for (const id of Object.keys(map.lanes)) assert.ok(map.areas.some((a) => a.lane === id), `${id} owns nothing`);
  for (const a of map.areas.filter((x) => x.locked)) assert.ok(a.paths.length + a.functions.length > 0);
});

test('path patterns: ** crosses directories, * does not', () => {
  assert.ok(pathPatternToRegExp('server/release/**').test('server/release/a/b.json'));
  assert.ok(pathPatternToRegExp('docs/horse-*').test('docs/horse-brain.md'));
  assert.ok(!pathPatternToRegExp('docs/horse-*').test('docs/horse-x/y.md'));
  assert.ok(pathPatternToRegExp('.github/workflows/a-*-is-paged.yml').test('.github/workflows/a-stalled-solver-round-is-paged.yml'));
});

test('owners: the incident function, release controls, the client and an unowned file', () => {
  assert.equal(ownerOfFunction(map, 'fn_ca_alarm_drill').lane, 'alarms-and-watches');
  assert.equal(ownerOfFunction(map, 'FN_SP_DIGEST_ENGINE_CUTOVER').lane, 'daily-digest');
  assert.equal(ownerOfFunction(map, 'fn_ca_promo_daily_digest').lane, 'daily-digest');
  assert.equal(ownerOfFunction(map, 'fn_ca_hand_gap_watch').lane, 'alarms-and-watches');
  assert.equal(ownerOfFunction(map, 'fn_ca_engine_release_stall_check').lane, 'release-custody');
  assert.equal(ownerOfFunction(map, 'fn_union_weekly_rakeback_close').lane, 'money-and-accounting');
  assert.equal(ownerOfPath(map, 'server/release/engine-release.json').locked, true);
  assert.equal(ownerOfPath(map, '.github/workflows/auto-deploy-hetzner.yml').lane, 'release-custody');
  assert.equal(ownerOfPath(map, 'src/pages/Lobby.tsx').lane, 'club-arena-client');
  assert.equal(ownerOfPath(map, 'server/src/engine/HorseLogic.ts').lane, 'horse-brain');
  assert.equal(ownerOfPath(map, 'server/src/engine/ServerTableEngineTurns.ts').lane, 'table-engine');
  assert.equal(ownerOfPath(map, 'README.md'), null);
});

test('functionsDefinedIn reads create, replace and drop, ignores comments, strips schema and quotes', () => {
  const sql = `
    -- create or replace function public.not_this() is only a comment
    /* create function also_not_this() */
    CREATE OR REPLACE FUNCTION public.fn_ca_alarm_drill(p int) RETURNS void AS $$ begin end $$ LANGUAGE plpgsql;
    create function "smarter_private"."Fn_Quoted"() returns int as $$ select 1 $$ language sql;
    DROP FUNCTION IF EXISTS public.fn_old_thing(int);
    create or replace function fn_ca_alarm_drill(p text) returns void as $$ begin end $$ language plpgsql;`;
  assert.deepEqual(functionsDefinedIn(sql), ['fn_ca_alarm_drill', 'fn_old_thing', 'fn_quoted']);
});

test('declaredLane reads a Lane line in plain, bold or bulleted form', () => {
  assert.equal(declaredLane('Fixes x\n\nLane: alarms-and-watches\n'), 'alarms-and-watches');
  assert.equal(declaredLane('**Lane:** `daily-digest`'), 'daily-digest');
  assert.equal(declaredLane('- Lane: release-custody'), 'release-custody');
  assert.equal(declaredLane('Plane: no'), null);
  assert.equal(declaredLane(''), null);
});

test('three PRs rewriting fn_ca_alarm_drill: each is told about the others (the 2026-11-19 incident)', () => {
  const r = evaluate({
    map,
    files: [{ path: 'supabase/migrations/20261119231718_drill_records_its_run_again.sql' }],
    functions: ['fn_ca_alarm_drill'],
    body: 'Lane: alarms-and-watches',
    otherPrs: [
      { number: 11426, title: 'cron drill', functions: ['fn_ca_alarm_drill'] },
      { number: 11500, title: 'other', functions: ['fn_unrelated'] },
      { number: 11501, title: 'third agent', functions: ['fn_ca_alarm_drill', 'fn_x'] },
    ],
  });
  const overlap = r.findings.filter((f) => f.kind === 'open-pr-function');
  assert.equal(overlap.length, 1);
  assert.match(overlap[0].message, /#11426 \(cron drill\), #11501 \(third agent\)/);
  assert.ok(!overlap[0].message.includes('#11500'));
  assert.equal(r.locked, false);
});

test('a function owned by another lane is a warning naming both lanes', () => {
  const r = evaluate({ map, files: [{ path: 'src/pages/Lobby.tsx' }], functions: ['fn_ca_alarm_drill'], body: '' });
  assert.equal(r.inferred, 'club-arena-client');
  const f = r.findings.find((x) => x.kind === 'foreign-function');
  assert.match(f.message, /owned by lane `alarms-and-watches` \(this pull request's lane: `club-arena-client`\)/);
  assert.equal(r.locked, false);
});

test('a path owned by another lane is a warning, grouped per lane', () => {
  const r = evaluate({
    map,
    files: [{ path: 'src/a.tsx' }, { path: 'src/b.tsx' }, { path: 'server/src/lightning/x.ts' }],
    functions: [],
    body: '',
  });
  assert.equal(r.lane, 'club-arena-client');
  const f = r.findings.filter((x) => x.kind === 'foreign-path');
  assert.equal(f.length, 1);
  assert.equal(f[0].lane, 'lightning');
});

test('a locked area fails without its lane declared and passes with it', () => {
  const files = [{ path: 'server/release/engine-release.json' }, { path: 'src/x.tsx' }];
  const without = evaluate({ map, files, functions: [], body: 'Lane: club-arena-client' });
  assert.equal(without.locked, true);
  assert.ok(without.findings.some((f) => f.kind === 'locked-path'));
  // Inferring the lane from the paths is never enough to unlock.
  const inferredOnly = evaluate({ map, files: [{ path: 'server/release/a.json' }, { path: 'server/release/b.json' }], functions: [], body: '' });
  assert.equal(inferredOnly.locked, true);
  const declared = evaluate({ map, files, functions: [], body: 'Lane: release-custody' });
  assert.equal(declared.locked, false);
  assert.ok(declared.findings.some((f) => f.kind === 'foreign-path' && f.lane === 'club-arena-client'));
});

test('a locked database function fails without its lane', () => {
  const r = evaluate({ map, files: [], functions: ['fn_ca_release_freeze_refuses_mgmt_api_ddl'], body: '' });
  assert.equal(r.locked, true);
});

test('an unknown declared lane is a warning and falls back to the inferred lane', () => {
  const r = evaluate({ map, files: [{ path: 'src/x.tsx' }], functions: [], body: 'Lane: nonsense-lane' });
  assert.ok(r.findings.some((f) => f.kind === 'unknown-lane'));
  assert.equal(r.lane, 'club-arena-client');
});

test('the comment carries its marker, every finding, and says warnings do not block', () => {
  const r = evaluate({ map, files: [{ path: 'src/x.tsx' }], functions: ['fn_ca_alarm_drill'], body: '' });
  const body = renderComment({ result: r, headSha: 'abcdef0123456789' });
  assert.ok(body.startsWith(COMMENT_MARKER));
  assert.match(body, /Warning: Redefines database function `fn_ca_alarm_drill`/);
  assert.match(body, /Warnings do not block the merge/);
  assert.match(body, /abcdef012345/);
});

test('the workflow runs the check on every pull request event that can change its answer', () => {
  const wf = readFileSync('.github/workflows/ownership-map.yml', 'utf8');
  for (const t of ['opened', 'synchronize', 'reopened', 'edited', 'ready_for_review']) assert.ok(wf.includes(t), t);
  assert.match(wf, /node --test scripts\/ci\/ownership-check\.test\.mjs/);
  assert.match(wf, /node scripts\/ci\/ownership-check\.mjs/);
  assert.match(wf, /pull-requests: write/);
  assert.ok(!/\bschedule:/.test(wf), 'no timer');
});

test('a re-run reads the description as it is now, not the replayed event payload (booking #11640, 2026-11-21)', async () => {
  const stale = 'Books ONE no-notice owner engine window.';
  const live = 'Lane: release-custody\n\nBooks ONE no-notice owner engine window.';
  const body = await currentDescription({ payload: stale, read: async () => ({ body: live }) });
  assert.equal(body, live);
  assert.equal(declaredLane(body), 'release-custody');
  // An explicit --body (local use) still wins; an empty live description is empty, not the stale one.
  assert.equal(await currentDescription({ explicit: 'x', payload: stale, read: async () => ({ body: live }) }), 'x');
  assert.equal(await currentDescription({ payload: stale, read: async () => ({ body: null }) }), '');
  // A failed read falls back to the payload and says so.
  const said = [];
  const fallback = await currentDescription({
    payload: stale,
    read: async () => {
      throw new Error('503');
    },
    log: (l) => said.push(l),
  });
  assert.equal(fallback, stale);
  assert.match(said.join('\n'), /could not read the live description/);
});
