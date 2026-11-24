import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
 * THE LIGHTNING OPERATOR ROW READS THE SHADOW SUMMARY (2026-11-15), on real
 * isolated PostgreSQL. The pre-images are fn_lightning_operator_cluster_row and
 * fn_lightning_shadow_report exactly as production has them (read-only
 * pg_get_functiondef, scripts/ci/fixtures/lightning-operator-installed-20261115.json);
 * the fix is 20261115010232 exactly as written, under its own md5 guard.
 *
 * Every case is read before and after the patch on the same rows: the whole
 * row must be byte-equal, and its shadow summary must be the report's first
 * version pair. The work a shadow cluster costs must fall at least threefold.
 */
const FIXTURE = 'scripts/ci/fixtures/lightning-operator-installed-20261115.json';
const FIX =
  'supabase/migrations/20261115010232_lightning_operator_row_reads_the_shadow_summary.sql';
const ROW = 'public.fn_lightning_operator_cluster_row(uuid,timestamptz)';
const PRODUCTION_ROW_MD5 = 'dc81e3aa94d6994c11e3894e733cacac';

const STUB = `
DO $r$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $r$;
CREATE TABLE public.cash_games (id uuid PRIMARY KEY, club_id uuid, name text, variant text,
  sb numeric, bb numeric, handedness integer, lightning_enabled boolean, cluster_mode text,
  cluster_epoch integer);
CREATE TABLE public.lightning_cluster_drain (id uuid, cluster_id uuid, phase text,
  requested_at timestamptz, requested_by uuid, reason text, from_mode text,
  deadline_at timestamptz, completed_at timestamptz);
CREATE TABLE public.lightning_cluster_control (cluster_id uuid, paused_from text, paused_at timestamptz);
CREATE TABLE public.lightning_integrity_signal (cluster_id uuid, status text, severity text);
CREATE TABLE public.lightning_pool_session (cluster_id uuid, state text, exited_at timestamptz);
CREATE TABLE public.lightning_reservation (id uuid, cluster_id uuid, state text,
  expires_at timestamptz, lightning_instance_id uuid, pool_slot_id uuid);
CREATE TABLE public.lightning_instance (id uuid, cluster_id uuid, state text);
CREATE TABLE public.lightning_pool_slot (id uuid, closed_at timestamptz);
CREATE TABLE public.lightning_blind_ledger (cluster_id uuid, missed_bb_debt numeric, missed_sb_debt numeric);
CREATE TABLE public.cash_cluster_conversion (id uuid, cluster_id uuid, from_mode text,
  to_mode text, opened_at timestamptz, status text);
CREATE TABLE public.cash_cluster_epoch (cluster_id uuid, started_at timestamptz, ended_at timestamptz);
CREATE TABLE public.cash_cluster_events (game_id uuid, at timestamptz, kind text, payload jsonb);
CREATE TABLE public.financial_alerts (resolved boolean, source text, context jsonb);
CREATE TABLE public.lightning_latency_window (cluster_id uuid, window_from timestamptz,
  window_to timestamptz, legs jsonb);
CREATE FUNCTION public.fn_lightning_config(p uuid) RETURNS jsonb LANGUAGE sql STABLE
  AS $$ SELECT '{"on_threshold": 6, "off_threshold": 3, "worker_mode": "pool"}'::jsonb $$;
CREATE FUNCTION public.fn_cash_cluster_live_eligible(p uuid, p_now timestamptz) RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE FUNCTION public.fn_lightning_spec_flags(p boolean, p_cfg jsonb) RETURNS jsonb
  LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;
CREATE TABLE public.binding_stub (cluster_id uuid PRIMARY KEY, binding text);
CREATE FUNCTION public.fn_lightning_matcher_binding(p uuid) RETURNS text LANGUAGE sql STABLE
  AS $$ SELECT b.binding FROM public.binding_stub b WHERE b.cluster_id = p $$;
-- The comparison table as production has it: columns, NOT NULLs, checks, indexes.
CREATE TABLE public.lightning_matcher_shadow_comparison (
  id bigserial PRIMARY KEY,
  cluster_id uuid NOT NULL,
  window_from timestamptz NOT NULL,
  window_to timestamptz NOT NULL,
  live_matcher_version text NOT NULL,
  shadow_matcher_version text NOT NULL,
  live_metrics jsonb NOT NULL,
  shadow_metrics jsonb NOT NULL,
  live_components jsonb NOT NULL,
  shadow_components jsonb NOT NULL,
  live_quality_score numeric,
  shadow_quality_score numeric,
  quality_weights jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lightning_matcher_shadow_comparison_metrics_bounded CHECK (
    jsonb_typeof(live_metrics) = 'object' AND jsonb_typeof(shadow_metrics) = 'object'
    AND jsonb_typeof(quality_weights) = 'object' AND jsonb_typeof(live_components) = 'object'
    AND jsonb_typeof(shadow_components) = 'object'
    AND octet_length(live_metrics::text) <= 16384 AND octet_length(shadow_metrics::text) <= 16384),
  CONSTRAINT lightning_matcher_shadow_comparison_scores_range CHECK (
    live_quality_score >= 0 AND live_quality_score <= 100
    AND shadow_quality_score >= 0 AND shadow_quality_score <= 100),
  CONSTRAINT lightning_matcher_shadow_comparison_versions_named CHECK (
    live_matcher_version ~ '^[A-Za-z0-9._:-]{1,32}$' AND shadow_matcher_version ~ '^[A-Za-z0-9._:-]{1,32}$'
    AND live_matcher_version <> shadow_matcher_version),
  CONSTRAINT lightning_matcher_shadow_comparison_window_ordered CHECK (window_to > window_from));
CREATE UNIQUE INDEX lightning_matcher_shadow_comparison_one_per_key ON public.lightning_matcher_shadow_comparison
  (cluster_id, window_from, window_to, live_matcher_version, shadow_matcher_version);
CREATE INDEX lightning_matcher_shadow_comparison_by_versions ON public.lightning_matcher_shadow_comparison
  (live_matcher_version, shadow_matcher_version, window_to DESC);
CREATE INDEX lightning_matcher_shadow_comparison_by_window ON public.lightning_matcher_shadow_comparison
  (window_to DESC);
CREATE SEQUENCE public.window_seq;
-- n comparisons ending before now() - p_age, one second apart and never colliding.
CREATE FUNCTION public.mk(p_cluster uuid, p_lv text, p_sv text, p_n integer, p_live_q numeric,
  p_shadow_q numeric, p_live_rel numeric, p_shadow_rel numeric, p_binding text,
  p_seated jsonb DEFAULT '6', p_age interval DEFAULT '1 hour', p_pad boolean DEFAULT false,
  p_shadow_binding text DEFAULT NULL, p_next_hand_speed jsonb DEFAULT '0.5',
  p_shadow_seated jsonb DEFAULT NULL)
  RETURNS void LANGUAGE sql AS $mk$
  INSERT INTO public.lightning_matcher_shadow_comparison (cluster_id, window_from, window_to,
    live_matcher_version, shadow_matcher_version, live_metrics, shadow_metrics, live_components,
    shadow_components, live_quality_score, shadow_quality_score, quality_weights)
  SELECT p_cluster, w.t - interval '30 seconds', w.t, p_lv, p_sv,
         jsonb_build_object('snapshot_binding', p_binding, 'seated', p_seated,
           'formation_success_rate', 0.9, 'failure_rate', 0.01,
           'wait_ms', jsonb_build_object('p50', 1200 + w.i, 'p95', 4000),
           'bb_fairness', jsonb_build_object('order_violations', 0),
           'position_fairness', jsonb_build_object('btn_avg_count_before', 1.5),
           'opponent_diversity', jsonb_build_object('repeat_pair_rate', 0.1),
           'instance_occupancy', jsonb_build_object('utilization', 0.8),
           'trace', CASE WHEN p_pad THEN (SELECT string_agg(md5(random()::text || k), '')
                                            FROM generate_series(1, 140) k) END),
         jsonb_build_object('snapshot_binding', coalesce(p_shadow_binding, p_binding),
           'seated', coalesce(p_shadow_seated, p_seated),
           'formation_success_rate', 0.92, 'failure_rate', 0.02,
           'wait_ms', jsonb_build_object('p50', 1100 + w.i, 'p95', 3900),
           'trace', CASE WHEN p_pad THEN (SELECT string_agg(md5(random()::text || k), '')
                                            FROM generate_series(1, 140) k) END),
         jsonb_build_object('next_hand_speed', p_next_hand_speed, 'formation_success', 0.9,
           'bb_fairness', 1, 'opponent_diversity', 0.7, 'instance_utilization', 0.8,
           'reliability', p_live_rel),
         jsonb_build_object('next_hand_speed', 0.55, 'formation_success', 0.91,
           'bb_fairness', 1, 'opponent_diversity', 0.72, 'instance_utilization', 0.81,
           'reliability', p_shadow_rel),
         p_live_q + (w.i % 3), p_shadow_q + (w.i % 5) * 0.25, '{"speed": 1}'::jsonb
    FROM (SELECT g AS i, now() - p_age - nextval('public.window_seq') * interval '1 second' AS t
            FROM generate_series(1, p_n) g) w
$mk$;
`;

