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
 * "release-controls"), and when MAIN_RELEASE_FREEZE is unset or stale this
 * script also detects an active unsealed owner engine window directly from
 * server/release/owner-maintenance-windows.json (bound by
 * server/release/activation-floor.json when present). The check "Release
 * inputs are steady for the engine window" turns red only on a pull request
 * touching a GUARDED path while that window is live. The check informs; it is
 * not a required check and must not become one (owner, 2026-09-11: no merge
 * freeze, ever; see tests/no-merge-gate-without-a-producer.law.test.ts).
 * Migrations are not guarded: they keep merging and the existing install pause
 * (scripts/release/resume-migration-installs.sh) covers the window.
 *
 * Fails CLOSED on an unreadable diff while frozen; fails OPEN on no freeze.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const OWNER_FLOOR_SCHEMA = 'engine-release-activation-floor/v2-owner-window';
const ENGINE_HEALTH_URL = 'https://engine.smarter.poker/health';
const SHA_RE = /^[0-9a-f]{40}$/;

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

function isLiftedByVariable(v, w, endMs) {
  if (!v || v.state !== 'lifted') return false;
  if (v.windowId) return v.windowId === w.id;
  if (!v.at) return false;
  const liftedAt = +new Date(v.at);
  if (Number.isNaN(liftedAt)) return false;
  const startMs = w.notBefore ? +new Date(w.notBefore) - 3_600_000 : -Infinity;
  return liftedAt >= startMs && liftedAt < endMs;
}

/**
 * Resolve the active release-inputs hold, if any, from MAIN_RELEASE_FREEZE
 * first and then from booked owner engine windows on main when unset/stale.
 */
export function activeHold({ freezeRaw, windows = null, floor = null, sealedWindowIds = null, now }) {
  const v = parseFreeze(freezeRaw);
  const t = +new Date(now);
  const varLive =
    v &&
    v.state === 'frozen' &&
    v.notAfter &&
    +new Date(v.notAfter) > t &&
    (!v.notBefore || +new Date(v.notBefore) - 3_600_000 <= t);
  if (varLive) {
    return {
      source: 'variable',
      windowId: v.windowId || 'unknown',
      notAfter: v.notAfter,
      contains: v.release || null,
    };
  }
  const list = Array.isArray(windows) ? windows : windows && Array.isArray(windows.windows) ? windows.windows : null;
  if (!list || !list.length) return null;

  const sealed = new Set(sealedWindowIds || []);
  let candidates = list.filter((w) => w && typeof w.id === 'string' && w.notAfter);

  if (floor && typeof floor === 'object') {
    if (floor.schema !== OWNER_FLOOR_SCHEMA || typeof floor.ownerWindowId !== 'string' || !floor.ownerWindowId) {
      return null;
    }
    candidates = candidates.filter((w) => w.id === floor.ownerWindowId);
    const floorExp = floor.expiresAt ? +new Date(floor.expiresAt) : Infinity;
    const active = candidates
      .map((w) => {
        const wEnd = +new Date(w.notAfter);
        const endMs = Number.isNaN(floorExp) ? wEnd : Math.min(wEnd, floorExp);
        return { w, endMs };
      })
      .filter(({ w, endMs }) => !Number.isNaN(endMs) && endMs > t && !sealed.has(w.id) && !isLiftedByVariable(v, w, endMs))
      .sort((a, b) => b.endMs - a.endMs);
    if (!active.length) return null;
    const best = active[0];
    return {
      source: 'owner-windows',
      windowId: best.w.id,
      notAfter: new Date(best.endMs).toISOString(),
      contains: typeof best.w.contains === 'string' ? best.w.contains : null,
    };
  }

  const active = candidates
    .map((w) => ({ w, endMs: +new Date(w.notAfter), startMs: w.notBefore ? +new Date(w.notBefore) - 3_600_000 : -Infinity }))
    .filter(({ w, endMs, startMs }) => !Number.isNaN(endMs) && endMs > t && startMs <= t && !sealed.has(w.id) && !isLiftedByVariable(v, w, endMs))
    .sort((a, b) => b.endMs - a.endMs);
  if (!active.length) return null;
  const best = active[0];
  return {
    source: 'owner-windows',
    windowId: best.w.id,
    notAfter: new Date(best.endMs).toISOString(),
    contains: typeof best.w.contains === 'string' ? best.w.contains : null,
  };
}

