import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import {
  observeFixtureKernelRefusals,
  observeFixtureDiscoverySocket,
  readFixtureKernelRefusals,
} from './main-inspector-kernel-diagnostic.mjs';

const maintained = readFileSync(
  new URL('../../server/scripts/main-inspector-socket-qualification.mjs', import.meta.url),
  'utf8'
);
function load(scenario, fs = {}) {
  const observed = observeFixtureKernelRefusals(maintained, scenario);
  const messages = [];
  const capture = new Function(
    'inspectorFs',
    'process',
    observed
      .replace("import * as inspectorFs from 'node:fs';", '')
      .replace(
        'export function captureMainInspectorBinding',
        'function captureMainInspectorBinding'
      )
      .replace(
        'export function mainInspectorKernelFailureReason',
        'function mainInspectorKernelFailureReason'
      ) + '\nreturn captureMainInspectorBinding;'
  )({ ...fs, writeSync: (_, message) => messages.push(message) }, { pid: 999 });
  return { capture, messages };
}
test('invalid entry retains the exact public refusal and emits only a closed predicate tag', () => {
  const { capture, messages } = load('direct-success');
  assert.throws(() => capture({ pid: 0 }), { message: 'main_inspector_socket_unproved' });
  assert.deepEqual(messages, ['fixture-kernel-diagnostic:direct-success:reason-input_unproved\n']);
});
test('native syscall detail is reduced to an allowed code without exporting its path', () => {
  const error = Object.assign(new Error('/private/native/path'), { code: 'ENOENT' });
  const { capture, messages } = load('host-success', {
    readdirSync: () => {
      throw error;
    },
  });
  assert.throws(() => capture({ pid: 1, deadlineMs: Date.now() + 10000 }), {
    message: 'main_inspector_socket_unproved',
  });
  assert.deepEqual(messages, [
    'fixture-kernel-diagnostic:host-success:reason-metadata_disappeared\n',
  ]);
  assert.equal(messages.join('').includes('/private'), false);
});
test('unknown scenarios and changed predicate shapes are refused before instrumentation', () => {
  assert.throws(() => observeFixtureKernelRefusals(maintained, 'production'));
  assert.throws(() =>
    observeFixtureKernelRefusals(
      maintained.replace("const inspectorSocketRefusal = (reason = 'input_unproved') => {", ''),
      'direct-success'
    )
  );
});

test('only maintained closed reason tags from the exact isolated scenario are retained', () => {
  const allowed = 'fixture-kernel-diagnostic:direct-success:reason-clients_before_grant';
  const stderr = [
    allowed,
    'fixture-kernel-diagnostic:direct-success:reason-/private/native/path',
    'fixture-kernel-diagnostic:host-success:reason-clients_before_grant',
    'fixture-kernel-diagnostic:direct-success:reason-invented_reason',
  ].join('\n');
  assert.equal(readFixtureKernelRefusals(maintained, stderr, 'direct-success'), allowed);
});

