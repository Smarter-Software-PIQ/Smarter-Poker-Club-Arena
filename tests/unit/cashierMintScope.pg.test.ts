import { expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import {
  SCRATCH_POSTGRES_PORT,
  scratchPostgresListenOptions,
  scratchPostgresSocket,
  showServerLogWhenStartFails,
} from '../helpers/scratchPostgres';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import pg from 'pg';
import { stalePinGuardSQL } from '../../scripts/ci/migration-stale-pins.mjs';

it('binds issuance to the selected bank and serializes club admission with minting', async () => {
  const root = resolve(__dirname, '../..');
  const bin = [
    '/opt/homebrew/opt/postgresql@17/bin',
    '/opt/homebrew/bin',
    '/usr/lib/postgresql/18/bin',
    '/usr/lib/postgresql/17/bin',
    '/usr/lib/postgresql/16/bin',
    '/usr/bin',
  ].find((dir) => ['initdb', 'pg_ctl', 'psql'].every((name) => existsSync(`${dir}/${name}`)));
  if (!bin) throw new Error('PostgreSQL binaries are required for cashier mint qualification');
  const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const serverUser = 'nobody';
  const cache = asRoot ? tmpdir() : resolve(root, 'node_modules/.cache');
  mkdirSync(cache, { recursive: true });
  const scratch = mkdtempSync(resolve(cache, 'cashier-mint-'));
  if (asRoot) chmodSync(scratch, 0o777);
  const socket = scratchPostgresSocket();
  const data = resolve(scratch, 'data');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    LC_ALL: process.env.LC_ALL || 'C',
    PGHOST: socket,
    PGPORT: SCRATCH_POSTGRES_PORT,
    PGDATABASE: 'postgres',
    PGUSER: asRoot ? serverUser : process.env.USER || 'runner',
    PGSSLMODE: 'disable',
  };
  delete env.PGSERVICE;
  delete env.PGSERVICEFILE;
  const server = (cmd: string) => cmd === 'initdb' || cmd === 'pg_ctl';
  const run = (cmd: string, args: string[], input?: string) =>
    asRoot && server(cmd)
      ? execFileSync('runuser', ['-u', serverUser, '--', `${bin}/${cmd}`, ...args], {
          cwd: scratch,
          env,
          input,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      : execFileSync(`${bin}/${cmd}`, args, {
          cwd: root,
          env,
          input,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
  const sql = (text: string) => run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-q'], text);
  const one = (text: string) =>
    run('psql', ['-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', text]).trim();
  let started = false;
  try {
    run('initdb', ['-D', data, '-A', 'trust']);
    showServerLogWhenStartFails(resolve(scratch, 'postgres.log'), () =>
      run('pg_ctl', [
        '-D',
        data,
        '-l',
        resolve(scratch, 'postgres.log'),
        '-o',
        scratchPostgresListenOptions(socket),
        '-w',
        'start',
      ])
    );
    started = true;

    const path =
      'supabase/migrations/20261126030501_chip_mints_bind_to_the_selected_standalone_club_or_union_bank.sql';
    const source = readFileSync(resolve(root, path), 'utf8');
    const migration = stalePinGuardSQL(path, source, source);
    const original = (file: string, name: string) => {
      const body = readFileSync(resolve(root, 'supabase/migrations', file), 'utf8');
      const start = body.indexOf('CREATE OR REPLACE FUNCTION public.' + name + '(');
      const end = body.indexOf('$function$;', start);
      if (start < 0 || end < 0) throw new Error('Missing original definition for ' + name);
      return body.slice(start, end + '$function$;'.length);
    };
    const issuer = '20260907233813_the_bridge_rate_is_a_row_and_the_ledger_learns_the_wheel.sql';
    const admission = '20260826202819_20260826_a_club_enters_a_union_empty.sql';
    sql(readFileSync(resolve(root, 'tests/unit/fixtures/cashier-mint-scope.sql'), 'utf8'));
    sql(original(issuer, 'fn_ca_bridge_rate'));
    sql(original(issuer, 'fn_mint_chips_from_diamonds'));
    sql(original(admission, 'fn_enforce_club_enters_union_empty'));
    sql(original(admission, 'fn_club_union_join_blockers'));
    sql(
      original(
        '20260903031500_diamond_c_the_journal_keeps_both_sides_and_survives_deletion.sql',
        'deduct_diamonds'
      )
    );
    sql(
      original('20260901011443_ca_hr2_phase5_declare_ledger_primitive.sql', 'fn_ca_declare_ledger')
    );
    sql(
      'REVOKE ALL ON FUNCTION fn_mint_chips_from_diamonds(uuid,numeric,uuid) FROM PUBLIC; GRANT EXECUTE ON FUNCTION fn_mint_chips_from_diamonds(uuid,numeric,uuid) TO authenticated,service_role; CREATE TRIGGER admission BEFORE INSERT ON union_clubs FOR EACH ROW EXECUTE FUNCTION fn_enforce_club_enters_union_empty();'
    );

    const id = (n: number) => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
    const [owner, admin, member, suspended, coOwner] = [1, 2, 3, 4, 5].map(id);
    const [standalone, hub, mirrorOnly, edgeOnly, both, legacy, raceJoin, raceMint, impostor] = [
      11, 12, 13, 14, 15, 16, 17, 18, 19,
    ].map(id);
    const addClub = (
      club: string,
      isUnion: boolean | null = false,
      union: string | null = null
    ) => {
      const unionValue = union ? `'${union}'` : 'NULL';
      sql(`INSERT INTO clubs(id, owner_id, is_union, union_id)
          VALUES ('${club}', '${owner}', ${isUnion}, ${unionValue})`);
    };
    for (const actor of [owner, admin, member, suspended, coOwner]) {
      sql(`INSERT INTO profiles(id, diamonds, diamond_balance) VALUES ('${actor}', 1000, 1000)`);
    }
    for (const club of [standalone, edgeOnly, raceJoin, raceMint]) addClub(club);
    addClub(legacy, null);
    addClub(hub, true, hub);
    addClub(impostor, true);
    for (const club of [mirrorOnly, both]) addClub(club, false, hub);
    sql(`INSERT INTO unions VALUES ('${hub}', '${owner}');
        INSERT INTO union_admins VALUES ('${hub}', '${admin}')`);
    const join = (club: string) =>
      `INSERT INTO union_clubs(club_id, union_id) VALUES ('${club}', '${hub}')`;
    sql(join(edgeOnly) + ';' + join(both));
    for (const club of [standalone, mirrorOnly, edgeOnly, both, hub]) {
      for (const [actor, role, status] of [
        [admin, 'admin', 'approved'],
        [suspended, 'admin', 'suspended'],
        [member, 'member', 'active'],
        [coOwner, 'co_owner', 'active'],
      ]) {
        sql(`INSERT INTO club_members(club_id, user_id, role, status)
            VALUES ('${club}', '${actor}', '${role}', '${status}')`);
      }
    }
    const appRole = (actor: string) =>
      `SET ROLE authenticated; SET request.jwt.claim.sub TO '${actor}';`;
    const mint = (club: string, diamonds: number, op: string) =>
      `SELECT fn_mint_chips_from_diamonds('${club}', ${diamonds}, '${op}')`;
    const receipt = (actor: string, club: string, diamonds: number, op: string) =>
      JSON.parse(asActor(actor, mint(club, diamonds, op)));
    const asActor = (actor: string, query: string) =>
      run('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], appRole(actor) + query).trim();
    // The previous UI's ordinary union-operator request at a member club wrongly
    // completed a union-bank purchase. Verify the old behavior and roll it back.
    const legacyReceipt = run(
      'psql',
      ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1'],
      'BEGIN;' + appRole(owner) + mint(both, 100, id(601)) + ';ROLLBACK;'
    );
    expect(JSON.parse(legacyReceipt)).toMatchObject({ success: true, scope: 'union' });
    expect(one('SELECT count(*) FROM chip_transactions')).toBe('0');
    const liveProof = source.match(/^-- @live-proof: (.+)$/m)?.[1];
    expect(liveProof).toBeTruthy();
    sql(
      original(admission, 'fn_enforce_club_enters_union_empty').replace(
        'DECLARE',
        'DECLARE /* intervening revision */'
      )
    );
    expect(() => sql(migration)).toThrow(/migration_preimage_mismatch/);
    sql(original(admission, 'fn_enforce_club_enters_union_empty'));
    sql(migration);
    expect(one('SELECT ' + liveProof)).toBe('t');

    const hashes = one(
      "SELECT md5(pg_get_functiondef('public.fn_mint_chips_from_diamonds(uuid,numeric,uuid)'::regprocedure)), md5(pg_get_functiondef('public.fn_cashier_mint_scope(uuid)'::regprocedure))"
    ).split('|');
    const deploymentContract = readFileSync(
      resolve(root, 'scripts/verification-harness/cashier-release-contract.sql'),
      'utf8'
    );
    expect(
      hashes.filter((hash) => !deploymentContract.includes(hash)),
      'Unverified installed routine fingerprints'
    ).toEqual([]);

    const scope = (actor: string, club: string) =>
      asActor(actor, `SELECT coalesce(fn_cashier_mint_scope('${club}'), 'denied')`);
    for (const [actor, club, expected] of [
      [owner, standalone, 'club'],
      [admin, standalone, 'club'],
      [coOwner, standalone, 'club'],
      [member, standalone, 'denied'],
      [suspended, standalone, 'denied'],
      [owner, legacy, 'club'],
      [owner, hub, 'union'],
      [admin, hub, 'union'],
      [coOwner, hub, 'denied'],
      [owner, impostor, 'denied'],
      [owner, id(999), 'denied'],
      ['', standalone, 'denied'],
    ])
      expect(scope(actor, club)).toBe(expected);
    for (const club of [mirrorOnly, edgeOnly, both]) {
      for (const actor of [owner, admin, coOwner, member]) {
        expect(scope(actor, club)).toBe('denied');
        expect(receipt(actor, club, 100, id(700))).toMatchObject({ success: false });
      }
    }
    expect(one('SELECT count(*) FROM chip_transactions')).toBe('0');
    const rolePrivileges = one(
      "SELECT has_function_privilege('anon','fn_cashier_mint_scope(uuid)','EXECUTE'), has_function_privilege('authenticated','fn_cashier_mint_scope(uuid)','EXECUTE'), has_function_privilege('service_role','fn_cashier_mint_scope(uuid)','EXECUTE')"
    );
    expect(rolePrivileges).toBe('f|t|t');

    expect(receipt(coOwner, standalone, 250, id(501))).toMatchObject({
      success: true,
      scope: 'club',
      chips: 2.5,
      club_pool_after: 2.5,
      diamonds_after: 750,
    });
    expect(receipt(admin, hub, 150, id(502))).toMatchObject({
      success: true,
      scope: 'union',
      chips: 1.5,
      union_bank_after: 1.5,
      diamonds_after: 850,
    });
    expect(receipt(coOwner, standalone, 250, id(501))).toMatchObject({
      success: true,
      replayed: true,
      club_pool_after: 2.5,
    });
    for (const [actor, amount] of [
      [coOwner, 251],
      [admin, 250],
    ] as const)
      expect(receipt(actor, standalone, amount, id(501))).toMatchObject({ success: false });
    for (const amount of [0, 1.5, 1000001, 1001])
      expect(receipt(owner, standalone, amount, id(503))).toMatchObject({ success: false });
    expect(
      one(
        "SELECT count(*), sum(amount), bool_and(category='mint' AND from_type='issuance_reserve' AND idempotency_key LIKE 'diamond-mint:%') FROM chip_ledger"
      )
    ).toBe('2|4.00|t');
    expect(
      one(
        "SELECT count(*),sum(amount),bool_and(issuance_class='spend' AND counterparty='revenue:chip_mint') FROM diamond_transactions"
      )
    ).toBe('2|-400|t');
    expect(one('SELECT count(*),sum(amount) FROM chip_transactions')).toBe('2|4.00');

    // Two real transactions contend in both orderings; wait for PostgreSQL to
    // positively identify the holder rather than sleeping for a guessed time.
    const config = {
      host: socket,
      port: Number(SCRATCH_POSTGRES_PORT),
      database: 'postgres',
      user: env.PGUSER,
      ssl: false,
    };
    const holder = new pg.Client(config);
    const waiter = new pg.Client(config);
    try {
      await Promise.all([holder.connect(), waiter.connect()]);
      const heldBy = (await holder.query('SELECT pg_backend_pid() AS id')).rows[0].id;
      const waits = (await waiter.query('SELECT pg_backend_pid() AS id')).rows[0].id;
      const waitForLock = () =>
        expect
          .poll(() => one(`SELECT ${heldBy} = ANY(pg_blocking_pids(${waits}))`), {
            timeout: 5000,
            interval: 40,
          })
          .toBe('t');
      await holder.query('BEGIN;' + appRole(owner));
      expect(
        (await holder.query(mint(raceMint, 100, id(801)))).rows[0].fn_mint_chips_from_diamonds
          .success
      ).toBe(true);
      const admissionResult = waiter.query(join(raceMint)).then(
        () => 'admitted',
        (err: Error) => err.message
      );
      await waitForLock();
      await holder.query('COMMIT');
      expect(await admissionResult).toContain('still holds chips');
      await holder.query('RESET ROLE; BEGIN;' + join(raceJoin));
      await waiter.query(appRole(owner));
      const mintResult = waiter.query(mint(raceJoin, 100, id(802)));
      await waitForLock();
      await holder.query('COMMIT');
      expect((await mintResult).rows[0].fn_mint_chips_from_diamonds).toMatchObject({
        success: false,
      });
      expect(one(`SELECT chip_treasury FROM clubs WHERE id='${raceJoin}'`)).toBe('0');
      expect(one('SELECT count(*),sum(amount) FROM chip_transactions')).toBe('3|5.00');
      expect(one('SELECT count(*),sum(amount) FROM diamond_transactions')).toBe('3|-500');
    } finally {
      await Promise.allSettled([holder.end(), waiter.end()]);
    }
  } finally {
    if (started) run('pg_ctl', ['-D', data, '-m', 'immediate', 'stop']);
    rmSync(scratch, { recursive: true, force: true });
    rmSync(socket, { recursive: true, force: true });
  }
}, 120_000);
