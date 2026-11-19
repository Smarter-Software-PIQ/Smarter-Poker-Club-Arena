#!/usr/bin/env node
/**
 * release-freeze-scope - during a booked engine window, hold ONLY the changes
 * that can invalidate the release in flight. Everything else merges and ships.
 *
 * WHY (owner, 2026-11-19 12:54 Chicago): "WE NEED TO STOP REQUIRING AN ENGINE
 * CUT OVER FOR ANY AND ALL UPGRADES AND IMPROVEMENTS AND FIXES."
 *
 * Measured the same day: the November 19 owner engine windows froze ALL of
 * refs/heads/main (ruleset 27627940, rule `update`) from 10:30 to 21:00 UTC.
 * A button colour, a page layout and a docs fix waited on the engine for the
 * whole window although PUBLISHING.md already routes client work with "Engine
 * activation gate: None". The freeze exists for one reason: a certified
 * candidate is refused when protected main's release controls or installed
 * schema move under it ("control owner authorization differs", a migration
 * installed after the Backup copy). Those inputs are the paths below. Nothing
 * in src/, public/, docs, tests or engine source changes them.
 *
 * So an engine window never blocks main. scripts/ci/main-freeze.mjs publishes
 * the window in the repository variable MAIN_RELEASE_FREEZE (scope
 * "release-controls") and the check "Release inputs are steady for the engine
 * window" turns red only on a pull request touching a GUARDED path while that
 * window is live. The check informs; it is not a required check and must not
 * become one (owner, 2026-09-11: no merge freeze, ever; see
 * tests/no-merge-gate-without-a-producer.law.test.ts). Migrations are not
 * guarded: they keep merging and the existing install pause
 * (scripts/release/resume-migration-installs.sh) covers the window.
 *
 * Fails CLOSED on an unreadable diff while frozen; fails OPEN on no freeze.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Inputs a certified engine release or its installed-schema evidence reads.
export const GUARDED = [
  /^server\/release\//,
  /^server\/scripts\/engine-release-/,
  /^server\/src\/maintenance\//,
  /^server\/standby\//,
  /^scripts\/release\//,
  /^scripts\/ci\/(backup-candidate-priority|install-window-migrations|owner-notice-waiver|main-freeze|release-freeze-scope)/,
  /^\.github\/workflows\/(auto-deploy-hetzner|stage-engine-release|backup-engine|engine-release-prequalification|apply-merged-migration|dispatch-merged-migrations|owner-window-ready|release-inputs-hold)\.yml$/,
];

export const isGuarded = (file) => GUARDED.some((re) => re.test(file));

export function parseFreeze(raw) {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

/** { admitted, reason, guarded[] } from data only. */
export function decide({ freezeRaw, files, now }) {
  const v = parseFreeze(freezeRaw);
  const t = +new Date(now);
  const live =
    v && v.state === 'frozen' && v.notAfter && +new Date(v.notAfter) > t && (!v.notBefore || +new Date(v.notBefore) - 3_600_000 <= t);
  if (!live) return { admitted: true, reason: 'no live release freeze', guarded: [] };
  if (!Array.isArray(files)) {
    return { admitted: false, reason: `release freeze ${v.windowId} is live and this diff could not be read`, guarded: [] };
  }
  const guarded = files.filter(isGuarded);
  if (!guarded.length) {
    return { admitted: true, reason: `release freeze ${v.windowId} is live; this change touches no release input, so it merges and ships now`, guarded };
  }
  return {
    admitted: false,
    reason: `release freeze ${v.windowId} holds release inputs until ${v.notAfter} (read: node scripts/ci/main-freeze-status.mjs). Re-run this check after the thaw.`,
    guarded,
  };
}

function main() {
  const filesPath = process.env.FREEZE_SCOPE_FILES;
  let files = null;
  try {
    if (filesPath) files = fs.readFileSync(filesPath, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    files = null;
  }
  const r = decide({ freezeRaw: process.env.MAIN_RELEASE_FREEZE || '', files, now: new Date() });
  console.log(`${r.admitted ? 'ADMITTED' : 'HELD'}: ${r.reason}`);
  for (const f of r.guarded) console.log(`  release input: ${f}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `**${r.admitted ? 'Admitted' : 'Held'}**: ${r.reason}\n` + r.guarded.map((f) => `- \`${f}\`\n`).join(''));
  }
  return r.admitted ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
