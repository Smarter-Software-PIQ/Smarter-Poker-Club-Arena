/**
 * ===========================================================================
 *  NEEDS YOUR ATTENTION ITEMS CLOSE AT THEIR ROOTS (2026-11-06)
 * ===========================================================================
 *
 * Dan, 2026-11-06: "FIX ANY AND ALL OF THESE ISSUES, AND REMOVE THE TWO
 * BLOCKED NUMBERS FROM THE DATABASE ... AFTER YOU HAVE FIXED THEM, GO BACK AND
 * HARDEN THEM TO PREVENT FUTURE REGRESSIONS OR BREAKAGE."
 *
 * Migration 20261106203917 carries five root fixes. This law keeps a later
 * migration from quietly taking one back:
 *   1. a permanently refused carrier code suppresses the number and scrubs it
 *      from profiles, notice lists, pending codes and the receipt itself;
 *   2. the OTP send log carries Twilio's message id;
 *   3. a financial_alerts: / drift_incident: mirror is not a second alert type;
 *   4. the escrow shadow reads the guarantee promo excess return;
 *   5. the cron failure watch records its runs and joins the re-measurement
 *      closer, so a recovered job closes its own incident.
 * Any later migration that redefines one of these functions must keep the
 * clause, or this test names the one it dropped.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(__dirname, '..', 'supabase', 'migrations');
const ROOT = '20261106203917_attention_items_close_at_their_roots.sql';
const files = readdirSync(DIR).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();
const root = readFileSync(join(DIR, ROOT), 'utf8');

/** The newest migration at or after the root fix that names `needle`. */
function newestDefining(needle: RegExp): { file: string; sql: string } {
  const from = files.indexOf(ROOT);
  let found = { file: ROOT, sql: root };
  for (const f of files.slice(from)) {
    const sql = readFileSync(join(DIR, f), 'utf8');
    if (needle.test(sql)) found = { file: f, sql };
  }
  return found;
}

describe('attention items close at their roots', () => {
  it('a permanent carrier refusal suppresses the number and removes it everywhere', () => {
    expect(root).toMatch(/fn_sms_permanent_refusal[\s\S]*30004, 30005, 30006, 21211, 21610, 21614/);
    expect(root).toMatch(/CREATE TRIGGER trg_sms_receipt_suppresses_refused_number\s+BEFORE INSERT OR UPDATE ON public\.sms_delivery_receipts/);
    for (const table of ['profiles', 'sp_relaunch_awards', 'sp_player_announcement_recipients', 'sp_signup_welcome_back_awards']) {
      expect(root).toContain(`UPDATE public.${table} SET phone = NULL`);
    }
    expect(root).toContain('DELETE FROM public.sms_otp_codes');
    expect(root).toContain('NEW.to_number := NULL');
    // Stored as a hash of the digits, never the number itself.
    expect(root).toMatch(/number_hash\s+text PRIMARY KEY CHECK \(number_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  });

  it('notice lists refuse a suppressed number', () => {
    for (const trg of ['trg_relaunch_award_drops_suppressed_phone', 'trg_announcement_recipient_drops_suppressed_phone', 'trg_welcome_back_award_drops_suppressed_phone']) {
      const later = newestDefining(new RegExp(`DROP TRIGGER[^;]*${trg}`));
      expect(later.sql, `${later.file} drops ${trg}`).toMatch(new RegExp(`CREATE TRIGGER ${trg}`));
    }
  });

  it('the OTP send log keeps the message id', () => {
    expect(root).toContain('ALTER TABLE public.sms_otp_send_log ADD COLUMN IF NOT EXISTS twilio_sid text');
  });

  it('a mirror of an alert is not a second alert type', () => {
    const later = newestDefining(/FUNCTION public\.fn_sp_digest_attention\(/);
    expect(later.sql, `${later.file} redefines fn_sp_digest_attention`).toMatch(/drift_incident:\|financial_alerts:/);
  });

  it('the escrow shadow reads the guarantee promo excess return', () => {
    const later = newestDefining(/fn_ca_tournament_escrow_chips/);
    expect(later.sql, `${later.file} redefines the shadow`).toContain('guarantee_promo_excess_return');
  });

  it('a recovered scheduled job closes its own incident by re-measurement', () => {
    const later = newestDefining(/fn_ca_resolve_cleared_incidents/);
    expect(later.sql, `${later.file} redefines the closer`).toMatch(/'fn_ca_cron_failure_watch'/);
    expect(root).toContain("INSERT INTO public.ca_detector_runs (detector, detail)");
  });

  it('nothing in the root fix moves chips', () => {
    expect(root).not.toMatch(/INSERT INTO public\.chip_ledger/i);
    expect(root).not.toMatch(/UPDATE public\.(club_members|union_wallets|wallets|tournament_escrow)\b/i);
  });
});
