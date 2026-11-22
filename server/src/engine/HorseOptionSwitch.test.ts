/**
 * EVERY DECISION UPGRADE HAS A LIVE SWITCH (2026-11-14): the registry, the parser, the holder and its fail-safe.
 * The runtime laws (real decisions, the migration whitelist, the refusals) are in
 * horseDecision/everyUpgradeHasALiveSwitch.law.test.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  STYLE_SWITCH_OPTIONS,
  STYLE_SWITCH_POLL_MS,
  STYLE_SWITCH_STALE_MS,
  StyleSwitchHolder,
} from './HorseStyleSwitch.js';
import {
  OPTION_SWITCH_OFF_ONLY,
  optionSwitchOffOnly,
  optionSwitchOnNote,
  optionSwitchOnNoteCites,
  OPTION_SWITCH_NOT_A_SWITCH,
  OPTION_SWITCH_NOTHING_SWITCHED,
  OPTION_SWITCH_PLAIN_NAMES,
  OPTION_SWITCH_PLAIN_REGISTRY,
  OPTION_SWITCH_REGISTRY,
  OptionSwitchHolder,
  optionSwitchDecisionOpts,
  optionSwitchSourceFromStates,
  optionSwitchStatesFrom,
  optionSwitchStatesOf,
  parseOptionSwitchConfig,
  styleConfigOf,
  type OptionSwitchReading,
  optionSwitchOnShadowRefusal,
  optionSwitchShadowRefusal,
} from './HorseOptionSwitch.js';

const v2 = (options: Record<string, unknown>, style: Record<string, unknown> = {}) => ({
  version: 2,
  style: { version: 1, options: style },
  options,
});

function holder(readings: Array<OptionSwitchReading | 'throw'>) {
  const notes: string[] = [];
  let i = 0;
  const h = new OptionSwitchHolder(
    () => {
      const r = readings[Math.min(i++, readings.length - 1)]!;
      if (r === 'throw') throw new Error('unreadable');
      return r;
    },
    (f) => notes.push(f)
  );
  return { h, notes };
}
const present = (raw: unknown, receivedAtMs: number): OptionSwitchReading => ({
  kind: 'present',
  raw,
  receivedAtMs,
});

describe('the registry', () => {
  it('carries the seven style options with all four states and every other ledger option with off and on', () => {
    expect(OPTION_SWITCH_REGISTRY.slice(0, 7).map((e) => e.name)).toEqual([
      ...STYLE_SWITCH_OPTIONS,
    ]);
    for (const e of OPTION_SWITCH_REGISTRY.slice(0, 7)) {
      expect(e.states).toEqual(['off', 'shadow', 'canary', 'on']);
      expect(e.shadowArm).toBe(true);
    }
    expect(OPTION_SWITCH_PLAIN_REGISTRY.length).toBeGreaterThan(150);
    for (const e of OPTION_SWITCH_PLAIN_REGISTRY) {
      // owner order 2026-11-14 22:01: every registered option has an on/off switch
      // owner 23:10: an off-only option (hold, harm, superseded) offers off alone
      // 2026-11-18: an option that is re-decided in shadow (optionSwitchShadowRefusal null) offers shadow too
      // 2026-11-19: an option that is re-decided in on_shadow (optionSwitchOnShadowRefusal null) offers on_shadow
      expect(e.states, e.name).toEqual(
        optionSwitchOffOnly(e.name)
          ? ['off']
          : optionSwitchShadowRefusal(e.name) === null
            ? ['off', 'shadow', 'on_shadow', 'on']
            : optionSwitchOnShadowRefusal(e.name) === null
              ? ['off', 'on_shadow', 'on']
              : ['off', 'on']
      );
      expect(e.shadowArm, e.name).toBe(false);
      expect(e.shadowRedecide === true, e.name).toBe(optionSwitchShadowRefusal(e.name) === null);
      expect(e.onShadowRedecide === true, e.name).toBe(
        optionSwitchOnShadowRefusal(e.name) === null
      );
      expect(['off', 'on', 'code'], e.name).toContain(e.releaseDefault);
      expect(e.owner.length, e.name).toBeGreaterThan(0);
      expect(e.scope.length, e.name).toBeGreaterThan(0);
      expect(e.description.length, e.name).toBeGreaterThan(0);
      expect(e.description, e.name).not.toMatch(/\n/);
      expect(Object.hasOwn(OPTION_SWITCH_NOT_A_SWITCH, e.name), e.name).toBe(false);
    }
    expect(optionSwitchStatesOf('commitUnderPot')).toEqual(['off']);
    expect(OPTION_SWITCH_OFF_ONLY.commitUnderPot).toEqual(
      expect.objectContaining({
        status: 'harm',
        reason: expect.stringMatching(/RESULTS-HU-NLH-016/),
      })
    );
    expect(optionSwitchStatesOf('huBbDefendsToPrice')).toEqual(['off']);
    expect(optionSwitchStatesOf('v41Leaks')).toBeNull();
    const note = optionSwitchOnNote('readScopedShrink', 'FILE.md', 'a'.repeat(64));
    expect(note).toBe(`authority: readScopedShrink FILE.md sha256 ${'a'.repeat(64)}`);
    expect(optionSwitchOnNoteCites('readScopedShrink', note)).toBe(true);
    expect(optionSwitchOnNoteCites('readShrinkResponse', note)).toBe(false);
    // 2026-11-18: an on/off option with a plain release default also takes shadow (a worker re-decision)
    expect(optionSwitchStatesOf('omahaHiLoTournamentFirstIn')).toEqual([
      'off',
      'shadow',
      'on_shadow',
      'on',
    ]);
    // 2026-11-19: a 'code' option (off in source, on by row) takes on_shadow, never shadow
    expect(optionSwitchStatesOf('omahaBareOverpairOopFlopCheck')).toEqual([
      'off',
      'on_shadow',
      'on',
    ]);
    expect(optionSwitchStatesOf('decisionTimeMs')).toBeNull();
    expect(optionSwitchStatesOf('styleFoldBluff')).toEqual(['off', 'shadow', 'canary', 'on']);
    expect(optionSwitchStatesOf('v54RiverBluff')).toBeNull();
  });
});

describe('the parser', () => {
  it('accepts the version 2 answer and names only the options that have a row, in registry order', () => {
    expect(parseOptionSwitchConfig(v2({}))).toEqual({ ok: true, states: {} });
    const parsed = parseOptionSwitchConfig(v2({ v62RiverBettorPolarity: 'off', v16Hu: 'off' }));
    expect(parsed).toEqual({ ok: true, states: { v16Hu: 'off', v62RiverBettorPolarity: 'off' } });
    expect(Object.keys((parsed as { states: object }).states)).toEqual([
      'v16Hu',
      'v62RiverBettorPolarity',
    ]);
  });

  it('accepts on for a registered option, beside a valid off', () => {
    expect(parseOptionSwitchConfig(v2({ v16Hu: 'off', readScopedShrink: 'on' }))).toEqual({
      ok: true,
      states: { v16Hu: 'off', readScopedShrink: 'on' },
    });
  });

  it('accepts the version 1 style answer (a database without the wider function) as nothing switched', () => {
    expect(parseOptionSwitchConfig({ version: 1, options: { styleFoldBluff: 'on' } })).toEqual({
      ok: true,
      states: {},
    });
  });

  it.each([
    ['shadow for an option without a shadow arm', v2({ v16Hu: 'shadow' })],
    ['canary for an option without a shadow arm', v2({ commitUnderPot: 'canary' })],
    ['on for an off-only option (measured harm)', v2({ commitUnderPot: 'on' })],
    [
      'on for an off-only option beside a valid off',
      v2({ v16Hu: 'off', huBbDefendsToPrice: 'on' }),
    ],
    ['a parameter that is not an on/off option', v2({ decisionTimeMs: 'on' })],
    ['an authority-gated option', v2({ v54RiverBluff: 'on' })],
    ['a style option in the non-style half', v2({ styleFoldBluff: 'on' })],
    ['an unknown state', v2({ v16Hu: 'yes' })],
    ['a boolean state', v2({ v16Hu: true })],
    ['an extra key', { ...v2({}), extra: 1 }],
    ['no style half', { version: 2, options: {} }],
    ['another version', { version: 3, style: { version: 1, options: {} }, options: {} }],
    ['an array', []],
    ['null', null],
    ['options as an array', { version: 2, style: {}, options: [] }],
  ])('rejects %s', (_name, raw) => {
    expect(parseOptionSwitchConfig(raw)).toEqual({ ok: false });
  });

  it('a row for a name this build does not know is skipped alone (anUnknownOptionRowIsSkippedAlone.law)', () => {
    expect(parseOptionSwitchConfig(v2({ notAnOption: 'on' }))).toEqual({ ok: true, states: {} });
    expect(parseOptionSwitchConfig(v2({ notAnOption: 'on', v16Hu: 'off' }))).toEqual({
      ok: true,
      states: { v16Hu: 'off' },
    });
  });

  it('styleConfigOf hands StyleSwitchHolder the style half of a version 2 answer and a version 1 answer whole', () => {
    const v1 = { version: 1, options: { styleFoldBluff: 'on' } };
    expect(styleConfigOf(v1)).toBe(v1);
    expect(styleConfigOf(v2({ v16Hu: 'on' }, { styleFoldBluff: 'on' }))).toEqual(v1);
    expect(styleConfigOf({ version: 2 })).toBeUndefined();
    expect(styleConfigOf(null)).toBeNull();
  });
});

describe('the decision options', () => {
  it('nothing switched gives {}; off passes false, on passes true, no row passes nothing', () => {
    expect(optionSwitchDecisionOpts(OPTION_SWITCH_NOTHING_SWITCHED)).toEqual({});
    expect(optionSwitchDecisionOpts(null)).toEqual({});
    expect(optionSwitchDecisionOpts({ v16Hu: 'off', readScopedShrink: 'off' })).toEqual({
      v16Hu: false,
      readScopedShrink: false,
    });
    expect(optionSwitchDecisionOpts({ v16Hu: 'off', readScopedShrink: 'on' })).toEqual({
      v16Hu: false,
      readScopedShrink: true,
    });
    // owner 23:10: an unvalidated on for an off-only option never passes true
    expect(optionSwitchDecisionOpts({ v16Hu: 'off', commitUnderPot: 'on' } as never)).toEqual({
      v16Hu: false,
    });
  });

  it('never yields a style key or any key outside the registry', () => {
    const all = Object.fromEntries(OPTION_SWITCH_PLAIN_NAMES.map((n) => [n, 'off' as const]));
    const opts = optionSwitchDecisionOpts(all);
    expect(Object.keys(opts)).toEqual([...OPTION_SWITCH_PLAIN_NAMES]);
    // the seven style options have their own switch (HorseStyleSwitch); a plain option may still be named style*
    expect(
      Object.keys(opts).filter((k) => (STYLE_SWITCH_OPTIONS as readonly string[]).includes(k))
    ).toEqual([]);
    // an unvalidated set cannot smuggle a key through
    expect(optionSwitchDecisionOpts({ v54RiverBluff: 'on' } as never)).toEqual({});
  });

  it('a recorded set round-trips through the replay source', () => {
    const states = optionSwitchStatesFrom({ commitUnderPot: 'off', v16Hu: 'off' })!;
    const h = new OptionSwitchHolder(optionSwitchSourceFromStates(states), () => {});
    expect(h.refresh(5)).toEqual(states);
    expect(optionSwitchStatesFrom({ v16Hu: 'shadow' })).toBeNull();
    expect(optionSwitchStatesFrom({ styleFoldBluff: 'on' })).toBeNull();
    expect(optionSwitchStatesFrom(null)).toBeNull();
  });
});

describe('the holder', () => {
  it('absent: nothing switched and no receipt', () => {
    const { h, notes } = holder([{ kind: 'absent' }]);
    expect(h.refresh(0)).toEqual({});
    expect(notes).toEqual([]);
  });

  it('a change fires option_switch_<option>_<value>_seen once, and a removed row fires _default_seen', () => {
    const { h, notes } = holder([
      present(v2({ commitUnderPot: 'off' }), 0),
      present(v2({ commitUnderPot: 'off' }), STYLE_SWITCH_POLL_MS),
      present(v2({ commitUnderPot: 'off', v16Hu: 'off' }), 2 * STYLE_SWITCH_POLL_MS),
      present(v2({ v16Hu: 'off' }), 3 * STYLE_SWITCH_POLL_MS),
    ]);
    expect(h.refresh(0)).toEqual({ commitUnderPot: 'off' });
    expect(h.refresh(STYLE_SWITCH_POLL_MS - 1)).toEqual({ commitUnderPot: 'off' });
    h.refresh(STYLE_SWITCH_POLL_MS);
    expect(notes).toEqual(['option_switch_commitUnderPot_off_seen']);
    h.refresh(2 * STYLE_SWITCH_POLL_MS);
    h.refresh(3 * STYLE_SWITCH_POLL_MS);
    expect(notes).toEqual([
      'option_switch_commitUnderPot_off_seen',
      'option_switch_v16Hu_off_seen',
      'option_switch_commitUnderPot_default_seen',
    ]);
  });

  it.each([
    ['unreadable', 'throw' as const, 'option_switch_config_unreadable_seen'],
    [
      'invalid',
      present({ nonsense: true }, STYLE_SWITCH_POLL_MS),
      'option_switch_config_invalid_seen',
    ],
    [
      'a reading without a receive time',
      { kind: 'present', raw: v2({ v16Hu: 'off' }) } as never,
      'option_switch_config_invalid_seen',
    ],
    [
      'stale at the read',
      present(v2({ v16Hu: 'off' }), -STYLE_SWITCH_STALE_MS),
      'option_switch_config_stale_seen',
    ],
  ])(
    'FAIL SAFE (%s): every switched option goes back to its release default',
    (_name, bad, receipt) => {
      const { h, notes } = holder([present(v2({ commitUnderPot: 'off', v16Hu: 'off' }), 0), bad]);
      expect(optionSwitchDecisionOpts(h.refresh(0))).toEqual({
        v16Hu: false,
        commitUnderPot: false,
      });
      const mark = notes.length;
      const after = h.refresh(STYLE_SWITCH_POLL_MS);
      // nothing switched: the option keys are not passed, so the code default decides. NOT "everything off".
      expect(after).toEqual({});
      expect(optionSwitchDecisionOpts(after)).toEqual({});
      expect(notes).toContain(receipt);
      expect(notes).toContain('option_switch_commitUnderPot_default_seen');
      expect(notes).toContain('option_switch_v16Hu_default_seen');
      // the failure itself turns nothing off: the only receipts after it are the failure and the two defaults
      expect(notes.slice(mark).filter((n) => n.endsWith('_off_seen'))).toEqual([]);
    }
  );

  it('strict staleness between reads: a configuration older than 120 s stops at the next refresh', () => {
    const { h, notes } = holder([present(v2({ v16Hu: 'off' }), 0)]);
    expect(h.refresh(0)).toEqual({ v16Hu: 'off' });
    // 59 s after a read at 61 s the poll is not due, yet the configuration is 121 s old
    const { h: h2, notes: n2 } = holder([
      present(v2({ v16Hu: 'off' }), 0),
      present(v2({ v16Hu: 'off' }), 0),
    ]);
    h2.refresh(0);
    expect(h2.refresh(STYLE_SWITCH_POLL_MS + 1_000)).toEqual({ v16Hu: 'off' });
    expect(h2.refresh(STYLE_SWITCH_STALE_MS + 1)).toEqual({});
    expect(n2).toEqual([
      'option_switch_v16Hu_off_seen',
      'option_switch_config_stale_seen',
      'option_switch_v16Hu_default_seen',
    ]);
    expect(notes).toEqual(['option_switch_v16Hu_off_seen']);
  });

  it('THE TWO FAIL-SAFE RULES DIFFER: on the same broken delivery a style option reads OFF, any other option reads its RELEASE DEFAULT', () => {
    const good = v2({ commitUnderPot: 'off' }, { styleFoldBluff: 'on' });
    const styleNotes: string[] = [];
    const optionNotes: string[] = [];
    let raw: unknown = good;
    const style = new StyleSwitchHolder(
      (now) => ({ kind: 'present', raw: styleConfigOf(raw), receivedAtMs: now }),
      (f) => styleNotes.push(f)
    );
    const option = new OptionSwitchHolder(
      (now) => ({ kind: 'present', raw, receivedAtMs: now }),
      (f) => optionNotes.push(f)
    );
    expect(style.refresh(0).styleFoldBluff).toBe('on');
    expect(option.refresh(0)).toEqual({ commitUnderPot: 'off' });
    raw = 'garbage';
    // style: an explicit state, off
    expect(style.refresh(STYLE_SWITCH_POLL_MS).styleFoldBluff).toBe('off');
    expect(styleNotes).toContain('style_switch_styleFoldBluff_off_seen');
    // every other option: no state at all (the release default), and the receipt says default, not off
    expect(option.refresh(STYLE_SWITCH_POLL_MS)).toEqual({});
    expect(optionNotes).toContain('option_switch_commitUnderPot_default_seen');
  });

  it('one half broken does not take the other down', () => {
    // the non-style half names an option this engine does not know: style still on, nothing else switched
    const raw = v2({ somethingNewer: 'on' }, { styleFoldBluff: 'on' });
    const style = new StyleSwitchHolder(
      (now) => ({ kind: 'present', raw: styleConfigOf(raw), receivedAtMs: now }),
      () => {}
    );
    const notes: string[] = [];
    const option = new OptionSwitchHolder(
      (now) => ({ kind: 'present', raw, receivedAtMs: now }),
      (f) => notes.push(f)
    );
    expect(style.refresh(0).styleFoldBluff).toBe('on');
    expect(option.refresh(0)).toEqual({});
    expect(notes).toEqual(['option_switch_config_invalid_seen']);
  });
});
