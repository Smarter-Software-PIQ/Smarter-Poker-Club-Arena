/**
 * THE HORSE EXPOSURE HANDS ARE PLANNED FOR THEIR OWN WINDOW (Production Alerts, 2026-11-21).
 *
 * ca-horse-exposure-watch-hourly failed every run on 2026-11-21 with a statement timeout inside
 * smarter_private.fn_ca_horse_exposure_hands. That helper was LANGUAGE sql with SET search_path, so
 * PostgreSQL never inlined it and planned its body generically: EXPLAIN (GENERIC_PLAN) chose a parallel
 * scan of idx_hand_history_created over every hand of the 60 days instead of the partial index
 * idx_hand_history_human_created that a known timestamp selects (6.66 s cold, 20.7 s through the fixed
 * helper, against more than 120 s). Migration 20261122094628 runs the same body through
 * RETURN QUERY EXECUTE ... USING, which plans every call with its own p_at.
 *
 * These laws keep it that way:
 *   1. the newest definition of the helper on main is plpgsql and runs its body through
 *      RETURN QUERY EXECUTE ... USING p_at, p_per (never a static query or LANGUAGE sql);
 *   2. the dynamic body is the original body, byte for byte apart from $1/$2, so the result is unchanged;
 *   3. the fix raises no timeout: the watch keeps its 120 s and the cron its 150 s;
 *   4. the native proof installs the fixed helper and runs every case against it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const ORIGINAL = '20261121011654_a_person_beating_the_plo_horses_reaches_production_alerts.sql';
const FIX = '20261122094628_the_horse_exposure_hands_are_planned_for_their_own_window.sql';
const HELPER = 'CREATE OR REPLACE FUNCTION smarter_private.fn_ca_horse_exposure_hands';
const original = read(`supabase/migrations/${ORIGINAL}`);
const fix = read(`supabase/migrations/${FIX}`);

const definitionIn = (sql: string) => {
  const start = sql.indexOf(HELPER);
  const end = sql.indexOf('$function$;', start);
  return start < 0 ? '' : sql.slice(start, end + '$function$;'.length);
};

describe('the hands helper is planned for its own window', () => {
  it('the newest migration on main that defines the helper is the EXECUTE form', () => {
    const definers = readdirSync(join(ROOT, 'supabase/migrations'))
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .filter((f) => read(`supabase/migrations/${f}`).includes(HELPER));
    expect(definers.at(-1)).toBe(FIX);
  });

  it('is plpgsql and runs its body through RETURN QUERY EXECUTE ... USING p_at, p_per', () => {
    const def = definitionIn(fix);
    expect(def).toMatch(/LANGUAGE plpgsql\s+STABLE/);
    expect(def.replace(/--[^\n]*/g, '')).not.toMatch(/LANGUAGE sql/);
    expect(def).toMatch(/RETURN QUERY EXECUTE \$q\$[\s\S]+\$q\$ USING p_at, p_per;/);
    // a static RETURN QUERY would be cached and planned generically after five calls
    expect(def).not.toMatch(/RETURN QUERY\s+(WITH|SELECT)/);
  });

  it('runs the original body unchanged apart from $1 / $2', () => {
    const before = definitionIn(original);
    const originalBody = before.slice(before.indexOf('AS $function$\n') + 'AS $function$\n'.length, before.lastIndexOf('$function$;'));
    const after = definitionIn(fix);
    const dynamicBody = after.slice(after.indexOf('$q$\n') + '$q$\n'.length, after.lastIndexOf('$q$ USING'));
    expect(dynamicBody.trimEnd()).toBe(originalBody.replaceAll('p_at', '$1').replace('r.rn <= p_per', 'r.rn <= $2').trimEnd());
    expect(dynamicBody).toContain('hh.has_human AND hh.created_at > $1');
  });

  it('raises no timeout and moves no threshold', () => {
    const code = fix.replace(/--[^\n]*/g, '');
    expect(code).not.toMatch(/fn_ca_horse_exposure_watch/);
    expect(code).not.toMatch(/cron\.(schedule|alter_job)/);
    expect(code).not.toMatch(/SET\s+statement_timeout\s+TO/i);
    expect(code).not.toMatch(/CREATE\s+INDEX/i);
  });

  it('the native proof installs the fixed helper and runs every case against it', () => {
    const proof = read('scripts/ci/test-a-person-beating-the-horses-reaches-production-alerts.py');
    expect(proof).toContain(FIX);
    expect(proof.indexOf("psql(['-f', str(PLANNED)])")).toBeGreaterThan(proof.indexOf("psql(['-f', str(MIGRATION)])"));
    expect(proof.indexOf("psql(['-f', str(PLANNED)])")).toBeLessThan(proof.indexOf("ok('the per-hand split equals"));
    const workflow = read('.github/workflows/a-person-beating-the-horses-reaches-production-alerts.yml');
    expect(workflow).toContain(`supabase/migrations/${FIX}`);
  });
});
