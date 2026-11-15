/**
 * EVERY SOUNDS AND VIBRATIONS SWITCH READS THE GATE (2026-11-14).
 *
 * `useSoundSwitch` / `useVibrationSwitch` hold no state. They return what the
 * sound and vibration gates say now and re-render when a gate is written, by
 * any writer: a table's own setter, the settings store, or the engine switch
 * called directly. The last one is the case a copy seeded from the store could
 * not see.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useSoundSwitch, useVibrationSwitch } from '../../src/hooks/useSoundSwitches';
import { useTableSound } from '../../src/hooks/useTableSound';
import { soundService } from '../../src/services/SoundService';
import { setVibrationAllowed } from '../../src/utils/vibrationGate';

afterEach(cleanup);

describe('the switches follow the gates', () => {
  it('sound follows the engine switch, with no store write involved', () => {
    const menu = renderHook(() => useSoundSwitch());
    const table = renderHook(() => useTableSound());
    act(() => soundService.setEnabled(true));
    expect(menu.result.current).toBe(true);
    expect(table.result.current.isSoundEnabled).toBe(true);
    act(() => soundService.setEnabled(false));
    expect(menu.result.current).toBe(false);
    expect(table.result.current.isSoundEnabled).toBe(false);
  });

  it('haptics follow the vibration gate', () => {
    const menu = renderHook(() => useVibrationSwitch());
    const table = renderHook(() => useTableSound());
    act(() => setVibrationAllowed(false));
    expect(menu.result.current).toBe(false);
    expect(table.result.current.isVibrationEnabled).toBe(false);
    act(() => setVibrationAllowed(true));
    expect(menu.result.current).toBe(true);
    expect(table.result.current.isVibrationEnabled).toBe(true);
  });

  it("a table's own setter moves the menu's badge and every other table", () => {
    const menu = renderHook(() => useSoundSwitch());
    const a = renderHook(() => useTableSound());
    const b = renderHook(() => useTableSound());
    act(() => a.result.current.setIsSoundEnabled(true));
    act(() => a.result.current.setIsVibrationEnabled(true));
    expect([menu.result.current, b.result.current.isSoundEnabled]).toEqual([true, true]);
    act(() => b.result.current.setIsSoundEnabled(false));
    act(() => b.result.current.setIsVibrationEnabled(false));
    expect([menu.result.current, a.result.current.isSoundEnabled]).toEqual([false, false]);
    expect(a.result.current.isVibrationEnabled).toBe(false);
  });
});
