import assert from 'node:assert/strict';
import test from 'node:test';
import { invocation, servingIdentity, pinOwner, epochReceipts, selectEpoch as select, promotionPlan, maintenanceRefusal,
  evaluatorArguments, hostTranscript, OUTCOMES, promotionRequest, PROMOTION_BUDGET_MS, EPOCH_PROTOCOL, epochProtocolPresent,
  epochAwareCommit, SERVING_GATE, servingGateCommit, runnerRevokes, requiredFamilies, expectedReceipts, recheckPlan,
  v3ServingAdmitted, RECHECK_CONTRACT } from './gto-v31-qualification.mjs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** Every commit in these fixtures carries the epoch protocol unless a test says otherwise. */
const selectEpoch = (args) => select({ epochAware: () => true, ...args });

const id = '2687c795-6014-543e-85fd-460f418da6c3';
const valid = { eventName: 'workflow_dispatch', ref: 'refs/heads/main', repository: 'Smarter-Poker/Smarter-Poker-Club-Arena', repositoryId: '1132369872', inputs: { dataset: id, operation: 'evaluate', reason: '' } };
const C1 = 'a'.repeat(40), C2 = 'b'.repeat(40), C3 = 'c'.repeat(40);
const E1 = '11111111-1111-4111-8111-111111111111', E2 = '22222222-2222-4222-8222-222222222222';
const FAMILIES = ['cash', 'spin', 'tourney_ev', 'tourney_icm'];
const receipts = (epoch, commit, verdict = 'tie') => ['paired_replay', 'league'].flatMap((kind) => FAMILIES.map((game_family) => ({
  kind, game_family, verdict, evaluation_epoch_id: epoch, evaluation_engine_commit: commit,
  metrics: { candidate_config: { evaluation_engine_commit: commit } } })));
const heldout = { kind: 'heldout', game_family: 'all', verdict: 'pass', evaluation_epoch_id: null, evaluation_engine_commit: null };
const epoch = (epoch_id, epoch_no, engine_commit, extra = {}) => ({ epoch_id, epoch_no, engine_commit, superseded_at: null,
  promoted_at: null, promoted_serving_commit: null, ...extra });
function ds({ state = 'evaluating', epochs = [], evaluations = [heldout] } = {}) {
  const current = epochs.find((e) => e.superseded_at === null) ?? null;
  return { dataset_id: id, dataset_checksum: 'f'.repeat(64), state, current_epoch: current, evaluation_epochs: epochs, evaluations };
}

test('only an explicit main dispatch with a canonical dataset can acquire the provider route', () => {
  assert.deepEqual(invocation(valid), { dataset: id, operation: 'evaluate', reason: null });
  assert.deepEqual(invocation({ ...valid, inputs: { dataset: id, operation: 'promote' } }), { dataset: id, operation: 'promote', reason: null });
  const reason = 'Serving engine advanced past the evaluated decision closure';
  assert.equal(invocation({ ...valid, inputs: { ...valid.inputs, reason } }).reason, reason);
  for (const bad of [{ eventName: 'push' }, { ref: 'refs/heads/other' }, { repository: 'other/fork' },
    { inputs: { ...valid.inputs, source_sha: 'a'.repeat(40) } }, { inputs: { dataset: `${id};echo injected`, operation: 'evaluate' } },
    { inputs: { dataset: [id], operation: 'evaluate' } }, { inputs: { dataset: id, operation: 'retry-loop' } },
    { inputs: { ...valid.inputs, reason: 'too short' } }, { inputs: { ...valid.inputs, reason: `${reason}\n$(id)` } },
    { inputs: { ...valid.inputs, reason: 'x'.repeat(501) } }]) assert.throws(() => invocation({ ...valid, ...bad }));
});

test('organization transfer retains immutable source authority', () => {
  assert.equal(invocation({ ...valid, repository: 'Smarter-Software-PIQ/Smarter-Poker-Club-Arena' }).dataset, id);
  for (const repositoryId of [undefined, '', '42']) assert.throws(() => invocation({ ...valid, repositoryId }));
});