const C = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CASES: Array<{ name: string; cluster: string; at?: string }> = [];

let sql: (text: string) => string;
let one: (text: string) => string;
let cleanup: () => void = () => undefined;
let root = '';
const before = new Map<string, string>();
let budgetBefore = 0;

function fixture(prefix: string): string {
  const all = JSON.parse(readFileSync(resolve(root, FIXTURE), 'utf8')) as Array<{
    signature: string;
    md5: string;
    definition: string;
  }>;
  const hit = all.find((f) => f.signature.startsWith(prefix));
  if (!hit) throw new Error(prefix);
  return hit.definition;
}

const row = (cluster: string, at?: string) =>
  one(
    `SELECT fn_lightning_operator_cluster_row('${cluster}', ${at ? `'${at}'::timestamptz` : 'now()'})::text`
  );

/** What the pre-image row kept from the report: the first pair, mapped. */
const reportPair = (cluster: string, at?: string) =>
  one(`SELECT CASE WHEN jsonb_array_length(coalesce(r -> 'version_pairs', '[]')) > 0 THEN
         jsonb_build_object('verdict', r -> 'version_pairs' -> 0 ->> 'verdict',
           'comparisons', (r -> 'version_pairs' -> 0 ->> 'comparisons')::integer,
           'delta_mean', (r -> 'version_pairs' -> 0 ->> 'quality_delta_mean')::numeric,
           'live_matcher_version', r -> 'version_pairs' -> 0 ->> 'live_matcher_version',
           'shadow_matcher_version', r -> 'version_pairs' -> 0 ->> 'shadow_matcher_version')::text END
         FROM (SELECT fn_lightning_shadow_report('${cluster}',
                 ${at ? `'${at}'::timestamptz` : 'now()'} - interval '7 days',
                 ${at ? `'${at}'::timestamptz` : 'now()'}) AS r) x`);

