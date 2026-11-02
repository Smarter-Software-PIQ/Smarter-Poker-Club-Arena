import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  configureFixtureRealtimeCapturedRelations,
  assertFixtureRealtimeCapturedRelations,
} from '../../operations/release/fixture/realtime-legacy-relations.mjs';
function baseline() {
  const columns = [
    ['topic', 'text', true, null],
    ['extension', 'text', true, null],
    ['payload', 'jsonb', false, null],
    ['event', 'text', false, null],
    ['private', 'bool', false, 'false'],
    ['updated_at', 'timestamp', true, "timezone('utc'::text, clock_timestamp())"],
    ['inserted_at', 'timestamp', true, "timezone('utc'::text, clock_timestamp())"],
    ['id', 'uuid', true, 'gen_random_uuid()'],
    ['binary_payload', 'bytea', false, null],
    ['skip_broadcast', 'bool', true, 'false'],
  ].map(([name, type, notnull, def]) => ({
    name,
    type,
    mod: -1,
    notnull,
    default: def,
    identity: '',
    generated: '',
  }));
  const parent = {
    name: 'messages',
    owner: 'supabase_realtime_admin',
    kind: 'p',
    partition: false,
    rls: true,
    force_rls: false,
    replica: 'd',
    options: null,
    acl: '{supabase_realtime_admin=arwdDxtm/supabase_realtime_admin,postgres=a*r*wdDxtm/supabase_realtime_admin,dashboard_user=arwdDxtm/supabase_realtime_admin,anon=arw/supabase_realtime_admin,authenticated=arw/supabase_realtime_admin,service_role=arw/supabase_realtime_admin}',
    bound: null,
    parents: null,
    partition_key: 'RANGE (inserted_at)',
    columns,
  };
  const children = Array.from({ length: 5 }, (_, i) => ({
    ...structuredClone(parent),
    name: `messages_2026_11_0${i + 1}`,
    kind: 'r',
    acl: '{supabase_realtime_admin=arwdDxtm/supabase_realtime_admin,postgres=a*r*wdDxtm/supabase_realtime_admin,dashboard_user=arwdDxtm/supabase_realtime_admin}',
    partition: true,
    rls: false,
    parents: ['realtime.messages'],
    partition_key: null,
    bound: `FOR VALUES FROM ('2026-11-0${i + 1} 00:00:00') TO ('2026-11-0${i + 2} 00:00:00')`,
  }));
  return [
    parent,
    ...children,
    {
      name: 'schema_migrations',
      owner: 'supabase_admin',
      kind: 'r',
      partition: false,
      rls: false,
      force_rls: false,
      replica: 'd',
      options: null,
      acl: 'ledger-acl',
      bound: null,
      parents: null,
      partition_key: null,
      columns: [
        {
          name: 'version',
          type: 'int8',
          mod: -1,
          notnull: true,
          default: null,
          identity: '',
          generated: '',
        },
        {
          name: 'inserted_at',
          type: 'timestamp',
          mod: 0,
          notnull: false,
          default: 'now()',
          identity: '',
          generated: '',
        },
      ],
    },
  ];
}
function fake({
  bootstrap = true,
  migrations = true,
  empty = true,
  changeBefore,
  changeAfter,
  failDDL,
  partitionDefaults = true,
  utcDay = '2026-11-02',
  structureDrift = false,
} = {}) {
  const calls = [];
  let reads = 0;
  const before = baseline();
  changeBefore?.(before);
  const childTemplate = before.find((r) => r.partition);
  const expanded = [
    ...structuredClone(before),
    ...['2026-10-30', '2026-10-31'].map((day) => {
      const end = new Date(`${day}T00:00:00Z`);
      end.setUTCDate(end.getUTCDate() + 1);
      return {
        ...structuredClone(childTemplate),
        name: 'messages_' + day.replaceAll('-', '_'),
        bound: `FOR VALUES FROM ('${day} 00:00:00') TO ('${end.toISOString().slice(0, 10)} 00:00:00')`,
      };
    }),
  ].sort((a, b) => a.name.localeCompare(b.name));
  const orderedBefore = [...before].sort((a, b) => a.name.localeCompare(b.name));
  const after = structuredClone(expanded);
  after.find((r) => r.name === 'schema_migrations').columns[1].default = null;
  changeAfter?.(after);
  let structures = 0;
  return {
    calls,
    query: async (sql) => {
      calls.push(sql);
      if (sql.includes('AS owned_service_bootstrap'))
        return { rows: [{ owned_service_bootstrap: bootstrap }] };
      if (sql.includes('AS genuine_realtime_migrations'))
        return { rows: [{ genuine_realtime_migrations: migrations }] };
      if (sql.includes('AS utc_day')) return { rows: [{ utc_day: utcDay, pg17: true }] };
      if (sql.includes('AS exact_partition_defaults'))
        return { rows: [{ exact_partition_defaults: partitionDefaults }] };
      if (sql.includes('AS existing_structure'))
        return {
          rows: [
            {
              existing_structure: {
                indexes: structures++ && structureDrift ? 'changed' : 'exact-original-index-rows',
                defaults: 'exact-original-defaults',
              },
            },
          ],
        };
      if (sql.includes('AS empty_messages')) return { rows: [{ empty_messages: empty }] };
      if (sql.includes('AS history_unchanged')) return { rows: [{ history_unchanged: true }] };
      if (sql.startsWith('SELECT c.relname'))
        return { rows: [orderedBefore, expanded, after][Math.min(reads++, 2)] };
      if (failDDL && sql.startsWith('ALTER TABLE')) throw failDDL;
      return { rows: [] };
    },
  };
}
test('only native private owner may configure captured Realtime relations', async () => {
  const db = fake({ bootstrap: false });
  await assert.rejects(
    configureFixtureRealtimeCapturedRelations(db),
    /FIXTURE_SERVICE_BOOTSTRAP_IDENTITY_REQUIRED/
  );
  assert.equal(db.calls.length, 1);
});
for (const [name, opts] of [
  ['wrong migration set', { migrations: false }],
  ['messages occupied', { empty: false }],
  ['wrong owner', { changeBefore: (r) => (r[0].owner = 'postgres') }],
  [
    'wrong native default',
    { changeBefore: (r) => (r[0].columns[5].default = 'clock_timestamp()') },
  ],
  ['wrong column type', { changeBefore: (r) => (r[0].columns[0].type = 'varchar') }],
  ['foreign partition', { changeBefore: (r) => (r[1].parents = ['public.messages']) }],
  ['unsafe identifier', { changeBefore: (r) => (r[1].name = 'messages_bad";DROP') }],
  ['wrong partition bound', { changeBefore: (r) => (r[1].bound = 'DEFAULT') }],
  ['wrong parent key', { changeBefore: (r) => (r[0].partition_key = 'RANGE (id)') }],
])
  test(`refuses ${name} before relation DDL`, async () => {
    const db = fake(opts);
    await assert.rejects(configureFixtureRealtimeCapturedRelations(db));
    assert.equal(db.calls.at(-1), 'ROLLBACK');
    assert.ok(!db.calls.some((s) => /^(CREATE|ALTER) TABLE/.test(s)));
  });