/** { admitted, reason, guarded[], source?, windowId? } from data only. */
export function decide({ freezeRaw, windows = null, floor = null, sealedWindowIds = null, files, now }) {
  const hold = activeHold({ freezeRaw, windows, floor, sealedWindowIds, now });
  if (!hold) return { admitted: true, reason: 'no live release freeze', guarded: [] };
  const label = hold.source === 'owner-windows' ? `active booked owner window ${hold.windowId}` : `release freeze ${hold.windowId}`;
  if (!Array.isArray(files)) {
    return { admitted: false, reason: `${label} is live and this diff could not be read`, guarded: [], source: hold.source, windowId: hold.windowId };
  }
  const guarded = files.filter(isGuarded);
  if (!guarded.length) {
    return { admitted: true, reason: `${label} is live; this change touches no release input, so it merges and ships now`, guarded, source: hold.source, windowId: hold.windowId };
  }
  return {
    admitted: false,
    reason: `${label} holds release inputs until ${hold.notAfter} (read: node scripts/ci/main-freeze-status.mjs). Re-run this check after the window seals or thaws.`,
    guarded,
    source: hold.source,
    windowId: hold.windowId,
  };
}

function readJsonIfExists(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function isWindowAlreadyServing(containsSha, repo) {
  if (!containsSha || !SHA_RE.test(containsSha) || !repo) return false;
  try {
    const h = spawnSync('curl', ['-fsS', '--max-time', '10', ENGINE_HEALTH_URL], { encoding: 'utf8', timeout: 15_000 });
    if (h.status !== 0) return false;
    const servingSha = JSON.parse(h.stdout || '{}').releaseSha;
    if (typeof servingSha !== 'string' || !SHA_RE.test(servingSha)) return false;
    if (servingSha === containsSha) return true;
    const cmp = spawnSync('gh', ['api', `repos/${repo}/compare/${containsSha}...${servingSha}`, '--jq', '.status'], {
      encoding: 'utf8',
      timeout: 15_000,
    });
    if (cmp.status !== 0) return false;
    const status = (cmp.stdout || '').trim();
    return status === 'identical' || status === 'ahead';
  } catch {
    return false;
  }
}

function main() {
  const filesPath = process.env.FREEZE_SCOPE_FILES;
  let files = null;
  try {
    if (filesPath) files = fs.readFileSync(filesPath, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    files = null;
  }
  const now = process.env.FREEZE_SCOPE_NOW ? new Date(process.env.FREEZE_SCOPE_NOW) : new Date();
  const freezeRaw = process.env.MAIN_RELEASE_FREEZE || '';
  const windowsPath = process.env.FREEZE_SCOPE_WINDOWS || path.join(repoRoot, 'server/release/owner-maintenance-windows.json');
  const floorPath = process.env.FREEZE_SCOPE_FLOOR || path.join(repoRoot, 'server/release/activation-floor.json');
  const windows = readJsonIfExists(windowsPath);
  const floor = readJsonIfExists(floorPath);

  const sealedWindowIds = [];
  const candidate = activeHold({ freezeRaw, windows, floor, now });
  if (
    candidate &&
    candidate.source === 'owner-windows' &&
    candidate.contains &&
    (!Array.isArray(files) || files.some(isGuarded)) &&
    process.env.FREEZE_SCOPE_NO_NETWORK !== '1' &&
    isWindowAlreadyServing(candidate.contains, process.env.GITHUB_REPOSITORY || 'Smarter-Software-PIQ/Smarter-Poker-Club-Arena')
  ) {
    sealedWindowIds.push(candidate.windowId);
  }

  const r = decide({ freezeRaw, windows, floor, sealedWindowIds, files, now });
  console.log(`${r.admitted ? 'ADMITTED' : 'HELD'}: ${r.reason}`);
  for (const f of r.guarded) console.log(`  release input: ${f}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `**${r.admitted ? 'Admitted' : 'Held'}**: ${r.reason}\n` + r.guarded.map((f) => `- \`${f}\`\n`).join(''));
  }
  return r.admitted ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
