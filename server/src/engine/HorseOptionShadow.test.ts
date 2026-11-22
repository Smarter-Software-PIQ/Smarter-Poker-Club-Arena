import { describe, expect, it } from 'vitest';
import {
  OPTION_SHADOW_PER_MINUTE_DEFAULT,
  OptionShadowBudget,
  optionShadowCounterKeys,
  optionShadowPerMinute,
  optionShadowPersonPresence,
  optionShadowPick,
  optionShadowReceiptOf,
} from './HorseOptionShadow.js';
import {
  OPTION_SWITCH_SHADOW_NAMES,
  OPTION_SWITCH_SHADOW_REFUSED,
  optionSwitchShadowFlip,
  optionSwitchShadowOptions,
  optionSwitchShadowRefusal,
} from './HorseOptionSwitch.js';

const base = {
  option: 'streetIQ',
  flippedTo: false,
  street: 'river',
  variant: 'nlh',
  format: 'cash' as const,
  personDealt: true,
  personLive: false,
};

describe('HorseOptionShadow', () => {
  it('the per-minute budget is a whole number 0..600, else the default', () => {
    expect(optionShadowPerMinute(undefined)).toBe(OPTION_SHADOW_PER_MINUTE_DEFAULT);
    expect(optionShadowPerMinute('')).toBe(OPTION_SHADOW_PER_MINUTE_DEFAULT);
    expect(optionShadowPerMinute('0')).toBe(0);
    expect(optionShadowPerMinute(' 30 ')).toBe(30);
    for (const bad of ['-1', '1.5', 'x', '601', '99999'])
      expect(optionShadowPerMinute(bad), bad).toBe(OPTION_SHADOW_PER_MINUTE_DEFAULT);
  });

  it('the budget answers true at most N times per clock minute, and never at 0', () => {
    const b = new OptionShadowBudget(2);
    expect([b.take(0), b.take(10), b.take(59_999)]).toEqual([true, true, false]);
    expect([b.take(60_000), b.take(60_001), b.take(60_002)]).toEqual([true, true, false]);
    expect(new OptionShadowBudget(0).take(0)).toBe(false);
    expect(new OptionShadowBudget(5).take(Number.NaN)).toBe(false);
  });

  it('people first: a person decision is never refused by the minute and takes a slot; Horse-only ones are dropped', () => {
    const b = new OptionShadowBudget(2);
    expect(b.admit(0, true)).toBe('within');
    expect(b.admit(1, false)).toBe('within');
    // the minute is full: a Horse-only decision is refused, a person decision is admitted over it
    expect(b.admit(2, false)).toBeNull();
    expect(b.admit(3, true)).toBe('person_over');
    expect(b.take(4, true)).toBe(true);
    expect(b.take(5)).toBe(false);
    // persons first in a minute leave the Horse-only decisions nothing
    const c = new OptionShadowBudget(2);
    expect([c.admit(0, true), c.admit(1, true), c.admit(2, false)]).toEqual([
      'within',
      'within',
      null,
    ]);
    // a new minute starts over
    expect(c.admit(60_000, false)).toBe('within');
    // 0 is the stop and refuses a person too; an unreadable clock refuses
    expect(new OptionShadowBudget(0).admit(0, true)).toBeNull();
    expect(new OptionShadowBudget(5).admit(Number.NaN, true)).toBeNull();
  });

  it('the pick is the decision key hash, stable, and null for none', () => {
    expect(optionShadowPick([], 'k')).toBeNull();
    const opts = ['a', 'b', 'c'];
    expect(optionShadowPick(opts, 'key-1')).toBe(optionShadowPick(opts, 'key-1'));
    const seen = new Set(Array.from({ length: 50 }, (_, i) => optionShadowPick(opts, `k${i}`)));
    expect(seen.size).toBe(3);
  });

  it('person presence: a seat that is not a Horse, dealt in; folded is dealt but not live', () => {
    const players = [
      { user_id: 'hero', seat: 1, is_horse: true, cards: [1, 2] },
      { user_id: 'h2', seat: 2, is_horse: true, cards: [1, 2] },
      { user_id: 'p3', seat: 3, is_horse: false, is_folded: true, cards: [1, 2] },
      { user_id: 'p4', seat: 4, is_horse: false, is_sitting_out: true, cards: [] },
    ];
    expect(optionShadowPersonPresence({ players }, 'hero')).toEqual({
      personDealt: true,
      personLive: false,
    });
    expect(optionShadowPersonPresence({ players, dealtSeatIds: [1, 2] }, 'hero')).toEqual({
      personDealt: false,
      personLive: false,
    });
    expect(
      optionShadowPersonPresence(
        { players: [...players, { user_id: 'p5', seat: 5, cards: [1] }], dealtSeatIds: [1, 5] },
        'hero'
      )
    ).toEqual({ personDealt: true, personLive: true });
  });

  it('the receipt: changed on action or amount, null would is not a change and counts nothing', () => {
    const same = optionShadowReceiptOf({
      ...base,
      actual: { action: 'call', amount: 4 },
      would: { action: 'call', amount: 4 },
    });
    expect(same.changed).toBe(false);
    expect(optionShadowCounterKeys(same)).toEqual([
      'option_shadow_streetIQ_same_seen',
      'option_shadow_streetIQ_same_person_seen',
    ]);
    const amt = optionShadowReceiptOf({
      ...base,
      personDealt: false,
      actual: { action: 'raise', amount: 9 },
      would: { action: 'raise', amount: 8 },
    });
    expect(amt.changed).toBe(true);
    expect(optionShadowCounterKeys(amt)).toEqual(['option_shadow_streetIQ_changed_seen']);
    const failed = optionShadowReceiptOf({ ...base, actual: { action: 'fold' }, would: null });
    expect(failed).toMatchObject({
      changed: false,
      would: null,
      actual: { action: 'fold', amount: null },
    });
    expect(optionShadowCounterKeys(failed)).toEqual([]);
  });

  it('the registry: shadow options are on/off, not off-only, not code, not process-wide; the flip opposes the acted value', () => {
    expect(OPTION_SWITCH_SHADOW_NAMES.length).toBeGreaterThan(100);
    for (const name of Object.keys(OPTION_SWITCH_SHADOW_REFUSED))
      expect(OPTION_SWITCH_SHADOW_NAMES, name).not.toContain(name);
    for (const name of OPTION_SWITCH_SHADOW_NAMES)
      expect(optionSwitchShadowRefusal(name), name).toBeNull();
    expect(optionSwitchShadowRefusal('commitUnderPot')).toMatch(/off-only/);
    expect(optionSwitchShadowRefusal('v7Barrels')).toMatch(/'code'/);
    // streetIQ is on by default, omahaTurnRiverRaiseIsPriced off by default
    expect(optionSwitchShadowFlip('streetIQ', {})).toBe(false);
    expect(optionSwitchShadowFlip('omahaTurnRiverRaiseIsPriced', {})).toBe(true);
    // an explicit acted value (a feature flag or the caller) wins over the release default
    expect(optionSwitchShadowFlip('streetIQ', { streetIQ: false })).toBe(true);
    expect(
      optionSwitchShadowFlip('omahaTurnRiverRaiseIsPriced', { omahaTurnRiverRaiseIsPriced: true })
    ).toBe(false);
    expect(optionSwitchShadowFlip('commitUnderPot', {})).toBeNull();
    expect(
      optionSwitchShadowOptions({
        streetIQ: 'shadow',
        omahaTurnRiverRaiseIsPriced: 'on',
        v16Hu: 'off',
      })
    ).toEqual(['streetIQ']);
    expect(optionSwitchShadowOptions(null)).toEqual([]);
  });
});
