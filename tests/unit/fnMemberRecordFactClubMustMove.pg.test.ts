/**
 * Native PostgreSQL regression proof for
 * `20261119180417_fn_member_record_fact_club_resolves_must_move_receipts.sql`.
 *
 * Proves on a real PostgreSQL instance that:
 *   1. On the preimage `fn_member_record_fact_club`, a player bought into a
 *      Feeder table under Kings Club and must-moved to Main 4 (a union table)
 *      loses Kings Club attribution on un-raked hands and on raked hands
 *      before post-commit `rake_attributions` arrives (drifting to union club).
 *   2. After applying the exact migration (concurrent index preamble + single
 *      transaction body), `fn_member_record_fact_club` resolves:
 *        - Feeder -> Main 4 must-move (un-raked & pre-rake_attributions) -> Kings Club
 *        - Multi-hop Feeder -> Main 4 -> Main 1 -> Kings Club
 *        - Earlier Main 4 buy-in (Club A) superseded by later Feeder->Main 4 move (Club B) -> Club B
 *        - Earlier Feeder->Main 4 move (Club A) superseded by later direct Main 4 buy-in (Club B) -> Club B
 *        - Direct buy-in on Main 4 with no moves -> buy-in club
 *        - Tournament hand -> `tournament_players.club_id` (ignores cash receipts)
 *   3. The concurrent index is VALID and READY, and ACLs revoke EXECUTE from
 *      PUBLIC, anon, authenticated, and service_role.
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
  'supabase/migrations/20261119180417_fn_member_record_fact_club_resolves_must_move_receipts.sql'
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

describe.skipIf(!bin)('fn_member_record_fact_club must-move funding attribution (PG17)', () => {
  beforeAll(() => {
    scratch = mkdtempSync(join(scratchParent, 'mmf-'));
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

      CREATE TABLE public.ca_hand_facts (
        hand_id uuid NOT NULL,
        user_id uuid NOT NULL,
        club_id uuid NOT NULL,
        table_id uuid,
        tournament_id uuid,
        played_at timestamptz NOT NULL
      );

      CREATE TABLE public.cash_participant_funding_receipts (
        id uuid PRIMARY KEY,
        operation_kind text NOT NULL,
        table_id uuid NOT NULL,
        account_entity_id uuid NOT NULL,
        funding_club_id uuid NOT NULL,
        seat_joined_at timestamptz NOT NULL,
        recorded_at timestamptz NOT NULL
      );

      CREATE TABLE public.cash_seat_move_receipts (
        move_id uuid PRIMARY KEY,
        player_id uuid NOT NULL,
        club_id uuid NOT NULL,
        from_table_id uuid NOT NULL,
        to_table_id uuid NOT NULL,
        created_at timestamptz NOT NULL
      );

      CREATE TABLE public.tournament_players (
        tournament_id uuid NOT NULL,
        user_id uuid NOT NULL,
        club_id uuid NOT NULL
      );

      CREATE TABLE public.rake_attributions (
        hand_id uuid NOT NULL,
        player_id uuid NOT NULL,
        club_id uuid NOT NULL
      );

      -- Preimage from 20261018135655 (before our fix):
      CREATE FUNCTION public.fn_member_record_fact_club(f public.ca_hand_facts) RETURNS uuid
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
        SELECT coalesce(
          (SELECT x.funding_club_id FROM public.cash_participant_funding_receipts x
           WHERE f.tournament_id IS NULL AND x.operation_kind = 'buyin' AND x.table_id = f.table_id
             AND x.account_entity_id = f.user_id AND x.seat_joined_at <= f.played_at
           ORDER BY x.seat_joined_at DESC, x.recorded_at DESC, x.id DESC LIMIT 1),
          (SELECT tp.club_id FROM public.tournament_players tp WHERE tp.tournament_id = f.tournament_id AND tp.user_id = f.user_id),
          (SELECT ra.club_id FROM public.rake_attributions ra WHERE ra.hand_id = f.hand_id AND ra.player_id = f.user_id),
          f.club_id);
      $$;
      REVOKE ALL ON FUNCTION public.fn_member_record_fact_club(public.ca_hand_facts) FROM PUBLIC, anon, authenticated, service_role;

      -- Seed Butter's exact scenario + edge cases:
      -- Clubs:
      --   UNION = fade0000-0000-0000-0000-000000000001
      --   KINGS = a41434bb-8d0c-400a-8f0d-e8b3d65afed4
      --   OTHER = 22222222-2222-2222-2222-222222222222
      -- Tables:
      --   FEEDER = 06de4ba8-dc37-4cff-ba35-fa70692dccd9
      --   MAIN4  = eece8f7f-f58e-4a9c-936a-af0a7e548655
      --   MAIN1  = 33333333-3333-3333-3333-333333333333
      --   REENTRY_TBL = 44444444-4444-4444-4444-444444444444
      --   DIRECT_TBL  = 55555555-5555-5555-5555-555555555555
      -- Player:
      --   BUTTER = fa407ee1-5473-42ec-a9ac-a1eee50983fe

      -- 1) Feeder buy-in under Kings Club at 01:09:17Z
      INSERT INTO public.cash_participant_funding_receipts VALUES
        ('ef526a54-1650-477d-970c-0e0c35dd9afe', 'buyin',
         '06de4ba8-dc37-4cff-ba35-fa70692dccd9', 'fa407ee1-5473-42ec-a9ac-a1eee50983fe',
         'a41434bb-8d0c-400a-8f0d-e8b3d65afed4',
         '2026-11-19T01:09:17Z', '2026-11-19T01:09:17Z');

      -- 2) Must-move Feeder -> Main 4 at 01:59:33Z (Kings Club preserved)
      INSERT INTO public.cash_seat_move_receipts VALUES
        ('5690baec-7338-48f1-8fb2-a43459771f2d', 'fa407ee1-5473-42ec-a9ac-a1eee50983fe',
         'a41434bb-8d0c-400a-8f0d-e8b3d65afed4',
         '06de4ba8-dc37-4cff-ba35-fa70692dccd9', 'eece8f7f-f58e-4a9c-936a-af0a7e548655',
         '2026-11-19T01:59:33Z');

      -- 3) Multi-hop move Main 4 -> Main 1 at 03:00:00Z (Kings Club preserved)
      INSERT INTO public.cash_seat_move_receipts VALUES
        ('66666666-6666-6666-6666-666666666666', 'fa407ee1-5473-42ec-a9ac-a1eee50983fe',
         'a41434bb-8d0c-400a-8f0d-e8b3d65afed4',
         'eece8f7f-f58e-4a9c-936a-af0a7e548655', '33333333-3333-3333-3333-333333333333',
         '2026-11-19T03:00:00Z');

      -- 4) Re-entry scenario on REENTRY_TBL:
      --    01:00Z direct buy-in under OTHER club
      --    02:00Z must-move onto REENTRY_TBL under KINGS club
      --    03:00Z direct buy-in onto REENTRY_TBL under OTHER club
      INSERT INTO public.cash_participant_funding_receipts VALUES
        ('77777777-7777-7777-7777-777777777771', 'buyin',
         '44444444-4444-4444-4444-444444444444', 'fa407ee1-5473-42ec-a9ac-a1eee50983fe',
         '22222222-2222-2222-2222-222222222222',
         '2026-11-19T01:00:00Z', '2026-11-19T01:00:00Z'),
        ('77777777-7777-7777-7777-777777777773', 'buyin',
         '44444444-4444-4444-4444-444444444444', 'fa407ee1-5473-42ec-a9ac-a1eee50983fe',
         '22222222-2222-2222-2222-222222222222',
         '2026-11-19T03:00:00Z', '2026-11-19T03:00:00Z');
      INSERT INTO public.cash_seat_move_receipts VALUES
        ('77777777-7777-7777-7777-777777777772', 'fa407ee1-5473-42ec-a9ac-a1eee50983fe',
         'a41434bb-8d0c-400a-8f0d-e8b3d65afed4',
         '06de4ba8-dc37-4cff-ba35-fa70692dccd9', '44444444-4444-4444-4444-444444444444',
         '2026-11-19T02:00:00Z');

      -- 5) Direct buy-in with no moves on DIRECT_TBL
      INSERT INTO public.cash_participant_funding_receipts VALUES
        ('88888888-8888-8888-8888-888888888888', 'buyin',
         '55555555-5555-5555-5555-555555555555', 'fa407ee1-5473-42ec-a9ac-a1eee50983fe',
         'a41434bb-8d0c-400a-8f0d-e8b3d65afed4',
         '2026-11-19T01:00:00Z', '2026-11-19T01:00:00Z');

      -- 6) Tournament player
      INSERT INTO public.tournament_players VALUES
        ('99999999-9999-9999-9999-999999999999', 'fa407ee1-5473-42ec-a9ac-a1eee50983fe',
         '22222222-2222-2222-2222-222222222222');

      -- Hand facts:
      INSERT INTO public.ca_hand_facts VALUES
        -- h1: Butter un-raked hand on Main 4 after Feeder->Main 4 move (no rake_attributions)
        ('10000000-0000-0000-0000-000000000001', 'fa407ee1-5473-42ec-a9ac-a1eee50983fe',
         'fade0000-0000-0000-0000-000000000001', 'eece8f7f-f58e-4a9c-936a-af0a7e548655', NULL,
         '2026-11-19T02:05:00Z'),
        -- h2: Multi-hop Main 4 -> Main 1 un-raked hand
        ('10000000-0000-0000-0000-000000000002', 'fa407ee1-5473-42ec-a9ac-a1eee50983fe',
         'fade0000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', NULL,
         '2026-11-19T03:05:00Z'),
        -- h3: Re-entry hand at 02:30Z (after move under KINGS, after earlier buyin under OTHER)
        ('10000000-0000-0000-0000-000000000003', 'fa407ee1-5473-42ec-a9ac-a1eee50983fe',
         'fade0000-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', NULL,
         '2026-11-19T02:30:00Z'),
        -- h4: Re-entry hand at 03:30Z (after later direct buyin under OTHER, after 02:00Z move under KINGS)
        ('10000000-0000-0000-0000-000000000004', 'fa407ee1-5473-42ec-a9ac-a1eee50983fe',
         'fade0000-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', NULL,
         '2026-11-19T03:30:00Z'),
        -- h5: Direct buy-in hand on DIRECT_TBL
        ('10000000-0000-0000-0000-000000000005', 'fa407ee1-5473-42ec-a9ac-a1eee50983fe',
         'fade0000-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555', NULL,
         '2026-11-19T01:30:00Z'),
        -- h6: Tournament hand on Main 4 table_id (must use tournament_players, not cash move)
        ('10000000-0000-0000-0000-000000000006', 'fa407ee1-5473-42ec-a9ac-a1eee50983fe',
         'fade0000-0000-0000-0000-000000000001', 'eece8f7f-f58e-4a9c-936a-af0a7e548655',
         '99999999-9999-9999-9999-999999999999',
         '2026-11-19T02:10:00Z');
    `);
  });

  afterAll(() => {
    if (started) {
      spawnSync(`${bin}/pg_ctl`, ['-D', join(scratch, 'd'), '-m', 'immediate', 'stop'], {
        env,
        stdio: 'pipe',
      });
    }
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  });

  it('reproduces the drift on the preimage and fixes every case after applying the migration', () => {
    const UNION = 'fade0000-0000-0000-0000-000000000001';
    const KINGS = 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4';
    const OTHER = '22222222-2222-2222-2222-222222222222';

    // BEFORE migration: Feeder -> Main 4 un-raked hand drifts to UNION club!
    const beforeH1 = ok(
      `SELECT public.fn_member_record_fact_club(f) FROM public.ca_hand_facts f WHERE f.hand_id = '10000000-0000-0000-0000-000000000001';`
    );
    expect(beforeH1).toBe(UNION);

    // BEFORE migration: Re-entry hand h3 wrongly sticks to older buy-in OTHER instead of newer move KINGS!
    const beforeH3 = ok(
      `SELECT public.fn_member_record_fact_club(f) FROM public.ca_hand_facts f WHERE f.hand_id = '10000000-0000-0000-0000-000000000003';`
    );
    expect(beforeH3).toBe(OTHER);

    // Apply the exact migration (concurrent preamble statements first, then transaction body):
    const sql = readFileSync(MIG_FILE, 'utf8');
    const split = splitConcurrentPreamble(sql);
    expect(split.ok).toBe(true);
    if (!split.ok) throw new Error(split.reason);
    for (const idx of split.indexes) ok(idx.statement);
    ok(split.body);

    // AFTER migration: every single case resolves to the true funding club!
    const results = ok(`
      SELECT f.hand_id || '=' || public.fn_member_record_fact_club(f)
      FROM public.ca_hand_facts f
      ORDER BY f.hand_id;
    `).split('\n');

    expect(results).toEqual([
      `10000000-0000-0000-0000-000000000001=${KINGS}`, // Feeder -> Main 4 must-move
      `10000000-0000-0000-0000-000000000002=${KINGS}`, // Multi-hop Main 4 -> Main 1
      `10000000-0000-0000-0000-000000000003=${KINGS}`, // Newer move beats older buy-in
      `10000000-0000-0000-0000-000000000004=${OTHER}`, // Newer direct buy-in beats older move
      `10000000-0000-0000-0000-000000000005=${KINGS}`, // Direct buy-in with no moves
      `10000000-0000-0000-0000-000000000006=${OTHER}`, // Tournament hand
    ]);

    // Verify concurrent index is VALID and READY:
    expect(
      ok(
        `SELECT indisvalid AND indisready FROM pg_index WHERE indexrelid = 'public.cash_seat_move_receipts_dest_player_at_idx'::regclass;`
      )
    ).toBe('t');

    // Verify ACLs revoke EXECUTE from public, anon, authenticated, service_role:
    expect(
      ok(`
        SELECT NOT (
          has_function_privilege('public', 'public.fn_member_record_fact_club(public.ca_hand_facts)', 'EXECUTE')
          OR has_function_privilege('anon', 'public.fn_member_record_fact_club(public.ca_hand_facts)', 'EXECUTE')
          OR has_function_privilege('authenticated', 'public.fn_member_record_fact_club(public.ca_hand_facts)', 'EXECUTE')
          OR has_function_privilege('service_role', 'public.fn_member_record_fact_club(public.ca_hand_facts)', 'EXECUTE')
        );
      `)
    ).toBe('t');
  });
});
