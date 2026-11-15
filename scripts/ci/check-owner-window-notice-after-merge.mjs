#!/usr/bin/env node
/**
 * A BOOKING CANNOT START IN THE PAST (Dan 2026-11-07).
 *
 * #9903 merged an owner engine window at 13:13 Chicago whose notBefore had
 * already passed; the host announced at 13:14:37 and froze entry at 13:16:37.
 * #9952 made every new booking carry playerNoticeAt at least 20 minutes
 * before notBefore - but a booking can still merge AFTER its own notice time:
 * #9969 merged 2026-11-07 23:35 UTC a window whose playerNoticeAt was 22:10
 * and notBefore 22:30, so the notice reached players only once the cutover was
 * already allowed to start. The notice is a promise made to players at a
 * moment; a booking that lands after that moment broke it before it existed.
 *
 * This check refuses a window whose playerNoticeAt is earlier than the moment
 * it merged to main. The clock is the first commit on main's first-parent
 * history (a protected squash merge) that added the window id; a window that
 * main does not hold yet is being booked by this change, so its clock is now.
 * A certifiedRecoveryProfile window (the certified emergency path) is exempt,
 * and so is any window main already held before RULE_FROM.
 *
 * It runs at merge time (CI, PR job with full history), not inside the
 * certified release transaction: that script has no database or git reads of
 * its own and ships through exact control-generation packaging; adding a
 * refusal there would put a new failure mode into every cutover. A booking
 * that never merges cannot be activated, so the PR is the right door.
 *
 * A PUBLIC NOTICE WITNESS (2026-11-15). A window already on main that broke
 * this rule cannot be corrected in place once it has been consumed: its
 * record is bound to the sealed activation floor, and the booking gate
 * re-judges any edited record against the clock. WITNESS_FILE may carry, for
 * such a window only, the moment its notice was actually visible to players
 * and the moment the release first touched production, each with the run
 * that proves it. The violation is accepted only when the window is on main,
 * the witnessed notice is no earlier than its merge, activation began at
 * least MIN_LEAD_MS after the witnessed notice, no earlier than notBefore,
 * no later than notAfter, and no later than now. A witness never excuses a
 * window being booked in the same change, a window that has not activated,
 * or a missing notice; a malformed, duplicate or orphan witness fails the
 * check.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const FILE = 'server/release/owner-maintenance-windows.json';
/** Windows main held before this instant are not judged by this rule. */
export const RULE_FROM = Date.parse('2026-11-08T02:00:00Z');
/** Witnessed public notice for consumed windows that merged after their notice. */
export const WITNESS_FILE = 'scripts/ci/owner-window-notice-witnesses.json';
/** The notice lead every booking promises players. */
export const MIN_LEAD_MS = 20 * 60 * 1000;

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/**
 * Index the witness document by window id, or report why it is unusable.
 * Every entry must name its evidence; a witness is a record of what was
 * observed, never a permission.
 */
export function readWitnesses(witnessDoc, windowIds) {
  const problems = [];
  const byId = new Map();
  if (witnessDoc === null || witnessDoc === undefined) return { byId, problems };
  if (witnessDoc.version !== 1 || !Array.isArray(witnessDoc.witnesses)) {
    return { byId, problems: [`${WITNESS_FILE}: version 1 with a witnesses array is required`] };
  }
  for (const w of witnessDoc.witnesses) {
    const id = w && typeof w.windowId === 'string' ? w.windowId : null;
    const name = `${WITNESS_FILE} ${id ?? '(no windowId)'}`;
    if (!id) {
      problems.push(`${name}: windowId is required`);
      continue;
    }
    const bad = [];
    for (const f of ['publicNoticeAt', 'activatedAt']) {
      if (typeof w[f] !== 'string' || !ISO.test(w[f])) bad.push(`${f} must be an ISO UTC timestamp`);
    }
    for (const f of ['publicNoticeEvidence', 'activationEvidence']) {
      const e = w[f];
      if (!e || typeof e !== 'object' || typeof e.workflow !== 'string' || !Number.isInteger(e.runId)) {
        bad.push(`${f} must name its workflow and integer runId`);
      }
    }
    if (typeof w.recordedReason !== 'string' || w.recordedReason.trim().length < 40) {
      bad.push('recordedReason must explain the case');
    }
    if (bad.length) {
      problems.push(...bad.map((b) => `${name}: ${b}`));
      continue;
    }
    if (byId.has(id)) {
      problems.push(`${name}: duplicate witness`);
      continue;
    }
    if (!windowIds.has(id)) {
      problems.push(`${name}: names no booked window`);
      continue;
    }
    byId.set(id, w);
  }
  return { byId, problems };
}

