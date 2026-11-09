/**
 * AN UNUSED SPIN OR SIT & GO BOARD IS PARKED AT 3 AM, NOT RECYCLED (2026-11-08).
 *
 * The 3:00 AM close (owner, 2026-11-03: "ALL SPINS AND SIT N GO'S STOP AT 3AM
 * TO INSURE THERE ARE NONE RUNNING BEFORE THE GAMES ALL SHUT DOWN") exists so
 * no lobby holds a player's buy-in through the 4:00 to 6:00 window. It used to
 * cancel every open board, including the ones nobody ever sat at, and the
 * engine's always-on board minted each one again at 6:00: 115-139 cancelled
 * tournaments, closed tables and immutable zero receipts a day for nothing.
 * A board that was never used holds nothing and, from 3:00, cannot gain a
 * player (spin_sng_closed_until_reopen), so it stays open and is reused.
 * Everything that was ever used is still cancelled and refunded exactly as
 * before. Native behaviour was proven on PostgreSQL 16 against the exact
 * production preimages (see docs/changelog/2026-11-08-...).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';

const dir = 'supabase/migrations';
const file = fs
  .readdirSync(dir)
  .find((f) => f.endsWith('_an_unused_seat_first_board_is_parked_not_recycled_at_3am.sql'));
const sql = file ? fs.readFileSync(`${dir}/${file}`, 'utf8') : '';
const section = (from: string, to: string) => sql.slice(sql.indexOf(from), sql.indexOf(to));
const unused = section(
  'CREATE OR REPLACE FUNCTION public.fn_daily_window_seat_first_lobby_unused',
  'CREATE OR REPLACE FUNCTION public.fn_daily_window_close_seat_first_lobbies'
);
const close = section(
  'CREATE OR REPLACE FUNCTION public.fn_daily_window_close_seat_first_lobbies',
  'CREATE OR REPLACE FUNCTION smarter_private.daily_window_lobby_watchdog'
);
const watchdog = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION smarter_private.daily_window_lobby_watchdog'));

describe('an unused seat-first board is parked at 3 AM, not cancelled and minted again', () => {
  it('exists as one transaction over the audited live definitions', () => {
    expect(file).toBeTruthy();
    expect(sql).toMatch(/^BEGIN;$/m);
    expect(sql).toMatch(/^COMMIT;$/m);
    expect(sql).toContain("'c610d559a8142be1990b52c69d154de0'");
    expect(sql).toContain("'b306e4ab0cf9df0ca44de6079670e482'");
    // CREATE OR REPLACE FUNCTION only: it needs no lock on a live table.
    expect(sql).not.toMatch(/^-- @install-window:/m);
    expect(sql).not.toMatch(/\b(ALTER|LOCK)\s+TABLE\b/i);
  });

  it('calls a board unused only when nothing ever touched it, horse or human', () => {
    expect(unused).toContain('NOT EXISTS(SELECT 1 FROM public.tournament_players tp WHERE tp.tournament_id = t.id)');
    // any seat EVER, open or left
    expect(unused).toMatch(/NOT EXISTS\(SELECT 1 FROM public\.table_seats s JOIN public\.tables tb ON tb\.id = s\.table_id\s+WHERE tb\.tournament_id = t\.id\)/);
    expect(unused).toContain('t.started_at IS NULL');
    expect(unused).toContain('coalesce(t.current_players,0) = 0');
    expect(unused).toContain('coalesce(t.prize_pool,0) = 0');
    expect(unused).toContain('coalesce(t.total_rake,0) = 0');
    expect(unused).toContain('coalesce(t.spin_multiplier,0) = 0');
    expect(unused).toContain("l.kind = 'jackpot_draw'");
    expect(unused).toContain('public.spin_draw_receipts');
    expect(unused).not.toMatch(/is_horse/i);
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.fn_daily_window_seat_first_lobby_unused\(uuid\) FROM PUBLIC, anon, authenticated;/
    );
  });

  it('parks an unused board in the scan, before the LIMIT, so it never crowds out a used lobby', () => {
    const scan = close.slice(close.indexOf('FOR g IN'), close.indexOf('LOOP'));
    expect(scan).toContain('AND NOT public.fn_daily_window_seat_first_lobby_unused(t.id)');
    expect(scan.indexOf('fn_daily_window_seat_first_lobby_unused')).toBeLessThan(scan.indexOf('LIMIT'));
    expect(close).toContain("'parked',n_parked");
  });

  it('still cancels and refunds every used lobby exactly as before', () => {
    expect(close).toContain('IF NOT (local_t >= pol.spin_sng_stop AND local_t < pol.window_end) THEN');
    expect(close).toContain('res := public.atomic_cancel_tournament(g.id, NULL);');
    expect(close).toContain("res->>'fully_settled' IS DISTINCT FROM 'true'");
    expect(close).toContain("res->>'tournament_id' IS DISTINCT FROM g.id::text");
    expect(close).toContain('cur.entrants >= cur.max_players');
    expect(close).toContain('OR cur.drawn OR');
    expect(close).toContain('PERFORM public.fn_ca_lock_settlement_lane_for_sweep_member(g.id);');
    expect(close).toContain('FOR UPDATE SKIP LOCKED');
    expect(close).toContain('EXIT WHEN g.is_sat;');
    expect(close).not.toMatch(/INSERT INTO public\.(chip_ledger|wallets|tournament_refunds)/i);
    expect(close).not.toMatch(/UPDATE public\.(wallets|club_wallets|tournaments)\b/i);
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_daily_window_close_seat_first_lobbies(integer,timestamptz,boolean) TO service_role;'
    );
  });

  it('pages at 4 AM only for a lobby somebody used', () => {
    const still = close.slice(close.indexOf('IF local_t >= pol.window_start THEN'));
    expect(still).toContain('AND NOT public.fn_daily_window_seat_first_lobby_unused(t.id)');
    expect(still).toContain("'DailyWindowLobbyStillOpen','firing','critical'");
    expect(watchdog).toContain('AND NOT public.fn_daily_window_seat_first_lobby_unused(t.id)');
    expect(watchdog).toContain("'DailyWindowLobbyStillOpen','firing','critical'");
    expect(watchdog.split('$f$;')[0]).not.toContain('atomic_cancel_tournament');
    const senders = sql.match(/fn_record_operational_alert\(/g) ?? [];
    const targets = sql.match(/'target_task_id','01a09b86-5ba8-7290-8657-1041f13dd3ca'/g) ?? [];
    expect(targets.length).toBe(senders.length);
  });
});
