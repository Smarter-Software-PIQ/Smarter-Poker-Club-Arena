/**
 * ===========================================================================
 *  LAW: A SHARED HAND LINK READS WITHOUT WRITING, AND NOTHING A CALLER WITH
 *  NO ACCOUNT CAN RUN WRITES
 * ===========================================================================
 *
 * WHAT HAPPENED (issue #9828). Migration 20261107021555 granted
 * fn_ca_shared_hand_open to anon so a signed-out visitor can open a shared
 * hand, and the same SECURITY DEFINER body bumped ca_shared_hands.view_count
 * on every open. The live definer-exposure audit refuses an anon-executable
 * definer writer with no allowlist ("anon-executable writers: 1 (must be 0)")
 * and failed every run from 2026-11-07 to 2026-11-26. No build-time rule saw
 * it: rules 1 and 2 of check-definer-authorization.mjs clear any body that
 * mentions auth.uid(), and this one mentioned it only to skip the sender.
 *
 * THE FIX (migration 20261126054024). The read and the write are two doors:
 * fn_ca_shared_hand_open stays anon-executable, same signature and answers,
 * STABLE, writing nothing; fn_ca_shared_hand_count_view is the only writer,
 * executable by authenticated and service_role and never by PUBLIC or anon.
 * The client opens with the reader and counts a view only when signed in.
 *
 * THE HARDENING. Rule 5 of check-definer-authorization.mjs asks the live
 * audit's question 2 before the merge: SECURITY DEFINER + writes + anon (or
 * PUBLIC) can execute it -> refused, whatever the body consults, with no
 * allowlist. 20261107021555 is refused by it, below, by its own text.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  anonExecutableWriters,
  anonReadableDefiners,
  unauthorisedWriters,
  declaredFunctions,
  stripComments,
} from '../scripts/ci/check-definer-authorization.mjs';

const ROOT = path.resolve(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const json = (p: string) => JSON.parse(read(p));

const MIGRATION = 'supabase/migrations/20261126054024_a_shared_hand_link_reads_without_writing.sql';
const ORIGINAL = 'supabase/migrations/20261107021555_short_share_links_for_hands.sql';
const SQL = read(MIGRATION);
const ORIGINAL_SQL = read(ORIGINAL);

/** The live audit's own write test (fn_definer_exposure_audit, questions 2 and 4). */
const AUDIT_WRITES = /(^|[^a-z_])(insert into|update |delete from)/i;

const fn = (sql: string, name: string) => {
  const found = (
    declaredFunctions(stripComments(sql)) as Array<{ name: string; header: string; body: string }>
  ).find((f) => f.name === name);
  if (!found) throw new Error(`${name} is not declared`);
  return found;
};

const GATE = json('scripts/ci/definer-authorization.allowlist.json');
const LIVE = json('scripts/ci/definer-exposure-baseline.json');
const SURFACE = json('docs/security/anon-executable-definers.json');
const surfaceSigs = (SURFACE.allowed as Array<{ fn: string }>).map((e) => e.fn);

