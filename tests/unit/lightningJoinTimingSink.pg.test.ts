import { expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * LIGHTNING JOINS ARE TIMED FROM THE CLICK TO THE PAINTED CARDS (owner report
 * 2026-11-10: 18.4 s from the pool session opening to the first hand, with the
 * browser's half of the join never recorded). The sink is installed on real
 * isolated PostgreSQL and driven as a signed-in browser would drive it.
 */
const MIGRATION =
  'supabase/migrations/20261110213810_lightning_joins_are_timed_from_the_click_to_the_painted_card.sql';

const STUB = `
DO $r$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $r$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`;

const PLAYER = '30000000-0000-4000-8000-000000000001';
const OTHER = '30000000-0000-4000-8000-000000000002';
const CLUSTER = '30000000-0000-4000-8000-000000000003';

it('keeps one bounded, whitelisted row per timed Lightning join and reports each leg', () => {
  const root = resolve(__dirname, '../..');
  const bin = [
    '/opt/homebrew/bin',
    '/usr/lib/postgresql/18/bin',
    '/usr/lib/postgresql/17/bin',
    '/usr/lib/postgresql/16/bin',
    '/usr/bin',
  ].find((dir) => ['initdb', 'pg_ctl', 'psql'].every((name) => existsSync(`${dir}/${name}`)));
  if (!bin) throw new Error('PostgreSQL binaries are required for the Lightning join timing sink');
  const cache = resolve(root, 'node_modules/.cache');
  mkdirSync(cache, { recursive: true });
  const scratch = mkdtempSync(resolve(cache, 'lightning-join-timing-'));
  const port = 20000 + Math.floor(Math.random() * 30000);
  const data = resolve(scratch, 'data');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    LC_ALL: process.env.LC_ALL || 'C',
    PGHOST: '127.0.0.1',
    PGPORT: String(port),
    PGDATABASE: 'postgres',
    PGUSER: process.env.USER || 'runner',
    PGSSLMODE: 'disable',
  };
  delete env.PGSERVICE;
  delete env.PGSERVICEFILE;
  const run = (cmd: string, args: string[], input?: string) =>
    execFileSync(`${bin}/${cmd}`, args, {
      cwd: root,
      env,
      input,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  const sql = (text: string) => run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-q'], text);
  const one = (text: string) =>
    run('psql', ['-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', text]).trim();
  /** One report as the signed-in browser `user` (auth.uid() from the JWT claim). */
  const report = (user: string | null, timing: unknown) =>
    Number(
      one(
        `SET request.jwt.claim.sub = '${user ?? ''}';
         SELECT fn_report_lightning_join_timing('${JSON.stringify(timing).replace(/'/g, "''")}'::jsonb)`
      )
        .split('\n')
        .pop()
    );
  const join = (marks: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    kind: 'buy_in',
    outcome: 'painted',
    cluster_id: CLUSTER,
    marks,
    ...extra,
  });
  let started = false;
  try {
    run('initdb', ['-D', data, '-A', 'trust']);
    run('pg_ctl', [
      '-D',
      data,
      '-l',
      resolve(scratch, 'postgres.log'),
      '-o',
      `-p ${port} -h 127.0.0.1 -k ''`,
      '-w',
      'start',
    ]);
    started = true;
    sql(STUB);
    sql(readFileSync(resolve(root, MIGRATION), 'utf8'));

    // A browser can only reach the door; it can never read or write the table.
    expect(
      one(
        `SELECT has_function_privilege('anon','public.fn_report_lightning_join_timing(jsonb)','EXECUTE')`
      )
    ).toBe('f');
    expect(
      one(
        `SELECT has_function_privilege('authenticated','public.fn_report_lightning_join_timing(jsonb)','EXECUTE')`
      )
    ).toBe('t');
    expect(
      one(
        `SELECT has_function_privilege('authenticated','public.fn_lightning_join_timing_report(timestamptz,timestamptz)','EXECUTE')`
      )
    ).toBe('f');
    expect(
      one(
        `SELECT has_table_privilege('authenticated','public.client_lightning_join_timings','INSERT')`
      )
    ).toBe('f');

    // The owner's join, as the browser will now report it.
    const dan = {
      click: 0,
      rejoin_checked: 210,
      dialog_shown: 640,
      confirm: 3640,
      hold_answered: 3900,
      purchase_answered: 4400,
      seated: 4600,
      room_open: 4700,
      socket_connected: 5100,
      first_snapshot: 5300,
      first_hand: 8300,
      cards_painted: 8380,
      // Not a mark: dropped, never stored.
      card_ranks: 'AsKd',
      evil: 1,
    };
    expect(report(PLAYER, join(dan, { app_version: 'abc123<script>', hidden: false }))).toBe(1);
    const stored = JSON.parse(one(`SELECT marks::text FROM client_lightning_join_timings`));
    expect(Object.keys(stored).sort()).toEqual(
      [
        'click',
        'rejoin_checked',
        'dialog_shown',
        'confirm',
        'hold_answered',
        'purchase_answered',
        'seated',
        'room_open',
        'socket_connected',
        'first_snapshot',
        'first_hand',
        'cards_painted',
      ].sort()
    );
    expect(one(`SELECT user_id || ' ' || app_version FROM client_lightning_join_timings`)).toBe(
      `${PLAYER} abc123script`
    );

    // Refused quietly: no signed-in user, an unknown kind or outcome, no marks.
    expect(report(null, join(dan))).toBe(0);
    expect(report(PLAYER, join(dan, { kind: 'teleport' }))).toBe(0);
    expect(report(PLAYER, join(dan, { outcome: 'maybe' }))).toBe(0);
    expect(report(PLAYER, join({ nope: 1 }))).toBe(0);
    // Clamped to ten minutes and never negative.
    expect(report(OTHER, join({ click: -5, cards_painted: 99_999_999 }))).toBe(1);
    expect(
      one(
        `SELECT (marks->>'click') || ' ' || (marks->>'cards_painted') FROM client_lightning_join_timings WHERE user_id='${OTHER}'`
      )
    ).toBe('0 600000');

    // Ten a minute per player: the eleventh is dropped.
    for (let i = 0; i < 8; i += 1) expect(report(PLAYER, join(dan))).toBe(1);
    expect(report(PLAYER, join(dan))).toBe(1);
    expect(report(PLAYER, join(dan))).toBe(0);

    // Retention travels with the write.
    sql(
      `UPDATE client_lightning_join_timings SET received_at = now() - interval '15 days' WHERE user_id='${OTHER}';`
    );
    sql(
      `UPDATE client_lightning_join_timings SET received_at = now() - interval '2 minutes' WHERE user_id='${PLAYER}';`
    );
    expect(report(PLAYER, join(dan, { kind: 'rejoin' }))).toBe(1);
    expect(one(`SELECT count(*) FROM client_lightning_join_timings WHERE user_id='${OTHER}'`)).toBe(
      '0'
    );

    // The report: each leg is the gap between its two marks.
    const legs = Object.fromEntries(
      one(
        `SELECT string_agg(leg || '=' || n || ':' || p50_ms || ':' || p95_ms, ',' ORDER BY ord)
           FROM fn_lightning_join_timing_report(now() - interval '1 hour', now() + interval '1 minute')`
      )
        .split(',')
        .map((s) => s.split('='))
    );
    expect(legs.open_question).toBe('11:640:640');
    expect(legs.player_decides).toBe('11:3000:3000');
    expect(legs.purchase).toBe('11:500:500');
    expect(legs.socket_connect).toBe('11:400:400');
    expect(legs.pool_wait_to_hand).toBe('11:3000:3000');
    expect(legs.hand_to_paint).toBe('11:80:80');
    // The player's own time on the question is not the system's: 640 + 4740.
    // A rejoin has no question, so its whole span is the system's (8380).
    expect(legs.system.split(':')[0]).toBe('11');
    expect(legs.system.split(':')[1]).toBe('5380');
  } finally {
    if (started) {
      try {
        run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']);
      } catch {
        /* already stopped */
      }
    }
    rmSync(scratch, { recursive: true, force: true });
  }
}, 120_000);
