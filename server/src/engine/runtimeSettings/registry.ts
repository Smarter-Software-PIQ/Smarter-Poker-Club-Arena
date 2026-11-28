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
 * - compiledDefault is the value the code uses today. It is a literal on purpose (no import of the consuming module; the one import, HorseOmahaOptionGameScope.ts, is a leaf,
 *   so this file can be read from anywhere without an import cycle); compiledDefaultsMatchTheCode.law.test.ts holds
 *   every literal equal to the constant the code reads, and the seed version of the migration equal to this list.
 * - Changing a compiledDefault is a behaviour change and needs a release like any other code change. Publishing a
 *   version is how the value changes without one.
 *
 * WHAT IS NOT HERE. The Horse on/off option switches (HorseOptionSwitch.ts, ca_horse_option_switch) were already live
 * without a cutover before this file existed (every registered option, read every 30 s, delivered to every decision
 * worker); they keep their own table, authority rules and fail-safe, and this list carries only numeric parameters.
 */

import {
  OMAHA_OPTION_GAME_SCOPE_OPTIONS,
  OMAHA_OPTION_GAME_SCOPE_SETTING_PREFIX,
} from '../HorseOmahaOptionGameScope.js';
import {
  OMAHA_BLANKET_ROWS_OFF_REGISTRY,
  OMAHA_BLANKET_ROW_OFF_SETTING_PREFIX,
} from '../HorseOmahaBlanketRowsOffInPlo45Cash.js';
import {
  VPIP_FLOOR_TEN_HAND_WINDOW_GAMES,
  VPIP_FLOOR_TEN_HAND_WINDOW_GAME_SETTING_PREFIX,
} from '../HorseVpipFloorTenHandWindowGames.js';