test('serving source cannot come from a short SHA or unready decision workers', () => {
  const good = { status: 'ok', releaseSha: 'b'.repeat(40), liveHorseDecision: { phase: 'ready' } };
  assert.deepEqual(servingIdentity(good), { releaseSha: good.releaseSha });
  for (const bad of [{ releaseSha: 'b'.repeat(8) }, { releaseSha: [good.releaseSha] }, { status: 'degraded' }, { liveHorseDecision: { phase: 'starting' } }])
    assert.throws(() => servingIdentity({ ...good, ...bad }));
});

test('the current epoch owns the pin and every receipt is bound to its own epoch commit', () => {
  assert.equal(pinOwner(ds()), null);
  const e1 = epoch(E1, 1, C1, { superseded_at: 'then', superseded_by_epoch_no: 2 }), e2 = epoch(E2, 2, C2);
  const two = ds({ epochs: [e1, e2], evaluations: [heldout, ...receipts(E1, C1), ...receipts(E2, C2).slice(0, 3)] });
  assert.equal(pinOwner(two).engine_commit, C2);
  assert.equal(epochReceipts(two, e2).length, 3);
  for (const broken of [
    ds({ evaluations: [heldout, ...receipts(E1, C1)] }),
    ds({ epochs: [e1, e2], evaluations: [heldout, ...receipts(E2, C1)] }),
    ds({ epochs: [e2, epoch(E1, 1, C1)] }),
    ds({ epochs: [e1, epoch(E2, 2, C1)] }),
    ds({ epochs: [epoch(E1, 1, C1)], evaluations: [heldout, { ...receipts(E1, C1)[0], metrics: { candidate_config: { evaluation_engine_commit: C2 } } }] }),
  ]) assert.throws(() => pinOwner(broken));
});

test('evaluation resumes a compatible pin, and moves only through an audited new epoch', () => {
  const reason = 'Serving engine advanced past the evaluated decision closure';
  assert.deepEqual(selectEpoch({ dataset: ds(), servingSha: C1, reason: null }),
    { action: 'open-first', engineSha: C1, reason: `Initial evaluation epoch pinned to the serving engine ${C1}` });
  const open = ds({ epochs: [epoch(E1, 1, C1)], evaluations: [heldout, ...receipts(E1, C1).slice(0, 5)] });
  assert.deepEqual(selectEpoch({ dataset: open, servingSha: C2, compatibleWithServing: true, reason: null }),
    { action: 'resume', engineSha: C1, epochNo: 1 });
  assert.throws(() => selectEpoch({ dataset: open, servingSha: C2, compatibleWithServing: false, reason: null }), /audited reason/);
  assert.throws(() => selectEpoch({ dataset: open, servingSha: C2, reason }), /must be decided/);
  assert.deepEqual(selectEpoch({ dataset: open, servingSha: C2, compatibleWithServing: false, reason }),
    { action: 'open-next', engineSha: C2, reason });
  const candidate = { ...open, state: 'candidate', evaluations: [heldout, ...receipts(E1, C1)] };
  assert.equal(selectEpoch({ dataset: candidate, servingSha: C2, compatibleWithServing: false, reason }).action, 'open-next');
  const old = ds({ epochs: [epoch(E1, 1, C1, { superseded_at: 'then' }), epoch(E2, 2, C2)] });
  assert.throws(() => selectEpoch({ dataset: old, servingSha: C1, compatibleWithServing: false, reason }), /at most once/);
  assert.throws(() => selectEpoch({ dataset: { ...open, evaluations: [heldout, ...receipts(E1, C1, 'loss').slice(0, 1)] },
    servingSha: C2, compatibleWithServing: false, reason }), /lost/);
  for (const state of ['active', 'retired', 'rejected', 'building'])
    assert.throws(() => selectEpoch({ dataset: { ...open, state }, servingSha: C2, compatibleWithServing: true }));
  assert.throws(() => selectEpoch({ dataset: open, servingSha: 'b'.repeat(8), compatibleWithServing: true }));
  // A serving engine without the V31 closure entries is never pinned; protected main is.
  assert.deepEqual(selectEpoch({ dataset: ds(), servingSha: C1, servingComplete: false, controlSha: C3 }),
    { action: 'open-first', engineSha: C3, reason: `Initial evaluation epoch pinned to the protected control commit ${C3}` });
  assert.equal(selectEpoch({ dataset: open, servingSha: C2, servingComplete: false, controlSha: C3,
    compatibleWithServing: false, reason }).engineSha, C3);
  assert.throws(() => selectEpoch({ dataset: open, servingSha: C2, servingComplete: false, controlSha: C1,
    compatibleWithServing: false, reason }), /at most once/);
});

