/**
 * Dan 2026-11-12: a queued Lightning Leave Next Hand can be cancelled. The
 * database door withdraws only the caller's own stop mark, and refuses a
 * session that ended, a frozen Cluster and a responsible-gaming refusal.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  lightningDurationText,
  parseLightningResumePlaying,
  parseLightningSessionStats,
} from '../../src/lightning/lightningSessionApi';
import { lightningStatRows } from '../../src/components/lightning/LightningStatsGrid';

const dir = resolve(__dirname, '../../supabase/migrations');
const file = readdirSync(dir).find((f) =>
  f.endsWith('_lightning_a_player_can_withdraw_their_own_leave_next_hand.sql')
)!;
const SQL = readFileSync(resolve(dir, file), 'utf8')
  .split('\n')
  .map((l) => l.replace(/--.*$/, ''))
  .join('\n');

describe('fn_lightning_resume_playing', () => {
  it('reads only the caller, locks the row the stop door locks, and refuses what must stay stopped', () => {
    expect(SQL).toContain('v_uid   uuid := auth.uid();');
    expect(SQL).toMatch(/WHERE ps\.cluster_id = p_cluster_id AND ps\.player_id = v_uid/);
    expect(SQL).toMatch(/LIMIT 1\s+FOR UPDATE;/);
    for (const reason of ['NO_SESSION', 'EXITED', 'FROZEN', 'RG_LIMIT'])
      expect(SQL).toContain(`'reason', '${reason}'`);
    expect(SQL).toContain("fz.cluster_mode = 'frozen'");
    expect(SQL).toContain('public.fn_rg_require_not_excluded(v_uid)');
  });
  it('withdraws only the stop mark, records it, and moves no money or seat', () => {
    expect(SQL).toMatch(
      /UPDATE public\.lightning_pool_session ps\s+SET stop_requested_at = NULL, updated_at = v_now\s+WHERE ps\.id = s\.id AND ps\.exited_at IS NULL;/
    );
    expect(SQL).toContain("'stop_playing_withdrawn'");
    expect(SQL).not.toMatch(/club_members|chip_balance|table_seats\s+SET|fn_add_chips|wallet/i);
    expect(SQL).toMatch(
      /REVOKE ALL ON FUNCTION public\.fn_lightning_resume_playing\(uuid\) FROM PUBLIC, anon;/
    );
    expect(SQL).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.fn_lightning_resume_playing\(uuid\) TO authenticated, service_role;/
    );
    expect(SQL.match(/\bBEGIN;/g)?.length).toBe(1);
  });
  it('parses the answer', () => {
    expect(parseLightningResumePlaying({ ok: true, withdrawn: true })).toEqual({
      ok: true,
      withdrawn: true,
      reason: null,
    });
    expect(parseLightningResumePlaying({ ok: false, reason: 'EXITED' }).reason).toBe('EXITED');
    expect(parseLightningResumePlaying(null).ok).toBe(false);
  });
});

describe('the session card detail (Dan 2026-11-12)', () => {
  it('shows the exact duration', () => {
    expect(lightningDurationText(529)).toBe('8m 49s');
    expect(lightningDurationText(480)).toBe('8m');
    expect(lightningDurationText(42)).toBe('42s');
    expect(lightningDurationText(3725)).toBe('1h 02m');
  });
  it('names the Auto Top Ups behind the Total Buy-In, only when there were any', () => {
    const s = parseLightningSessionStats({
      hands: 9,
      starting_stack: 400,
      top_ups: 15,
      total_buy_in: 415,
      current_stack: 401,
      net: -14,
    })!;
    const rows = lightningStatRows(s, 'summary');
    expect(rows.find((r) => r.key === 'top_ups')?.value).toBe('15');
    expect(rows.findIndex((r) => r.key === 'top_ups')).toBe(
      rows.findIndex((r) => r.key === 'total_buy_in') + 1
    );
    const none = lightningStatRows({ ...s, topUps: 0 }, 'session');
    expect(none.some((r) => r.key === 'top_ups')).toBe(false);
  });
});
