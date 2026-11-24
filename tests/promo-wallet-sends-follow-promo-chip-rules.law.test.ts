import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  describeChipTransaction,
  isAgentPromoSendTransaction,
  walletRoute,
} from '../src/components/wallet/describeChipTransaction';

const read = (path: string) => readFileSync(path, 'utf8');
const migration = read(
  'supabase/migrations/20261124004000_promo_wallet_sends_follow_promo_chip_rules.sql'
);
const hardening = read('supabase/migrations/20261124042000_harden_promo_wallet_invariants.sql');
const contract = read('scripts/verification-harness/cashier-release-contract.sql');

describe('Chips sent to a promo wallet follow promo chip rules regardless of source wallet', () => {
  it('enforces unified 50/7d and 250/24h limits across promo_wallet, agent_wallet, and player_wallet sends', () => {
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.fn_ca_agent_promo_downline_sent_7d'
    );
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.fn_ca_agent_promo_daily_allowance'
    );
    expect(migration).toContain("t.transaction_type IN ('agent_wallet_send', 'peer_transfer')");
    expect(migration).toContain("t.metadata ->> 'destination' = 'promo_wallet'");
    expect(migration).toContain('t.from_user_id IS DISTINCT FROM t.to_user_id');
    expect(migration).toContain('fn_agent_wallet_send_core_20260830');
    expect(migration).toContain('fn_cashier_player_wallet_send');
    expect(migration).toContain('fn_promo_wallet_send_core_20261004');
    expect(migration).toContain('fn_cashier_promo_allowance');
    expect(migration).toContain('fn_cashier_history_feed');
    expect(migration).toContain('promo_downline_seven_day_limit');
    expect(migration).toContain('promo_agent_daily_limit');
    expect(migration).toContain('promo_limit_snapshot');

    expect(hardening).toContain("IN ('promo_wallet', 'cashier_promo_wallet')");
    expect(hardening).toContain('promo_wallet_cannot_convert_to_non_promo');
    expect(hardening).toContain('zz_ca_funded_return_journal');
  });

  it('returns reversed Club Bank -> Promo Wallet sends to clubs.promo_balance and blocks exit lock bypasses', () => {
    expect(migration).toContain('fn_club_bank_reverse_core_20261004');
    expect(migration).toContain("app.ledger_counterparty_label', 'clubs.promo_balance'");
    expect(migration).toContain('set promo_balance = coalesce(promo_balance, 0) + v_tx.amount');
    expect(migration).toContain(
      "'return_destination', case when v_dest = 'promo_wallet' then 'club_promo_wallet' else 'club_bank' end"
    );
    expect(migration).toContain('fn_ca_promo_play_through_on_exit');
    expect(migration).toContain(
      "IF NEW.to_type IN('club_treasury','union_wallet') OR (NEW.to_type='promo_wallet' AND (NEW.category='reversal' OR (NEW.category='club_bank_claim' AND NEW.to_entity_id=NEW.club_id))) THEN"
    );
  });

  it('pins every promo door, helper, ledger conservation guard, and exit guard in the live release contract', () => {
    expect(contract).toContain("WHERE version = '20261124004000'");
    expect(contract).toContain("WHERE version = '20261124042000'");
    for (const signature of [
      'public.fn_club_bank_reverse_core_20261004(uuid,text,uuid)',
      'public.fn_promo_wallet_send_core_20261004(uuid,uuid,numeric,text,text,uuid)',
      'public.fn_cashier_history_feed(uuid,text,text,timestamp with time zone,timestamp with time zone,uuid,text,timestamp with time zone,uuid,integer)',
      'public.fn_cashier_player_wallet_send(uuid,uuid,numeric,text,text,uuid)',
      'public.fn_cashier_promo_allowance(uuid,uuid[])',
      'public.fn_agent_wallet_send_core_20260830(uuid,uuid,numeric,text,text,uuid)',
      'public.fn_ca_agent_promo_downline_sent_7d(uuid,uuid,timestamptz)',
      'public.fn_ca_agent_promo_daily_allowance(uuid,uuid,timestamptz)',
    ]) {
      expect(contract, signature).toContain(`'signature', '${signature}'`);
    }
    expect(contract).toContain('promo_wallet_cannot_convert_to_non_promo');
    expect(contract).toContain('NEW.to_entity_id=NEW.club_id');
  });

  it('forbids any later migration from reopening the promo exit-lock or ledger-conversion bypasses', () => {
    const later = readdirSync('supabase/migrations')
      .filter((f) => /^\d{14}_.*\.sql$/.test(f) && f.slice(0, 14) > '20261124042000')
      .sort();
    for (const file of later) {
      const sql = read(`supabase/migrations/${file}`);
      if (sql.includes('fn_ca_promo_play_through_on_exit')) {
        expect(sql, file).not.toContain("IN('club_treasury','promo_wallet','union_wallet')");
      }
      if (sql.includes('fn_ca_funded_chip_return_journal')) {
        expect(sql, file).toContain('promo_wallet_cannot_convert_to_non_promo');
      }
    }
  });

  it('classifies agent promo sends across all funding wallets via one shared helper', () => {
    expect(
      isAgentPromoSendTransaction({
        transaction_type: 'promo_wallet_send',
        from_user_id: 'a1',
        to_user_id: 'p1',
        metadata: { destination: 'player_wallet' },
      })
    ).toBe(true);
    expect(
      isAgentPromoSendTransaction({
        transaction_type: 'agent_wallet_send',
        from_user_id: 'a1',
        to_user_id: 'a2',
        metadata: { destination: 'promo_wallet' },
      })
    ).toBe(true);
    expect(
      isAgentPromoSendTransaction({
        transaction_type: 'agent_wallet_send',
        from_user_id: 'a1',
        to_user_id: 'a2',
        metadata: { destination: 'cashier_promo_wallet' },
      })
    ).toBe(true);
    expect(
      isAgentPromoSendTransaction({
        transaction_type: 'peer_transfer',
        from_user_id: 'a1',
        to_user_id: 'a2',
        metadata: { destination: 'promo_wallet' },
      })
    ).toBe(true);
    // Self-move and non-promo sends are NOT downline agent promo sends.
    expect(
      isAgentPromoSendTransaction({
        transaction_type: 'peer_transfer',
        from_user_id: 'a1',
        to_user_id: 'a1',
        metadata: { destination: 'promo_wallet' },
      })
    ).toBe(false);
    expect(
      isAgentPromoSendTransaction({
        transaction_type: 'agent_wallet_send',
        from_user_id: 'a1',
        to_user_id: 'a2',
        metadata: { destination: 'agent_wallet' },
      })
    ).toBe(false);
    expect(
      isAgentPromoSendTransaction({
        transaction_type: 'club_bank_send',
        from_user_id: 'o1',
        to_user_id: 'a2',
        metadata: { destination: 'promo_wallet' },
      })
    ).toBe(false);
  });

  it('describes Club Bank reversals from a Promo Wallet as returning to the Club Promo Wallet', () => {
    const names = new Map([
      ['agent-1', 'Agent Alpha'],
      ['owner-1', 'Owner One'],
    ]);
    const promoReversal = {
      transaction_type: 'club_bank_reversal',
      amount: 100,
      from_user_id: 'agent-1',
      to_user_id: 'owner-1',
      metadata: {
        destination: 'promo_wallet',
        return_destination: 'club_promo_wallet',
      },
    };
    expect(describeChipTransaction(promoReversal, names, 'owner-1')).toBe(
      "You Reversed 100 From Agent Alpha's Promo Wallet To The Club Promo Wallet"
    );
    expect(walletRoute(promoReversal)).toBe('Promo Wallet To Club Promo Wallet');

    const bankReversal = {
      ...promoReversal,
      metadata: {
        destination: 'agent_wallet',
        return_destination: 'club_bank',
      },
    };
    expect(describeChipTransaction(bankReversal, names, 'owner-1')).toBe(
      "You Reversed 100 From Agent Alpha's Agent Wallet To The Club Bank"
    );
    expect(walletRoute(bankReversal)).toBe('Agent Wallet To Club Bank');
  });

  it('surfaces promo terms, 50/7d limit notices, shared promo predicate, and reversal destination in cashier UI', () => {
    const modal = read('src/components/wallet/WalletCashierModal.tsx');
    expect(modal).toContain("spendWallet === 'promo_wallet' || destination === 'promo_wallet'");
    expect(modal).toMatch(
      /walletType === 'promo_wallet'\s*\|\|\s*\(tab === 'send' && destination === 'promo_wallet'\)/
    );
    expect(modal).toContain("res.return_destination === 'club_promo_wallet'");

    const trade = read('src/pages/CashierTradePage.tsx');
    expect(trade).toContain('PROMO_PLAY_THROUGH_SENDER_TERMS');
    expect(trade).toContain('promoCappedSelected');
    expect(trade).toContain('promoAnyDestinationSelected');

    const agentDash = read('src/pages/AgentDashboardPage.tsx');
    expect(agentDash).toContain("transferDestination === 'promo_wallet'");
    expect(agentDash).toContain('PROMO_PLAY_THROUGH_SENDER_TERMS');
    expect(agentDash).toContain(
      'Each Downline Can Receive 50 Promo Chips Total From All Agents In Any 7'
    );

    for (const file of [
      'src/components/club/MemberTransactionHistory.tsx',
      'src/components/club/MemberTransactionReceipt.tsx',
    ]) {
      const src = read(file);
      expect(src).toContain('isAgentPromoSendTransaction(row)');
      expect(src).toContain('promo_used_after_send');
    }
  });

  it('wires the isolated PostgreSQL concurrency and ledger-guard proof into the required Cashier accounting lane', () => {
    expect(read('scripts/ci/test-cashier-authority-exact-intent-postgres.py')).toContain(
      'scripts/ci/test-promo-wallet-rules-all-sources-postgres.py'
    );
    const pgProof = read('scripts/ci/test-promo-wallet-rules-all-sources-postgres.py');
    expect(pgProof).toContain('ledger guard unconditionally blocks promo_wallet');
    expect(pgProof).toContain(
      'concurrent agent_wallet and player_wallet sends to same promo_wallet cannot exceed 50'
    );
  });
});
