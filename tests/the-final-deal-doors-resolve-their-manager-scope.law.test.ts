/**
 * THE FINAL-TABLE DEAL DOORS RESOLVE THEIR MANAGER SCOPE, AND THE UNINSTALLED
 * VERSION-2 PLACE BRANCH REFUSES WITHOUT CALLING A MISSING VERIFIER
 *
 * 2026-11-15, found by the function-call guard (20261115020406):
 *
 *   - fn_begin_tournament_deal_review, fn_close_tournament_deal_review and
 *     fn_complete_tournament_terminal_proposal (20260910125453) open with
 *     PERFORM public.fn_assert_tournament_manager_write_scope(uuid), which was
 *     defined only in a .pending Stage-B file and a retired file. Production
 *     raised 42883 at all three doors (rolled-back probe). The proposal path is
 *     dormant only because the proposal authority is not activated; activating
 *     it would park a final table that could never be released.
 *   - The native rehearsal stayed green because it installed the Stage-B body
 *     and emulated a request-hook marker (app.smarter_manager_request_fenced)
 *     that production's Stage-A hook never sets.
 *   - fn_tournament_finish_readiness called fn_ca_verify_terminal_place_batch
 *     (defined nowhere applied) for a version-2 place batch that nothing can
 *     write: the table has no contract_version column.
 *
 * Pinned here so neither comes back:
 *   1. the scope check is installed by an applied migration and asserts the
 *      durable terminal door's own authority, reading only what the
 *      production hook sets;
 *   2. it is never an API route;
 *   3. a later redefinition may not require the Stage-B marker unless the same
 *      migration makes the request hook set it;
 *   4. the readiness edit is pinned to its preimage and refuses a version-2
 *      batch without calling a verifier, and nothing later calls that verifier
 *      without an applied migration defining it;
 *   5. the native deal rehearsal installs the applied scope check and never
 *      emulates the marker.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { migrationFiles, readMigration } from './helpers/migrations';

const ROOT = resolve(__dirname, '..');
const FIX = '20261115052022_the_final_deal_manager_scope_resolves_and_the_v2_place_branc.sql';
const SCOPE = 'public.fn_assert_tournament_manager_write_scope';
const VERIFIER = 'public.fn_ca_verify_terminal_place_batch';
const MARKER = 'app.smarter_manager_request_fenced';

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const declares = (fn: string) =>
  new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+${escape(fn)}\\s*\\(`, 'i');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

/** The dollar-quoted body of the last declaration of fn in sql. */
function body(sql: string, fn: string): string {
  const all = [...sql.matchAll(new RegExp(declares(fn).source, 'gi'))];
  const at = all.at(-1)?.index;
  if (at === undefined) throw new Error(`${fn} is not declared`);
  const rest = sql.slice(at);
  const quote = /\bAS\s+(\$\w*\$)/i.exec(rest);
  if (!quote) throw new Error(`${fn} has no dollar-quoted body`);
  const start = quote.index + quote[0].length;
  const end = rest.indexOf(quote[1], start);
  if (end < 0) throw new Error(`${fn} has no closing quote`);
  return rest.slice(start, end);
}

/** Text between two dollar-quote tags, e.g. $old$...$old$. */
function quoted(sql: string, tag: string): string {
  const open = `$${tag}$`;
  const start = sql.indexOf(open);
  const end = sql.indexOf(open, start + open.length);
  if (start < 0 || end < 0) throw new Error(`no $${tag}$ block`);
  return sql.slice(start + open.length, end);
}

describe('the final-table deal doors resolve their manager scope', () => {
  const sql = readMigration(FIX);

  it('an applied migration installs the scope check the three doors call', () => {
    expect(migrationFiles()).toContain(FIX);
    expect(sql).toMatch(/^BEGIN;$/m);
    expect(sql).toMatch(/^COMMIT;$/m);
    expect(sql).toMatch(new RegExp(`CREATE FUNCTION ${escape(SCOPE)}\\(p_tournament_id uuid\\)`));
    for (const [fn, md5] of [
      ['public.fn_begin_tournament_deal_review(uuid,uuid)', '38ef591da01466c0a69a2e43e41ef218'],
      ['public.fn_close_tournament_deal_review(uuid,uuid,text)', 'caf796a4fd545a1c1e68a5c0c1de3af4'],
      [
        'public.fn_complete_tournament_terminal_proposal(uuid,uuid,text,uuid,text)',
        '20a359f0554e5eaaa58dd0ae4be14864',
      ],
      ['smarter_private.assert_terminal_request_generation(uuid,uuid)', 'cda0970a91262d8eb5b8fa75423acc19'],
    ])
      expect(sql).toContain(`('${fn}', '${md5}')`);
  });

  it('asserts the durable terminal door authority from what the production hook sets', () => {
    const scope = body(sql, SCOPE);
    expect(scope).toContain(
      "NULLIF(current_setting('app.smarter_tournament_lease_generation', true), '')::uuid"
    );
    expect(scope).toContain(
      'PERFORM smarter_private.assert_terminal_request_generation(p_tournament_id, v_generation);'
    );
    expect(scope).toMatch(/IF p_tournament_id IS NULL OR v_generation IS NULL THEN[\s\S]*?ERRCODE = '42501'/);
    // Production's Stage-A hook never sets the Stage-B marker; requiring it
    // refuses every manager, which is a second way to break the same doors.
    expect(scope).not.toContain(MARKER);
    expect(sql).toMatch(/SECURITY DEFINER\s+SET search_path = public, pg_temp/);
  });

  it('is never an API route', () => {
    expect(sql).toContain(
      `REVOKE ALL ON FUNCTION ${SCOPE}(uuid)\n  FROM PUBLIC, anon, authenticated, service_role;`
    );
    expect(sql).toMatch(/has_function_privilege\('service_role', 'public\.fn_assert_tournament_manager_write_scope\(uuid\)', 'EXECUTE'\)/);
  });

  it('asserts before COMMIT that none of the four doors still calls a missing signature', () => {
    const post = sql.slice(sql.indexOf('DO $postimage$'), sql.lastIndexOf('COMMIT;'));
    expect(post).toContain('smarter_private.fn_ca_unresolved_function_calls(f)');
    for (const fn of [
      'public.fn_begin_tournament_deal_review(uuid,uuid)',
      'public.fn_close_tournament_deal_review(uuid,uuid,text)',
      'public.fn_complete_tournament_terminal_proposal(uuid,uuid,text,uuid,text)',
      'public.fn_tournament_finish_readiness(uuid,uuid)',
      `${SCOPE}(uuid)`,
    ])
      expect(post).toContain(`'${fn}'`);
  });

  it('a later redefinition may require the Stage-B marker only where the request hook sets it', () => {
    for (const name of migrationFiles().filter((f) => f > FIX)) {
      const later = readMigration(name);
      if (!declares(SCOPE).test(later)) continue;
      if (!body(later, SCOPE).includes(MARKER)) continue;
      expect(
        body(later, 'smarter_private.fn_smarter_data_api_pre_request'),
        `${name} requires ${MARKER} without making the request hook set it`
      ).toMatch(new RegExp(`set_config\\(\\s*'${escape(MARKER)}'`));
    }
  });
});

