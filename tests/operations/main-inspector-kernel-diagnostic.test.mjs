import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { observeFixtureKernelRefusals } from './main-inspector-kernel-diagnostic.mjs';

const maintained = readFileSync(new URL('../../server/scripts/main-inspector-socket-qualification.mjs', import.meta.url), 'utf8');
function load(scenario, fs = {}) {
  const observed = observeFixtureKernelRefusals(maintained, scenario);
  const messages = [];
  const capture = new Function('inspectorFs', 'process',
    observed.replace("import * as inspectorFs from 'node:fs';", '').replace('export const INSPECTOR_KERNEL_STEPS', 'const INSPECTOR_KERNEL_STEPS').replace('export function captureMainInspectorBinding', 'function captureMainInspectorBinding') + '\nreturn captureMainInspectorBinding;'
  )({ ...fs, writeSync: (_, message) => messages.push(message) }, { pid: 999 });
  return { capture, messages };
}
test('invalid entry retains the exact public refusal and emits only a closed predicate tag', () => {
  const { capture, messages } = load('direct-success');
  assert.throws(() => capture({ pid: 0 }), { message: 'main_inspector_socket_unproved' });
  assert.deepEqual(messages, ['fixture-kernel-diagnostic:direct-success:predicate-27\n']);
});
test('native syscall detail is reduced to an allowed code without exporting its path', () => {
  const error = Object.assign(new Error('/private/native/path'), { code: 'ENOENT' });
  const { capture, messages } = load('host-success', { readdirSync: () => { throw error; } });
  assert.throws(() => capture({ pid: 1, deadlineMs: Date.now() + 10000 }), { message: 'main_inspector_socket_unproved' });
  assert.deepEqual(messages, ['fixture-kernel-diagnostic:host-success:syscall-ENOENT\n', 'fixture-kernel-diagnostic:host-success:predicate-29\n']);
  assert.equal(messages.join('').includes('/private'), false);
});
test('unknown scenarios and changed predicate shapes are refused before instrumentation', () => {
  assert.throws(() => observeFixtureKernelRefusals(maintained, 'production'));
  assert.throws(() => observeFixtureKernelRefusals(maintained.replace('throw inspectorSocketRefusal();', ''), 'direct-success'));
});
