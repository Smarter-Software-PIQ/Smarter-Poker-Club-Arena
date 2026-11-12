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
    expect(cancelPatch).toContain("IF md5(d) <> 'd3f65b7702d4b7f543891dd87c149353'");
    expect(cancelPatch).toContain('IF v_promo THEN');
    expect(cancelPatch).toContain(
      'SET promo_wallet_balance=COALESCE(promo_wallet_balance,0)+v_t.value,updated_at=now()'
    );
    expect(cancelPatch).toContain("p.metadata->>'destination'='tournament_ticket'");
  });

  it('journals a ticket cancel on the ticket float, not on cashout custody', () => {
    // escrow_release is counted as cashout custody by fn_ca_tally_ledger_leg,
    // so a cancel journaled under it is refused at commit for every ticket.
    expect(cancelPatch).toContain(
      "'  PERFORM set_config(''app.ledger_category'',''ticket_redeem'',true);'"
    );
    expect(cancelPatch).toContain("IF position('escrow_release' in d) <> 0");
  });

  it('offers the promo wallet in Send Ticket and sends through the promo door', () => {
    expect(page).toContain('aria-label="Send Ticket From"');
    expect(page).toContain("supabase.rpc(\n                'fn_cashier_promo_ticket_send'");
    expect(page).toContain(
      "kind === 'ticket' && !boundTournamentId && uncertainRecovery.source === 'promo_wallet'"
    );
    expect(page).toContain("(amountModal === 'ticket' && ticketSource === 'promo_wallet')");
    expect(page).toContain('Chips Are Back In Your Promo Wallet');
  });
});
