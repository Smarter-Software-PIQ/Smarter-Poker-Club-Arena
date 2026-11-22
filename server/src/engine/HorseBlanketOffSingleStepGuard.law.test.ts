/**
 * LAW: CODE-LEVEL 1-AT-A-TIME BLANKET-OFF SETTINGS GUARD (2026-11-21, Horse Switch lane).
 *
 * Owner direction (2026-11-21 02:00 America/Chicago): every blanket rule comes off ONE AT A TIME, each tested and
 * validated before the next moves. This law proves the invariant is enforced in code across:
 *  1. `validateSingleBlanketOffStep` (HorseBlanketOffSingleStepGuard.ts):
 *     - 0 newly disabled blanket rules (no-op / non-blanket parameter updates): ALLOWED.
 *     - Re-enabling ANY number of blanket rules (emergency rollback, 1 -> 0 or list removal): ALWAYS ALLOWED.
 *     - Turning AT MOST 1 new blanket rule OFF in a single step: ALLOWED.
 *     - Turning >= 2 new blanket rules OFF in a single step (same prefix, cross-prefix, or array off-list):
 *       REFUSED with `code === 'BLANKET_OFF_MULTI_STEP_REFUSED'` and the exact sorted list of `newlyDisabled` rules.
 *  2. `createRuntimeSettingsStore` (runtimeSettings/store.ts):
 *     - Refuses an initial v1 publish or any live version transition that disables >= 2 new blanket rules, keeping the
 *       previous version serving and reporting `BLANKET_OFF_MULTI_STEP_REFUSED` in `lastRefusal`.
 *     - Allows step-by-step single disables (v1 -> v2 -> v3), multi-rule emergency rollbacks back ON, and cold-boot
 *       hydration of an already-established v2+ steady-state version (while still guarding subsequent live transitions).
 *  3. `checkRuntimeSettingsFile` (scripts/runtime-settings-publish.ts):
 *     - Enforces the same 1-at-a-time guard when validating a settings file against previous settings.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BLANKET_OFF_MULTI_STEP_REFUSED,
  extractDisabledBlanketRules,
  validateSingleBlanketOffStep,
} from './HorseBlanketOffSingleStepGuard.js';
import { OMAHA_BLANKET_ROW_OFF_SETTING_PREFIX } from './HorseOmahaBlanketRowsOffInPlo45Cash.js';
import { checkRuntimeSettingsJson } from './runtimeSettings/snapshot.js';
import { createRuntimeSettingsStore } from './runtimeSettings/store.js';

const quiet = { warn: () => undefined, log: () => undefined };
const ploKey = (name: string) => OMAHA_BLANKET_ROW_OFF_SETTING_PREFIX + name;
const holdemKey = (name: string) => `horse.holdemBlanketRuleOff.${name}`;

describe('HorseBlanketOffSingleStepGuard: pure transition validation', () => {
  it('allows 0 newly disabled blanket rules (no-op and non-blanket parameter updates)', () => {
    const empty = validateSingleBlanketOffStep({}, {});
    expect(empty).toEqual({ ok: true, newlyDisabled: [], reEnabled: [] });

    const nonBlanket = validateSingleBlanketOffStep(
      { 'lightning.fastFoldMedianMs': 600, [ploKey('ploPairedBoardFold')]: 1 },
      { 'lightning.fastFoldMedianMs': 700, [ploKey('ploPairedBoardFold')]: 1 }
    );
    expect(nonBlanket).toEqual({ ok: true, newlyDisabled: [], reEnabled: [] });

    expect(validateSingleBlanketOffStep(null, undefined)).toEqual({
      ok: true,
      newlyDisabled: [],
      reEnabled: [],
    });
  });

  it('allows turning AT MOST 1 new blanket rule OFF per version transition', () => {
    // 0 -> 1 Omaha blanket key
    const step1 = validateSingleBlanketOffStep({}, { [ploKey('v74OmahaSemiBluffNeedsDraw')]: 1 });
    expect(step1).toEqual({
      ok: true,
      newlyDisabled: [ploKey('v74OmahaSemiBluffNeedsDraw')],
      reEnabled: [],
    });

    // 1 -> 2 Omaha blanket keys (+1 new)
    const step2 = validateSingleBlanketOffStep(
      { [ploKey('v74OmahaSemiBluffNeedsDraw')]: 1 },
      { [ploKey('v74OmahaSemiBluffNeedsDraw')]: 1, [ploKey('ploPairedBoardFold')]: 1 }
    );
    expect(step2).toEqual({
      ok: true,
      newlyDisabled: [ploKey('ploPairedBoardFold')],
      reEnabled: [],
    });

    // Hold'em blanket key 0 -> 1
    const holdemStep = validateSingleBlanketOffStep({}, { [holdemKey('v66BetRaisedOnePair')]: 1 });
    expect(holdemStep).toEqual({
      ok: true,
      newlyDisabled: [holdemKey('v66BetRaisedOnePair')],
      reEnabled: [],
    });

    // Bare array off-list adding 1 rule
    const arrayStep = validateSingleBlanketOffStep(['ruleA'], ['ruleA', 'ruleB']);
    expect(arrayStep).toEqual({
      ok: true,
      newlyDisabled: ['ruleB'],
      reEnabled: [],
    });
  });

  it('ALWAYS allows turning ANY number of blanket rules back ON (emergency rollback is never blocked)', () => {
    const fourOff = {
      [ploKey('v74OmahaSemiBluffNeedsDraw')]: 1,
      [ploKey('ploPairedBoardFold')]: 1,
      [ploKey('ploPairedBoardRiverCheck')]: 1,
      [holdemKey('v66BetRaisedOnePair')]: 1,
    };
    const fullRollback = validateSingleBlanketOffStep(fourOff, {});
    expect(fullRollback.ok).toBe(true);
    expect(fullRollback.newlyDisabled).toEqual([]);
    expect(fullRollback.reEnabled).toEqual(
      [
        holdemKey('v66BetRaisedOnePair'),
        ploKey('ploPairedBoardFold'),
        ploKey('ploPairedBoardRiverCheck'),
        ploKey('v74OmahaSemiBluffNeedsDraw'),
      ].sort()
    );

    // Partial rollback (3 back ON) while turning 1 new rule OFF is also allowed (newlyDisabled === 1)
    const swapRollback = validateSingleBlanketOffStep(fourOff, {
      [ploKey('v74OmahaSemiBluffNeedsDraw')]: 1,
      [ploKey('omahaTurnSetPound')]: 1,
    });
    expect(swapRollback.ok).toBe(true);
    expect(swapRollback.newlyDisabled).toEqual([ploKey('omahaTurnSetPound')]);
    expect(swapRollback.reEnabled).toHaveLength(3);
  });

  it('REFUSES turning 2 or more new blanket rules OFF in a single step with BLANKET_OFF_MULTI_STEP_REFUSED', () => {
    // 0 -> 2 Omaha keys
    const twoOmaha = validateSingleBlanketOffStep(
      {},
      {
        [ploKey('ploPairedBoardFold')]: 1,
        [ploKey('v74OmahaSemiBluffNeedsDraw')]: 1,
      }
    );
    expect(twoOmaha.ok).toBe(false);
    if (twoOmaha.ok) return;
    expect(twoOmaha.code).toBe(BLANKET_OFF_MULTI_STEP_REFUSED);
    expect(twoOmaha.newlyDisabled).toEqual([
      ploKey('ploPairedBoardFold'),
      ploKey('v74OmahaSemiBluffNeedsDraw'),
    ]);
    expect(twoOmaha.reason).toContain(BLANKET_OFF_MULTI_STEP_REFUSED);
    expect(twoOmaha.reason).toContain('ploPairedBoardFold');
    expect(twoOmaha.reason).toContain('v74OmahaSemiBluffNeedsDraw');

    // 1 -> 3 (+2 new)
    const plusTwo = validateSingleBlanketOffStep(
      { [ploKey('v74OmahaSemiBluffNeedsDraw')]: 1 },
      {
        [ploKey('v74OmahaSemiBluffNeedsDraw')]: 1,
        [ploKey('ploPairedBoardFold')]: 1,
        [ploKey('omahaTurnSetPound')]: 1,
      }
    );
    expect(plusTwo.ok).toBe(false);
    if (plusTwo.ok) return;
    expect(plusTwo.code).toBe(BLANKET_OFF_MULTI_STEP_REFUSED);
    expect(plusTwo.newlyDisabled).toEqual([
      ploKey('omahaTurnSetPound'),
      ploKey('ploPairedBoardFold'),
    ]);

    // Cross-prefix: 1 new Omaha + 1 new Hold'em = 2 total -> REFUSED!
    const crossPrefix = validateSingleBlanketOffStep(
      {},
      {
        [ploKey('ploPairedBoardFold')]: 1,
        [holdemKey('v66BetRaisedOnePair')]: 1,
      }
    );
    expect(crossPrefix.ok).toBe(false);
    if (crossPrefix.ok) return;
    expect(crossPrefix.code).toBe(BLANKET_OFF_MULTI_STEP_REFUSED);
    expect(crossPrefix.newlyDisabled).toEqual([
      ploKey('ploPairedBoardFold'),
      holdemKey('v66BetRaisedOnePair'),
    ]);

    // Array off-list adding 2 rules -> REFUSED!
    const arrayMulti = validateSingleBlanketOffStep(['a'], ['a', 'c', 'b']);
    expect(arrayMulti.ok).toBe(false);
    if (arrayMulti.ok) return;
    expect(arrayMulti.code).toBe(BLANKET_OFF_MULTI_STEP_REFUSED);
    expect(arrayMulti.newlyDisabled).toEqual(['b', 'c']);
  });

  it('normalizes dotted keys and list properties identically', () => {
    const set = extractDisabledBlanketRules({
      omahaBlanketRowsOffList: ['ploPairedBoardFold'],
      holdemBlanketRulesOffList: ['v66BetRaisedOnePair'],
    });
    expect([...set].sort()).toEqual([
      ploKey('ploPairedBoardFold'),
      holdemKey('v66BetRaisedOnePair'),
    ]);

    // Transition from dotted key to list property with 1 new rule -> allowed
    const allowed = validateSingleBlanketOffStep(
      { [ploKey('ploPairedBoardFold')]: 1 },
      { omahaBlanketRowsOffList: ['ploPairedBoardFold', 'omahaTurnSetPound'] }
    );
    expect(allowed).toEqual({
      ok: true,
      newlyDisabled: [ploKey('omahaTurnSetPound')],
      reEnabled: [],
    });

    // Transition from dotted key to list property with 2 new rules -> refused
    const refused = validateSingleBlanketOffStep(
      { [ploKey('ploPairedBoardFold')]: 1 },
      {
        omahaBlanketRowsOffList: [
          'ploPairedBoardFold',
          'omahaTurnSetPound',
          'v74OmahaSemiBluffNeedsDraw',
        ],
      }
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe(BLANKET_OFF_MULTI_STEP_REFUSED);
  });
});

describe('HorseBlanketOffSingleStepGuard: runtime settings store & publisher wiring', () => {
  it('store refuses v1 or any live transition disabling >= 2 new blanket rules, while allowing 1-at-a-time & rollbacks', async () => {
    // 1. Initial v1 disabling 2 blanket rules is refused
    let next: unknown = {
      version: 1,
      settings: {
        [ploKey('v74OmahaSemiBluffNeedsDraw')]: 1,
        [ploKey('ploPairedBoardFold')]: 1,
      },
    };
    const store = createRuntimeSettingsStore({ read: async () => next, ...quiet });
    expect(await store.refresh()).toBe('refused');
    expect(store.current().version).toBe(0);
    expect(store.status().lastRefusal?.reason).toContain(BLANKET_OFF_MULTI_STEP_REFUSED);

    // 2. Step-by-step: v1 (1 rule) -> applied
    next = { version: 1, settings: { [ploKey('v74OmahaSemiBluffNeedsDraw')]: 1 } };
    expect(await store.refresh()).toBe('applied');
    expect(store.current().version).toBe(1);

    // 3. Live jump v1 -> v2 adding 2 more rules -> REFUSED; v1 keeps serving
    next = {
      version: 2,
      settings: {
        [ploKey('v74OmahaSemiBluffNeedsDraw')]: 1,
        [ploKey('ploPairedBoardFold')]: 1,
        [ploKey('omahaTurnSetPound')]: 1,
      },
    };
    expect(await store.refresh()).toBe('refused');
    expect(store.current().version).toBe(1);
    expect(store.status().lastRefusal?.version).toBe(2);
    expect(store.status().lastRefusal?.reason).toContain(BLANKET_OFF_MULTI_STEP_REFUSED);

    // 4. Single step v1 -> v3 (+1 rule) -> applied
    next = {
      version: 3,
      settings: {
        [ploKey('v74OmahaSemiBluffNeedsDraw')]: 1,
        [ploKey('ploPairedBoardFold')]: 1,
      },
    };
    expect(await store.refresh()).toBe('applied');
    expect(store.current().version).toBe(3);

    // 5. Emergency rollback v3 -> v4 (both back ON) -> ALWAYS applied
    next = { version: 4, settings: {} };
    expect(await store.refresh()).toBe('applied');
    expect(store.current().version).toBe(4);
  });

  it('store hydrates an established steady-state v2+ version on cold boot, then guards all subsequent live transitions', async () => {
    let next: unknown = {
      version: 5,
      settings: {
        [ploKey('v74OmahaSemiBluffNeedsDraw')]: 1,
        [ploKey('ploPairedBoardFold')]: 1,
        [ploKey('omahaTurnSetPound')]: 1,
      },
    };
    const store = createRuntimeSettingsStore({ read: async () => next, ...quiet });
    expect(await store.refresh()).toBe('applied');
    expect(store.current().version).toBe(5);

    // Subsequent live transition adding 2 more rules is refused
    next = {
      version: 6,
      settings: {
        [ploKey('v74OmahaSemiBluffNeedsDraw')]: 1,
        [ploKey('ploPairedBoardFold')]: 1,
        [ploKey('omahaTurnSetPound')]: 1,
        [ploKey('ploPairedBoardRiverCheck')]: 1,
        [ploKey('omahaRiverNutRaiseOnly')]: 1,
      },
    };
    expect(await store.refresh()).toBe('refused');
    expect(store.current().version).toBe(5);
    expect(store.status().lastRefusal?.reason).toContain(BLANKET_OFF_MULTI_STEP_REFUSED);
  });

  it('checkRuntimeSettingsJson and runtime-settings-publish.ts enforce the 1-at-a-time guard', () => {
    const prev = { [ploKey('v74OmahaSemiBluffNeedsDraw')]: 1 };

    // +1 new rule -> allowed
    const okOne = checkRuntimeSettingsJson(
      JSON.stringify({
        [ploKey('v74OmahaSemiBluffNeedsDraw')]: 1,
        [ploKey('ploPairedBoardFold')]: 1,
      }),
      prev
    );
    expect(okOne.ok).toBe(true);

    // Rollback -> allowed
    const okRollback = checkRuntimeSettingsJson(JSON.stringify({}), prev);
    expect(okRollback.ok).toBe(true);

    // +2 new rules -> refused with BLANKET_OFF_MULTI_STEP_REFUSED
    const refusedTwo = checkRuntimeSettingsJson(
      JSON.stringify({
        [ploKey('v74OmahaSemiBluffNeedsDraw')]: 1,
        [ploKey('ploPairedBoardFold')]: 1,
        [ploKey('omahaTurnSetPound')]: 1,
      }),
      prev
    );
    expect(refusedTwo.ok).toBe(false);
    expect(refusedTwo.code).toBe(BLANKET_OFF_MULTI_STEP_REFUSED);
    expect(refusedTwo.newlyDisabled).toEqual([
      ploKey('omahaTurnSetPound'),
      ploKey('ploPairedBoardFold'),
    ]);

    // Verify scripts/runtime-settings-publish.ts wires both checkRuntimeSettingsJson and pre-publish validateSingleBlanketOffStep
    const pubSrc = readFileSync(
      new URL('../../scripts/runtime-settings-publish.ts', import.meta.url),
      'utf8'
    );
    expect(pubSrc).toContain('checkRuntimeSettingsJson');
    expect(pubSrc).toContain('validateSingleBlanketOffStep');
    expect(pubSrc.indexOf('validateSingleBlanketOffStep(prevSettings, settings)')).toBeLessThan(
      pubSrc.indexOf("'fn_ca_engine_runtime_settings_publish'")
    );
  });
});
