/**
 * ENGINE RUNTIME SETTINGS, THE REGISTRY (2026-11-19, owner order 12:54 Chicago: "WE NEED TO STOP REQUIRING AN ENGINE
 * CUT OVER FOR ANY AND ALL UPGRADES AND IMPROVEMENTS AND FIXES").
 *
 * Every value listed here is a PARAMETER of code that is already in the engine. Its compiled default is the value the
 * code uses when nothing is published; a published settings version (database table
 * ca_engine_runtime_settings_versions, read by store.ts) can replace it, and the change takes effect at each table's
 * next hand boundary with no engine cutover. New CODE still needs a release; a new KEY here is new code.
 *
 * THE RULES OF THIS LIST
 * - A key is registered with its kind, its inclusive range and its compiled default. A published value outside the
 *   range, of the wrong kind, or a key not listed here makes the whole published version invalid: the engine refuses it
 *   and the last good version keeps serving (snapshot.ts parseRuntimeSettings).
 * - compiledDefault is the value the code uses today. It is a literal on purpose (no import of the consuming module,
 *   so this file can be read from anywhere without an import cycle); compiledDefaultsMatchTheCode.law.test.ts holds
 *   every literal equal to the constant the code reads, and the seed version of the migration equal to this list.
 * - Changing a compiledDefault is a behaviour change and needs a release like any other code change. Publishing a
 *   version is how the value changes without one.
 *
 * WHAT IS NOT HERE. The Horse on/off option switches (HorseOptionSwitch.ts, ca_horse_option_switch) were already live
 * without a cutover before this file existed (every registered option, read every 30 s, delivered to every decision
 * worker); they keep their own table, authority rules and fail-safe, and this list carries only numeric parameters.
 */

/** Where a setting is consumed. */
export type RuntimeSettingConsumer = 'horse_decision' | 'lightning_fast_fold';

export interface RuntimeSettingSpec {
  /** Dotted key, `<area>.<name>`, as published in the settings JSON. */
  readonly key: string;
  readonly kind: 'number' | 'integer';
  /** Inclusive range a published value must fall in. */
  readonly min: number;
  readonly max: number;
  /** The value the code uses when nothing is published (equal to the code's own constant, see the law test). */
  readonly compiledDefault: number;
  readonly consumer: RuntimeSettingConsumer;
  /** The code constant (or option) this replaces, for the reader. */
  readonly source: string;
  readonly description: string;
}

