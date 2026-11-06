import { createHash } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { inputFingerprint, executionPlan } from '../../scripts/ci/agent-execution.mjs';
const temporary = fn => { const p = mkdtempSync(join(tmpdir(), 'execution-')); try { fn(p); } finally { rmSync(p, { recursive: true }); } };
test('preview preserves legacy gates and reports clean/dirty independently', () => temporary(root => {
  execFileSync('git', ['init', '-q', root], {
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
  });
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


test('normal required Node gate executes the preview for the actual checkout', () => {
  const output = execFileSync(process.execPath, ['scripts/ci/execution-preview.mjs'], {
    cwd: process.cwd(), env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.match(output, /Execution preview \(shadow\)/);
});

test('Club Arena consumes exact protected shared source instead of a private implementation', () => {
  const source = readFileSync(new URL('../../scripts/ci/vendor/agentExecution.mjs', import.meta.url));
  const receipt = JSON.parse(readFileSync(new URL('../../scripts/ci/vendor/agentExecution.source.json', import.meta.url)));
  assert.equal(receipt.repository, 'Smarter-Poker/commander-shared');
  assert.match(receipt.revision, /^[0-9a-f]{40}$/);
  assert.equal(createHash('sha256').update(source).digest('hex'), receipt.sha256);
  assert.equal(typeof inputFingerprint, 'function');
});
