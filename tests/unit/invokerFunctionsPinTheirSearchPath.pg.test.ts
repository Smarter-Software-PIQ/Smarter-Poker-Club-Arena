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

/**
 * INVOKER FUNCTIONS PIN THEIR SEARCH PATH (2026-11-27), on real isolated
 * PostgreSQL: migration 20261127005018 run against stand-ins with the exact
 * production signatures.
 *
 *   - Before it, an unpinned function resolves an unqualified table through
 *     the caller's path, so a session's temporary table shadows the public
 *     one. After it, the same call writes to public.
 *   - It pins exactly its 23, leaves the documented exemptions alone, keeps
 *     every grant, and declares the watched guard it alters.
 *   - It refuses (and rolls back) if anything moves a grant while it runs.
 *   - On a fresh rebuild where none of the functions exist, it is a no-op.
 *   - The two exemption reasons are real: a SET clause stops a committing
 *     procedure at its first COMMIT, and stops the planner inlining a SQL
 *     helper.
 */
const MIGRATION = 'supabase/migrations/20261127005018_invoker_functions_pin_their_search_path.sql';

const ROLES = `
DO $r$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $r$;`;

const T = 'RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$';
const STUB = `
CREATE SCHEMA smarter_private;
CREATE TABLE public.notice_board_entries (club_id uuid, content text, type text, related_id text);
CREATE TABLE public.diamond_transactions (type text, transaction_type text, source text, amount numeric, description text);
CREATE TABLE public.guard_declarations (proname text, ref text, config text);

-- The 23 the migration pins, with their production signatures.
CREATE FUNCTION public.fn_accounting_close_report_is_ready(p_report jsonb) RETURNS boolean
  LANGUAGE sql IMMUTABLE AS $$ SELECT p_report->>'status' = 'ready' $$;
CREATE FUNCTION public.fn_accounting_tournament_source_terms_at(uuid, timestamptz, jsonb) RETURNS timestamptz
  LANGUAGE sql STABLE AS $$ SELECT $2 $$;
CREATE FUNCTION public.fn_agent_commission_paid_by_period(uuid, uuid, timestamptz) RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.fn_ca_bust_backlog_stalled(integer) RETURNS TABLE(n integer)
  LANGUAGE sql STABLE AS $$ SELECT $1 $$;
CREATE FUNCTION public.fn_ca_guard_watchlist() RETURNS text[]
  LANGUAGE sql STABLE AS $$ SELECT ARRAY['fn_ca_guard_watchlist'] $$;
CREATE FUNCTION public.fn_ca_hand_notes_touch() ${T};
CREATE FUNCTION public.fn_ca_hand_tags_ok(text[]) RETURNS boolean
  LANGUAGE sql IMMUTABLE AS $$ SELECT $1 IS NULL OR cardinality($1) < 10 $$;
CREATE FUNCTION public.fn_ca_horse_split_op_key(uuid, text, uuid, uuid) RETURNS uuid
  LANGUAGE sql IMMUTABLE AS $$ SELECT md5($2)::uuid $$;
CREATE FUNCTION public.fn_ca_knockout_door_stalled(integer) RETURNS TABLE(n integer)
  LANGUAGE sql STABLE AS $$ SELECT $1 $$;
CREATE FUNCTION public.fn_ca_normalize_alert_text(text) RETURNS text
  LANGUAGE sql IMMUTABLE AS $$ SELECT lower($1) $$;
CREATE FUNCTION public.fn_ca_promo_profit_generation_immutable() ${T};
CREATE FUNCTION public.fn_ca_stable_dedupe_key(text) RETURNS text
  LANGUAGE sql IMMUTABLE AS $$ SELECT $1 $$;
CREATE FUNCTION public.fn_ca_stranded_fee_reconciliations_immutable() ${T};
CREATE FUNCTION public.fn_diamond_kind_row_label(text, bigint) RETURNS text
  LANGUAGE sql IMMUTABLE AS $$ SELECT $1 $$;
CREATE FUNCTION public.fn_diamond_ledger_line(text, text, text, bigint, text) RETURNS text
  LANGUAGE sql IMMUTABLE AS $$ SELECT public.fn_diamond_kind_row_label($1, $4) $$;
CREATE FUNCTION public.fn_enforce_tournament_capacity() ${T};
-- The production body, unqualified table and all.
CREATE FUNCTION public.fn_escalate_cashout_to_notice_board(p_club_id uuid, p_cashout_id uuid, p_reason text)
  RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM notice_board_entries WHERE related_id = p_cashout_id::text AND type = 'escalation') THEN
    RAISE EXCEPTION 'Cashout already escalated.';
  END IF;
  INSERT INTO notice_board_entries (club_id, content, type, related_id)
  VALUES (p_club_id, p_reason, 'escalation', p_cashout_id::text);
END; $$;
CREATE FUNCTION public.fn_platform_push_recipient_guard() ${T};
CREATE FUNCTION public.fn_post_commit_handoff_is_a_warning() ${T};
CREATE FUNCTION public.fn_sp_relaunch_award_guard() ${T};
CREATE FUNCTION public.fn_union_treasury_is_collection(p_category text) RETURNS boolean
  LANGUAGE sql IMMUTABLE AS $$ SELECT p_category IN ('rake','bbj_contribution','spin_entry','promo') $$;
CREATE FUNCTION public.player_line(t public.diamond_transactions) RETURNS text
  LANGUAGE sql IMMUTABLE AS $$ SELECT public.fn_diamond_ledger_line(t.type, t.transaction_type, t.source, t.amount::bigint, t.description) $$;
CREATE FUNCTION public.zz_a_payout_row_carries_its_key() ${T};

-- Some of the documented exemptions.
CREATE PROCEDURE public.sp_union_pnl_projection_build(integer, integer, integer, integer)
  LANGUAGE plpgsql AS $$ BEGIN PERFORM 1; COMMIT; PERFORM 2; END $$;
CREATE PROCEDURE smarter_private.weekly_prep_shard(integer, integer)
  LANGUAGE plpgsql AS $$ BEGIN COMMIT; END $$;
CREATE FUNCTION public.fn_ca_club_acct_in_snapshot(p_xmin xid, p_snap pg_snapshot) RETURNS boolean
  LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_xmin::text::bigint < 3 THEN true
              ELSE pg_visible_in_snapshot(p_xmin::text::xid8, p_snap) END $$;
CREATE FUNCTION public.fn_gto_v31_public215_keys(p jsonb, keys text[]) RETURNS boolean
  LANGUAGE sql IMMUTABLE AS $$ SELECT jsonb_typeof(p) = 'object' $$;

-- The declaration records the definition it baselines, so the test can see it
-- ran after the ALTER.
CREATE FUNCTION public.fn_ca_declare_guard_redefinition(p_proname text, p_ref text) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.guard_declarations
  SELECT p_proname, p_ref, p.proconfig::text FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = p_proname;
  RETURN 'h';
END $$;

-- Grants shaped like production: browser roles on some, PUBLIC on others.
REVOKE ALL ON FUNCTION public.fn_union_treasury_is_collection(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_union_treasury_is_collection(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_escalate_cashout_to_notice_board(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_escalate_cashout_to_notice_board(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_stable_dedupe_key(text) TO anon, authenticated;
`;

