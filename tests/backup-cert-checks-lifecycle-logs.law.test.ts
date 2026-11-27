/**
 * LAW: Backup Engine certification fails closed on candidate lifecycle fatal
 * events and unintended between-hand delays during soak.
 * ============================================================================
 * Incident 075013fd (Wave 2 Hardening, Lane W5):
 *   1. `cmd_certify` in `server/standby/standby-engine.sh` ALWAYS calls
 *      `check_engine_lifecycle_logs` across the candidate's boot/soak window
 *      (when `public.engine_lifecycle_logs` exists on the Backup DB), prints
 *      the exact error and stack from the table to stderr, and fails closed
 *      on any `fatal_error`, `shutdown_failed`, `shutdown_deadline`,
 *      unexpected `leadership_shutdown`, or `level = 'fatal'` row, as well as
 *      on any unreadable DB/JSON response.
 *   2. After the steady-state soak, `cmd_certify` calls
 *      `check_soak_hand_gap_delay` using `fn_ca_hand_gap_unintended_delay`
 *      (when installed on the Backup DB) and fails closed if the check is
 *      unreadable or a graded cell breaches the sample judge (2026-11-24,
 *      Cutover reliability item 1b): any single gap more than 5,000 ms over
 *      what it owed (hard ceiling, any sample); or, for a cell of >= 10 graded
 *      hands, an over-budget (> 250 ms) count improbable at a 5 % allowed
 *      share (one-sided exact binomial, 95 % confidence); cells under 10
 *      hands are pooled per kind and the pool is tested the same way. No
 *      percentile is a verdict: in a small cell it is the slowest hand.
 *   3. Both structured summaries (`lifecycleLogCheck`, `handGapCheck`) are
 *      recorded in `certificate.json`, and `backup-engine.yml` installs
 *      `server/standby/standby-engine.sh` on every certification run.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const STANDBY_PATH = join(ROOT, 'server/standby/standby-engine.sh');
const standby = readFileSync(STANDBY_PATH, 'utf8');
const workflow = readFileSync(join(ROOT, '.github/workflows/backup-engine.yml'), 'utf8');

const VALID_SHA = 'a'.repeat(40);
const VALID_SINCE = '1763600000';

function runStandbyFn(call: string, mockPsqlOutput: string, mockPsqlExit = 0) {
  const script = `
set -Eeuo pipefail
source ${JSON.stringify(STANDBY_PATH)}
psql_db() {
  cat >/dev/null || true
  printf '%s' ${JSON.stringify(mockPsqlOutput)}
  return ${mockPsqlExit}
}
${call}
`;
  return spawnSync('bash', ['-c', script], { encoding: 'utf8' });
}

describe('Backup certification wires lifecycle log and hand-gap gates', () => {
  const certify = standby.slice(standby.indexOf('cmd_certify() {'));

  it('installs server/standby/standby-engine.sh on every certification run', () => {
    expect(workflow).toMatch(
      /server\/standby\/standby-engine\.sh > \/usr\/local\/sbin\/standby-engine/
    );
  });

  it('always checks engine_lifecycle_logs in cmd_certify and fails closed', () => {
    const fatalScan = certify.indexOf('fatals=$(count_fatal_logs "$started" "$sha")');
    const lifecycleCall = certify.indexOf(
      'lifecycle_check=$(check_engine_lifecycle_logs "$started" "$sha")'
    );
    expect(fatalScan).toBeGreaterThan(0);
    expect(lifecycleCall).toBeGreaterThan(fatalScan);
    expect(certify).toContain('record "lifecycle_fatal_events:$lc_count"');
    expect(certify).toContain("record 'lifecycle_logs_unreadable'");
    expect(certify).toContain('"lifecycleLogCheck": json.loads(sys.argv[6])');
  });

  it('checks fn_ca_hand_gap_unintended_delay after soak and fails closed', () => {
    const soakStart = certify.indexOf('soak_started=$(date +%s)');
    const handGapCall = certify.indexOf(
      'hand_gap_check=$(check_soak_hand_gap_delay "$soak_started" "$soak_window_min" "$crash_at" "$recovered_at")'
    );
    expect(soakStart).toBeGreaterThan(0);
    expect(handGapCall).toBeGreaterThan(soakStart);
    expect(certify).toContain("record 'hand_gap_unintended_delay_exceeded'");
    expect(certify).toContain("record 'hand_gap_check_unreadable'");
    expect(certify).toContain('"handGapCheck": json.loads(sys.argv[7])');
  });

  it('SQL checks guard table/function existence and pass psql variables via set_config outside DO blocks', () => {
    const lcSql = standby.slice(
      standby.indexOf("<<'SQL_LIFECYCLE_LOGS'"),
      standby.indexOf('SQL_LIFECYCLE_LOGS\n  )')
    );
    const hgSql = standby.slice(
      standby.indexOf("<<'SQL_HAND_GAP'"),
      standby.indexOf('SQL_HAND_GAP\n  )')
    );

    expect(lcSql).toContain("to_regclass('public.engine_lifecycle_logs') IS NULL");
    for (const ev of [
      'fatal_error',
      'shutdown_failed',
      'shutdown_deadline',
      'leadership_shutdown',
    ]) {
      expect(lcSql).toContain(`'${ev}'`);
    }
    expect(lcSql).toContain("level = 'fatal'");
    const lcDo = lcSql.slice(lcSql.indexOf('DO $chk$'), lcSql.indexOf('$chk$;'));
    expect(lcDo).not.toContain(":'");

    expect(hgSql).toContain(
      "v_grader regprocedure := to_regprocedure('public.fn_ca_hand_gap_unintended_delay(timestamp with time zone,integer)')"
    );
    expect(hgSql).toContain('IF v_grader IS NULL THEN');
    expect(hgSql).toContain('COALESCE(budget_ms, 250)');
    // The judge reads the grader's maximum and worst hands only when the copy's
    // grader has them, and never decides a breach in SQL.
    expect(hgSql).toContain("'worst_hands' = ANY (p.proargnames)");
    expect(hgSql).toContain('unintended_max_ms, worst_hands');
    expect(hgSql).not.toContain('unintended_p95_ms > budget_ms');
    expect(hgSql).not.toContain('hands >= 5');
    const hgDo = hgSql.slice(hgSql.indexOf('DO $gap$'), hgSql.indexOf('$gap$;'));
    expect(hgDo).not.toContain(":'");
  });
});

describe('check_engine_lifecycle_logs runtime behavior', () => {
  it('passes when the table is not yet installed (not_armed)', () => {
    const res = runStandbyFn(
      `check_engine_lifecycle_logs ${VALID_SINCE} ${VALID_SHA}`,
      JSON.stringify({ status: 'not_armed', count: 0, rows: [] })
    );
    expect(res.status, res.stderr).toBe(0);
    expect(JSON.parse(res.stdout)).toEqual({ status: 'not_armed', count: 0 });
  });

  it('passes when zero fatal/shutdown rows were recorded', () => {
    const res = runStandbyFn(
      `check_engine_lifecycle_logs ${VALID_SINCE} ${VALID_SHA}`,
      JSON.stringify({ status: 'pass', count: 0, rows: [] })
    );
    expect(res.status, res.stderr).toBe(0);
    expect(JSON.parse(res.stdout)).toEqual({ status: 'pass', count: 0 });
  });

  it('fails and prints exact error and stack when fatal_error is recorded', () => {
    const payload = {
      status: 'fail',
      count: 1,
      rows: [
        {
          id: 42,
          createdAt: '2026-11-20T20:00:00Z',
          instanceId: '1-abcd1234',
          releaseSha: VALID_SHA,
          level: 'fatal',
          event: 'fatal_error',
          message: 'Cannot read properties of undefined',
          kind: 'GameServer.Uncaught_exception',
          errorName: 'TypeError',
          errorMessage: 'Cannot read properties of undefined',
          stack: 'TypeError: Cannot read properties of undefined\n    at boot (index.ts:10:5)',
        },
      ],
    };
    const res = runStandbyFn(
      `check_engine_lifecycle_logs ${VALID_SINCE} ${VALID_SHA}`,
      JSON.stringify(payload)
    );
    expect(res.status).toBe(1);
    expect(JSON.parse(res.stdout)).toEqual({ status: 'fail', count: 1 });
    expect(res.stderr).toContain('event=fatal_error');
    expect(res.stderr).toContain('TypeError: Cannot read properties of undefined');
    expect(res.stderr).toContain('at boot (index.ts:10:5)');
  });

  it('fails on unexpected leadership_shutdown row', () => {
    const payload = {
      status: 'fail',
      count: 1,
      rows: [
        {
          id: 43,
          createdAt: '2026-11-20T20:01:00Z',
          instanceId: '1-abcd1234',
          releaseSha: VALID_SHA,
          level: 'warn',
          event: 'leadership_shutdown',
          message: 'lease expired during soak',
          kind: null,
          errorName: null,
          errorMessage: null,
          stack: null,
        },
      ],
    };
    const res = runStandbyFn(
      `check_engine_lifecycle_logs ${VALID_SINCE} ${VALID_SHA}`,
      JSON.stringify(payload)
    );
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('event=leadership_shutdown');
    expect(res.stderr).toContain('lease expired during soak');
  });

  it('fails closed (exit 2) when psql_db fails or output is unreadable', () => {
    const dbErr = runStandbyFn(`check_engine_lifecycle_logs ${VALID_SINCE} ${VALID_SHA}`, '', 1);
    expect(dbErr.status).toBe(2);

    const badJson = runStandbyFn(
      `check_engine_lifecycle_logs ${VALID_SINCE} ${VALID_SHA}`,
      'not-json'
    );
    expect(badJson.status).toBe(2);

    const badSha = runStandbyFn(`check_engine_lifecycle_logs ${VALID_SINCE} notasha`, '{}');
    expect(badSha.status).toBe(2);
  });
});

describe('check_soak_hand_gap_delay judges a sample, not a single hand (item 1b, 2026-11-24)', () => {
  const run = (payload: unknown) =>
    runStandbyFn(`check_soak_hand_gap_delay ${VALID_SINCE} 15`, JSON.stringify(payload));
  const graded = (shapes: unknown[], extremesAvailable = true) => ({
    status: 'graded',
    windowMinutes: 15,
    handsInSoak: 400,
    extremesAvailable,
    shapes,
  });
  /** A graded cell built from its per-hand unintended delays, as the grader reports it. */
  const cell = (kind: string, shape: string, unintended: number[], idPrefix = shape) => {
    const sorted = [...unintended].sort((a, b) => a - b);
    const pct = (q: number) => {
      const pos = q * (sorted.length - 1);
      const lo = Math.floor(pos);
      const hi = Math.ceil(pos);
      return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo));
    };
    const worst = unintended
      .map((ms, i) => ({ hand_id: `${idPrefix}-${i}`, table_id: 't-1', unintended_ms: ms }))
      .sort((a, b) => b.unintended_ms - a.unintended_ms)
      .slice(0, 5);
    return {
      kind,
      shape,
      graded: true,
      hands: unintended.length,
      unintended_p50_ms: pct(0.5),
      unintended_p95_ms: pct(0.95),
      unintended_p99_ms: pct(0.99),
      over_budget: unintended.filter((ms) => ms > 250).length,
      budget_ms: 250,
      unintended_max_ms: sorted[sorted.length - 1],
      worst_hands: worst,
    };
  };
  const fast = (n: number) => Array.from({ length: n }, (_, i) => (i % 7) + 1);
  // Backup refusal of 19203b9a1f0b, 2026-11-24 12:47Z: cash showdown_checked_river,
  // 14 hands, p50 1 ms, ONE hand at 1,422 ms, over_budget = 1.
  const refusal1247 = [...fast(13).map(() => 1), 1422];
  // The distribution #11883 fixed (await_post_hand_tasks): p50 506 ms, p90 3,535 ms, max 7,821 ms.
  const pre11883 = [12, 40, 90, 180, 240, 380, 506, 506, 720, 1100, 1900, 2800, 3535, 7821];

  it('pins the judge constants: the 250 ms budget, 5 % share at 95 % confidence, 10-hand cells, 5 s ceiling', () => {
    expect(standby).toContain('DEFAULT_BUDGET_MS = 250');
    expect(standby).toContain('ALLOWED_OVER_BUDGET_RATE = 0.05');
    expect(standby).toContain('CONFIDENCE = 0.95');
    expect(standby).toContain('MIN_CELL_HANDS = 10');
    expect(standby).toContain('HARD_CEILING_MS = 5000');
  });

  // The three Backup refusals of 2026-11-25 (runs 45645919909, 45660681382,
  // 45669035764) on byte-identical engine code, as the legacy grader reported them
  // (no unintended_max_ms / worst_hands on that copy).
  const legacyCell = (shape: string, hands: number, over: number, p95: number, p99: number) => ({
    kind: 'cash',
    shape,
    graded: true,
    hands,
    unintended_p50_ms: 1,
    unintended_p95_ms: p95,
    unintended_p99_ms: p99,
    over_budget: over,
    budget_ms: 250,
  });

  it('the 2026-11-25 refusals of identical engine code: noise passes, a 7.6 s stall still fails', () => {
    const run45669035764 = run(graded([legacyCell('fold', 208, 11, 1046, 1615)], false));
    expect(run45669035764.status, run45669035764.stderr).toBe(0);
    const run45660681382 = run(graded([legacyCell('fold', 167, 13, 1609, 1621)], false));
    expect(run45660681382.status, run45660681382.stderr).toBe(0);
    const run45645919909 = run(
      graded(
        [
          legacyCell('fold', 159, 15, 4586, 7632),
          legacyCell('showdown_checked_river', 9, 1, 2759, 4229),
        ],
        false
      )
    );
    expect(run45645919909.status).toBe(1);
    expect(run45645919909.stderr).toContain('rule=hard_ceiling p99_ms(lower bound of max)=7632');
    expect(run45645919909.stderr).toContain('rule=over_budget_share over_budget=15/159');
  });

  it('judges a cell of thousands of hands without overflowing the binomial tail', () => {
    const big = (n: number, over: number) =>
      cell('cash', 'fold', Array.from({ length: n }, (_, i) => (i < over ? 900 : 3)));
    const healthy = run(graded([big(2400, 120)]));
    expect(healthy.status, healthy.stderr).toBe(0);
    expect(healthy.stderr).not.toContain('Traceback');
    expect(JSON.parse(healthy.stdout).cells[0].pValue).toBeGreaterThan(0.05);
    const shifted = run(graded([big(2400, 160)]));
    expect(shifted.status, shifted.stderr).toBe(1);
    expect(shifted.stderr).not.toContain('Traceback');
    expect(shifted.stderr).toContain('rule=over_budget_share over_budget=160/2400');
  });

  it('passes when fn_ca_hand_gap_unintended_delay is not installed (not_armed)', () => {
    const res = run({
      status: 'not_armed',
      windowMinutes: 15,
      handsInSoak: 0,
      extremesAvailable: false,
      shapes: [],
    });
    expect(res.status, res.stderr).toBe(0);
    expect(JSON.parse(res.stdout).status).toBe('not_armed');
  });

  it('the 12:47Z case no longer fails a cycle on one 1,422 ms hand in 14 (P = 0.51)', () => {
    const res = run(graded([cell('cash', 'showdown_checked_river', refusal1247)]));
    expect(res.status, res.stderr).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out).toMatchObject({ status: 'pass', breachCount: 0 });
    expect(out.cells[0]).toMatchObject({ n: 14, overBudget: 1, maxMs: 1422, judged: 'cell' });
    expect(out.cells[0].pValue).toBeCloseTo(1 - 0.95 ** 14, 6);
  });

  it('the 12:47Z case also passes on a copy whose grader predates worst_hands (p99 judged as a lower bound)', () => {
    const legacy = cell('cash', 'showdown_checked_river', refusal1247) as Record<string, unknown>;
    delete legacy.unintended_max_ms;
    delete legacy.worst_hands;
    const res = run(graded([legacy], false));
    expect(res.status, res.stderr).toBe(0);
    expect(JSON.parse(res.stdout)).toMatchObject({ status: 'pass', extremesAvailable: false });
  });

  it('the same single hand fails at any sample size once it breaches the 5 s hard ceiling, naming it', () => {
    const stall = [...refusal1247.slice(0, 13), 6100];
    const res = run(graded([cell('cash', 'showdown_checked_river', stall, 'h1247')]));
    expect(res.status).toBe(1);
    const out = JSON.parse(res.stdout);
    expect(out.breaches.map((b: { rule: string }) => b.rule)).toEqual(['hard_ceiling']);
    expect(res.stderr).toContain(
      'kind=cash shape=showdown_checked_river n=14 rule=hard_ceiling max_ms=6100 > ceiling_ms=5000'
    );
    expect(res.stderr).toContain('worst_hands=[h1247-13:6100ms');
  });

  it('a 5 s stall in a 2-hand cell still fails (the ceiling needs no sample)', () => {
    const res = run(graded([cell('tournament', 'fold', [2, 5200], 'tiny')]));
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('kind=tournament shape=fold n=2 rule=hard_ceiling max_ms=5200');
  });

  it('a legacy copy fails the ceiling when p99 (a lower bound of the max) is above it, and says ids are unavailable', () => {
    const legacy = cell('cash', 'fold', [...fast(40), 9000]) as Record<string, unknown>;
    delete legacy.unintended_max_ms;
    delete legacy.worst_hands;
    const res = run(graded([legacy], false));
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('rule=hard_ceiling p99_ms(lower bound of max)=');
    expect(res.stderr).toContain('worst_hands=unavailable (grader predates worst_hands)');
  });

  it('the pre-#11883 regression (p50 506 ms, p90 3,535 ms, max 7,821 ms) still fails, on both rules', () => {
    const res = run(graded([cell('tournament', 'fold', pre11883, 'pre11883')]));
    expect(res.status).toBe(1);
    const rules = JSON.parse(res.stdout).breaches.map((b: { rule: string }) => b.rule);
    expect(rules).toEqual(['hard_ceiling', 'over_budget_share']);
    expect(res.stderr).toContain(
      'kind=tournament shape=fold n=14 rule=over_budget_share over_budget=9/14'
    );
    expect(res.stderr).toContain('worst_hands=[pre11883-13:7821ms, pre11883-12:3535ms');
  });

  it('the pre-#11883 shift fails on the share alone when no hand reaches the ceiling', () => {
    const capped = pre11883.map((ms) => Math.min(ms, 3535));
    const res = run(graded([cell('tournament', 'fold', capped)]));
    expect(res.status).toBe(1);
    expect(JSON.parse(res.stdout).breaches.map((b: { rule: string }) => b.rule)).toEqual([
      'over_budget_share',
    ]);
  });

  it('an all-fast run passes, large and small cells alike', () => {
    const res = run(
      graded([
        cell('cash', 'fold', fast(90)),
        cell('cash', 'showdown_checked_river', fast(14)),
        cell('cash', 'showdown_river_chips', fast(6)),
        cell('tournament', 'all_in_showdown', fast(3)),
      ])
    );
    expect(res.status, res.stderr).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out).toMatchObject({ status: 'pass', breachCount: 0 });
    expect(
      out.cells.filter((c: { judged: string }) => c.judged === 'insufficient_sample').length
    ).toBe(2);
  });

  it('a small sample with several slow hands fails: 3 of 14 at ~600 ms (P = 0.030)', () => {
    const res = run(graded([cell('cash', 'showdown_checked_river', [...fast(11), 580, 610, 640])]));
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('rule=over_budget_share over_budget=3/14');
    expect(res.stderr).toMatch(/p_value=0\.030\d* < 0\.05/);
  });

  it('cells under 10 hands issue no verdict alone but are pooled per kind and still fail together', () => {
    const res = run(
      graded([
        cell('cash', 'showdown_river_chips', [1, 2, 3, 520, 560, 600], 'rc'),
        cell('cash', 'fold', fast(8)),
      ])
    );
    expect(res.status).toBe(1);
    const out = JSON.parse(res.stdout);
    expect(out.cells.every((c: { judged: string }) => c.judged === 'insufficient_sample')).toBe(
      true
    );
    expect(out.breaches).toHaveLength(1);
    expect(res.stderr).toContain(
      'kind=cash shape=pooled(showdown_river_chips+fold) n=14 rule=over_budget_share_pooled over_budget=3/14'
    );
    expect(res.stderr).toContain('worst_hands=[rc-5:600ms, rc-4:560ms, rc-3:520ms');
  });

  it('one slow hand in a small pooled cell passes', () => {
    const res = run(
      graded([cell('cash', 'all_in_showdown', [1, 2, 900]), cell('cash', 'cash_bust', [1, 2])])
    );
    expect(res.status, res.stderr).toBe(0);
  });

  it('an ungraded cell is never judged', () => {
    const ungraded = { ...cell('cash', 'rit', [9000, 9000]), graded: false };
    const res = run(graded([ungraded]));
    expect(res.status, res.stderr).toBe(0);
  });

  it('fails closed (exit 2) when psql_db fails, the output is unreadable, or a count is impossible', () => {
    const dbErr = runStandbyFn(`check_soak_hand_gap_delay ${VALID_SINCE} 15`, '', 1);
    expect(dbErr.status).toBe(2);

    const badJson = runStandbyFn(`check_soak_hand_gap_delay ${VALID_SINCE} 15`, 'corrupt');
    expect(badJson.status).toBe(2);

    const impossible = run(graded([{ ...cell('cash', 'fold', fast(5)), over_budget: 6 }]));
    expect(impossible.status).toBe(2);

    const oldShape = run({
      status: 'pass',
      windowMinutes: 15,
      handsInSoak: 1,
      breaches: [],
      shapes: [],
    });
    expect(oldShape.status).toBe(2);
  });
});

