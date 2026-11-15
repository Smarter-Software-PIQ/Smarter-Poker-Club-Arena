/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  useTableSound — Sound & vibration preference state for the poker table
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Extracted from TablePage.tsx. Manages the three localStorage-persisted
 * player preferences (sound, vibration, auto-rebuy) and the playTurnAlert
 * helper that guards against stale closure bugs.
 *
 * NOTE: playWinSound() is intentionally LEFT in TablePage because it requires
 *       tableStateRef.current.blinds + safeBB — two deeply-nested closures
 *       that would make the hook contract very wide for little benefit.
 */

import { useEffect, useRef } from 'react';
import { soundService } from '../services/SoundService';
import { isSoundAllowed } from '../utils/soundGate';
import { setVibrationAllowed, isVibrationPreferred } from '../utils/vibrationGate';
import { useSoundSwitch, useVibrationSwitch } from './useSoundSwitches';
import { setTableSetting } from './useTableSettings';
import { usePlayerPreference } from './usePlayerPreference';

export interface UseTableSoundReturn {
  /** Whether sound effects are active. Read this for UI toggle state. */
  isSoundEnabled: boolean;
  setIsSoundEnabled: (v: boolean) => void;

  /** Whether haptic/vibration feedback is active. */
  isVibrationEnabled: boolean;
  setIsVibrationEnabled: (v: boolean) => void;

  /** Whether the player has enabled auto-rebuy between hands. */
  isAutoRebuyEnabled: boolean;
  // Accepts an updater so bus callbacks (which are registered once and would
  // otherwise close over a stale value) can toggle correctly.
  setIsAutoRebuyEnabled: React.Dispatch<React.SetStateAction<boolean>>;

  /**
   * Play the "your turn" audio alert.
   * Uses soundService.isEnabled() (not the stale `isSoundEnabled` closure)
   * per NEW-BUG-1 fix.
   */
  playTurnAlert: () => void;
}

/* `STORAGE_VIBRATION` is gone with the last hand-rolled read of it: the haptic
   switch both reads and writes through `utils/vibrationGate`, which owns that
   key and its sibling. */

/* `readBool` and `SETTINGS_VIBRATION` lived here until 2026-08-29. Both were
   this file's own copy of what `utils/soundGate` and `utils/vibrationGate`
   already decide, and the copy is what let the haptic switch fall behind the
   sound one. Both switches read their gate now.

   `readBool` was also fail-OPEN — `raw !== 'false'` treats '0', 'off' and ''
   as ON — against the fail-CLOSED convention both gate files establish. */

export function useTableSound(): UseTableSoundReturn {
  /**
   * ═════════════════════════════════════════════════════════════════════════
   *  THE GATE IS THE STATE. THERE IS NO COPY OF IT HERE (2026-11-14)
   * ═════════════════════════════════════════════════════════════════════════
   *
   * History, because this hook has been wrong in the same way three times.
   *
   * 2026-08-27: the engine was seeded from one of the gate's two keys, so a
   * mute recorded in the other was clobbered on every table mount.
   * 2026-08-29: the React state was still seeded from that one key, so the
   * switch read ON over a silent app and the first press muted something
   * already muted. Both were then seeded from the gate.
   * 2026-11-14: seeded from the gate, and then never told again. With two
   * tables open, or after a change in the settings panel, the header menu or
   * the tab bar's menu, this copy kept the old value and the next press here
   * computed `!stale`.
   *
   * Every one of those is a copy disagreeing with the gate. So there is no
   * copy: `useSoundSwitch` / `useVibrationSwitch` subscribe to the gates and
   * return what they hold now. A switch cannot be stale against the thing it
   * is reading.
   */
  const isSoundEnabled = useSoundSwitch();
  /* A PREFERENCE, not a capability: `isVibrationAllowed()` is also false when
     the DEVICE cannot vibrate, and a desktop player must not see their haptics
     switch stuck off. */
  const isVibrationEnabled = useVibrationSwitch();
  const [isAutoRebuyEnabled, setIsAutoRebuyEnabled] = usePlayerPreference(
    'table:autoRebuyEnabled',
    false,
    'global'
  );

  // Mount-only sync: align the engine and both key pairs with the stored
  // preference. The gates fail closed on EITHER of their two keys, so writing
  // the gate's own answer back through its setter leaves both keys agreeing
  // (a mute recorded in one is a mute in both) and changes no answer.
  // SOUND AUDIT 2026-08-27: this ran in the RENDER BODY — setEnabled() writes
  // localStorage, and under StrictMode/concurrent rendering a discarded render
  // could still fire that side effect. An effect.
  const mountedRef = useRef(false);
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    soundService.setEnabled(isSoundAllowed());
    setVibrationAllowed(isVibrationPreferred());
  }, []);

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   *  ONE SETTER, SO NO CALL SITE CAN GET IT HALF-RIGHT
   * ═══════════════════════════════════════════════════════════════════════════
   *
   * These reach the GATE (which is what every switch reads, and what the
   * engine plays by) and the STORE (which owns the cross-device copy). Until
   * 2026-08-29 they reached only the engine, and muting from the table left
   * the settings panel showing Sound ON and `user_table_settings.sound_enabled`
   * unwritten, so the mute never followed the account to another device.
   *
   * `setTableSetting` is `useTableSettings' own writer, hoisted out of the hook
   * so it can be called from here; it commits to the shared store, broadcasts
   * for other tabs, and pushes the column.
   */
  const setIsSoundEnabled = (v: boolean) => {
    soundService.setEnabled(v); // both gate keys + the live engine flag
    setTableSetting('isSoundEnabled', v);
  };

  const setIsVibrationEnabled = (v: boolean) => {
    setVibrationAllowed(v); // both gate keys
    setTableSetting('isHapticEnabled', v);
  };

  // NEW-BUG-1 FIX: use dynamic isEnabled() not stale closure
  const playTurnAlert = () => {
    if (soundService.isEnabled()) {
      soundService.playTurnAlert();
    }
  };

  return {
    isSoundEnabled,
    setIsSoundEnabled,
    isVibrationEnabled,
    setIsVibrationEnabled,
    isAutoRebuyEnabled,
    setIsAutoRebuyEnabled,
    playTurnAlert,
  };
}
