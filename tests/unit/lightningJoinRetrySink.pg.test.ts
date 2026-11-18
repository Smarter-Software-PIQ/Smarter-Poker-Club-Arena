import { expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * A CONFIRM AFTER A REFUSAL IS ITS OWN ATTEMPT (Dan 2026-11-10: "a retry after
 * refusal is measured correctly without duplicating the first report"). The
 * browser sends the refused attempt once and the retry as a second report whose
 * zero is the retry press (confirm = 0, no click). Both sink migrations are
 * installed on real isolated PostgreSQL: the two reports are two rows, a normal
 * retry is well inside the per-player rate limit, the retry adds to the
 * post-confirm stages only, and the refused attempt's row is never changed.
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
  { length: 2 },
  (_, i) => `50000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`
);
const CLUSTER = '50000000-0000-4000-8000-0000000000ff';

it('stores a refused attempt and its retry as two rows, and times the retry from its own press', () => {
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
  const scratch = mkdtempSync(resolve(cache, 'lightning-join-retry-'));
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

    const A = PLAYERS[0];
    const refused = {
      click: 0,
      rejoin_checked: 200,
      dialog_shown: 600,
      confirm: 3600,
      hold_answered: 3900,
      purchase_answered: 4400,
    };
    const retry = {
      confirm: 0,
      hold_answered: 250,
      purchase_answered: 700,
      seated: 900,
      room_open: 1000,
      socket_connected: 1300,
      first_snapshot: 1500,
      first_hand: 3500,
      cards_painted: 3580,
    };
    expect(report(A, join('refused', refused, { reason: 'INSUFFICIENT_CHIPS' }))).toBe(1);
    expect(report(A, join('painted', retry))).toBe(1);
    // Two rows, each as sent: the refused one keeps its reason and stage.
    expect(
      one(
        `SELECT string_agg(outcome || ':' || coalesce(reason_code,'-') || ':' || ended_at || ':' || (marks ? 'click')::text, ',' ORDER BY received_at, outcome DESC)
           FROM client_lightning_join_timings WHERE user_id='${A}'`
      )
    ).toBe('refused:INSUFFICIENT_CHIPS:purchase_answered:true,painted:-:cards_painted:false');
    const row = (leg: string) =>
      one(
        `SELECT n || '|' || max_ms
           FROM fn_lightning_join_timing_report(now() - interval '1 hour', now() + interval '1 minute')
          WHERE leg = '${leg}'`
      );
    // Post-confirm stages take both attempts; the retry's legs are its own.
    expect(row('hold_chair')).toBe('2|300');
    expect(row('purchase')).toBe('2|500');
    expect(row('hand_to_paint')).toBe('1|80');
    // Click-based spans never take a retry (it has no click).
    expect(row('player_decides')).toBe('1|3000');
    // No row, or a row with no samples: either way the retry is not counted.
    expect(row('click_to_cards')).toMatch(/^(0\|.*)?$/);

    // A refusal, a refused retry and an abandoned question: three reports, one each.
    const B = PLAYERS[1];
    expect(report(B, join('refused', refused, { reason: 'SEAT_TAKEN' }))).toBe(1);
    expect(
      report(B, join('refused', { confirm: 0, hold_answered: 300 }, { reason: 'SEAT_TAKEN' }))
    ).toBe(1);
    expect(one(`SELECT count(*) FROM client_lightning_join_timings WHERE user_id='${B}'`)).toBe(
      '2'
    );
    // Several honest retries stay inside ten a minute.
    for (let i = 0; i < 6; i += 1)
      expect(
        report(B, join('refused', { confirm: 0, hold_answered: 300 }, { reason: 'SEAT_TAKEN' }))
      ).toBe(1);
    expect(one(`SELECT count(*) FROM client_lightning_join_timings WHERE user_id='${B}'`)).toBe(
      '8'
    );
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
