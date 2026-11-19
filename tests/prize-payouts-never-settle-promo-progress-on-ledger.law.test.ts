/**
 * PRIZE PAYOUTS NEVER SETTLE PROMO PROGRESS ON THE LEDGER
 * (2026-11-19, incident 075013fd, lane 4)
 *
 * After #11361 (20261119053144) removed fn_ca_promo_profit_settle from
 * fn_ca_promo_profit_credit_owned and fn_ca_promo_profit_finish_entry_fee,
 * four remaining payout-path functions still invoked
 * fn_ca_promo_play_through_settle on prize, bounty, satellite award, and
 * tournament refund credits:
 *   1. fn_ca_promo_custody_on_ledger (zzz_ca_promo_custody trigger on chip_ledger)
 *   2. fn_ca_promo_realize_event_principal
 *   3. fn_ca_promo_roll_event_principal
 *   4. fn_ca_promo_profit_return_entitlement_ticket
 *
 * Migration 20261119175941 removes fn_ca_promo_play_through_settle from all
 * four payout/award/refund paths so every payout decides on stored grant state
 * while the hourly sweep and live cash-out handle release.
 * Native PG proof: scripts/ci/test-prize-payouts-never-settle-promo-progress.py.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { missingProbes } from '../scripts/ci/migration-function-probes.mjs';
import { declaredProofs, proofIsRunnable } from '../scripts/ci/check-migrations-are-live.mjs';

const MIGRATION_PATH = join(
  __dirname,
  '..',
  'supabase/migrations/20261119175941_prize_payouts_never_settle_promo_progress_on_ledger.sql'
);
const sql = readFileSync(MIGRATION_PATH, 'utf8');

describe('prize payouts never settle promo progress on the ledger', () => {
  it('rewrites all four remaining payout-path promo functions with single-anchor guards', () => {
    expect(sql).toContain("'public.fn_ca_promo_custody_on_ledger()'");
    expect(sql).toContain("'public.fn_ca_promo_realize_event_principal(uuid)'");
    expect(sql).toContain("'public.fn_ca_promo_roll_event_principal(uuid,uuid,text)'");
    expect(sql).toContain("'public.fn_ca_promo_profit_return_entitlement_ticket(uuid,uuid)'");
    expect(sql).toContain('IF v_n <> 1 THEN');
  });

  it('scopes fn_ca_promo_custody_on_ledger settle strictly to table_cashout (never dest=event payouts)', () => {
    expect(sql).toMatch(
      /IF NEW\.category=''table_cashout'' THEN\\n\s+PERFORM public\.fn_ca_promo_profit_prelock_source\(NEW\.club_id,uid,''table_stack'',NEW\.from_entity_id\);\\n\s+PERFORM public\.fn_ca_promo_play_through_settle\(NEW\.club_id,uid\);\\n\s+END IF;/
    );
  });

  it('verifies post-install that realize, roll, and return_entitlement_ticket no longer call fn_ca_promo_play_through_settle', () => {
    expect(sql).toContain(
      "position('fn_ca_promo_play_through_settle(' in pg_get_functiondef('public.fn_ca_promo_realize_event_principal(uuid)'::regprocedure)) > 0"
    );
    expect(sql).toContain(
      "position('fn_ca_promo_play_through_settle(' in pg_get_functiondef('public.fn_ca_promo_roll_event_principal(uuid,uuid,text)'::regprocedure)) > 0"
    );
    expect(sql).toContain(
      "position('fn_ca_promo_play_through_settle(' in pg_get_functiondef('public.fn_ca_promo_profit_return_entitlement_ticket(uuid,uuid)'::regprocedure)) > 0"
    );
  });

  it('declares a runnable @live-proof and satisfies the install-time probe law', () => {
    const proofs = declaredProofs(sql);
    expect(proofs.length).toBeGreaterThanOrEqual(1);
    for (const p of proofs) {
      expect(proofIsRunnable(p)).toBe(true);
    }
    expect(missingProbes(sql)).toEqual([]);
  });
});