/** Why a witness cannot excuse window `w` merged at `onMain`, or null when it does. */
export function witnessRefusal(w, witness, onMain, now) {
  if (onMain === null) return 'a witness cannot excuse a window this change is booking';
  const notice = Date.parse(witness.publicNoticeAt);
  const activated = Date.parse(witness.activatedAt);
  const notBefore = Date.parse(String(w.notBefore));
  const notAfter = Date.parse(String(w.notAfter));
  if (notice < onMain) return `witnessed notice ${witness.publicNoticeAt} precedes the merge`;
  if (activated > now) return `witnessed activation ${witness.activatedAt} has not happened`;
  if (activated - notice < MIN_LEAD_MS) {
    return `witnessed activation ${witness.activatedAt} is less than 20 minutes after notice ${witness.publicNoticeAt}`;
  }
  if (!Number.isFinite(notBefore) || activated < notBefore) {
    return `witnessed activation ${witness.activatedAt} precedes notBefore ${w.notBefore}`;
  }
  if (!Number.isFinite(notAfter) || activated > notAfter) {
    return `witnessed activation ${witness.activatedAt} is after notAfter ${w.notAfter}`;
  }
  return null;
}

/**
 * Why each window breaks the rule. `bookedAt(id)` returns the merge instant of
 * the window on main, or null when main does not hold it yet.
 */
export function bookingViolations(doc, bookedAt, now, witnessDoc = null) {
  const all = [...(doc.windows ?? []), ...(doc.databaseWindows ?? [])];
  const ids = new Set(all.filter((w) => w && typeof w.id === 'string').map((w) => w.id));
  const { byId, problems } = readWitnesses(witnessDoc, ids);
  const out = [...problems];
  for (const w of all) {
    if (!w || typeof w.id !== 'string' || 'certifiedRecoveryProfile' in w) continue;
    const onMain = bookedAt(w.id);
    if (onMain !== null && onMain < RULE_FROM) continue;
    const merged = onMain ?? now;
    const noticeAt = Date.parse(String(w.playerNoticeAt));
    if (!Number.isFinite(noticeAt)) {
      out.push(`${w.id}: playerNoticeAt is required`);
      continue;
    }
    if (noticeAt < merged) {
      const witness = byId.get(w.id);
      const refusal = witness ? witnessRefusal(w, witness, onMain, now) : null;
      if (witness && refusal === null) continue;
      if (witness) out.push(`${w.id}: notice witness refused: ${refusal}`);
      out.push(
        `${w.id}: playerNoticeAt ${w.playerNoticeAt} is before the booking ${
          onMain === null ? 'lands (now ' : 'merged ('
        }${new Date(merged).toISOString()}); book a later notice and notBefore`
      );
    }
  }
  return out;
}

function gitBookedAt(base) {
  return (id) => {
    const out = execFileSync(
      'git',
      ['log', '--first-parent', '--reverse', '--format=%cI', `-S${id}`, base, '--', FILE],
      { encoding: 'utf8' }
    ).trim();
    const first = out.split('\n')[0];
    return first ? Date.parse(first) : null;
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const base = process.env.CI_BASE_SHA || 'origin/main';
  const doc = JSON.parse(readFileSync(FILE, 'utf8'));
  const witnessDoc = existsSync(WITNESS_FILE) ? JSON.parse(readFileSync(WITNESS_FILE, 'utf8')) : null;
  const failures = bookingViolations(doc, gitBookedAt(base), Date.now(), witnessDoc);
  if (failures.length) {
    console.error('A booked owner window cannot give notice in the past:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(
    `[owner-window-notice] every booked window gives notice after it merges (base ${base})`
  );
}
