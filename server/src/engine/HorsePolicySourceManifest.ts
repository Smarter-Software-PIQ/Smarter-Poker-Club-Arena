/**
 * EVERY POLICY SOURCE THE RUNNING ENGINE HASHES MUST SHIP IN ITS IMAGE
 * (2026-11-05, after the Nov 5 releases silently fell to shadow).
 *
 * Each phase authority recomputes its policy digest at boot from the exact
 * bytes of the files its source list names, read from `/app/<path>` inside
 * the engine image. Dan's 2026-10-26 forced activation
 * (`HorseOwnerForcedActivation.ts`) issues an authority for the running code
 * only when that digest exists: a null digest means no forced authority, and
 * the phase runs in shadow as if nothing had been ordered.
 *
 * #8605 (merged Oct 29) added `native/public_hist215_wtl.cc` and
 * `scripts/build-public-hist215-native.mjs` to the reference list. The
 * Dockerfile compiled them in a builder stage and copied only the resulting
 * `.node` into the runtime image, so from the first release carrying #8605
 * (67bc0e85, Nov 5 01:57Z) every digest read threw, every digest was null,
 * every forced authority was null and phases 8, 10, 11, 12, 13 and 14 stopped
 * applying on live hands with no receipt that said why.
 *
 * This module is the one list of every path any running digest hashes, and
 * the checks that keep it shipped:
 * - `horsePolicySourceManifest()`: the union of every phase's source list;
 * - `unreadableHorsePolicySources()`: the paths the running reader cannot read;
 * - `horsePolicySourcesShippedMain.ts` (emitted to dist/) runs inside the
 *   image build (server/Dockerfile) and fails the build on any unreadable path;
 * - `aHashedPolicySourceShipsInTheEngineImage.law.test.ts` resolves every
 *   path against the Dockerfile's runtime COPY set in CI;
 * - `reportHorsePolicySourcesAtBoot()` names any unreadable path at engine
 *   boot (console error, `reportError`, `horse_policy_source_unreadable`).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { noteFire } from './BrainTelemetry.js';
import { HORSE_CATASTROPHE_GUARD_POLICY_SOURCE_FILES } from './HorseCatastropheGuardPolicyDigest.js';
import { runningFeatureSourcePaths } from './HorseFeatureAuthority.js';
import { HORSE_PHASE10_POLICY_SOURCE_FILES } from './HorsePhase10Authority.js';
import { HORSE_PHASE11_POLICY_SOURCE_FILES } from './HorsePhase11PolicyDigest.js';
import { HORSE_PHASE12_POLICY_SOURCE_FILES } from './HorsePhase12PolicyDigest.js';
import { HORSE_PHASE13_POLICY_SOURCE_FILES } from './HorsePhase13PolicyDigest.js';
import { HORSE_PHASE8_POLICY_SOURCE_FILES } from './HorsePhase8PolicyDigest.js';
import { HORSE_REFERENCE_DECISION_SOURCE_FILES } from './HorseReferenceDecisionSources.js';
import { CORRECTIVE_KERNEL_POLICY_SOURCE_FILES } from '../services/horseCorrectiveReview/kernelPolicyDigest.js';
import { reportError } from '../services/errorReporter.js';

/** The telemetry receipt fired at boot for every unreadable hashed path. */
export const HORSE_POLICY_SOURCE_UNREADABLE_FIRE = 'horse_policy_source_unreadable';

/** Every digest owner and the server-relative paths it hashes. */
export function horsePolicySourceLists(): Readonly<Record<string, readonly string[]>> {
  return Object.freeze({
    reference: HORSE_REFERENCE_DECISION_SOURCE_FILES,
    phase8: HORSE_PHASE8_POLICY_SOURCE_FILES,
    phase8_catastrophe_guard: HORSE_CATASTROPHE_GUARD_POLICY_SOURCE_FILES,
    phase10: HORSE_PHASE10_POLICY_SOURCE_FILES,
    phase11: HORSE_PHASE11_POLICY_SOURCE_FILES,
    phase12: HORSE_PHASE12_POLICY_SOURCE_FILES,
    phase13: HORSE_PHASE13_POLICY_SOURCE_FILES,
    phase14_corrective_kernel: CORRECTIVE_KERNEL_POLICY_SOURCE_FILES,
    features: runningFeatureSourcePaths(),
  });
}

/** Every server-relative path any running policy digest hashes, sorted, once. */
export function horsePolicySourceManifest(): readonly string[] {
  const all = new Set<string>();
  for (const list of Object.values(horsePolicySourceLists())) for (const p of list) all.add(p);
  return Object.freeze([...all].sort());
}

/** The server root: src/engine/../../ in source and test runs, /app in the image. */
export const runningHorsePolicySourceReader = (path: string): Buffer =>
  readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)));

/** The manifest paths the reader cannot read, each with the error it raised. */
export function unreadableHorsePolicySources(
  read: (path: string) => Buffer = runningHorsePolicySourceReader
): ReadonlyArray<{ readonly path: string; readonly error: string }> {
  const out: Array<{ path: string; error: string }> = [];
  for (const path of horsePolicySourceManifest()) {
    try {
      read(path);
    } catch (error) {
      out.push({ path, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return out;
}

/** One plain sentence per unreadable path, for the build log and the boot log. */
export function describeUnreadableHorsePolicySources(
  unreadable: ReadonlyArray<{ readonly path: string; readonly error: string }>
): string {
  return [
    `${unreadable.length} hashed Horse policy source file(s) cannot be read from the server root. ` +
      'Every phase policy digest is null, no owner-forced authority can be issued and every ' +
      'phase falls to shadow. server/Dockerfile must COPY each of these into the runtime image:',
    ...unreadable.map((u) => `  - ${u.path}: ${u.error}`),
  ].join('\n');
}

/**
 * Boot receipt. Never throws: the engine keeps dealing, but the defect is on
 * the console, in the error reporter and in horse_brain_telemetry on the day
 * it happened. The image build refuses the same condition before it ships.
 */
export function reportHorsePolicySourcesAtBoot(
  read: (path: string) => Buffer = runningHorsePolicySourceReader
): ReadonlyArray<{ readonly path: string; readonly error: string }> {
  let unreadable: ReadonlyArray<{ readonly path: string; readonly error: string }>;
  try {
    unreadable = unreadableHorsePolicySources(read);
  } catch (error) {
    unreadable = [
      { path: '(manifest)', error: error instanceof Error ? error.message : String(error) },
    ];
  }
  if (unreadable.length === 0) return unreadable;
  for (let i = 0; i < unreadable.length; i++) noteFire(HORSE_POLICY_SOURCE_UNREADABLE_FIRE);
  const message = describeUnreadableHorsePolicySources(unreadable);
  console.error(`[HorsePolicySourceManifest] ${message}`);
  reportError(new Error(message), 'HorsePolicySourceManifest.boot', {
    unreadable: unreadable.map((u) => u.path),
  });
  return unreadable;
}
