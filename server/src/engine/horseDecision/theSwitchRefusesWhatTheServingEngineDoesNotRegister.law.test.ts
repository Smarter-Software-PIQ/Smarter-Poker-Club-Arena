/**
 * THE RESET-TRAP GUARD, AS A LAW (2026-11-18). A switch row for a name or state the SERVING engine does not register
 * makes that engine drop every switched option to its release default (HorseOptionSwitch.ts optionSwitchStatesFrom).
 * The engine publishes what it registers (optionRegistryPublisher.ts); the database refuses the rest
 * (supabase/migrations/*_the_horse_option_switch_refuses_what_the_serving_engine_does.sql). The execution proof is
 * scripts/ci/test-horse-option-switch-evidence-postgres.sh (required accounting_postgres job); this file pins the
 * shape so neither half can be dropped quietly.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { OPTION_SWITCH_LIST_MARKER } from '../HorseOptionSwitchMigrationLists.js';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (p: string) => readFileSync(join(REPO, p), 'utf8');
const GUARD = readdirSync(join(REPO, 'supabase/migrations')).filter((n) =>
  n.endsWith('_the_horse_option_switch_refuses_what_the_serving_engine_does.sql')
);
const SQL_RAW = GUARD.length === 1 ? read(`supabase/migrations/${GUARD[0]}`) : '';
const SQL = SQL_RAW.replace(/--[^\n]*/g, '');
const body = (name: string): string => {
  const m = new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${name}\\([^)]*\\)[\\s\\S]*?AS \\$function\\$([\\s\\S]*?)\\$function\\$;`
  ).exec(SQL);
  if (!m) throw new Error(`the guard migration does not define ${name}`);
  return m[1]!;
};

describe('the switch refuses what the serving engine does not register', () => {
  it('there is exactly one guard migration, and it is not a registry-list follow-up (the whitelist is unchanged)', () => {
    expect(GUARD).toHaveLength(1);
    expect(SQL_RAW).not.toContain(OPTION_SWITCH_LIST_MARKER);
    expect(SQL).toMatch(/^\s*BEGIN;[\s\S]*COMMIT;\s*$/);
  });

  it('both writers consult the serving registry after their own checks and before any row is written', () => {
    for (const [fn, state] of [
      ['fn_ca_horse_option_switch_set', 'p_state'],
      ['fn_ca_horse_option_switch_record_evidence', "'on'"],
    ] as const) {
      const b = body(fn);
      const guard = b.indexOf(`public.fn_ca_horse_option_registry_refusal(p_option, ${state})`);
      expect(guard, fn).toBeGreaterThan(0);
      expect(guard, fn).toBeGreaterThan(b.indexOf("RAISE EXCEPTION 'an actor is required'"));
      expect(guard, fn).toBeLessThan(b.search(/INSERT INTO/));
      expect(b.slice(guard), fn).toMatch(
        /IF v_refusal IS NOT NULL THEN\s*RAISE EXCEPTION '%', v_refusal;/
      );
    }
    // the evidence rule of 'on' is kept in the set function
    expect(body('fn_ca_horse_option_switch_set')).toContain('ca_horse_option_switch_evidence');
    // clear is never guarded: removing a row can only cure the trap
    expect(SQL).not.toMatch(/FUNCTION public\.fn_ca_horse_option_switch_clear/);
  });

  it('every fresh release must list the name (a cutover has two), and no fresh release means as today with a NOTICE', () => {
    const r = body('fn_ca_horse_option_registry_refusal');
    expect(r).toMatch(/WHERE s\.seen_at >= now\(\) - interval '5 minutes'/);
    expect(r).toMatch(/FOR r IN[\s\S]*LOOP[\s\S]*RETURN format\([\s\S]*END LOOP;/);
    expect(r).toMatch(/IF v_fresh = 0 THEN\s*RAISE NOTICE 'no serving engine has published/);
  });

  it('the publish checks the engine digest and keeps the table small; only service_role reaches any of it', () => {
    const p = body('fn_ca_horse_option_registry_publish');
    expect(p).toMatch(/encode\(sha256\(convert_to\(v_canonical, 'UTF8'\)\), 'hex'\) <> p_digest/);
    expect(p).toMatch(
      /DELETE FROM public\.ca_horse_option_registry_serving r\s*WHERE r\.seen_at < v_now - interval '30 days'/
    );
    const grants = [...SQL.matchAll(/GRANT\s+[^;]*?\sTO\s+([^;]*);/g)].map((m) => m[1]!.trim());
    expect([...new Set(grants)]).toEqual(['service_role']);
    expect([...SQL.matchAll(/GRANT\s+(\w+)\s+ON TABLE/g)].map((m) => m[1])).toEqual(['SELECT']);
    expect(SQL).toMatch(/ENABLE ROW LEVEL SECURITY/);
  });

  it('the execution proof installs the guard and runs in the required accounting_postgres job', () => {
    const proof = read('scripts/ci/test-horse-option-switch-evidence-postgres.sh');
    expect(proof).toContain('_the_horse_option_switch_refuses_what_the_serving_engine_does.sql');
    expect(proof).toContain('fn_ca_horse_option_registry_publish');
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('bash scripts/ci/test-horse-option-switch-evidence-postgres.sh');
  });

  it('the lane publishes on the same switch read, never awaited by it, and only with the production read', () => {
    const lane = read('server/src/engine/horseDecision/lane.ts');
    expect(lane).toContain(
      "import { publishOptionRegistryToDatabase } from './optionRegistryPublisher.js';"
    );
    expect(lane).toMatch(
      /options\.styleSwitchRead === undefined \? publishOptionRegistryToDatabase : null/
    );
    expect(lane).toMatch(
      /void Promise\.resolve\(\)\s*\.then\(publishRegistry\)\s*\.catch\(\(\) => undefined\);\s*return switchRead\(\);/
    );
  });
});
