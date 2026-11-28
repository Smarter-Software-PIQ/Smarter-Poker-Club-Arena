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
import { HORSE_CASH_STACK_CEILING_COMPILED_BB } from '../../services/HorseCashStackCeiling.js';
import {
  OPENER_ANSWERS_PRIOR_VERSION_DEFAULT,
  RERAISE_FOLD_SHARE_CAP_DEFAULT,
} from '../HorseOopReraiseRangeHolds.js';
import { horseCashStackCeilingBBFrom } from './apply.js';
import {
  OMAHA_OPTION_GAME_SCOPE_OPTIONS,
  OMAHA_OPTION_GAME_SCOPE_SETTING_PREFIX,
  omahaOptionGameScopeFromSettings,
} from '../HorseOmahaOptionGameScope.js';
import {
  OMAHA_BLANKET_ROWS_OFF_REGISTRY,
  OMAHA_BLANKET_ROW_OFF_SETTING_PREFIX,
  omahaBlanketRowsOffListFromSettings,
} from '../HorseOmahaBlanketRowsOffInPlo45Cash.js';
import {
  VPIP_FLOOR_TEN_HAND_WINDOW_GAMES,
  VPIP_FLOOR_TEN_HAND_WINDOW_GAME_SETTING_PREFIX,
  vpipFloorTenHandWindowGamesFromSettings,
} from '../HorseVpipFloorTenHandWindowGames.js';
import { RUNTIME_SETTINGS_REGISTRY } from './registry.js';
import { COMPILED_RUNTIME_SETTINGS, parseRuntimeSettings } from './snapshot.js';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (p: string) => readFileSync(join(REPO, p), 'utf8');
const MIGRATION =
  'supabase/migrations/20261119211354_engine_settings_change_at_the_next_hand_without_a_cutover.sql';

/** The game scope keys of the omaha* options (HorseOmahaOptionGameScope.ts), one per listed option. */
const GAME_SCOPE_KEYS: readonly string[] = OMAHA_OPTION_GAME_SCOPE_OPTIONS.map(
  (option) => OMAHA_OPTION_GAME_SCOPE_SETTING_PREFIX + option
);

/** The declared-list keys of omahaBlanketRowsOffInPlo45Cash, one per registry member. */
const BLANKET_ROW_OFF_KEYS: readonly string[] = OMAHA_BLANKET_ROWS_OFF_REGISTRY.map(
  (option) => OMAHA_BLANKET_ROW_OFF_SETTING_PREFIX + option
);

/** The game keys of vpipFloorLimpOnlyTenHandWindow (HorseVpipFloorTenHandWindowGames.ts), one per variant. */
const TEN_HAND_WINDOW_GAME_KEYS: readonly string[] = VPIP_FLOOR_TEN_HAND_WINDOW_GAMES.map(
  (game) => VPIP_FLOOR_TEN_HAND_WINDOW_GAME_SETTING_PREFIX + game
);

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
  'horse.cashStackCeilingBB': HORSE_CASH_STACK_CEILING_COMPILED_BB,
  'horse.reraiseFoldShareCap': RERAISE_FOLD_SHARE_CAP_DEFAULT,
  'horse.openerAnswersPriorVersion': OPENER_ANSWERS_PRIOR_VERSION_DEFAULT,
  // HorseOmahaOptionGameScope: 0 is "no scope" (only 4 or 5 confines an option to a game)
  ...Object.fromEntries(GAME_SCOPE_KEYS.map((key) => [key, 0])),
  // HorseOmahaBlanketRowsOffInPlo45Cash: 0 is "not listed" (only 1 lists a blanket row)
  ...Object.fromEntries(BLANKET_ROW_OFF_KEYS.map((key) => [key, 0])),
  // HorseVpipFloorTenHandWindowGames: 0 is "not listed" (no game listed = the switch as published)
  ...Object.fromEntries(TEN_HAND_WINDOW_GAME_KEYS.map((key) => [key, 0])),
};

/**
 * Keys registered AFTER the seed migration was installed. An installed migration is never edited, and a key a
 * published version does not name keeps its compiled default (snapshot.ts), so version 1 still parses to the
 * compiled snapshot with these absent. Each one must be absent from the seed.
 */
const ADDED_AFTER_THE_SEED: readonly string[] = [
  'horse.cashStackCeilingBB',
  'horse.reraiseFoldShareCap',
  'horse.openerAnswersPriorVersion',
  ...GAME_SCOPE_KEYS,
  ...BLANKET_ROW_OFF_KEYS,
  ...TEN_HAND_WINDOW_GAME_KEYS,
];

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
      RUNTIME_SETTINGS_REGISTRY.map((s) => s.key)
        .filter((k) => !ADDED_AFTER_THE_SEED.includes(k))
        .sort()
    );
    for (const key of ADDED_AFTER_THE_SEED) expect(published[key], key).toBeUndefined();
    for (const spec of RUNTIME_SETTINGS_REGISTRY)
      if (!ADDED_AFTER_THE_SEED.includes(spec.key))
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
    expect(horseCashStackCeilingBBFrom(parsed.snapshot)).toBe(0);
  });

  it('every key has a reader', () => {
    const horse = horseRuntimeSettingOptions();
    for (const spec of RUNTIME_SETTINGS_REGISTRY) {
      if (spec.consumer === 'horse_decision') expect(horse[spec.key], spec.key).toBeDefined();
      else if (spec.consumer === 'horse_stack_management')
        expect(spec.key, spec.key).toBe('horse.cashStackCeilingBB'); // horseCashStackCeilingBBFrom
      else if (spec.consumer === 'horse_blanket_rows_off')
        // omahaBlanketRowsOffListFromSettings (read by horseDecideOptsFromRuntimeSettings)
        expect(omahaBlanketRowsOffListFromSettings({ [spec.key]: 1 }), spec.key).toEqual([
          spec.key.slice(OMAHA_BLANKET_ROW_OFF_SETTING_PREFIX.length),
        ]);
      else if (spec.consumer === 'horse_ten_hand_window_games')
        // vpipFloorTenHandWindowGamesFromSettings (read by horseDecideOptsFromRuntimeSettings)
        expect(vpipFloorTenHandWindowGamesFromSettings({ [spec.key]: 1 }), spec.key).toEqual([
          spec.key.slice(VPIP_FLOOR_TEN_HAND_WINDOW_GAME_SETTING_PREFIX.length),
        ]);
      else if (spec.consumer === 'horse_option_game_scope')
        // omahaOptionGameScopeFromSettings (read by horseDecideOptsFromRuntimeSettings)
        expect(omahaOptionGameScopeFromSettings({ [spec.key]: 5 }), spec.key).toEqual({
          [spec.key.slice(OMAHA_OPTION_GAME_SCOPE_SETTING_PREFIX.length)]: 5,
        });
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
    // the stack ceiling is read from the hand's pinned snapshot at its settlement, and from the pool hand's
    const settlement = read('server/src/engine/ServerTableEngineSettlement.ts');
    // (read through the synchronous settlement snapshot, which pins this hand's settings: StaleContinuationSweep law)
    expect(settlement).toContain('runtimeSettings: this.currentHandRuntimeSettings,');
    expect(settlement).toContain('horseCashStackCeilingBBFrom(snap.runtimeSettings)');
    expect(host).toContain('horseCashStackCeilingBBFrom(this.runtimeSettings)');
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
