import { expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * EVERY LIGHTNING JOIN ENDING IS RECORDED WITH ITS STAGE AND REASON (Dan
 * 2026-11-10: "including failed attempts and tail latency ... label any
 * percentile you do not have enough samples for as unknown"). Both migrations
 * are installed in order on real isolated PostgreSQL and driven as a
 * signed-in browser would drive them.
 */
const MIGRATIONS = [
  'supabase/migrations/20261110213810_lightning_joins_are_timed_from_the_click_to_the_painted_card.sql',
  'supabase/migrations/20261110225742_every_lightning_join_ending_is_recorded_with_its_leg_and_rea.sql',
];

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

const PLAYERS = Array.from(
  { length: 12 },
  (_, i) => `50000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`
);
const CLUSTER = '50000000-0000-4000-8000-0000000000ff';

it('records refused, failed, abandoned and timed-out joins with their stage and reason, and never estimates a percentile', () => {
  const root = resolve(__dirname, '../..');
  const bin = [
    '/opt/homebrew/bin',
    '/usr/lib/postgresql/18/bin',
    '/usr/lib/postgresql/17/bin',
    '/usr/lib/postgresql/16/bin',
    '/usr/bin',
  ].find((dir) => ['initdb', 'pg_ctl', 'psql'].every((name) => existsSync(`${dir}/${name}`)));
  if (!bin) throw new Error('PostgreSQL binaries are required for the Lightning join outcome sink');
  const cache = resolve(root, 'node_modules/.cache');
  mkdirSync(cache, { recursive: true });
  const scratch = mkdtempSync(resolve(cache, 'lightning-join-outcomes-'));
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
  const report = (user: string, timing: unknown) =>
    Number(
      one(
        `SET request.jwt.claim.sub = '${user}';
         SELECT fn_report_lightning_join_timing('${JSON.stringify(timing).replace(/'/g, "''")}'::jsonb)`
      )
        .split('\n')
        .pop()
    );
  const join = (
    outcome: string,
    marks: Record<string, number>,
    extra: Record<string, unknown> = {}
  ) => ({ kind: 'buy_in', outcome, cluster_id: CLUSTER, marks, ...extra });
  const painted = (scale: number) => ({
    click: 0,
    rejoin_checked: 200,
    dialog_shown: 600,
    confirm: 3600,
    hold_answered: 3900,
    purchase_answered: 4400,
    seated: 4600,
    room_open: 4700,
    socket_connected: 5100,
    first_snapshot: 5300,
    first_hand: 5300 + 1000 * scale,
    cards_painted: 5380 + 1000 * scale,
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
    for (const m of MIGRATIONS) sql(readFileSync(resolve(root, m), 'utf8'));

    for (const fn of [
      'fn_lightning_join_timing_report(timestamptz,timestamptz)',
      'fn_lightning_join_outcome_report(timestamptz,timestamptz)',
    ]) {
      expect(one(`SELECT has_function_privilege('authenticated','public.${fn}','EXECUTE')`)).toBe(
        'f'
      );
      expect(one(`SELECT has_function_privilege('service_role','public.${fn}','EXECUTE')`)).toBe(
        't'
      );
    }

    // Four painted joins: below five samples every percentile is unknown.
    for (let i = 0; i < 4; i += 1)
      expect(report(PLAYERS[i], join('painted', painted(i + 1)))).toBe(1);
    const row = (leg: string) =>
      one(
        `SELECT n || '|' || coalesce(p50_ms::text,'unknown') || '|' || coalesce(p95_ms::text,'unknown') || '|' ||
                coalesce(p99_ms::text,'unknown') || '|' || max_ms || '|' || coalesce(ended_here::text,'-')
           FROM fn_lightning_join_timing_report(now() - interval '1 hour', now() + interval '1 minute')
          WHERE leg = '${leg}'`
      );
    expect(row('pool_wait_to_hand')).toBe('4|unknown|unknown|unknown|4000|0');
    // A fifth sample makes p50 known; p95 and p99 stay unknown.
    expect(report(PLAYERS[4], join('painted', painted(5)))).toBe(1);
    expect(row('pool_wait_to_hand')).toBe('5|3000|unknown|unknown|5000|0');
    expect(row('click_to_cards')).toBe('5|8380|unknown|unknown|10380|-');

    // Endings. The stage is derived from the marks, not from the client.
    expect(
      report(
        PLAYERS[5],
        join('refused', { click: 0 }, { reason: 'SIGN_IN_REQUIRED', ended_at: 'cards_painted' })
      )
    ).toBe(1);
    expect(
      report(
        PLAYERS[6],
        join(
          'refused',
          { click: 0, rejoin_checked: 150, dialog_shown: 500, confirm: 2500, hold_answered: 2700 },
          {
            reason: 'INSUFFICIENT_CHIPS',
          }
        )
      )
    ).toBe(1);
    expect(
      report(
        PLAYERS[7],
        join(
          'abandoned',
          { click: 0, rejoin_checked: 150, dialog_shown: 500 },
          { reason: 'DIALOG_CLOSED' }
        )
      )
    ).toBe(1);
    // Free text is never stored as a reason.
    expect(
      report(
        PLAYERS[8],
        join('failed', { click: 0, rejoin_checked: 150 }, { reason: 'player Dan has 40 chips' })
      )
    ).toBe(1);
    // A timed-out join that reached its room: it stopped waiting for the first hand.
    const stuck = painted(1);
    delete (stuck as Record<string, number>).first_hand;
    delete (stuck as Record<string, number>).cards_painted;
    expect(report(PLAYERS[9], join('timeout', stuck, { reason: 'NO_PAINT', hidden: true }))).toBe(
      1
    );
    // Painted keeps no reason.
    expect(report(PLAYERS[10], join('painted', painted(2), { reason: 'SHOULD_NOT_STICK' }))).toBe(
      1
    );
    // An unknown outcome is still refused.
    expect(report(PLAYERS[11], join('vanished', { click: 0 }))).toBe(0);

    expect(
      one(
        `SELECT string_agg(outcome || ':' || ended_at || ':' || coalesce(reason_code,'-'), ',' ORDER BY id)
           FROM client_lightning_join_timings WHERE outcome <> 'painted' OR reason_code IS NOT NULL`
      )
    ).toBe(
      'refused:click:SIGN_IN_REQUIRED,refused:hold_answered:INSUFFICIENT_CHIPS,abandoned:dialog_shown:DIALOG_CLOSED,failed:rejoin_checked:UNSPECIFIED,timeout:first_snapshot:NO_PAINT'
    );

    // Failure counts by stage.
    expect(row('rejoin_check').split('|').pop()).toBe('1');
    expect(row('price_read').split('|').pop()).toBe('1');
    expect(row('player_decides').split('|').pop()).toBe('1');
    expect(row('purchase').split('|').pop()).toBe('1');
    expect(row('pool_wait_to_hand').split('|').pop()).toBe('1');
    // The hidden timeout is not a duration sample; six visible paints are.
    expect(row('pool_wait_to_hand').split('|')[0]).toBe('6');

    // Sample sizes by group and outcome.
    expect(
      one(
        `SELECT string_agg(outcome_group || '/' || outcome || '=' || n || '/' || hidden, ',' ORDER BY outcome_group, outcome)
           FROM (SELECT outcome_group, outcome, sum(n) n, sum(hidden) hidden
                   FROM fn_lightning_join_outcome_report(now() - interval '1 hour', now() + interval '1 minute')
                  GROUP BY 1, 2) s`
      )
    ).toBe(
      'abandoned/abandoned=1/0,failed/failed=1/0,failed/refused=2/0,failed/timeout=1/1,successful/painted=6/0'
    );

    // The rate limit and retention are kept.
    for (let i = 0; i < 9; i += 1) expect(report(PLAYERS[0], join('painted', painted(1)))).toBe(1);
    expect(report(PLAYERS[0], join('painted', painted(1)))).toBe(0);
    sql(
      `UPDATE client_lightning_join_timings SET received_at = now() - interval '15 days' WHERE user_id = '${PLAYERS[5]}';`
    );
    expect(report(PLAYERS[11], join('painted', painted(1)))).toBe(1);
    expect(
      one(`SELECT count(*) FROM client_lightning_join_timings WHERE user_id = '${PLAYERS[5]}'`)
    ).toBe('0');
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
