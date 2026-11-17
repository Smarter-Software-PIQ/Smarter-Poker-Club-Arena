/**
 * CLUB INVITE FIGURES NAME THEIR SCOPE (Dan 2026-11-17 13:49 CT).
 *
 * "Club membership and union-wide activity are different figures and must not
 * be presented as though both belong to KINGS CLUB." "Do not present
 * configured additions as measured members or live players."
 *
 * Installs the real migration on a scratch PostgreSQL over a minimal copy of
 * the production shapes it reads (the member and union-floor counters are the
 * production bodies) and checks what each figure measures and how it is named:
 *   - members are this club's measured members, worded "N Members In <Club>";
 *   - activity is distinct players (not seats, not away) on the floor the club
 *     plays on: its own union, named from the database, or the club itself;
 *   - configured display additions are zero and cannot be set again;
 *   - an unreadable figure is NULL and its line is omitted, never a zero;
 *   - the landing page / preview read and the copied-message read carry the
 *     same lines.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const MIGRATION = readdirSync(join(ROOT, 'supabase/migrations')).find((f) =>
  f.includes('_club_invite_counts_name_their_scope_and_show_measured_figure')
);
const bin = [
  process.env.PG_BIN,
  '/opt/homebrew/opt/postgresql@17/bin',
  '/opt/homebrew/bin',
  '/usr/lib/postgresql/18/bin',
  '/usr/lib/postgresql/17/bin',
  '/usr/lib/postgresql/16/bin',
  '/usr/bin',
].find((dir) => dir && ['initdb', 'pg_ctl', 'psql'].every((n) => existsSync(`${dir}/${n}`)));

let scratch = '';
let started = false;
const env = { ...process.env, LC_ALL: 'C', LANG: 'C' };
for (const k of Object.keys(env)) if (k.startsWith('PG')) delete env[k];

function psql(sql: string) {
  return spawnSync(
    `${bin}/psql`,
    [
      '-X',
      '-qAt',
      '-v',
      'ON_ERROR_STOP=1',
      '-h',
      join(scratch, 's'),
      '-p',
      '5432',
      '-U',
      'postgres',
      '-d',
      'postgres',
    ],
    { input: sql, encoding: 'utf8', env }
  );
}
function json(sql: string): any {
  const r = psql(sql);
  expect(r.status, r.stderr).toBe(0);
  return JSON.parse(r.stdout.trim());
}

const KINGS = '00000000-0000-0000-0000-00000000000a';
const DSS = '00000000-0000-0000-0000-00000000000b';
const SOLO = '00000000-0000-0000-0000-00000000000c';
const OTHER = '00000000-0000-0000-0000-00000000000d';
const MIDWAY = '00000000-0000-0000-0000-0000000000f1';
const NORTH = '00000000-0000-0000-0000-0000000000f2';
const u = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

const SCHEMA = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;
CREATE TABLE public.unions (id uuid PRIMARY KEY, name text);
CREATE TABLE public.clubs (id uuid PRIMARY KEY, club_id integer, slug text, name text, description text,
  logo_url text, avatar_url text, member_count integer, lifecycle_status text, asset text, union_id uuid);
CREATE TABLE public.union_clubs (union_id uuid, club_id uuid);
CREATE TABLE public.profiles (id uuid PRIMARY KEY, alias text, username text, player_number text, is_horse boolean);
CREATE TABLE public.club_members (club_id uuid, user_id uuid, status text, role text);
CREATE TABLE public.tables (id uuid PRIMARY KEY, club_id uuid, union_id uuid, status text, tournament_id uuid, is_private boolean);
CREATE TABLE public.table_seats (table_id uuid, user_id uuid, left_at timestamptz, is_away boolean);
CREATE TABLE public.club_invite_links (code text PRIMARY KEY, club_id uuid, inviter_id uuid, inviter_device_id text,
  click_count integer NOT NULL DEFAULT 0, last_clicked_at timestamptz);
CREATE TABLE public.club_display_member_boost (club_id uuid PRIMARY KEY, boost integer NOT NULL CHECK (boost >= 0),
  reason text, set_at timestamptz);
CREATE TABLE public.club_display_labeled_additions (club_id uuid PRIMARY KEY,
  member_addition integer NOT NULL CHECK (member_addition >= 0), active_addition integer NOT NULL CHECK (active_addition >= 0),
  label text, reason text, set_at timestamptz);
CREATE FUNCTION public.fn_ca_stats_counts_in_club(p_club_id uuid, p_user_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE FUNCTION public.fn_club_invite_join_path(uuid, uuid, text) RETURNS text LANGUAGE sql AS $$ SELECT '/hub/club-arena/join' $$;
CREATE FUNCTION public.fn_diamond_arena_players_playing(uuid) RETURNS integer LANGUAGE sql AS $$ SELECT NULL::integer $$;
CREATE FUNCTION public.fn_club_card_figures(p_club_id uuid) RETURNS TABLE(members integer, active integer) LANGUAGE sql AS $$ SELECT 0, 0 $$;
-- Production bodies (live pg_proc, 2026-11-17).
CREATE FUNCTION public.fn_batch_club_realtime_member_counts(p_club_ids uuid[])
 RETURNS TABLE(club_id uuid, member_count bigint) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT requested.club_id,
         (count(cm.user_id)
          + COALESCE((SELECT b.boost FROM public.club_display_member_boost b
                       WHERE b.club_id = requested.club_id), 0))::bigint
    FROM unnest(p_club_ids) requested(club_id)
    LEFT JOIN public.club_members cm ON cm.club_id = requested.club_id
      AND (cm.status IS NULL OR cm.status IN ('active', 'approved'))
      AND public.fn_ca_stats_counts_in_club(cm.club_id, cm.user_id)
   GROUP BY requested.club_id;
$f$;
CREATE FUNCTION public.fn_batch_union_realtime_active_counts(p_union_ids uuid[])
 RETURNS TABLE(union_id uuid, active_count bigint, cash_count bigint, event_count bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  WITH requested AS (SELECT DISTINCT r.union_id FROM unnest(p_union_ids) r(union_id)),
  floor_tables AS (
    SELECT requested.union_id, t.id AS table_id, (t.tournament_id IS NULL) AS at_cash
      FROM requested
      JOIN public.tables t
        ON (t.union_id = requested.union_id
            OR t.club_id = requested.union_id
            OR t.club_id IN (SELECT uc.club_id FROM public.union_clubs uc WHERE uc.union_id = requested.union_id))
     WHERE lower(COALESCE(t.status, '')) NOT IN ('closed','completed','cancelled','finished')),
  seated AS (
    SELECT f.union_id, ts.user_id, f.at_cash FROM floor_tables f
      JOIN public.table_seats ts ON ts.table_id = f.table_id
       AND ts.left_at IS NULL AND COALESCE(ts.is_away, false) = false)
  SELECT requested.union_id, count(DISTINCT s.user_id)::bigint,
         count(DISTINCT s.user_id) FILTER (WHERE s.at_cash)::bigint,
         count(DISTINCT s.user_id) FILTER (WHERE NOT s.at_cash)::bigint
    FROM requested LEFT JOIN seated s ON s.union_id = requested.union_id
   GROUP BY requested.union_id;
$f$;

INSERT INTO public.unions VALUES ('${MIDWAY}', 'Midway Union'), ('${NORTH}', 'North Star Union');
INSERT INTO public.clubs (id, club_id, slug, name, asset, union_id) VALUES
  ('${KINGS}', 25450, 'kings-club', 'KINGS CLUB', 'chips', '${MIDWAY}'),
  ('${DSS}', 25451, 'dss', 'Deep Stack Society', 'chips', '${MIDWAY}'),
  ('${SOLO}', 25452, 'solo', 'Solo Room', 'chips', NULL),
  ('${OTHER}', 25453, 'other', 'Harbor Club', 'chips', NULL);
INSERT INTO public.union_clubs VALUES ('${MIDWAY}', '${KINGS}'), ('${MIDWAY}', '${DSS}'), ('${NORTH}', '${OTHER}');
INSERT INTO public.club_display_member_boost VALUES ('${DSS}', 1000, 'display +1,000', now()), ('${KINGS}', 0, 'real', now());
INSERT INTO public.club_display_labeled_additions VALUES ('${KINGS}', 1500, 233, 'Bonus', 'display', now());
INSERT INTO public.profiles (id, alias, is_horse) SELECT ('00000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'P' || g, g >= 100
  FROM generate_series(1, 120) g;
-- KINGS CLUB: three active members, one approved, one left (not counted).
INSERT INTO public.club_members VALUES
  ('${KINGS}', '${u(1)}', 'active', 'owner'), ('${KINGS}', '${u(2)}', 'active', 'member'),
  ('${KINGS}', '${u(3)}', 'approved', 'member'), ('${KINGS}', '${u(4)}', 'active', 'member'),
  ('${KINGS}', '${u(5)}', 'left', 'member'),
  ('${DSS}', '${u(100)}', 'active', 'member'), ('${DSS}', '${u(101)}', 'active', 'member'),
  ('${SOLO}', '${u(10)}', 'active', 'owner');
INSERT INTO public.tables (id, club_id, union_id, status, tournament_id) VALUES
  ('${u(901)}', NULL, '${MIDWAY}', 'running', NULL),
  ('${u(902)}', NULL, '${MIDWAY}', 'running', '${u(999)}'),
  ('${u(903)}', NULL, '${MIDWAY}', 'closed', NULL),
  ('${u(904)}', '${SOLO}', NULL, 'running', NULL),
  ('${u(905)}', NULL, '${NORTH}', 'running', NULL);
INSERT INTO public.table_seats VALUES
  -- Midway: one human in two seats counts once; two Horses; one away; one gone; one at a closed table.
  ('${u(901)}', '${u(1)}', NULL, false), ('${u(902)}', '${u(1)}', NULL, false),
  ('${u(901)}', '${u(100)}', NULL, false), ('${u(902)}', '${u(101)}', NULL, false),
  ('${u(901)}', '${u(2)}', NULL, true), ('${u(901)}', '${u(3)}', now(), false),
  ('${u(903)}', '${u(4)}', NULL, false),
  ('${u(904)}', '${u(10)}', NULL, false), ('${u(904)}', '${u(11)}', NULL, false),
  ('${u(905)}', '${u(20)}', NULL, false);
INSERT INTO public.club_invite_links (code, club_id, inviter_id) VALUES ('ZG9YGMZ', '${KINGS}', '${u(1)}');
`;

beforeAll(() => {
  if (!bin) throw new Error('PostgreSQL binaries are required for the club invite figures test');
  if (!MIGRATION) throw new Error('migration not found');
  scratch = mkdtempSync(join(tmpdir(), 'invite-'));
  execFileSync(
    `${bin}/initdb`,
    ['-D', join(scratch, 'd'), '-U', 'postgres', '-A', 'trust', '--no-locale'],
    {
      env,
      stdio: 'pipe',
    }
  );
  execFileSync('mkdir', [join(scratch, 's')]);
  execFileSync(
    `${bin}/pg_ctl`,
    [
      '-D',
      join(scratch, 'd'),
      '-l',
      join(scratch, 'log'),
      '-o',
      `-k ${join(scratch, 's')} -p 5432 -c listen_addresses=`,
      '-w',
      'start',
    ],
    { env, stdio: 'pipe' }
  );
  started = true;
  const seed = psql(SCHEMA);
  expect(seed.status, seed.stderr).toBe(0);
  const install = psql(readFileSync(join(ROOT, 'supabase/migrations', MIGRATION!), 'utf8'));
  expect(install.status, install.stderr).toBe(0);
});

afterAll(() => {
  if (started)
    spawnSync(`${bin}/pg_ctl`, ['-D', join(scratch, 'd'), '-m', 'immediate', '-w', 'stop'], {
      env,
    });
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

const figures = (club: string) => json(`SELECT public.fn_club_share_figures('${club}')::text;`);

describe('club invite figures name their scope', () => {
  it('club members and union activity are separate figures, each named', () => {
    const f = figures(KINGS);
    expect(f.members).toBe(4);
    expect(f.members_line).toBe('4 Members In KINGS CLUB');
    expect(f.activity_scope).toBe('union');
    expect(f.activity_scope_name).toBe('Midway Union');
    expect(f.activity_line).toBe('3 Playing Across Midway Union Now');
  });

  it('counts unique players, not occupied seats, and skips away, departed and closed-table seats', () => {
    // Seated on Midway: u1 twice, u100, u101 (both Horses), u2 away, u3 gone, u4 at a closed table.
    expect(figures(KINGS).players_playing).toBe(3);
    const seats =
      psql(`SELECT count(*) FROM public.table_seats ts JOIN public.tables t ON t.id = ts.table_id
      WHERE t.union_id = '${MIDWAY}' AND ts.left_at IS NULL AND NOT ts.is_away AND t.status = 'running';`);
    expect(seats.stdout.trim()).toBe('4');
  });

  it('every union member club names its own union; a club with no union names itself', () => {
    expect(figures(DSS).activity_line).toBe('3 Playing Across Midway Union Now');
    expect(figures(OTHER).activity_line).toBe('1 Playing Across North Star Union Now');
    const solo = figures(SOLO);
    expect(solo.activity_scope).toBe('club');
    expect(solo.activity_line).toBe('2 Playing In Solo Room Now');
    expect(solo.members_line).toBe('1 Member In Solo Room');
  });

  it('configured display additions are retired and cannot be set again', () => {
    expect(figures(DSS).members).toBe(2);
    expect(
      psql(
        `SELECT boost FROM public.club_display_member_boost WHERE club_id = '${DSS}';`
      ).stdout.trim()
    ).toBe('0');
    expect(
      psql(
        `SELECT member_addition || '/' || active_addition FROM public.club_display_labeled_additions;`
      ).stdout.trim()
    ).toBe('0/0');
    expect(
      psql(`UPDATE public.club_display_member_boost SET boost = 1000 WHERE club_id = '${DSS}';`)
        .status
    ).not.toBe(0);
    expect(
      psql(`UPDATE public.club_display_labeled_additions SET member_addition = 1500;`).status
    ).not.toBe(0);
    expect(
      psql(`UPDATE public.club_display_labeled_additions SET active_addition = 233;`).status
    ).not.toBe(0);
  });

  it('the landing page read and the copied-message read carry the same two lines', () => {
    const resolved = json(
      `SELECT (public.fn_club_invite_resolve('ZG9YGMZ', false)->'club')::text;`
    );
    expect(resolved.member_count).toBe(4);
    expect(resolved.players_playing).toBe(3);
    expect(resolved.members_line).toBe('4 Members In KINGS CLUB');
    expect(resolved.activity_line).toBe('3 Playing Across Midway Union Now');
    expect(resolved.activity_scope_name).toBe('Midway Union');
    const link = json(
      `SET test.uid = '${u(1)}'; SELECT (public.fn_club_invite_link('${KINGS}')->'figures')::text;`
    );
    expect(link.members_line).toBe(resolved.members_line);
    expect(link.activity_line).toBe(resolved.activity_line);
    expect(
      psql(`SELECT click_count FROM public.club_invite_links WHERE code = 'ZG9YGMZ';`).stdout.trim()
    ).toBe('0');
  });

  it('unavailable activity is omitted, never a zero or another metric', () => {
    const r =
      psql(`CREATE OR REPLACE FUNCTION public.fn_batch_union_realtime_active_counts(p_union_ids uuid[])
      RETURNS TABLE(union_id uuid, active_count bigint, cash_count bigint, event_count bigint)
      LANGUAGE plpgsql STABLE AS $f$ BEGIN RAISE EXCEPTION 'floor read failed'; END $f$;`);
    expect(r.status, r.stderr).toBe(0);
    const f = figures(KINGS);
    expect(f.players_playing).toBeNull();
    expect(f.activity_line).toBeNull();
    expect(f.members_line).toBe('4 Members In KINGS CLUB');
    const resolved = json(
      `SELECT (public.fn_club_invite_resolve('ZG9YGMZ', false)->'club')::text;`
    );
    expect(resolved.players_playing).toBeNull();
    expect(resolved.activity_line).toBeNull();
  });

  it('only service_role and the definer functions may read the figures directly', () => {
    const acl =
      psql(`SELECT has_function_privilege('anon', 'public.fn_club_share_figures(uuid)', 'EXECUTE')
      || '/' || has_function_privilege('authenticated', 'public.fn_club_share_figures(uuid)', 'EXECUTE')
      || '/' || has_function_privilege('service_role', 'public.fn_club_share_figures(uuid)', 'EXECUTE');`);
    expect(acl.stdout.trim()).toBe('false/false/true');
    expect(
      psql(`SELECT to_regprocedure('public.fn_club_card_figures(uuid)') IS NULL;`).stdout.trim()
    ).toBe('t');
  });
});