test('promotion admits only the eight passing receipts of exactly the evaluated epoch', () => {
  const e1 = epoch(E1, 1, C1, { superseded_at: 'then' }), e2 = epoch(E2, 2, C2);
  const candidate = ds({ state: 'candidate', epochs: [e1, e2], evaluations: [heldout, ...receipts(E1, C1), ...receipts(E2, C2)] });
  assert.equal(promotionPlan(candidate, id).mode, 'promote');
  assert.equal(promotionPlan(candidate, id).epoch.engine_commit, C2);
  const two = receipts(E2, C2);
  for (const evaluations of [[heldout, ...receipts(E1, C1), ...two.slice(1)], [...receipts(E1, C1), ...two],
    [heldout, ...two.slice(1), two[1]], [heldout, ...two.map((r, i) => (i ? r : { ...r, verdict: 'loss' }))]])
    assert.throws(() => promotionPlan({ ...candidate, evaluations }, id));
  for (const changed of [{ state: 'evaluating' }, { dataset_id: 'other' }, { state: 'retired' }])
    assert.throws(() => promotionPlan({ ...candidate, ...changed }, id));
  const promoted = { ...e2, promoted_at: 'now', promoted_serving_commit: C3 };
  const active = { ...candidate, state: 'active', current_epoch: promoted, evaluation_epochs: [e1, promoted] };
  assert.equal(promotionPlan(active, id).mode, 'load-only');
  assert.throws(() => promotionPlan({ ...active, current_epoch: e2, evaluation_epochs: [e1, e2] }, id));
});

test('contract v3: promotion counts exactly the families the dataset is certified in', () => {
  const e1 = epoch(E1, 1, C1);
  const cashOnly = (evaluations, extra = {}) => ({
    ...ds({ state: 'candidate', epochs: [e1], evaluations }),
    evaluation_contract: 'gto_v31_candidate.v3', required_families: ['cash'], ...extra });
  const cash = receipts(E1, C1).filter((r) => r.game_family === 'cash');
  assert.deepEqual(requiredFamilies(cashOnly([heldout, ...cash])), ['cash']);
  assert.equal(expectedReceipts(cashOnly([heldout, ...cash])), 2);
  assert.equal(promotionPlan(cashOnly([heldout, ...cash]), id).mode, 'promote');
  // A v2 dataset (no contract field) still needs all eight.
  assert.deepEqual(requiredFamilies(ds()), FAMILIES);
  assert.equal(expectedReceipts(ds()), 8);
  assert.throws(() => promotionPlan(cashOnly([heldout, cash[0]]), id), /2 distinct passing/);
  assert.throws(() => promotionPlan(cashOnly([heldout, ...cash, receipts(E1, C1)[1]]), id), /2 distinct passing/);
  assert.throws(() => promotionPlan(cashOnly([heldout, cash[0], { ...cash[1], verdict: 'loss' }]), id));
  for (const required_families of [[], ['cash', 'cash'], ['poker'], undefined, 'cash'])
    assert.throws(() => promotionPlan(cashOnly([heldout, ...cash], { required_families }), id), /must report the families/);
});