describe('the migration splits the read from the write', () => {
  it('is one transaction with the timeouts the production DDL policy requires', () => {
    expect(SQL.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(SQL.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(SQL).toMatch(/SET LOCAL lock_timeout = '\d+s';/);
    expect(SQL).toMatch(/SET LOCAL statement_timeout = '\d+s';/);
  });

  it('is pinned to the live body it replaces, and refuses any other', () => {
    expect(SQL).toContain("md5(v_def) = '0971ecf7c8f564972a89e824a5a887e0'");
    expect(SQL).toMatch(
      /RAISE EXCEPTION 'SHARED_HAND_OPEN_PREIMAGE_DRIFT fn_ca_shared_hand_open md5 %'/
    );
  });

  it('the anon door is STABLE, keeps its signature, and its body never writes', () => {
    const open = fn(SQL, 'fn_ca_shared_hand_open');
    expect(open.header).toMatch(
      /fn_ca_shared_hand_open\(p_token text, p_count boolean DEFAULT true\)/
    );
    expect(open.header).toMatch(/\bSTABLE\b/);
    expect(open.header).toMatch(/SECURITY DEFINER/);
    // The raw body, comments included: the live audit reads pg_get_functiondef text.
    const raw = SQL.slice(SQL.indexOf('CREATE OR REPLACE FUNCTION public.fn_ca_shared_hand_open'));
    const body = raw.slice(
      raw.indexOf('$function$') + 10,
      raw.indexOf('$function$', raw.indexOf('$function$') + 10)
    );
    expect(body).not.toMatch(AUDIT_WRITES);
    expect(body).not.toMatch(/fn_ca_shared_hand_count_view|PERFORM/i);
    // The same refusals as before.
    expect(body).toContain("p_token !~ '^[A-HJ-NP-Za-km-z2-9]{8}$'");
    expect(body).toContain("v_status IS NULL OR v_status = 'deleted'");
    expect(body).toContain("jsonb_build_object('found', true, 'revoked', true)");
    expect(SQL).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.fn_ca_shared_hand_open\(text, boolean\) TO anon, authenticated, service_role;/
    );
  });

  it('the only writer is closed to PUBLIC and anon and refuses a caller with no identity', () => {
    const count = fn(SQL, 'fn_ca_shared_hand_count_view');
    expect(count.header).toMatch(/SECURITY DEFINER/);
    expect(count.body).toMatch(
      /IF v_uid IS NULL AND auth\.role\(\) IS DISTINCT FROM 'service_role' THEN\s+RAISE EXCEPTION/
    );
    expect(count.body).toMatch(/h\.sender_id IS DISTINCT FROM v_uid/);
    expect(count.body).toMatch(/h\.revoked_at IS NULL/);
    expect(SQL).toMatch(
      /REVOKE ALL ON FUNCTION public\.fn_ca_shared_hand_count_view\(text\) FROM PUBLIC, anon, authenticated;\s+GRANT EXECUTE ON FUNCTION public\.fn_ca_shared_hand_count_view\(text\) TO authenticated, service_role;/
    );
  });

  it('asserts at install what the live audit will ask, and declares the live proof', () => {
    expect(SQL).toContain("RAISE EXCEPTION 'SHARED_HAND_POST fn_ca_shared_hand_open still writes'");
    expect(SQL).toContain(
      "RAISE EXCEPTION 'SHARED_HAND_POST anon can execute fn_ca_shared_hand_count_view'"
    );
    expect(SQL).toContain(
      "RAISE EXCEPTION 'SHARED_HAND_POST anon can execute a shared-hand writer: %'"
    );
    expect(SQL).toMatch(
      /^-- @live-proof: .*provolatile = 's'.*NOT has_function_privilege\('anon', 'public\.fn_ca_shared_hand_count_view\(text\)'/m
    );
    expect(SQL).toContain('-- @probe-for: public.fn_ca_shared_hand_open');
    expect(SQL).toContain('-- @probe-for: public.fn_ca_shared_hand_count_view');
  });

  it('is proved on a scratch Postgres by the shared-hands harness', () => {
    const harness = read('scripts/dev/test-shared-hands-postgres.sh');
    expect(harness).toContain('20261126054024_a_shared_hand_link_reads_without_writing.sql');
    const cases = read('scripts/dev/shared-hands/01_cases.sql');
    expect(cases).toContain("'PASS anon cannot count a view'");
    expect(cases).toContain("'a signed-out open writes nothing'");
  });
});

describe('rule 5: nothing a caller with no account can run writes', () => {
  it('refuses 20261107021555 by its own text, which every earlier rule cleared', () => {
    expect(anonExecutableWriters(ORIGINAL_SQL)).toContain('fn_ca_shared_hand_open');
    expect(
      unauthorisedWriters(ORIGINAL_SQL, new Set(Object.keys(GATE.reviewedExceptions)))
    ).not.toContain('fn_ca_shared_hand_open');
    expect(anonReadableDefiners(ORIGINAL_SQL, new Set())).not.toContain('fn_ca_shared_hand_open');
  });

  it('clears the fix, which still passes every other rule', () => {
    expect(anonExecutableWriters(SQL)).toEqual([]);
    expect(unauthorisedWriters(SQL, new Set(Object.keys(GATE.reviewedExceptions)))).toEqual([]);
    expect(anonReadableDefiners(SQL, new Set(Object.keys(GATE.anonPublicSurface)))).toEqual([]);
  });

  const writer = (grants: string) => `
    CREATE OR REPLACE FUNCTION public.fn_x(p uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
    BEGIN
      IF auth.uid() IS DISTINCT FROM p THEN UPDATE public.t SET n = n + 1 WHERE id = p; END IF;
    END $$;
    ${grants}`;

  it('naming auth.uid() does not clear an anon-executable writer, and there is no allowlist', () => {
    expect(
      anonExecutableWriters(
        writer(
          'REVOKE ALL ON FUNCTION public.fn_x(uuid) FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.fn_x(uuid) TO anon, authenticated;'
        )
      )
    ).toEqual(['fn_x']);
    expect(anonExecutableWriters.length).toBe(1); // (sql, grantSql?, priorDeclared?): no allowlist parameter
  });

  it('a new writer is open by default; revoking PUBLIC alone leaves anon', () => {
    expect(anonExecutableWriters(writer(''))).toEqual(['fn_x']);
    expect(
      anonExecutableWriters(writer('REVOKE ALL ON FUNCTION public.fn_x(uuid) FROM PUBLIC;'))
    ).toEqual(['fn_x']);
    expect(
      anonExecutableWriters(writer('REVOKE ALL ON FUNCTION public.fn_x(uuid) FROM PUBLIC, anon;'))
    ).toEqual([]);
  });

  it('a replace of a function main already declares keeps its grants, unless the branch opens it', () => {
    const prior = new Set(['fn_x']);
    expect(anonExecutableWriters(writer(''), writer(''), prior)).toEqual([]);
    const opened = writer('GRANT EXECUTE ON FUNCTION public.fn_x(uuid) TO anon;');
    expect(anonExecutableWriters(opened, opened, prior)).toEqual(['fn_x']);
  });

  it('is wired into the gate and reported before every other verdict', () => {
    const gate = read('scripts/ci/check-definer-authorization.mjs');
    expect(gate).toContain('anonExecutableWriters(sql, branchSql, priorDeclared)');
    const main = gate.slice(gate.indexOf('function main()'));
    expect(main.indexOf('anonWriterOffenders.length > 0')).toBeGreaterThan(0);
    expect(main.indexOf('anonWriterOffenders.length > 0')).toBeLessThan(
      main.indexOf('rosterOffenders.length > 0')
    );
  });
});

describe('the reader is recorded as a public reader, and the writer nowhere', () => {
  it('fn_ca_shared_hand_open is in every list that audits the anonymous surface', () => {
    expect(Object.keys(GATE.anonPublicSurface)).toContain('fn_ca_shared_hand_open');
    expect(Object.keys(LIVE.reviewedAnonReaders)).toContain('fn_ca_shared_hand_open');
    expect(surfaceSigs).toContain('fn_ca_shared_hand_open(p_token text, p_count boolean)');
    expect(SQL).toMatch(
      /INSERT INTO public\.ca_browser_definer_allowlist\(proname, reason\) VALUES\s+\(\s+'fn_ca_shared_hand_open'/
    );
    expect(LIVE.reviewedAnonReaders.fn_ca_shared_hand_open).toContain('writes nothing');
  });

  it('fn_ca_shared_hand_count_view is on no anonymous list and no writer exception', () => {
    expect(Object.keys(GATE.anonPublicSurface)).not.toContain('fn_ca_shared_hand_count_view');
    expect(Object.keys(GATE.reviewedExceptions)).not.toContain('fn_ca_shared_hand_count_view');
    expect(Object.keys(LIVE.reviewedAnonReaders)).not.toContain('fn_ca_shared_hand_count_view');
    expect(Object.keys(LIVE.reviewedExceptions)).not.toContain('fn_ca_shared_hand_count_view');
    expect(Object.keys(LIVE.reviewedExceptions)).not.toContain('fn_ca_shared_hand_open');
    expect(surfaceSigs.join('\n')).not.toContain('fn_ca_shared_hand_count_view');
  });

  it('the new writer is declared in its schema-manifest fragment', () => {
    const fragment = json(
      'scripts/ci/schema-manifest.d/a-shared-hand-link-reads-without-writing.json'
    );
    expect(fragment.functions).toEqual(['fn_ca_shared_hand_count_view']);
  });
});

describe('the client opens with the reader and counts only when signed in', () => {
  const SERVICE = read('src/services/SharedHandLinkService.ts');

  it('opens with the reader alone', () => {
    expect(SERVICE).toContain("supabase.rpc('fn_ca_shared_hand_open', { p_token: valid })");
    expect(SERVICE).not.toMatch(/p_count:\s*true/);
  });

  it('counts through the signed-in door, behind a local session', () => {
    const count = SERVICE.slice(SERVICE.indexOf('export async function countSharedHandView'));
    // A signed-out open is counted by World Hub's server route instead
    // (a-signed-out-shared-hand-open-is-counted.law.test.ts).
    expect(count).toMatch(
      /if \(hasLocalSession\(\)\) \{[^}]*supabase\.rpc\('fn_ca_shared_hand_count_view', \{ p_token: valid \}\);\s*return;\s*\}/
    );
  });
});