test('genuine91 UTC defaults remain native while two retained partitions and only ledger default are configured', async () => {
  const db = fake();
  await configureFixtureRealtimeCapturedRelations(db);
  assert.equal(db.calls.filter((s) => s.startsWith('ALTER TABLE ONLY')).length, 0);
  assert.ok(!db.calls.some((s) => s.startsWith('SET LOCAL ROLE')));
  assert.deepEqual(
    db.calls.filter((s) => s.startsWith('CREATE TABLE')),
    [
      `CREATE TABLE realtime."messages_2026_10_30" PARTITION OF realtime.messages FOR VALUES FROM ('2026-10-30') TO ('2026-10-31')`,
      `CREATE TABLE realtime."messages_2026_10_31" PARTITION OF realtime.messages FOR VALUES FROM ('2026-10-31') TO ('2026-11-01')`,
    ]
  );
  assert.deepEqual(
    db.calls.filter((s) => s.startsWith('ALTER TABLE')),
    [
      'ALTER TABLE realtime."messages_2026_10_30" OWNER TO supabase_realtime_admin',
      'ALTER TABLE realtime."messages_2026_10_31" OWNER TO supabase_realtime_admin',
      'ALTER TABLE realtime.schema_migrations ALTER COLUMN inserted_at DROP DEFAULT',
    ]
  );
  const ledger = db.calls.find((s) => s.includes('AS genuine_realtime_migrations'));
  assert.ok(ledger.includes('count(*)=91'));
  assert.ok(ledger.includes('max(version)=20261009120000'));
  assert.ok(ledger.includes('07ccff1fbfc0665aee2027f75c40670b'));
  assert.equal(db.calls.at(-1), 'COMMIT');
  assert.ok(!db.calls.some((s) => /\b(INSERT|UPDATE|DELETE|GRANT|REVOKE)\b/.test(s)));
});
test('unrelated ACL drift fails the independent after-read and rolls back', async () => {
  const db = fake({ changeAfter: (r) => (r[0].acl = 'changed') });
  await assert.rejects(
    configureFixtureRealtimeCapturedRelations(db),
    /FIXTURE_REALTIME_MESSAGE_OWNER_REQUIRED/
  );
  assert.equal(db.calls.at(-1), 'ROLLBACK');
});
test('DDL failure is not accepted as configured', async () => {
  const failure = new Error('DDL refused');
  const db = fake({ failDDL: failure });
  await assert.rejects(configureFixtureRealtimeCapturedRelations(db), (e) => e === failure);
  assert.equal(db.calls.at(-1), 'ROLLBACK');
  assert.ok(!db.calls.includes('COMMIT'));
});

