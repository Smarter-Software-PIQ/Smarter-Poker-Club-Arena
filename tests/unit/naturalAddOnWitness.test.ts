import { describe, expect, it } from 'vitest';
import {
  admitNaturalAddOn,
  completeAddOnRoster,
  addOnWindow,
  countdownSeconds,
  forbiddenAddOnParticipation,
  suppressedObserverReward,
} from '../e2e/support/naturalAddOnWitness';
const id = '11111111-1111-4111-8111-111111111111';
const row = { id, tournament_id: id, status: 'active' };
describe('natural add-on observation admission', () => {
  it('requires exact identities and rejects mixed modes', () => {
    expect(admitNaturalAddOn({ natural_addon_tournament_id: id, engine_sha: 'a'.repeat(40) })).toBe(
      id
    );
    for (const payload of [
      { natural_addon_tournament_id: id },
      { natural_addon_tournament_id: id, engine_sha: 'a'.repeat(40), horse_social: false },
    ])
      expect(() => admitNaturalAddOn(payload)).toThrow();
  });
  it('never treats a capped, missing, duplicate or foreign roster as complete', () => {
    expect(completeAddOnRoster([row], 1, id)).toEqual([row]);
    for (const [rows, count] of [
      [[], 0],
      [[row], 2],
      [[row], 9],
      [[row, row], 2],
      [[{ ...row, tournament_id: 'other' }], 1],
      [null, null],
    ] as const)
      expect(() => completeAddOnRoster(rows as any, count, id)).toThrow();
  });
  it('keeps complete historical evidence but opens only live tables', () => {
    const rows = Array.from({ length: 12 }, (_, index) => ({
      ...row,
      id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
      status: index < 6 ? 'closed' : 'running',
    }));
    expect(completeAddOnRoster(rows, 12, id)).toEqual(rows.slice(6));
    expect(() => completeAddOnRoster(rows.slice(1), 12, id)).toThrow();
    expect(() =>
      completeAddOnRoster(
        rows.map((r) => ({ ...r, status: 'running' })),
        12,
        id
      )
    ).toThrow();
    expect(() =>
      completeAddOnRoster(
        rows.map((r) => ({ ...r, status: 'closed' })),
        12,
        id
      )
    ).toThrow();
    expect(() =>
      completeAddOnRoster([{ ...rows[0], tournament_id: 'other' }, ...rows.slice(1)], 12, id)
    ).toThrow();
  });
  it('requires a full sixty-second durable window after late entry', () => {
    const state = {
      addon_period_triggered: true,
      addon_period_started_at: '2026-11-01T04:00:00Z',
      addon_period_ends_at: '2026-11-01T04:01:00Z',
      addon_cost: 15,
      addon_chips: 20000,
      current_level: 8,
      late_reg_levels: 8,
    };
    expect(addOnWindow(state)?.chips).toBe(20000);
    expect(() => addOnWindow({ ...state, current_level: 7 })).toThrow();
    expect(() => addOnWindow({ ...state, addon_period_ends_at: '2026-11-01T04:00:59Z' })).toThrow();
    expect(() => addOnWindow({ ...state, addon_cost: -1 })).toThrow();
    expect(addOnWindow({})).toBeNull();
  });
  it('reads real countdowns and refuses placeholders', () => {
    expect(countdownSeconds('0:59')).toBe(59);
    for (const text of ['--', '0:60', 'NaN', '']) expect(() => countdownSeconds(text)).toThrow();
  });
  it('allows observed context reads and only the reserved identity housekeeping', () => {
    const rpc = (name: string) => new URL('https://db.example/rest/v1/rpc/' + name);
    for (const name of [
      'fn_player_spendable_balance',
      'fn_platform_capabilities',
      'fn_rg_require_not_excluded',
      'fn_batch_club_member_counts',
      'fn_table_chat_is_silenced',
      'fn_time_bank_allowance_v2',
      'fn_bbj_mini_for_club',
      'fn_bbj_pool_for_club',
    ])
      expect(forbiddenAddOnParticipation('POST', rpc(name))).toBe(false);
    for (const name of [
      'ca_claim_active_login',
      'ca_record_device_sighting',
      'fn_report_client_errors',
    ]) {
      expect(forbiddenAddOnParticipation('POST', rpc(name), id)).toBe(false);
      expect(forbiddenAddOnParticipation('POST', rpc(name))).toBe(true);
    }
    expect(
      forbiddenAddOnParticipation('POST', rpc('fn_update_presence'), id, { p_user_id: id })
    ).toBe(false);
    for (const body of [undefined, {}, { p_user_id: 'another-player' }])
      expect(forbiddenAddOnParticipation('POST', rpc('fn_update_presence'), id, body)).toBe(true);
    expect(suppressedObserverReward('POST', rpc('fn_achievement_record_login'))).toBe(true);
    expect(forbiddenAddOnParticipation('POST', rpc('fn_achievement_record_login'), id)).toBe(true);
    for (const name of [
      'process_tournament_rebuy',
      'fn_register_for_tournament',
      'fn_unknown',
      'fn_achievement_unlock_server',
    ]) {
      expect(forbiddenAddOnParticipation('POST', rpc(name), id)).toBe(true);
      expect(suppressedObserverReward('POST', rpc(name))).toBe(false);
    }
  });
  it('allows only engine heartbeat and in-memory connection diagnostics', () => {
    for (const path of ['/heartbeat', '/client-event']) {
      const url = new URL('https://engine.smarter.poker' + path);
      expect(forbiddenAddOnParticipation('POST', url)).toBe(false);
      expect(forbiddenAddOnParticipation('DELETE', url)).toBe(true);
    }
    for (const path of ['/action', '/addchips', '/leave', '/unknown', '/admin/heartbeat'])
      expect(
        forbiddenAddOnParticipation('POST', new URL('https://engine.smarter.poker' + path))
      ).toBe(true);
  });
  it('blocks purchases, registration, seat writes and unknown RPCs before forwarding', () => {
    for (const path of [
      '/rest/v1/rpc/process_tournament_addon',
      '/rest/v1/rpc/fn_register_for_tournament',
      '/rest/v1/table_seats',
      '/rest/v1/club_members',
    ])
      expect(forbiddenAddOnParticipation('POST', new URL('https://db.example' + path))).toBe(true);
    expect(
      forbiddenAddOnParticipation('POST', new URL('https://engine.smarter.poker/action'))
    ).toBe(true);
    for (const rpc of ['fn_db_now', 'fn_mystery_bounty_table_state'])
      expect(
        forbiddenAddOnParticipation('POST', new URL('https://db.example/rest/v1/rpc/' + rpc))
      ).toBe(false);
    expect(
      forbiddenAddOnParticipation('GET', new URL('https://db.example/rest/v1/tournaments'))
    ).toBe(false);
    expect(forbiddenAddOnParticipation('POST', new URL('https://db.example/auth/v1/token'))).toBe(
      false
    );
    expect(
      forbiddenAddOnParticipation(
        'POST',
        new URL('https://db.example/rest/v1/rpc/fn_get_tournament')
      )
    ).toBe(false);
  });
});
