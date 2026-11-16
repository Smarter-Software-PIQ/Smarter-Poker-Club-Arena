/**
 * THE OWNER PREFLOP RANGE HOLD IS LIFTED BY NAME, IN SOURCE (Hand Analysis 2026-11-16T03:06:28Z, B1).
 * horsePlayStyles changes preflop ranges; the owner's 2026-11-15 16:42 Chicago text lifts the hold for it alone.
 * The lift is OPTION_SWITCH_PREFLOP_HOLD_LIFTED; every other preflop-held name stays off-only.
 */
import { describe, expect, it } from 'vitest';
import {
  OPTION_SWITCH_OFF_ONLY,
  OPTION_SWITCH_PREFLOP_HELD_NAMES,
  OPTION_SWITCH_PREFLOP_HOLD_LIFTED,
  OPTION_SWITCH_REGISTRY,
  optionSwitchDecisionOpts,
  optionSwitchOffOnly,
  optionSwitchStatesOf,
} from './HorseOptionSwitch.js';

describe('the owner preflop range hold lift', () => {
  it('horsePlayStyles is switchable on and off', () => {
    expect(optionSwitchStatesOf('horsePlayStyles')).toEqual(['off', 'on']);
    expect(optionSwitchOffOnly('horsePlayStyles')).toBeNull();
    expect(optionSwitchDecisionOpts({ horsePlayStyles: 'on' })).toEqual({ horsePlayStyles: true });
    expect(optionSwitchDecisionOpts({ horsePlayStyles: 'off' })).toEqual({
      horsePlayStyles: false,
    });
  });

  it('horsePlayStyles is the ONLY name in the lift map, and the lift cites the owner text and its full digest', () => {
    expect(Object.keys(OPTION_SWITCH_PREFLOP_HOLD_LIFTED)).toEqual(['horsePlayStyles']);
    const lift = OPTION_SWITCH_PREFLOP_HOLD_LIFTED.horsePlayStyles!;
    expect(lift.source).toContain('2026-11-15 16:42 Chicago');
    expect(lift.source).toContain('MAKE ALL 3 PERSONA');
    expect(lift.file).toBe('OWNER-TEXT-20261115-1000-PLO-CHAT-VERBATIM.md');
    expect(lift.sha256).toMatch(/^7921dea5df9daf59[0-9a-f]{48}$/);
    expect(Object.isFrozen(OPTION_SWITCH_PREFLOP_HOLD_LIFTED)).toBe(true);
    expect(Object.isFrozen(lift)).toBe(true);
    for (const name of Object.keys(OPTION_SWITCH_PREFLOP_HOLD_LIFTED))
      expect(Object.hasOwn(OPTION_SWITCH_OFF_ONLY, name)).toBe(false);
  });

  it('every other preflop-held name is still off-only', () => {
    expect(OPTION_SWITCH_PREFLOP_HELD_NAMES.length).toBeGreaterThanOrEqual(10);
    expect(OPTION_SWITCH_PREFLOP_HELD_NAMES).toContain('holdemPersonaPreflop');
    expect(OPTION_SWITCH_PREFLOP_HELD_NAMES).not.toContain('horsePlayStyles');
    const registered = new Set(OPTION_SWITCH_REGISTRY.map((e) => e.name));
    for (const name of OPTION_SWITCH_PREFLOP_HELD_NAMES) {
      expect(optionSwitchOffOnly(name)?.source).toBe('owner preflop range hold');
      if (registered.has(name)) expect(optionSwitchStatesOf(name)).toEqual(['off']);
      expect(optionSwitchDecisionOpts({ [name]: 'on' } as never)).toEqual({});
    }
  });
});
