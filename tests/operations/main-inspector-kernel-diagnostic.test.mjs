import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { observeFixtureKernelRefusals, observeFixtureDiscoverySocket } from './main-inspector-kernel-diagnostic.mjs';

const maintained = readFileSync(new URL('../../server/scripts/main-inspector-socket-qualification.mjs', import.meta.url), 'utf8');
function load(scenario, fs = {}) {
  const observed = observeFixtureKernelRefusals(maintained, scenario);
  const messages = [];
  const capture = new Function('inspectorFs', 'process',
    observed.replace("import * as inspectorFs from 'node:fs';", '').replace('export function captureMainInspectorBinding', 'function captureMainInspectorBinding') + '\nreturn captureMainInspectorBinding;'
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

test('predicate22 diagnostics expose only bounded closed states and exact tuple equality', () => {
  const observed = observeFixtureKernelRefusals(maintained, 'direct-deferred-close-timeout');
  const messages = [];
  const sandbox = {};
  const rows = new Function('inspectorFs', 'globalThis', observed.replace("import * as inspectorFs from 'node:fs';", '').replace('export function captureMainInspectorBinding', 'function captureMainInspectorBinding') + '\nreturn fixtureDiscoveryRows;')({writeSync: (_, message) => messages.push(message)}, sandbox);
  const local = '0100007F:ABCD', remote = '0100007F:240D';
  sandbox[Symbol.for('fixture.main-inspector.discovery-tuple')] = {local, remote};
  rows([{family:'tcp',local,remote,state:'04',inode:'secret-inode'}, {family:'tcp',local:remote,remote:local,state:'08'}, {family:'tcp',local:'different',remote,state:'01'}, {family:'tcp',local,remote,state:'PRIVATE'}]);
  assert.deepEqual(messages, [
    'fixture-kernel-diagnostic:direct-deferred-close-timeout:tcp-state-fin_wait_1-discovery-yes\n',
    'fixture-kernel-diagnostic:direct-deferred-close-timeout:tcp-state-close_wait-discovery-yes\n',
    'fixture-kernel-diagnostic:direct-deferred-close-timeout:tcp-state-established-discovery-no\n',
    'fixture-kernel-diagnostic:direct-deferred-close-timeout:tcp-state-unknown-discovery-yes\n',
  ]);
  assert.ok(!/ABCD|240D|secret-inode|different|PRIVATE/.test(messages.join('')));
  messages.length = 0;
  delete sandbox[Symbol.for('fixture.main-inspector.discovery-tuple')];
  rows(Array.from({length:20}, () => ({state:'09'})));
  assert.equal(messages.length, 8);
  assert.ok(messages.every(m => m.endsWith('tcp-state-last_ack-discovery-unknown\n')));
});

test('discovery observation records the connected tuple without changing the close boundary', async () => {
  const entry = readFileSync(new URL('../../server/scripts/main-inspector-retirement-entry.mjs', import.meta.url), 'utf8');
  const observed = observeFixtureDiscoverySocket(entry);
  const fragment = observed.slice(observed.indexOf('async function retirementDiscover()'), observed.indexOf('async function retirementEntry()'));
  const request = new EventEmitter(), socket = new EventEmitter(), response = new EventEmitter();
  Object.assign(socket, {localAddress:'127.0.0.1',remoteAddress:'127.0.0.1',localPort:43981,remotePort:9229});
  Object.assign(response, {statusCode:200,setEncoding:()=>{}});
  const sandbox = {};
  let callback;
  const discover = new Function('retirementHttp','retirementRemaining','globalThis', fragment + '\nreturn retirementDiscover;')({get:(_options,cb)=>{callback=cb;return request;}},()=>10000,sandbox);
  let settled = false;
  const pending = discover().then(v => {settled=true;return v;});
  request.emit('socket',socket);
  socket.emit('connect');
  callback(response);
  const endpoint='ws://127.0.0.1:9229/00000000-0000-4000-8000-000000000001';
  response.emit('data',JSON.stringify([{webSocketDebuggerUrl:endpoint}]));
  response.emit('end');
  await Promise.resolve();
  assert.equal(settled,false);
  socket.emit('close');
  assert.equal(await pending,endpoint);
  assert.deepEqual(sandbox[Symbol.for('fixture.main-inspector.discovery-tuple')], {local:'0100007F:ABCD',remote:'0100007F:240D'});
  assert.throws(()=>observeFixtureDiscoverySocket(entry.replace("request.on('socket'", "request.on('unknown'")));
});
