import test from 'node:test';
import assert from 'node:assert/strict';
import {
  schemaRestoreFailure as wrap,
  schemaRestoreFailureDiagnostic as extract,
} from '../schema-restore-diagnostics.mjs';
const path = '/run/club-arena-qualification/private/schema/schema.sql';
const line = (state = '42501', n = 7, kind = 'ERROR') => `psql:${path}:${n}: ${kind}:  ${state}\n`;
const child = (stderr, code = 3) =>
  Object.assign(new Error('PRIVATE_CHILD_COMMAND_SQL_TOKEN'), {
    code,
    stderr,
    stdout: 'PRIVATE_STDOUT_TOKEN',
  });
test('only a newly owned wrapper exposes three frozen SQLSTATE-only native fields', () => {
  const input = child(line());
  const error = wrap(input);
  assert.notEqual(error, input);
  assert.equal(error.name, 'SchemaRestoreError');
  assert.equal(error.message, 'FIXTURE_APPLICATION_SCHEMA_RESTORE_FAILED');
  assert.deepEqual(extract(error), { sqlstate: '42501', line: 7, exit_code: 3 });
  assert.ok(Object.isFrozen(extract(error)));
  assert.equal(extract(input), null);
  assert.equal(extract(Object.assign(new Error(error.message), error)), null);
  assert.equal(extract(JSON.parse(JSON.stringify(error))), null);
  for (const key of ['stderr', 'stdout', 'code', 'cause'])
    assert.equal(Object.hasOwn(error, key), false);
  assert.doesNotMatch(
    JSON.stringify(error) + String(error) + error.stack,
    /PRIVATE_CHILD|PRIVATE_STDOUT|psql:/
  );
  assert.throws(() => {
    extract(error).line = 100;
  }, TypeError);
});
test('actual PG17 double-space SQLSTATE formatting permits single terminal ERROR and preceding native notices', () => {
  for (const state of ['42501', '42601', '42P01', 'P0001', '23505'])
    assert.deepEqual(extract(wrap(child(line(state)))), { sqlstate: state, line: 7, exit_code: 3 });
  assert.deepEqual(extract(wrap(child(line('00000', 2, 'NOTICE') + line('P0001', 3)))), {
    sqlstate: 'P0001',
    line: 3,
    exit_code: 3,
  });
  for (const n of [1, 134217728]) assert.equal(extract(wrap(child(line('42601', n)))).line, n);
});
test('unknown locations, error verbosity, marker injection, ambiguity and bounds fail closed without output retention', () => {
  const invalid = [
    '',
    line().trimEnd(),
    line().replace('ERROR:  ', 'ERROR: '),
    line().replace(path, '/tmp/schema.sql'),
    line().replace('schema.sql:', 'schema.sql/private:'),
    line().replace(':7:', ':0:'),
    line().replace(':7:', ':07:'),
    line('42501', 134217729),
    line('00000'),
    line() + line(),
    line() + line('00000', 9, 'NOTICE'),
    line('00000', 2, 'NOTICE'),
    'PRIVATE_TOKEN\n' + line(),
    line() + 'PRIVATE_SQL\n',
    line().replace('42501', 'permission denied PRIVATE_SQL'),
    line().replace('\n', '\r\n'),
    line().replace('42501', '42P01\u0000'),
    line().repeat(513),
    line('00000', 2, 'NOTICE').repeat(512) + line(),
    'X'.repeat(1048577),
  ];
  for (const stderr of invalid) {
    const e = wrap(child(stderr));
    assert.equal(extract(e), null);
    assert.equal(e.message, 'FIXTURE_APPLICATION_SCHEMA_RESTORE_FAILED');
    assert.ok(!Object.hasOwn(e, 'stderr'));
  }
  for (const code of [0, -1, 256, 3.5, '3', null, undefined])
    assert.equal(extract(wrap(Object.assign(child(line()), { code }))), null);
  assert.equal(extract(wrap({ code: 3, stderr: line() })), null);
});
test('descriptor getters, inherited output and forged diagnostic properties do not become owned facts', () => {
  let touched = false;
  const e = new Error('PRIVATE');
  Object.defineProperty(e, 'stderr', {
    get() {
      touched = true;
      throw Error('PRIVATE');
    },
  });
  e.code = 3;
  assert.equal(extract(wrap(e)), null);
  assert.equal(touched, false);
  const inherited = new Error('PRIVATE');
  Object.setPrototypeOf(
    inherited,
    Object.assign(Object.create(Error.prototype), { code: 3, stderr: line() })
  );
  assert.equal(extract(wrap(inherited)), null);
  assert.equal(
    extract(
      Object.assign(new Error('FIXTURE_APPLICATION_SCHEMA_RESTORE_FAILED'), {
        name: 'SchemaRestoreError',
        sqlstate: '42501',
        line: 7,
        exit_code: 3,
      })
    ),
    null
  );
  for (const value of [null, undefined, 1, 'PRIVATE', {}]) assert.equal(extract(value), null);
});
