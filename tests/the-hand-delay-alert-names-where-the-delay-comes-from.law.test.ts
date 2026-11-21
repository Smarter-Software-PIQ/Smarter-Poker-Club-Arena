/**
 * LAW: THE HAND-DELAY ALERT NAMES WHERE THE DELAY COMES FROM (2026-11-20).
 *
 * "Unintended Delay Between Hands ... P95 +1160 Ms Over The 250 Ms Budget"
 * said THAT the engine waited between hands, never on WHAT, so every
 * investigation re-derived the same split by hand. Measured on production
 * 2026-11-20: all-in showdowns without a bust ran p95 498 ms over their owed
 * beats, with a bust 1,783 ms, and the slowest gaps spent 1.6-2.2 s in
 * announce_seat_moves (post-bust table balancing). 20261121000757 makes the
 * grade, the history, the alert and the owner's page carry that split.
 *
 * Pinned here, statically (the behaviour is proved on PostgreSQL by
 * scripts/ci/test-hand-gap-watch.py, on production's own function text):
 *   1. the split facts (seat_moved) and the eight split aggregates are the
 *      same text in the migration and in scripts/sql/hand-gap-unintended-delay.sql;
 *   2. the grader is re-created from production's text by exact anchors, each
 *      matched once, keeping the shapes, budget and exclusions it already has;
 *   3. the watch keeps its identity: the constant message, the kind x shape
 *      dedupe, three windows of five minutes, at least five graded hands;
 *   4. windows recorded before the upgrade are left out of the sums, never
 *      counted as zero, and the owner page appends the attribution sentence;
 *   5. no hot-table lock, one transaction, probes and a live proof.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');
const FILE = '20261121000757_the_hand_delay_alert_names_where_the_delay_comes_from.sql';
const sql = read('supabase', 'migrations', FILE);
const script = read('scripts', 'sql', 'hand-gap-unintended-delay.sql');
const code = (s: string) => s.replace(/--[^\n]*/g, ' ');
const flat = (s: string) => code(s).replace(/\s+/g, ' ').trim();
const watch = code(sql.split('$f$')[1] ?? '');
const grade = sql.split('$grade$')[1] ?? '';

/** The text between two markers, both required. */
const between = (s: string, a: string, b: string): string => {
  const i = s.indexOf(a);
  const j = s.indexOf(b, i + a.length);
  expect(i, a).toBeGreaterThan(-1);
  expect(j, b).toBeGreaterThan(-1);
  return s.slice(i, j + b.length);
};

