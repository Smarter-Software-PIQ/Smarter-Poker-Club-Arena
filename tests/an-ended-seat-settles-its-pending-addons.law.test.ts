/**
 * AN ENDED SEAT SETTLES ITS PENDING ADD-ONS (2026-11-19).
 *
 * 49 Lightning feeder rebuys (19,600.00 debited from horse wallets) sat in
 * table_pending_addons unresolved, the oldest for two weeks. A pending add-on
 * had two consumers, both driven by the table's own engine, and a Lightning
 * anchor asks the resolver only while a seated stack reads 0. Once a second
 * door funded the seat, or the resolver missed its window, nothing on the
 * seat-exit path ever looked at the row again: the cash-out moved the stack and
 * left the debit floating for ever.
 *
 * The cause is pinned where the seat ends: the newest body of the function the
 * ended-occupancy triggers run must hand every unresolved add-on of the
 * player's last chair to resolve_pending_addon (the vacated-seat refund, keyed
 * addon_refund:<id>), must not skip locked rows (a resolver that rolls back
 * would leave the row stranded behind a committed exit), must not swallow the
 * refund's failure, and must leave envelope-frozen rows to the post-commit
 * processor. The triggers it rides must still fire on every occupancy end.
 */
import { describe, expect, it } from 'vitest';
import { migrationCorpus } from './helpers/migrationCorpus';

const DEFINES =
  /create\s+or\s+replace\s+function\s+smarter_private\.fn_record_ended_seat_occupancy\s*\(/i;

function newest(): { name: string; body: string } {
  const last = migrationCorpus()
    .filter(({ sql }) => DEFINES.test(sql))
    .pop();
  expect(last).toBeDefined();
  const sql = last!.sql;
  const start = sql.search(DEFINES);
  const open = sql.indexOf('$function$', start);
  return { name: last!.name, body: sql.slice(start, sql.indexOf('$function$', open + 1)) };
}

const strip = (s: string) => s.replace(/--[^\n]*/g, '');

describe('an ended seat settles its pending add-ons', () => {
  it('resolves every unresolved add-on of the ending seat through the platform resolver', () => {
    const body = strip(newest().body);
    expect(body).toMatch(/FROM public\.table_pending_addons a\s+WHERE a\.table_id = OLD\.table_id\s+AND a\.user_id = OLD\.user_id\s+AND a\.resolved_at IS NULL/);
    expect(body).toContain('FROM public.resolve_pending_addon(v_addon.id, NULL::numeric)');
  });

  it('settles only when the player has no other open chair at that table', () => {
    const body = strip(newest().body);
    const guard = body.indexOf('IF NOT EXISTS (SELECT 1 FROM public.table_seats s');
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(body.indexOf('public.resolve_pending_addon('));
    expect(body).toContain('AND s.left_at IS NULL');
  });

  it('waits for a row another transaction holds and never swallows the refund failure', () => {
    const body = strip(newest().body);
    expect(body).not.toMatch(/SKIP\s+LOCKED/i);
    expect(body).not.toMatch(/NOWAIT/i);
    expect(body).not.toMatch(/EXCEPTION\s+WHEN/i);
    expect(body).toMatch(/ORDER BY a\.created_at, a\.id\s+FOR UPDATE/);
  });

  it('leaves an add-on frozen in an open hand envelope to the post-commit processor', () => {
    const body = strip(newest().body);
    expect(body).toContain('AND c.post_commit_completed_at IS NULL');
    expect(body).toContain("(c.post_commit_payload #> '{pending_addons,ids}') ? v_addon.id::text");
  });

  it('settles before the zero-joined_at early return and keeps the occupancy record', () => {
    const body = strip(newest().body);
    const settle = body.indexOf('public.resolve_pending_addon(');
    const joined = body.indexOf('IF OLD.joined_at IS NULL THEN');
    expect(joined).toBeGreaterThan(settle);
    expect(body).toContain('INSERT INTO smarter_private.cash_seat_occupancy_history');
    expect(body).toContain('t.tournament_id IS NOT NULL');
  });

  it('rides triggers that still fire on every occupancy end', () => {
    const triggers = migrationCorpus()
      .filter(({ sql }) => /CREATE TRIGGER zz_record_ended_seat_occupancy/.test(sql))
      .pop();
    expect(triggers).toBeDefined();
    expect(triggers!.sql).toMatch(/AFTER UPDATE OF user_id, occupancy_id, left_at ON public\.table_seats/);
    expect(triggers!.sql).toMatch(/OLD\.left_at IS NULL AND NEW\.left_at IS NOT NULL/);
    expect(triggers!.sql).toMatch(/CREATE TRIGGER zz_record_deleted_seat_occupancy\s+AFTER DELETE ON public\.table_seats/);
  });

  // 2026-11-19: the first version pinned 44 probed ids and was refused
  // BOARD_MOVED when one probed player sat back down. Each row now proves
  // itself; any row failing its evidence still aborts the whole settlement.
  it('the settlement migration proves each row on its own evidence and aborts whole on any failure', () => {
    const { name } = newest();
    const sql = migrationCorpus().find((m) => m.name === name)!.sql;
    const settle = sql.slice(sql.indexOf('DO $settle$'));
    expect(settle).not.toMatch(/v_ready <> \d+/);
    expect(settle).toContain("w.key = 'addon_refund:' || r.id::text");
    expect(settle).toContain('ADDON_ALREADY_SETTLED');
    expect(settle).toContain('ADDON_NEVER_DEBITED');
    expect(settle).toContain('ADDON_SETTLEMENT_MISMATCH');
    expect(settle).toContain('ADDON_REFUND_KEY_MISSING');
    expect(settle).not.toMatch(/EXCEPTION\s+WHEN/);
  });
});