export const RUNTIME_SETTINGS_REGISTRY: readonly RuntimeSettingSpec[] = Object.freeze(
  [
    // ---- Horse decision parameters: passed to the brain as the existing league override options ----
    {
      key: 'horse.v67RiverRaiseShade',
      kind: 'number',
      min: 0,
      max: 0.5,
      compiledDefault: 0.1,
      consumer: 'horse_decision',
      source: 'HorseLogic.ts V67_RIVER_RAISE_SHADE (opts.v67RiverRaiseShadeOverride)',
      description:
        "Hold'em river: the extra shade on calling a raise over the Horse's own value bet",
    },
    {
      key: 'horse.v65TurnShadeCap',
      kind: 'number',
      min: 0,
      max: 0.5,
      compiledDefault: 0.12,
      consumer: 'horse_decision',
      source: 'HorseLogic.ts V65_TURN_SHADE_CAP (opts.v65TurnShadeCapOverride)',
      description: "Hold'em turn: the cap of the one-pair call shade at a pot-sized wager",
    },
    {
      key: 'horse.v68AirShadeScale',
      kind: 'number',
      min: 0,
      max: 2,
      compiledDefault: 1,
      consumer: 'horse_decision',
      source: 'HorseLogic.ts V68_AIR_SHADE_SCALE (opts.v68AirShadeScaleOverride)',
      description: "Hold'em turn: the scale on the high-card (air) call shade",
    },
    {
      key: 'horse.tournamentFlatBump',
      kind: 'number',
      min: 0,
      max: 0.2,
      compiledDefault: 0,
      consumer: 'horse_decision',
      source: 'HorsePreflop.ts tournamentFlatBump (0 is inert: only 0 < x <= 0.2 applies)',
      description: 'Tournament preflop: added to the call bar facing a single open',
    },
    // ---- Lightning Horse fast-fold look-and-press timing (LightningHorse.ts) ----
    {
      key: 'lightning.fastFoldFloorMs',
      kind: 'integer',
      min: 100,
      max: 5_000,
      compiledDefault: 450,
      consumer: 'lightning_fast_fold',
      source: 'LightningHorse.ts LIGHTNING_HORSE_FAST_FOLD_FLOOR_MS',
      description: 'Lightning: the fastest a Horse ever presses Fast Fold after looking (ms)',
    },
    {
      key: 'lightning.fastFoldMedianMs',
      kind: 'integer',
      min: 100,
      max: 10_000,
      compiledDefault: 600,
      consumer: 'lightning_fast_fold',
      source: 'LightningHorse.ts LIGHTNING_HORSE_FAST_FOLD_MEDIAN_MS',
      description: 'Lightning: the median Horse fast-fold reaction before its tempo (ms)',
    },
    {
      key: 'lightning.fastFoldSigma',
      kind: 'number',
      min: 0,
      max: 2,
      compiledDefault: 0.5,
      consumer: 'lightning_fast_fold',
      source: 'LightningHorse.ts LIGHTNING_HORSE_FAST_FOLD_SIGMA',
      description: 'Lightning: the log-normal spread of the Horse fast-fold reaction',
    },
    {
      key: 'lightning.fastFoldMaxMs',
      kind: 'integer',
      min: 500,
      max: 15_000,
      compiledDefault: 3000,
      consumer: 'lightning_fast_fold',
      source: 'LightningHorse.ts LIGHTNING_HORSE_FAST_FOLD_MAX_MS',
      description: 'Lightning: the slowest a Horse fast fold ever takes (ms)',
    },
    {
      key: 'lightning.fastFoldTempoMin',
      kind: 'number',
      min: 0.25,
      max: 4,
      compiledDefault: 0.8,
      consumer: 'lightning_fast_fold',
      source: 'LightningHorse.ts LIGHTNING_HORSE_FAST_FOLD_TEMPO_MIN',
      description: "Lightning: the quickest Horse's personal tempo factor",
    },
    {
      key: 'lightning.fastFoldTempoMax',
      kind: 'number',
      min: 0.25,
      max: 4,
      compiledDefault: 1.25,
      consumer: 'lightning_fast_fold',
      source: 'LightningHorse.ts LIGHTNING_HORSE_FAST_FOLD_TEMPO_MAX',
      description: "Lightning: the most deliberate Horse's personal tempo factor",
    },
  ].map((spec) => Object.freeze(spec as RuntimeSettingSpec))
);

export type RuntimeSettingValues = Readonly<Record<string, number>>;

const BY_KEY = new Map(RUNTIME_SETTINGS_REGISTRY.map((spec) => [spec.key, spec]));

export function runtimeSettingSpec(key: string): RuntimeSettingSpec | undefined {
  return BY_KEY.get(key);
}

/** The compiled defaults, key -> value, in registry order. */
export function compiledRuntimeSettingValues(): RuntimeSettingValues {
  return Object.freeze(
    Object.fromEntries(RUNTIME_SETTINGS_REGISTRY.map((spec) => [spec.key, spec.compiledDefault]))
  );
}

/**
 * Rules that span two keys. Each returns a refusal reason or null. A published version that breaks one is refused
 * whole, like an out-of-range value.
 */
export const RUNTIME_SETTINGS_CROSS_RULES: readonly ((v: RuntimeSettingValues) => string | null)[] =
  Object.freeze([
    (v) =>
      v['lightning.fastFoldFloorMs']! < v['lightning.fastFoldMaxMs']!
        ? null
        : 'lightning.fastFoldFloorMs must be below lightning.fastFoldMaxMs',
    (v) =>
      v['lightning.fastFoldTempoMin']! <= v['lightning.fastFoldTempoMax']!
        ? null
        : 'lightning.fastFoldTempoMin must not exceed lightning.fastFoldTempoMax',
  ]);
