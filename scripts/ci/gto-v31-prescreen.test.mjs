import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DATABASE, EXIT, PRESCREEN_READ_RPCS, componentSeed, familySeed, guardedFetch, pairStages, pendingWork,
  prefixDecided, prescreenVerdict, requestAdmitted } from './gto-v31-prescreen.mjs';
import { plannedPinHolds } from './gto-v31-qualification.mjs';

const ID = '187815b1-3701-46c8-8514-93db3cdb6d07';
const PIN = 'a'.repeat(40), OTHER = 'b'.repeat(40);
const EPOCH = '11111111-1111-4111-8111-111111111111';
const run = (kind, family, table, hits, extra = {}) => ({ kind, family, table, run: 'main', pairs: 256, fullPairs: 25000,
  hands: 512, hits, illegal: 0, truncated: 0, mismatches: 0, cells: hits ? 1 : 0, ...extra });

test('only the four read-only RPCs on the canonical database are admitted', () => {
  for (const name of PRESCREEN_READ_RPCS) assert.equal(requestAdmitted(`${DATABASE}/rest/v1/rpc/${name}`, 'POST'), true, name);
  for (const [url, method] of [
    [`${DATABASE}/rest/v1/rpc/fn_gto_v31_record_evaluation`, 'POST'],
    [`${DATABASE}/rest/v1/rpc/fn_gto_v31_open_evaluation_epoch`, 'POST'],
    [`${DATABASE}/rest/v1/rpc/fn_gto_v31_mark_candidate`, 'POST'],
    [`${DATABASE}/rest/v1/rpc/fn_gto_v31_record_execution_anchor`, 'POST'],
    [`${DATABASE}/rest/v1/horse_league_results`, 'POST'],
    [`${DATABASE}/rest/v1/horse_league_results?select=id`, 'GET'],
    [`${DATABASE}/rest/v1/rpc/ca_gto_v31_certification_status`, 'DELETE'],
    [`${DATABASE}/rest/v1/rpc/ca_gto_v31_certification_status`, 'PATCH'],
    ['https://evil.example/rest/v1/rpc/ca_gto_v31_certification_status', 'POST'],
    [`${DATABASE}/rest/v1/rpc/ca_gto_v31_certification_status/../fn_gto_v31_record_evaluation`, 'POST'],
    ['not a url', 'GET'],
  ]) assert.equal(requestAdmitted(url, method), false, `${method} ${url}`);
});

test('the guarded fetch forwards a read and refuses a write before it leaves the runner', async () => {
  const sent = [];
  const refused = [];
  const fetch = guardedFetch(async (input) => { sent.push(String(input)); return new Response('[]'); }, refused);
  await fetch(`${DATABASE}/rest/v1/rpc/fn_gto_v31_evaluation_cells`, { method: 'POST' });
  await assert.rejects(fetch(`${DATABASE}/rest/v1/rpc/fn_gto_v31_record_evaluation`, { method: 'POST' }), /V31_PRESCREEN_REQUEST_REFUSED/);
  await assert.rejects(fetch(new Request(`${DATABASE}/rest/v1/horse_league_results`, { method: 'POST', body: '{}' })),
    /V31_PRESCREEN_REQUEST_REFUSED/);
  assert.deepEqual(sent, [`${DATABASE}/rest/v1/rpc/fn_gto_v31_evaluation_cells`]);
  assert.deepEqual(refused, ['POST /rest/v1/rpc/fn_gto_v31_record_evaluation', 'POST /rest/v1/horse_league_results']);
});

test('a refused request fails the pre-screen even when every component reached the playbook', () => {
  const v = prescreenVerdict({ dataset: ID, refused: ['POST /rest/v1/rpc/fn_gto_v31_record_evaluation'],
    screened: [{ kind: 'paired_replay', family: 'cash' }], runs: [run('paired_replay', 'cash', 'cash_ev', 9)] });
  assert.equal(v.ok, false);
  assert.equal(v.exitCode, EXIT.unscreened);
  assert.match(v.message, /outside its read-only allowlist/);
});

