/**
 * Dan 2026-11-02: "INSIDE THE UNION WALLETS, UNION BANK, RAKE TREASURY, BACK UP
 * BBJ WALLET, PROMO WALLET AND SPINS TREASURY, SHOULD BE A TRANSACTION LOG OF
 * ANY OUTS, AND A ONE TIME DAILY "INS" WHERE IT GIVES THE DAILY TOTALS
 * COLLECTED."
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const MIG = readFileSync(
  'supabase/migrations/20261102063939_union_treasury_transaction_logs.sql',
  'utf8'
);
const LOG = readFileSync('src/components/union/UnionTreasuryLog.tsx', 'utf8');
const MODAL = readFileSync('src/components/union/UnionWalletModal.tsx', 'utf8');
const DETAIL = readFileSync('src/components/union/UnionTreasuryDetailModal.tsx', 'utf8');

describe('union treasury transaction log', () => {
  it('logs every out individually and collection as one daily row per wallet', () => {
    expect(MIG).toMatch(
      /entry_kind\s+text\s+NOT NULL CHECK \(entry_kind IN \('out','in','daily_in'\)\)/
    );
    expect(MIG).toMatch(
      /ux_ca_union_treasury_log_daily[\s\S]*?\(union_id, wallet_key, log_day\)[\s\S]*?WHERE entry_kind = 'daily_in'/
    );
    expect(MIG).toContain(
      "WHERE g.side = 'out' OR NOT fn_union_treasury_is_collection(g.category)"
    );
  });

  it('covers all six union treasuries', () => {
    for (const w of ['union_bank', 'rake_treasury', 'backup_bbj', 'promo', 'spins_treasury']) {
      expect(MIG).toContain(`'${w}'`);
    }
    for (const k of [
      "chips: 'union_bank'",
      "promo: 'promo'",
      "spin_reserve: 'spins_treasury'",
      "bbj: 'backup_bbj'",
      "rake: 'rake_treasury'",
    ]) {
      expect(MODAL).toContain(k);
    }
    expect(DETAIL).toContain('wallet="rake_treasury"');
    expect(DETAIL).toContain("'backup_bbj'");
  });

  it('is union staff only and read through one RPC', () => {
    expect(MIG).toContain('fn_union_can_manage_wallets(p_union_id, v_actor)');
    expect(MIG).toContain(
      'REVOKE ALL ON public.ca_union_treasury_log FROM public, anon, authenticated, service_role'
    );
    expect(LOG).toContain("supabase.rpc('fn_union_treasury_log'");
  });

  it('names the timezone the day closes in', () => {
    expect(MIG).toContain("AT TIME ZONE 'America/Chicago'");
  });
});
