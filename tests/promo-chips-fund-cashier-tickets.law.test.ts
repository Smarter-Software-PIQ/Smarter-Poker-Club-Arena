import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');
const migration = read(
  'supabase/migrations/20261112184216_promo_chips_fund_cashier_tickets_and_cancel_returns_escrow.sql'
);
const door = migration.slice(
  migration.indexOf('CREATE OR REPLACE FUNCTION public.fn_cashier_promo_ticket_send('),
  migration.indexOf('REVOKE ALL ON FUNCTION public.fn_cashier_promo_ticket_send')
);
const cancelPatch = migration.slice(migration.indexOf('DO $patch$'));
const page = read('src/pages/CashierTradePage.tsx');

describe('Promo chips fund a cashier ticket, inside the shared 50 chip allowance', () => {
  it('debits the sender promo wallet into the ticket escrow through the autoledger', () => {
    expect(door).toContain("perform set_config('app.ledger_category', 'ticket_issue', true);");
    expect(door).toContain("perform set_config('app.ledger_counterparty', 'escrow', true);");
    expect(door).toContain('promo_wallet_balance = coalesce(promo_wallet_balance, 0) - p_value');
    expect(door).toContain('and coalesce(promo_wallet_balance, 0) >= p_value');
    expect(door).not.toMatch(/update\s+public\.club_members/i);
    expect(door).toContain('insert into public.tournament_tickets');
  });

  it('writes one promo receipt so sends and tickets share one allowance', () => {
    expect(door).toContain("'promo_wallet_send', 'Promo Ticket Issued'");
    expect(door).toContain("'destination', 'tournament_ticket'");
    expect(door).toContain("'actor_role', v_role");
    const sum = door.slice(door.indexOf('select coalesce(sum'), door.indexOf('v_remaining :='));
    expect(sum).toContain("t.transaction_type = 'promo_wallet_send'");
    expect(sum).toContain('t.to_user_id = p_holder_id');
    expect(sum).toContain("interval '168 hours'");
    expect(sum).not.toMatch(/t\.from_user_id\s*=/);
    expect(door).toContain('50::numeric - v_sent');
    expect(door).toContain("v_role in ('super_agent', 'agent', 'sub_agent')");
    expect(door).toContain('promo_downline_seven_day_limit');
  });

  it('keeps the cashier lock order, the downline rule and exact replay', () => {
    const agreement = door.indexOf("'agent-agreement:'");
    const hierarchy = door.indexOf("'cashier-hierarchy:'");
    const key = door.indexOf("'ticket:'");
    expect(agreement).toBeGreaterThan(0);
    expect(hierarchy).toBeGreaterThan(agreement);
    expect(key).toBeGreaterThan(hierarchy);
    expect(door).toContain('public.fn_club_cashier_can_transact(p_club_id, v_me, p_holder_id)');
    expect(door).toContain("'That Retry Key Belongs To A Different Ticket'");
    expect(migration).toContain("VALUES ('fn_cashier_promo_ticket_send', 'approved'");
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.fn_cashier_promo_ticket_send\(uuid, uuid, numeric, text\) FROM PUBLIC, anon;/
    );
  });

  it('returns a cancelled promo ticket to the promo wallet, never a player wallet', () => {
    expect(cancelPatch).toContain("IF md5(d) <> 'e52d94e64fe64cc1508885a541450c71'");
    expect(cancelPatch).toContain('IF v_promo THEN');
    expect(cancelPatch).toContain(
      'SET promo_wallet_balance=COALESCE(promo_wallet_balance,0)+v_t.value,updated_at=now()'
    );
    expect(cancelPatch).toContain("p.metadata->>'destination'='tournament_ticket'");
  });

  it('patches the body the refund category fix installed and keeps that category', () => {
    // 20261112184950 moved the release off escrow_release (cashout custody).
    expect(cancelPatch).not.toContain('ticket_redeem');
    expect(cancelPatch).toContain("IF position('escrow_release' in d) <> 0");
    expect(cancelPatch).toContain("position('''app.ledger_category'',''refund''' in d) = 0");
  });

  it('offers the promo wallet in Send Ticket and sends through the promo door', () => {
    expect(page).toContain('aria-label="Send Ticket From"');
    expect(page).toContain("'fn_cashier_promo_ticket_batch'");
    expect(page).not.toContain("'fn_cashier_promo_ticket_send'");
    expect(page).toContain(
      "kind === 'ticket' && !boundTournamentId && uncertainRecovery.source === 'promo_wallet'"
    );
    expect(page).toContain("(amountModal === 'ticket' && ticketSource === 'promo_wallet')");
    expect(page).toContain('Chips Are Back In Your Promo Wallet');
  });
});

