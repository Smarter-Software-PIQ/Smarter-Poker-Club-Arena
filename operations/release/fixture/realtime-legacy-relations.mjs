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
  WHERE n.nspname='realtime' AND c.relkind IN ('r','p')
    AND (c.relname IN ('messages','schema_migrations')
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
// UTC calendar days match pinned Realtime's Date.utc_today() creation and
// 72-hour retention cutoff. No local/DST offset or wall-clock duration is used.
export function fixtureRealtimePartitionDays(utcDay, retained) {
  assert.match(utcDay, /^\d{4}-\d{2}-\d{2}$/, 'FIXTURE_REALTIME_UTC_DAY_REQUIRED');
  const day = new Date(`${utcDay}T00:00:00Z`);
  assert.equal(day.toISOString().slice(0, 10), utcDay, 'FIXTURE_REALTIME_UTC_DAY_REQUIRED');
  return Array.from({ length: retained ? 7 : 5 }, (_, i) => {
    const value = new Date(day);
    value.setUTCDate(value.getUTCDate() + i - (retained ? 3 : 1));
    return value.toISOString().slice(0, 10);
  });
}
const capturedAcl = (parent) =>
  `{supabase_realtime_admin=arwdDxtm/supabase_realtime_admin,postgres=a*r*wdDxtm/supabase_realtime_admin,dashboard_user=arwdDxtm/supabase_realtime_admin${parent ? ',anon=arw/supabase_realtime_admin,authenticated=arw/supabase_realtime_admin,service_role=arw/supabase_realtime_admin' : ''}}`;
function validate(rows, configured, utcDay, retained = configured) {
  assert.equal(rows.length, retained ? 9 : 7, 'FIXTURE_REALTIME_RELATION_SET_REQUIRED');
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
        r.options === null &&
        r.acl === capturedAcl(r.name === 'messages'),
      'FIXTURE_REALTIME_MESSAGE_OWNER_REQUIRED'
    );
    assert.deepEqual(
      r.columns,
      messageColumns.map((c) => ({
        ...c,
        default: ['updated_at', 'inserted_at'].includes(c.name) ? utcDefault : c.default,
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
  assert.equal(dates.length, retained ? 7 : 5, 'FIXTURE_REALTIME_PARTITION_COUNT_REQUIRED');
  assert.deepEqual(
    dates.map((d) => new Date(d).toISOString().slice(0, 10)),
    fixtureRealtimePartitionDays(utcDay, retained),
    'FIXTURE_REALTIME_PARTITION_UTC_WINDOW_REQUIRED'
  );
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
const structureSql = `WITH relations AS (SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='realtime' AND c.relname=ANY($1::text[]))
  SELECT jsonb_build_object(
    'classes',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.oid) FROM pg_class c WHERE c.oid IN (SELECT oid FROM relations)),
    'attributes',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attrelid,a.attnum) FROM pg_attribute a WHERE a.attrelid IN (SELECT oid FROM relations)),
    'defaults',(SELECT jsonb_agg(to_jsonb(d) ORDER BY d.oid) FROM pg_attrdef d WHERE d.adrelid IN (SELECT oid FROM relations)),
    'constraints',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.oid) FROM pg_constraint c WHERE c.conrelid IN (SELECT oid FROM relations)),
    'indexes',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.indexrelid) FROM pg_index i WHERE i.indrelid IN (SELECT oid FROM relations)),
    'inherits',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.inhrelid,i.inhseqno) FROM pg_inherits i WHERE i.inhrelid IN (SELECT oid FROM relations)),
    'initial',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.objoid,i.objsubid) FROM pg_init_privs i WHERE i.classoid='pg_class'::regclass AND i.objoid IN (SELECT oid FROM relations)),
    'defaultAcl',(SELECT jsonb_agg(to_jsonb(d) ORDER BY d.oid) FROM pg_default_acl d)) AS existing_structure`;
export async function configureFixtureRealtimeCapturedRelations(db) {
  await assertFixtureServiceBootstrap(db);
  await db.query('BEGIN');
  try {
    await db.query(
      "SET LOCAL search_path=pg_catalog; SET LOCAL lock_timeout='500ms'; SET LOCAL statement_timeout='5s'"
    );
    await db.query(
      'LOCK TABLE realtime.schema_migrations, realtime.messages IN ACCESS EXCLUSIVE MODE'
    );
    const migrations = await db.query(`SELECT count(*)=91 AND min(version)=20211116024918
      AND max(version)=20261009120000 AND md5(string_agg(version::text,',' ORDER BY version))='07ccff1fbfc0665aee2027f75c40670b'
      AND to_regnamespace('_realtime') IS NULL AS genuine_realtime_migrations FROM realtime.schema_migrations`);
    assert.deepEqual(
      migrations.rows,
      [{ genuine_realtime_migrations: true }],
      'FIXTURE_GENUINE_REALTIME_91_REQUIRED'
    );
    const before = (await db.query(snapshotSql)).rows;
    const clock =
      await db.query(`SELECT (transaction_timestamp() AT TIME ZONE 'UTC')::date::text AS utc_day,
      current_setting('server_version_num')::integer BETWEEN 170000 AND 179999 AS pg17`);
    assert.equal(clock.rows.length, 1, 'FIXTURE_REALTIME_UTC_DAY_REQUIRED');
    assert.equal(clock.rows[0].pg17, true, 'FIXTURE_REALTIME_PG17_REQUIRED');
    const utcDay = clock.rows[0].utc_day;
    validate(before, false, utcDay);
    const empty = await db.query(
      'SELECT NOT EXISTS(SELECT 1 FROM realtime.messages) AS empty_messages'
    );
    assert.deepEqual(
      empty.rows,
      [{ empty_messages: true }],
      'FIXTURE_REALTIME_EMPTY_MESSAGES_REQUIRED'
    );
    // Native Admin-created partitions receive the exact upstream namespace defaults
    // before ordinary ALTER OWNER, just like Realtime.Tenants creates its five.
    // Refuse role/global/default-ACL drift instead of repairing unrelated grants.
    const defaults = await db.query(`SELECT count(*)=1 AND bool_and((
      defaclrole=10 AND defaclnamespace='realtime'::regnamespace AND defaclobjtype='r'
      AND defaclacl::text='{postgres=a*r*wdDxtm/supabase_admin,dashboard_user=arwdDxtm/supabase_admin}') IS TRUE)
      AS exact_partition_defaults FROM pg_default_acl WHERE defaclobjtype='r'
      AND (defaclrole=10 AND defaclnamespace IN (0,'realtime'::regnamespace)
        OR defaclrole=(SELECT oid FROM pg_roles WHERE rolname='supabase_realtime_admin'))`);
    assert.deepEqual(
      defaults.rows,
      [{ exact_partition_defaults: true }],
      'FIXTURE_REALTIME_PARTITION_DEFAULT_ACL_REQUIRED'
    );
    const originalNames = before.map((r) => r.name);
    const originalStructure = (await db.query(structureSql, [originalNames])).rows;
    for (const day of fixtureRealtimePartitionDays(utcDay, true).slice(0, 2)) {
      const name = 'messages_' + day.replaceAll('-', '_');
      const end = new Date(`${day}T00:00:00Z`);
      end.setUTCDate(end.getUTCDate() + 1);
      // Name and bounds derive only from the validated UTC calendar, never SQL input.
      // No IF NOT EXISTS: a conflicting historical child is an unknown preimage.
      await db.query(
        `CREATE TABLE realtime."${name}" PARTITION OF realtime.messages FOR VALUES FROM ('${day}') TO ('${end.toISOString().slice(0, 10)}')`
      );
      await db.query(`ALTER TABLE realtime."${name}" OWNER TO supabase_realtime_admin`);
    }
    assert.deepEqual(
      (await db.query(structureSql, [originalNames])).rows,
      originalStructure,
      'FIXTURE_REALTIME_EXISTING_STRUCTURE_CHANGED'
    );
    const expanded = (await db.query(snapshotSql)).rows;
    // Genuine91 already supplies UTC timestamp defaults on parent and children.
    validate(expanded, false, utcDay, true);
    assert.deepEqual(
      expanded.filter((r) => originalNames.includes(r.name)),
      before,
      'FIXTURE_REALTIME_EXISTING_RELATIONS_CHANGED'
    );
    await db.query('ALTER TABLE realtime.schema_migrations ALTER COLUMN inserted_at DROP DEFAULT');
    const after = (await db.query(snapshotSql)).rows;
    validate(after, true, utcDay);
    assert.deepEqual(
      invariant(after),
      invariant(expanded),
      'FIXTURE_REALTIME_UNRELATED_METADATA_CHANGED'
    );
    const unchanged = await db.query(
      `SELECT count(*)=91 AND md5(string_agg(version::text,',' ORDER BY version))='07ccff1fbfc0665aee2027f75c40670b' AS history_unchanged FROM realtime.schema_migrations`
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
  const clock = await db.query(
    "SELECT (transaction_timestamp() AT TIME ZONE 'UTC')::date::text AS utc_day"
  );
  validate(result.rows, true, clock.rows[0].utc_day);
  const history = await db.query(`SELECT count(*)=91 AND min(version)=20211116024918
    AND max(version)=20261009120000 AND md5(string_agg(version::text,',' ORDER BY version))='07ccff1fbfc0665aee2027f75c40670b'
    AND to_regnamespace('_realtime') IS NULL AS genuine_realtime_migrations FROM realtime.schema_migrations`);
  assert.deepEqual(
    history.rows,
    [{ genuine_realtime_migrations: true }],
    'FIXTURE_GENUINE_REALTIME_91_REQUIRED'
  );
}
