import { describe, expect, it } from 'vitest';
import {
  admitNaturalAddOn,
  completeAddOnRoster,
  addOnWindow,
  countdownSeconds,
  forbiddenAddOnParticipation,
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
