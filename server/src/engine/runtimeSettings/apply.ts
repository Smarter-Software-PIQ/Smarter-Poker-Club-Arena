/**
 * ENGINE RUNTIME SETTINGS, WHERE THEY ARE READ (2026-11-19). Each consumer takes the snapshot its hand pinned
 * (store.ts pinHand) and nothing else, so one hand reads one version throughout.
 */
import type { LiveHorseDecideOpts } from '../horseDecision/protocol.js';
import { COMPILED_RUNTIME_SETTINGS, type RuntimeSettingsSnapshot } from './snapshot.js';

const HORSE_OPTION_OF: Readonly<Record<string, keyof LiveHorseDecideOpts>> = Object.freeze({
  'horse.v67RiverRaiseShade': 'v67RiverRaiseShadeOverride',
  'horse.v65TurnShadeCap': 'v65TurnShadeCapOverride',
  'horse.v68AirShadeScale': 'v68AirShadeScaleOverride',
  'horse.tournamentFlatBump': 'tournamentFlatBump',
});

/** The registry keys the Horse decision reads, with the decision option each one sets. */
export function horseRuntimeSettingOptions(): Readonly<Record<string, keyof LiveHorseDecideOpts>> {
  return HORSE_OPTION_OF;
}

/**
 * The decision options a hand's snapshot sets. ONLY a value that differs from its compiled default is passed: at the
 * compiled defaults this is undefined, so the decision request, its key and its journal are byte-identical to an
 * engine without runtime settings, and the code's own constant decides exactly as before.
 */
export function horseDecideOptsFromRuntimeSettings(
  snapshot: RuntimeSettingsSnapshot | undefined
): LiveHorseDecideOpts | undefined {
  // an engine built without its constructor (tests) has no pinned snapshot: the compiled defaults, so nothing passes
  if (!snapshot?.values) return undefined;
  let out: Record<string, number> | undefined;
  for (const [key, option] of Object.entries(HORSE_OPTION_OF)) {
    const value = snapshot.values[key];
    if (value === undefined || value === COMPILED_RUNTIME_SETTINGS.values[key]) continue;
    (out ??= {})[option] = value;
  }
  return out ? (Object.freeze(out) as LiveHorseDecideOpts) : undefined;
}

export interface LightningFastFoldTuning {
  readonly floorMs: number;
  readonly medianMs: number;
  readonly sigma: number;
  readonly maxMs: number;
  readonly tempoMin: number;
  readonly tempoMax: number;
}

export function lightningFastFoldTuningFrom(
  snapshot: RuntimeSettingsSnapshot | undefined
): LightningFastFoldTuning {
  const v = (snapshot ?? COMPILED_RUNTIME_SETTINGS).values;
  return Object.freeze({
    floorMs: v['lightning.fastFoldFloorMs']!,
    medianMs: v['lightning.fastFoldMedianMs']!,
    sigma: v['lightning.fastFoldSigma']!,
    maxMs: v['lightning.fastFoldMaxMs']!,
    tempoMin: v['lightning.fastFoldTempoMin']!,
    tempoMax: v['lightning.fastFoldTempoMax']!,
  });
}