const followUp = read(
  'supabase/migrations/20261112204754_promo_tickets_batch_allowance_receipts_and_redeem_names_its_.sql'
);
const section = (name: string) => {
  const start = followUp.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  return followUp.slice(start, followUp.indexOf('$function$;', start));
};

describe('Promo tickets: one batch call, a readable allowance and recoverable receipts', () => {
  it('batches through the single promo ticket door, one subtransaction per recipient', () => {
    const batch = section('fn_cashier_promo_ticket_batch');
    expect(batch).toContain('public.fn_cashier_promo_ticket_send(');
    expect(batch).toContain('jsonb_array_length(p_items) > 25');
    expect(batch).toContain("'A Recipient May Appear Only Once Per Batch'");
    expect(batch).toContain('exception when others then');
    expect(batch).not.toMatch(/update\s+public\./i);
    expect(followUp).toContain("VALUES ('fn_cashier_promo_ticket_batch', 'approved'");
  });

  it('previews the allowance with the same sum both promo doors enforce', () => {
    const allowance = section('fn_cashier_promo_allowance');
    expect(allowance).toContain("t.transaction_type = 'promo_wallet_send'");
    expect(allowance).toContain('t.to_user_id = u.user_id');
    expect(allowance).toContain("interval '168 hours'");
    expect(allowance).toContain('50::numeric - s.sent');
    expect(allowance).toContain('public.fn_club_cashier_can_transact(p_club_id, v_me, u.user_id)');
    expect(allowance).not.toMatch(/\b(insert|update|delete)\b\s+(into\s+)?public\./i);
    expect(page).toContain("supabase.rpc('fn_cashier_promo_allowance'");
    expect(page).toContain('title="Promo Allowance Remaining"');
    expect(page).toContain("' (Over The Promo Limit)'");
  });

  it('recovers a promo ticket receipt by its retry key, for its own sender only', () => {
    const receipts = section('fn_cashier_promo_ticket_receipts');
    expect(receipts).toContain('t.from_user_id = v_me');
    expect(receipts).toContain("t.metadata ->> 'destination' = 'tournament_ticket'");
    expect(page).toContain("'fn_cashier_promo_ticket_receipts'");
  });

  it('names the ticket on a promo ticket redeem and labels it in history', () => {
    expect(followUp).toContain("IF md5(d) <> '0bb17681b38164a7a2746e17d07597b3'");
    expect(followUp).toContain("AND metadata->>''destination''=''tournament_ticket''))");
    const history = read('src/components/wallet/describeChipTransaction.ts');
    expect(history).toContain("return 'Promo Wallet To Tournament Ticket';");
    expect(history).toContain('Tournament Ticket`;');
  });
});

