import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync, chmodSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { inputFingerprint, reusableEvidence, readProviderEvidence, operationTransition, updateOperation,
  failureDisposition, summarizeMetrics, executionPlan } from '../../scripts/ci/agent-execution.mjs';
const temporary = fn => { const p = mkdtempSync(join(tmpdir(), 'execution-')); try { fn(p); } finally { rmSync(p, { recursive: true }); } };
const spec = { inputs: ['fixture'], command: ['node', 'test.mjs'], runtime: 'node22', environment: 'isolated-pg17', schema: 'v1' };
test('reuse fingerprint binds nested dependencies, fixture additions, permissions and configuration', () => temporary(root => {
  mkdirSync(join(root, 'fixture'));
  writeFileSync(join(root, 'fixture/input.sql'), 'select 1;');
  const before = inputFingerprint(root, spec);
  chmodSync(join(root, 'fixture/input.sql'), 0o755);
  assert.notEqual(inputFingerprint(root, spec), before);
  chmodSync(join(root, 'fixture/input.sql'), 0o644);
  symlinkSync(join(root, 'fixture'), join(root, 'alias'));
  assert.throws(() => inputFingerprint(root, { ...spec, inputs: ['alias/input.sql'] }));
  for (const key of ['runtime', 'environment', 'schema'])
    assert.notEqual(inputFingerprint(root, { ...spec, [key]: 'changed' }), before);
  assert.notEqual(inputFingerprint(root, { ...spec, command: ['node', 'other.mjs'] }), before);
  writeFileSync(join(root, 'fixture/guard.sql'), 'raise exception;');
  assert.notEqual(inputFingerprint(root, spec), before);
  assert.throws(() => inputFingerprint(root, { ...spec, inputs: ['../outside'] }));
  assert.throws(() => inputFingerprint(root, { ...spec, inputs: ['missing'] }));
}));
test('failed cancelled unknown and untrusted evidence cannot suppress a check', () => {
  const expected = { fingerprint: 'f', check: 'accounting', authority: 'github', environment: 'pg17', repository: 'r', workflow: 'ci', check: 'accounting' };
  const receipt = { version: 1, ...expected, status: 'passed', exitCode: 0, runId: 1, head: 'sha', attempt: 1,
    startedAt: '2026-11-06T04:00:00Z', finishedAt: '2026-11-06T04:01:00Z' };
  const observation = { conclusion: 'success', runId: 1, head: 'sha', attempt: 1, repository: 'r', workflow: 'ci', check: 'accounting' };
  assert.equal(reusableEvidence(receipt, expected, observation).reusable, true);
  for (const status of ['failed', 'cancelled', 'unknown', 'pending'])
    assert.equal(reusableEvidence({ ...receipt, status }, expected, observation).reusable, false);
  assert.equal(reusableEvidence(receipt, expected).reusable, false);
  assert.equal(reusableEvidence(receipt, { ...expected, fingerprint: 'changed' }, observation).reusable, false);
  assert.equal(reusableEvidence(receipt, expected, { ...observation, attempt: 2 }).reusable, false);
});
test('operation owner and sequence prevent duplicate start and unknown retry', () => temporary(root => {
  const event = { owner: 'chat-a', id: 'client/sha', action: 'claim' };
  let op = updateOperation(root, event);
  assert.throws(() => updateOperation(root, { ...event, owner: 'chat-b', sequence: 0, action: 'start' }));
  op = updateOperation(root, { ...event, sequence: 0, action: 'start' });
  assert.throws(() => updateOperation(root, { ...event, sequence: 0, action: 'start' }));
  op = updateOperation(root, { ...event, sequence: 1, action: 'interrupted' });
  assert.throws(() => operationTransition(op, { ...event, sequence: 2, action: 'retry' }));
  assert.throws(() => operationTransition(op, { ...event, sequence: 2, action: 'observed_success' }));
  op = updateOperation(root, { ...event, sequence: 2, action: 'observed_success', source: 'provider/run/1' });
  assert.equal(op.status, 'succeeded');
  assert.equal(JSON.parse(readFileSync(join(root, 'operation.json'))).status, 'succeeded');
}));
test('unknown acknowledgement always requires readback; measurement remains unknown', () => {
  assert.equal(failureDisposition({ outcome: 'timeout', sideEffect: false, source: 'provider' }).retry, false);
  assert.equal(failureDisposition({ outcome: 'test_failure', source: 'test' }).retry, false);
  assert.equal(summarizeMetrics([{ type: 'build' }]).tokens, null);
});
test('preview preserves legacy gates and reports clean/dirty independently', () => temporary(root => {
  execFileSync('git', ['init', '-q', root]);
  const plan = executionPlan({ root, classification: { complete: true, flags: { server: true }, paths: ['supabase/migrations/a.sql'] } });
  assert.equal(plan.mode, 'shadow');
  assert.equal(executionPlan({ root, classification: { complete: false, flags: { server: true } } }).engineActivationRequired, null);
  assert.equal(plan.checks.find(c => c.id === 'accounting-postgres').selected, true);
  assert.equal(plan.engineActivationRequired, false);
  assert.deepEqual(plan.components, ['database']);
}));
test('pre-push signal handlers retain nonzero exit in EXIT receipt', () => {
  const hook = readFileSync(new URL('../../.husky/pre-push', import.meta.url), 'utf8');
  const traps = hook.match(/^trap 'exit (?:129|130|143)' (?:HUP|INT|TERM)$/gm);
  assert.equal(traps?.length, 3);
  for (const [signal, code] of [['HUP',129], ['INT',130], ['TERM',143]]) {
    const script = `trap 'rc=$?; printf "%s" "$rc"' EXIT\n${traps.join('\n')}\nkill -${signal} $$\n`;
    try { execFileSync('bash', ['-c', script]); assert.fail('signal passed'); }
    catch (error) { assert.equal(error.status, code); assert.equal(error.stdout.toString(), String(code)); }
  }
});

test('execution CLI exposes bounded explicit operations and rejects unknown requests', () => temporary(root => {
  const input = join(root, 'input.json');
  writeFileSync(input, JSON.stringify({ outcome: 'timeout', source: 'provider' }));
  const cli = new URL('../../scripts/ci/agent-execution-cli.mjs', import.meta.url).pathname;
  const result = JSON.parse(execFileSync(process.execPath, [cli, 'failure', input], { encoding: 'utf8' }));
  assert.deepEqual(result, { action: 'readback', retry: false });
  assert.throws(() => execFileSync(process.execPath, [cli, 'release', input], { stdio: 'pipe' }));
}));

test('hosted evidence is read from authenticated run and exact job, never supplied JSON', () => {
  const expected = { repository: 'org/repo', workflow: '.github/workflows/ci.yml', check: 'accounting (1)' };
  const receipt = { runId: 12, jobId: 34, attempt: 2, head: 'a'.repeat(40) };
  const run = { id: 12, head_sha: receipt.head, run_attempt: 2, repository: { full_name: 'org/repo' }, path: expected.workflow };
  const job = { id: 34, run_id: 12, head_sha: receipt.head, run_attempt: 2, name: expected.check, status: 'completed', conclusion: 'success' };
  const read = path => path.includes('/runs/') ? run : job;
  assert.equal(readProviderEvidence(expected, receipt, read).conclusion, 'success');
  assert.throws(() => readProviderEvidence({ ...expected, check: 'unrelated' }, receipt, read));
  assert.throws(() => readProviderEvidence(expected, { ...receipt, attempt: 3 }, read));
  assert.throws(() => readProviderEvidence(expected, receipt, () => { throw Error('403'); }));
});
