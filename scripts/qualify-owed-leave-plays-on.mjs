// 2026-11-14: an owed leave alone at its table plays on in its game
// (migration 20261114160836). Throwaway PostgreSQL cluster built from the
// lightning-blind-off fixture (installed production images, hash checked) with
// 20261109224717 applied, as production has it. BEFORE this migration the
// queued leave strands; AFTER it the owed hands are dealt and the leave completes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { original, root } from './qualification/stable-admin-floor/fixture.mjs';

const fixture = path.join(root, 'scripts/qualification/lightning-blind-off');
const here = path.join(root, 'scripts/qualification/owed-leave-plays-on');
const door =
  'supabase/migrations/20261113225904_a_lightning_leave_that_owes_hands_returns_the_seat_to_the_po.sql';
const prior = 'supabase/migrations/20261109224717_a_lightning_blind_off_always_completes.sql';
const migration =
  'supabase/migrations/20261114160836_an_owed_leave_alone_at_its_table_plays_on_in_its_game.sql';
const pg = process.env.PG_BIN || '/usr/lib/postgresql/17/bin';
const base = process.env.TMPDIR || os.tmpdir();
const dir = fs.mkdtempSync(path.join(base, 'owed-leave-plays-on-'));
const port = String(45000 + Math.floor(Math.random() * 15000));
let identity = {};
let user = process.env.USER || 'postgres';
if (process.getuid?.() === 0) {
  const id = (flag) =>
    Number(spawnSync('id', [flag, 'postgres'], { encoding: 'utf8' }).stdout.trim());
  identity = { uid: id('-u'), gid: id('-g') };
  user = 'postgres';
  fs.chownSync(dir, identity.uid, identity.gid);
}
function run(bin, argv, options = {}) {
  const result = spawnSync(path.join(pg, bin), argv, { encoding: 'utf8', ...identity, ...options });
  if (result.status !== 0) throw Error(`${bin} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}
const psql = (db, extra = []) => [
  '-h',
  dir,
  '-p',
  port,
  '-U',
  user,
  '-d',
  db,
  '-v',
  'ON_ERROR_STOP=1',
  '-q',
  ...extra,
];
const query = (db, sql, extra) => run('psql', psql(db, extra), { input: sql });
const readFixture = (file) => fs.readFileSync(path.join(fixture, file), 'utf8');
const readRepo = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const manifest = JSON.parse(readFixture('manifest.json'));
const migrations = fs.readdirSync(path.join(root, 'supabase/migrations'));
const fromRepository = manifest.fromRepository
  .map(([version, name]) => {
    const file = migrations.find((m) => m.startsWith(version));
    if (!file) throw Error(`Migration ${version} absent`);
    return original(`supabase/migrations/${file}`, name);
  })
  .join('\n');
const clubPatch = /DO \$patch\$[\s\S]*?END \$patch\$;/.exec(
  readRepo(`supabase/migrations/${migrations.find((m) => m.startsWith('20261107040516'))}`)
)?.[0];
if (!clubPatch) throw Error('20261107040516 patch block absent');
function build(db) {
  run('createdb', ['-h', dir, '-p', port, '-U', user, db]);
  query(
    db,
    `DO $$ BEGIN IF current_setting('server_version_num')::int NOT BETWEEN 160000 AND 179999 OR inet_server_addr() IS NOT NULL OR EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace) THEN RAISE EXCEPTION 'fresh isolated PostgreSQL 16 or 17 only'; END IF; END $$;`
  );
  query(db, readFixture('schema.sql'));
  // The one column this door writes that the blind-off fixture did not need.
  query(db, "ALTER TABLE table_seats ADD COLUMN status text DEFAULT 'active';");
  query(
    db,
    'SET check_function_bodies = off;\n' +
      fromRepository +
      '\n' +
      readFixture('installed-production.sql')
  );
  query(db, clubPatch);
  for (const [sig, md5] of Object.entries(manifest.installed)) {
    const got = query(db, `SELECT md5(pg_get_functiondef('${sig}'::regprocedure));`, [
      '-At',
    ]).trim();
    if (got !== md5) throw Error(`Fixture image of ${sig} is ${got}, production was ${md5}`);
  }
  query(db, readFixture('sim.sql'));
  query(db, readRepo(prior));
  query(db, readRepo(door));
}
let started = false;
try {
  run('initdb', ['-D', path.join(dir, 'data'), '-A', 'trust', '--no-locale', '-U', user]);
  run('pg_ctl', [
    '-D',
    path.join(dir, 'data'),
    '-l',
    path.join(dir, 'postgres.log'),
    '-o',
    `-k ${dir} -p ${port} -c listen_addresses='' -c shared_memory_type=mmap`,
    '-w',
    'start',
  ]);
  started = true;
  run('psql', psql('postgres'), {
    input: 'CREATE ROLE service_role; CREATE ROLE authenticated; CREATE ROLE anon;',
  });
  const behavior = fs.readFileSync(path.join(here, 'behavior.sql'), 'utf8');

  build('before');
  const before = query('before', behavior, ['-v', 'mode=before', '-v', 'after=false']);
  console.log(before);
  if (!before.includes('Q0 WAIVER REPRODUCED'))
    throw Error('Q0 did not reproduce before the migration');

  build('after');
  query('after', readRepo(migration));
  const after = query('after', behavior, ['-v', 'mode=after', '-v', 'after=true']);
  console.log(after);
  for (const s of ['Q1 PLAYS ON', 'Q2-Q10 PASS'])
    if (!after.includes(s)) throw Error(`${s} missing after the migration`);
  if (
    !before.includes('OWED_LEAVE_PLAYS_ON_POSTGRES_PASS before') ||
    !after.includes('OWED_LEAVE_PLAYS_ON_POSTGRES_PASS after')
  )
    throw Error('Behavior did not run to its end');
  console.log('OWED_LEAVE_PLAYS_ON_QUALIFIED: waiver reproduced before, play-on proved after');
} finally {
  if (started) run('pg_ctl', ['-D', path.join(dir, 'data'), '-m', 'immediate', '-w', 'stop']);
  fs.rmSync(dir, { recursive: true, force: true });
}
