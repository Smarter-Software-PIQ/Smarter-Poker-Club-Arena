import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { recheckDispatchPlan, busyDatasetsFromRuns, recheckDispatchBody, releaseEventAdmitted, RELEASE_WORKFLOW_PATH,
  RELEASE_WORKFLOW_NAME, RECHECK_WORKFLOW } from './gto-v31-recheck-dispatch.mjs';

const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const E1 = '33333333-3333-4333-8333-333333333333', E2 = '44444444-4444-4444-8444-444444444444';
const C1 = 'a'.repeat(40), S1 = 'b'.repeat(40), S2 = 'c'.repeat(40), D1 = 'd'.repeat(64), D2 = 'e'.repeat(64);
const V3 = 'gto_v31_candidate.v3';
const ds = (dataset_id, state = 'active', evaluation_contract = V3) => ({ dataset_id, state, evaluation_contract });
const st = (dataset_id, rounds = [], anchors = [{ epoch_id: E1, engine_commit: C1, execution_digest: D1 }], recheck_epoch_id = E1) =>
  ({ dataset_id, recheck_epoch_id, anchors, rounds });
const plan = (over = {}) => recheckDispatchPlan({ datasets: [ds(A)], statuses: { [A]: st(A) }, servingSha: S1,
  servingExecutionDigest: D1, busyDatasets: new Set(), ...over });

test('a new execution-identical serving engine gets exactly one re-check per playbook, active first', () => {
  assert.deepEqual(plan().dispatch, [{ dataset: A, state: 'active', servingSha: S1 }]);
  const two = plan({ datasets: [ds(B, 'candidate'), ds(A), ds(A)], statuses: { [A]: st(A), [B]: st(B) } });
  assert.deepEqual(two.dispatch.map((d) => d.dataset), [A, B]);
  // An open round from a crashed run is resumed, not left stranded.
  assert.equal(plan({ statuses: { [A]: st(A, [{ epoch_id: E1, serving_commit: S1, outcome: null }]) } }).dispatch.length, 1);
  // An abandoned round on this engine, or a pass on another engine, does not count as passed here.
  assert.equal(plan({ statuses: { [A]: st(A, [{ epoch_id: E1, serving_commit: S1, outcome: 'abandoned' },
    { epoch_id: E1, serving_commit: S2, outcome: 'passed' }]) } }).dispatch.length, 1);
});

test('nothing is dispatched today: no contract v3 playbook, or only v2 / not-yet-candidate datasets', () => {
  assert.deepEqual(plan({ datasets: [], statuses: {} }), { dispatch: [], skipped: [] });
  assert.deepEqual(plan({ datasets: [ds(A, 'active', 'gto_v31_candidate.v2'), ds(B, 'evaluating'), ds(B, 'retired')] }).dispatch, []);
});

test('never re-checks the certifying engine, a passed pair, a retired playbook or one without an anchor', () => {
  const why = (over) => plan(over).skipped.map((s) => s.reason);
  assert.deepEqual(why({ servingSha: C1 }), ['the serving engine is the certifying engine']);
  assert.deepEqual(why({ statuses: { [A]: st(A, [{ epoch_id: E1, serving_commit: S1, outcome: 'passed' }]) } }), ['the serving engine already passed']);
  assert.deepEqual(why({ statuses: { [A]: st(A, [{ epoch_id: E1, serving_commit: S2, outcome: 'retired' }]) } }), ['lost a re-check and is retired for good']);
  assert.deepEqual(why({ statuses: { [A]: st(A, [], []) } }), ['the certified epoch has no execution anchor']);
  assert.deepEqual(why({ statuses: { [A]: st(A, [], [{ epoch_id: E2, engine_commit: C1, execution_digest: D1 }]) } }), ['the certified epoch has no execution anchor']);
  assert.deepEqual(why({ statuses: {} }), ['no re-check status for the certified epoch']);
  assert.deepEqual(why({ statuses: { [A]: { ...st(A), dataset_id: B } } }), ['no re-check status for the certified epoch']);
});

test('a different execution fingerprint needs a full certification, not a re-check; an unknown one dispatches nothing', () => {
  assert.deepEqual(plan({ servingExecutionDigest: D2 }).dispatch, []);
  assert.match(plan({ servingExecutionDigest: D2 }).skipped[0].reason, /full new certification/);
  assert.match(plan({ servingExecutionDigest: null }).skipped[0].reason, /digest is unavailable/);
  assert.deepEqual(plan({ servingSha: null }), { dispatch: [], skipped: [{ dataset: null, reason: 'serving engine identity is unavailable' }] });
  assert.deepEqual(plan({ servingSha: '0'.repeat(40) }).dispatch, []);
});

