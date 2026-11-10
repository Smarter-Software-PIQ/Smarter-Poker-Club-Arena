#!/usr/bin/env node
/**
 * A BAD BOOKING CANNOT MERGE (Dan 2026-11-10).
 *
 * check-owner-window-notice-after-merge.mjs judges every booked window against
 * the moment it merged, on every pull request. That caught the broken promise,
 * but one merge too late: the 2026-11-10-owner-asap-engine-0440z booking ran
 * its pull request checks while playerNoticeAt 04:20Z was still in the
 * future, then merged at 04:43:28Z. From that moment the after-merge check
 * failed on EVERY pull request in the repository, because main itself held a
 * window whose notice preceded its own merge.
 *
 * This check closes the door in the booking pull request itself: any window
 * record this pull request ADDS or CHANGES in
 * server/release/owner-maintenance-windows.json must still be bookable at the
 * moment it is validated. Unchanged records are immutable history and are
 * never re-judged, so a bad record that already reached main cannot turn this
 * check red on unrelated pull requests - that failure mode belongs to the
 * after-merge backstop alone, and the backstop stays.
 *
 * Rules for each added or changed record (certifiedRecoveryProfile, the
 * certified emergency path, stays exempt as in both existing booking laws):
 *   - playerNoticeAt, notBefore and notAfter are required ISO timestamps;
 *   - playerNoticeAt and notBefore are no earlier than validation time minus
 *     a small tolerance (an in-flight pull request must not flake while its
 *     checks run);
 *   - notBefore is not before playerNoticeAt;
 *   - notAfter is after notBefore.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const FILE = 'server/release/owner-maintenance-windows.json';
/** How far in the past a judged timestamp may sit at validation time. */
export const TOLERANCE_MS = 5 * 60 * 1000;

const COLLECTIONS = ['windows', 'databaseWindows'];

/** JSON with every object's keys sorted, so field order never means change. */
function canonical(value) {
  return JSON.stringify(value, (key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]])
        )
      : v
  );
}

/**
 * The records this change books: every record in `headDoc` that `baseDoc`
 * does not hold byte-for-byte (same collection, same id, same content).
 */
export function bookedRecords(baseDoc, headDoc) {
  const out = [];
  for (const collection of COLLECTIONS) {
    const base = new Map();
    for (const w of baseDoc?.[collection] ?? []) {
      if (w && typeof w.id === 'string') base.set(w.id, canonical(w));
    }
    for (const w of headDoc?.[collection] ?? []) {
      const unchanged = w && typeof w.id === 'string' && base.get(w.id) === canonical(w);
      if (!unchanged) out.push({ collection, record: w });
    }
  }
  return out;
}

const iso = (ms) => new Date(ms).toISOString();

/** Why each record this change adds or edits cannot be booked at `now`. */
export function bookingRecordViolations(baseDoc, headDoc, now) {
  const out = [];
  const floor = now - TOLERANCE_MS;
  for (const { collection, record: w } of bookedRecords(baseDoc, headDoc)) {
    if (!w || typeof w !== 'object' || typeof w.id !== 'string' || !w.id) {
      out.push(`${collection}: every record needs a string id`);
      continue;
    }
    if ('certifiedRecoveryProfile' in w) continue;
    const name = `${w.id} (${collection})`;
    const times = {};
    let broken = false;
    for (const field of ['playerNoticeAt', 'notBefore', 'notAfter']) {
      const t = typeof w[field] === 'string' ? Date.parse(w[field]) : NaN;
      if (!Number.isFinite(t)) {
        out.push(`${name}: ${field} is required and must be an ISO timestamp`);
        broken = true;
      }
      times[field] = t;
    }
    if (broken) continue;
    for (const field of ['playerNoticeAt', 'notBefore']) {
      if (times[field] < floor) {
        out.push(
          `${name}: ${field} ${w[field]} is in the past at validation time ` +
            `${iso(now)}; book a window that is still ahead of this pull request`
        );
      }
    }
    if (times.notBefore < times.playerNoticeAt) {
      out.push(`${name}: notBefore ${w.notBefore} is before playerNoticeAt ${w.playerNoticeAt}`);
    }
    if (times.notAfter <= times.notBefore) {
      out.push(`${name}: notAfter ${w.notAfter} must be after notBefore ${w.notBefore}`);
    }
  }
  return out;
}

function docAt(base) {
  let text;
  try {
    text = execFileSync('git', ['show', `${base}:${FILE}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return { windows: [], databaseWindows: [] };
  }
  return JSON.parse(text);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const base = process.env.CI_BASE_SHA || 'origin/main';
  const headDoc = JSON.parse(readFileSync(FILE, 'utf8'));
  const baseDoc = docAt(base);
  const booked = bookedRecords(baseDoc, headDoc);
  if (booked.length === 0) {
    console.log(`[owner-window-booking] no window record added or changed against ${base}`);
    process.exit(0);
  }
  const failures = bookingRecordViolations(baseDoc, headDoc, Date.now());
  if (failures.length) {
    console.error('This pull request books an owner window that is already broken:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(
    `[owner-window-booking] ${booked.length} booked record(s) still bookable at validation time (base ${base})`
  );
}
