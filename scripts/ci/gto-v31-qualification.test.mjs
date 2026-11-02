import assert from 'node:assert/strict';
import test from 'node:test';
import { invocation, servingIdentity, promotionReady, receiptSourceMatches, evaluatorArguments, receiptCommit, selectEngine,
  policyCompatible, POLICY_CONTRACT_PATHS, contractBlobs, servingCompatible, protectedCommit } from './gto-v31-qualification.mjs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const id = '2687c795-6014-543e-85fd-460f418da6c3';
const valid = { eventName: 'workflow_dispatch', ref: 'refs/heads/main', repository: 'Smarter-Poker/Smarter-Poker-Club-Arena', repositoryId: '1132369872', inputs: { dataset: id, operation: 'evaluate' } };

test('only an explicit main dispatch with a canonical dataset can acquire the provider route', () => {
  assert.deepEqual(invocation(valid), { dataset: id, operation: 'evaluate' });
  for (const bad of [{ eventName: 'push' }, { ref: 'refs/heads/other' }, { repository: 'other/fork' },
    { inputs: { ...valid.inputs, source_sha: 'a'.repeat(40) } }, { inputs: { dataset: `${id};echo injected`, operation: 'evaluate' } },
    { inputs: { dataset: [id], operation: 'evaluate' } }, { inputs: { dataset: id, operation: 'retry-loop' } }]) assert.throws(() => invocation({ ...valid, ...bad }));
});

test('serving source cannot come from a short SHA or unready decision workers', () => {
  const good = { status: 'ok', releaseSha: 'b'.repeat(40), liveHorseDecision: { phase: 'ready' } };
  assert.deepEqual(servingIdentity(good), { releaseSha: good.releaseSha });
  for (const bad of [{ releaseSha: 'b'.repeat(8) }, { releaseSha: [good.releaseSha] }, { status: 'degraded' }, { liveHorseDecision: { phase: 'starting' } }])
    assert.throws(() => servingIdentity({ ...good, ...bad }));
});

test('partial immutable receipts cannot silently resume against a different serving source', () => {
  const source = 'a'.repeat(40);
  receiptSourceMatches({ evaluations: [] }, source);
  receiptSourceMatches({ evaluations: [{ kind: 'heldout' }, { kind: 'league', metrics: { candidate_config: { evaluation_engine_commit: source } } }] }, source);
  for (const metrics of [undefined, { candidate_config: { evaluation_engine_commit: 'b'.repeat(40) } }])
    assert.throws(() => receiptSourceMatches({ evaluations: [{ kind: 'paired_replay', metrics }] }, source));
});

test('promotion admission refuses partial, losing, duplicated or different-dataset receipts', () => {
  const evaluations = ['paired_replay', 'league'].flatMap((kind) => ['cash', 'spin', 'tourney_ev', 'tourney_icm']
    .map((game_family) => ({ kind, game_family, verdict: 'tie' })));
  const candidate = { dataset_id: id, state: 'candidate', evaluations };
  promotionReady(candidate, id);
  for (const changed of [{ state: 'evaluating' }, { dataset_id: 'other' }, { evaluations: evaluations.slice(1) },
    { evaluations: [...evaluations.slice(1), evaluations[1]] }, { evaluations: evaluations.map((r, i) => i ? r : { ...r, verdict: 'loss' }) }])
    assert.throws(() => promotionReady({ ...candidate, ...changed }, id));
});

test('the finite worker CLI receives no source override, shell interpolation or environment-file argument', () => {
  assert.deepEqual(evaluatorArguments(id, 'evaluate'), ['scripts/gto-v31-evaluate-worker.mjs', `--dataset=${id}`]);
  assert.equal(evaluatorArguments(id, 'promote').at(-1), '--promote');
  assert.throws(() => evaluatorArguments('not-a-uuid', 'promote'));
});

test('organization transfer retains immutable source authority',()=>{assert.deepEqual(invocation({...valid,repository:'Smarter-Software-PIQ/Smarter-Poker-Club-Arena'}),{dataset:id,operation:'evaluate'});for(const repositoryId of [undefined,'','42'])assert.throws(()=>invocation({...valid,repositoryId}));});