describe('the crash drill is not an engine stall (run 45885658741, 2026-11-26)', () => {
  // Backup run 45885658741 refused 2238a16342de on ONE cash fold pair at
  // 34,642 ms (hand dff6cb90, table 6d9b0dd4) with crash recovery 29 s; run
  // 45892895834 certified 396283f68a7f, the same engine code, with no breach.
  // The pair's gap spanned the certification's own SIGKILL and restart.
  const run = (payload: unknown, args = '15 1764188000 1764188029') =>
    runStandbyFn(`check_soak_hand_gap_delay ${VALID_SINCE} ${args}`, JSON.stringify(payload));
  const worst = [
    { hand_id: 'dff6cb90-ecb8-4a01-98c1-b1754ba5b0dc', table_id: '6d9b0dd4-99f3-4a12-b9ab-b5210b373a92', unintended_ms: 34642 },
    { hand_id: 'ef6805e5-24bd-415a-8fcc-43528b8fb5c7', table_id: 'a2b7dbef-916c-4d88-947a-340544616c78', unintended_ms: 5 },
    { hand_id: '51682e1f-68ac-4582-9402-4bdb97f7283a', table_id: 'd751abf9', unintended_ms: 4 },
    { hand_id: '6f71dd8b-b94d-4fa3-95a6-f28dc1fab925', table_id: 't-4', unintended_ms: 4 },
    { hand_id: '8135f55c-af3d-4699-aa91-4b514b80b3a0', table_id: 't-5', unintended_ms: 4 },
  ];
  const fold = (w = worst, hands = 313, over = 1) => ({
    kind: 'cash', shape: 'fold', graded: true, hands, unintended_p50_ms: 1, unintended_p95_ms: 3,
    unintended_p99_ms: 4, over_budget: over, budget_ms: 250, unintended_max_ms: w[0].unintended_ms, worst_hands: w,
  });
  const payload = (harnessCrashPairs: unknown[], cells = [fold()]) => ({
    status: 'graded', windowMinutes: 15, handsInSoak: 361, extremesAvailable: true, harnessCrashPairs, shapes: cells,
  });
  const drillPair = { hand_id: worst[0].hand_id, table_id: worst[0].table_id, gap_ms: 36492 };

  it('the refused case passes once its drill-spanning pair is left out, and says so', () => {
    const res = run(payload([drillPair]));
    expect(res.status, res.stderr).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out).toMatchObject({ status: 'pass', breachCount: 0 });
    expect(out.cells[0]).toMatchObject({ n: 312, overBudget: 0, maxMs: 5, harnessExcluded: [worst[0].hand_id] });
    expect(out.harnessCrashPairs).toMatchObject({ excluded: [worst[0].hand_id], notLocated: [] });
    expect(res.stderr).toContain('spanning the crash drill left out');
  });

  it('without a drill-spanning pair the same 34 s gap still fails the ceiling (nothing is loosened)', () => {
    const res = run(payload([]));
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('kind=cash shape=fold n=313 rule=hard_ceiling max_ms=34642 > ceiling_ms=5000');
  });

  it('a real stall beside the drill pair still fails, named by its own hand', () => {
    const w = [worst[0], { hand_id: 'real-stall', table_id: 't-9', unintended_ms: 7600 }, ...worst.slice(1, 4)];
    const res = run(payload([drillPair], [fold(w, 313, 2)]));
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('kind=cash shape=fold n=312 rule=hard_ceiling max_ms=7600');
    expect(res.stderr).toContain('worst_hands=[real-stall:7600ms');
  });

  it('a drill pair outside every worst list is kept and reported, never silently dropped', () => {
    const res = run(payload([{ hand_id: 'elsewhere', table_id: 't-x', gap_ms: 31000 }]));
    expect(res.status).toBe(1);
    expect(JSON.parse(res.stdout).harnessCrashPairs.notLocated).toEqual(['elsewhere']);
  });

  it('a legacy grader without worst hands is judged unadjusted', () => {
    const legacy = { ...fold(), unintended_p99_ms: 34642 } as Record<string, unknown>;
    delete legacy.unintended_max_ms;
    delete legacy.worst_hands;
    const res = run({ ...payload([drillPair], [legacy as never]), extremesAvailable: false });
    expect(res.status).toBe(1);
  });

  it('the SQL lists only pairs whose gap spans the drill, keyed by the hand before the gap; two arguments still work', () => {
    const hgSql = standby.slice(standby.indexOf("<<'SQL_HAND_GAP'"), standby.indexOf('SQL_HAND_GAP\n  )'));
    expect(hgSql).toContain('IF v_crash > 0 AND v_recovered >= v_crash THEN');
    expect(hgSql).toContain('AND p.ended_at < to_timestamp(v_recovered)');
    expect(hgSql).toContain('AND nx.started_at > to_timestamp(v_crash);');
    expect(hgSql).toContain("'hand_id', p.id");
    expect(hgSql).toContain("AND nx.started_at - p.ended_at < interval '60 seconds'");
    const certify = standby.slice(standby.indexOf('cmd_certify() {'));
    expect(certify.indexOf('crash_at=$(date +%s)')).toBeLessThan(certify.indexOf('crash_container "$container_id"'));
    expect(certify).toContain('recovered_at=$(date +%s)');
    const twoArgs = runStandbyFn(`check_soak_hand_gap_delay ${VALID_SINCE} 15`, JSON.stringify(payload([])));
    expect(twoArgs.status).toBe(1);
    expect(run(payload([]), '15 nope 1').status).toBe(2);
  });
});