function buffers(cluster: string): number {
  const plan = JSON.parse(
    one(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
         SELECT fn_lightning_operator_cluster_row('${cluster}', now())`)
  )[0].Plan;
  return plan['Shared Hit Blocks'] + plan['Shared Read Blocks'];
}

beforeAll(() => {
  root = resolve(__dirname, '../..');
  const bin = [
    process.env.PG_BIN,
    '/opt/homebrew/opt/postgresql@17/bin',
    '/opt/homebrew/bin',
    '/usr/lib/postgresql/18/bin',
    '/usr/lib/postgresql/17/bin',
    '/usr/lib/postgresql/16/bin',
    '/usr/bin',
  ].find(
    (dir) => dir && ['initdb', 'pg_ctl', 'psql'].every((name) => existsSync(`${dir}/${name}`))
  );
  if (!bin) throw new Error('PostgreSQL binaries are required for the operator row regression');
  const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const serverUser = 'nobody';
  const cache = asRoot ? tmpdir() : resolve(root, 'node_modules/.cache');
  mkdirSync(cache, { recursive: true });
  const scratch = mkdtempSync(resolve(cache, 'lightning-operator-row-'));
  if (asRoot) chmodSync(scratch, 0o777);
  const socket = scratchPostgresSocket();
  const data = resolve(scratch, 'data');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    LC_ALL: 'C',
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
          maxBuffer: 64 * 1024 * 1024,
        });
  sql = (text) => run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-q'], text);
  one = (text) => run('psql', ['-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', text]).trim();
  run('initdb', ['-D', data, '-A', 'trust', '-E', 'UTF8']);
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
  cleanup = () => {
    try {
      run('pg_ctl', ['-D', data, '-m', 'immediate', 'stop']);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
      rmSync(socket, { recursive: true, force: true });
    }
  };
  sql(STUB);
  sql(fixture('fn_lightning_shadow_report') + ';');
  sql(fixture('fn_lightning_operator_cluster_row') + ';');
  sql(`REVOKE ALL ON FUNCTION ${ROW} FROM PUBLIC;
       GRANT EXECUTE ON FUNCTION ${ROW} TO service_role;
       REVOKE ALL ON FUNCTION public.fn_lightning_shadow_report(uuid,timestamptz,timestamptz) FROM PUBLIC;
       GRANT EXECUTE ON FUNCTION public.fn_lightning_shadow_report(uuid,timestamptz,timestamptz) TO service_role;`);

  const add = (n: number, name: string, body: string, at?: string) => {
    const cluster = C(n);
    sql(`INSERT INTO cash_games VALUES ('${cluster}', '${C(0)}', '${name}', 'nlh', 1, 2, 6, true, 'lightning', 1);
         INSERT INTO binding_stub VALUES ('${cluster}', 'snap-${n}');
         ${body.replaceAll('$C', `'${cluster}'`).replaceAll('$B', `'snap-${n}'`)}`);
    CASES.push({ name, cluster, at });
  };
  add(1, 'too few comparisons', `SELECT mk($C, 'm1', 'm2', 12, 60, 64, 0.9, 0.9, $B);`);
  add(2, 'calibrated port', `SELECT mk($C, 'm1', 'm1-port', 40, 60, 59.4, 0.9, 0.9, $B);`);
  add(3, 'calibration bias', `SELECT mk($C, 'm1', 'm1-port', 40, 60, 64, 0.9, 0.9, $B);`);
  add(4, 'shadow leads', `SELECT mk($C, 'm1', 'm2', 45, 60, 63, 0.9, 0.95, $B);`);
  add(5, 'live leads', `SELECT mk($C, 'm1', 'm2', 45, 66, 61, 0.9, 0.9, $B);`);
  add(6, 'better but less reliable', `SELECT mk($C, 'm1', 'm2', 45, 60, 63, 0.97, 0.9, $B);`);
  add(
    7,
    'several pairs, stale and unseated rows',
    `SELECT mk($C, 'm1', 'm1-port', 90, 60, 60.2, 0.9, 0.9, $B);
     SELECT mk($C, 'm1', 'm2', 35, 60, 62, 0.9, 0.9, $B);
     SELECT mk($C, 'm0', 'm2', 35, 61, 60, 0.9, 0.9, $B);
     SELECT mk($C, 'm0', 'm3', 400, 70, 30, 0.9, 0.9, 'snap-old');
     SELECT mk($C, 'm0', 'm4', 50, 50, 60, 0.9, 0.9, $B, '0', p_shadow_seated => '6');
     SELECT mk($C, 'm0', 'm5', 50, 50, 60, 0.9, 0.9, $B, '"6"', p_shadow_seated => '6');
     SELECT mk($C, 'm0', 'm8', 50, 50, 60, 0.9, 0.9, $B, '6', p_shadow_seated => '0');
     SELECT mk($C, 'm0', 'm6', 50, 50, 60, 0.9, 0.9, $B, '6', '1 hour', false, 'snap-other');
     SELECT mk($C, 'm0', 'm7', 50, 50, 60, 0.9, 0.9, $B, '6', '8 days');
     UPDATE lightning_matcher_shadow_comparison SET shadow_quality_score = NULL
      WHERE id IN (SELECT id FROM lightning_matcher_shadow_comparison
                    WHERE cluster_id = $C AND shadow_matcher_version = 'm2' AND live_matcher_version = 'm0'
                    ORDER BY id LIMIT 7);`
  );
  CASES.push({ name: 'several pairs, read two days back', cluster: C(7), at: 'yesterday' });
  add(
    15,
    'a window without both scores is not a comparison',
    `SELECT mk($C, 'm1', 'm2', 32, 60, 63, 0.9, 0.95, $B);
     UPDATE lightning_matcher_shadow_comparison SET live_quality_score = NULL
      WHERE id IN (SELECT id FROM lightning_matcher_shadow_comparison WHERE cluster_id = $C ORDER BY id LIMIT 3);`
  );
  add(
    8,
    'no comparison this week',
    `SELECT mk($C, 'm1', 'm2', 40, 60, 63, 0.9, 0.9, $B, '6', '9 days');`
  );
  add(
    9,
    'only an earlier snapshot',
    `SELECT mk($C, 'm1', 'm2', 40, 60, 63, 0.9, 0.9, 'snap-old');`
  );
  add(
    10,
    'no current binding',
    `SELECT mk($C, 'm1', 'm2', 40, 60, 63, 0.9, 0.9, $B);
       DELETE FROM binding_stub WHERE cluster_id = $C;`
  );
  // Read three days ahead: the report ends its window at now(), so the rows
  // stamped tomorrow stay out and only this week's count.
  add(
    11,
    'read three days ahead',
    `SELECT mk($C, 'm1', 'm2', 40, 60, 63, 0.9, 0.95, $B);
     SELECT mk($C, 'm1', 'm2', 40, 66, 61, 0.9, 0.9, $B, '6', '-1 day');`,
    'ahead'
  );
  add(
    14,
    'read from a far future',
    `SELECT mk($C, 'm1', 'm2', 40, 60, 63, 0.9, 0.9, $B, '6', '-5 days');`,
    '2099-01-01T00:00:00Z'
  );
  // The work case: a busy week, mostly earlier snapshots, documents too big to keep inline.
  add(
    12,
    'a busy week',
    `SELECT mk($C, 'm1', 'm1-port', 2400, 60, 60.1, 0.9, 0.9, 'snap-old', '6', '1 hour', true);
     SELECT mk($C, 'm1', 'm1-port', 300, 60, 60.1, 0.9, 0.9, $B, '6', '1 hour', true);
     ANALYZE;`
  );
  for (const c of CASES) {
    if (c.at === 'yesterday') c.at = one(`SELECT (now() - interval '2 days')::text`);
    if (c.at === 'ahead') c.at = one(`SELECT (now() + interval '3 days')::text`);
  }
}, 240_000);

afterAll(() => cleanup());

describe('the Lightning operator row reads the shadow summary', () => {
  it('the pre-images are production byte for byte', () => {
    expect(one(`SELECT md5(pg_get_functiondef('${ROW}'::regprocedure))`)).toBe(PRODUCTION_ROW_MD5);
    expect(
      one(
        `SELECT md5(pg_get_functiondef('public.fn_lightning_shadow_report(uuid,timestamptz,timestamptz)'::regprocedure))`
      )
    ).toBe('36aa68d074c3d9550360f964d04f92d0');
  });

  it('reads every case on the pre-image, and the shadow key is the report first pair', () => {
    for (const c of CASES) {
      const r = row(c.cluster, c.at);
      before.set(`${c.cluster}|${c.at ?? ''}`, r);
      const shadow = JSON.parse(r).shadow;
      const pair = reportPair(c.cluster, c.at);
      expect(shadow === null ? '' : JSON.stringify(shadow), c.name).toBe(
        pair === '' ? '' : JSON.stringify(JSON.parse(pair))
      );
    }
    // The cases reach every verdict and both empty outcomes.
    const verdicts = new Set(
      [...before.values()].map((r) => JSON.parse(r).shadow?.verdict ?? 'none')
    );
    expect([...verdicts].sort()).toEqual(
      [
        'calibrated',
        'calibration_bias',
        'insufficient_evidence',
        'live_leads',
        'no_clear_winner',
        'none',
        'shadow_leads',
      ].sort()
    );
    budgetBefore = buffers(C(12));
  });

  it('the fix refuses an installed image it was not written against', () => {
    const fix = readFileSync(resolve(root, FIX), 'utf8');
    expect(fix).toContain(`'${PRODUCTION_ROW_MD5}'`);
    expect(() => sql(fix.replace(PRODUCTION_ROW_MD5, '0'.repeat(32)))).toThrow(/Source Changed/);
    expect(one(`SELECT md5(pg_get_functiondef('${ROW}'::regprocedure))`)).toBe(PRODUCTION_ROW_MD5);
  });

  it('after the fix every row is unchanged, byte for byte, and no longer calls the report', () => {
    sql(readFileSync(resolve(root, FIX), 'utf8'));
    const def = one(`SELECT pg_get_functiondef('${ROW}'::regprocedure)`);
    expect(def).not.toContain('public.fn_lightning_shadow_report(');
    expect(def).toContain('jsonb_to_record(x.live_metrics)');
    for (const c of CASES)
      expect(row(c.cluster, c.at), c.name).toBe(before.get(`${c.cluster}|${c.at ?? ''}`));
  });

  it('a busy week costs at least three times less work', () => {
    const after = buffers(C(12));
    expect(budgetBefore).toBeGreaterThan(0);
    expect(after * 3, `buffers before ${budgetBefore}, after ${after}`).toBeLessThan(budgetBefore);
    if (process.env.SHOW_BUDGET) console.log(`buffers before ${budgetBefore}, after ${after}`);
  });

  it('a metric the row never shows no longer fails the row', () => {
    const cluster = C(13);
    sql(`INSERT INTO cash_games VALUES ('${cluster}', '${C(0)}', 'odd metric', 'nlh', 1, 2, 6, true, 'lightning', 1);
         INSERT INTO binding_stub VALUES ('${cluster}', 'snap-13');
         SELECT mk('${cluster}', 'm1', 'm2', 40, 60, 63, 0.9, 0.95, 'snap-13', '6', '1 hour', false, NULL, '"fast"');`);
    expect(() =>
      one(`SELECT fn_lightning_shadow_report('${cluster}', now() - interval '7 days', now())`)
    ).toThrow(/invalid input syntax for type numeric/);
    expect(JSON.parse(row(cluster)).shadow).toMatchObject({
      verdict: 'shadow_leads',
      comparisons: 40,
    });
  });

  it('keeps its owner rights and grants: the service may run it, no client role may', () => {
    expect(
      one(
        `SELECT prosecdef::text || ' ' || provolatile::text || ' ' || array_to_string(proconfig, ',') FROM pg_proc WHERE oid = '${ROW}'::regprocedure`
      )
    ).toBe('true s search_path=public, pg_temp');
    for (const [role, allowed] of [
      ['anon', 'f'],
      ['authenticated', 'f'],
      ['service_role', 't'],
    ])
      expect(one(`SELECT has_function_privilege('${role}', '${ROW}', 'EXECUTE')`), role).toBe(
        allowed
      );
  });
});
