/**
 * A Spin or Sit & Go lobby still open at 3:00 AM is closed and refunded
 * (owner, 2026-11-03): "ALL SPINS AND SIT N GO'S STOP AT 3AM TO INSURE THERE
 * ARE NONE RUNNING BEFORE THE GAMES ALL SHUT DOWN."
 *
 * The engine asks every minute from 3:00 to 6:00 Chicago; the database
 * cancels each open, unstarted, not-full lobby through the one cancellation
 * authority (which refunds buy-in and fee and writes the receipt), and its own
 * watchdog pages if any lobby is still open in the 4:00 hour.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';

const dir = 'supabase/migrations';
const file = fs
  .readdirSync(dir)
  .find((f) => f.endsWith('_daily_window_closes_open_spin_and_sng_lobbies_at_3am.sql'));
const sql = file ? fs.readFileSync(`${dir}/${file}`, 'utf8') : '';
const engine = fs.readFileSync('server/src/GameServer.ts', 'utf8');
const fnBody = sql.slice(
  sql.indexOf('CREATE OR REPLACE FUNCTION public.fn_daily_window_close_seat_first_lobbies'),
  sql.indexOf('CREATE OR REPLACE FUNCTION smarter_private.daily_window_lobby_watchdog')
);

describe('a Spin or Sit & Go lobby open at 3 AM is closed and refunded', () => {
  it('exists, and acts only from the policy stop to the end of the window', () => {
    expect(file).toBeTruthy();
    expect(fnBody).toContain('FROM smarter_private.daily_window_policy WHERE singleton');
    expect(fnBody).toContain(
      'IF NOT (local_t >= pol.spin_sng_stop AND local_t < pol.window_end) THEN'
    );
    expect(fnBody).toContain("local_t := (p_at AT TIME ZONE pol.time_zone)::time;");
  });

  it('cancels only open, unstarted Spins and Sit & Gos through the one cancellation authority', () => {
    expect(fnBody).toContain("upper(coalesce(t.tournament_type,'')) IN ('SPIN','SNG')");
    expect(fnBody).toContain("t.status IN ('REGISTERING','ANNOUNCED')");
    expect(fnBody).toContain('t.started_at IS NULL');
    expect(fnBody).toContain('res := public.atomic_cancel_tournament(g.id, NULL);');
    // the function moves no money of its own
    expect(fnBody).not.toMatch(/INSERT INTO public\.(chip_ledger|wallets|tournament_refunds)/i);
    expect(fnBody).not.toMatch(/UPDATE public\.(wallets|club_wallets|tournaments)\b/i);
  });

  it('demands the exact receipt and never claims a refused cancel', () => {
    expect(fnBody).toContain("res->>'ok' IS DISTINCT FROM 'true'");
    expect(fnBody).toContain("res->>'status' IS DISTINCT FROM 'CANCELLED'");
    expect(fnBody).toContain("res->>'fully_settled' IS DISTINCT FROM 'true'");
    expect(fnBody).toContain("res->>'tournament_id' IS DISTINCT FROM g.id::text");
    expect(fnBody).toContain("'DailyWindowLobbyCloseFailed','firing','warning'");
  });

  it('leaves a full game to deal and never cancels a drawn Spin', () => {
    expect(fnBody).toContain('cur.entrants >= cur.max_players');
    expect(fnBody).toContain('OR cur.drawn OR');
    expect(fnBody).toContain("coalesce(t.spin_multiplier,0)>0");
    expect(fnBody).toContain("l.kind='jackpot_draw'");
    expect(fnBody).toContain('public.spin_draw_receipts');
  });

  it('takes lanes the way the unfilled Spin sweep does and cancels a satellite alone', () => {
    expect(fnBody).toContain('PERFORM public.fn_ca_lock_settlement_lane_for_sweep_member(g.id);');
    expect(fnBody).toContain('FOR UPDATE SKIP LOCKED');
    expect(fnBody).toContain('EXIT WHEN did_any;');
    expect(fnBody).toContain('EXIT WHEN g.is_sat;');
  });

  it('is the engine call only: service_role may run it, players may not', () => {
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_daily_window_close_seat_first_lobbies(integer,timestamptz,boolean) TO service_role;'
    );
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.fn_daily_window_close_seat_first_lobbies\(integer,timestamptz,boolean\)\s+FROM PUBLIC, anon, authenticated;/
    );
  });

  it('is called by the engine every minute while Spin and Sit & Go boards are closed', () => {
    expect(engine).toContain("import { spinSngBoardsOpen } from './maintenance/dailyWindow.js';");
    expect(engine).toContain(
      'if (!spinSngBoardsOpen(new Date()) && Date.now() - this.lastLobbyCloseAt > 60 * 1000) {'
    );
    expect(engine).toContain("'fn_daily_window_close_seat_first_lobbies'");
    expect(engine).toContain("'GameServer.daily_window_lobby_close_failed'");
  });

  it('has a database watchdog for the 4:00 hour that closes nothing', () => {
    const wd = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION smarter_private.daily_window_lobby_watchdog'));
    expect(wd).toContain(
      "IF NOT (local_t >= pol.window_start AND local_t < pol.window_start + interval '1 hour') THEN"
    );
    expect(wd).toContain("'DailyWindowLobbyStillOpen','firing','critical'");
    expect(wd.split('$f$;')[0]).not.toContain('atomic_cancel_tournament');
    expect(sql).toContain("cron.schedule('daily-window-lobby-watchdog','*/5 9-10 * * *'");
    expect(sql).toMatch(/^[ \t]*--[ \t]*periodic-work:[ \t]*\S/m);
    expect(sql).toMatch(/^-- @live-proof: .*daily-window-lobby-watchdog/m);
  });

  it('addresses every alert to the fleet', () => {
    const senders = sql.match(/fn_record_operational_alert\(/g) ?? [];
    const targets = sql.match(/'target_task_id','01a09b86-5ba8-7290-8657-1041f13dd3ca'/g) ?? [];
    expect(senders.length).toBeGreaterThan(0);
    expect(targets.length).toBe(senders.length);
  });
});
