import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Dan, 2026-11-05: five Free Buy tickets per player per day across Club
// Arena; a ticket covers only the first entry into a Free Buy event, one per
// player per event; rebuys and add-ons are paid from the wallet; issuing a
// ticket moves no chips.
const sql = readFileSync(
  'supabase/migrations/20261105223835_five_free_buy_tickets_a_day_for_every_player.sql',
  'utf8'
);

describe('five Free Buy tickets a day for every player', () => {
  it('the allotment is five, per player and gaming day, never per club or device', () => {
    expect(sql).toContain('allotment smallint NOT NULL DEFAULT 5 CHECK (allotment = 5)');
    expect(sql).toContain('PRIMARY KEY (user_id, gaming_day)');
    expect(sql).toContain('used >= 0 AND used <= allotment');
  });

  it('one live ticket per player and event; a replay never redeems twice', () => {
    expect(sql).toContain(
      'ON smarter_private.free_buy_ticket_redemptions (user_id, tournament_id) WHERE returned_at IS NULL'
    );
    expect(sql).toContain('registration_id uuid PRIMARY KEY');
  });

  it('both registration doors (players and horses) redeem before the promo head funds the entry', () => {
    expect(sql).toContain(
      'fn_register_for_tournament_before_atomic_capacity_20260907(uuid,boolean)'
    );
    expect(sql).toContain('fn_register_horse_for_tournament_before_maintenance_gate(uuid,uuid)');
    expect(sql).toContain(
      "'PERFORM smarter_private.free_buy_ticket_redeem(p_tournament_id,v_player_id);'"
    );
  });

  it('an unplayed returned entry gives its ticket back; rebuys and add-ons are never touched', () => {
    expect(sql).toContain(
      'IF p_return THEN PERFORM smarter_private.free_buy_ticket_restore(p_registration_id); END IF;'
    );
    expect(sql).not.toContain('fn_ca_process_tournament_chip_purchase_money_v1(uuid');
  });

  it('the gaming day turns at the end of the daily window, so the 00:30 Midnight Free Buy is the day before', () => {
    expect(sql).toContain(
      "smarter_private.free_buy_gaming_day('2026-11-06 06:30:00+00') <> date '2026-11-05'"
    );
  });

  it('a ticket moves no chips by itself', () => {
    const body = sql.slice(
      sql.indexOf('CREATE FUNCTION smarter_private.free_buy_ticket_redeem'),
      sql.indexOf('CREATE FUNCTION smarter_private.free_buy_ticket_restore')
    );
    expect(body).not.toMatch(/chip_ledger|union_wallets|club_members|chip_balance/);
  });
});
