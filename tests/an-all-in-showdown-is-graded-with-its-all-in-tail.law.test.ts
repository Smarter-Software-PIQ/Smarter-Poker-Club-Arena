/**
 * LAW: AN ALL-IN SHOWDOWN IS GRADED WITH ITS ALL-IN TAIL, HOWEVER THE CHIPS
 * WENT IN (EngineCutoverMissed 2026-11-22, operational_alert_events 447376;
 * incident 076ff467).
 *
 * The engine adds ALL_IN_SHOWDOWN_EXTRA_MS whenever a shown player is all-in
 * (isAllInShowdown reads player.is_all_in). HandController sets is_all_in on a
 * call, bet, raise, blind or ante that empties the stack and records the
 * action under that name, so a grader that looked only for an action named
 * 'all_in' owed 500 ms too little and called the difference an engine delay.
 * On 2026-11-22 the Backup refused the night's only shippable build on exactly
 * that (cash_bust p50 +1 ms, p95 +499 ms, p99 +501 ms) and the 04:00 cutover
 * sent nothing.
 *
 * The rule, on every grader: the engine's recorded cadence.all_in_showdown
 * when the next hand carries it; otherwise an 'all_in' action by a shown
 * player OR a shown player left at stack 0. Proved natively (before and after
 * the migration) by scripts/ci/test-hand-gap-watch.py phase 5.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');
const FILE = '20261122105551_an_all_in_showdown_is_graded_with_its_all_in_tail.sql';
const sql = read('supabase', 'migrations', FILE);
const script = read('scripts', 'sql', 'hand-gap-unintended-delay.sql');
const proof = read('scripts', 'ci', 'test-hand-gap-watch.py');
const workflow = read('.github', 'workflows', 'hand-gap-watch-proof.yml');
const cadenceSpec = read('server', 'src', 'engine', 'handCadenceSpec.ts');
const dealing = read('server', 'src', 'engine', 'ServerTableEngineDealing.ts');
const frames = read('server', 'src', 'engine', 'presentation', 'handEventFrames.ts');
const code = (s: string) => s.replace(/--[^\n]*/g, ' ');
const flat = (s: string) => code(s).replace(/\s+/g, ' ').trim();

/** The SQL text a migration builds from `'...' || chr(10) || '...'` literals. */
const literal = (name: string, block: string): string => {
  const m = block.match(new RegExp(`${name} constant text := ([\\s\\S]*?);\\n`));
  expect(m, name).toBeTruthy();
  return (m![1].match(/'((?:[^']|'')*)'|chr\(10\)/g) ?? [])
    .map((t) => (t === 'chr(10)' ? '\n' : t.slice(1, -1).replace(/''/g, "'")))
    .join('');
};
const edits = sql.split('DO $edit$').slice(1);

describe('an all-in showdown is graded with its all-in tail', () => {
  it('the engine decides the tail from player state, not action names', () => {
    expect(frames).toMatch(/shown\.has\(p\.user_id\) && p\.is_all_in === true/);
  });

  it('the engine records the fact it sized the hold from on the next hand cadence', () => {
    expect(cadenceSpec).toMatch(/all_in_showdown\?: boolean;/);
    const at = dealing.indexOf('this.pendingPriorHandCadence = {');
    expect(at).toBeGreaterThan(-1);
    const record = dealing.slice(at, dealing.indexOf('};', at));
    expect(record).toContain('all_in_showdown: this.currentHandAllInShowdown');
    // ... and the hold itself was sized from the same field.
    expect(dealing).toContain('allInShowdown: this.currentHandAllInShowdown,');
  });

  it('edits both graders from production text by single-match anchors, in one transaction', () => {
    expect(edits).toHaveLength(2);
    for (const e of edits) {
      expect(e).toContain('<> 1 THEN');
      expect(e).toContain('EXECUTE replace(v_def, c_old, c_new);');
      expect(literal('c_old', e)).toMatch(/= 'all_in' AND .* AS all_in_shown,$/s);
    }
    expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(sql.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(sql).not.toMatch(/install-window|statement_timeout|LOCK TABLE/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.fn_ca_hand_gap_unintended_delay\(timestamptz, int\) FROM PUBLIC, anon, authenticated;/);
    expect(sql).toMatch(/RAISE EXCEPTION 'probe-unwind'/);
    expect(sql).toMatch(/^-- @live-proof: \(SELECT /m);
  });

  it('the watch grader prefers the recorded fact and otherwise counts a shown player at stack 0', () => {
    const rule = flat(literal('c_new', edits[0]));
    expect(rule).toBe(
      flat(`CASE WHEN jsonb_typeof(pair.next_cadence->'all_in_showdown') = 'boolean'
              THEN (pair.next_cadence->>'all_in_showdown')::boolean
              ELSE EXISTS (SELECT 1 FROM jsonb_array_elements(pair.actions) a, jsonb_array_elements(pair.shown) sd
                            WHERE a->>'action' = 'all_in' AND a->>'userId' = sd->>'user_id')
                OR EXISTS (SELECT 1 FROM jsonb_array_elements(pair.players) ap, jsonb_array_elements(pair.shown) sd
                            WHERE ap->>'userId' = sd->>'user_id' AND coalesce((ap->>'stack')::numeric, 1) = 0)
         END AS all_in_shown,`)
    );
    // The read-only script grades by the same rule.
    const scriptRule = flat(script.slice(script.indexOf('AS river_chips,') + 'AS river_chips,'.length,
      script.indexOf('AS all_in_shown,') + 'AS all_in_shown,'.length));
    expect(scriptRule.replace(/\bh\./g, 'pair.')).toBe(rule);
  });

  it('the runbook classifier counts a shown player at stack 0 too', () => {
    const rule = flat(literal('c_new', edits[1]));
    expect(rule).toContain("x->>'action' = 'all_in'");
    expect(rule).toContain("jsonb_array_elements(pair.players) ap");
    expect(rule).toContain("coalesce((ap->>'stack')::numeric, 1) = 0)) AS all_in_shown,");
  });

  it('no budget, beat or threshold moved', () => {
    expect(sql).not.toMatch(/\b(250|500|1500|2000) AS /);
    expect(script).toMatch(/\b2000 AS all_in_showdown_extra_ms\b/);
    expect(script).toMatch(/\b250 AS engine_between_hands_budget_ms\b/);
  });

  it('is proved before and after on PostgreSQL 16, and the proof runs on every PR touching it', () => {
    expect(proof).toContain(FILE);
    expect(proof).toContain('before 20261122105551: an all-in bust without an all_in action grades +500 ms');
    expect(proof).toContain('a real 800 ms delay after an all-in bust is still graded over budget');
    for (const path of [`supabase/migrations/${FILE}`, 'scripts/sql/hand-gap-unintended-delay.sql',
      'scripts/ci/test-hand-gap-watch.py']) {
      expect(workflow).toContain(`- ${path}`);
    }
    // The newest definition of the grader is this one.
    const later = readdirSync(join(ROOT, 'supabase', 'migrations'))
      .filter((f) => f > FILE && f.endsWith('.sql'))
      .filter((f) => read('supabase', 'migrations', f).includes('fn_ca_hand_gap_unintended_delay'));
    expect(later).toEqual([]);
  });
});