const PINNED_NAMES = [
  'fn_accounting_close_report_is_ready',
  'fn_accounting_tournament_source_terms_at',
  'fn_agent_commission_paid_by_period',
  'fn_ca_bust_backlog_stalled',
  'fn_ca_guard_watchlist',
  'fn_ca_hand_notes_touch',
  'fn_ca_hand_tags_ok',
  'fn_ca_horse_split_op_key',
  'fn_ca_knockout_door_stalled',
  'fn_ca_normalize_alert_text',
  'fn_ca_promo_profit_generation_immutable',
  'fn_ca_stable_dedupe_key',
  'fn_ca_stranded_fee_reconciliations_immutable',
  'fn_diamond_kind_row_label',
  'fn_diamond_ledger_line',
  'fn_enforce_tournament_capacity',
  'fn_escalate_cashout_to_notice_board',
  'fn_platform_push_recipient_guard',
  'fn_post_commit_handoff_is_a_warning',
  'fn_sp_relaunch_award_guard',
  'fn_union_treasury_is_collection',
  'player_line',
  'zz_a_payout_row_carries_its_key',
];
const EXEMPT_NAMES = [
  'sp_union_pnl_projection_build',
  'weekly_prep_shard',
  'fn_ca_club_acct_in_snapshot',
  'fn_gto_v31_public215_keys',
];