test('every component under the floor is named, with the reason, and the job exits 1', () => {
  const report = { dataset: ID, refused: [],
    screened: [{ kind: 'paired_replay', family: 'cash' }, { kind: 'paired_replay', family: 'spin' }, { kind: 'league', family: 'spin' }],
    runs: [
      run('paired_replay', 'cash', 'cash_ev', 7),
      run('paired_replay', 'spin', 'chip_ev', 0, { pairs: 2048, hands: 4096 }),
      run('paired_replay', 'spin', 'spin_ladder', 3),
      run('league', 'spin', 'chip_ev', 4),
      run('league', 'spin', 'chip_ev', 0, { run: 'memory_off', pairs: 2048, hands: 4096 }),
    ] };
  const v = prescreenVerdict(report);
  assert.equal(v.ok, false);
  assert.equal(v.exitCode, EXIT.refused);
  assert.deepEqual(v.failures.map((f) => f.component), ['paired_replay/spin chip_ev', 'league/spin chip_ev (memory-off run)']);
  assert.match(v.message, /REFUSED dataset 187815b1/);
  assert.match(v.message, /2 of 5 components/);
  assert.match(v.message, /paired_replay\/spin chip_ev: 0 playbook decisions in 4096 hands \(the first 2048 of its 25000 pairs; floor 1\)/);
  assert.match(v.message, /recorded no receipt and touched no epoch/);
  const whole = prescreenVerdict({ refused: [], screened: [{ kind: 'league', family: 'tourney_icm' }],
    runs: [run('league', 'tourney_icm', 'satellite', 0, { pairs: 1000, fullPairs: 1000, hands: 2000 })] });
  assert.match(whole.message, /satellite: 0 playbook decisions in 2000 hands \(all 1000 pairs; floor 1\)/);
  assert.doesNotMatch(v.message, /cash_ev/);
});

test('a small floor above one, illegal play, truncation and execution mismatches also refuse', () => {
  const screened = [{ kind: 'league', family: 'cash' }];
  assert.equal(prescreenVerdict({ refused: [], screened, runs: [run('league', 'cash', 'cash_ev', 2)] }, { floor: 3 }).exitCode, EXIT.refused);
  assert.equal(prescreenVerdict({ refused: [], screened, runs: [run('league', 'cash', 'cash_ev', 3)] }, { floor: 3 }).exitCode, EXIT.pass);
  for (const bad of [{ illegal: 1 }, { truncated: 2 }, { mismatches: 1 }]) {
    const v = prescreenVerdict({ refused: [], screened, runs: [run('league', 'cash', 'cash_ev', 40, bad)] });
    assert.equal(v.exitCode, EXIT.refused, JSON.stringify(bad));
    assert.match(v.failures[0].reasons.join(), /illegal|truncated|mismatches/);
  }
  assert.throws(() => prescreenVerdict({ refused: [], screened, runs: [] }, { floor: 0 }));
});

test('a clean screen passes; an errored, empty or partial report never passes silently', () => {
  const screened = [{ kind: 'paired_replay', family: 'cash' }];
  const pass = prescreenVerdict({ refused: [], screened, runs: [run('paired_replay', 'cash', 'cash_ev', 1)] });
  assert.deepEqual([pass.ok, pass.exitCode], [true, EXIT.pass]);
  assert.match(pass.message, /passed: all 1 components/);
  assert.equal(prescreenVerdict({ refused: [], screened: [], runs: [] }).exitCode, EXIT.pass, 'every family already recorded');
  for (const report of [null, undefined, { error: 'Legacy API keys are disabled' }]) {
    const v = prescreenVerdict(report);
    assert.deepEqual([v.ok, v.exitCode], [false, EXIT.unscreened]);
  }
  const partial = prescreenVerdict({ refused: [], screened: [...screened, { kind: 'league', family: 'cash' }],
    runs: [run('paired_replay', 'cash', 'cash_ev', 1)] });
  assert.deepEqual([partial.ok, partial.exitCode], [false, EXIT.unscreened]);
  assert.match(partial.message, /played no component of league\/cash/);
});