/** Where a setting is consumed. */
export type RuntimeSettingConsumer =
  | 'horse_decision'
  | 'horse_option_game_scope'
  | 'horse_blanket_rows_off'
  | 'horse_ten_hand_window_games'
  | 'lightning_fast_fold'
  | 'horse_stack_management';

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
        "Hold'em River: The Extra Shade On Calling A Raise Over The Horse's Own Value Bet",
    },
    {
      key: 'horse.v65TurnShadeCap',
      kind: 'number',
      min: 0,
      max: 0.5,
      compiledDefault: 0.12,
      consumer: 'horse_decision',
      source: 'HorseLogic.ts V65_TURN_SHADE_CAP (opts.v65TurnShadeCapOverride)',
      description: "Hold'em Turn: The Cap Of The One-Pair Call Shade At A Pot-Sized Wager",
    },
    {
      key: 'horse.v68AirShadeScale',
      kind: 'number',
      min: 0,
      max: 2,
      compiledDefault: 1,
      consumer: 'horse_decision',
      source: 'HorseLogic.ts V68_AIR_SHADE_SCALE (opts.v68AirShadeScaleOverride)',
      description: "Hold'em Turn: The Scale On The High-Card (Air) Call Shade",
    },
    {
      key: 'horse.tournamentFlatBump',
      kind: 'number',
      min: 0,
      max: 0.2,
      compiledDefault: 0,
      consumer: 'horse_decision',
      source: 'HorsePreflop.ts tournamentFlatBump (0 is inert: only 0 < x <= 0.2 applies)',
      description: 'Tournament Preflop: Added To The Call Bar Facing A Single Open',
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
      description:
        'Lightning: The Fastest A Horse Ever Presses Fast Fold After Looking, In Milliseconds',
    },
    {
      key: 'lightning.fastFoldMedianMs',
      kind: 'integer',
      min: 100,
      max: 10_000,
      compiledDefault: 600,
      consumer: 'lightning_fast_fold',
      source: 'LightningHorse.ts LIGHTNING_HORSE_FAST_FOLD_MEDIAN_MS',
      description:
        'Lightning: The Median Horse Fast-Fold Reaction Before Its Tempo, In Milliseconds',
    },
    {
      key: 'lightning.fastFoldSigma',
      kind: 'number',
      min: 0,
      max: 2,
      compiledDefault: 0.5,
      consumer: 'lightning_fast_fold',
      source: 'LightningHorse.ts LIGHTNING_HORSE_FAST_FOLD_SIGMA',
      description: 'Lightning: The Log-Normal Spread Of The Horse Fast-Fold Reaction',
    },
    {
      key: 'lightning.fastFoldMaxMs',
      kind: 'integer',
      min: 500,
      max: 15_000,
      compiledDefault: 3000,
      consumer: 'lightning_fast_fold',
      source: 'LightningHorse.ts LIGHTNING_HORSE_FAST_FOLD_MAX_MS',
      description: 'Lightning: The Slowest A Horse Fast Fold Ever Takes, In Milliseconds',
    },
    {
      key: 'lightning.fastFoldTempoMin',
      kind: 'number',
      min: 0.25,
      max: 4,
      compiledDefault: 0.8,
      consumer: 'lightning_fast_fold',
      source: 'LightningHorse.ts LIGHTNING_HORSE_FAST_FOLD_TEMPO_MIN',
      description: "Lightning: The Quickest Horse's Personal Tempo Factor",
    },
    {
      key: 'lightning.fastFoldTempoMax',
      kind: 'number',
      min: 0.25,
      max: 4,
      compiledDefault: 1.25,
      consumer: 'lightning_fast_fold',
      source: 'LightningHorse.ts LIGHTNING_HORSE_FAST_FOLD_TEMPO_MAX',
      description: "Lightning: The Most Deliberate Horse's Personal Tempo Factor",
    },
    {
      key: 'horse.reraiseFoldShareCap',
      kind: 'number',
      min: 0,
      max: 0.9,
      compiledDefault: 0.45,
      consumer: 'horse_decision',
      source:
        'HorseOopReraiseRangeHolds.ts RERAISE_FOLD_SHARE_CAP_DEFAULT (opts.reraiseFoldShareCap; read only by the two default-off OOP re-raise range options)',
      description:
        'PLO4/PLO5 And NLH Cash: The Most Of The Out-Of-Position 3-Bet Range That May Fold To A 4-Bet (Never Above The Bluff Break-Even)',
    },
    {
      key: 'horse.openerAnswersPriorVersion',
      kind: 'integer',
      min: 1,
      max: 2,
      compiledDefault: 1,
      consumer: 'horse_decision',
      source:
        'HorseOopReraiseRangeHolds.ts OPENER_ANSWERS_PRIOR_VERSION_DEFAULT (opts.openerAnswersPriorVersion; read only by the two default-off OOP re-raise range options): 1 the fitted table 2026-11-24.v1, 2 the indifference prior',
      description:
        "PLO4/PLO5 And NLH Cash: The Prior Of The Opener's Answer To An Out-Of-Position 3-Bet (1 Fitted Table, 2 Indifference Points)",
    },
    // ---- Horse stack management (HorseCashStackCeiling.ts): not a decision option, read at the hand boundary ----
    {
      key: 'horse.cashStackCeilingBB',
      kind: 'integer',
      min: 0,
      max: 2_000,
      compiledDefault: 0,
      consumer: 'horse_stack_management',
      source:
        'HorseCashStackCeiling.ts HORSE_CASH_STACK_CEILING_COMPILED_BB (0 is off: no ceiling)',
      description:
        'PLO4/PLO5 Cash: The Stack, In Big Blinds, Above Which A Horse Books Its Win And Leaves (0 = Off)',
    },
    // ---- The game scope of the omaha* options (HorseOmahaOptionGameScope.ts): one key per listed option ----
    ...OMAHA_OPTION_GAME_SCOPE_OPTIONS.map((option) => ({
      key: OMAHA_OPTION_GAME_SCOPE_SETTING_PREFIX + option,
      kind: 'integer',
      min: 0,
      max: 5,
      compiledDefault: 0,
      consumer: 'horse_option_game_scope',
      source: `HorseOmahaOptionGameScope.ts (opts.omahaOptionGameScope['${option}']; 0 is no scope)`,
      description: `PLO4/PLO5 Cash: The Game ${option} May Be On In (0 = Both, 4 = PLO4 Only, 5 = PLO5 Only)`,
    })),
    // ---- The declared list of omahaBlanketRowsOffInPlo45Cash (HorseOmahaBlanketRowsOffInPlo45Cash.ts): one key per
    // registry member; read only while that switch is on and only in a PLO4/PLO5 cash decision ----
    ...OMAHA_BLANKET_ROWS_OFF_REGISTRY.map((option) => ({
      key: OMAHA_BLANKET_ROW_OFF_SETTING_PREFIX + option,
      kind: 'integer',
      min: 0,
      max: 1,
      compiledDefault: 0,
      consumer: 'horse_blanket_rows_off',
      source: `HorseOmahaBlanketRowsOffInPlo45Cash.ts (opts.omahaBlanketRowsOffList includes '${option}'; 0 is not listed)`,
      description: `PLO4/PLO5 Cash Only: Blanket Row ${option} Off While The Blanket Rows Off List Switch Is On (0 = No, 1 = Off)`,
    })),
    // ---- The games vpipFloorLimpOnlyTenHandWindow may act in (HorseVpipFloorTenHandWindowGames.ts): one key per
    // variant; none set = the option as published, any set = only the listed games ----
    ...VPIP_FLOOR_TEN_HAND_WINDOW_GAMES.map((game) => ({
      key: VPIP_FLOOR_TEN_HAND_WINDOW_GAME_SETTING_PREFIX + game,
      kind: 'integer',
      min: 0,
      max: 1,
      compiledDefault: 0,
      consumer: 'horse_ten_hand_window_games',
      source: `HorseVpipFloorTenHandWindowGames.ts (opts.vpipFloorLimpOnlyTenHandWindowGames includes '${game}'; 0 is not listed)`,
      description: `Cash Tables Judged At Ten Hands: The Ten-Hand Window Switch Acts In ${game} (0 = Not Listed, 1 = Listed; None Listed = Every Game)`,
    })),
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
    // an option's game scope is 0 (both), 4 (PLO4 only) or 5 (PLO5 only): nothing else is a game
    (v) => {
      for (const option of OMAHA_OPTION_GAME_SCOPE_OPTIONS) {
        const key = OMAHA_OPTION_GAME_SCOPE_SETTING_PREFIX + option;
        const value = v[key];
        if (value !== 0 && value !== 4 && value !== 5) return `${key} must be 0, 4 or 5`;
      }
      return null;
    },
  ]);