const A = 'a'.repeat(40), B = 'b'.repeat(40), C = 'c'.repeat(40);
const receipt = (kind, commit) => ({ kind, metrics: { candidate_config: { evaluation_engine_commit: commit } } });

test('existing immutable receipts own the engine pin forever and never mix', () => {
  assert.equal(receiptCommit({ evaluations: [{ kind: 'heldout' }] }), null);
  assert.equal(receiptCommit({ evaluations: [receipt('league', A), receipt('paired_replay', A)] }), A);
  for (const evaluations of [[receipt('league', A), receipt('league', B)], [receipt('league', undefined)], [receipt('league', '0'.repeat(40))]])
    assert.throws(() => receiptCommit({ evaluations }));
  assert.deepEqual(selectEngine({ bound: A, servingSha: B, servingComplete: true, controlSha: C }), { engineSha: A, pin: 'existing-receipts' });
});

test('a fresh dataset pins the serving engine only when it carries the whole contract, else the protected control commit', () => {
  assert.deepEqual(selectEngine({ bound: null, servingSha: B, servingComplete: true, controlSha: C }), { engineSha: B, pin: 'serving-engine' });
  assert.deepEqual(selectEngine({ bound: null, servingSha: B, servingComplete: false, controlSha: C }), { engineSha: C, pin: 'protected-control' });
  for (const bad of [{ servingSha: 'b'.repeat(8) }, { controlSha: undefined }])
    assert.throws(() => selectEngine({ bound: null, servingSha: B, servingComplete: false, controlSha: C, ...bad }));
});

test('promotion compatibility is exact blob identity over every policy-contract path', () => {
  const blobs = Object.fromEntries(POLICY_CONTRACT_PATHS.map((path, i) => [path, String(i).padStart(40, '0')]));
  assert.equal(POLICY_CONTRACT_PATHS.length, 10);
  assert.equal(policyCompatible(blobs, { ...blobs }), true);
  assert.equal(policyCompatible(blobs, null), false);
  assert.equal(policyCompatible(null, blobs), false);
  const changed = { ...blobs, [POLICY_CONTRACT_PATHS[6]]: 'f'.repeat(40) };
  assert.equal(policyCompatible(blobs, changed), false);
  const missing = { ...blobs }; delete missing[POLICY_CONTRACT_PATHS[0]];
  assert.equal(policyCompatible(blobs, missing), false);
});

test('real history: production advancing keeps the pin; only an identical protected contract can promote', () => {
  const root = mkdtempSync(join(tmpdir(), 'v31-pin-'));
  try {
    const g = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
    g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
    const put = (path, body) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), body); };
    const commit = (message) => { g('add', '-A'); g('commit', '-q', '-m', message); return g('rev-parse', 'HEAD'); };
    put('server/src/engine/GtoBoardRelativeFeaturesV1.ts', 'v1'); put('server/src/engine/GtoBoardRelativeFeaturesV2.ts', 'v2');
    const legacy = commit('legacy engine without the contract');
    for (const path of POLICY_CONTRACT_PATHS) put(path, `contract ${path}`);
    const pinned = commit('contract lands');
    put('server/src/engine/Brain.ts', 'later brain change');
    const advanced = commit('production advances');
    put(POLICY_CONTRACT_PATHS[5], 'changed model');
    const incompatible = commit('contract changes');
    g('checkout', '-q', '-b', 'side', legacy); put('server/src/engine/Fork.ts', 'x');
    const unprotected = commit('unprotected');
    g('checkout', '-q', 'main');
    g('update-ref', 'refs/remotes/origin/main', 'main');
    assert.equal(contractBlobs(root, legacy), null);
    assert.ok(contractBlobs(root, pinned));
    assert.equal(servingCompatible(root, pinned, pinned), true);
    assert.equal(servingCompatible(root, pinned, advanced), true);
    assert.equal(servingCompatible(root, pinned, legacy), false);
    assert.equal(servingCompatible(root, pinned, incompatible), false);
    assert.equal(servingCompatible(root, pinned, unprotected), false);
    assert.throws(() => protectedCommit(root, unprotected));
    protectedCommit(root, advanced);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