const CLUB = '11111111-1111-1111-1111-111111111111';
const CASHOUT = '22222222-2222-2222-2222-222222222222';

it('pins the 23, keeps every grant and exemption, and stops a temp table shadowing public', () => {
  const root = resolve(__dirname, '../..');
  const bin = [
    '/opt/homebrew/bin',
    '/usr/lib/postgresql/18/bin',
    '/usr/lib/postgresql/17/bin',
    '/usr/lib/postgresql/16/bin',
    '/usr/bin',
  ].find((dir) => ['initdb', 'pg_ctl', 'psql'].every((name) => existsSync(`${dir}/${name}`)));
  if (!bin) throw new Error('PostgreSQL binaries are required for the search_path regression');
  // PostgreSQL refuses to run its server as root; a root shell runs it as an
  // unprivileged system user in a world-writable scratch directory.
  const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const serverUser = 'nobody';
  const cache = asRoot ? tmpdir() : resolve(root, 'node_modules/.cache');
  mkdirSync(cache, { recursive: true });
  const scratch = mkdtempSync(resolve(cache, 'search-path-'));
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
  const sql = (db: string, text: string) =>
    run('psql', ['-X', '-d', db, '-v', 'ON_ERROR_STOP=1', '-q'], text);
  const one = (db: string, text: string) =>
    run('psql', ['-X', '-d', db, '-At', '-v', 'ON_ERROR_STOP=1', '-c', text]).trim();
  const migration = readFileSync(resolve(root, MIGRATION), 'utf8');
  const configs = (db: string) =>
    Object.fromEntries(
      one(
        db,
        `SELECT string_agg(p.proname || '=' || COALESCE(p.proconfig::text, '-'), E'\\n' ORDER BY p.proname)
           FROM pg_proc p WHERE p.pronamespace IN ('public'::regnamespace, 'smarter_private'::regnamespace)
            AND p.proname <> 'fn_ca_declare_guard_redefinition'`
      )
        .split('\n')
        .map((line) => {
          const cut = line.indexOf('=');
          return [line.substring(0, cut), line.substring(cut + 1)] as [string, string];
        })
    );
  const acls = (db: string) =>
    one(
      db,
      `SELECT string_agg(p.oid::regprocedure::text || ' ' || COALESCE(p.proacl::text, '-'), E'\\n' ORDER BY p.oid::regprocedure::text)
         FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace`
    );
  // A session that owns a temporary notice_board_entries asks for an escalation.
  const escalateWithShadow = (db: string) =>
    sql(
      db,
      `CREATE TEMP TABLE notice_board_entries (club_id uuid, content text, type text, related_id text);
       SELECT public.fn_escalate_cashout_to_notice_board('${CLUB}', gen_random_uuid(), 'late');`
    );

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
    sql('postgres', ROLES);
    for (const db of ['fresh', 'seeded', 'tamper']) sql('postgres', `CREATE DATABASE ${db};`);

    // A fresh rebuild holds none of these functions: the migration is a no-op.
    expect(() => sql('fresh', migration)).not.toThrow();

    // BEFORE: every one of them is mutable, and the caller's temp table wins.
    sql('seeded', STUB);
    const before = configs('seeded');
    for (const name of [...PINNED_NAMES, ...EXEMPT_NAMES]) expect(before[name], name).toBe('-');
    const grantsBefore = acls('seeded');
    escalateWithShadow('seeded');
    expect(one('seeded', 'SELECT count(*) FROM public.notice_board_entries')).toBe('0');

    sql('seeded', migration);

    // AFTER: exactly the 23 hold exactly the path, the exemptions hold none.
    const after = configs('seeded');
    for (const name of PINNED_NAMES)
      expect(after[name], name).toBe('{"search_path=public, pg_temp"}');
    for (const name of EXEMPT_NAMES) expect(after[name], `${name} stays unpinned`).toBe('-');
    expect(acls('seeded')).toBe(grantsBefore);
    // the watched guard was declared once, after its ALTER
    expect(
      one(
        'seeded',
        'SELECT count(*) || proname || config FROM guard_declarations GROUP BY proname, config'
      )
    ).toBe('1fn_ca_guard_watchlist{"search_path=public, pg_temp"}');
    expect(one('seeded', 'SELECT ref FROM guard_declarations')).toBe(
      'migration 20261127005018_invoker_functions_pin_their_search_path'
    );

    // The same shadowed call now writes to public, and behaviour is otherwise unchanged.
    escalateWithShadow('seeded');
    expect(one('seeded', 'SELECT count(*) FROM public.notice_board_entries')).toBe('1');
    expect(() =>
      sql(
        'seeded',
        `SELECT public.fn_escalate_cashout_to_notice_board('${CLUB}', '${CASHOUT}', 'one');
         SELECT public.fn_escalate_cashout_to_notice_board('${CLUB}', '${CASHOUT}', 'two');`
      )
    ).toThrow(/Cashout already escalated/);
    expect(one('seeded', `SELECT public.fn_union_treasury_is_collection('rake')::text`)).toBe(
      'true'
    );
    expect(
      one(
        'seeded',
        `SELECT public.player_line(ROW('earn','plinko_win',NULL,5,NULL)::public.diamond_transactions)`
      )
    ).toBe('earn');

    // Applying it again changes nothing.
    sql('seeded', migration);
    expect(configs('seeded')).toEqual(after);
    expect(acls('seeded')).toBe(grantsBefore);

    // A grant that moves while it runs refuses the whole transaction.
    sql('tamper', STUB);
    sql(
      'tamper',
      `CREATE FUNCTION public.fn_test_revoke_on_alter() RETURNS event_trigger LANGUAGE plpgsql AS $$
       BEGIN
         REVOKE EXECUTE ON FUNCTION public.fn_union_treasury_is_collection(text) FROM authenticated;
       END $$;
       CREATE EVENT TRIGGER test_revoke_on_alter ON ddl_command_end WHEN TAG IN ('ALTER FUNCTION')
         EXECUTE FUNCTION public.fn_test_revoke_on_alter();`
    );
    expect(() => sql('tamper', migration)).toThrow(
      /EXECUTE grants changed on: public\.fn_union_treasury_is_collection\(text\)/
    );
    const untouched = configs('tamper');
    for (const name of PINNED_NAMES) expect(untouched[name], `${name} rolled back`).toBe('-');
    expect(one('tamper', 'SELECT count(*) FROM guard_declarations')).toBe('0');

    // EXEMPTION 1: a SET clause stops a committing procedure at its first COMMIT.
    expect(() =>
      sql('seeded', 'CALL public.sp_union_pnl_projection_build(1, 0, 1, 1);')
    ).not.toThrow();
    sql(
      'seeded',
      'ALTER PROCEDURE public.sp_union_pnl_projection_build(integer, integer, integer, integer) SET search_path = public, pg_temp;'
    );
    expect(() => sql('seeded', 'CALL public.sp_union_pnl_projection_build(1, 0, 1, 1);')).toThrow(
      /invalid transaction termination/
    );

    // EXEMPTION 2: the unpinned snapshot helper is inlined into its caller; a
    // pinned function is called once per row instead.
    const plan = (call: string) =>
      one(
        'seeded',
        `EXPLAIN (VERBOSE, COSTS OFF) WITH v AS MATERIALIZED (SELECT '5'::xid AS x, 'rake'::text AS c) SELECT ${call} FROM v`
      );
    expect(plan(`public.fn_ca_club_acct_in_snapshot(v.x, pg_current_snapshot())`)).not.toContain(
      'fn_ca_club_acct_in_snapshot'
    );
    expect(plan('public.fn_union_treasury_is_collection(v.c)')).toContain(
      'fn_union_treasury_is_collection'
    );
  } finally {
    if (started) run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
    rmSync(scratch, { recursive: true, force: true });
    rmSync(socket, { recursive: true, force: true });
  }
}, 120_000);
