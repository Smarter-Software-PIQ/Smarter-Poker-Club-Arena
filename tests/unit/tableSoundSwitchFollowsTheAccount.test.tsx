/**
 * A TABLE'S SOUND SWITCH FOLLOWS A CHANGE MADE ANYWHERE ELSE (2026-11-14).
 *
 * `useTableSound` holds one copy of the Sounds and Vibrations switches per
 * mounted table. The setting is one per account. Changing it from the tab
 * bar's menu (which reaches one table's page), the settings panel or the
 * header menu left every other mounted copy on the old value, so that table's
 * switch showed the wrong state and its first press changed nothing.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useTableSound } from '../../src/hooks/useTableSound';
import { setTableSetting } from '../../src/hooks/useTableSettings';

afterEach(cleanup);

describe('two mounted tables', () => {
  it('both follow a sound change made through one of them', () => {
    const a = renderHook(() => useTableSound());
    const b = renderHook(() => useTableSound());
    act(() => a.result.current.setIsSoundEnabled(true));
    expect(b.result.current.isSoundEnabled).toBe(true);
    act(() => a.result.current.setIsSoundEnabled(false));
    expect(a.result.current.isSoundEnabled).toBe(false);
    expect(b.result.current.isSoundEnabled, 'the second table kept the old value').toBe(false);
    act(() => b.result.current.setIsSoundEnabled(true));
    expect(a.result.current.isSoundEnabled).toBe(true);
  });

  it('both follow a change that never went through either of them', () => {
    const a = renderHook(() => useTableSound());
    const b = renderHook(() => useTableSound());
    act(() => setTableSetting('isSoundEnabled', true));
    act(() => setTableSetting('isHapticEnabled', true));
    act(() => setTableSetting('isSoundEnabled', false));
    act(() => setTableSetting('isHapticEnabled', false));
    expect(a.result.current.isSoundEnabled).toBe(false);
    expect(b.result.current.isSoundEnabled).toBe(false);
    expect(a.result.current.isVibrationEnabled).toBe(false);
    expect(b.result.current.isVibrationEnabled).toBe(false);
    act(() => setTableSetting('isHapticEnabled', true));
    expect(a.result.current.isVibrationEnabled).toBe(true);
    expect(b.result.current.isVibrationEnabled).toBe(true);
  });
});
