// A Lightning blind off always completes (migration 20261109224717).
// Throwaway PostgreSQL cluster, the INSTALLED production definitions (hash
// checked against production), and the lifecycle run twice: BEFORE the
// migration the strand must reproduce; AFTER it the blind off must complete.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { original, root } from './qualification/stable-admin-floor/fixture.mjs';

const here = path.join(root, 'scripts/qualification/lightning-blind-off');
const migration = 'supabase/migrations/20261109224717_a_lightning_blind_off_always_completes.sql';
const pg = process.env.PG_BIN || '/usr/lib/postgresql/17/bin';
const base = process.env.TMPDIR || os.tmpdir();
const dir = fs.mkdtempSync(path.join(base, 'lightning-blind-off-'));
const port = String(45000 + Math.floor(Math.random() * 15000));
// initdb refuses root: a root container runs the cluster as the postgres user.
let identity = {};
let user = process.env.USER || 'postgres';
if (process.getuid?.() === 0) {
  const id = (flag) => Number(spawnSync('id', [flag, 'postgres'], { encoding: 'utf8' }).stdout.trim());
  identity = { uid: id('-u'), gid: id('-g') };
  user = 'postgres';
  fs.chownSync(dir, identity.uid, identity.gid);
}
function run(bin, argv, options = {}) {
  const result = spawnSync(path.join(pg, bin), argv, { encoding: 'utf8', ...identity, ...options });
  if (result.status !== 0) throw Error(`${bin} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}
const psql = (db, extra = []) => ['-h', dir, '-p', port, '-U', user, '-d', db, '-v', 'ON_ERROR_STOP=1', '-q', ...extra];
const query = (db, sql, extra) => run('psql', psql(db, extra), { input: sql });
const read = (file) => fs.readFileSync(path.join(here, file), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const migrations = fs.readdirSync(path.join(root, 'supabase/migrations'));
const fromRepository = manifest.fromRepository
  .map(([version, name]) => {
    const file = migrations.find((m) => m.startsWith(version));
    if (!file) throw Error(`Migration ${version} absent`);
    return original(`supabase/migrations/${file}`, name);
  })
  .join('\n');
// The installed fn_cash_session_evaluate is the 20261106 image patched in
// place by 20261107040516: replay that file's own patch block.
const clubPatch = /DO \$patch\$[\s\S]*?END \$patch\$;/.exec(
  fs.readFileSync(
    path.join(root, 'supabase/migrations', migrations.find((m) => m.startsWith('20261107040516'))),
    'utf8'
  )
)?.[0];
if (!clubPatch) throw Error('20261107040516 patch block absent');
const assertHashes = (db) => {
  for (const [sig, md5] of Object.entries(manifest.installed)) {
    const got = query(db, `SELECT md5(pg_get_functiondef('${sig}'::regprocedure));`, ['-At']).trim();
    if (got !== md5) throw Error(`Fixture image of ${sig} is ${got}, production is ${md5}`);
  }
};
function build(db) {
  run('createdb', ['-h', dir, '-p', port, '-U', user, db]);
  query(
    db,
    `DO $$ BEGIN IF current_setting('server_version_num')::int NOT BETWEEN 160000 AND 179999 OR inet_server_addr() IS NOT NULL OR EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN RAISE EXCEPTION 'fresh isolated PostgreSQL 16 or 17 only'; END IF; END $$;`
  );
  query(db, read('schema.sql'));
  query(db, 'SET check_function_bodies = off;\n' + fromRepository + '\n' + read('installed-production.sql'));
  query(db, clubPatch);
  assertHashes(db);
  query(db, read('sim.sql'));
}
let started = false;
try {
  run('initdb', ['-D', path.join(dir, 'data'), '-A', 'trust', '--no-locale', '-U', user]);
  run('pg_ctl', [
    '-D', path.join(dir, 'data'), '-l', path.join(dir, 'postgres.log'),
    '-o', `-k ${dir} -p ${port} -c listen_addresses='' -c shared_memory_type=mmap`, '-w', 'start',
  ]);
  started = true;
  run('psql', psql('postgres'), { input: 'CREATE ROLE service_role; CREATE ROLE authenticated; CREATE ROLE anon;' });
  const sql = fs.readFileSync(path.join(root, migration), 'utf8');

  build('before');
  const before = query('before', read('behavior.sql'), ['-v', 'mode=before']);
  console.log(before);
  for (const s of ['S1', 'S2', 'S4', 'S6'])
    if (!before.includes(`${s} STRAND REPRODUCED`)) throw Error(`${s} did not reproduce before the migration`);

  build('after');
  query('after', sql);
  // Installed twice is refused by its own guard, never silently re-patched.
  const again = spawnSync(path.join(pg, 'psql'), psql('after'), { input: sql, encoding: 'utf8', ...identity });
  if (again.status === 0 || !/LIGHTNING_BLIND_OFF_SOURCE_CHANGED/.test(again.stderr))
    throw Error('The migration did not refuse a changed installed image');
  const after = query('after', read('behavior.sql'), ['-v', 'mode=after']);
  console.log(after);
  for (const s of ['S1', 'S2', 'S4', 'S6'])
    if (!after.includes(`${s} COMPLETES`)) throw Error(`${s} did not complete after the migration`);
  if (!before.includes('LIGHTNING_BLIND_OFF_POSTGRES_PASS before') || !after.includes('LIGHTNING_BLIND_OFF_POSTGRES_PASS after'))
    throw Error('Behavior did not run to its end');
  // The function images above exclude ACLs. Reapply the originating grants
  // before testing which legacy and scoped RPCs PostgREST roles can execute.
  const migrationText = (version) => {
    const file = migrations.find((name) => name.startsWith(version));
    if (!file) throw Error(`Migration ${version} absent`);
    return fs.readFileSync(path.join(root, 'supabase/migrations', file), 'utf8');
  };
  const stopAcl = migrationText('20261008111425').split('\n').filter((line) =>
    /^(REVOKE|GRANT).* ON FUNCTION public\.fn_lightning_stop_playing\(uuid\)/.test(line)
  );
  if (stopAcl.length !== 2) throw Error('Unrecognized original stop grants');
  query('after', stopAcl.join('\n'));
  query('after', migrationText('20261112203847'));
  const sessionSource = migrations.find((name) => name.startsWith('20261001154813'));
  query('after', original(`supabase/migrations/${sessionSource}`, 'fn_lightning_my_session'));
  for (const version of ['20261001201216', '20261001222856']) {
    const block = /DO \$sub_session\$[\s\S]*?END\s+\$sub_session\$;/.exec(migrationText(version));
    if (!block) throw Error(`Session-owner patch absent in ${version}`);
    query('after', block[0]);
  }
  // Additional columns/constraint used by the canonical occupancy-bound
  // departure writer; the blind-off fixture never had to queue this request.
  query('after', `
    ALTER TABLE table_seats ADD COLUMN status text DEFAULT 'active';
    ALTER TABLE seat_departure_requests ADD PRIMARY KEY(occupancy_id);
  `);
  const departureMigration = migrations.find((name) => name.startsWith('20260908220604'));
  query('after', original(`supabase/migrations/${departureMigration}`, 'fn_request_seat_departure'));
  const receiptTable = /CREATE TABLE IF NOT EXISTS public\.seat_cashout_receipts \([\s\S]*?\n\);/.exec(migrationText('20260908220604'));
  if (!receiptTable) throw Error('Canonical occupancy receipt table missing');
  query('after', receiptTable[0]);
  query('after', original(`supabase/migrations/${departureMigration}`, 'fn_get_seat_cashout_receipt'));
  const baseline = query('after', read('scoped-room-leave.sql'), ['-v', 'before=true']);
  if (!baseline.includes('LEGACY_STALE_ROOM_CLOSED_SUCCESSOR')) throw Error('Legacy stale-tab defect not reproduced');
  query('after', migrationText('20261114220925'));
  const scoped = query('after', read('scoped-room-leave.sql'), ['-v', 'before=false']);
  if (!scoped.includes('SCOPED_LIGHTNING_LEAVE_POSTGRES_PASS')) throw Error('Scoped leave proof incomplete');
  // Hold A's successful departure open on one real connection. An admission on
  // another must wait for the same anchor and recheck eligibility after commit.
  const owner = spawn(path.join(pg, 'psql'), psql('after', ['-At']), { ...identity });
  const lines = createInterface({ input: owner.stdout });
  let ownerError = '';
  owner.stderr.on('data', (data) => { ownerError += data; });
  const closed = new Promise((resolve) => owner.on('close', resolve));
  owner.stdin.write(`BEGIN; SELECT set_config('test.engine','true',true);
    SELECT sim.ok(sim.prepare_held_departure() @> '{"ok":true,"blind_off":false}', 'A owns the pending leave');
    \\echo DEPARTURE_HELD
`);
  try {
    let held = false;
    for await (const line of lines) {
      if (line === 'DEPARTURE_HELD') { held = true; break; }
    }
    if (!held) throw Error('Departure owner did not retain its transaction: ' + ownerError);
    query('after', `
      SET lock_timeout = '350ms';
      DO $$ BEGIN
        PERFORM sim.readmit_held_seat();
        RAISE EXCEPTION 'Admission did not serialize with pending physical departure';
      EXCEPTION WHEN lock_not_available THEN NULL; END $$;
    `);
    owner.stdin.end('COMMIT;\n');
    if (await closed !== 0) throw Error('Departure commit failed: ' + ownerError);
    query('after', `
      SELECT sim.ok(sim.readmit_held_seat() IS NULL AND
        EXISTS (SELECT 1 FROM seat_departure_requests WHERE user_id = sim.h()) AND
        NOT EXISTS (SELECT 1 FROM lightning_pool_session WHERE player_id = sim.h() AND exited_at IS NULL),
        'pending physical departure bars a successor after the shared lock releases');
    `);
  } finally {
    if (!owner.stdin.writableEnded) owner.stdin.end('ROLLBACK;\n');
    await closed;
  }
  console.log(baseline + scoped);
  console.log('SCOPED_DEPARTURE_SERIALIZES_ADMISSION_PASS');
  console.log('LIGHTNING_BLIND_OFF_QUALIFIED: strand reproduced before, completion proved after');
} finally {
  if (started) run('pg_ctl', ['-D', path.join(dir, 'data'), '-m', 'immediate', '-w', 'stop']);
  fs.rmSync(dir, { recursive: true, force: true });
}
