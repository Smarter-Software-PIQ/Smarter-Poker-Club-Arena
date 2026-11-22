/**
 * ENGINE RUNTIME SETTINGS, THE PROCESS CHANNEL (2026-11-19). One store per engine process. Until
 * startEngineRuntimeSettingsFromDatabase attaches the database (production boot, from startLiveHorseDecisionWorker
 * with the production switch read), every hand pins the compiled defaults, version 0: tests and local builds behave
 * exactly as an engine without runtime settings.
 */
import {
  createRuntimeSettingsStore,
  type RuntimeSettingsStore,
  type RuntimeSettingsUseRow,
} from './store.js';
import type { RuntimeSettingsSnapshot } from './snapshot.js';

export {
  COMPILED_RUNTIME_SETTINGS,
  checkRuntimeSettingsJson,
  parseRuntimeSettings,
  type RuntimeSettingsSnapshot,
} from './snapshot.js';
export {
  horseCashStackCeilingBBFrom,
  horseDecideOptsFromRuntimeSettings,
  lightningFastFoldTuningFrom,
  type LightningFastFoldTuning,
} from './apply.js';
export { RUNTIME_SETTINGS_REGISTRY } from './registry.js';
export {
  BLANKET_OFF_MULTI_STEP_REFUSED,
  extractDisabledBlanketRules,
  validateSingleBlanketOffStep,
  type BlanketOffSettingsInput,
  type BlanketOffSingleStepAllowed,
  type BlanketOffSingleStepRefused,
  type BlanketOffSingleStepVerdict,
} from '../HorseBlanketOffSingleStepGuard.js';

let processStore: RuntimeSettingsStore = createRuntimeSettingsStore();
let started: Promise<void> | null = null;

export function engineRuntimeSettings(): RuntimeSettingsStore {
  return processStore;
}

/** The snapshot one hand reads to its end (see store.ts). */
export function pinEngineRuntimeSettings(scope: string, handId: string): RuntimeSettingsSnapshot {
  try {
    return processStore.pinHand(scope, handId);
  } catch {
    return processStore.current();
  }
}

const missing = (error: { message?: string; code?: string }): boolean =>
  error.code === 'PGRST202' ||
  error.code === '42883' ||
  /could not find the function|function .* does not exist/i.test(error.message ?? '');

/** Production: the service-role client reads fn_ca_engine_runtime_settings_current and writes the hand-use audit. */
export function startEngineRuntimeSettingsFromDatabase(): Promise<void> {
  if (started) return started;
  started = (async () => {
    const [{ supabase }, { ENGINE_RELEASE_IDENTITY }] = await Promise.all([
      import('../../services/supabase/client.js'),
      import('../../releaseIdentity.js'),
    ]);
    processStore.attach({
      read: async () => {
        const { data, error } = await supabase.rpc('fn_ca_engine_runtime_settings_current');
        if (error) {
          throw new Error(
            missing(error)
              ? 'fn_ca_engine_runtime_settings_current is not installed yet (compiled defaults serve)'
              : (error.message ?? error.code ?? 'unknown error')
          );
        }
        return data;
      },
      recordUse: async (rows: readonly RuntimeSettingsUseRow[]) => {
        const { error } = await supabase.rpc('fn_ca_engine_runtime_settings_record_use', {
          p_rows: rows,
          p_release_sha: ENGINE_RELEASE_IDENTITY.releaseSha,
        });
        if (error) throw new Error(error.message ?? error.code ?? 'unknown error');
      },
    });
    await processStore.start();
  })().catch((error: unknown) => {
    console.warn(
      `[EngineRuntimeSettings] could not start; compiled defaults serve: ${error instanceof Error ? error.message : String(error)}`
    );
  });
  return started;
}

export function stopEngineRuntimeSettings(): void {
  processStore.stop();
  started = null;
}

/** Tests only: a fresh process store. */
export function resetEngineRuntimeSettingsForTests(store?: RuntimeSettingsStore): void {
  processStore.stop();
  processStore = store ?? createRuntimeSettingsStore();
  started = null;
}
