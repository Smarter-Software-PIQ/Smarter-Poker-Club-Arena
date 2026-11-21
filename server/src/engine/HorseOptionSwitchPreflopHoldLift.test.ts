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
  OPTION_SWITCH_SHADOW_NAMES,
  optionSwitchDecisionOpts,
  optionSwitchOffOnly,
  optionSwitchStatesOf,
  optionSwitchShadowRefusal,
} from './HorseOptionSwitch.js';

describe('the owner preflop range hold lift', () => {
  it('horsePlayStyles is switchable on and off, and takes shadow like every per-decision option', () => {
    // Shadow mode (2026-11-19, Horse SWITCH integration): a registered non-style option whose every read is a
    // decision option takes `shadow` (a worker re-decision with the option flipped). horsePlayStyles is read only
    // through HorseDecideOpts (HorseLogic horsePlayStyleOf), so it takes shadow; on and off are unchanged.
    expect(optionSwitchStatesOf('horsePlayStyles')).toEqual(['off', 'shadow', 'on_shadow', 'on']);
    expect(optionSwitchShadowRefusal('horsePlayStyles')).toBeNull();
    expect(OPTION_SWITCH_SHADOW_NAMES).toContain('horsePlayStyles');
    expect(optionSwitchOffOnly('horsePlayStyles')).toBeNull();
    expect(optionSwitchDecisionOpts({ horsePlayStyles: 'on' })).toEqual({ horsePlayStyles: true });
    expect(optionSwitchDecisionOpts({ horsePlayStyles: 'off' })).toEqual({
      horsePlayStyles: false,
    });
    // shadow acts as off: nothing reaches the acted decision
    expect(optionSwitchDecisionOpts({ horsePlayStyles: 'shadow' }).horsePlayStyles).not.toBe(true);
    expect(optionSwitchDecisionOpts({ horsePlayStyles: 'shadow' })).toEqual({});
  });

  it('omahaPreflopReraiseDefencePricedInPosition is switchable on and off; its parent option stays off-only', () => {
    // 2026-11-19: a 'code' option that is not off-only takes on_shadow (acted true, re-decided false), never shadow
    expect(optionSwitchStatesOf('omahaPreflopReraiseDefencePricedInPosition')).toEqual([
      'off',
      'on_shadow',
      'on',
    ]);
    expect(optionSwitchOffOnly('omahaPreflopReraiseDefencePricedInPosition')).toBeNull();
    expect(optionSwitchDecisionOpts({ omahaPreflopReraiseDefencePricedInPosition: 'on' })).toEqual({
      omahaPreflopReraiseDefencePricedInPosition: true,
    });
    expect(optionSwitchOffOnly('omahaPreflopReraiseDefencePriced')?.source).toBe(
      'owner preflop range hold'
    );
    expect(optionSwitchStatesOf('omahaPreflopReraiseDefencePriced')).toEqual(['off']);
    const lift = OPTION_SWITCH_PREFLOP_HOLD_LIFTED.omahaPreflopReraiseDefencePricedInPosition!;
    expect(lift.source).toContain(
      'YOU OWN THE CODEBASE, YOU DECIDE WHAT TURNS ON AND IF ITS READY'
    );
    expect(lift.source).toContain('by name, alone');
    expect(lift.sha256).toMatch(/^63f041c4ca82354b[0-9a-f]{48}$/);
    expect(Object.isFrozen(lift)).toBe(true);
  });

  it('the lift map names horsePlayStyles, omahaPreflopReraiseDefencePricedInPosition and huBbDefendsUnreadToPrice only, each citing the owner text and its full digest', () => {
    // 2026-11-20: huBbDefendsUnreadToPrice joined the map (the pin moved deliberately, with its own lift entry)
    expect(Object.keys(OPTION_SWITCH_PREFLOP_HOLD_LIFTED)).toEqual([
      'horsePlayStyles',
      'omahaPreflopReraiseDefencePricedInPosition',
      'huBbDefendsUnreadToPrice',
    ]);
    for (const lifted of Object.values(OPTION_SWITCH_PREFLOP_HOLD_LIFTED))
      expect(lifted.sha256).toMatch(/^[0-9a-f]{64}$/);
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

  it('huBbDefendsUnreadToPrice is lifted by name (2026-11-20); its heads-up siblings stay held', () => {
    // Owner order of 2026-11-20 15:01 America/Chicago to the Antigravity Coordinator. The lift makes the switch
    // accept on and off; it turns nothing on.
    const name = 'huBbDefendsUnreadToPrice';
    expect(optionSwitchOffOnly(name)).toBeNull();
    expect(Object.hasOwn(OPTION_SWITCH_OFF_ONLY, name)).toBe(false);
    expect(OPTION_SWITCH_PREFLOP_HELD_NAMES).not.toContain(name);
    expect(optionSwitchStatesOf(name)).toEqual(['off', 'shadow', 'on_shadow', 'on']);
    expect(OPTION_SWITCH_REGISTRY.find((e) => e.name === name)?.releaseDefault).toBe('off');
    expect(optionSwitchDecisionOpts({ [name]: 'on' })).toEqual({ [name]: true });
    expect(optionSwitchDecisionOpts({ [name]: 'off' })).toEqual({ [name]: false });
    // no row and shadow pass nothing: the release default (off) acts
    expect(optionSwitchDecisionOpts({})).toEqual({});
    expect(optionSwitchDecisionOpts({ [name]: 'shadow' })).toEqual({});
    const lift = OPTION_SWITCH_PREFLOP_HOLD_LIFTED.huBbDefendsUnreadToPrice!;
    expect(lift.source).toContain('2026-11-20 15:01 Chicago');
    expect(lift.source).toContain(
      'YOU OWN THIS CODE BASE AND ARE TO MAKE ANY AND ALL DECISIONS, CHANGES, UPGRADES, ENHANCEMENTS ETC. AND COORDIANTE WITH THE ENGINE CUT OVER, HORSE DECISIONS AND ON OFF SWITCH CHATS AS NEEDED.'
    );
    expect(lift.source).toContain('by name, alone');
    expect(lift.file).toBe(
      'antigravity-coordinator-01UxDLnH/OWNER-TEXT-20261120-ANTIGRAVITY-COORDINATOR-VERBATIM.md'
    );
    expect(lift.sha256).toMatch(/^90351f60b2dbcd6f[0-9a-f]{48}$/);
    expect(Object.isFrozen(lift)).toBe(true);
    for (const held of ['huBbDefendsToPrice', 'huOpenerDefendsToPrice', 'huLimpDefendsToPrice']) {
      expect(OPTION_SWITCH_PREFLOP_HELD_NAMES, held).toContain(held);
      expect(optionSwitchStatesOf(held), held).toEqual(['off']);
      expect(optionSwitchDecisionOpts({ [held]: 'on' } as never), held).toEqual({});
    }
    // the steal stays under its own owner hold (by name pattern)
    expect(optionSwitchStatesOf('huSmallBlindStealsVsTightBigBlind')).toEqual(['off']);
  });

  it('every other preflop-held name is still off-only', () => {
    expect(OPTION_SWITCH_PREFLOP_HELD_NAMES.length).toBeGreaterThanOrEqual(10);
    expect(OPTION_SWITCH_PREFLOP_HELD_NAMES).toContain('holdemPersonaPreflop');
    expect(OPTION_SWITCH_PREFLOP_HELD_NAMES).not.toContain('horsePlayStyles');
    expect(OPTION_SWITCH_PREFLOP_HELD_NAMES).not.toContain(
      'omahaPreflopReraiseDefencePricedInPosition'
    );
    expect(OPTION_SWITCH_PREFLOP_HELD_NAMES).toContain('omahaPreflopReraiseDefencePriced');
    const registered = new Set(OPTION_SWITCH_REGISTRY.map((e) => e.name));
    for (const name of OPTION_SWITCH_PREFLOP_HELD_NAMES) {
      expect(optionSwitchOffOnly(name)?.source).toBe('owner preflop range hold');
      if (registered.has(name)) expect(optionSwitchStatesOf(name)).toEqual(['off']);
      expect(optionSwitchDecisionOpts({ [name]: 'on' } as never)).toEqual({});
    }
  });
});
