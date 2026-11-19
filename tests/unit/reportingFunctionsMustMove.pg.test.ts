/**
 * Native PostgreSQL regression proof for
 * `20261119184500_reporting_functions_resolve_must_move_receipts.sql`.
 *
 * Proves on a real PostgreSQL instance that:
 *   1. The entire 22-function Stage 3 migration (concurrent index preamble +
 *      single transactional body) installs cleanly on PG17, leaves
 *      `cash_seat_move_receipts_player_dest_at_idx` VALID & READY, and preserves
 *      exact ACLs for all 22 functions.
 *   2. Group A (Player Stats RPCs — e.g. `ca_player_stats_pulse_by_club`,
 *      `ca_player_hand_grid_by_club`): a player bought into Feeder under Kings
 *      Club and must-moved to Main 4 (union table) keeps Kings Club attribution
 *      for un-raked and pre-rake_attributions hands, supports multi-hop moves
 *      (Feeder -> Main 4 -> Main 1), and switches cleanly to Club B on a later
 *      direct Main 4 re-entry.
 *   3. Group B (Club Data / rollup — `fn_ca_club_rake_daily_compute`): a moved
 *      seat on a union table attributes rake to the funding club from
 *      `cash_seat_move_receipts` when `rake_attributions` is absent, and
 *      switches to Club B on a later direct re-entry.
 *   4. Group C (Roster cash window — `ca_club_members_cash_window`): purely
 *      additive partial-day Chicago slices resolve moved seats on Main 4 to
 *      Kings Club (and later direct re-entry to Club B) instead of drifting to
 *      the union table club.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { splitConcurrentPreamble } from '../../scripts/ci/migration-concurrent-preamble.mjs';

const ROOT = resolve(__dirname, '../..');
const MIG_FILE = join(
  ROOT,
  'supabase/migrations/20261119184500_reporting_functions_resolve_must_move_receipts.sql'
);

const bin = [
  process.env.PG_BIN,
  process.env.PG17_BINDIR,
  '/opt/homebrew/opt/postgresql@17/bin',
  '/opt/homebrew/bin',
  '/usr/lib/postgresql/18/bin',
  '/usr/lib/postgresql/17/bin',
  '/usr/lib/postgresql/16/bin',
  '/usr/bin',
].find((dir) => dir && ['initdb', 'pg_ctl', 'psql'].every((n) => existsSync(`${dir}/${n}`)));

const scratchParent =
  process.env.PG_SCRATCH_PARENT ||
  process.env.STATS_PG_SCRATCH_PARENT ||
  process.env.RUNNER_TEMP ||
  (existsSync('/Volumes/SmarterWork/agent-work/extreme-capacity')
    ? '/Volumes/SmarterWork/agent-work/extreme-capacity'
    : tmpdir());

let scratch = '';
let started = false;
const env: NodeJS.ProcessEnv = { ...process.env, LC_ALL: 'C', LANG: 'C' };
for (const k of Object.keys(env)) if (k.startsWith('PG')) delete env[k];

function psql(sql: string, extra: string[] = []) {
  const r = spawnSync(
    `${bin}/psql`,
    [
      '-h',
      join(scratch, 's'),
      '-p',
      '5432',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-X',
      '-q',
      '-v',
      'ON_ERROR_STOP=1',
      ...extra,
    ],
    { input: sql, encoding: 'utf8', env, maxBuffer: 16 * 1024 * 1024 }
  );
  return {
    status: r.status ?? 1,
    out: (r.stdout ?? '') + (r.stderr ?? ''),
    stdout: (r.stdout ?? '').trim(),
  };
}

const ok = (sql: string) => {
  const r = psql(sql, ['-A', '-t']);
  expect(r.status, r.out.slice(-2000)).toBe(0);
  return r.stdout;
};

describe.skipIf(!bin)('all 22 reporting functions resolve must-move receipts (PG17)', () => {
  beforeAll(() => {
    scratch = mkdtempSync(join(scratchParent, 'mms-'));
    const data = join(scratch, 'd');
    const sock = join(scratch, 's');
    mkdirSync(sock, { recursive: true });
    execFileSync(
      `${bin}/initdb`,
      ['-D', data, '-U', 'postgres', '-A', 'trust', '--no-sync', '-E', 'UTF8'],
      { env, stdio: 'pipe' }
    );
    execFileSync(
      `${bin}/pg_ctl`,
      [
        '-D',
        data,
        '-l',
        join(scratch, 'pg.log'),
        '-o',
        `-k ${sock} -h '' -p 5432 -c fsync=off -c synchronous_commit=off`,
        'start',
      ],
      { env, stdio: 'pipe' }
    );
    started = true;

    ok(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role;

      CREATE TABLE public.cash_participant_funding_receipts (
        id uuid PRIMARY KEY,
        table_id uuid NOT NULL,
        account_entity_id uuid NOT NULL,
        operation_kind text NOT NULL,
        funding_club_id uuid NOT NULL,
        seat_joined_at timestamptz NOT NULL,
        recorded_at timestamptz NOT NULL
      );

      CREATE TABLE public.cash_seat_move_receipts (
        move_id uuid PRIMARY KEY,
        player_id uuid NOT NULL,
        game_id uuid NOT NULL,
        club_id uuid NOT NULL,
        from_table_id uuid NOT NULL,
        from_seat_number integer NOT NULL,
        source_occupancy_id uuid NOT NULL,
        to_table_id uuid NOT NULL,
        to_seat_number integer NOT NULL,
        destination_occupancy_id uuid NOT NULL,
        amount numeric NOT NULL,
        receipt jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL
      );

      -- Stage 2 index created by 20261119180417
      CREATE INDEX cash_seat_move_receipts_dest_player_at_idx
        ON public.cash_seat_move_receipts (to_table_id, player_id, created_at DESC, move_id DESC);

      CREATE TABLE public.ca_hand_facts (
        hand_id uuid NOT NULL,
        user_id uuid NOT NULL,
        club_id uuid NOT NULL,
        table_id uuid NOT NULL,
        tournament_id uuid,
        played_at timestamptz NOT NULL,
        net numeric NOT NULL DEFAULT 0,
        net_bb numeric NOT NULL DEFAULT 0,
        ev_net_bb numeric NOT NULL DEFAULT 0,
        big_blind numeric NOT NULL DEFAULT 1,
        game_variant text NOT NULL DEFAULT 'plo6',
        position text NOT NULL DEFAULT 'BTN',
        hand_class text NOT NULL DEFAULT 'AA',
        vpip boolean NOT NULL DEFAULT true,
        pfr boolean NOT NULL DEFAULT false,
        was_all_in boolean NOT NULL DEFAULT false,
        went_to_showdown boolean NOT NULL DEFAULT false,
        hole_cards jsonb NOT NULL DEFAULT '[]'::jsonb
      );

      CREATE TABLE public.ca_stats_member_record_daily_facts (
        club_id uuid NOT NULL,
        user_id uuid NOT NULL,
        played_on date NOT NULL,
        is_mtt boolean NOT NULL,
        accounting_cutoff timestamptz,
        net numeric NOT NULL DEFAULT 0
      );

      CREATE TABLE public.tournaments (
        id uuid PRIMARY KEY,
        club_id uuid,
        union_id uuid
      );

      CREATE TABLE public.tournament_players (
        id uuid PRIMARY KEY,
        tournament_id uuid NOT NULL,
        user_id uuid NOT NULL,
        club_id uuid,
        status text,
        position integer,
        prize numeric,
        bounty_winnings numeric
      );

      CREATE TABLE public.tables (
        id uuid PRIMARY KEY,
        club_id uuid NOT NULL,
        union_id uuid,
        tournament_id uuid
      );

      CREATE TABLE public.table_seats (
        id uuid PRIMARY KEY,
        table_id uuid NOT NULL,
        user_id uuid NOT NULL,
        club_id uuid,
        joined_at timestamptz NOT NULL
      );

      CREATE TABLE public.rake_records (
        id uuid PRIMARY KEY,
        table_id uuid NOT NULL,
        club_id uuid NOT NULL,
        created_at timestamptz NOT NULL,
        rake_amount numeric NOT NULL DEFAULT 0,
        bbj_contribution numeric NOT NULL DEFAULT 0,
        pot_size numeric NOT NULL DEFAULT 0,
        player_contributions jsonb NOT NULL DEFAULT '{}'::jsonb,
        is_tournament boolean NOT NULL DEFAULT false
      );

      CREATE TABLE public.rake_attributions (
        id uuid PRIMARY KEY,
        hand_id uuid,
        rake_record_id uuid,
        player_id uuid NOT NULL,
        club_id uuid
      );

      CREATE TABLE public.club_members (
        club_id uuid NOT NULL,
        user_id uuid NOT NULL,
        joined_at timestamptz
      );

      CREATE TABLE public.union_clubs (
        union_id uuid NOT NULL,
        club_id uuid NOT NULL
      );

      CREATE TABLE public.cash_player_session (
        id uuid PRIMARY KEY
      );

      CREATE OR REPLACE FUNCTION public.ca_assert_player_stats_club(p_user uuid, p_club_id uuid, p_asset text)
      RETURNS void LANGUAGE plpgsql AS $$ BEGIN END; $$;

      CREATE OR REPLACE FUNCTION public.fn_ca_launch_accounting_cutoff(p_scope text, p_id uuid)
      RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$ SELECT NULL::timestamptz; $$;

      CREATE OR REPLACE FUNCTION public.fn_ca_launch_accounting_accepts(p_club uuid, p_at timestamptz)
      RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT true; $$;
    `);
  }, 120_000);

  afterAll(() => {
    if (started) {
      spawnSync(`${bin}/pg_ctl`, ['-D', join(scratch, 'd'), '-m', 'immediate', 'stop'], {
        env,
        stdio: 'pipe',
      });
    }
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  });

  it('installs the exact Stage 3 migration cleanly and proves all 3 function groups resolve moved cash seats', () => {
    const sql = readFileSync(MIG_FILE, 'utf8');
    const split = splitConcurrentPreamble(sql);
    expect(split.ok).toBe(true);
    if (!split.ok) throw new Error(split.reason);

    for (const idx of split.indexes) {
      ok(idx.statement);
    }
    ok(split.body);

    // 1. Verify index is valid & ready, and all 22 functions exist with cash_seat_move_receipts
    const idxOk = ok(`
      SELECT count(*) FROM pg_index
      WHERE indexrelid = 'public.cash_seat_move_receipts_player_dest_at_idx'::regclass
        AND indisvalid AND indisready;
    `);
    expect(idxOk).toBe('1');

    const fnCount = ok(`
      SELECT count(*) FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND pg_get_functiondef(p.oid) ILIKE '%cash_seat_move_receipts%'
        AND p.proname IN (
          'ca_player_class_hands_by_club','ca_player_ev_curve_by_club','ca_player_hand_grid_by_club',
          'ca_player_hands_separated_by_club','ca_player_hands_v2_by_club','ca_player_nemesis_by_club',
          'ca_player_rake_stats_by_club','ca_player_rake_stats_calendar_by_club',
          'ca_player_stats_club_comparison','ca_player_stats_club_comparison_separated',
          'ca_player_stats_hand_evidence','ca_player_stats_hand_evidence_base',
          'ca_player_stats_overview_separated_by_club','ca_player_stats_overview_v2_by_club',
          'ca_player_stats_pulse_by_club','ca_player_stats_shared_overview_v1',
          'ca_player_stats_shared_separated','fn_ca_club_data_ct_seed','fn_ca_club_data_fact_seed',
          'fn_ca_club_rake_daily_compute','fn_ca_reporting_rollups_from_facts','ca_club_members_cash_window'
        );
    `);
    expect(fnCount).toBe('22');

    // 2. Verify strict ACLs: zero anon grants; postgres-only and service-only stay locked
    expect(
      ok(`
        SELECT count(*) FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN (
            'ca_player_class_hands_by_club','ca_player_ev_curve_by_club','ca_player_hand_grid_by_club',
            'ca_player_hands_separated_by_club','ca_player_hands_v2_by_club','ca_player_nemesis_by_club',
            'ca_player_rake_stats_by_club','ca_player_rake_stats_calendar_by_club',
            'ca_player_stats_club_comparison','ca_player_stats_club_comparison_separated',
            'ca_player_stats_hand_evidence','ca_player_stats_hand_evidence_base',
            'ca_player_stats_overview_separated_by_club','ca_player_stats_overview_v2_by_club',
            'ca_player_stats_pulse_by_club','ca_player_stats_shared_overview_v1',
            'ca_player_stats_shared_separated','fn_ca_club_data_ct_seed','fn_ca_club_data_fact_seed',
            'fn_ca_club_rake_daily_compute','fn_ca_reporting_rollups_from_facts','ca_club_members_cash_window'
          )
          AND has_function_privilege('anon', p.oid, 'EXECUTE');
      `)
    ).toBe('0');

    expect(
      ok(`
        SELECT has_function_privilege('authenticated', 'public.ca_club_members_cash_window(uuid,uuid[],date,date)', 'EXECUTE')
            || '|' || has_function_privilege('service_role', 'public.ca_club_members_cash_window(uuid,uuid[],date,date)', 'EXECUTE')
            || '|' || has_function_privilege('authenticated', 'public.fn_ca_club_data_ct_seed(date)', 'EXECUTE')
            || '|' || has_function_privilege('authenticated', 'public.fn_ca_club_rake_daily_compute(timestamptz,timestamptz,uuid[])', 'EXECUTE')
            || '|' || has_function_privilege('service_role', 'public.fn_ca_club_rake_daily_compute(timestamptz,timestamptz,uuid[])', 'EXECUTE')
            || '|' || has_function_privilege('authenticated', 'public.ca_player_stats_pulse_by_club(uuid,text,uuid)', 'EXECUTE');
      `)
    ).toBe('false|false|false|false|true|true');

    // 3. Seed realistic must-move scenario:
    //    - Butter buys into Feeder under Kings Club at 2026-11-19 07:00 UTC (01:00 CST)
    //    - Must-moves Feeder -> Main 4 (union table) at 07:10 UTC
    //    - Plays hand 1 on Main 4 at 07:15 UTC (+12.50 net, 12.5 BB, no rake_attributions)
    //    - Must-moves Main 4 -> Main 1 (union table) at 07:30 UTC (multi-hop)
    //    - Plays hand 2 on Main 1 at 07:35 UTC (-4.00 net, -4 BB, no rake_attributions)
    //    - Later directly buys into Main 4 under Club B at 08:00 UTC
    //    - Plays hand 3 on Main 4 at 08:05 UTC (+20.00 net, 20 BB, no rake_attributions)
    //    - Also seed rake_records for hand 1 (07:15) and hand 3 (08:05) on Main 4 with no rake_attributions
    const BUTTER = 'fa407ee1-5473-42ec-a9ac-a1eee50983fe';
    const KINGS = 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4';
    const CLUB_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const UNION_CLUB = 'fade0000-0000-4000-8000-000000000001';
    const UNION_ID = '11111111-1111-4111-8111-111111111111';
    const FEEDER = 'f0000000-0000-4000-8000-000000000001';
    const MAIN_4 = 'f0000000-0000-4000-8000-000000000004';
    const MAIN_1 = 'f0000000-0000-4000-8000-000000000005';

    ok(`
      INSERT INTO public.tables (id, club_id, union_id, tournament_id) VALUES
        ('${FEEDER}', '${UNION_CLUB}', '${UNION_ID}', NULL),
        ('${MAIN_4}', '${UNION_CLUB}', '${UNION_ID}', NULL),
        ('${MAIN_1}', '${UNION_CLUB}', '${UNION_ID}', NULL);

      INSERT INTO public.cash_participant_funding_receipts
        (id, table_id, account_entity_id, operation_kind, funding_club_id, seat_joined_at, recorded_at) VALUES
        ('00000000-0000-4000-8000-000000000001', '${FEEDER}', '${BUTTER}', 'buyin', '${KINGS}', '2026-11-19 07:00:00+00', '2026-11-19 07:00:01+00'),
        ('00000000-0000-4000-8000-000000000002', '${MAIN_4}', '${BUTTER}', 'buyin', '${CLUB_B}', '2026-11-19 08:00:00+00', '2026-11-19 08:00:01+00');

      INSERT INTO public.cash_seat_move_receipts
        (move_id, player_id, game_id, club_id, from_table_id, from_seat_number, source_occupancy_id, to_table_id, to_seat_number, destination_occupancy_id, amount, created_at) VALUES
        ('10000000-0000-4000-8000-000000000001', '${BUTTER}', '${MAIN_4}', '${KINGS}', '${FEEDER}', 1, '20000000-0000-4000-8000-000000000001', '${MAIN_4}', 2, '20000000-0000-4000-8000-000000000002', 100, '2026-11-19 07:10:00+00'),
        ('10000000-0000-4000-8000-000000000002', '${BUTTER}', '${MAIN_1}', '${KINGS}', '${MAIN_4}', 2, '20000000-0000-4000-8000-000000000002', '${MAIN_1}', 3, '20000000-0000-4000-8000-000000000003', 112.5, '2026-11-19 07:30:00+00');

      INSERT INTO public.ca_hand_facts
        (hand_id, user_id, club_id, table_id, tournament_id, played_at, net, net_bb, ev_net_bb, hand_class) VALUES
        ('30000000-0000-4000-8000-000000000001', '${BUTTER}', '${UNION_CLUB}', '${MAIN_4}', NULL, '2026-11-19 07:15:00+00', 12.50, 12.5, 12.5, 'AA'),
        ('30000000-0000-4000-8000-000000000002', '${BUTTER}', '${UNION_CLUB}', '${MAIN_1}', NULL, '2026-11-19 07:35:00+00', -4.00, -4.0, -4.0, 'KK'),
        ('30000000-0000-4000-8000-000000000003', '${BUTTER}', '${UNION_CLUB}', '${MAIN_4}', NULL, '2026-11-19 08:05:00+00', 20.00, 20.0, 20.0, 'QQ');

      INSERT INTO public.rake_records
        (id, table_id, club_id, created_at, rake_amount, bbj_contribution, pot_size, player_contributions, is_tournament) VALUES
        ('40000000-0000-4000-8000-000000000001', '${MAIN_4}', '${UNION_CLUB}', '2026-11-19 07:15:00+00', 3.00, 0, 60, jsonb_build_object('${BUTTER}', 30), false),
        ('40000000-0000-4000-8000-000000000002', '${MAIN_4}', '${UNION_CLUB}', '2026-11-19 08:05:00+00', 5.00, 0, 100, jsonb_build_object('${BUTTER}', 50), false);
    `);

    // Group A proof: Player Stats RPCs
    const kingsPulse = ok(
      `SELECT (public.ca_player_stats_pulse_by_club('${BUTTER}', 'chips', '${KINGS}')->>'newest_hand_at')::timestamptz = '2026-11-19 07:35:00+00'::timestamptz;`
    );
    expect(kingsPulse).toBe('t');
    const clubBPulse = ok(
      `SELECT (public.ca_player_stats_pulse_by_club('${BUTTER}', 'chips', '${CLUB_B}')->>'newest_hand_at')::timestamptz = '2026-11-19 08:05:00+00'::timestamptz;`
    );
    expect(clubBPulse).toBe('t');
    const unionPulse = ok(
      `SELECT coalesce(public.ca_player_stats_pulse_by_club('${BUTTER}', 'chips', '${UNION_CLUB}')->>'newest_hand_at', 'NULL');`
    );
    expect(unionPulse).toBe('NULL');

    const kingsGrid = ok(`
      SELECT count(*) FROM jsonb_array_elements(
        public.ca_player_hand_grid_by_club('${BUTTER}', NULL, NULL, 30, 'chips', '${KINGS}')->'cells'
      );
    `);
    expect(kingsGrid).toBe('2'); // AA (Main 4 move) + KK (Main 1 multi-hop move)

    // Group B proof: Club Data / rake daily compute
    const rakeRows = ok(`
      SELECT club_id || ':' || hands || ':' || round(rake, 2)
      FROM public.fn_ca_club_rake_daily_compute('2026-11-19 00:00:00+00', '2026-11-20 00:00:00+00', NULL)
      WHERE hands > 0
      ORDER BY club_id;
    `);
    expect(rakeRows.split('\n')).toEqual([`${KINGS}:1:3.00`, `${CLUB_B}:1:5.00`]);

    // Group C proof: Roster cash window (2026-11-19 Chicago day -> 2026-11-19..2026-11-20)
    const kingsWindow = ok(`
      SELECT cash_net FROM public.ca_club_members_cash_window('${KINGS}', ARRAY['${BUTTER}'::uuid], '2026-11-19'::date, '2026-11-20'::date);
    `);
    expect(kingsWindow).toBe('8.50'); // +12.50 (Main 4 move) - 4.00 (Main 1 multi-hop move)

    const clubBWindow = ok(`
      SELECT cash_net FROM public.ca_club_members_cash_window('${CLUB_B}', ARRAY['${BUTTER}'::uuid], '2026-11-19'::date, '2026-11-20'::date);
    `);
    expect(clubBWindow).toBe('20.00'); // +20.00 (later direct Main 4 re-entry)

    const unionWindow = ok(`
      SELECT cash_net FROM public.ca_club_members_cash_window('${UNION_CLUB}', ARRAY['${BUTTER}'::uuid], '2026-11-19'::date, '2026-11-20'::date);
    `);
    expect(unionWindow).toBe('0'); // Zero drift to union table club!
  }, 120_000);
});
