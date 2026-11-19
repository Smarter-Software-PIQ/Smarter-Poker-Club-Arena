/**
 * LAW: AN UNINTENDED DELAY BETWEEN HANDS PAGES WITHIN MINUTES (incident 075013fd, lane E5).
 *
 * Dan 2026-11-18: "i just don't want any 'un intended delays'". The rule is
 * pinned in the engine by server/src/engine/noUnintendedDelayBetweenHands.law.test.ts
 * and graded by scripts/sql/hand-gap-unintended-delay.sql. 20261119052955
 * turns that grade into a production watch: fn_ca_hand_gap_unintended_delay
 * (STABLE, one 5-minute window), ca_hand_gap_watch_history, and
 * fn_ca_hand_gap_watch every 5 minutes, which pages (a critical
 * financial_alerts row, folded into one incident) when a shape's p95 is over
 * the budget for two consecutive windows.
 *
 * This pins:
 *   1. the watch's beat constants equal the animation spec
 *      (server/src/config/handCompletionSpec.ts) and the script's, and its owed
 *      and shape expressions are the script's, so the watch cannot drift from
 *      the spec or from the grade a person runs by hand;
 *   2. the exclusions: Lightning (either hand), gaps of 60 s or more, recorded
 *      maintenance and tournament breaks; run-it-twice and cash busts are their
 *      own shapes and never over budget;
 *   3. the window is bounded and read by index (created_at, a parameter, not
 *      clock_timestamp()); the grade is STABLE;
 *   4. the alert: two consecutive windows, >= 5 graded hands, one open alert
 *      per kind x shape, constant message, auto-resolving; it writes its own
 *      history and financial_alerts and nothing else;
 *   5. one job every 5 minutes, a minute after the window closes;
 *   6. the PostgreSQL proof runs it and a workflow runs the proof.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ENGINE_BETWEEN_HANDS_BUDGET_MS,
  HAND_COMPLETION as H,
} from '../server/src/config/handCompletionSpec';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');
const FILE = '20261119052955_an_unintended_delay_between_hands_pages_within_minutes.sql';
const sql = read('supabase', 'migrations', FILE);
const script = read('scripts', 'sql', 'hand-gap-unintended-delay.sql');
const code = (s: string) => s.replace(/--[^\n]*/g, ' ');
const flat = (s: string) => code(s).replace(/\s+/g, ' ').trim();
const grade = code(sql.split('$g$')[1] ?? '');
const watch = code(sql.split('$f$')[1] ?? '');

/** The text between two markers, both required. */
const between = (s: string, a: string, b: string): string => {
  const i = s.indexOf(a);
  const j = s.indexOf(b, i + a.length);
  expect(i, a).toBeGreaterThan(-1);
  expect(j, b).toBeGreaterThan(-1);
  return s.slice(i, j);
};

describe('an unintended delay between hands pages within minutes', () => {
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
  ])('the watch owes %s exactly as the spec does', (name, value) => {
    const pin = new RegExp(`\\b${value} AS ${name}\\b`);
    expect(grade).toMatch(pin);
    expect(script).toMatch(pin);
    expect((grade.match(new RegExp(`AS ${name}\\b`, 'g')) ?? []).length).toBe(1);
  });

  it('grades by the same shapes and owed beats as the script', () => {
    const shapes = (s: string) =>
      flat(between(s, 'CASE WHEN s.rit_boards IS NOT NULL', 'END AS shape'));
    // The script's s CTE carries a tournament column; the watch reads tournament_id.
    expect(shapes(grade)).toBe(
      shapes(script).replace('NOT s.tournament AND', 's.tournament_id IS NULL AND')
    );
    const owed = (s: string) => flat(between(s, 'CASE WHEN s.shown_n < 2 THEN', 'AS owed_ms'));
    expect(owed(grade)).toBe(owed(script));
    const facts = (s: string) => flat(between(s, 'AS shown_n,', 'AS someone_busted'));
    expect(facts(grade)).toBe(facts(script).replace(/\bh\./g, 'pair.'));
  });

  it('never grades a wait that is intended', () => {
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
    expect(grade).toContain("shape NOT IN ('rit', 'cash_bust') AS graded");
    expect(grade).toContain("CASE WHEN shape IN ('rit', 'cash_bust') THEN NULL");
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

  it('pages on two consecutive windows, once per shape, and resolves itself', () => {
    expect(watch).toMatch(/c_min_n\s+constant int\s+:= 5;/);
    expect(watch).toMatch(/c_minutes\s+constant int\s+:= 5;/);
    expect(watch).toContain("v_prev     timestamptz := v_end - interval '5 minutes';");
    expect(watch).toMatch(
      /cur\.graded AND cur\.hands >= c_min_n AND cur\.unintended_p95_ms > cur\.budget_ms\s+AND prev\.graded AND prev\.hands >= c_min_n AND prev\.unintended_p95_ms > prev\.budget_ms/
    );
    expect(watch).toContain("fa.context->>'kind' = r.kind AND fa.context->>'shape' = r.shape");
    expect(watch).toContain('ON CONFLICT (window_end, kind, shape) DO NOTHING');
    expect(watch).toContain("VALUES ('critical', c_source,");
    const messages = [...watch.matchAll(/VALUES \('critical', c_source,\s+'([^']+)'/g)];
    expect(messages.length).toBe(1);
    expect(messages[0][1]).not.toMatch(/\|\||%/);
    const writes = [...watch.matchAll(/\b(?:insert\s+into|update|delete\s+from)\s+([a-z_.]+)/gi)]
      .map((m) => m[1].toLowerCase())
      .filter((t) => t !== 'set');
    expect(new Set(writes)).toEqual(new Set(['ca_hand_gap_watch_history', 'financial_alerts']));
    expect(watch).not.toMatch(/fn_[a-z_]*(repair|backpay|redrive|sweep|catchup|heal)[a-z_]*/i);
  });

  it('is one five-minute job, a minute after each window closes', () => {
    expect(sql).toContain(
      "SELECT cron.schedule('hand-gap-unintended-delay-watch-5m', '1-59/5 * * * *', 'select public.fn_ca_hand_gap_watch()');"
    );
    expect((sql.match(/cron\.schedule\(/g) ?? []).length).toBe(1);
    expect(sql).toMatch(/^-- periodic-work: \S/m);
    expect(sql).toMatch(/^-- @live-proof: .*hand-gap-unintended-delay-watch-5m/m);
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.fn_ca_hand_gap_watch\(timestamptz\) FROM PUBLIC, anon, authenticated;/
    );
    expect(sql).toMatch(/ALTER TABLE public\.ca_hand_gap_watch_history ENABLE ROW LEVEL SECURITY;/);
    expect(sql).toMatch(/^BEGIN;$/m);
    expect(sql).toMatch(/^COMMIT;\s*$/m);
  });

  it('is proved on PostgreSQL, and a workflow runs the proof', () => {
    const harness = read('scripts', 'ci', 'test-hand-gap-watch.py');
    expect(harness).toContain(FILE);
    expect(harness).toContain('the second consecutive breached window opens ONE critical alert');
    expect(harness).toContain('on its owed beats is 0 ms unintended');
    const wf = read('.github', 'workflows', 'hand-gap-watch-proof.yml');
    expect(wf).toContain('python3 scripts/ci/test-hand-gap-watch.py');
    expect(wf).toContain(`supabase/migrations/${FILE}`);
    expect(wf).toContain('scripts/sql/hand-gap-unintended-delay.sql');
  });
});
