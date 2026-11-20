/**
 * ENGINE RUNTIME SETTINGS (2026-11-19): load, validate, apply at the hand boundary, fail safe, roll back, audit.
 */
import { describe, expect, it } from 'vitest';
import { horseDecideOptsFromRuntimeSettings, lightningFastFoldTuningFrom } from './apply.js';
import { RUNTIME_SETTINGS_REGISTRY } from './registry.js';
import { COMPILED_RUNTIME_SETTINGS, parseRuntimeSettings } from './snapshot.js';
import { createRuntimeSettingsStore, type RuntimeSettingsUseRow } from './store.js';
import {
  LIGHTNING_HORSE_FAST_FOLD_COMPILED_TUNING,
  lightningHorseFastFoldReactionMs,
} from '../../lightning/LightningHorse.js';
import { buildHorseDecisionKey } from '../horseDecision/protocol.js';

const quiet = { warn: () => undefined, log: () => undefined };
const answer = (version: number, settings: Record<string, unknown>) => ({ version, settings });

describe('parseRuntimeSettings', () => {
  it('nothing published is the compiled defaults, version 0', () => {
    expect(parseRuntimeSettings(null)).toEqual({ ok: true, snapshot: COMPILED_RUNTIME_SETTINGS });
    expect(COMPILED_RUNTIME_SETTINGS.version).toBe(0);
  });

  it('a partial version keeps the compiled default of every key it leaves out', () => {
    const r = parseRuntimeSettings(answer(4, { 'lightning.fastFoldMedianMs': 650 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.snapshot.version).toBe(4);
    expect(r.snapshot.values['lightning.fastFoldMedianMs']).toBe(650);
    for (const spec of RUNTIME_SETTINGS_REGISTRY)
      if (spec.key !== 'lightning.fastFoldMedianMs')
        expect(r.snapshot.values[spec.key]).toBe(spec.compiledDefault);
    expect(Object.isFrozen(r.snapshot.values)).toBe(true);
  });

  it.each([
    ['an unknown key', { 'horse.notARealSetting': 1 }, /unknown setting horse.notARealSetting/],
    ['a value out of range', { 'horse.tournamentFlatBump': 0.3 }, /outside 0..0.2/],
    ['a value of the wrong kind', { 'horse.v67RiverRaiseShade': '0.2' }, /not a finite number/],
    ['a fraction for a whole-number key', { 'lightning.fastFoldFloorMs': 450.5 }, /whole number/],
    [
      'a broken cross rule',
      { 'lightning.fastFoldTempoMin': 2, 'lightning.fastFoldTempoMax': 1 },
      /must not exceed/,
    ],
    ['a floor at or above the ceiling', { 'lightning.fastFoldFloorMs': 3000 }, /must be below/],
  ])('%s refuses the whole version', (_label, settings, reason) => {
    const r = parseRuntimeSettings(answer(7, settings));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.version).toBe(7);
    expect(r.reason).toMatch(reason);
  });

  it('a malformed answer is refused', () => {
    expect(parseRuntimeSettings([]).ok).toBe(false);
    expect(parseRuntimeSettings({ version: 0, settings: {} }).ok).toBe(false);
    expect(parseRuntimeSettings({ version: 2, settings: [] }).ok).toBe(false);
  });
});

describe('the store', () => {
  it('a new version lands at the next hand boundary, never inside a hand already dealt', async () => {
    let next: unknown = answer(1, {});
    const store = createRuntimeSettingsStore({ read: async () => next, ...quiet });
    await store.refresh();
    const handA = store.pinHand('table:t1', '100');
    expect(handA.version).toBe(1);

    next = answer(2, { 'horse.v67RiverRaiseShade': 0.2 });
    expect(await store.refresh()).toBe('applied');
    // the hand in play keeps reading version 1 to its end, however often it asks
    expect(store.pinHand('table:t1', '100')).toBe(handA);
    expect(store.pinHand('table:t1', '100').values['horse.v67RiverRaiseShade']).toBe(0.1);
    // the next hand of that table takes version 2
    const handB = store.pinHand('table:t1', '101');
    expect(handB.version).toBe(2);
    expect(handB.values['horse.v67RiverRaiseShade']).toBe(0.2);
    expect(store.handVersion('table:t1', '100')).toBe(1);
    expect(store.handVersion('table:t1', '101')).toBe(2);
  });

  it('a refused version keeps the last good version serving, and is reported once', async () => {
    const warns: string[] = [];
    let next: unknown = answer(3, { 'lightning.fastFoldMedianMs': 700 });
    const store = createRuntimeSettingsStore({
      read: async () => next,
      warn: (m) => warns.push(m),
      log: () => undefined,
    });
    await store.refresh();
    next = answer(4, { 'lightning.fastFoldMedianMs': 700, 'horse.futureKey': 1 });
    expect(await store.refresh()).toBe('refused');
    expect(await store.refresh()).toBe('refused');
    expect(store.current().version).toBe(3);
    expect(store.pinHand('table:t', '1').values['lightning.fastFoldMedianMs']).toBe(700);
    expect(warns.filter((w) => w.includes('refused version 4'))).toHaveLength(1);
    expect(store.status().lastRefusal?.version).toBe(4);
  });

  it('a failed or timed-out read keeps the current settings', async () => {
    let mode: 'ok' | 'throw' | 'hang' = 'ok';
    const store = createRuntimeSettingsStore({
      read: () =>
        mode === 'ok'
          ? Promise.resolve(answer(5, { 'horse.v65TurnShadeCap': 0.08 }))
          : mode === 'throw'
            ? Promise.reject(new Error('connection reset'))
            : new Promise(() => undefined),
      readTimeoutMs: 20,
      ...quiet,
    });
    expect(await store.refresh()).toBe('applied');
    mode = 'throw';
    expect(await store.refresh()).toBe('failed');
    mode = 'hang';
    expect(await store.refresh()).toBe('failed');
    expect(store.current().version).toBe(5);
    expect(store.status().consecutiveFailures).toBe(2);
    mode = 'ok';
    expect(await store.refresh()).toBe('unchanged');
    expect(store.status().consecutiveFailures).toBe(0);
  });

  it('before any good read every hand pins the compiled defaults', async () => {
    const store = createRuntimeSettingsStore({
      read: () => Promise.reject(new Error('down')),
      ...quiet,
    });
    await store.refresh();
    expect(store.pinHand('table:x', '1')).toBe(COMPILED_RUNTIME_SETTINGS);
    expect(createRuntimeSettingsStore().pinHand('table:y', '1')).toBe(COMPILED_RUNTIME_SETTINGS);
  });

  it('a rollback is a new version with the old values, applied at the next hand like any other', async () => {
    let next: unknown = answer(1, {});
    const store = createRuntimeSettingsStore({ read: async () => next, ...quiet });
    await store.refresh();
    next = answer(2, { 'lightning.fastFoldSigma': 0.9 });
    await store.refresh();
    expect(store.pinHand('lightning:c1', 'h1').values['lightning.fastFoldSigma']).toBe(0.9);
    next = answer(3, {});
    expect(await store.refresh()).toBe('applied');
    const after = store.pinHand('lightning:c1', 'h2');
    expect(after.version).toBe(3);
    expect(after.values).toEqual(COMPILED_RUNTIME_SETTINGS.values);
  });

  it('audits one row per scope each time the version its hands pin changes, and keeps rows a failed write could not store', async () => {
    let next: unknown = answer(1, {});
    const written: RuntimeSettingsUseRow[][] = [];
    let failWrite = true;
    const store = createRuntimeSettingsStore({
      read: async () => next,
      recordUse: async (rows) => {
        if (failWrite) throw new Error('db down');
        written.push([...rows]);
      },
      now: () => Date.parse('2026-11-19T21:00:00Z'),
      ...quiet,
    });
    await store.refresh();
    store.pinHand('table:a', '1');
    store.pinHand('table:a', '2');
    store.pinHand('table:a', '3');
    store.pinHand('table:b', '9');
    next = answer(2, { 'horse.v68AirShadeScale': 0.5 });
    await store.refresh();
    store.pinHand('table:a', '4');
    store.pinHand('table:a', '5');
    await store.flushAudit();
    expect(written).toHaveLength(0);
    expect(store.status().pendingAuditRows).toBe(3);
    failWrite = false;
    await store.flushAudit();
    expect(written).toEqual([
      [
        {
          scope: 'table:a',
          hand_id: '1',
          version: 1,
          previous_version: null,
          pinned_at: '2026-11-19T21:00:00.000Z',
        },
        {
          scope: 'table:b',
          hand_id: '9',
          version: 1,
          previous_version: null,
          pinned_at: '2026-11-19T21:00:00.000Z',
        },
        {
          scope: 'table:a',
          hand_id: '4',
          version: 2,
          previous_version: 1,
          pinned_at: '2026-11-19T21:00:00.000Z',
        },
      ],
    ]);
    expect(store.status().pendingAuditRows).toBe(0);
  });

  it('start reads once at once and stop ends the polling', async () => {
    let reads = 0;
    const store = createRuntimeSettingsStore({
      read: async () => {
        reads += 1;
        return answer(1, {});
      },
      intervalMs: 60_000,
      ...quiet,
    });
    await store.start();
    expect(reads).toBe(1);
    expect(store.current().version).toBe(1);
    store.stop();
  });
});

describe('where the settings are read', () => {
  it('at the compiled defaults the Horse decision gets no options at all, so its request and key are unchanged', () => {
    expect(horseDecideOptsFromRuntimeSettings(COMPILED_RUNTIME_SETTINGS)).toBeUndefined();
    expect(horseDecideOptsFromRuntimeSettings(undefined)).toBeUndefined();
    expect(lightningFastFoldTuningFrom(undefined)).toEqual(
      LIGHTNING_HORSE_FAST_FOLD_COMPILED_TUNING
    );
    const v1 = parseRuntimeSettings(
      answer(
        1,
        Object.fromEntries(RUNTIME_SETTINGS_REGISTRY.map((s) => [s.key, s.compiledDefault]))
      )
    );
    expect(v1.ok && horseDecideOptsFromRuntimeSettings(v1.snapshot)).toBeUndefined();
  });

  it('a changed Horse parameter is passed as its decision option, and only that one', () => {
    const r = parseRuntimeSettings(
      answer(2, {
        'horse.v65TurnShadeCap': 0.08,
        'horse.tournamentFlatBump': 0.06,
        'lightning.fastFoldSigma': 0.7,
      })
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const opts = horseDecideOptsFromRuntimeSettings(r.snapshot);
    expect(opts).toEqual({ v65TurnShadeCapOverride: 0.08, tournamentFlatBump: 0.06 });
    // the decision key binds the options, so a replay of the journaled request is exact
    const base = {
      fence: 'f',
      decisionTimeMs: 0,
      player: { user_id: 'u' } as never,
      gameState: { stage: 'turn' } as never,
    };
    expect(buildHorseDecisionKey({ ...base, opts })).not.toBe(buildHorseDecisionKey(base));
  });

  it('the Lightning fast-fold timing at the compiled defaults is exactly the compiled tuning, draw for draw', () => {
    expect(lightningFastFoldTuningFrom(COMPILED_RUNTIME_SETTINGS)).toEqual(
      LIGHTNING_HORSE_FAST_FOLD_COMPILED_TUNING
    );
    const seq = (seed: number) => {
      let x = seed;
      return () => (x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    };
    for (let i = 0; i < 200; i++) {
      const userId = `horse-${i}`;
      expect(
        lightningHorseFastFoldReactionMs({
          userId,
          random: seq(i + 1),
          tuning: lightningFastFoldTuningFrom(COMPILED_RUNTIME_SETTINGS),
        })
      ).toBe(lightningHorseFastFoldReactionMs({ userId, random: seq(i + 1) }));
    }
  });

  it('a published Lightning timing moves the draw inside its own floor and ceiling', () => {
    const r = parseRuntimeSettings(
      answer(9, { 'lightning.fastFoldFloorMs': 900, 'lightning.fastFoldMaxMs': 1000 })
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const tuning = lightningFastFoldTuningFrom(r.snapshot);
    for (let i = 0; i < 100; i++) {
      const ms = lightningHorseFastFoldReactionMs({ userId: `h${i}`, random: Math.random, tuning });
      expect(ms).toBeGreaterThanOrEqual(900);
      expect(ms).toBeLessThanOrEqual(1000);
    }
  });
});
