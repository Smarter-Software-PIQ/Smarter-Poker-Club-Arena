/**
 * Dan 2026-11-13: "THE TRANSACTION DESCRIPTIONS CAN BE MASSIVELY IMPROVED.
 * THERE SHOULD BE -400 WHEN A PLAYER CASHES OUT."
 */
import { describe, expect, it } from 'vitest';
import {
  ledgerDisplaySign,
  ledgerRowTitle,
} from '../../src/components/wallet/describeChipTransaction';

const OWNER = 'owner';
const PLAYER = 'player';
const AGENT = 'agent';
const OTHER = 'other';

describe('history row signs', () => {
  it('a cash-out request reads -400 to the club book and to the player', () => {
    const row = {
      transaction_type: 'cashout_request_escrow',
      from_user_id: PLAYER,
      to_user_id: AGENT,
      amount: 400,
    };
    expect(ledgerDisplaySign(row, OWNER)).toBe('-');
    expect(ledgerDisplaySign(row, PLAYER)).toBe('-');
    expect(ledgerDisplaySign(row, AGENT)).toBe('-');
  });
  it('the accepter reads +, a refund back to the player reads +', () => {
    expect(
      ledgerDisplaySign(
        { transaction_type: 'cashout_approved', from_user_id: PLAYER, to_user_id: OWNER },
        OWNER
      )
    ).toBe('+');
    expect(
      ledgerDisplaySign(
        { transaction_type: 'cashout_denied', from_user_id: OWNER, to_user_id: PLAYER },
        OTHER
      )
    ).toBe('+');
  });
  it('claims and removals read - to a third party; a send between two others stays unsigned', () => {
    expect(
      ledgerDisplaySign(
        { transaction_type: 'agent_wallet_claim_back', from_user_id: PLAYER, to_user_id: AGENT },
        OWNER
      )
    ).toBe('-');
    expect(
      ledgerDisplaySign(
        { transaction_type: 'admin_removal', from_user_id: PLAYER, to_user_id: AGENT },
        OWNER
      )
    ).toBe('-');
    expect(
      ledgerDisplaySign(
        { transaction_type: 'agent_wallet_send', from_user_id: AGENT, to_user_id: PLAYER },
        OWNER
      )
    ).toBe('');
    expect(
      ledgerDisplaySign(
        { transaction_type: 'agent_wallet_send', from_user_id: OWNER, to_user_id: PLAYER },
        OWNER
      )
    ).toBe('-');
  });
});

describe('history row titles', () => {
  it('names what happened instead of "Transfer X To X"', () => {
    expect(
      ledgerRowTitle(
        { transaction_type: 'agent_wallet_self_stake', from_user_id: AGENT, to_user_id: AGENT },
        'Probyourmom',
        'Probyourmom',
        OWNER
      )
    ).toBe('Probyourmom Moved Chips To Their Player Wallet');
    expect(
      ledgerRowTitle(
        { transaction_type: 'agent_wallet_send', from_user_id: AGENT, to_user_id: PLAYER },
        'Burls',
        'Woowoo',
        OWNER
      )
    ).toBe('Burls Sent To Woowoo');
    expect(
      ledgerRowTitle(
        { transaction_type: 'agent_wallet_send', from_user_id: OWNER, to_user_id: PLAYER },
        'KingFish',
        'HankFrank',
        OWNER
      )
    ).toBe('Sent To HankFrank');
    expect(
      ledgerRowTitle(
        { transaction_type: 'agent_wallet_send', from_user_id: AGENT, to_user_id: OWNER },
        'Burls',
        'KingFish',
        OWNER
      )
    ).toBe('Received From Burls');
    expect(
      ledgerRowTitle(
        { transaction_type: 'club_bank_send', from_user_id: OWNER, to_user_id: PLAYER },
        'KingFish',
        'Night Owl',
        OTHER
      )
    ).toBe('Club Bank Paid Night Owl');
    expect(
      ledgerRowTitle(
        { transaction_type: 'agent_wallet_claim_back', from_user_id: PLAYER, to_user_id: AGENT },
        'Emo',
        'Burls',
        OWNER
      )
    ).toBe('Burls Claimed Back From Emo');
    expect(
      ledgerRowTitle(
        {
          transaction_type: 'promo_wallet_send',
          from_user_id: OWNER,
          to_user_id: PLAYER,
          metadata: { destination: 'tournament_ticket' },
        },
        'KingFish',
        'Jmarov2',
        OWNER
      )
    ).toBe('Ticket Sent To Jmarov2');
  });
  it('keeps the cash-out titles', () => {
    expect(
      ledgerRowTitle(
        { transaction_type: 'cashout_request_escrow', from_user_id: PLAYER, to_user_id: OWNER },
        'twin2983',
        'KingFish',
        OWNER
      )
    ).toBe('twin2983 Requested A Cash-Out From You');
  });
  it('returns null for kinds it does not narrate', () => {
    expect(ledgerRowTitle({ transaction_type: 'tournament_buyin' }, 'A', null, OWNER)).toBeNull();
  });
});
