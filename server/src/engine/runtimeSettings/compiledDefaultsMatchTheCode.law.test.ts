/**
 * LAW (2026-11-19): EVERY RUNTIME-TUNABLE SETTING HAS A PUBLISHED DEFAULT EQUAL TO ITS COMPILED DEFAULT.
 *
 * Moving a tunable onto the runtime settings channel must not change play. So:
 * 1. every registry compiledDefault equals the constant the code itself reads;
 * 2. the first published version (the seed of migration 20261119211354) names every registered key with exactly that
 *    value, and parses in the engine to the compiled snapshot;
 * 3. at those values no Horse decision option is passed and the Lightning timing is the compiled tuning;
 * 4. every key has a reader, and each reader pins at a hand boundary.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { V65_TURN_SHADE_CAP, V67_RIVER_RAISE_SHADE, V68_AIR_SHADE_SCALE } from '../HorseLogic.js';
import {
  LIGHTNING_HORSE_FAST_FOLD_COMPILED_TUNING,
  LIGHTNING_HORSE_FAST_FOLD_FLOOR_MS,
  LIGHTNING_HORSE_FAST_FOLD_MAX_MS,
  LIGHTNING_HORSE_FAST_FOLD_MEDIAN_MS,
  LIGHTNING_HORSE_FAST_FOLD_SIGMA,
  LIGHTNING_HORSE_FAST_FOLD_TEMPO_MAX,
  LIGHTNING_HORSE_FAST_FOLD_TEMPO_MIN,
} from '../../lightning/LightningHorse.js';
import {
  horseDecideOptsFromRuntimeSettings,
  horseRuntimeSettingOptions,
  lightningFastFoldTuningFrom,
} from './apply.js';
import { RUNTIME_SETTINGS_REGISTRY } from './registry.js';
import { COMPILED_RUNTIME_SETTINGS, parseRuntimeSettings } from './snapshot.js';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (p: string) => readFileSync(join(REPO, p), 'utf8');
const MIGRATION =
  'supabase/migrations/20261119211354_engine_settings_change_at_the_next_hand_without_a_cutover.sql';

/** The constant the code reads for each key. */
const CODE_VALUE: Readonly<Record<string, number>> = {
  'horse.v67RiverRaiseShade': V67_RIVER_RAISE_SHADE,
  'horse.v65TurnShadeCap': V65_TURN_SHADE_CAP,
  'horse.v68AirShadeScale': V68_AIR_SHADE_SCALE,
  // HorsePreflop applies the bump only when 0 < x <= 0.2 (pinned below): 0 is the code's "no bump"
  'horse.tournamentFlatBump': 0,
  'lightning.fastFoldFloorMs': LIGHTNING_HORSE_FAST_FOLD_FLOOR_MS,
  'lightning.fastFoldMedianMs': LIGHTNING_HORSE_FAST_FOLD_MEDIAN_MS,
  'lightning.fastFoldSigma': LIGHTNING_HORSE_FAST_FOLD_SIGMA,
  'lightning.fastFoldMaxMs': LIGHTNING_HORSE_FAST_FOLD_MAX_MS,
  'lightning.fastFoldTempoMin': LIGHTNING_HORSE_FAST_FOLD_TEMPO_MIN,
  'lightning.fastFoldTempoMax': LIGHTNING_HORSE_FAST_FOLD_TEMPO_MAX,
};

function seed(): Record<string, unknown> {
  const sql = read(MIGRATION);
  const block = /\(runtime settings seed: begin\)([\s\S]*?)\(runtime settings seed: end\)/.exec(
    sql
  );
  if (!block) throw new Error('the migration has no runtime settings seed block');
  const json = /'(\{[^']*\})'::jsonb/.exec(block[1]!);
  if (!json) throw new Error('the seed block has no settings literal');
  return JSON.parse(json[1]!) as Record<string, unknown>;
}

