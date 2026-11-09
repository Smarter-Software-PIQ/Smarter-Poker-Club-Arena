/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A LIGHTNING BLIND OFF ALWAYS COMPLETES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner rule, Dan, 2026-11-06 (Hit And Run): a player in profit who leaves
 * before the hand count is played "WILL BE BLINDED OFF FOR THE REMAINING
 * HANDS". The seat keeps being dealt, is checked or folded on its turn, and
 * is cashed out when the count completes or the profit is gone.
 *
 * WHY (bug report BUG-7C1347FF, 2026-11-09). In a Lightning pool the owed
 * hands could never be dealt once the player stopped or disconnected: the
 * stop door closed the pool session with hands owed, the matcher refused a
 * disconnected or stop-marked session, the reaper exited it, and the anchor
 * engine's hand-count mirror never learned that the pool had played the hands.
 * The count froze at 3 of 10, the leave was refused for ever and the stack
 * stayed on the seat.
 *
 * WHAT THIS PINS. The four database doors ask the one question
 * (fn_lightning_hands_owed, which asks fn_cash_leave_check) before a stop or
 * a disconnect may end or withhold a session; responsible gaming still ends
 * it and waives the hands on the record; the anchor engine reads a held
 * seat's count fresh before deciding; and the native proof that reproduces
 * the strand on the installed production images and shows it complete is run
 * by CI. Horses are players: none of it reads horse identity.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const MIGRATION = 'supabase/migrations/20261109224717_a_lightning_blind_off_always_completes.sql';
const sql = read(MIGRATION);
const flat = (s: string) => s.replace(/\s+/g, ' ');

