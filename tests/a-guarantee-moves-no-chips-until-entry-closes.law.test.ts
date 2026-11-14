/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  NO OVERLAY CHIPS BEFORE THE ENTRY PERIOD HAS ENDED
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner law, Dan, 10:04 Chicago, 2026-11-14: "NO CHIPS ARE EVER EVER EVER
 * SUPPOSED TO GO TO ANY TOURNAMENT 'FOR OVERLAYS' UNTIL THE REGISTRATION /
 * REBUY / ADD ON PERIOD HAS OFFICALLY ENDED... MAKE SURE THAT IS THE LAW, AND
 * ITS FULLY BUILT AND IMPLEMENTED FOR ANY AND ALL EVENTS WITH A GUARANTEE".
 *
 * WHY. A rebuy event whose rebuy levels outlast its late-registration levels
 * (the 25 Chip Bankroll Builder: 9 and 12, no add-on) was finalized, and its
 * guarantee funded, at level 9 with three rebuy levels still ahead; a
 * satellite's guaranteed seats were funded at its start; and nothing below the
 * callers refused either (20261114161610 header).
 *
 * WHAT THIS PINS, wherever the functions are defined next:
 *   - one answer, fn_ca_guarantee_entry_period_ended: an add-on event ends at
 *     the actual add-on end; any other running event when late registration
 *     and the rebuy window are both closed;
 *   - the entry-window close keeps the pool open while the rebuy window is;
 *   - fn_apply_prize_guarantee asks before it funds anything;
 *   - the satellite start funds seats only when it has no entry period after
 *     the start;
 *   - chip_ledger refuses bank or promo chips into a prize liability before
 *     the period ends, in the daily maintenance window migration.
 * Behaviour is proved on isolated PostgreSQL by
 * tests/unit/aGuaranteeWaitsForEntryClose.pg.test.ts. Nothing here reads
 * horse identity: the law is the same for every entrant.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const flat = (s: string) => s.replace(/\s+/g, ' ');
const MIGRATIONS = join(root, 'supabase/migrations');
const files = readdirSync(MIGRATIONS)
  .filter((f) => /^\d{14}_.+\.sql$/.test(f))
  .sort();

