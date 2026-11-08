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
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const FILE = 'server/release/owner-maintenance-windows.json';
/** Windows main held before this instant are not judged by this rule. */
export const RULE_FROM = Date.parse('2026-11-08T02:00:00Z');

/**
 * Why each window breaks the rule. `bookedAt(id)` returns the merge instant of
 * the window on main, or null when main does not hold it yet.
 */
export function bookingViolations(doc, bookedAt, now) {
  const out = [];
  for (const w of [...(doc.windows ?? []), ...(doc.databaseWindows ?? [])]) {
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
  const failures = bookingViolations(doc, gitBookedAt(base), Date.now());
  if (failures.length) {
    console.error('A booked owner window cannot give notice in the past:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(
    `[owner-window-notice] every booked window gives notice after it merges (base ${base})`
  );
}