describe('a stop or a disconnect can never strand owed hands', () => {
  it('the stop door defers while the voluntary door would refuse the leave', () => {
    const s = flat(sql);
    expect(s).toContain(
      'v_owed := public.fn_lightning_hands_owed(s.id, false); IF v_owed > 0 THEN'
    );
    expect(s).toContain("'deferred', 'HANDS_OWED', 'hands_owed', v_owed");
    // The deferral returns before the mark and before the exit.
    expect(sql.indexOf("'deferred', 'HANDS_OWED'")).toBeLessThan(
      sql.lastIndexOf('SET stop_requested_at = v_now, updated_at = v_now')
    );
  });

  it('one authority decides what is owed: the leave door itself', () => {
    const helper = sql.slice(
      sql.indexOf('CREATE FUNCTION public.fn_lightning_hands_owed'),
      sql.indexOf('REVOKE ALL ON FUNCTION public.fn_lightning_hands_owed')
    );
    expect(helper).toContain(
      "public.fn_cash_leave_check(ps.player_id, ts.table_id) ->> 'hands_remaining'"
    );
    expect(helper).toContain('cs.hr_blind_off');
    expect(helper).toContain('ts.left_at IS NULL');
  });

  it('the matcher deals a confirmed blind off that is disconnected or stop-marked', () => {
    const s = flat(sql);
    expect(s).toContain(
      "AND public.fn_lightning_hands_owed(f.pool_session_id, true) = 0 THEN 'DISCONNECTED'"
    );
    expect(s).toContain(
      "AND public.fn_lightning_hands_owed(f.pool_session_id, true) = 0 THEN 'STOP_REQUESTED'"
    );
    expect(s).toContain(
      "f.pool_state NOT IN ('active', 'disconnected') THEN 'POOL_SESSION_NOT_ACTIVE'"
    );
  });

  it('the reaper keeps such a session, and responsible gaming waives instead of stranding', () => {
    const s = flat(sql);
    expect(s).toContain('IF v_owed > 0 AND NOT coalesce(s.rg_refused, false) THEN');
    expect(s).toContain("'reason', 'blind_off_hands_owed', 'hands_owed', v_owed); CONTINUE;");
    expect(s).toContain('PERFORM public.fn_lightning_blind_off_waive(s.player_id,');
    const waive = sql.slice(
      sql.indexOf('CREATE FUNCTION public.fn_lightning_blind_off_waive'),
      sql.indexOf('REVOKE ALL ON FUNCTION public.fn_lightning_blind_off_waive')
    );
    expect(waive).toContain('SET hr_completed = true');
    expect(waive).toContain("'blind_off_waived'");
    // A waiver moves no chips: the seat leaves through the ordinary cash-out.
    expect(waive).not.toMatch(/chip_balance|table_seats\s+SET|fn_credit|atomic_/i);
  });

  it('the confirmation makes sure the pool session exists', () => {
    const fn = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION public.fn_cash_session_set_blind_off')
    );
    expect(fn).toContain('public.fn_lightning_pool_enter(v_seat.id, v_now)');
    expect(fn).toContain('SET stop_requested_at = NULL');
    expect(fn).toContain('NOT public.fn_platform_frozen()');
  });

  it('the migration refuses a changed installed image and is one transaction', () => {
    expect(sql).toContain("RAISE EXCEPTION 'LIGHTNING_BLIND_OFF_SOURCE_CHANGED'");
    expect(sql).toContain("RAISE EXCEPTION 'LIGHTNING_BLIND_OFF_ANCHOR_CHANGED % %'");
    expect(sql.match(/^BEGIN;$/gm)?.length).toBe(1);
    expect(sql.match(/^COMMIT;$/gm)?.length).toBe(1);
    expect(sql).not.toMatch(/is_horse|is_bot/i);
  });

  it('no later migration redefines a patched door without carrying the rule', () => {
    const later = readdirSync(join(root, 'supabase/migrations'))
      .filter((f) => f.endsWith('.sql') && f > '20261109224717')
      .sort();
    for (const name of [
      'fn_lightning_stop_playing',
      'fn_lightning_reap_expired_disconnects',
      'fn_lightning_player_legality',
    ]) {
      for (const f of later) {
        const body = read(`supabase/migrations/${f}`);
        if (new RegExp(`CREATE (OR REPLACE )?FUNCTION public\\.${name}\\s*\\(`, 'i').test(body))
          expect(body, `${f} redefines ${name}`).toContain('fn_lightning_hands_owed');
      }
    }
  });

  it('the anchor engine reads a held seat fresh before it decides', () => {
    const base = read('server/src/engine/ServerTableEngineBase.ts');
    const start = base.indexOf('protected async releaseLeavesHeldByClock()');
    const release = base.slice(start, base.indexOf('protected onLeaveRefusedAtSettlement', start));
    const refresh = release.indexOf('await this.chipContinuity.evaluate(');
    expect(refresh).toBeGreaterThan(release.indexOf('if (this.isLightningAnchorNow()) {'));
    expect(refresh).toBeLessThan(
      release.indexOf('this.chipContinuity.leaveLock(userId, seated.stack).locked')
    );
  });

  it('the native proof runs in CI on the installed production images', () => {
    expect(read('.github/workflows/ci.yml')).toContain(
      'node scripts/qualify-lightning-blind-off.mjs'
    );
    const harness = read('scripts/qualify-lightning-blind-off.mjs');
    expect(harness).toContain(MIGRATION);
    for (const s of ['S1', 'S2', 'S4', 'S6']) {
      expect(read('scripts/qualification/lightning-blind-off/behavior.sql')).toContain(
        `${s} STRAND REPRODUCED`
      );
    }
    expect(harness).toContain('STRAND REPRODUCED');
    expect(harness).toContain('COMPLETES');
    const manifest = JSON.parse(read('scripts/qualification/lightning-blind-off/manifest.json'));
    for (const sig of [
      'public.fn_lightning_stop_playing(uuid)',
      'public.fn_lightning_reap_expired_disconnects(uuid,timestamptz,integer)',
      'public.fn_lightning_player_legality(uuid,timestamptz,uuid[],jsonb)',
      'public.fn_cash_session_set_blind_off(uuid,uuid,boolean)',
    ]) {
      // The fixture's images are the ones the migration's own guard names.
      expect(sql).toContain(manifest.installed[sig]);
    }
  });
});
