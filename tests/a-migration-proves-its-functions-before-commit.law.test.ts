/**
 * A MIGRATION PROVES ITS FUNCTIONS BEFORE IT COMMITS (2026-11-19).
 *
 * 20261118164000 redefined public.fn_cash_capture_hand_manifest with a row
 * source aliased `x`, the function's own loop variable. CREATE FUNCTION checks
 * syntax only, so it installed cleanly and every manifest capture then failed
 * for 52 minutes (incident d2d79c4f; repaired by 20261118202500). Nothing
 * executed the new body before production did.
 *
 * From PROBE_LAW_FROM on, a migration that creates or replaces a SECURITY
 * DEFINER PL/pgSQL function in public or smarter_private runs it before COMMIT
 * in a subtransaction it always undoes; any other error rolls the whole
 * migration back. The checker is scripts/ci/migration-function-probes.mjs.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

const ROOT = resolve(__dirname, '..');
const DIR = resolve(ROOT, 'supabase/migrations');

let mod: {
  PROBE_LAW_FROM: string;
  missingProbes: (sql: string) => Array<{ fn: string; reason: string }>;
  functionsNeedingProbe: (sql: string) => Array<{ qualified: string }>;
  bound: (file: string) => boolean;
};

beforeAll(async () => {
  const href = pathToFileURL(resolve(ROOT, 'scripts/ci/migration-function-probes.mjs')).href;
  mod = await import(/* @vite-ignore */ href);
});

const definer = (name: string, extra = '') => `
CREATE OR REPLACE FUNCTION ${name}(p uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE x jsonb; v_chairs jsonb := '[]';
BEGIN
  INSERT INTO smarter_private.t(a) SELECT (x->>'u')::uuid FROM jsonb_array_elements(v_chairs) x;
  RETURN '{}';
END $function$;
${extra}`;

const probe = (name: string, sentinel = 'probe-unwind') => `
-- @probe-for: ${name}
DO $probe$
BEGIN
  PERFORM ${name}(gen_random_uuid());
  RAISE EXCEPTION '${sentinel}';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> '${sentinel}' THEN RAISE; END IF;
END $probe$;
`;

describe('the checker recognises an unproven function', () => {
  it('refuses the 2026-11-18 shape: a definer function redefined with no probe', () => {
    const sql = `BEGIN;\n${definer('public.fn_cash_capture_hand_manifest')}\nCOMMIT;\n`;
    expect(mod.missingProbes(sql).map((p) => p.fn)).toEqual(['public.fn_cash_capture_hand_manifest']);
  });

  it('accepts the same file once a probe after the definition executes it', () => {
    const sql = `BEGIN;\n${definer('public.fn_x')}${probe('public.fn_x')}COMMIT;\n`;
    expect(mod.missingProbes(sql)).toEqual([]);
  });

  it('refuses a probe that sits before the definition it claims to prove', () => {
    const sql = `BEGIN;\n${probe('public.fn_x')}${definer('public.fn_x')}COMMIT;\n`;
    expect(mod.missingProbes(sql)).toHaveLength(1);
  });

  it('refuses a probe that never unwinds with the sentinel', () => {
    const sql = `BEGIN;\n${definer('public.fn_x')}${probe('public.fn_x', 'done')}COMMIT;\n`;
    expect(mod.missingProbes(sql)).toHaveLength(1);
  });

  it('refuses a probe that does not call the function it names', () => {
    const sql = `BEGIN;\n${definer('public.fn_x')}${probe('public.fn_x').replace('PERFORM public.fn_x', 'PERFORM public.fn_y')}COMMIT;\n`;
    expect(mod.missingProbes(sql)).toHaveLength(1);
  });

  it('covers smarter_private and an unqualified name (public)', () => {
    const sql = `BEGIN;\n${definer('smarter_private.fn_a')}${definer('fn_b')}COMMIT;\n`;
    expect(mod.missingProbes(sql).map((p) => p.fn).sort()).toEqual(['public.fn_b', 'smarter_private.fn_a']);
  });

  it('does not ask for a probe of an invoker, a SQL-language or a trigger function', () => {
    const invoker = definer('public.fn_i').replace(' SECURITY DEFINER\n', '');
    const sqlLang = definer('public.fn_s').replace('LANGUAGE plpgsql', 'LANGUAGE sql');
    const trig = definer('public.fn_t').replace('RETURNS jsonb', 'RETURNS trigger');
    expect(mod.missingProbes(`BEGIN;${invoker}${sqlLang}${trig}COMMIT;`)).toEqual([]);
  });

  it('reads attributes written after the body, too', () => {
    const sql = `BEGIN;
CREATE OR REPLACE FUNCTION public.fn_late() RETURNS void AS $$ BEGIN NULL; END $$ LANGUAGE plpgsql SECURITY DEFINER;
COMMIT;`;
    expect(mod.missingProbes(sql).map((p) => p.fn)).toEqual(['public.fn_late']);
  });

  it('accepts a named exemption only with a real reason', () => {
    const base = definer('public.fn_ext');
    expect(mod.missingProbes(`BEGIN;${base}\n-- @probe-exempt: public.fn_ext calls dblink to another database\nCOMMIT;`)).toEqual([]);
    expect(mod.missingProbes(`BEGIN;${base}\n-- @probe-exempt: public.fn_ext too hard\nCOMMIT;`)).toHaveLength(1);
  });
});

describe('every bound migration on this branch proves what it redefines', () => {
  it('binds forward only, from its own cutoff', () => {
    expect(mod.bound(`${mod.PROBE_LAW_FROM}_x.sql`)).toBe(true);
    expect(mod.bound('20261118164000_a_deferred_cash_rake_proves_its_club_from_the_dealt_chair.sql')).toBe(false);
  });

  it('no bound migration redefines a definer function without a probe', () => {
    const offenders: string[] = [];
    for (const file of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) {
      if (!mod.bound(file)) continue;
      for (const p of mod.missingProbes(readFileSync(resolve(DIR, file), 'utf8'))) {
        offenders.push(`${file}: ${p.fn} - ${p.reason}`);
      }
    }
    expect(
      offenders,
      'Add a "-- @probe-for: schema.fn" DO block after each definition (scripts/ci/templates/function-probe.sql)'
    ).toEqual([]);
  });
});