test('client-refusal diagnostics expose only bounded closed states and exact tuple equality', () => {
  const observed = observeFixtureKernelRefusals(maintained, 'direct-deferred-close-timeout');
  const messages = [];
  const sandbox = {};
  const rows = new Function(
    'inspectorFs',
    'globalThis',
    observed
      .replace("import * as inspectorFs from 'node:fs';", '')
      .replace(
        'export function captureMainInspectorBinding',
        'function captureMainInspectorBinding'
      )
      .replace(
        'export function mainInspectorKernelFailureReason',
        'function mainInspectorKernelFailureReason'
      ) + '\nreturn fixtureDiscoveryRows;'
  )({ writeSync: (_, message) => messages.push(message) }, sandbox);
  const local = '0100007F:ABCD',
    remote = '0100007F:240D';
  sandbox[Symbol.for('fixture.main-inspector.discovery-tuple')] = { local, remote };
  rows([
    { family: 'tcp', local, remote, state: '04', inode: 'secret-inode' },
    { family: 'tcp', local: remote, remote: local, state: '08' },
    { family: 'tcp', local: 'different', remote, state: '01' },
    { family: 'tcp', local, remote, state: 'PRIVATE' },
  ]);
  assert.deepEqual(messages, [
    'fixture-kernel-diagnostic:direct-deferred-close-timeout:tcp-state-fin_wait_1-discovery-yes\n',
    'fixture-kernel-diagnostic:direct-deferred-close-timeout:tcp-state-close_wait-discovery-yes\n',
    'fixture-kernel-diagnostic:direct-deferred-close-timeout:tcp-state-established-discovery-no\n',
    'fixture-kernel-diagnostic:direct-deferred-close-timeout:tcp-state-unknown-discovery-yes\n',
  ]);
  assert.ok(!/ABCD|240D|secret-inode|different|PRIVATE/.test(messages.join('')));
  messages.length = 0;
  delete sandbox[Symbol.for('fixture.main-inspector.discovery-tuple')];
  rows(Array.from({ length: 20 }, () => ({ state: '09' })));
  assert.equal(messages.length, 8);
  assert.ok(messages.every((m) => m.endsWith('tcp-state-last_ack-discovery-unknown\n')));
});

test('discovery observation records the connected tuple without changing the close boundary', async () => {
  const entry = readFileSync(
    new URL('../../server/scripts/main-inspector-retirement-entry.mjs', import.meta.url),
    'utf8'
  );
  const observed = observeFixtureDiscoverySocket(entry);
  const fragment = observed.slice(
    observed.indexOf('async function retirementDiscover()'),
    observed.indexOf('async function retirementEntry()')
  );
  const socket = new EventEmitter();
  Object.assign(socket, {
    localAddress: '127.0.0.1',
    remoteAddress: '127.0.0.1',
    localPort: 43981,
    remotePort: 9229,
    setTimeout: () => {},
    write: () => {},
    end: () => {},
    destroy: () => {},
  });
  const sandbox = {};
  const discover = new Function(
    'retirementNet',
    'retirementRemaining',
    'globalThis',
    fragment + '\nreturn retirementDiscover;'
  )(
    {
      createConnection: () => socket,
    },
    () => 10000,
    sandbox
  );
  let settled = false;
  const pending = discover().then((v) => {
    settled = true;
    return v;
  });
  socket.emit('connect');
  const endpoint = 'ws://127.0.0.1:9229/00000000-0000-4000-8000-000000000001';
  const body = JSON.stringify([{ webSocketDebuggerUrl: endpoint }]);
  socket.emit(
    'data',
    Buffer.from(`HTTP/1.0 200 OK\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
  );
  await Promise.resolve();
  assert.equal(settled, false);
  socket.emit('end');
  await Promise.resolve();
  assert.equal(settled, false);
  socket.emit('close', false);
  assert.equal(await pending, endpoint);
  assert.deepEqual(sandbox[Symbol.for('fixture.main-inspector.discovery-tuple')], {
    local: '0100007F:ABCD',
    remote: '0100007F:240D',
  });
  assert.throws(() =>
    observeFixtureDiscoverySocket(entry.replace("socket.once('connect'", "socket.once('unknown'"))
  );
});

test('closed TCP diagnostics are preserved with the original twelve-tag bound', () => {
  const prefix = 'fixture-kernel-diagnostic:direct-success:';
  const allowed = prefix + 'tcp-state-close_wait-discovery-yes';
  const stderr = [
    allowed,
    prefix + 'tcp-state-PRIVATE-discovery-yes',
    prefix + 'tcp-state-close_wait-discovery-secret-tuple',
    ...Array.from({ length: 20 }, () => allowed),
  ].join('\n');
  const result = readFixtureKernelRefusals(maintained, stderr, 'direct-success').split(';');
  assert.equal(result.length, 12);
  assert.ok(result.every((line) => line === allowed));
});
