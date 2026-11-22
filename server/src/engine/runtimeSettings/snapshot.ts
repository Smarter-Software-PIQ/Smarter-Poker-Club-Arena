/**
 * ENGINE RUNTIME SETTINGS, ONE VERSION (2026-11-19). A snapshot is one validated, frozen settings version: every
 * registered key with a value (a key the version does not publish keeps its compiled default). The engine holds one
 * snapshot per hand for the whole hand (store.ts pinHand), so a published change never lands mid-hand.
 */
import {
  RUNTIME_SETTINGS_CROSS_RULES,
  RUNTIME_SETTINGS_REGISTRY,
  compiledRuntimeSettingValues,
  runtimeSettingSpec,
  type RuntimeSettingValues,
} from './registry.js';
import {
  validateSingleBlanketOffStep,
  type BlanketOffSettingsInput,
} from '../HorseBlanketOffSingleStepGuard.js';

export interface RuntimeSettingsSnapshot {
  /** 0 is the compiled defaults (nothing read yet, or nothing published); a database version is 1 or more. */
  readonly version: number;
  readonly source: 'compiled' | 'database';
  readonly values: RuntimeSettingValues;
}

export const COMPILED_RUNTIME_SETTINGS: RuntimeSettingsSnapshot = Object.freeze({
  version: 0,
  source: 'compiled',
  values: compiledRuntimeSettingValues(),
});

export type RuntimeSettingsParse =
  | { ok: true; snapshot: RuntimeSettingsSnapshot }
  | { ok: false; version: number | null; reason: string };

/** A published settings object alone (no version): every key registered, every value of its kind and in range. */
export function validateRuntimeSettingValues(
  settings: unknown
): { ok: true; values: RuntimeSettingValues } | { ok: false; reason: string } {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings))
    return { ok: false, reason: 'settings is not a JSON object' };
  const values: Record<string, number> = { ...compiledRuntimeSettingValues() };
  for (const [key, raw] of Object.entries(settings as Record<string, unknown>)) {
    const spec = runtimeSettingSpec(key);
    if (!spec)
      return { ok: false, reason: `unknown setting ${key}: this engine does not register it` };
    if (typeof raw !== 'number' || !Number.isFinite(raw))
      return { ok: false, reason: `${key} is not a finite number` };
    if (spec.kind === 'integer' && !Number.isSafeInteger(raw))
      return { ok: false, reason: `${key} must be a whole number` };
    if (raw < spec.min || raw > spec.max)
      return { ok: false, reason: `${key}=${raw} is outside ${spec.min}..${spec.max}` };
    values[key] = raw;
  }
  for (const rule of RUNTIME_SETTINGS_CROSS_RULES) {
    const refusal = rule(values);
    if (refusal) return { ok: false, reason: refusal };
  }
  // registry order, frozen
  return {
    ok: true,
    values: Object.freeze(
      Object.fromEntries(RUNTIME_SETTINGS_REGISTRY.map((s) => [s.key, values[s.key]!]))
    ),
  };
}

/**
 * The database answer of fn_ca_engine_runtime_settings_current(): `{ version: <int >= 1>, settings: {...} }`, or null
 * when nothing is published. null parses to the compiled defaults. Anything else that is not exactly valid is refused
 * whole; the caller keeps serving its last good snapshot.
 */
export function parseRuntimeSettings(answer: unknown): RuntimeSettingsParse {
  if (answer === null || answer === undefined)
    return { ok: true, snapshot: COMPILED_RUNTIME_SETTINGS };
  if (typeof answer !== 'object' || Array.isArray(answer))
    return { ok: false, version: null, reason: 'the answer is not a JSON object' };
  const a = answer as Record<string, unknown>;
  const version = a.version;
  if (!Number.isSafeInteger(version) || (version as number) < 1)
    return { ok: false, version: null, reason: 'the version is not a whole number of 1 or more' };
  const checked = validateRuntimeSettingValues(a.settings);
  if (!checked.ok) return { ok: false, version: version as number, reason: checked.reason };
  return {
    ok: true,
    snapshot: Object.freeze({
      version: version as number,
      source: 'database',
      values: checked.values,
    }),
  };
}

/**
 * Validates a settings JSON text against the registry and, when `previousSettings` is supplied, enforces the
 * 1-at-a-time blanket-off transition guard (HorseBlanketOffSingleStepGuard). Used by scripts/runtime-settings-publish.ts.
 */
export function checkRuntimeSettingsJson(
  text: string,
  previousSettings?: BlanketOffSettingsInput
): {
  ok: boolean;
  lines: string[];
  settings?: Record<string, number>;
  code?: string;
  newlyDisabled?: readonly string[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      lines: [`not JSON: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
  const checked = validateRuntimeSettingValues(parsed);
  if (!checked.ok) return { ok: false, lines: [`refused: ${checked.reason}`] };
  if (previousSettings !== undefined) {
    const step = validateSingleBlanketOffStep(previousSettings, checked.values);
    if (!step.ok) {
      return {
        ok: false,
        code: step.code,
        newlyDisabled: step.newlyDisabled,
        lines: [`refused: ${step.reason}`],
      };
    }
  }
  const lines = RUNTIME_SETTINGS_REGISTRY.map((spec) => {
    const value = checked.values[spec.key];
    const changed = value !== spec.compiledDefault;
    return `${changed ? '*' : ' '} ${spec.key} = ${value}${changed ? ` (compiled ${spec.compiledDefault})` : ''}`;
  });
  return { ok: true, lines, settings: parsed as Record<string, number> };
}
