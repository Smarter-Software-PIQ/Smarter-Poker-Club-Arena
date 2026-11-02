import assert from 'node:assert/strict';

export const REALTIME_CONTROL_DATABASE = 'club_arena_realtime_control';
export const realtimeControlConnection = Object.freeze({
  host: '/run/postgresql', user: 'supabase_admin', database: REALTIME_CONTROL_DATABASE,
  connectionTimeoutMillis: 5000, query_timeout: 5000, statement_timeout: 5000,
  options: '-c search_path=pg_catalog',
});

// Runtime.exs has already fixed Realtime.Repo to the private control database.
// The unmodified upstream seed separately reads DB_NAME for its tenant target.
// Change only that seed child's environment, never the repository configuration.
export const REALTIME_SEED_EXPRESSION = `
config = Application.fetch_env!(:realtime, Realtime.Repo)
if Keyword.fetch!(config, :database) != "club_arena_realtime_control", do: raise("FIXTURE_REALTIME_CONTROL_CONFIG_REQUIRED")
original = System.fetch_env!("DB_NAME")
if original != "club_arena_realtime_control", do: raise("FIXTURE_REALTIME_CONTROL_ENV_REQUIRED")
System.put_env("DB_NAME", "club_arena_qualification")
try do
  Realtime.Release.seeds(Realtime.Repo)
after
  System.put_env("DB_NAME", original)
end
if Keyword.fetch!(Application.fetch_env!(:realtime, Realtime.Repo), :database) != "club_arena_realtime_control", do: raise("FIXTURE_REALTIME_CONTROL_CONFIG_CHANGED")
`;

export async function assertRealtimeControlIdentity(db) {
  const result = await db.query(`SELECT current_database()='club_arena_realtime_control'
    AND current_user='supabase_admin' AND session_user='supabase_admin'
    AND inet_server_addr() IS NULL
    AND EXISTS(SELECT 1 FROM pg_roles WHERE oid=10 AND rolname=current_user AND rolsuper)
    AND (SELECT datdba=10 FROM pg_database WHERE datname=current_database())
    AND NOT has_database_privilege('postgres',current_database(),'CONNECT') AS owned_control`);
  assert.deepEqual(result.rows, [{owned_control:true}], 'FIXTURE_REALTIME_CONTROL_IDENTITY_REQUIRED');
}

// One new database in this disposable cluster, not a production database or a
// catalogue exclusion. Refuse an occupied name through ordinary CREATE.
export async function createRealtimeControlDatabase(admin, Client, databaseOwner) {
  const identity = await admin.query(`SELECT current_database()='postgres'
    AND current_user='supabase_admin' AND session_user='supabase_admin'
    AND inet_server_addr() IS NULL
    AND EXISTS(SELECT 1 FROM pg_roles WHERE oid=10 AND rolname=current_user AND rolsuper)
    AS owned_control_bootstrap`);
  assert.deepEqual(identity.rows, [{owned_control_bootstrap:true}], 'FIXTURE_REALTIME_CONTROL_BOOTSTRAP_REQUIRED');
  await admin.query('CREATE DATABASE club_arena_realtime_control OWNER supabase_admin');
  await admin.query('REVOKE CONNECT ON DATABASE club_arena_realtime_control FROM PUBLIC');
  const control = databaseOwner.own(new Client(realtimeControlConnection));
  try {
    await control.connect();
    await assertRealtimeControlIdentity(control);
    await control.query('CREATE SCHEMA _realtime AUTHORIZATION supabase_admin');
  } finally {
    await databaseOwner.end(control);
  }
}

// A real ordinary application login must be refused, before and after role
// alignment. Close even this failed connection before cluster-wide quiescence.
export async function assertRealtimeControlIsolation(application, Client, databaseOwner) {
  const actual = await application.query(`SELECT current_database()='club_arena_qualification'
    AND inet_server_addr() IS NULL AND to_regnamespace('_realtime') IS NULL
    AND NOT EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname IN
      ('postgres','anon','authenticated','authenticator','service_role')
      AND has_database_privilege(r.oid,'club_arena_realtime_control','CONNECT')) AS isolated_control`);
  assert.deepEqual(actual.rows, [{isolated_control:true}], 'FIXTURE_REALTIME_CONTROL_ISOLATION_REQUIRED');
  const denied = databaseOwner.own(new Client({...realtimeControlConnection,user:'postgres'}));
  try {
    let refused = false;
    try { await denied.connect(); }
    catch(error) { assert.equal(error?.code, '42501', 'FIXTURE_REALTIME_CONTROL_LOGIN_REQUIRED'); refused=true; }
    assert.equal(refused,true,'FIXTURE_REALTIME_CONTROL_LOGIN_REQUIRED');
  } finally {
    await databaseOwner.end(denied);
  }
}
