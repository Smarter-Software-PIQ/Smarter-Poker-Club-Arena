/**
 * ===========================================================================
 *  ORPHANED CHECKS SCOPE + COMPLETE SMS REGISTRY SCRUB (2026-11-25)
 * ===========================================================================
 *
 * Pins migration 20261125163000_orphaned_checks_scope_and_sms_registry_scrub.sql:
 *   1. fn_ca_orphaned_checks excludes non-Club-Arena product RPC prefixes
 *      (trivia_, pnm_) and per-session RPCs (p_session_id) while retaining
 *      full monitoring of Club Arena conservation/integrity/audit/watch checks.
 *   2. fn_ca_orphaned_checks_watch closes BOTH ca_drift_incidents AND its
 *      financial_alerts mirror (drift_incident:fn_ca_orphaned_checks_watch)
 *      when re-measured at zero orphans.
 *   3. fn_sms_scrub_number scrubs all Commander & marketing SMS registries
 *      (commander_members, commander_home_members, commander_staff,
 *      commander_onboarding_leads, commander_waitlist,
 *      commander_tournament_entries, newsletter_subscribers sms:%) in addition
 *      to the original 7 tables.
 *   4. BEFORE INSERT/UPDATE triggers on all 7 additional SMS registries refuse
 *      to store suppressed numbers again, and fn_sms_filter_suppressed_phones
 *      exposes service_role-only batch suppression filtering.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(__dirname, '..', 'supabase', 'migrations');
const ROOT = '20261125163000_orphaned_checks_scope_and_sms_registry_scrub.sql';
const files = readdirSync(DIR)
  .filter((f) => /^\d{14}_.+\.sql$/.test(f))
  .sort();
const root = readFileSync(join(DIR, ROOT), 'utf8');

function newestDefining(needle: RegExp): { file: string; sql: string } {
  const from = files.indexOf(ROOT);
  let found = { file: ROOT, sql: root };
  for (const f of files.slice(from)) {
    const sql = readFileSync(join(DIR, f), 'utf8');
    if (needle.test(sql)) found = { file: f, sql };
  }
  return found;
}

describe('orphaned checks scope and complete SMS registry scrub', () => {
  it('excludes non-Club-Arena trivia/pnm prefixes and p_session_id RPCs while preserving Club Arena check detection', () => {
    const later = newestDefining(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_ca_orphaned_checks\(\)/
    );
    expect(later.sql).toContain("p.proname !~ '^(trivia_|pnm_)'");
    expect(later.sql).toContain('p_session_id');
    expect(later.sql).toContain("p.proname ~ '(conservation|_check$|_audit$|_watch$|integrity)'");
  });

  it('closes both ca_drift_incidents and its financial_alerts mirror when orphaned checks return zero', () => {
    const later = newestDefining(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_ca_orphaned_checks_watch\(\)/
    );
    expect(later.sql).toContain(
      "WHERE source = 'fn_ca_orphaned_checks_watch' AND resolved_at IS NULL"
    );
    expect(later.sql).toContain(
      "WHERE source = 'drift_incident:fn_ca_orphaned_checks_watch' AND NOT resolved"
    );
  });

  it('scrubs every Commander and marketing SMS registry table on permanent carrier refusal', () => {
    const later = newestDefining(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_sms_scrub_number\(/
    );
    for (const table of [
      'profiles',
      'sp_relaunch_awards',
      'sp_player_announcement_recipients',
      'sp_signup_welcome_back_awards',
      'commander_members',
      'commander_home_members',
      'commander_staff',
      'commander_onboarding_leads',
    ]) {
      expect(later.sql).toContain(`UPDATE public.${table} SET phone = NULL`);
    }
    for (const table of ['commander_waitlist', 'commander_tournament_entries']) {
      expect(later.sql).toContain(`UPDATE public.${table} SET player_phone = NULL`);
    }
    expect(later.sql).toContain('DELETE FROM public.newsletter_subscribers');
  });

  it('keeps drop-suppressed-phone triggers on every Commander and newsletter SMS registry', () => {
    for (const trg of [
      'trg_commander_members_drops_suppressed_phone',
      'trg_commander_home_members_drops_suppressed_phone',
      'trg_commander_staff_drops_suppressed_phone',
      'trg_commander_onboarding_leads_drops_suppressed_phone',
      'trg_commander_waitlist_drops_suppressed_phone',
      'trg_commander_tournament_entries_drops_suppressed_phone',
      'trg_newsletter_subscribers_blocks_suppressed_sms',
    ]) {
      const later = newestDefining(new RegExp(`DROP TRIGGER[^;]*${trg}`));
      expect(later.sql, `${later.file} drops ${trg}`).toMatch(new RegExp(`CREATE TRIGGER ${trg}`));
    }
  });

  it('grants fn_sms_filter_suppressed_phones exclusively to service_role and moves no chips', () => {
    expect(root).toContain(
      'REVOKE ALL ON FUNCTION public.fn_sms_filter_suppressed_phones(text[]) FROM PUBLIC, anon, authenticated;'
    );
    expect(root).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_sms_filter_suppressed_phones(text[]) TO service_role;'
    );
    expect(root).not.toMatch(/INSERT INTO public\.chip_ledger/i);
    expect(root).not.toMatch(
      /UPDATE public\.(club_members|union_wallets|wallets|tournament_escrow)\b/i
    );
  });
});