describe('Promo ticket dialog state and the cancel replay', () => {
  const replay = read(
    'supabase/migrations/20261112235138_a_replayed_promo_ticket_cancel_names_its_promo_wallet.sql'
  );
  it('answers a replayed cancel with the wallet its receipt recorded', () => {
    expect(replay).toContain("IF md5(d) <> '7b73f81407a4feb9084b92d5ee38db1d'");
    expect(replay).toContain(
      "''refund_wallet'',COALESCE(v_receipt.metadata->>''refund_wallet'',''player_wallet''));"
    );
    expect(replay).toContain('You No Longer Hold A Promo Wallet In That Club');
  });
  it('reads the promo balance for Send Ticket and never carries the source over', () => {
    expect(page).toContain(
      "if (amountModal === 'send' || amountModal === 'ticket' || claimOpen) void loadBankBalance();"
    );
    expect(page.split("setTicketSource('player_wallet');").length - 1).toBeGreaterThanOrEqual(4);
    expect(page).toContain('{!selfSelected && (');
    expect(page).toContain('setPromoAllowanceEpoch((epoch) => epoch + 1);');
    expect(page).toContain('Promo Allowance Could Not Be Read. The 50 Chip Limit Still Applies.');
  });
});

describe('Promo tickets count in the digests and under the statement Ticket filter', () => {
  const readers = read(
    'supabase/migrations/20261113010721_promo_funded_tickets_count_in_the_digests_and_the_ticket_sta.sql'
  );
  const ticketLeg = (prefix: string, spaced: boolean) =>
    spaced
      ? `(${prefix}category = ''ticket_issue'' AND ${prefix}from_type = ''promo_wallet'' AND ${prefix}to_type = ''escrow'')`
      : `(${prefix}category=''ticket_issue'' AND ${prefix}from_type=''promo_wallet'' AND ${prefix}to_type=''escrow'')`;

  it('patches each reader only from the definition production held', () => {
    for (const preimage of [
      'c48e3a4d068c77ecadf1fb0eb57cb7a5',
      'f2f9802c827e476246e335ba1d1596f0',
      'f67a7895b96362ef9daef978d1e34494',
      '8cab96c15ba360fb34c13f0afd3378b8',
    ]) {
      expect(readers).toContain(`IF md5(d) <> '${preimage}' THEN`);
    }
    for (const successor of [
      '145597c5ec78386523b52e10d83ff29b',
      '7b3118323fff5a16c6bdfc900871c14e',
      'cc48246f155b78cd1443a63097848f56',
      'dcfe58296b8a3d140f4fbdcc7395bd03',
    ]) {
      expect(readers.split('\n').find((line) => line.startsWith('-- @live-proof:'))).toContain(
        successor
      );
    }
    expect(readers.split('IF n = d THEN RAISE EXCEPTION').length - 1).toBe(5);
    expect(readers.split('EXECUTE n;').length - 1).toBe(4);
  });

  it('counts the promo wallet to escrow ticket leg as promo given, gross', () => {
    expect(readers).toContain(`OR ${ticketLeg('', false)}),0) player_promo,`);
    expect(readers).toContain(`OR ${ticketLeg('', true)}),0),2),`);
    expect(readers).toContain(`OR ${ticketLeg('l.', false)}`);
    expect(readers).toContain(
      "LEFT JOIN public.profiles p ON p.id=CASE WHEN l.to_type=''player_wallet'' THEN l.to_entity_id ELSE tk.holder_id END"
    );
    expect(readers).not.toContain("category=''refund''");
  });

  it('returns a promo ticket receipt under the Ticket filter without renaming its wallet', () => {
    expect(readers).toContain(
      "OR ($10 = ''ticket'' AND r.source = ''receipt'' AND r.kind = ''promo_wallet_send'' AND r.ticket_id IS NOT NULL))"
    );
    expect(readers).not.toContain("THEN ''ticket''");
  });

  it('touches readers only, never a limit, a money route or a reconciler', () => {
    for (const name of [
      'fn_promo_wallet_send_core_20261004',
      'fn_cashier_promo_ticket_send(',
      'fn_cashier_promo_allowance',
      'fn_ca_tally_',
      'fn_ca_autoledger',
      'trial_balance',
      'supply_snapshot',
    ]) {
      expect(readers).not.toContain(name);
    }
    expect(readers).not.toMatch(/^\s*(insert|update|delete|grant|revoke|alter|create|drop)\b/im);
  });
});
