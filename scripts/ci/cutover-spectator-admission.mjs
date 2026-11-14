// When may the cutover spectator still open its table, and what is it called
// when it may not? (2026-11-14)
//
// The spectator exists to watch one occupied cash table THROUGH an engine
// replacement: predecessor serving, freeze, new engine, thaw, natural
// reconnect, committed hand. Its browser needs minutes to exist (npm ci,
// browser install, fixture account), and the host transaction that makes the
// last-hand announcement does not wait for it. On 2026-11-14 the announcement
// landed about 30 seconds before the browser read /health, and the shared
// live-table precondition ("no maintenance phase at all") turned that into a
// red failure that read like a product defect.
//
// The announcement is not the freeze. For LAST_HAND_LEAD_MS (two minutes) after
// it the predecessor still serves and still accepts a spectator; what the
// witness must prove is that its one socket was open on the predecessor BEFORE
// the freeze began, and the correlator already requires exactly that
// (armedAt < freeze <= container start <= thaw). So `last_hand` is admitted.
//
// Once the freeze has begun, or the candidate already serves, the replacement
// can no longer be witnessed. That is not a failure of production and not a
// pass: it is NOT OBSERVED (late), with its own name, its own exit code (3)
// and no witness file (CLAUDE.md 10.86 rule 1). Anything unreadable stays
// "could not tell" and stays red.
import { appendFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const SPECTATOR_OBSERVE = 'observe';
export const SPECTATOR_NOT_OBSERVED_LATE = 'not-observed-late';
export const SPECTATOR_UNKNOWN = 'unknown';
export const SPECTATOR_NOT_OBSERVED_FILE = 'cutover-spectator-not-observed.json';
/** Shared with pr-status.mjs and production-e2e-provenance.mjs: 3 is "no verdict". */
export const SPECTATOR_NOT_OBSERVED_EXIT = 3;

const SHA = /^[0-9a-f]{40}$/;
const RUN = /^[1-9]\d*-[1-9]\d*$/;

/**
 * Classify one /health read.
 *
 * `target` is the candidate the receiver is about to install. `predecessor`,
 * when the caller already knows it, must still be the engine serving.
 *
 * @returns {{ outcome: 'observe', phase: 'idle' | 'last_hand', predecessor: string }
 *   | { outcome: 'not-observed-late', reason: string }
 *   | { outcome: 'unknown', reason: string }}
 */
export function classifySpectatorAdmission(health, { target, predecessor } = {}) {
  const unknown = (reason) => ({ outcome: SPECTATOR_UNKNOWN, reason });
  if (!SHA.test(String(target ?? ''))) return unknown('the candidate release is not one full SHA');
  if (predecessor !== undefined && !SHA.test(String(predecessor)))
    return unknown('the expected predecessor is not one full SHA');
  if (predecessor === target) return unknown('the predecessor and the candidate are the same SHA');
  if (!health || typeof health !== 'object') return unknown('engine health was not an object');
  const serving = health.releaseSha;
  if (typeof serving !== 'string' || !SHA.test(serving))
    return unknown('engine health did not expose one full lowercase releaseSha');
  if (serving === target)
    return {
      outcome: SPECTATOR_NOT_OBSERVED_LATE,
      reason: 'the candidate engine was already serving before the spectator was attached',
    };
  if (predecessor !== undefined && serving !== predecessor)
    return unknown(`engine releaseSha ${serving} is neither the predecessor nor the candidate`);
  const maintenance = health.maintenance;
  if (!maintenance || typeof maintenance.active !== 'boolean')
    return unknown('engine health did not say whether a maintenance break is active');
  if (!maintenance.active)
    return { outcome: SPECTATOR_OBSERVE, phase: 'idle', predecessor: serving };
  if (maintenance.phase === 'last_hand')
    return { outcome: SPECTATOR_OBSERVE, phase: 'last_hand', predecessor: serving };
  return {
    outcome: SPECTATOR_NOT_OBSERVED_LATE,
    reason: `the freeze had already begun (${String(maintenance.phase || 'unnamed phase')}) before the spectator was attached`,
  };
}

/**
 * After the announcement every table parks at its hand boundary, so "dealt in
 * the last 45 seconds and not paused" selects nothing. A spectator admitted in
 * `last_hand` needs a cash table that has dealt and still has two players to
 * deal to after the thaw; whether it actually does is proved afterwards by the
 * committed hand, not assumed here.
 */
export function occupiedCashTableForBreak(table) {
  return Boolean(
    table &&
    table.gameFormat === 'cash' &&
    Number.isSafeInteger(table.seated) &&
    table.seated >= 2 &&
    Number.isSafeInteger(table.dealable) &&
    table.dealable >= 2 &&
    Number.isSafeInteger(table.handCount) &&
    table.handCount >= 1
  );
}

/** The durable record of a spectator that arrived too late. Never a witness. */
export function notObservedRecord({ runId, target, reason, health, at }) {
  return {
    runId,
    outcome: SPECTATOR_NOT_OBSERVED_LATE,
    target,
    reason,
    servingSha: typeof health?.releaseSha === 'string' ? health.releaseSha : null,
    maintenancePhase: health?.maintenance?.active ? String(health.maintenance.phase || '') : 'idle',
    at,
  };
}

/** Accept only a record this exact receiver attempt wrote about this candidate. */
export function readNotObserved(raw, runId) {
  if (!raw) return null;
  let record;
  try {
    record = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  if (
    !record ||
    record.outcome !== SPECTATOR_NOT_OBSERVED_LATE ||
    !RUN.test(String(runId)) ||
    record.runId !== runId ||
    typeof record.reason !== 'string' ||
    record.reason.length === 0
  )
    return null;
  return record;
}

async function main() {
  const target = process.env.CUTOVER_SPECTATOR_TARGET;
  const url = process.env.ENGINE_HEALTH_URL || 'https://engine.smarter.poker/health';
  const response = await fetch(`${url}?cb=${Date.now()}`, {
    headers: { 'cache-control': 'no-store' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`engine health answered ${response.status}`);
  const health = await response.json();
  const admission = classifySpectatorAdmission(health, { target });
  const output = (line) =>
    process.env.GITHUB_OUTPUT && appendFileSync(process.env.GITHUB_OUTPUT, `${line}\n`);
  if (admission.outcome === SPECTATOR_OBSERVE) {
    if (process.env.GITHUB_ENV)
      appendFileSync(process.env.GITHUB_ENV, `EXPECTED_ENGINE_SHA=${admission.predecessor}\n`);
    output('admitted=true');
    console.log(
      `Spectator admitted: predecessor ${admission.predecessor}, phase ${admission.phase}`
    );
    return;
  }
  if (admission.outcome === SPECTATOR_NOT_OBSERVED_LATE) {
    const record = notObservedRecord({
      runId: `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`,
      target,
      reason: admission.reason,
      health,
      at: Date.now(),
    });
    writeFileSync(SPECTATOR_NOT_OBSERVED_FILE, JSON.stringify(record));
    output('admitted=false');
    output(`not_observed=${JSON.stringify(record)}`);
    console.log(`::warning::NOT OBSERVED (late): ${admission.reason}`);
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `\nNOT OBSERVED (late): ${admission.reason}\nSpectator continuity for this release is unverified. No sealed-spectator artifact exists.\n`
      );
    return;
  }
  throw new Error(`could not tell whether the spectator may attach: ${admission.reason}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
