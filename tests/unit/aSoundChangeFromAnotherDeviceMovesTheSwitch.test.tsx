/**
 * A SOUND CHANGE MADE ON ANOTHER DEVICE MOVES EVERY SWITCH HERE (2026-11-15).
 *
 * The route: PostgresSyncHooks relays a `user_table_settings` row change as
 * SETTINGS_CHANGED naming the column; useTableSettings translates the column,
 * commits, and applyGateChanges writes the gate; the gate fires its event; the
 * switches (useSoundSwitch / useVibrationSwitch) read it. This drives that
 * route on the real bus, end to end, with nothing in it mocked.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

vi.unmock('../../src/core/MasterBus');

const { masterBus } = await vi.importActual<typeof import('../../src/core/MasterBus')>(
  '../../src/core/MasterBus'
);
const { useTableSettings } = await import('../../src/hooks/useTableSettings');
const { useSoundSwitch, useVibrationSwitch } = await import('../../src/hooks/useSoundSwitches');

afterEach(cleanup);

const relay = (setting: string, value: boolean) =>
  masterBus.emit('SETTINGS_CHANGED', {
    setting,
    value,
    origin: 'postgres-sync:user-table-settings',
  });

describe('a row change relayed from another device', () => {
  it('moves the Sounds and Vibrations switches', () => {
    renderHook(() => useTableSettings());
    const sound = renderHook(() => useSoundSwitch());
    const haptic = renderHook(() => useVibrationSwitch());

    act(() => relay('sound_enabled', false));
    expect(sound.result.current).toBe(false);
    act(() => relay('sound_enabled', true));
    expect(sound.result.current).toBe(true);

    act(() => relay('haptic_enabled', false));
    expect(haptic.result.current).toBe(false);
    act(() => relay('haptic_enabled', true));
    expect(haptic.result.current).toBe(true);
  });
});
