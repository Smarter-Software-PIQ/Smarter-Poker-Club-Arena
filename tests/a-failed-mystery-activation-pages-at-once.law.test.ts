/**
 * A FAILED MYSTERY ACTIVATION PAGES AT ONCE (2026-11-14)
 *
 * fn_mystery_bounty_seed raised 42883 on every engine sweep for about 40
 * minutes (20261114072509 passed a numeric where the sealed-ladder reader takes
 * a bigint; fixed by 20261115001336). The engine's "CRITICAL: mystery bounty
 * seed FAILED" went to its console, which reaches nobody, and two mystery MTTs
 * waited at their activation point dealing nothing until the 20-minute dark
 * detector paged.
 *
 * 20261115015453 makes the seed report its own failure the first time: an
 * unexpected error rolls the seed's block back, files ONE critical
 * financial_alerts row (source fn_ca_tournament_mystery_activation_failed,
 * classed tournament_lifecycle by the existing 'fn_ca_tournament%' rule) and
 * answers activation_failed; a transient refusal is re-raised exactly as
 * before. The same function closes the alert when the activation commits.
 * Each link is pinned here so removing one turns this file red.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { migrationFiles, readMigration } from './helpers/migrations';

const FILE = '20261115015453_a_failed_mystery_activation_pages_at_once.sql';
const root = resolve(__dirname, '..');
const sql = () => readMigration(FILE);

describe('a failed mystery activation pages at once', () => {
  it('the migration is present and is one transaction', () => {
    expect(migrationFiles()).toContain(FILE);
    const s = sql();
    expect(s.match(/^BEGIN;$/gm)?.length).toBe(1);
    expect(s.match(/^COMMIT;$/gm)?.length).toBe(1);
    expect(s).toMatch(/^-- @live-proof: /m);
  });

  it('the seed edit is pinned to the exact live preimage', () => {
    const s = sql();
    expect(s).toContain("preimage constant text := '16986022242d32fbda89a1e77dde67e0'");
    expect(s).toContain('IF md5(d) <> preimage THEN');
    // Every anchor must occur exactly once or the edit refuses.
    expect(s.match(/IF n <> 1 THEN RAISE EXCEPTION/g)?.length).toBe(3);
  });

  it('an unexpected error rolls the seed back, files one alert and answers activation_failed', () => {
    const s = sql();
    expect(s).toContain("|| E'  EXCEPTION WHEN OTHERS THEN\\n'");
    expect(s).toContain('GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE');
    expect(s).toContain('PERFORM public.fn_ca_tournament_mystery_activation_failed(');
    expect(s).toContain("''reason'', ''activation_failed''");
    // One open alert per tournament, critical, under the class-ruled source.
    expect(s).toContain("'fn_ca_tournament_mystery_activation_failed'");
    expect(s).toContain("'critical',");
    expect(s).toContain('AND NOT fa.resolved');
    expect(s).toContain("pg_advisory_xact_lock(\n    hashtextextended('ca-mystery-activation-failed:'");
  });

  it('a transient refusal is re-raised for the engine to retry, not paged', () => {
    const s = sql();
    expect(s).toContain(
      "IF left(v_err_state, 2) IN (''40'', ''08'', ''53'', ''57'') OR v_err_state = ''55P03'' THEN"
    );
    expect(s).toContain("|| E'      RAISE;\\n'");
  });

  it('the seed closes the alert on both of its success paths', () => {
    const s = sql();
    expect(s).toContain('p_tournament_id, v_t.mystery_bounty_stage);');
    expect(s).toContain(
      "PERFORM public.fn_ca_tournament_mystery_activation_recovered(p_tournament_id, ''active'');"
    );
    expect(s).toContain('SET resolved = true');
  });

  it('the engine keeps treating any refusal other than entry_still_open as report-and-retry', () => {
    const src = readFileSync(resolve(root, 'server/src/tournament/TournamentManagerBase.ts'), 'utf8');
    expect(src).toContain("supabase.rpc('fn_mystery_bounty_seed'");
    expect(src).toContain("if (res.reason !== 'entry_still_open')");
  });
});