test('readback independently refuses unconfigured preimages without mutations', async () => {
  const db = fake();
  await assert.rejects(assertFixtureRealtimeCapturedRelations(db));
  assert.ok(db.calls.every((s) => s.startsWith('SELECT')));
});

test('both native service paths configure only after genuine migration readback with a separate observer', async () => {
  for (const name of ['fixture-server.mjs', 'native-smoke.mjs']) {
    const source = await readFile(
      new URL('../../operations/release/fixture/' + name, import.meta.url),
      'utf8'
    );
    const ready = source.indexOf('() => realtimeMigrated(realtimeBootstrap');
    const configure = source.indexOf(
      'await configureFixtureRealtimeCapturedRelations(realtimeBootstrap)'
    );
    const close = source.indexOf('end(realtimeBootstrap)', configure);
    const observer = source.indexOf(
      'await assertFixtureRealtimeCapturedRelations(realtimeRelationObserver)'
    );
    assert.ok(ready > 0 && configure > ready && close > configure && observer > close);
    assert.match(source, /realtimeRelationObserver = .*\.own\(new pg.Client/);
  }
  for (const name of ['Dockerfile', 'build-image.sh']) {
    const source = await readFile(
      new URL('../../operations/release/fixture/' + name, import.meta.url),
      'utf8'
    );
    assert.ok(source.includes('realtime-legacy-relations.mjs'));
  }
  const runner = await readFile(
    new URL('../../operations/release/ci/fixture-smoke.py', import.meta.url),
    'utf8'
  );
  assert.ok(runner.includes("'realtime-legacy-relations.mjs'"));
  const workflow = await readFile(
    new URL('../../.github/workflows/component-fixture-native-smoke.yml', import.meta.url),
    'utf8'
  );
  assert.ok(workflow.includes('tests/operations/fixture-realtime-legacy-relations.test.mjs'));
});

test('old synthetic NOT NULL/no-default ledger preimage is refused before DDL', async () => {
  const db = fake({
    changeBefore: (rows) => {
      const c = rows.find((r) => r.name === 'schema_migrations').columns[1];
      c.notnull = true;
      c.default = null;
    },
  });
  await assert.rejects(
    configureFixtureRealtimeCapturedRelations(db),
    /FIXTURE_REALTIME_LEDGER_COLUMNS_REQUIRED/
  );
  assert.ok(!db.calls.some((s) => s.startsWith('ALTER TABLE')));
  assert.equal(db.calls.at(-1), 'ROLLBACK');
});

test('relation catalogue excludes attached child indexes across strict fresh5 expanded7 configured7 snapshots', async () => {
  const db = fake();
  await configureFixtureRealtimeCapturedRelations(db);
  const snapshots = db.calls.filter((s) => s.startsWith('SELECT c.relname'));
  assert.equal(snapshots.length, 3);
  for (const sql of snapshots) assert.match(sql, /c\.relkind IN \('r','p'\)/);
});

test('default ACL drift refuses before partition creation and rolls back', async () => {
  const db = fake({ partitionDefaults: false });
  await assert.rejects(
    configureFixtureRealtimeCapturedRelations(db),
    /FIXTURE_REALTIME_PARTITION_DEFAULT_ACL_REQUIRED/
  );
  assert.equal(db.calls.at(-1), 'ROLLBACK');
  assert.ok(!db.calls.some((s) => s.startsWith('CREATE TABLE')));
});
test('a valid but stale five-day UTC window refuses before partition DDL', async () => {
  const db = fake({ utcDay: '2026-11-03' });
  await assert.rejects(
    configureFixtureRealtimeCapturedRelations(db),
    /FIXTURE_REALTIME_PARTITION_UTC_WINDOW_REQUIRED/
  );
  assert.equal(db.calls.at(-1), 'ROLLBACK');
  assert.ok(!db.calls.some((s) => s.startsWith('CREATE TABLE')));
});
test('preexisting native index metadata drift refuses after expansion and rolls back', async () => {
  const db = fake({ structureDrift: true });
  await assert.rejects(
    configureFixtureRealtimeCapturedRelations(db),
    /FIXTURE_REALTIME_EXISTING_STRUCTURE_CHANGED/
  );
  assert.equal(db.calls.filter((s) => s.startsWith('CREATE TABLE')).length, 2);
  assert.equal(db.calls.at(-1), 'ROLLBACK');
  assert.ok(!db.calls.includes('COMMIT'));
});