test('a silent component is played longer before it is refused, never past its own length', () => {
  assert.deepEqual(pairStages(256, 2048, 25000), [256, 2048]);
  assert.deepEqual(pairStages(256, 2048, 1000), [256, 1000]);
  assert.deepEqual(pairStages(256, 2048, 100), [100]);
  assert.deepEqual(pairStages(256, 256, 10000), [256]);
  assert.deepEqual(pairStages(10, 10000, 50000), [10, 80, 640, 5120, 10000]);
  for (const bad of [[0, 10, 10], [20, 10, 10], [1.5, 10, 10], [1, 10, 0]]) assert.throws(() => pairStages(...bad));
  assert.equal(prefixDecided({ hits: 1, illegal: 0, truncated: 0, mismatches: 0 }), true);
  assert.equal(prefixDecided({ hits: 0, illegal: 0, truncated: 0, mismatches: 0 }), false);
  assert.equal(prefixDecided({ hits: 0, illegal: 1, truncated: 0, mismatches: 0 }), true);
});

test('the pre-screen deals the evaluator\'s own seeds', () => {
  const checksum = 'f'.repeat(64);
  const evaluator = (c, k, f) => createHash('sha256').update(`${c}:${k}:${f}`).digest().readUInt32BE(0) || 1;
  assert.equal(familySeed(checksum, 'league', 'spin'), evaluator(checksum, 'league', 'spin'));
  assert.equal(componentSeed(123456789, 0), (123456789 ^ 0x9e3779b9) >>> 0);
  assert.equal(componentSeed(123456789, 2), (123456789 ^ (3 * 0x9e3779b9)) >>> 0);
  assert.throws(() => familySeed('nope', 'league', 'spin'));
  const src = readFileSync(new URL('../../server/src/scripts/gtoV31Evaluate.ts', import.meta.url), 'utf8');
  assert.ok(src.includes("createHash('sha256').update(`${checksum}:${kind}:${family}`).digest().readUInt32BE(0) || 1"),
    'the evaluator seed formula the pre-screen mirrors');
});

test('only a resumed epoch at the same pin skips recorded families; a new pin screens all of them', () => {
  const status = { current_epoch: { epoch_id: EPOCH, engine_commit: PIN },
    evaluations: [{ kind: 'paired_replay', game_family: 'cash', verdict: 'tie', evaluation_epoch_id: EPOCH },
      { kind: 'league', game_family: 'cash', verdict: 'win', evaluation_epoch_id: 'other' }] };
  const families = ['cash', 'spin'];
  const resumed = pendingWork(status, families, PIN);
  assert.deepEqual(resumed.work, [{ kind: 'paired_replay', family: 'spin' }, { kind: 'league', family: 'cash' }, { kind: 'league', family: 'spin' }]);
  assert.deepEqual(resumed.skipped, [{ kind: 'paired_replay', family: 'cash', verdict: 'tie' }]);
  assert.equal(pendingWork(status, families, OTHER).work.length, 4, 'a new epoch runs every family');
  assert.equal(pendingWork({ current_epoch: null, evaluations: [] }, families, PIN).work.length, 4, 'first epoch');
  assert.equal(pendingWork(status, families, PIN, { all: true }).work.length, 4);
});

test('resolve opens an epoch only for the commit the pre-screen screened', () => {
  const plan = { dataset: ID, operation: 'evaluate', releaseSha: PIN };
  assert.equal(plannedPinHolds(plan, ID, { engineSha: PIN }), true);
  assert.throws(() => plannedPinHolds(plan, ID, { engineSha: OTHER }), /pin moved .* nothing was opened/);
  assert.throws(() => plannedPinHolds(null, ID, { engineSha: PIN }), /pre-screen must run first/);
  assert.throws(() => plannedPinHolds({ ...plan, dataset: '2687c795-6014-543e-85fd-460f418da6c3' }, ID, { engineSha: PIN }));
  assert.throws(() => plannedPinHolds({ ...plan, operation: 'recheck' }, ID, { engineSha: PIN }));
});

