import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fixtureRealtimePartitionDays as dates } from '../realtime-legacy-relations.mjs';
test('UTC retention window matches captured November2 and upstream fresh five', () => {
  assert.deepEqual(dates('2026-11-02', false), [
    '2026-11-01',
    '2026-11-02',
    '2026-11-03',
    '2026-11-04',
    '2026-11-05',
  ]);
  assert.deepEqual(dates('2026-11-02', true), [
    '2026-10-30',
    '2026-10-31',
    '2026-11-01',
    '2026-11-02',
    '2026-11-03',
    '2026-11-04',
    '2026-11-05',
  ]);
});
test('UTC calendar boundaries cover leap day, year change and both Chicago DST transitions', () => {
  for (const day of ['2024-03-01', '2027-01-01', '2026-03-08', '2026-11-01']) {
    const actual = dates(day, true);
    assert.equal(actual.length, 7);
    assert.equal(actual[3], day);
    for (let i = 1; i < actual.length; i++)
      assert.equal(Date.parse(actual[i]) - Date.parse(actual[i - 1]), 86400000);
  }
  assert.equal(dates('2024-03-01', true)[2], '2024-02-29');
  assert.equal(dates('2027-01-01', true)[0], '2026-12-29');
  for (const bad of [
    '2026-02-30',
    '2026-11-02T00:00:00Z',
    '2026-1-1',
    "2026-11-02';DROP TABLE realtime.messages;--",
  ])
    assert.throws(() => dates(bad, true));
});
test('bounded transaction keeps strict fresh five, native91 ACL/default preimages and existing catalog objects', async () => {
  const source = await readFile(
    new URL('../realtime-legacy-relations.mjs', import.meta.url),
    'utf8'
  );
  for (const marker of [
    'retained ? 9 : 7',
    'retained ? 7 : 5',
    'validate(before, false, utcDay)',
    'validate(expanded, false, utcDay, true)',
    'validate(after, true, utcDay)',
    "SET LOCAL lock_timeout='500ms'",
    "SET LOCAL statement_timeout='5s'",
    'count(*)=91',
    '20261009120000',
    '07ccff1fbfc0665aee2027f75c40670b',
    'FIXTURE_REALTIME_PARTITION_DEFAULT_ACL_REQUIRED',
    'FIXTURE_REALTIME_EXISTING_STRUCTURE_CHANGED',
    'FIXTURE_REALTIME_EXISTING_RELATIONS_CHANGED',
    "await db.query('ROLLBACK')",
    'PARTITION OF realtime.messages',
    'OWNER TO supabase_realtime_admin',
    "AT TIME ZONE 'UTC'",
    'pg_index',
    'pg_constraint',
    'pg_init_privs',
    'pg_default_acl',
  ])
    assert.ok(source.includes(marker), marker);
  assert.ok(
    source.indexOf('validate(before, false, utcDay)') < source.indexOf('CREATE TABLE realtime.')
  );
  assert.ok(
    source.indexOf('CREATE TABLE realtime.') <
      source.indexOf('ALTER COLUMN inserted_at DROP DEFAULT')
  );
  assert.doesNotMatch(
    source,
    /CREATE TABLE IF NOT EXISTS|INSERT INTO realtime.schema_migrations|UPDATE pg_|INSERT INTO pg_|ALTER COLUMN updated_at SET DEFAULT|SET LOCAL ROLE/
  );
});
