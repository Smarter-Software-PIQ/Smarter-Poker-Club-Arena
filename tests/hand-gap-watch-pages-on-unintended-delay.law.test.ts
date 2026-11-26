/**
 * LAW: AN UNINTENDED DELAY BETWEEN HANDS PAGES AFTER 15 MINUTES AND GRADES CADENCE
 * (incident 075013fd, lane E5 + lane 3).
 *
 * Dan 2026-11-18: "i just don't want any 'un intended delays'". The rule is
 * pinned in the engine by server/src/engine/noUnintendedDelayBetweenHands.law.test.ts
 * and graded by scripts/sql/hand-gap-unintended-delay.sql. 20261119052955
 * created the 5-minute watch; 20261119180500 upgrades it so that:
 *
 *   1. the watch's beat constants (including REBUY_PAUSE_MAX_MS and
 *      RIT_REVEAL_MAX_MS) equal the animation spec
 *      (server/src/config/handCompletionSpec.ts) and the script's, and its owed,
 *      cadence and shape expressions match the script's;
 *   2. hand_history.cadence jsonb (nullable, no default) lets cash_bust and rit
 *      hands WITH recorded cadence be graded accurately (clamped to spec maxes),
 *      while legacy rows without cadence remain ungraded; Lightning, gaps >= 60 s,
 *      and recorded maintenance/tournament breaks are still excluded;
 *   3. the window is bounded and read by index (created_at, a parameter, not
 *      clock_timestamp()); the grade is STABLE;
 *   4. the alert requires 15 minutes (3 consecutive 5-minute windows, >= 5
 *      graded hands each), opens ONE critical financial_alerts row per kind x
 *      shape with a constant message, notifies senior platform recipients ONCE
 *      on open, and notifies ONCE again when it clears (auto-resolved);
 *   5. one job every 5 minutes (20261119052955), a minute after each window closes;
 *   6. the PostgreSQL proof runs both migrations and a workflow runs the proof.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ENGINE_BETWEEN_HANDS_BUDGET_MS,
  HAND_COMPLETION as H,
} from '../server/src/config/handCompletionSpec';
import { REBUY_PAUSE_MAX_MS, RIT_REVEAL_MAX_MS } from '../server/src/engine/handCadenceSpec';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');
const BASE_FILE = '20261119052955_an_unintended_delay_between_hands_pages_within_minutes.sql';
const FILE = '20261119180500_sustained_hand_delay_alerts_and_cadence_grading.sql';
const PARITY_FILE = '20261122095254_all_in_showdown_sweep_and_award_groups_parity.sql';
const baseSql = read('supabase', 'migrations', BASE_FILE);
const sql = read('supabase', 'migrations', FILE);
const paritySql = read('supabase', 'migrations', PARITY_FILE);
const script = read('scripts', 'sql', 'hand-gap-unintended-delay.sql');
const code = (s: string) => s.replace(/--[^\n]*/g, ' ');
const flat = (s: string) => code(s).replace(/\s+/g, ' ').trim();
const grade = code(sql.split('$g$')[1] ?? '');
const watch = code(sql.split('$f$')[1] ?? '');
/** Unquote single-quoted SQL literals joined by || chr(10) || in an anchored DO block. */
const unquoteSqlConcat = (s: string) =>
  [...s.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'")).join('\n');
const parityGradeBlock = paritySql.split('$grade$')[1] ?? '';
const parityOld = unquoteSqlConcat(
  parityGradeBlock.slice(
    parityGradeBlock.indexOf('c_old constant text :='),
    parityGradeBlock.indexOf('c_new constant text :=')
  )
);
const parityNew = unquoteSqlConcat(
  parityGradeBlock.slice(
    parityGradeBlock.indexOf('c_new constant text :='),
    parityGradeBlock.indexOf('BEGIN')
  )
);
const latestGrade = grade.replace(parityOld, parityNew);

/** The text between two markers, both required. */
const between = (s: string, a: string, b: string): string => {
  const i = s.indexOf(a);
  const j = s.indexOf(b, i + a.length);
  expect(i, a).toBeGreaterThan(-1);
  expect(j, b).toBeGreaterThan(-1);
  return s.slice(i, j);
};

describe('an unintended delay between hands pages after 15 minutes and grades cadence', () => {
  it.each([
    ['bets_sweep_ms', H.BETS_SWEEP_MS],
    ['pot_push_ms', H.POT_PUSH_MS],
    ['muck_ms', H.MUCK_MS],
    ['showdown_read_base_ms', H.SHOWDOWN_READ_BASE_MS],
    ['showdown_read_per_extra_hand_ms', H.SHOWDOWN_READ_PER_EXTRA_HAND_MS],
    ['showdown_read_max_ms', H.SHOWDOWN_READ_MAX_MS],
    ['winning_cards_extra_ms', H.WINNING_CARDS_EXTRA_MS],
    ['all_in_showdown_extra_ms', H.ALL_IN_SHOWDOWN_EXTRA_MS],
    ['pot_award_stagger_ms', H.POT_AWARD_STAGGER_MS],
    ['next_hand_rest_ms', H.NEXT_HAND_REST_MS],
    ['engine_between_hands_budget_ms', ENGINE_BETWEEN_HANDS_BUDGET_MS],
    ['rebuy_pause_max_ms', REBUY_PAUSE_MAX_MS],
    ['rit_reveal_max_ms', RIT_REVEAL_MAX_MS],
  ])('the watch owes %s exactly as the spec does', (name, value) => {
    const pin = new RegExp(`\\b${value} AS ${name}\\b`);
    expect(grade).toMatch(pin);
    expect(script).toMatch(pin);
    expect((grade.match(new RegExp(`AS ${name}\\b`, 'g')) ?? []).length).toBe(1);
  });

  it('grades by the same shapes, cadence rules, and owed beats as the script', () => {
    const shapes = (s: string) =>
      flat(between(s, 'CASE WHEN s.rit_boards IS NOT NULL', 'END AS shape'));
    // The script's s CTE carries a tournament column; the watch reads tournament_id.
    expect(shapes(grade)).toBe(
      shapes(script).replace(/NOT s\.tournament/g, 's.tournament_id IS NULL')
    );
    const owed = (s: string) =>
      flat(between(s, 'CASE WHEN s.rit_boards IS NOT NULL AND s.has_cadence THEN', 'AS owed_ms'));
    expect(owed(grade)).toBe(owed(script).replace(/NOT s\.tournament/g, 's.tournament_id IS NULL'));
    const facts = (s: string) => flat(between(s, 'AS shown_n,', 'AS has_cadence'));
    expect(latestGrade).not.toBe(grade);
    expect(facts(latestGrade)).toBe(facts(script).replace(/\bh\./g, 'pair.'));
  });

  it('adds nullable hand_history.cadence safely and never grades intended waits', () => {
    expect(sql).toMatch(/SET LOCAL lock_timeout = '3s';/);
    expect(sql).toContain(
      'ALTER TABLE public.hand_history ADD COLUMN IF NOT EXISTS cadence jsonb;'
    );
    expect(sql).not.toMatch(/ADD COLUMN[^;]*cadence[^;]*DEFAULT/i);
    expect(grade).toContain(
      'NOT EXISTS (SELECT 1 FROM lightning_hand lh WHERE lh.hand_history_id IN (nx.id, p.id))'
    );
    expect(grade).toContain("nx.started_at - p.ended_at < interval '60 seconds'");
    expect(grade).toMatch(
      /FROM engine_maintenance_break_log b\s+WHERE b\.break_started_at < nx\.started_at/
    );
    expect(grade).toMatch(
      /FROM tournaments t\s+WHERE t\.id = p\.tournament_id AND t\.break_started_at < nx\.started_at/
    );
    expect(grade).toContain('count(*) FILTER (WHERE row_graded) > 0 AS graded');
    expect(grade).toContain('CASE WHEN count(*) FILTER (WHERE row_graded) = 0 THEN NULL');
  });

  it('reads one bounded window by index, and the grade is STABLE', () => {
    expect(sql).toMatch(
      /fn_ca_hand_gap_unintended_delay\(p_window_end timestamptz, p_minutes int DEFAULT 5\)[\s\S]*?\bSTABLE\b[\s\S]*?\$g\$/
    );
    expect(grade).toContain(
      'n.created_at >= p_window_end - make_interval(mins => least(greatest(p_minutes, 1), 15))'
    );
    expect(grade).toContain('AND n.created_at <  p_window_end');
    expect(grade).toMatch(/hh\.table_id = nx\.table_id\s+AND hh\.created_at < nx\.created_at/);
    expect(grade).toMatch(/ORDER BY hh\.created_at DESC\s+LIMIT 1/);
    // started_at has no index on production; a volatile bound cannot use one.
    expect(grade).not.toMatch(/WHERE[^;]*started_at\s*>\s*now\(\)/);
    expect(sql).not.toMatch(/clock_timestamp\(\)/);
    expect(grade).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
  });

  it('pages after 15 minutes (3 consecutive windows), notifies once on open and once on clear', () => {
    expect(watch).toMatch(/c_min_n\s+constant int\s+:= 5;/);
    expect(watch).toMatch(/c_minutes\s+constant int\s+:= 5;/);
    expect(watch).toMatch(/c_windows\s+constant int\s+:= 3;/);
    expect(watch).toContain("v_prev1    timestamptz := v_end - interval '5 minutes';");
    expect(watch).toContain("v_prev2    timestamptz := v_end - interval '10 minutes';");
    expect(watch).toMatch(
      /cur\.graded\s+AND cur\.hands\s+>= c_min_n AND cur\.unintended_p95_ms\s+> cur\.budget_ms\s+AND prev1\.graded AND prev1\.hands >= c_min_n AND prev1\.unintended_p95_ms > prev1\.budget_ms\s+AND prev2\.graded AND prev2\.hands >= c_min_n AND prev2\.unintended_p95_ms > prev2\.budget_ms/
    );
    expect(watch).toContain("fa.context->>'kind' = r.kind AND fa.context->>'shape' = r.shape");
    expect(watch).toContain('ON CONFLICT (window_end, kind, shape) DO NOTHING');
    expect(watch).toContain("VALUES ('critical', c_source,");
    expect(watch).toContain("'Unintended Delay Between Hands'");
    expect(watch).toContain("'Hand Delay Cleared'");
    const messages = [...watch.matchAll(/VALUES \('critical', c_source,\s+'([^']+)'/g)];
    expect(messages.length).toBe(1);
    expect(messages[0][1]).not.toMatch(/\|\||%/);
    const writes = [...watch.matchAll(/\b(?:insert\s+into|update|delete\s+from)\s+([a-z_.]+)/gi)]
      .map((m) => m[1].toLowerCase())
      .filter((t) => t !== 'set');
    expect(new Set(writes)).toEqual(new Set(['ca_hand_gap_watch_history', 'financial_alerts']));
    expect(watch).not.toMatch(/fn_[a-z_]*(repair|backpay|redrive|sweep|catchup|heal)[a-z_]*/i);
  });

  it('keeps the one five-minute job, proper grants, and transaction boundaries', () => {
    expect(baseSql).toContain(
      "SELECT cron.schedule('hand-gap-unintended-delay-watch-5m', '1-59/5 * * * *', 'select public.fn_ca_hand_gap_watch()');"
    );
    expect((baseSql.match(/cron\.schedule\(/g) ?? []).length).toBe(1);
    expect(sql).not.toContain('cron.schedule(');
    expect(sql).toMatch(/^-- @live-proof: .*hand_history/m);
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.fn_ca_hand_gap_watch\(timestamptz\) FROM PUBLIC, anon, authenticated;/
    );
    expect(sql).toMatch(/^BEGIN;$/m);
    expect(sql).toMatch(/^COMMIT;\s*$/m);
  });

  it('is proved on PostgreSQL, and a workflow runs the proof', () => {
    const harness = read('scripts', 'ci', 'test-hand-gap-watch.py');
    expect(harness).toContain(BASE_FILE);
    expect(harness).toContain(FILE);
    expect(harness).toContain(
      '20261126031922_hand_gap_tournament_break_predicate_requires_active_break.sql'
    );
    expect(harness).toContain('3rd consecutive breached window (15 min) opens ONE critical alert');
    expect(harness).toContain('when the delay clears, the alert resolves and notifies owner ONCE');
    expect(harness).toContain('cash_bust with recorded cadence is graded');
    expect(harness).toContain('rit with recorded cadence is graded');
    const wf = read('.github', 'workflows', 'hand-gap-watch-proof.yml');
    expect(wf).toContain('python3 scripts/ci/test-hand-gap-watch.py');
    expect(wf).toContain(`supabase/migrations/${BASE_FILE}`);
    expect(wf).toContain('scripts/sql/hand-gap-unintended-delay.sql');
  });

  it('requires an active or gap-overlapping tournament break instead of COALESCE(break_ends_at, infinity) (incident 1e532243)', () => {
    const breakFix = read(
      'supabase',
      'migrations',
      '20261126031922_hand_gap_tournament_break_predicate_requires_active_break.sql'
    );
    expect(breakFix).toMatch(/^-- @live-proof:/m);
    expect(breakFix).toContain('-- @probe-for: public.fn_ca_hand_gap_unintended_delay\n');
    expect(breakFix).toContain(
      '-- @probe-for: smarter_private.reliability_runbook_hand_gap_classification\n'
    );
    expect(breakFix).toContain('-- @probe-for: public.fn_ca_felt_latency\n');
    expect(breakFix).toContain('t.on_break IS TRUE');
    expect(breakFix).toMatch(/SET LOCAL lock_timeout = '3s';/);
    expect(breakFix.trim().endsWith('COMMIT;')).toBe(true);
    for (const sig of [
      'public.fn_ca_hand_gap_unintended_delay(timestamptz, int)',
      'smarter_private.reliability_runbook_hand_gap_classification(uuid, boolean, jsonb, timestamptz)',
      'public.fn_ca_felt_latency(timestamptz, timestamptz)',
    ]) {
      expect(breakFix).toContain(`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC, anon, authenticated;`);
      expect(breakFix).toContain(`GRANT EXECUTE ON FUNCTION ${sig} TO service_role;`);
    }
  });
});
