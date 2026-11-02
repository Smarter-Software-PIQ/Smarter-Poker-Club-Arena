import assert from 'node:assert/strict';
import { assertFixtureServiceBootstrap } from './service-role-boundary.mjs';

// Captured deployment configuration, not an upstream migration or a claim of
// managed-bootstrap provenance. Genuine Realtime migrations must finish first.
const snapshotSql = `SELECT c.relname AS name,c.relkind AS kind,
  pg_get_userbyid(c.relowner) AS owner,c.relispartition AS partition,
  c.relrowsecurity AS rls,c.relforcerowsecurity AS force_rls,c.relreplident AS replica,
  c.reloptions AS options,c.relacl::text AS acl,
  pg_get_expr(c.relpartbound,c.oid) AS bound,pg_get_partkeydef(c.oid) AS partition_key,
  (SELECT array_agg(p.inhparent::regclass::text ORDER BY p.inhseqno)
    FROM pg_inherits p WHERE p.inhrelid=c.oid) AS parents,
  (SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',t.typname,
    'mod',a.atttypmod,'notnull',a.attnotnull,'identity',a.attidentity,
    'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum)
    FROM pg_attribute a JOIN pg_type t ON t.oid=a.atttypid
    LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS columns
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='realtime' AND (c.relname IN ('messages','schema_migrations')
    OR c.relname LIKE 'messages\\_%' ESCAPE '\\' AND c.relispartition)
  ORDER BY c.relname`;