describe('the version-2 place branch refuses without calling a missing verifier', () => {
  const sql = readMigration(FIX);
  const before = quoted(sql, 'old');
  const after = quoted(sql, 'new');

  it('replaces exactly the call block of the pinned readiness preimage', () => {
    expect(sql).toContain("'public.fn_tournament_finish_readiness(uuid,uuid)'::regprocedure,\n  '3209cfadeb8a36eccf0f75d7d58cabd9'");
    expect(sql).toContain("('public.fn_tournament_finish_readiness(uuid,uuid)', '3209cfadeb8a36eccf0f75d7d58cabd9')");
    expect(before).toContain(`v_domain_check:=${VERIFIER}(p_tournament_id,true);`);
    expect(sql).toMatch(/\/ length\(p_old\) <> 1 THEN\s+RAISE EXCEPTION 'FINAL_DEAL_SCOPE_ANCHOR_NOT_UNIQUE/);
  });

  it('keeps the version-2 batch fail-closed under the same code and invents no verifier', () => {
    expect(after).not.toContain('fn_ca_verify_terminal_place_batch');
    expect(after.startsWith('    IF v_modern_place THEN\n')).toBe(true);
    expect(after).toContain("'code','canonical_place_batch_not_proven'");
    expect(after).toContain("'detail','version-2 place batch verifier is not installed'");
    expect(sql).not.toMatch(declares(VERIFIER));
    // The premise, asserted on production before the edit: nothing can be version 2.
    expect(sql).toContain("attrelid = 'public.tournament_place_settlement_batches'::regclass");
    expect(sql).toContain("to_regprocedure('public.fn_ca_verify_terminal_place_batch(uuid,boolean)') IS NOT NULL");
  });

  it('nothing later calls the verifier unless an applied migration defines it', () => {
    const defined = migrationFiles().some((f) => declares(VERIFIER).test(readMigration(f)));
    for (const name of migrationFiles().filter((f) => f > FIX)) {
      if (!readMigration(name).includes(`${VERIFIER}(`)) continue;
      expect(defined, `${name} calls ${VERIFIER} but no applied migration defines it`).toBe(true);
    }
  });
});

describe('the native deal rehearsal runs the contract production runs', () => {
  it('installs the applied scope check, after the durable request authority it delegates to', () => {
    const harness = read('scripts/ci/terminal_original_request_native.py');
    expect(harness).toContain(`SCOPE_MIGRATION = 'supabase/migrations/${FIX}'`);
    expect(harness).toContain('scope_path = root / SCOPE_MIGRATION');
    expect(harness).not.toMatch(/'supabase\/migrations\/[^']*\.sql\.pending'/);
    const opening = harness.indexOf("label='durable-' + kind + '-funded-opening'");
    const install = harness.indexOf('install_original_request(e, root, database, kind)', opening);
    const scope = harness.indexOf("label='durable-' + kind + '-exact-manager-scope'", opening);
    const consent = harness.indexOf("label='durable-real-participant-consent'", opening);
    expect(opening).toBeGreaterThan(0);
    expect(install).toBeGreaterThan(opening);
    expect(scope).toBeGreaterThan(install);
    expect(consent).toBeGreaterThan(scope);
    expect(harness).toContain("run_transport(database, kind, '92010000-0000-0000-0000-000000000001', '', installed=True)");
  });

  it('never emulates the Stage-B marker the production hook does not set', () => {
    for (const path of [
      'scripts/ci/fixtures/terminal-original-request/deal-consent.sql',
      'server/scripts/qualify-terminal-intent-transport.ts',
    ])
      expect(read(path), path).not.toMatch(new RegExp(`set_config\\('${escape(MARKER)}','protocol-2'`));
  });
});