test('the worker never loads the evaluator script and guards fetch before any runtime module', () => {
  const worker = readFileSync(new URL('./gto-v31-prescreen-worker.mjs', import.meta.url), 'utf8');
  const code = worker.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');
  for (const forbidden of ['gtoV31Evaluate', 'record_evaluation', 'open_evaluation_epoch', 'mark_candidate',
    'record_execution_anchor', 'horse_league_results', '.insert(', '.upsert(', '.update(', '.delete('])
    assert.ok(!code.includes(forbidden), forbidden);
  const guard = code.indexOf('globalThis.fetch = guardedFetch(');
  const firstRuntime = code.indexOf("await mod('");
  assert.ok(guard > 0 && firstRuntime > guard, 'fetch is guarded before the first runtime import');
});

test('the workflow plans, pre-screens, then opens the epoch and evaluates, in that order', () => {
  const yml = readFileSync(new URL('../../.github/workflows/gto-v31-qualification.yml', import.meta.url), 'utf8');
  const job = yml.slice(yml.indexOf('  qualify:'), yml.indexOf('  promote:'));
  const at = (s) => { const i = job.indexOf(s); assert.ok(i > 0, s); return i; };
  const order = [at('gto-v31-qualification.mjs plan'), at('ref: ${{ steps.plan.outputs.source_sha || steps.context.outputs.source_sha }}'),
    at('build-public-hist215-native.mjs'), at('node control/scripts/ci/gto-v31-prescreen.mjs'),
    at("Select or open the audited evaluation epoch at the pre-screened pin (evaluate)\n        if: inputs.operation == 'evaluate'"),
    at('gto-v31-qualification.mjs run')];
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  const prescreen = job.slice(at('node control/scripts/ci/gto-v31-prescreen.mjs') - 400, at('node control/scripts/ci/gto-v31-prescreen.mjs'));
  assert.match(prescreen, /if: inputs\.operation == 'evaluate' \|\| inputs\.operation == 'prescreen'\n        timeout-minutes: 30\n/);
  assert.match(prescreen, /EQUITY_GOVERNOR: 'off'/);
  assert.match(yml, /node --test scripts\/ci\/gto-v31-qualification\.test\.mjs scripts\/ci\/gto-v31-prescreen\.test\.mjs /);
  assert.ok(!/^\s*schedule:/m.test(yml), 'no timer');
});

test('a stand-alone prescreen plans and screens, then stops before any epoch, evaluation or promotion', () => {
  const yml = readFileSync(new URL('../../.github/workflows/gto-v31-qualification.yml', import.meta.url), 'utf8');
  assert.match(yml, /options: \[evaluate, promote, recheck, prescreen\]/);
  const job = yml.slice(yml.indexOf('  qualify:'), yml.indexOf('  promote:'));
  const step = (name) => { const i = job.indexOf(`- name: ${name}`); assert.ok(i > 0, name); return job.slice(i, job.indexOf('\n      - ', i + 1)); };
  assert.match(step('Plan the evaluation epoch pin'), /if: inputs\.operation == 'evaluate' \|\| inputs\.operation == 'prescreen'\n/);
  assert.match(step('Pre-screen every component'), /if: inputs\.operation == 'evaluate' \|\| inputs\.operation == 'prescreen'\n/);
  // Every step that can open an epoch or record a receipt is closed to prescreen.
  assert.match(step('Select or open the audited evaluation epoch'), /if: inputs\.operation == 'evaluate'\n/);
  assert.match(step('Prove the serving engine execution-identical'), /if: inputs\.operation == 'recheck'\n/);
  assert.match(step('Run the evaluator once'), /if: inputs\.operation == 'evaluate' \|\| inputs\.operation == 'recheck'\n/);
  const promote = yml.slice(yml.indexOf('  promote:'));
  assert.match(promote, /inputs\.operation == 'promote'/);
  assert.ok(!/prescreen/.test(promote.slice(0, promote.indexOf('steps:'))), 'promote is never admitted for prescreen');
  // The database identity is the repository secret.
  assert.match(step('Pre-screen every component'), /SUPABASE_SERVICE_ROLE_KEY: \$\{\{ secrets\.SUPABASE_SERVICE_ROLE_KEY \}\}/);
});
