/**
 * LAW: POST-COMMIT PENDING ADD-ON RESOLUTION NEVER SCANS PROMO FEE HISTORY,
 * ZERO-CUSTODY PROMO READERS/SETTLERS SHORT-CIRCUIT, AND THE HOURLY SWEEP
 * NEVER SELF-INVALIDATES ITS OWN CACHE (incidents 053d3341 & 515d6f24,
 * 2026-11-22).
 *
 * Root causes verified directly on production (2026-11-22 20:15-20:35 UTC):
 *   1. fn_ca_promo_apply_pending_cash_funding (reached from
 *      fn_ca_process_hand_post_commit_obligations -> resolve_pending_addon ->
 *      fn_cash_record_funding_application) unconditionally locked promo grants
 *      and called fn_ca_promo_play_through_settle + fn_ca_promo_locked_at even
 *      when the pending add-on held 0.00 promo custody (761 of 769 = 98.96% of
 *      all cash pending add-ons, including incident add-on 888d5f0f: 0/0/0).
 *   2. fn_ca_promo_locked_at materialized fn_ca_promo_play_through_state even
 *      when ca_promo_principal_custody had 0 rows at (p_kind, p_entity).
 *   3. Sibling callers fn_ca_promo_nonwallet_entry (ticket_redeem) and
 *      fn_ca_promo_leave_principal called fn_ca_promo_play_through_settle even
 *      with 0 open-grant custody at the source.
 *   4. sp_ca_promo_profit_hourly_sweep closed grants / unlocked gates in its
 *      ACT phase immediately after writing ca_promo_fee_state_cache in LOOK,
 *      invalidating the cache signature it had just written and then skipping
 *      the account for 1 hour (leaving 231 of 534 = 43.3% of open-grant
 *      accounts with mismatched cache signatures live on production).
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');
const ALL_MIGRATIONS = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

function latestMigrationDefining(pattern: RegExp, label: string): { file: string; sql: string } {
  const hits = ALL_MIGRATIONS.filter((f) =>
    pattern.test(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
  );
  expect(hits.length, `expected at least one migration defining ${label}`).toBeGreaterThanOrEqual(
    1
  );
  const file = hits[hits.length - 1];
  return { file, sql: readFileSync(join(MIGRATIONS_DIR, file), 'utf8') };
}

function sliceRoutine(sql: string, startRe: RegExp, revokePrefix: string): string {
  const start = sql.search(startRe);
  expect(start, `start not found for ${revokePrefix}`).toBeGreaterThan(-1);
  const end = sql.indexOf(revokePrefix, start);
  expect(end, `REVOKE not found for ${revokePrefix}`).toBeGreaterThan(start);
  return sql.slice(start, end);
}

describe('LAW: post-commit pending add-ons never scan promo history and hourly sweep preserves cache validity', () => {
  it('fn_ca_promo_apply_pending_cash_funding never calls settle/locked_at/move_custody and guards grant locks behind actual custody', () => {
    const { sql } = latestMigrationDefining(
      /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?fn_ca_promo_apply_pending_cash_funding\s*\(/i,
      'fn_ca_promo_apply_pending_cash_funding'
    );
    const body = sliceRoutine(
      sql,
      /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?fn_ca_promo_apply_pending_cash_funding\s*\(/i,
      'REVOKE ALL ON FUNCTION public.fn_ca_promo_apply_pending_cash_funding'
    );

    expect(body).not.toContain('fn_ca_promo_play_through_settle');
    expect(body).not.toContain('fn_ca_promo_locked_at');
    expect(body).not.toContain('fn_ca_promo_move_custody');
    expect(body).not.toContain('fn_ca_promo_play_through_state');
    expect(body).toContain('ca_promo_principal_custody');
    expect(body).toContain('ca_promo_profit_custody');
    expect(body).toContain('fn_ca_promo_move_selected_custody');
    expect(body.indexOf('ca_promo_principal_custody')).toBeLessThan(
      body.indexOf('fn_ca_promo_profit_prelock_source')
    );

    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.fn_ca_promo_apply_pending_cash_funding\(uuid\)\s+FROM PUBLIC,\s*anon,\s*authenticated,\s*service_role;/i
    );
  });

  it('fn_ca_promo_locked_at short-circuits on open ca_promo_principal_custody before fn_ca_promo_play_through_state', () => {
    const { sql } = latestMigrationDefining(
      /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?fn_ca_promo_locked_at\s*\(/i,
      'fn_ca_promo_locked_at'
    );
    const body = sliceRoutine(
      sql,
      /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?fn_ca_promo_locked_at\s*\(/i,
      'REVOKE ALL ON FUNCTION public.fn_ca_promo_locked_at'
    );

    const custodyIdx = body.indexOf('ca_promo_principal_custody');
    const closedAtIdx = body.indexOf('closed_at IS NULL');
    const stateIdx = body.indexOf('fn_ca_promo_play_through_state');

    expect(custodyIdx).toBeGreaterThan(-1);
    expect(closedAtIdx).toBeGreaterThan(-1);
    expect(stateIdx).toBeGreaterThan(custodyIdx);
    expect(stateIdx).toBeGreaterThan(closedAtIdx);

    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.fn_ca_promo_locked_at\(uuid,uuid,text,uuid\)\s+FROM PUBLIC,\s*anon,\s*authenticated,\s*service_role;/i
    );
  });

  it('fn_ca_promo_nonwallet_entry and fn_ca_promo_leave_principal guard settle behind open-grant custody', () => {
    const nonwallet = latestMigrationDefining(
      /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?fn_ca_promo_nonwallet_entry\s*\(/i,
      'fn_ca_promo_nonwallet_entry'
    );
    const nwBody = sliceRoutine(
      nonwallet.sql,
      /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?fn_ca_promo_nonwallet_entry\s*\(/i,
      'REVOKE ALL ON FUNCTION public.fn_ca_promo_nonwallet_entry'
    );
    expect(nwBody.indexOf('ca_promo_principal_custody')).toBeGreaterThan(-1);
    expect(nwBody.indexOf('ca_promo_principal_custody')).toBeLessThan(
      nwBody.indexOf('fn_ca_promo_play_through_settle')
    );

    const leave = latestMigrationDefining(
      /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?fn_ca_promo_leave_principal\s*\(/i,
      'fn_ca_promo_leave_principal'
    );
    const lvBody = sliceRoutine(
      leave.sql,
      /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?fn_ca_promo_leave_principal\s*\(/i,
      'REVOKE ALL ON FUNCTION public.fn_ca_promo_leave_principal'
    );
    expect(lvBody.indexOf('ca_promo_principal_custody')).toBeGreaterThan(-1);
    expect(lvBody.indexOf('ca_promo_principal_custody')).toBeLessThan(
      lvBody.indexOf('fn_ca_promo_play_through_settle')
    );
  });

  it('sp_ca_promo_profit_hourly_sweep refreshes cache after ACT mutations and selects signature-mismatched accounts', () => {
    const { sql } = latestMigrationDefining(
      /CREATE\s+(?:OR\s+REPLACE\s+)?PROCEDURE\s+(?:public\.)?sp_ca_promo_profit_hourly_sweep\s*\(/i,
      'sp_ca_promo_profit_hourly_sweep'
    );
    const body = sliceRoutine(
      sql,
      /CREATE\s+(?:OR\s+REPLACE\s+)?PROCEDURE\s+(?:public\.)?sp_ca_promo_profit_hourly_sweep\s*\(/i,
      'REVOKE ALL ON PROCEDURE public.sp_ca_promo_profit_hourly_sweep'
    );

    expect(body).toContain('fn_ca_promo_fee_state_signature');
    expect(body).toContain('v_act_mutated');
    expect(body).toContain('POST-ACT CACHE SYNC');
    expect(sql).toMatch(
      /REVOKE ALL ON PROCEDURE public\.sp_ca_promo_profit_hourly_sweep\(integer\)\s+FROM PUBLIC,\s*anon,\s*authenticated,\s*service_role;/i
    );
  });

  it('behavioral native PostgreSQL proofs are wired into test-promo-profit-fee-state-snapshot.py', () => {
    const py = readFileSync(
      join(ROOT, 'scripts', 'ci', 'test-promo-profit-fee-state-snapshot.py'),
      'utf8'
    );
    expect(py).toContain(
      '20261122205903_post_commit_pending_addon_never_scans_promo_history_and_swee.sql'
    );
    expect(py).toContain(
      'zero-custody pending add-on completes without waiting on a locked promo grant'
    );
    expect(py).toContain('sweep repairs signature-mismatched cache immediately within 1h cooldown');
  });
});
