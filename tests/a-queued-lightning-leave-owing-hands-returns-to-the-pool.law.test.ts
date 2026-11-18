/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A QUEUED LIGHTNING LEAVE THAT OWES HANDS RETURNS TO THE POOL (#10740)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner rule, Dan, 2026-11-06 (Hit And Run): a player in profit who leaves
 * before the hand count is played "WILL BE BLINDED OFF FOR THE REMAINING
 * HANDS". On 2026-11-13 fifteen Lightning seats, the oldest for 60 hours, sat
 * out and pending with 7-10 hands owed and none dealt: a leave queued behind a
 * live Lightning hand became sat out and pending, the count then refused the
 * cash-out, and the pool never deals a sat-out, pending seat.
 *
 * WHAT THIS PINS. The engine-only door that turns such a leave into the blind
 * off (asking the leave door itself what is owed, refusing a forced exit, a
 * live hand or nothing owed); the engine calling it from the held-leave release
 * at an anchor; the anchor judging the count at the database's stack; and the
 * native proof that reproduces the strand and shows it complete. Horses are
 * players: nothing here reads horse identity.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const MIGRATION =
  'supabase/migrations/20261113225904_a_lightning_leave_that_owes_hands_returns_the_seat_to_the_po.sql';
const sql = read(MIGRATION);
const flat = (s: string) => s.replace(/\s+/g, ' ');
const BASE = read('server/src/engine/ServerTableEngineBase.ts');
const SEATING = read('server/src/engine/ServerTableEngineSeating.ts');

describe('the door', () => {
  it('is engine-only, refuses while frozen and writes nothing for a forced, live, stale or unowed leave', () => {
    const s = flat(sql);
    expect(s).toContain('IF NOT coalesce(public.fn_caller_is_engine(), false) THEN');
    expect(s).toContain(
      "IF public.fn_platform_frozen() THEN RETURN jsonb_build_object('returned', false, 'reason', 'platform_frozen');"
    );
    expect(s).toContain("IF v_mode IS DISTINCT FROM 'voluntary' THEN");
    expect(s).toContain(
      'IF public.fn_lightning_player_live_hand(p_user_id, v_cluster) IS NOT NULL THEN'
    );
    expect(s).toContain("public.fn_cash_leave_check(p_user_id, p_table_id) ->> 'hands_remaining'");
    expect(s).toContain(
      "IF v_owed <= 0 THEN RETURN jsonb_build_object('returned', false, 'reason', 'not_owed');"
    );
    // Every refusal returns before the first write.
    expect(sql.indexOf("'not_owed'")).toBeLessThan(
      sql.indexOf('DELETE FROM public.seat_departure_requests')
    );
  });

  it('withdraws only the voluntary request and moves no chips', () => {
    const s = flat(sql);
    expect(s).toContain("AND d.leave_mode = 'voluntary';");
    expect(s).toContain("SET leave_pending = false, is_sitting_out = false, status = 'active'");
    expect(s).toContain('SET hr_blind_off = true');
    expect(sql).not.toMatch(/\bSET[^;]*\bstack\s*=/i);
    expect(sql).not.toMatch(/left_at\s*=/i);
    expect(sql).not.toMatch(/is_horse/i);
    expect(s).toContain('TO service_role');
    expect(s).toContain('FROM PUBLIC, anon, authenticated');
  });
});

describe('the engine', () => {
  it('returns a held, pending anchor leave that still owes hands, from the release pass', () => {
    const release = BASE.slice(BASE.indexOf('protected async releaseLeavesHeldByClock()'));
    expect(
      release.indexOf('await this.returnOwedLightningLeaveToPool(userId, seated);')
    ).toBeGreaterThan(0);
    const door = BASE.slice(BASE.indexOf('protected async returnOwedLightningLeaveToPool('));
    expect(door).toContain('seated.leave_pending !== true');
    expect(door).toContain('if (isMaintenanceFrozen()) return false;');
    expect(door).toContain('this.disconnectEngine.sitBack(this.tableId, userId);');
    expect(door).toContain('this.holdLockedLeave(userId, answer.handsRemaining);');
  });

  it('judges an anchor count at the database stack everywhere the leave is decided', () => {
    expect(BASE).toContain(
      'protected handCountStack(userId: string, rosterStack: number): number {'
    );
    expect(SEATING).toContain('this.handCountStack(userId, player.stack)');
    expect(BASE).toContain('this.handCountStack(userId, seated.stack)');
    expect(BASE).toContain('this.handCountStack(p.user_id, p.stack)');
  });
});

describe('the native proof', () => {
  it('runs in CI and reproduces the strand before, completion after', () => {
    const wf = read('.github/workflows/lightning-hand-counts-every-player-dealt-in.yml');
    expect(wf).toContain('node scripts/qualify-lightning-owed-leave.mjs');
    expect(wf).toContain(MIGRATION);
    const harness = read('scripts/qualify-lightning-owed-leave.mjs');
    expect(harness).toContain(MIGRATION);
    expect(harness).toContain('Q1 STRAND REPRODUCED');
    expect(harness).toContain('Q1 COMPLETES');
    const behavior = read('scripts/qualification/lightning-owed-leave/behavior.sql');
    for (const label of [
      'Q2 forced refused',
      'Q3 not owed refused',
      'Q4 in hand refused',
      'Q5 idempotent',
      'Q6 stale occupancy',
    ])
      expect(behavior).toContain(label);
  });
});
