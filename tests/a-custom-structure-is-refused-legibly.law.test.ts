import { describe, expect, it } from 'vitest';
import {
  customStructureIsValid,
  validateCustomStructure,
} from '../src/config/customStructureValidation';
import { PREBUILT_STRUCTURES, prebuiltLadder } from '../src/config/prebuiltStructures';

const level = (over: Partial<Record<string, number | boolean>> = {}) =>
  ({
    level: 1,
    smallBlind: 25,
    bigBlind: 50,
    ante: 0,
    durationMinutes: 8,
    ...over,
  }) as never;

/**
 * A club or union authoring its own ladder is told which level is wrong while
 * it can still be fixed, instead of meeting a raw database refusal after
 * submitting. Every rule here mirrors fn_ca_mtt_blind_contract; the database
 * stays authoritative and this never admits what the contract would refuse.
 */
describe('a custom structure is refused legibly', () => {
  it('accepts every prebuilt ladder, so the client never refuses what we ship', () => {
    for (const spec of PREBUILT_STRUCTURES) {
      expect(validateCustomStructure(prebuiltLadder(spec.id))).toEqual([]);
    }
  });

  it('refuses an empty structure', () => {
    expect(customStructureIsValid([])).toBe(false);
  });

  it('refuses decreasing blinds', () => {
    const problems = validateCustomStructure([
      level({ level: 1, smallBlind: 50, bigBlind: 100 }),
      level({ level: 2, smallBlind: 25, bigBlind: 50 }),
    ]);
    expect(problems).toEqual([{ level: 2, message: 'Blinds Cannot Decrease' }]);
  });

  it('refuses a non-positive duration, a bad big blind and a negative ante', () => {
    expect(validateCustomStructure([level({ durationMinutes: 0 })])[0].message).toBe(
      'Level Needs A Positive Duration'
    );
    expect(validateCustomStructure([level({ smallBlind: 100, bigBlind: 50 })])[0].message).toBe(
      'Big Blind Must Be Positive And At Least The Small Blind'
    );
    expect(validateCustomStructure([level({ ante: -5 })])[0].message).toBe(
      'Ante Cannot Be Negative'
    );
  });

  it('refuses a structure that opens with a break, and a break carrying blinds', () => {
    // A break-only structure has no playable level at all, which is the first
    // thing the contract refuses; the opening-break rule is reached once at
    // least one playable level exists.
    expect(
      validateCustomStructure([level({ isBreak: true, smallBlind: 0, bigBlind: 0 })])[0].message
    ).toBe('A Structure Needs At Least One Playable Level');
    expect(
      validateCustomStructure([
        level({ isBreak: true, smallBlind: 0, bigBlind: 0 }),
        level({ level: 2 }),
      ]).some((p) => p.message === 'A Structure Cannot Open With A Break')
    ).toBe(true);
    const problems = validateCustomStructure([level(), level({ level: 2, isBreak: true })]);
    expect(problems.some((p) => p.message === 'A Break Carries No Blinds Or Ante')).toBe(true);
  });
});