test('idempotent: a queued or running qualification run for the dataset owns it', () => {
  const runs = [{ status: 'in_progress', display_title: `V31 qualification recheck ${A}` },
    { status: 'queued', display_title: `V31 qualification evaluate ${B}` },
    { status: 'completed', display_title: `V31 qualification recheck ${E1}` }];
  const busy = busyDatasetsFromRuns(runs);
  assert.deepEqual([...busy].sort(), [A, B]);
  assert.match(plan({ busyDatasets: busy }).skipped[0].reason, /already queued or running/);
  assert.equal(plan({ busyDatasets: [A] }).dispatch.length, 0);
  assert.deepEqual([...busyDatasetsFromRuns(null)], []);
});

test('the dispatch is exactly the recheck operation the qualification workflow admits', () => {
  assert.deepEqual(recheckDispatchBody(A, '42'), {
    ref: 'main',
    inputs: { dataset: A, operation: 'recheck', reason: '', dispatcher_run_id: '42' },
  });
  assert.throws(() => recheckDispatchBody('x', '42'));
  assert.throws(() => recheckDispatchBody(`${A};echo`, '42'));
  assert.throws(() => recheckDispatchBody(A));
  assert.throws(() => recheckDispatchBody(A, '0'));
  assert.throws(() => recheckDispatchBody(A, '42;x'));
});

test('every completed protected-main engine release of this repository starts a decision, whatever its verdict', () => {
  const ok = { eventName: 'workflow_run', repository: 'Smarter-Software-PIQ/Smarter-Poker-Club-Arena', repositoryId: '1132369872',
    // The payload shape of run 42413295909, the release that put 391f7bc0 in service:
    // its name is the run title, not the workflow's name.
    workflowRun: { name: 'Engine Release 391f7bc0d57c71637bd4af5181f70520661e3593',
      path: '.github/workflows/auto-deploy-hetzner.yml', conclusion: 'success', head_branch: 'main' } };
  assert.equal(releaseEventAdmitted(ok), true);
  // A run of the release workflow is admitted whatever its title (withdrawals and observations change nothing the decision does not re-read).
  for (const name of [RELEASE_WORKFLOW_NAME, 'Engine Withdrawal x', undefined])
    assert.equal(releaseEventAdmitted({ ...ok, workflowRun: { ...ok.workflowRun, name } }), true, String(name));
  // Run 42389189340 activated 40bc24676 and then failed a later job: the engine served anyway.
  for (const conclusion of ['failure', 'cancelled', 'timed_out'])
    assert.equal(releaseEventAdmitted({ ...ok, workflowRun: { ...ok.workflowRun, conclusion } }), true, conclusion);
  for (const bad of [{ eventName: 'push' }, { repository: 'someone/fork' }, { repositoryId: '1' },
    { workflowRun: { ...ok.workflowRun, head_branch: 'feature' } },
    { workflowRun: { ...ok.workflowRun, path: '.github/workflows/publish-club-arena.yml' } },
    { workflowRun: { ...ok.workflowRun, path: undefined } }])
    assert.equal(releaseEventAdmitted({ ...ok, ...bad }), false);
});

test('the workflow listens to the real release workflow, with no timer, and the dispatcher alone can dispatch', () => {
  const yml = readFileSync(new URL('../../.github/workflows/gto-v31-qualification.yml', import.meta.url), 'utf8');
  const release = readFileSync(new URL('../../.github/workflows/auto-deploy-hetzner.yml', import.meta.url), 'utf8');
  assert.ok(release.startsWith(`name: ${RELEASE_WORKFLOW_NAME}\n`), 'the listened-to name is the release workflow name');
  assert.equal(RELEASE_WORKFLOW_PATH, '.github/workflows/auto-deploy-hetzner.yml');
  assert.match(release, /^run-name: /m, 'release runs carry a per-run title, so admission cannot use the run name');
  assert.ok(yml.includes(`  workflow_run:\n    workflows: ['${RELEASE_WORKFLOW_NAME}']\n    types: [completed]\n`));
  assert.ok(!/^\s*schedule:/m.test(yml), 'no timer');
  const job = yml.slice(yml.indexOf('  recheck-after-release:'), yml.indexOf('  qualify:'));
  assert.doesNotMatch(job, /workflow_run\.conclusion/, 'the run verdict does not say whether the serving engine changed');
  assert.match(job, /github\.event\.workflow_run\.head_branch == 'main'/);
  assert.match(job, /actions: write/);
  assert.match(job, /node scripts\/ci\/gto-v31-recheck-dispatch\.mjs/);
  assert.equal((yml.match(/actions: write/g) ?? []).length, 1, 'only the dispatcher may dispatch');
  assert.match(yml, /contract:\n    name: V31 qualification admission contracts\n    if: github\.event_name != 'workflow_run'/);
  assert.ok(readFileSync(new URL(`../../.github/workflows/${RECHECK_WORKFLOW}`, import.meta.url), 'utf8') === yml, 'dispatch target is this workflow');
});