const messageColumns = [
  ['topic', 'text', true, null],
  ['extension', 'text', true, null],
  ['payload', 'jsonb', false, null],
  ['event', 'text', false, null],
  ['private', 'bool', false, 'false'],
  ['updated_at', 'timestamp', true, 'now()'],
  ['inserted_at', 'timestamp', true, 'now()'],
  ['id', 'uuid', true, 'gen_random_uuid()'],
  ['binary_payload', 'bytea', false, null],
  ['skip_broadcast', 'bool', true, 'false'],
].map(([name, type, notnull, def]) => ({
  name,
  type,
  mod: -1,
  notnull,
  identity: '',
  generated: '',
  default: def,
}));
const ledgerColumns = [
  {
    name: 'version',
    type: 'int8',
    mod: -1,
    notnull: true,
    identity: '',
    generated: '',
    default: null,
  },
  {
    name: 'inserted_at',
    type: 'timestamp',
    mod: 0,
    notnull: false,
    identity: '',
    generated: '',
    default: 'now()',
  },
];
const utcDefault = "timezone('utc'::text, clock_timestamp())";
function validate(rows, configured) {
  assert.equal(rows.length, 7, 'FIXTURE_REALTIME_RELATION_SET_REQUIRED');
  const ledger = rows.find((r) => r.name === 'schema_migrations');
  assert.ok(
    ledger &&
      ledger.owner === 'supabase_admin' &&
      ledger.kind === 'r' &&
      !ledger.partition &&
      !ledger.rls &&
      !ledger.force_rls &&
      ledger.bound === null &&
      ledger.parents === null &&
      ledger.replica === 'd' &&
      ledger.options === null,
    'FIXTURE_REALTIME_LEDGER_PREIMAGE_REQUIRED'
  );
  assert.deepEqual(
    ledger.columns,
    ledgerColumns.map((c) => ({
      ...c,
      default: c.name === 'inserted_at' && configured ? null : c.default,
    })),
    'FIXTURE_REALTIME_LEDGER_COLUMNS_REQUIRED'
  );
  const messages = rows.filter((r) => r !== ledger);
  for (const r of messages) {
    assert.ok(
      r.owner === 'supabase_realtime_admin' &&
        !r.force_rls &&
        r.replica === 'd' &&
        r.options === null,
      'FIXTURE_REALTIME_MESSAGE_OWNER_REQUIRED'
    );
    assert.deepEqual(
      r.columns,
      messageColumns.map((c) => ({
        ...c,
        default:
          configured && ['updated_at', 'inserted_at'].includes(c.name) ? utcDefault : c.default,
      })),
      'FIXTURE_REALTIME_MESSAGE_COLUMNS_REQUIRED'
    );
    if (r.name === 'messages')
      assert.ok(
        r.kind === 'p' &&
          !r.partition &&
          r.rls &&
          r.parents === null &&
          r.bound === null &&
          r.partition_key === 'RANGE (inserted_at)',
        'FIXTURE_REALTIME_PARENT_REQUIRED'
      );
    else {
      assert.match(
        r.name,
        /^messages_\d{4}_\d{2}_\d{2}$/,
        'FIXTURE_REALTIME_PARTITION_NAME_REQUIRED'
      );
      assert.ok(
        r.kind === 'r' && r.partition && !r.rls && r.partition_key === null,
        'FIXTURE_REALTIME_PARTITION_SHAPE_REQUIRED'
      );
      assert.deepEqual(
        r.parents,
        ['realtime.messages'],
        'FIXTURE_REALTIME_PARTITION_PARENT_REQUIRED'
      );
      const date = r.name.slice(9).replaceAll('_', '-');
      const start = new Date(date + 'T00:00:00Z');
      assert.equal(
        start.toISOString().slice(0, 10),
        date,
        'FIXTURE_REALTIME_PARTITION_DATE_REQUIRED'
      );
      const end = new Date(start.getTime() + 86400000).toISOString().slice(0, 10);
      assert.equal(
        r.bound,
        `FOR VALUES FROM ('${date} 00:00:00') TO ('${end} 00:00:00')`,
        'FIXTURE_REALTIME_PARTITION_BOUND_REQUIRED'
      );
    }
  }
  assert.equal(
    messages.filter((r) => r.name === 'messages').length,
    1,
    'FIXTURE_REALTIME_PARENT_REQUIRED'
  );
  const dates = messages
    .filter((r) => r.partition)
    .map((r) => Date.parse(r.name.slice(9).replaceAll('_', '-')))
    .sort((a, b) => a - b);
  assert.equal(dates.length, 5, 'FIXTURE_REALTIME_PARTITION_COUNT_REQUIRED');
  assert.ok(
    dates.every((d, i) => i === 0 || d - dates[i - 1] === 86400000),
    'FIXTURE_REALTIME_PARTITION_SEQUENCE_REQUIRED'
  );
}
function invariant(rows) {
  return rows.map((r) => ({
    ...r,
    columns: r.columns.map((c) => ({
      ...c,
      notnull: c.notnull,
      default:
        (r.name === 'schema_migrations' && c.name === 'inserted_at') ||
        (r.name !== 'schema_migrations' && ['inserted_at', 'updated_at'].includes(c.name))
          ? null
          : c.default,
    })),
  }));
}
export async function configureFixtureRealtimeCapturedRelations(db) {
  await assertFixtureServiceBootstrap(db);
  await db.query('BEGIN');
  try {
    await db.query('SET LOCAL search_path=pg_catalog');
    await db.query(
      'LOCK TABLE realtime.schema_migrations, realtime.messages IN ACCESS EXCLUSIVE MODE'
    );
    const migrations = await db.query(`SELECT count(*)=83 AND min(version)=20211116024918
      AND max(version)=20260827120000 AND md5(string_agg(version::text,',' ORDER BY version))='262da2efb4aa494a7d90cf451fc9cce5'
      AND to_regnamespace('_realtime') IS NULL AS genuine_realtime_migrations FROM realtime.schema_migrations`);
    assert.deepEqual(
      migrations.rows,
      [{ genuine_realtime_migrations: true }],
      'FIXTURE_GENUINE_REALTIME_83_REQUIRED'
    );
    const before = (await db.query(snapshotSql)).rows;
    validate(before, false);
    const empty = await db.query(
      'SELECT NOT EXISTS(SELECT 1 FROM realtime.messages) AS empty_messages'
    );
    assert.deepEqual(
      empty.rows,
      [{ empty_messages: true }],
      'FIXTURE_REALTIME_EMPTY_MESSAGES_REQUIRED'
    );
    await db.query('ALTER TABLE realtime.schema_migrations ALTER COLUMN inserted_at DROP DEFAULT');
    await db.query('SET LOCAL ROLE supabase_realtime_admin');
    for (const r of before.filter((r) => r.name !== 'schema_migrations')) {
      // Only validated fixed parent or ISO-date child identifiers reach DDL.
      await db.query(
        `ALTER TABLE ONLY realtime."${r.name}" ALTER COLUMN updated_at SET DEFAULT timezone('utc',clock_timestamp()), ALTER COLUMN inserted_at SET DEFAULT timezone('utc',clock_timestamp())`
      );
    }
    await db.query('RESET ROLE');
    const after = (await db.query(snapshotSql)).rows;
    validate(after, true);
    assert.deepEqual(
      invariant(after),
      invariant(before),
      'FIXTURE_REALTIME_UNRELATED_METADATA_CHANGED'
    );
    const unchanged = await db.query(
      `SELECT count(*)=83 AND md5(string_agg(version::text,',' ORDER BY version))='262da2efb4aa494a7d90cf451fc9cce5' AS history_unchanged FROM realtime.schema_migrations`
    );
    assert.deepEqual(
      unchanged.rows,
      [{ history_unchanged: true }],
      'FIXTURE_REALTIME_HISTORY_CHANGED'
    );
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

// Independent readback for the same private native identity. This observer
// changes nothing and cannot substitute for full-schema or provider proof.
export async function assertFixtureRealtimeCapturedRelations(db) {
  await assertFixtureServiceBootstrap(db);
  const result = await db.query(snapshotSql);
  validate(result.rows, true);
  const history = await db.query(`SELECT count(*)=83 AND min(version)=20211116024918
    AND max(version)=20260827120000 AND md5(string_agg(version::text,',' ORDER BY version))='262da2efb4aa494a7d90cf451fc9cce5'
    AND to_regnamespace('_realtime') IS NULL AS genuine_realtime_migrations FROM realtime.schema_migrations`);
  assert.deepEqual(
    history.rows,
    [{ genuine_realtime_migrations: true }],
    'FIXTURE_GENUINE_REALTIME_83_REQUIRED'
  );
}
