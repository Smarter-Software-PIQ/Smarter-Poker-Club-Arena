/**
 * PROMO SIGNUP CHIPS ARE GRANTED AT SIGNUP THROUGH THE PROMOTION ONLY (Dan 2026-11-23).
 *
 * Pins migration 20261123231830:
 *   1. public.fn_sp_grant_promo_signup_chips(uuid, text) is service_role only,
 *      registered in ca_money_rpc_registry above its CREATE, ensures zero-chip
 *      KINGS CLUB (25450) membership under fn_club_membership_lock, records the
 *      device UUID in anti_cheat_device_sightings, reserves identity via
 *      fn_ca_signup_promo_claim_identity, disburses 25 chips via sanctioned
 *      fn_promo_disburse with deterministic op_id md5('signup-welcome-back:' || uid),
 *      and writes the single authoritative receipt in sp_signup_welcome_back_awards.
 *   2. Blanket organic 25-chip minting in fn_sp_signup_welcome_back_run and
 *      smarter_private.weekly_kings_welcome_due is retired while keeping play
 *      nudges and weekly close kings_welcome_receipt progression intact.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const MIGRATION_PATH = resolve(
  ROOT,
  'supabase/migrations/20261123231830_signup_promo_chips_granted_at_signup_through_promotion_only.sql'
);

describe('signup promo chips are granted at signup through the promotion only', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf8');

  it('registers fn_sp_grant_promo_signup_chips in ca_money_rpc_registry before creating it', () => {
    const regIdx = sql.indexOf('INSERT INTO public.ca_money_rpc_registry');
    const createIdx = sql.indexOf(
      'CREATE OR REPLACE FUNCTION public.fn_sp_grant_promo_signup_chips('
    );
    expect(regIdx).toBeGreaterThan(-1);
    expect(createIdx).toBeGreaterThan(regIdx);
  });

  it('restricts fn_sp_grant_promo_signup_chips to service_role only and checks fn_caller_is_engine()', () => {
    expect(sql).toContain('IF NOT public.fn_caller_is_engine() THEN');
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.fn_sp_grant_promo_signup_chips(uuid, text) FROM PUBLIC, anon, authenticated;'
    );
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_sp_grant_promo_signup_chips(uuid, text) TO service_role;'
    );
  });

  it('enforces single-guard receipt, verified-phone + device identity reservation, and sanctioned fn_promo_disburse in one subtransaction', () => {
    expect(sql).toContain("md5('signup-welcome-back:' || p_user_id::text)::uuid");
    const claimIdx = sql.indexOf(
      'v_identity := public.fn_ca_signup_promo_claim_identity(p_user_id, v_op);'
    );
    const disburseIdx = sql.indexOf('v_payment := public.fn_promo_disburse(');
    const receiptIdx = sql.indexOf('INSERT INTO public.sp_signup_welcome_back_awards AS a');
    expect(claimIdx).toBeGreaterThan(-1);
    expect(disburseIdx).toBeGreaterThan(claimIdx);
    expect(receiptIdx).toBeGreaterThan(disburseIdx);
  });

  it('retires blanket organic 25-chip minting from both the hourly runner and weekly KINGS close while preserving weekly book receipts', () => {
    const hourlyStart = sql.indexOf(
      'CREATE OR REPLACE FUNCTION public.fn_sp_signup_welcome_back_run('
    );
    const weeklyStart = sql.indexOf(
      'CREATE OR REPLACE FUNCTION smarter_private.weekly_kings_welcome_due()'
    );
    expect(hourlyStart).toBeGreaterThan(-1);
    expect(weeklyStart).toBeGreaterThan(hourlyStart);

    const hourlyBody = sql.slice(hourlyStart, weeklyStart);
    const weeklyBody = sql.slice(weeklyStart);

    expect(hourlyBody).not.toContain('fn_promo_disburse');
    expect(hourlyBody).toContain("'mode', 'promo_signup_only'");
    expect(weeklyBody).not.toContain('fn_promo_disburse');
    expect(weeklyBody).toContain("'stage', 'weekly_kings_welcome_complete'");
    expect(weeklyBody).toContain("'paid_players', 0");
  });
});