test('the activation never starts where it could reach a maintenance boundary', () => {
  const at = (iso) => Date.parse(iso);
  assert.equal(PROMOTION_BUDGET_MS, 9 * 60_000);
  assert.equal(maintenanceRefusal(at('2026-11-02T15:10:00Z')), null);
  assert.equal(maintenanceRefusal(at('2026-11-02T15:40:59Z')), null);
  assert.equal(maintenanceRefusal(at('2026-11-02T15:41:00Z')), 'hourly-maintenance-boundary');
  assert.equal(maintenanceRefusal(at('2026-11-02T15:09:59Z')), 'hourly-maintenance-boundary');
  assert.equal(maintenanceRefusal(at('2026-11-02T15:55:00Z')), 'hourly-maintenance-boundary');
  assert.equal(maintenanceRefusal(at('2026-11-02T16:00:00Z')), 'hourly-maintenance-boundary');
  // Chicago 03:50-04:06 is inside the hourly boundary in both CST and CDT; the daily guard is still explicit.
  assert.equal(maintenanceRefusal(at('2026-11-02T09:55:00Z')), 'hourly-maintenance-boundary');
  assert.equal(maintenanceRefusal(at('2026-07-02T08:59:00Z'), 1000), 'hourly-maintenance-boundary');
  assert.equal(maintenanceRefusal(at('2026-11-02T09:30:00Z')), null);
  assert.throws(() => maintenanceRefusal(Number.NaN));
});

test('host outcomes are explicit, and a disagreeing transcript is never a success', () => {
  assert.equal(OUTCOMES[68].changed, true);
  assert.equal(OUTCOMES[68].rerun, true);
  assert.equal(OUTCOMES[66].changed, false);
  assert.equal(hostTranscript('V31_ATOMIC_OUTCOME refused-lock-busy\n', 75).outcome, 'refused-lock-or-boundary');
  assert.equal(hostTranscript('V31_ATOMIC_OUTCOME promoted-loaded-ready\n', 69).outcome, 'host-outcome-unknown');
  const t = hostTranscript('V31_ATOMIC_STAGE promote {"result":"promoted"}\nV31_ATOMIC_STAGE load not-json\nV31_ATOMIC_STAGE revoke {"result":"revoked"}\nV31_ATOMIC_STAGE clear {}\nV31_ATOMIC_OUTCOME rolled-back-empty\n', 68);
  assert.deepEqual([t.outcome, t.stages.promote[0].result, t.stages.load[0], t.stages.revoke[0].result, t.serving],
    ['rolled-back-empty', 'promoted', null, 'revoked', 'empty']);
  // Every outcome says what live workers can serve afterwards; none leaves a mix unreported.
  for (const [code, known] of Object.entries(OUTCOMES))
    assert.ok(['loaded', 'empty', 'unchanged', 'converging', 'unknown'].includes(known.serving), code);
  assert.equal(OUTCOMES[72].outcome, 'rollback-incomplete');
  assert.equal(OUTCOMES[71].rerun, false);
  assert.equal(OUTCOMES[67].serving, 'empty');
  assert.equal(OUTCOMES[70].serving, 'empty');
  assert.equal(OUTCOMES[73].serving, 'unknown');
  for (const outcome of ['rollback-incomplete', 'in-container-step-not-terminated', 'host-outcome-unknown'])
    assert.equal(runnerRevokes(outcome), true, outcome);
  for (const outcome of ['promoted-loaded-ready', 'rolled-back-empty', 'promoted-loaded-readiness-unproved', 'promoted-unbound'])
    assert.equal(runnerRevokes(outcome), false, outcome);
});

test('promotion requests and evaluator arguments carry no override or interpolation', () => {
  const p = { datasetId: '187815b1-3701-46c8-8514-93db3cdb6d07', checksum: 'f'.repeat(64), engineSha: C1, servingSha: C2,
    requestId: '2687c795-6014-4543-85fd-460f418da6c3', cellCount: 107, afterUtc: '2026-11-02T15:20:00.000Z',
    closureDigest: 'e'.repeat(64), boundBy: 'github-actions:repo:run-1-1:dan' };
  assert.deepEqual(promotionRequest(p), p);
  for (const bad of [{ engineSha: C1.slice(1) }, { servingSha: '0'.repeat(40) }, { cellCount: 0 }, { afterUtc: 'now' }, { requestId: 'x' },
    { closureDigest: undefined }, { closureDigest: '0'.repeat(64) }, { boundBy: 'a b' }, { boundBy: '' }])
    assert.throws(() => promotionRequest({ ...p, ...bad }));
  assert.deepEqual(evaluatorArguments(id, 'evaluate'), ['scripts/gto-v31-evaluate-worker.mjs', `--dataset=${id}`]);
  assert.throws(() => evaluatorArguments(id, 'promote'));
  assert.throws(() => evaluatorArguments('not-a-uuid', 'evaluate'));
});

