/**
 * LAW: a replay arm runs the options it declares, or the replay says so (2026-11-20).
 *
 * The defect (coordination inbox 2026-11-19T21:38:29Z): an arm built from a journal's full option set named a style
 * option (and an option off-only today). optionSwitchStatesFrom refuses such a set whole, the replay's option source
 * handed it to the holder anyway, every option ran at its release default and the on and off arms were identical,
 * so an option that changes 105 of 156 decisions read as changing 2.
 */
import { describe, expect, it } from 'vitest';
import {
  OptionSwitchHolder,
  optionSwitchArmFrom,
  optionSwitchArmStrict,
  optionSwitchDecisionOpts,
  optionSwitchSourceFromStates,
  optionSwitchStatesOf,
  type OptionSwitchStates,
} from './HorseOptionSwitch.js';

const PLAIN_A = 'omahaCardImpact';
const PLAIN_B = 'omahaStreetPlan';
const OFF_ONLY = 'v16Hu';
const STYLE = 'styleFoldBluff';

const applied = (states: OptionSwitchStates) =>
  new OptionSwitchHolder(optionSwitchSourceFromStates(states), () => {}).refresh(1);

describe('a replay arm is split option by option', () => {
  it('the names this law uses are what it assumes', () => {
    expect(optionSwitchStatesOf(PLAIN_A)).toContain('on');
    expect(optionSwitchStatesOf(PLAIN_B)).toContain('on');
    expect(optionSwitchStatesOf(OFF_ONLY)).toEqual(['off']);
    expect(optionSwitchStatesOf(STYLE)).not.toBeNull();
  });

  it('a set the build refuses whole is an error in the replay source, never silent release defaults', () => {
    // before 2026-11-20 this served the set, the holder refused it and refresh() returned {} (nothing switched)
    expect(() => applied({ [PLAIN_A]: 'on', [STYLE]: 'on' } as never)).toThrow(
      /refuses the whole set/
    );
    expect(() => applied({ [PLAIN_A]: 'on', [OFF_ONLY]: 'on' } as never)).toThrow(
      new RegExp(`${OFF_ONLY}=on \\(off-only`)
    );
  });

  it('a journal-shaped set keeps every entry that applies, routes style names to the style switch, lists the rest', () => {
    const arm = optionSwitchArmFrom({
      [PLAIN_A]: 'on',
      [STYLE]: 'on',
      [OFF_ONLY]: 'on',
      notAnOptionOfAnyBuild: 'on',
    });
    expect(arm.states).toEqual({ [PLAIN_A]: 'on' });
    expect(arm.style).toEqual({ [STYLE]: 'on' });
    expect(arm.dropped.map((d) => d.option)).toEqual([OFF_ONLY, 'notAnOptionOfAnyBuild']);
    expect(arm.dropped[0].reason).toMatch(/^off-only/);
    expect(applied(arm.states)).toEqual({ [PLAIN_A]: 'on' });
  });

  it('two arms that differ in one option reach the brain differently', () => {
    const base = { [PLAIN_A]: 'on', [STYLE]: 'on' };
    const on = optionSwitchArmStrict({ ...base, [PLAIN_B]: 'on' });
    const off = optionSwitchArmStrict({ ...base, [PLAIN_B]: 'off' });
    expect(applied(on.states)).not.toEqual(applied(off.states));
    expect(optionSwitchDecisionOpts(applied(on.states))).not.toEqual(
      optionSwitchDecisionOpts(applied(off.states))
    );
  });

  it('an arm whose declared difference cannot be applied is refused, not scored at the defaults', () => {
    expect(() => optionSwitchArmStrict({ [PLAIN_A]: 'on', [OFF_ONLY]: 'on' })).toThrow(
      /not applied as declared/
    );
    expect(optionSwitchArmStrict({ [PLAIN_A]: 'on' }).dropped).toEqual([]);
  });
});
