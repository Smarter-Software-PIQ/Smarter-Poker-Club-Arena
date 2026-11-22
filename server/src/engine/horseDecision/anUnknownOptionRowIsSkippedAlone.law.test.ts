/**
 * LAW (2026-11-20, lead order): A SWITCH ROW FOR A NAME THIS BUILD DOES NOT KNOW IS SKIPPED ALONE.
 *
 * One row written for another build (an option a newer release registers, switched while this release is
 * serving) used to void the whole delivered set: every switched option silently went back to its release
 * default. The row is now left out and every other row stands. What still voids the set, as before: a name this
 * switch refuses (a parameter, an authority-gated option, an owner hold), a style name in the non-style half, and
 * a state the option does not support. The alarm receipt option_switch_config_invalid_seen fires at every read
 * that delivers an unknown row, so the row is seen and removed.
 */
import { describe, expect, it } from 'vitest';
import {
  OPTION_SWITCH_NOT_A_SWITCH,
  OPTION_SWITCH_PLAIN_NAMES,
  OPTION_SWITCH_REGISTRY,
  OptionSwitchHolder,
  optionSwitchConfigUnknownNames,
  optionSwitchDecisionOpts,
  optionSwitchNameIsUnknown,
  optionSwitchRefusal,
  optionSwitchStatesFrom,
  optionSwitchUnknownNames,
  parseOptionSwitchConfig,
} from '../HorseOptionSwitch.js';
import { STYLE_SWITCH_POLL_MS } from '../HorseStyleSwitch.js';

const v2 = (options: Record<string, unknown>) => ({
  version: 2,
  style: { version: 1, options: {} },
  options,
});
const UNKNOWN = 'optionOfAnotherBuild';

describe('an unknown option row is skipped alone', () => {
  it('unknown means: not registered (style or not) and not refused by this switch', () => {
    expect(optionSwitchNameIsUnknown(UNKNOWN)).toBe(true);
    for (const e of OPTION_SWITCH_REGISTRY)
      expect(optionSwitchNameIsUnknown(e.name), e.name).toBe(false);
    for (const refused of ['v54RiverBluff', 'phase11Pack', 'pillarTwo']) {
      expect(optionSwitchRefusal(refused), refused).not.toBeNull();
      expect(optionSwitchNameIsUnknown(refused), refused).toBe(false);
    }
    for (const notASwitch of Object.keys(OPTION_SWITCH_NOT_A_SWITCH))
      expect(optionSwitchNameIsUnknown(notASwitch), notASwitch).toBe(false);
  });

  it('the unknown row is left out and every other row stands', () => {
    expect(
      optionSwitchStatesFrom({ [UNKNOWN]: 'on', v16Hu: 'off', commitUnderPot: 'off' })
    ).toEqual({
      commitUnderPot: 'off',
      v16Hu: 'off',
    });
    expect(optionSwitchUnknownNames({ [UNKNOWN]: 'on', v16Hu: 'off' })).toEqual([UNKNOWN]);
    // whatever its state says: this build cannot judge a state of an option it does not know
    for (const state of ['on', 'off', 'shadow', 'on_shadow', 'anything', true, null, 7])
      expect(optionSwitchStatesFrom({ [UNKNOWN]: state, v16Hu: 'off' }), String(state)).toEqual({
        v16Hu: 'off',
      });
    const parsed = parseOptionSwitchConfig(v2({ [UNKNOWN]: 'on', v16Hu: 'off' }));
    expect(parsed).toEqual({ ok: true, states: { v16Hu: 'off' } });
    expect(optionSwitchConfigUnknownNames(v2({ [UNKNOWN]: 'on', v16Hu: 'off' }))).toEqual([
      UNKNOWN,
    ]);
    expect(optionSwitchConfigUnknownNames(v2({ v16Hu: 'off' }))).toEqual([]);
    // the unknown name reaches no decision
    expect(
      optionSwitchDecisionOpts(optionSwitchStatesFrom({ [UNKNOWN]: 'on', v16Hu: 'off' }))
    ).toEqual({
      v16Hu: false,
    });
  });

  it('every registered option keeps its row beside an unknown one, at every state it supports', () => {
    for (const name of OPTION_SWITCH_PLAIN_NAMES) {
      const entry = OPTION_SWITCH_REGISTRY.find((e) => e.name === name)!;
      for (const state of entry.states)
        expect(
          optionSwitchStatesFrom({ [UNKNOWN]: 'on', [name]: state }),
          `${name} ${state}`
        ).toEqual({
          [name]: state,
        });
    }
  });

  it('what voided the set before still voids it, with or without an unknown row beside it', () => {
    for (const bad of [
      { decisionTimeMs: 'on' },
      { v54RiverBluff: 'on' },
      { styleFoldBluff: 'on' },
      { commitUnderPot: 'on' },
      { v16Hu: 'yes' },
      { v16Hu: true },
    ]) {
      expect(optionSwitchStatesFrom(bad), JSON.stringify(bad)).toBeNull();
      expect(optionSwitchStatesFrom({ ...bad, [UNKNOWN]: 'off' }), JSON.stringify(bad)).toBeNull();
      expect(parseOptionSwitchConfig(v2({ ...bad, [UNKNOWN]: 'off' }))).toEqual({ ok: false });
    }
  });

  it('the holder applies the known rows and raises the alarm at every read that delivers the unknown row', () => {
    const notes: string[] = [];
    let raw: unknown = v2({ [UNKNOWN]: 'on', v16Hu: 'off' });
    const holder = new OptionSwitchHolder(
      (now) => ({ kind: 'present', raw, receivedAtMs: now }),
      (f) => notes.push(f)
    );
    expect(holder.refresh(0)).toEqual({ v16Hu: 'off' });
    expect(notes).toEqual(['option_switch_config_invalid_seen', 'option_switch_v16Hu_off_seen']);
    expect(holder.refresh(STYLE_SWITCH_POLL_MS)).toEqual({ v16Hu: 'off' });
    expect(notes.filter((n) => n === 'option_switch_config_invalid_seen')).toHaveLength(2);
    // the row removed: the known row is untouched and the alarm stops
    raw = v2({ v16Hu: 'off' });
    notes.length = 0;
    expect(holder.refresh(2 * STYLE_SWITCH_POLL_MS)).toEqual({ v16Hu: 'off' });
    expect(notes).toEqual([]);
  });
});
