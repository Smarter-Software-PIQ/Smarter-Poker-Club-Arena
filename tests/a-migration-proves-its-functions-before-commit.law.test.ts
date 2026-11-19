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
  GRANDFATHERED: Set<string>;
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
    expect(mod.missingProbes(sql).map((p) => p.fn)).toEqual([
      'public.fn_cash_capture_hand_manifest',
    ]);
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

  it('refuses a probe whose function call is commented out inside DO $probe$', () => {
    const lineCommented = probe('public.fn_x').replace(
      'PERFORM public.fn_x(gen_random_uuid());',
      '-- PERFORM public.fn_x(gen_random_uuid());'
    );
    expect(
      mod.missingProbes(`BEGIN;\n${definer('public.fn_x')}${lineCommented}COMMIT;\n`)
    ).toHaveLength(1);

    const blockCommented = probe('public.fn_x').replace(
      'PERFORM public.fn_x(gen_random_uuid());',
      '/* PERFORM public.fn_x(gen_random_uuid()); */'
    );
    expect(
      mod.missingProbes(`BEGIN;\n${definer('public.fn_x')}${blockCommented}COMMIT;\n`)
    ).toHaveLength(1);
  });

  it('covers smarter_private and an unqualified name (public)', () => {
    const sql = `BEGIN;\n${definer('smarter_private.fn_a')}${definer('fn_b')}COMMIT;\n`;
    expect(
      mod
        .missingProbes(sql)
        .map((p) => p.fn)
        .sort()
    ).toEqual(['public.fn_b', 'smarter_private.fn_a']);
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

  it('sees a redefinition by rewriting the live text (EXECUTE replace(pg_get_functiondef(...)))', () => {
    const rewrite = (lit: string) => `BEGIN;
DO $m$ DECLARE d text;
BEGIN
  d := replace(pg_get_functiondef(${lit}), 'a', 'b');
  EXECUTE d;
END $m$;
`;
    expect(
      mod
        .missingProbes(
          rewrite(`'public.fn_lightning_top_up_request(uuid,uuid,text,numeric)'::regprocedure`) +
            'COMMIT;'
        )
        .map((p) => p.fn)
    ).toEqual(['public.fn_lightning_top_up_request']);
    expect(
      mod.missingProbes(rewrite(`'smarter_private.fn_r'::regproc`) + 'COMMIT;').map((p) => p.fn)
    ).toEqual(['smarter_private.fn_r']);
    expect(
      mod.missingProbes(rewrite(`'fn_bare(uuid)'::regprocedure`) + 'COMMIT;').map((p) => p.fn)
    ).toEqual(['public.fn_bare']);
    expect(
      mod
        .missingProbes(rewrite(`to_regprocedure('public.fn_toregproc_args(uuid)')`) + 'COMMIT;')
        .map((p) => p.fn)
    ).toEqual(['public.fn_toregproc_args']);
    expect(
      mod
        .missingProbes(rewrite(`to_regproc('smarter_private.fn_toregproc')`) + 'COMMIT;')
        .map((p) => p.fn)
    ).toEqual(['smarter_private.fn_toregproc']);
    expect(
      mod
        .missingProbes(rewrite(`CAST('public.fn_cast_proc(uuid)' AS regprocedure)`) + 'COMMIT;')
        .map((p) => p.fn)
    ).toEqual(['public.fn_cast_proc']);
    expect(
      mod.missingProbes(rewrite(`CAST('fn_cast_bare' AS regproc)`) + 'COMMIT;').map((p) => p.fn)
    ).toEqual(['public.fn_cast_bare']);
    expect(
      mod.missingProbes(
        rewrite(`'public.fn_ok(uuid)'::regprocedure`) + probe('public.fn_ok') + 'COMMIT;'
      )
    ).toEqual([]);
    expect(mod.missingProbes(rewrite(`'auth.fn_other()'::regprocedure`) + 'COMMIT;')).toEqual([]);
    // Reading a definition without executing anything is not a redefinition.
    expect(
      mod.missingProbes(
        `BEGIN; SELECT md5(pg_get_functiondef('public.fn_read(uuid)'::regprocedure)); COMMIT;`
      )
    ).toEqual([]);
  });

  it('does not mistake a read-only pin for a rewrite in a file that EXECUTEs (md5, position)', () => {
    const pins = `BEGIN;
DO $r$ BEGIN
  IF md5(pg_get_functiondef('public.fn_pinned(uuid,uuid)'::regprocedure)) <> 'b76daaf8587cca4eeac91ec39e9e7ce3'
     OR md5(replace(pg_get_functiondef('public.fn_hashed(uuid)'::regprocedure), 'a', '')) <> 'x'
     OR position('a' IN pg_get_functiondef('smarter_private.fn_found(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'not installed';
  END IF;
END $r$;
DO $m$ DECLARE d text; BEGIN d := 'SELECT 1'; EXECUTE d; END $m$;
COMMIT;`;
    expect(mod.missingProbes(pins)).toEqual([]);
    // The same file still sees a real rewrite beside those pins.
    const rewrite = pins.replace(
      "d := 'SELECT 1';",
      "d := replace(pg_get_functiondef('public.fn_rewritten(uuid)'::regprocedure), 'a', 'b');"
    );
    expect(mod.missingProbes(rewrite).map((p) => p.fn)).toEqual(['public.fn_rewritten']);
  });

  it('accepts a named exemption only with a real reason', () => {
    const base = definer('public.fn_ext');
    expect(
      mod.missingProbes(
        `BEGIN;${base}\n-- @probe-exempt: public.fn_ext calls dblink to another database\nCOMMIT;`
      )
    ).toEqual([]);
    expect(
      mod.missingProbes(`BEGIN;${base}\n-- @probe-exempt: public.fn_ext too hard\nCOMMIT;`)
    ).toHaveLength(1);
  });
});

describe('every bound migration on this branch proves what it redefines', () => {
  it('binds every new file whatever its version; only the frozen pre-law files are exempt', () => {
    expect(mod.bound(`${mod.PROBE_LAW_FROM}_x.sql`)).toBe(true);
    // A late file carrying an old version is bound (94 open PRs did on 2026-11-19).
    expect(mod.bound('20261001000000_a_late_file_with_an_old_version.sql')).toBe(true);
    expect(
      mod.bound('20261118164000_a_deferred_cash_rake_proves_its_club_from_the_dealt_chair.sql')
    ).toBe(false);
  });

  it('the grandfathered list is frozen: never grows, holds only pre-cutoff files that exist', () => {
    expect(mod.GRANDFATHERED.size).toBe(6992);
    const onDisk = new Set(readdirSync(DIR));
    for (const f of mod.GRANDFATHERED) {
      expect(f < mod.PROBE_LAW_FROM, f).toBe(true);
      expect(onDisk.has(f), f).toBe(true);
    }
  });

  it('no bound migration redefines a definer function without a probe', () => {
    const offenders: string[] = [];
    for (const file of readdirSync(DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort()) {
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
