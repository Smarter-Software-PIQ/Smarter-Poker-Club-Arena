/**
 * TEST ACCOUNTS LEAVE THE POKER ARENA FOR GOOD, AND MIDWAY HOLDS ONLY ITS OWN
 * (Dan 2026-11-14, binding)
 *
 * "1, REMOVE ANY AND ALL POSTDEPLOY TEST ACCOUNTS ACROSS THE POKER ARENA.
 *  2, REMOVE ANY AND ALL PLAYERS FROM THE MIDWAY UNION THAT SHOULD NOT BE
 *  THERE, KINGFISH, AND SMARTERPOKEROFFICIAL ARE THE ONLY ONES THAT SHOULD BE
 *  THERE."
 *
 * 1,273 reserved post-deploy identities were still 'active' profiles: the
 * cleanup door's retained-ledger-actor branch signed each out of Auth and kept
 * the profile (the chip ledger names it) but never marked it deleted. The root
 * is that branch; the residue leaves through the October 16 deleted-account
 * triggers, never by a hand-written balance or a deleted row.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dir = 'supabase/migrations';
const name = readdirSync(dir).filter((file) =>
  file.endsWith('_test_accounts_and_extra_members_leave_the_poker_arena.sql')
);
if (name.length !== 1) throw new Error('Expected One Test Account Removal Migration');
const sql = readFileSync(`${dir}/${name[0]}`, 'utf8');
const code = sql.replace(/^--[^\n]*$/gm, '');

describe('test accounts leave the poker arena for good', () => {
  it('is one transaction with preimage guards on every function it changes', () => {
    expect(code.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(code.match(/^COMMIT;$/gm)).toHaveLength(1);
    for (const sig of [
      'public.cleanup_reserved_certification_account(uuid)',
      'public.fn_club_cashier_members_page_v3(uuid,integer,uuid,integer)',
      'public.fn_accounting_invoice_party_users(text,uuid)',
    ]) {
      expect(code).toContain(`md5(pg_get_functiondef('${sig}'::regprocedure))`);
    }
    expect(code).toContain('TEST_ACCOUNT_REMOVAL_PREIMAGE_CHANGED');
  });

  it('the cleanup door marks a retired test identity deleted before it answers', () => {
    expect(code).toContain("disposition'', ''retained_ledger_actor''");
    expect(code).toContain(
      "UPDATE public.profiles SET status = ''deleted'', updated_at = now()\\n'"
    );
    expect(code).toContain('TEST_ACCOUNT_DOOR_PATCH_MISMATCH');
    expect(code).toContain('TEST_ACCOUNT_DOOR_INSTALL_MISMATCH');
  });

  it('the residue leaves through the deletion triggers, never by hand', () => {
    expect(code).toContain("SET status = 'deleted', updated_at = now()");
    // No running certificate loses its account: the 162-minute age floor.
    expect(code).toContain("p.created_at < now() - interval '162 minutes'");
    expect(code).toContain("p.email LIKE 'ca-customization-cert-postdeploy-%@example.invalid'");
    expect(code).toContain('NOT COALESCE(p.is_horse, false) AND NOT COALESCE(p.is_admin, false)');
    // A fixture club's owner is left to its own retirement door.
    expect(code).toContain("WHERE c.owner_id = p.id AND c.lifecycle_status = 'active'");
    expect(code).not.toMatch(/DELETE FROM public\.(club_members|profiles)/i);
    expect(code).not.toMatch(
      /SET\s+(chip_balance|promo_balance|agent_wallet_balance|chip_treasury)\s*=/i
    );
    for (const marker of [
      'TEST_ACCOUNT_REMOVAL_COHORT_MOVED',
      'TEST_ACCOUNT_REMOVAL_MEMBERSHIP_REMAINS',
      'TEST_ACCOUNT_REMOVAL_DOWNLINE_REMAINS',
      'TEST_ACCOUNT_REMOVAL_BANK_RETURN_MISMATCH',
    ]) {
      expect(code).toContain(marker);
    }
  });

  it('Midway keeps KingFish and SmarterPokerOfficial, and the rest leave through the staff door', () => {
    expect(code).toContain("c_kingfish constant uuid := '47965354-0e56-43ef-931c-ddaab82af765'");
    expect(code).toContain("c_official constant uuid := '2d1cd6c3-5700-4af9-a271-d4863fdab20d'");
    expect(code).toContain('public.fn_remove_settled_club_member(c_midway, v_target)');
    expect(code).toContain('MIDWAY_MEMBER_REMOVAL_REFUSED');
    expect(code).toContain('MIDWAY_UNEXPECTED_MEMBER_REMAINS');
    // A live certificate's identity is never pushed through the staff door.
    expect(code).toContain('AND NOT public.fn_ca_reserved_certification_identity(m.user_id)');
  });

  it('a live test identity is never listed in another person cashier, nor addressed an invoice', () => {
    expect(code).toContain(
      'where (m.user_id = auth.uid() or not public.fn_ca_reserved_certification_identity(m.user_id))'
    );
    expect(code).toContain("WHERE p.status IS DISTINCT FROM 'deleted'");
    expect(code).toContain(
      'AND NOT public.fn_ca_reserved_certification_identity(p.id) AND p.id IN ('
    );
    expect(code).toContain("AND m.membership_lifecycle_status='active'");
  });
});