test('an epoch is never spent on a commit whose evaluator predates epochs', () => {
  const reason = 'Serving engine advanced past the evaluated decision closure';
  const stale = (sha) => sha !== C2;
  assert.throws(() => select({ dataset: ds(), servingSha: C2, reason: null, epochAware: stale }), /predates the epoch-aware evaluator/);
  const open = ds({ epochs: [epoch(E1, 1, C1)], evaluations: [heldout] });
  assert.throws(() => select({ dataset: open, servingSha: C2, compatibleWithServing: false, reason, epochAware: stale }), /predates/);
  assert.throws(() => select({ dataset: open, servingSha: C2, compatibleWithServing: true, epochAware: () => false }), /predates/);
  assert.throws(() => select({ dataset: ds(), servingSha: C2 }), /protocol must be checked/);
  assert.equal(select({ dataset: ds(), servingSha: C1, epochAware: (sha) => sha === C1 }).engineSha, C1);
  const sources = Object.fromEntries(Object.entries(EPOCH_PROTOCOL).map(([p, marker]) => [p, `x\n${marker}\n`]));
  assert.equal(epochProtocolPresent(sources), true);
  for (const path of Object.keys(EPOCH_PROTOCOL))
    assert.equal(epochProtocolPresent({ ...sources, [path]: 'export const legacy = 1;' }), false, path);
});