/** The body of the newest migration that (re)defines a function, from its CREATE to the next CREATE. */
function latestDefinition(name: string): { file: string; body: string } {
  const pattern = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(`, 'i');
  for (const file of [...files].reverse()) {
    const text = readFileSync(join(MIGRATIONS, file), 'utf8');
    const at = text.search(pattern);
    if (at < 0) continue;
    const rest = text.slice(at + 10);
    const next = rest.search(/CREATE OR REPLACE FUNCTION /i);
    return { file, body: next < 0 ? rest : rest.slice(0, next) };
  }
  throw new Error(`no migration defines public.${name}`);
}

describe('no overlay chips before registration, rebuys and the add-on have ended', () => {
  it('has one answer for when the entry period has ended', () => {
    const { body } = latestDefinition('fn_ca_guarantee_entry_period_ended');
    const s = flat(body);
    expect(s).toContain(
      'IF COALESCE(t.add_on_available, false) THEN RETURN t.addon_period_ends_at IS NOT NULL AND clock_timestamp() >= t.addon_period_ends_at;'
    );
    expect(s).toContain(
      'IF public.fn_tournament_late_registration_open(t.id) THEN RETURN false; END IF;'
    );
    expect(s).toContain(
      "IF COALESCE((public.fn_ca_tournament_rebuy_window(t.id)->>'open')::boolean, false) THEN RETURN false;"
    );
    expect(s).toContain("IF upper(COALESCE(t.status, '')) <> 'RUNNING' THEN RETURN false; END IF;");
    expect(s).not.toMatch(/is_horse/i);
  });

  it('keeps the pool open while the rebuy window is open', () => {
    const { body } = latestDefinition('fn_close_tournament_entry_window');
    const s = flat(body);
    const defer = s.indexOf("'reason','rebuy_window_open'");
    const finalize = s.lastIndexOf('RETURN public.fn_finalize_tournament_entry_pool_locked(');
    expect(defer).toBeGreaterThan(0);
    expect(finalize).toBeGreaterThan(defer);
    expect(s).toContain(
      "AND COALESCE((public.fn_ca_tournament_rebuy_window(p_tournament_id)->>'open')::boolean,false) THEN"
    );
    expect(s).toContain("'entry_closed',false");
  });

  it('asks before the guarantee authority funds anything', () => {
    const { body } = latestDefinition('fn_apply_prize_guarantee');
    const s = flat(body);
    const ask = s.indexOf('NOT public.fn_ca_guarantee_entry_period_ended(p_tournament_id)');
    expect(ask).toBeGreaterThan(0);
    for (const funder of [
      'fn_ca_return_excess_start_overlay_locked(',
      'fn_ca_fund_satellite_seats_at_close_locked(',
      'fn_ca_fund_free_buy_at_cutoff_locked(',
      'fn_ca_fund_union_guarantee_promo_locked(',
      'fn_ca_apply_prize_guarantee_core(',
    ]) {
      expect(s.indexOf(funder), funder).toBeGreaterThan(ask);
    }
    expect(s).toContain("'reason','entry_period_open'");
    // Only the two settlement authorities, which close a finished event, pass.
    expect(s).toContain(
      "NOT IN ('engine.fn_settle_tournament_places', 'engine.fn_settle_tournament_final_table_deal')"
    );
  });

  it('funds a satellite start only when no entry period follows the start', () => {
    const { body } = latestDefinition('fn_ca_fund_overlay_on_lock');
    const s = flat(body);
    const defer = s.indexOf('IF COALESCE(NEW.late_reg_levels, NEW.rebuy_levels, 0) > 0');
    const insert = s.indexOf('INSERT INTO public.chip_ledger');
    expect(defer).toBeGreaterThan(0);
    expect(insert).toBeGreaterThan(defer);
    expect(s).toContain(
      'OR COALESCE(NEW.is_rebuy, false) OR COALESCE(NEW.is_reentry, false) OR COALESCE(NEW.add_on_available, false) THEN RETURN NEW;'
    );
    const close = flat(latestDefinition('fn_ca_fund_satellite_seats_at_close_locked').body);
    expect(close).toContain(
      'IF NOT public.fn_ca_guarantee_entry_period_ended(p_tournament_id) THEN RAISE EXCEPTION'
    );
  });

  it('refuses the chips on the ledger itself, installed in the daily maintenance window', () => {
    const guard = flat(latestDefinition('fn_ca_overlay_waits_for_entry_close').body);
    expect(guard).toContain(
      'IF public.fn_ca_guarantee_entry_period_ended(v_tid) THEN RETURN NEW; END IF;'
    );
    expect(guard).toContain("RAISE EXCEPTION 'GUARANTEE_CHIPS_BEFORE_ENTRY_CLOSE:");
    // The only standing exemption: a Free Buy entry's bounty part booked at sign-up.
    expect(guard.match(/LIKE '/g)).toHaveLength(1);
    expect(guard).toContain("LIKE 'tourney:%:promo_head:%'");

    const trigger = read(
      'supabase/migrations/20261114161611_the_ledger_refuses_overlay_chips_before_entry_close.sql'
    );
    expect(trigger).toMatch(/^-- @install-window: daily-maintenance$/m);
    expect(trigger).toMatch(/^-- @locks: public\.chip_ledger$/m);
    expect(flat(trigger)).toContain(
      "CREATE TRIGGER aab_ca_overlay_waits_for_entry_close BEFORE INSERT ON public.chip_ledger FOR EACH ROW WHEN (NEW.to_type = 'prize_liability' AND NEW.category IN ('overlay', 'promo_send') AND NEW.from_type IN ('union_bank', 'union_wallet', 'club_treasury')) EXECUTE FUNCTION public.fn_ca_overlay_waits_for_entry_close();"
    );
    expect(flat(trigger)).toContain(
      "INSERT INTO public.ca_declared_money_triggers (table_name, trigger_name, note) VALUES ('chip_ledger', 'aab_ca_overlay_waits_for_entry_close',"
    );
    // No later migration drops or disables it.
    for (const file of files.filter((f) => f > '20261114161611')) {
      const text = readFileSync(join(MIGRATIONS, file), 'utf8');
      expect(text, file).not.toMatch(/DROP TRIGGER[^;]*aab_ca_overlay_waits_for_entry_close/i);
      expect(text, file).not.toMatch(/DISABLE TRIGGER[^;]*aab_ca_overlay_waits_for_entry_close/i);
    }
  });
});
