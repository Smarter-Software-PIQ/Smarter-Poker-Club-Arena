/**
 * LAW - A HORSE'S LATE PRIZE RETURNS TO ITS OLD CLUB'S BANK BY ITSELF
 *
 * Owner order 2026-11-03 05:27 CT: late prizes return to the bank by
 * themselves. A credit landing on a horse membership the club split departed
 * moves to that club's bank in the same transaction, through a declared Club
 * Bank claim. It can never cost a player a payment: any failure rolls back
 * only the return, leaves the credit on the record and files a warning.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const NAME = '20261103113029_horse_late_prizes_return_to_the_old_club_bank.sql';
const TRIGGER = '20261103114208_horse_late_prize_return_trigger_installs.sql';
const sql = readFileSync(join(__dirname, '..', 'supabase', 'migrations', NAME), 'utf8');
const trigger = readFileSync(join(__dirname, '..', 'supabase', 'migrations', TRIGGER), 'utf8');

describe('a horse late prize returns to its old club bank', () => {
  it('fires only when a departed record balance goes up, and installs in the daily window', () => {
    expect(trigger).toContain('-- @install-window: daily-maintenance');
    expect(trigger).toContain('AFTER UPDATE OF chip_balance ON public.club_members');
    expect(trigger).toContain("WHEN (NEW.membership_lifecycle_status = 'departed' AND NEW.chip_balance > OLD.chip_balance)");
    expect(trigger).toContain("VALUES ('club_members', 'zzzz_horse_split_late_credit_returns_to_bank'");
    expect(sql).not.toContain('CREATE TRIGGER');
  });

  it('acts only on records the split departed, outside the horse assigned club', () => {
    expect(sql).toContain("d.kind = 'departed'");
    expect(sql).toContain('fn_ca_horse_assigned_club(NEW.user_id) IS NOT DISTINCT FROM NEW.club_id THEN\n    RETURN NULL;');
  });

  it('moves the money through a declared Club Bank claim with a fresh op id and a receipt', () => {
    expect(sql).toContain("fn_ca_declare_ledger('club_bank_claim', 'club_treasury', NEW.club_id");
    expect(sql).toContain("'club_bank_claim',\n            'Horse Club Split: Late Prize Returned To The Club Bank");
    expect(sql).toContain('INSERT INTO public.ca_horse_club_split_late_returns');
    expect(sql.indexOf("('fn_ca_horse_split_return_late_credit', 'approved'")).toBeLessThan(
      sql.indexOf('CREATE FUNCTION public.fn_ca_horse_split_return_late_credit'));
  });

  it('can never block the payment: own subtransaction, short lock wait, caller ledger restored', () => {
    expect(sql).toContain("set_config('lock_timeout', '200ms', true)");
    expect(sql).toMatch(/EXCEPTION WHEN OTHERS THEN\n\s+-- Everything above rolled back/);
    expect(sql).toContain("'horse_split.late_return_deferred'");
    expect(sql).toContain('PERFORM set_config(c_keys[i], v_saved[i], true);');
    expect(sql).toContain("PERFORM set_config('lock_timeout', v_lock_timeout, true);");
  });
});
