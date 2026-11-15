/**
 * THE SOUNDS AND VIBRATIONS SWITCHES, READ FROM THE GATES (2026-11-14).
 *
 * Whether the app is audible is decided by `utils/soundGate`, and whether it
 * buzzes by `utils/vibrationGate`. Every switch that shows those two answers
 * used to keep its own copy: one `useState` per mounted table in
 * `useTableSound`, and the tab bar's menu reading the settings store instead.
 * Copies drift. A change made at one table left the others on the old value,
 * and a switch showing a stale value loses its next press, because the press
 * computes `!stale`.
 *
 * There is no copy here. Both hooks subscribe to the gate's own change event
 * (and to `storage`, for another browser window) and return what the gate
 * says now, so every switch on screen shows the same answer the engine uses.
 */
import { useSyncExternalStore } from 'react';
import { SOUND_PREFERENCE_EVENT, isSoundAllowed } from '../utils/soundGate';
import { VIBRATION_PREFERENCE_EVENT, isVibrationPreferred } from '../utils/vibrationGate';

const subscribeTo = (eventName: string) => (onChange: () => void) => {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(eventName, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(eventName, onChange);
    window.removeEventListener('storage', onChange);
  };
};

const subscribeSound = subscribeTo(SOUND_PREFERENCE_EVENT);
const subscribeVibration = subscribeTo(VIBRATION_PREFERENCE_EVENT);

/** Whether sound is on, as the sound gate has it. */
export function useSoundSwitch(): boolean {
  return useSyncExternalStore(subscribeSound, isSoundAllowed, isSoundAllowed);
}

/**
 * Whether haptics are on, as a PREFERENCE. Not `isVibrationAllowed`, which is
 * also false on a device that cannot vibrate: a switch must not read stuck off
 * on a desktop.
 */
export function useVibrationSwitch(): boolean {
  return useSyncExternalStore(subscribeVibration, isVibrationPreferred, isVibrationPreferred);
}
