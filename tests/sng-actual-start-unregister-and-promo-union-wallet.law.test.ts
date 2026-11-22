import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { migrationTransactionShape } from '../scripts/ci/migration-transaction-shape.mjs';
import { migrationCostRisks } from '../scripts/ci/migration-cost-shape.mjs';
import { assertOrdinaryMigrationBudget } from '../scripts/ci/migration-session-identity.mjs';
import { ordinaryMigrationBudgetMs } from '../scripts/ci/migration-install-budget.mjs';
import { missingProbes } from '../scripts/ci/migration-function-probes.mjs';

const ROOT = resolve(__dirname, '..');
const FILE = '20261122185915_sng_actual_start_unregister_and_promo_union_wallet_id.sql';
const SQL = readFileSync(resolve(ROOT, 'supabase/migrations', FILE), 'utf8');

function extractFunction(name: string): string {
  const start = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, `missing CREATE OR REPLACE FUNCTION public.${name}`).toBeGreaterThan(-1);
  const bodyOpen = SQL.indexOf('AS $function$', start);
  expect(bodyOpen, `missing AS $function$ for ${name}`).toBeGreaterThan(start);
  const bodyClose = SQL.indexOf('$function$', bodyOpen + 'AS $function$'.length);
  expect(bodyClose, `unterminated function body for ${name}`).toBeGreaterThan(bodyOpen);
  return SQL.slice(start, bodyClose + '$function$'.length);
}

describe('sng_actual_start unregistration and promo union_wallet row-id resolution', () => {
  it('passes transaction shape, install budget, cost risks, and mandatory function probes', () => {
    const shape = migrationTransactionShape(FILE, SQL);
    expect(shape.ok ? 'ok' : shape.reason).toBe('ok');
    expect(migrationCostRisks(FILE, SQL)).toEqual([]);
    expect(() =>
      assertOrdinaryMigrationBudget(SQL, ordinaryMigrationBudgetMs(FILE, SQL))
    ).not.toThrow();
    expect(missingProbes(SQL)).toEqual([]);
  });

  it('resolves union_wallets by union_id OR id across all four promo grant/return functions', () => {
    const lockFn = extractFunction('fn_ca_promo_lock_grant_funds');
    expect(lockFn).toContain('WHERE uw.union_id=g.funded_from_id OR uw.id=g.funded_from_id');
    expect(lockFn).toContain(
      'PERFORM 1 FROM public.union_wallets WHERE union_id=f.funded_from_id FOR UPDATE;'
    );
    expect(lockFn).toContain("RAISE EXCEPTION 'promo_return_original_fund_missing'");

    const returnFn = extractFunction('fn_ca_promo_return_principal');
    expect(returnFn).toContain('SELECT union_id,promo_wallet INTO source_id,fund_balance');
    expect(returnFn).toContain('WHERE union_id=g.funded_from_id OR id=g.funded_from_id');
    expect(returnFn).toContain(
      "IF source_id IS NULL OR fund_balance IS NULL THEN RAISE EXCEPTION 'promo_return_original_fund_missing'"
    );

    const ticketFn = extractFunction('fn_ca_promo_returned_ticket_principal_fee');
    expect(ticketFn).toContain('WHERE uw.union_id=g.funded_from_id OR uw.id=g.funded_from_id');
    expect(ticketFn).toContain("RAISE EXCEPTION 'original_ticket_Pfee_fund_missing'");

    const recordFn = extractFunction('fn_ca_promo_play_through_record_grant');
    expect(recordFn).toContain('WHERE uw.union_id = p_funded_from_id OR uw.id = p_funded_from_id');
    expect(recordFn).toContain('p_source_ledger_id, p_funded_from_type, v_funded_from_id');
  });

  it('grants sng_actual_start to multi-player sng-v1 events while preserving HU SNG, Spin, and scheduled MTT contracts', () => {
    expect(SQL).toContain("'sng_actual_start'::text");
    expect(SQL).toContain("'heads_up_sng_actual_start'::text");
    expect(SQL).toContain("'spin_actual_start'::text");

    const receiptFn = extractFunction('fn_ca_tournament_unregistration_receipt');
    expect(receiptFn).toContain(
      "'spin_actual_start','heads_up_sng_actual_start','sng_actual_start','launch_release'"
    );
    expect(receiptFn).toContain("v_r.start_authority='sng_actual_start'");
    expect(receiptFn).toContain("AND t.format_contract='sng-v1'");
    expect(receiptFn).toContain('AND COALESCE(t.max_players,0)<>2');

    const unregFn = extractFunction('fn_ca_unregister_tournament_player_exact');
    expect(unregFn).toContain("v_start_authority:='heads_up_sng_actual_start';");
    expect(unregFn).toContain("v_start_authority:='sng_actual_start';");
    expect(unregFn).toContain('-- @lifecycle-exclusive-lock:');

    const diamondFn = extractFunction('fn_poker_diamond_tournament_unregister');
    expect(diamondFn).toContain("v_authority := 'heads_up_sng_actual_start';");
    expect(diamondFn).toContain("v_authority := 'sng_actual_start';");
    expect(diamondFn).toContain('-- @lifecycle-exclusive-lock:');
  });
});