/** The migration builds SQL from quoted literals joined by || chr(10) ||; recover the text. */
const unquote = (s: string) =>
  [...s.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'")).join(' ');

const SPLIT = [
  'after_bust',
  'after_bust_over_budget',
  'after_bust_unintended_p95_ms',
  'after_seat_move',
  'after_seat_move_over_budget',
  'after_seat_move_unintended_p95_ms',
  'after_bust_and_seat_move_over_budget',
  'neither_unintended_p95_ms',
];

describe('the hand-delay alert names where the delay comes from', () => {
  it('the grader and the script read a seat move the same way', () => {
    const fact = (s: string) => flat(between(s, 'EXISTS (SELECT 1 FROM tournament_seat_move_receipts mv', 'AS seat_moved'));
    expect(fact(unquote(grade))).toBe(fact(script).replace(/\bh\./g, 'pair.'));
    expect(fact(script)).toContain('mv.moved_at > h.ended_at AND mv.moved_at <= h.next_start');
    expect(fact(script)).toContain('(mv.source_table_id = h.table_id OR mv.destination_table_id = h.table_id)');
  });

  it('the grader and the script aggregate the split with the same eight expressions', () => {
    const agg = (s: string) =>
      flat(between(s, 'count(*) FILTER (WHERE row_graded AND someone_busted)::int AS after_bust,', 'AS neither_unintended_p95_ms'));
    expect(agg(unquote(grade))).toBe(agg(script));
    for (const col of SPLIT) {
      expect(agg(script), col).toMatch(new RegExp(`AS ${col}\\b`));
      expect(sql, col).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${col} integer`));
      expect(watch, col).toMatch(new RegExp(`g\\.${col}\\b`));
    }
  });

  it('re-creates the grader from production text by anchors matched exactly once', () => {
    expect(grade).toContain(
      "pg_get_functiondef('public.fn_ca_hand_gap_unintended_delay(timestamp with time zone,integer)'::regprocedure)"
    );
    expect(grade).toMatch(/FOREACH v_anchor IN ARRAY ARRAY\[c_ret_old, c_pair_old, c_fact_old, c_shape_old, c_out_old\]/);
    expect(grade).toContain('(length(v_def) - length(replace(v_def, v_anchor, \'\'))) / length(v_anchor) <> 1');
    expect(grade).toContain('DROP FUNCTION public.fn_ca_hand_gap_unintended_delay(timestamptz, int);');
    expect(grade).toContain('EXECUTE v_new;');
    // Shapes, owed beats, the budget and the exclusions are not rewritten here.
    expect(grade).not.toMatch(/END AS shape|AS owed_ms|engine_between_hands_budget_ms|lightning_hand|ca_tournament_hand_for_hand/);
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.fn_ca_hand_gap_unintended_delay\(timestamptz, int\) TO service_role;/
    );
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.fn_ca_hand_gap_unintended_delay\(timestamptz, int\) FROM PUBLIC, anon, authenticated;/
    );
  });

  it('keeps the alert identity: constant message, kind x shape dedupe, 3 x 5 minutes, 5 hands', () => {
    expect(watch).toMatch(/c_windows\s+constant int\s+:= 3;/);
    expect(watch).toMatch(/c_minutes\s+constant int\s+:= 5;/);
    expect(watch).toMatch(/c_min_n\s+constant int\s+:= 5;/);
    expect(watch).toContain("fa.context->>'kind' = r.kind AND fa.context->>'shape' = r.shape");
    expect(watch).toContain('ON CONFLICT (window_end, kind, shape) DO NOTHING');
    const messages = [...watch.matchAll(/VALUES \('critical', c_source,\s+'([^']+)'/g)];
    expect(messages.length).toBe(1);
    expect(messages[0][1]).toBe(
      'Unintended delay between hands: for three consecutive 5-minute windows (15 minutes), the p95 of the gap between hands beyond the beats the hand is owed is over the engine budget. Something the engine waits on between hands is not an intended animation or pause.'
    );
    expect(watch).not.toMatch(/fn_raise_notification|ca_incident_recipients|push_outbox/);
    expect(watch).toContain("'paged_via', 'operational_alert_events'");
  });

  it('leaves out windows recorded before the upgrade instead of counting them as zero', () => {
    expect(watch).toContain(
      'v_split_windows := (r.after_bust_over_budget IS NOT NULL)::int'
    );
    expect(watch).toContain(
      'CASE WHEN r.prev1_bust_over IS NOT NULL THEN COALESCE(r.prev1_over, 0) ELSE 0 END'
    );
    expect(watch).toContain('v_attr := CASE WHEN v_split_windows > 0 AND v_over > 0 THEN format(');
    expect(watch).toContain("'attribution', v_attr,");
  });

  it('the owner page appends the attribution sentence to the delay sentence', () => {
    expect(sql).toContain("(p95 +%s ms over the %s ms budget).%s'',\\n");
    expect(sql).toContain(
      "COALESCE('' '' || NULLIF(NEW.payload->''original_event''->''context''->>''attribution'', ''''), ''''))"
    );
    expect(sql).toContain('hand_delay summary anchor did not match exactly once');
  });

  it('takes no hot-table lock, is one transaction, probes its functions and proves itself live', () => {
    expect(sql).not.toMatch(/ALTER TABLE public\.(hand_history|tables|clubs|tournaments)\b/);
    expect(sql).not.toMatch(/@install-window/);
    expect((sql.match(/^BEGIN;$/gm) ?? []).length).toBe(1);
    expect((sql.match(/^COMMIT;$/gm) ?? []).length).toBe(1);
    expect(sql).toMatch(/SET LOCAL lock_timeout = '3s';/);
    expect(sql).toContain('-- @probe-for: public.fn_ca_hand_gap_unintended_delay');
    expect(sql).toContain('-- @probe-for: public.fn_ca_hand_gap_watch');
    expect(sql).toContain("RAISE EXCEPTION 'probe-unwind'");
    expect(sql).toMatch(/^-- @live-proof: \(SELECT .*neither_unintended_p95_ms integer.*'attribution'.*\)$/m);
  });

  it('is proved on PostgreSQL against production text, and a workflow runs the proof', () => {
    const harness = read('scripts', 'ci', 'test-hand-gap-watch.py');
    expect(harness).toContain(FILE);
    expect(harness).toContain('split: the grade splits graded hands by a bust and a seat move inside the gap');
    expect(harness).toContain(
      'split: the alert names where the delay comes from, leaving out the window recorded before the upgrade'
    );
    expect(harness).toContain('split: the owner page carries the attribution sentence after the delay sentence');
    expect(harness).toContain('af9240f68db8e5ee82e56785c5044f58,c4055ac1f91c17038a340ba938121fb1,cd785681c14f0ba6ae38fe944069e6ab');
    const wf = read('.github', 'workflows', 'hand-gap-watch-proof.yml');
    expect(wf).toContain(`supabase/migrations/${FILE}`);
    expect(wf).toContain('supabase/migrations/20261119211558_a_hand_for_hand_wait_is_an_owed_wait.sql');
  });

});