describe('every runtime-tunable setting has a published default equal to its compiled default', () => {
  it('every key is listed once, its default is the code constant, and the default is inside its own range', () => {
    const keys = RUNTIME_SETTINGS_REGISTRY.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(Object.keys(CODE_VALUE).sort()).toEqual([...keys].sort());
    for (const spec of RUNTIME_SETTINGS_REGISTRY) {
      expect(spec.compiledDefault, spec.key).toBe(CODE_VALUE[spec.key]);
      expect(spec.compiledDefault, spec.key).toBeGreaterThanOrEqual(spec.min);
      expect(spec.compiledDefault, spec.key).toBeLessThanOrEqual(spec.max);
      expect(spec.key).toMatch(/^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/);
    }
  });

  it('the published version 1 names every key with exactly its compiled default', () => {
    const published = seed();
    expect(Object.keys(published).sort()).toEqual(
      RUNTIME_SETTINGS_REGISTRY.map((s) => s.key).sort()
    );
    for (const spec of RUNTIME_SETTINGS_REGISTRY)
      expect(published[spec.key], spec.key).toBe(spec.compiledDefault);
    const parsed = parseRuntimeSettings({ version: 1, settings: published });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.snapshot.values).toEqual(COMPILED_RUNTIME_SETTINGS.values);
    // so version 1 changes nothing a hand reads
    expect(horseDecideOptsFromRuntimeSettings(parsed.snapshot)).toBeUndefined();
    expect(lightningFastFoldTuningFrom(parsed.snapshot)).toEqual(
      LIGHTNING_HORSE_FAST_FOLD_COMPILED_TUNING
    );
  });

  it('every key has a reader', () => {
    const horse = horseRuntimeSettingOptions();
    for (const spec of RUNTIME_SETTINGS_REGISTRY) {
      if (spec.consumer === 'horse_decision') expect(horse[spec.key], spec.key).toBeDefined();
      else expect(spec.key.startsWith('lightning.fastFold'), spec.key).toBe(true);
    }
    expect(
      Object.keys(horse).every((k) => RUNTIME_SETTINGS_REGISTRY.some((s) => s.key === k))
    ).toBe(true);
  });

  it('the code reads each Horse parameter through its option with the constant as the fallback', () => {
    const logic = read('server/src/engine/HorseLogic.ts');
    expect(logic).toContain('opts.v67RiverRaiseShadeOverride ?? V67_RIVER_RAISE_SHADE');
    expect(logic).toContain('opts.v65TurnShadeCapOverride ?? V65_TURN_SHADE_CAP');
    expect(logic).toContain('opts.v68AirShadeScaleOverride ?? V68_AIR_SHADE_SCALE');
    const preflop = read('server/src/engine/HorsePreflop.ts');
    expect(preflop).toMatch(/ctx\.tournamentFlatBump > 0 &&\s*ctx\.tournamentFlatBump <= 0\.2/);
  });

  it('each reader pins its settings at a hand boundary', () => {
    const dealing = read('server/src/engine/ServerTableEngineDealing.ts');
    expect(dealing).toMatch(
      /this\.currentHandStartedAt = handStartMs;[\s\S]{0,400}this\.currentHandRuntimeSettings = pinEngineRuntimeSettings\(\s*`table:\$\{this\.tableId\}`,\s*String\(handNumber\)\s*\)/
    );
    const turns = read('server/src/engine/ServerTableEngineTurns.ts');
    expect(turns).toContain('horseDecideOptsFromRuntimeSettings(this.currentHandRuntimeSettings)');
    const host = read('server/src/lightning/LightningHandHost.ts');
    expect(host).toContain(
      'pinEngineRuntimeSettings(`lightning:${formed.clusterId}`, formed.handId)'
    );
    expect(host.match(/tuning: this\.fastFoldTuning/g)).toHaveLength(2);
    expect(host.match(/horseOpts: this\.runtimeHorseOpts/g)).toHaveLength(2);
    const lane = read('server/src/engine/horseDecision/lane.ts');
    expect(lane).toContain('startEngineRuntimeSettingsFromDatabase()');
  });

  it('the migration is one transaction and only service_role reaches it', () => {
    const sql = read(MIGRATION).replace(/--[^\n]*/g, '');
    expect(sql).toMatch(/^\s*BEGIN;[\s\S]*COMMIT;\s*$/);
    const grantees = [...sql.matchAll(/GRANT\s+[^;]*?\sTO\s+([^;]*);/g)].map((m) => m[1]!.trim());
    expect([...new Set(grantees)]).toEqual(['service_role']);
    expect(sql.match(/ENABLE ROW LEVEL SECURITY/g)).toHaveLength(3);
  });
});