test('the epoch protocol is read from the exact commit in a real git history', () => {
  const dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'v31-protocol-'));
  const git = (...args) => {
    const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))), GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' } });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  const write = (files) => { for (const [p, t] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), t); } };
  try {
    git('init', '-q', '-b', 'main');
    write(Object.fromEntries(Object.keys(EPOCH_PROTOCOL).map((p) => [p, 'legacy\n'])));
    git('add', '-A'); git('commit', '-q', '-m', 'legacy evaluator');
    const legacy = git('rev-parse', 'HEAD');
    write(Object.fromEntries(Object.entries(EPOCH_PROTOCOL).map(([p, marker]) => [p, `${marker}\n`])));
    git('add', '-A'); git('commit', '-q', '-m', 'epoch-aware evaluator');
    const aware = git('rev-parse', 'HEAD');
    assert.equal(epochAwareCommit(dir, legacy), false);
    assert.equal(epochAwareCommit(dir, aware), true);
    assert.equal(epochAwareCommit(dir, 'f'.repeat(40)), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('promotion refuses a serving engine whose live workers cannot refuse an unbound dataset', () => {
  const dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'v31-gate-'));
  const git = (...args) => {
    const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))), GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' } });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  const write = (files) => { for (const [p, t] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), t); } };
  try {
    git('init', '-q', '-b', 'main');
    write(Object.fromEntries(Object.keys(SERVING_GATE).map((p) => [p, 'ungated\n'])));
    git('add', '-A'); git('commit', '-q', '-m', 'ungated');
    const ungated = git('rev-parse', 'HEAD');
    write(Object.fromEntries(Object.entries(SERVING_GATE).map(([p, marker]) => [p, `${marker}\n`])));
    git('add', '-A'); git('commit', '-q', '-m', 'gated');
    const gated = git('rev-parse', 'HEAD');
    assert.equal(servingGateCommit(dir, ungated), false);
    assert.equal(servingGateCommit(dir, gated), true);
    for (const path of Object.keys(SERVING_GATE)) {
      write({ [path]: 'removed\n' }); git('add', '-A'); git('commit', '-q', '-m', `drop ${path}`);
      assert.equal(servingGateCommit(dir, git('rev-parse', 'HEAD')), false, path);
      write({ [path]: `${SERVING_GATE[path]}\n` }); git('add', '-A'); git('commit', '-q', '-m', `restore ${path}`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('strict re-check: dispatch admits recheck and the evaluator runs in --recheck mode', () => {
  assert.deepEqual(invocation({ ...valid, inputs: { dataset: id, operation: 'recheck' } }), { dataset: id, operation: 'recheck', reason: null });
  assert.deepEqual(evaluatorArguments(id, 'recheck'), ['scripts/gto-v31-evaluate-worker.mjs', `--dataset=${id}`, '--recheck']);
  assert.deepEqual(evaluatorArguments(id, 'evaluate'), ['scripts/gto-v31-evaluate-worker.mjs', `--dataset=${id}`]);
  assert.throws(() => evaluatorArguments(id, 'promote'));
});

test('strict re-check: only an execution-identical engine is re-checked, a retired playbook never', () => {
  const D1 = 'd'.repeat(64), D2 = 'e'.repeat(64);
  const anchor = { epoch_id: E1, engine_commit: C1, execution_digest: D1, replay_digest: 'f'.repeat(64) };
  const v3ds = { dataset_id: id, evaluation_contract: RECHECK_CONTRACT, state: 'active' };
  const rs = (rounds = [], anchors = [anchor]) => ({ dataset_id: id, recheck_epoch_id: E1, anchors, rounds });
  assert.equal(recheckPlan(v3ds, rs(), C2, D1).action, 'recheck');
  assert.equal(recheckPlan({ ...v3ds, state: 'candidate' }, rs(), C2, D1).action, 'recheck');
  assert.equal(recheckPlan(v3ds, rs(), C1, D2).action, 'certifying-engine');
  const passed = { round_id: E2, epoch_id: E1, serving_commit: C2, outcome: 'passed' };
  assert.equal(recheckPlan(v3ds, rs([passed]), C2, D1).action, 'already-passed');
  assert.equal(recheckPlan(v3ds, rs([{ ...passed, outcome: 'abandoned' }]), C2, D1).action, 'recheck');
  assert.throws(() => recheckPlan(v3ds, rs(), C2, D2), /full new certification/);
  assert.throws(() => recheckPlan(v3ds, rs([{ ...passed, serving_commit: C3, outcome: 'retired' }]), C2, D1), /retired for good/);
  assert.throws(() => recheckPlan(v3ds, rs([], []), C2, D1), /no execution anchor/);
  assert.throws(() => recheckPlan({ ...v3ds, evaluation_contract: 'gto_v31_candidate.v2' }, rs(), C2, D1), /contract v3/);
  assert.throws(() => recheckPlan({ ...v3ds, state: 'evaluating' }, rs(), C2, D1), /candidate or active/);
  assert.throws(() => recheckPlan(v3ds, { ...rs(), dataset_id: E2 }, C2, D1), /certified epoch/);
  assert.throws(() => recheckPlan(v3ds, rs(), 'x', D1), /serving engine/);
});

test('strict re-check: a v3 playbook is served by its certifying engine or a passed round only', () => {
  const anchor = { epoch_id: E1, engine_commit: C1, execution_digest: 'd'.repeat(64) };
  const rs = (rounds = []) => ({ dataset_id: id, recheck_epoch_id: E1, anchors: [anchor], rounds });
  assert.deepEqual(v3ServingAdmitted(rs(), E1, C1), { admitted: true, via: 'certifying-engine' });
  assert.equal(v3ServingAdmitted(rs(), E1, C2).admitted, false);
  assert.match(v3ServingAdmitted(rs(), E1, C2).reason, /recheck operation/);
  const passed = { round_id: E2, epoch_id: E1, serving_commit: C2, outcome: 'passed' };
  assert.deepEqual(v3ServingAdmitted(rs([passed]), E1, C2), { admitted: true, via: 'recheck', roundId: E2 });
  assert.equal(v3ServingAdmitted(rs([{ ...passed, epoch_id: E2 }]), E1, C2).admitted, false, 'a round of another epoch admits nothing');
  assert.equal(v3ServingAdmitted(rs([passed, { round_id: E1, epoch_id: E1, serving_commit: C3, outcome: 'retired' }]), E1, C2).admitted, false);
  assert.equal(v3ServingAdmitted({ anchors: [], rounds: [] }, E1, C1).admitted, false);
});
