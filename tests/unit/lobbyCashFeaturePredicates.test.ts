import { describe, expect, it } from 'vitest';
import { featureState, FILTER_SPECS } from '../../src/components/lobby/advancedFilterSpec';

const answer = (
  key: string,
  row: Record<string, unknown>,
  settings: Record<string, unknown> = {}
) => featureState(FILTER_SPECS.HOLDEM.features.find((item) => item.key === key)!, row, settings);

describe('cash filters describe effective engine rules', () => {
  it('Run It Twice uses both permission flags, its explicit override and the heads-up gate', () => {
    expect(
      answer('rit_choice', {
        max_players: 6,
        run_it_twice: true,
        allow_run_it_twice: false,
        run_it_twice_enabled: false,
      })
    ).toBe(false);
    expect(
      answer('rit_choice', {
        max_players: 6,
        run_it_twice: false,
        allow_run_it_twice: true,
        run_it_twice_enabled: false,
      })
    ).toBe(false);
    expect(
      answer('rit_choice', {
        max_players: 6,
        run_it_twice: false,
        allow_run_it_twice: false,
        run_it_twice_enabled: true,
      })
    ).toBe(true);
    expect(
      answer('rit_choice', {
        max_players: 2,
        run_it_twice: true,
        allow_run_it_twice: true,
        run_it_twice_enabled: true,
      })
    ).toBe(false);
    expect(
      answer('rit_choice', {
        max_players: 6,
        run_it_twice: true,
        allow_run_it_twice: true,
        run_it_twice_enabled: false,
        insurance_enabled: true,
      })
    ).toBe(true);
    expect(
      answer('rit_choice', {
        max_players: 6,
        run_it_twice: null,
        allow_run_it_twice: null,
        run_it_twice_enabled: null,
      })
    ).toBe(true);
  });

  it('a missing projection remains unknown rather than manufacturing a feature', () => {
    for (const key of [
      'rit_choice',
      'bomb_pot',
      'bomb_multi_board',
      'auto_straddle',
      'ante',
      'time_bank',
    ])
      expect(answer(key, {}), key).toBeNull();
    expect(answer('rit_choice', { run_it_twice: true })).toBeNull();
    expect(answer('bomb_pot', { bomb_pot_enabled: true })).toBeNull();
  });

  it('Bomb Pot requires an enabled viable cadence and Multi-Board also requires real boards', () => {
    expect(
      answer('bomb_pot', {
        bomb_pot_enabled: true,
        bomb_pot_trigger_mode: null,
        bomb_pot_frequency: 0,
      })
    ).toBe(false);
    expect(
      answer('bomb_pot', {
        bomb_pot_enabled: true,
        bomb_pot_trigger_mode: 'every_n_hands',
        bomb_pot_frequency: 10,
      })
    ).toBe(true);
    expect(
      answer('bomb_pot', {
        bomb_pot_enabled: true,
        bomb_pot_trigger_mode: 'timed',
        bomb_pot_interval_seconds: 0,
      })
    ).toBe(false);
    expect(
      answer('bomb_pot', {
        bomb_pot_enabled: true,
        bomb_pot_trigger_mode: 'timed',
        bomb_pot_interval_seconds: 1,
      })
    ).toBe(true);
    expect(
      answer('bomb_pot', { bomb_pot_enabled: true, bomb_pot_trigger_mode: 'once_per_orbit' })
    ).toBe(true);
    expect(
      answer('bomb_multi_board', { bomb_pot_enabled: false, bomb_pot_double_board: true })
    ).toBe(false);
    expect(
      answer('bomb_multi_board', {
        bomb_pot_enabled: true,
        bomb_pot_trigger_mode: 'bomb_pot_only',
        bomb_pot_board_count: 3,
        bomb_pot_double_board: false,
      })
    ).toBe(true);
    expect(
      answer('bomb_multi_board', {
        bomb_pot_enabled: true,
        bomb_pot_trigger_mode: 'bomb_pot_only',
        bomb_pot_board_count: 1,
        bomb_pot_double_board: true,
      })
    ).toBe(false);
  });

  it('disabled ante or straddle rules cannot pass merely because a dormant amount or auto flag remains', () => {
    expect(answer('ante', { ante_enabled: false, ante: 5 })).toBe(false);
    expect(answer('ante', { ante_enabled: true, ante: 0 })).toBe(false);
    expect(answer('ante', { ante_enabled: null, ante: 5 })).toBe(true);
    expect(answer('auto_straddle', { straddle_enabled: false, auto_utg_straddle: true })).toBe(
      false
    );
    expect(answer('auto_straddle', { straddle_enabled: true, auto_utg_straddle: true })).toBe(true);
    expect(answer('time_bank', { time_bank_enabled: null })).toBe(true);
  });

  it('authoritative columns outrank stale settings while legacy-only settings remain readable', () => {
    expect(answer('straddle', { straddle_enabled: false }, { straddle_enabled: true })).toBe(false);
    expect(answer('insurance', { insurance_enabled: null }, { insurance_enabled: true })).toBe(
      false
    );
    expect(
      answer(
        'bomb_pot',
        { bomb_pot_enabled: false },
        { bomb_pot_enabled: true, bomb_pot_trigger_mode: 'bomb_pot_only' }
      )
    ).toBe(false);
    expect(
      answer(
        'bomb_pot',
        {},
        { bomb_pot_enabled: true, bomb_pot_trigger_mode: 'timed', bomb_pot_interval_seconds: 60 }
      )
    ).toBe(true);
  });
});
