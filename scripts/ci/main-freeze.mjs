#!/usr/bin/env node
/**
 * main-freeze - freeze and thaw refs/heads/main for a booked owner window,
 * and say so where every session can read it.
 *
 * WHY THIS EXISTS (2026-11-19)
 *
 * During the November 19 owner engine windows the custodian blocked updates to
 * main with a hand-made repository ruleset called just "RELEASE FREEZE"
 * (27627940). It carried no end time, no window and no release, so every other
 * session that hit "Repository rule violations found" spent hours polling it to
 * learn when merges could resume - while the database's own freeze,
 * smarter_private.ca_release_freeze, has always carried an until time and a
 * reason. A freeze nobody can read the end of is indistinguishable from an
 * outage.
 *
 * So a main freeze is applied only through this file, and only for a window
 * booked in server/release/owner-maintenance-windows.json. Freezing publishes
 * the window in two places at once:
 *
 *   1. the ruleset NAME:  RELEASE FREEZE until 2026-11-19T21:00Z (<window id>) <sha8>
 *      (visible in the push/merge refusal and in every ruleset listing), and
 *   2. the repository variable MAIN_RELEASE_FREEZE: one JSON object with the
 *      window id, notBefore, notAfter, the release it protects and the ruleset
 *      id (`gh variable get MAIN_RELEASE_FREEZE`).
 *
 * Thawing sets the ruleset's enforcement to "disabled" (the id stays stable),
 * renames it back to the bare prefix and marks the variable lifted.
 *
 * Read the result with `node scripts/ci/main-freeze-status.mjs`.
 *
 * Usage (needs a token with Administration: write and Variables: write):
 *   node scripts/ci/main-freeze.mjs freeze --window <id>            # dry run: prints the plan
 *   node scripts/ci/main-freeze.mjs freeze --window <id> --apply
 *   node scripts/ci/main-freeze.mjs thaw --apply
 *   [--repo owner/name] [--windows-file path] [--ruleset-id n] [--now ISO]
 *
 * SCOPE (owner, 2026-11-19: "WE NEED TO STOP REQUIRING AN ENGINE CUT OVER FOR
 * ANY AND ALL UPGRADES AND IMPROVEMENTS AND FIXES"; owner, 2026-09-11: no
 * merge freeze, ever). `freeze` NEVER blocks main and never writes a ruleset.
 * It publishes the window in MAIN_RELEASE_FREEZE with scope "release-controls";
 * scripts/ci/release-freeze-scope.mjs then marks only pull requests touching a
 * release input, as information. Everything keeps merging and shipping. `thaw`
 * lifts the variable and disables any whole-main ruleset somebody made by hand.
 *
 * It never bypasses a ruleset, never touches the engine or the database freeze,
 * and refuses to freeze for a window that is not booked or has already ended.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const REPO = 'Smarter-Software-PIQ/Smarter-Poker-Club-Arena';
export const RULESET_PREFIX = 'RELEASE FREEZE';
export const VARIABLE_NAME = 'MAIN_RELEASE_FREEZE';
export const KNOWN_RULESET_ID = 27627940;
export const RULESET_NAME_MAX = 100;
export const WINDOWS_FILE = 'server/release/owner-maintenance-windows.json';
const MAIN_REF = 'refs/heads/main';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '..', '..');

// ── Booking file ────────────────────────────────────────────────────────────

export function loadWindows(file = path.join(repoRoot, WINDOWS_FILE)) {
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const list = Array.isArray(doc) ? doc : doc.windows;
  if (!Array.isArray(list)) throw new Error(`${file}: no "windows" array`);
  return list
    .filter((w) => w && typeof w.id === 'string' && w.notBefore && w.notAfter)
    .map((w) => ({
      id: w.id,
      notBefore: new Date(w.notBefore).toISOString(),
      notAfter: new Date(w.notAfter).toISOString(),
      contains: typeof w.contains === 'string' ? w.contains : null,
    }));
}

export function findWindow(windows, id) {
  if (!id) return null;
  const exact = windows.find((w) => w.id === id);
  if (exact) return exact;
  // A ruleset name may carry a truncated id ending in "...".
  if (id.endsWith('...')) {
    const stem = id.slice(0, -3);
    const hits = windows.filter((w) => w.id.startsWith(stem));
    if (hits.length === 1) return hits[0];
  }
  return null;
}

export function activeWindows(windows, now) {
  const t = +now;
  return windows.filter((w) => +new Date(w.notBefore) <= t && t < +new Date(w.notAfter));
}

export function nextWindow(windows, now) {
  const t = +now;
  return (
    windows
      .filter((w) => +new Date(w.notBefore) > t)
      .sort((a, b) => +new Date(a.notBefore) - +new Date(b.notBefore))[0] || null
  );
}

// ── What a freeze publishes ─────────────────────────────────────────────────

// Minute precision keeps the name short; seconds are kept only when booked.
const minuteZ = (iso) => {
  const s = new Date(iso).toISOString();
  return s.slice(17, 23) === '00.000' ? s.slice(0, 16) + 'Z' : s.slice(0, 19) + 'Z';
};

export function freezeRulesetName(window) {
  const head = `${RULESET_PREFIX} until ${minuteZ(window.notAfter)} (`;
  let id = window.id;
  let name = `${head}${id})`;
  if (name.length > RULESET_NAME_MAX) {
    id = id.slice(0, RULESET_NAME_MAX - head.length - 4) + '...';
    name = `${head}${id})`;
  }
  const sha = window.contains ? ` ${window.contains.slice(0, 8)}` : '';
  if (name.length + sha.length <= RULESET_NAME_MAX) name += sha;
  return name;
}

const NAME_RE =
  /^RELEASE FREEZE until (\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?Z)(?: \(([^)]+)\))?(?: ([0-9a-f]{7,40}))?\s*$/;

/** Parses a ruleset name written by freezeRulesetName; null for any other name. */
export function parseFreezeRulesetName(name) {
  const m = NAME_RE.exec(String(name || ''));
  if (!m) return null;
  const until = new Date(m[1]);
  if (Number.isNaN(+until)) return null;
  return { until: until.toISOString(), windowId: m[2] || null, release: m[3] || null };
}

export function freezeRulesetBody(window, enforcement = 'active') {
  return {
    name: enforcement === 'active' ? freezeRulesetName(window) : RULESET_PREFIX,
    target: 'branch',
    enforcement,
    conditions: { ref_name: { include: [MAIN_REF], exclude: [] } },
    rules: [{ type: 'update' }, { type: 'non_fast_forward' }, { type: 'deletion' }],
    bypass_actors: [],
  };
}

export function freezeVariableValue(window, { rulesetId, now, state = 'frozen', scope = 'release-controls' }) {
  return JSON.stringify({
    state,
    scope,
    windowId: window ? window.id : null,
    notBefore: window ? window.notBefore : null,
    notAfter: window ? window.notAfter : null,
    release: window ? window.contains : null,
    rulesetId: rulesetId ?? null,
    at: new Date(now).toISOString(),
    readWith: 'node scripts/ci/main-freeze-status.mjs',
  });
}

// ── Reading a ruleset list ──────────────────────────────────────────────────

/** Active rulesets that block updates to main (detail objects, not list stubs). */
export function mainFreezeRulesets(rulesets) {
  return (rulesets || []).filter((r) => {
    if (!r || r.enforcement !== 'active' || r.target !== 'branch') return false;
    const inc = r.conditions?.ref_name?.include || [];
    const exc = r.conditions?.ref_name?.exclude || [];
    const hitsMain =
      inc.some((p) => p === MAIN_REF || p === '~DEFAULT_BRANCH' || p === '~ALL') &&
      !exc.some((p) => p === MAIN_REF || p === '~DEFAULT_BRANCH');
    const blocksUpdate = (r.rules || []).some((rule) => rule.type === 'update');
    return hitsMain && blocksUpdate;
  });
}

function parseVariable(variable) {
  if (!variable) return null;
  try {
    const v = JSON.parse(typeof variable === 'string' ? variable : variable.value);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

/**
 * The whole answer, from data only: { frozen, rulesets, windowId, until,
 * release, source, overdue, activeWindows, next }. `rulesets` must be detail
 * objects; `rulesets === null` means they could not be read.
 */
export function describeStatus({ rulesets, variable, windows, now }) {
  const t = new Date(now);
  const active = activeWindows(windows, t);
  const next = nextWindow(windows, t);
  const base = { now: t.toISOString(), activeWindows: active, next };
  if (rulesets === null) return { ...base, frozen: null, rulesets: [], source: 'unreadable' };

  const freezes = mainFreezeRulesets(rulesets);
  const v = parseVariable(variable);
  if (!freezes.length) {
    if (v && v.state === 'frozen' && v.scope === 'release-controls' && v.notAfter && +new Date(v.notAfter) > +t) {
      const until = new Date(v.notAfter).toISOString();
      return { ...base, frozen: true, scoped: true, rulesets: [], windowId: v.windowId, until, release: v.release || null, source: 'variable', overdue: false };
    }
    return { ...base, frozen: false, rulesets: [] };
  }

  let windowId = null;
  let until = null;
  let release = null;
  let source = null;
  for (const r of freezes) {
    const p = parseFreezeRulesetName(r.name);
    if (p) {
      const w = findWindow(windows, p.windowId);
      windowId = w ? w.id : p.windowId;
      until = p.until;
      release = p.release || (w && w.contains) || null;
      source = 'ruleset-name';
      break;
    }
  }
  if (!source && v && v.state === 'frozen' && v.notAfter) {
    windowId = v.windowId;
    until = new Date(v.notAfter).toISOString();
    release = v.release || null;
    source = 'variable';
  }
  if (!source && active.length) {
    // Unlabeled freeze: the latest-ending booked window that covers now is the
    // best honest bound. It is inferred, and said to be.
    const w = [...active].sort((a, b) => +new Date(b.notAfter) - +new Date(a.notAfter))[0];
    windowId = w.id;
    until = w.notAfter;
    release = w.contains;
    source = 'booking-inferred';
  }
  return {
    ...base,
    frozen: true,
    rulesets: freezes.map((r) => ({ id: r.id, name: r.name })),
    windowId,
    until,
    release,
    source: source || 'unlabeled',
    overdue: until ? +new Date(until) <= +t : false,
  };
}

// ── GitHub transport (injectable for tests) ─────────────────────────────────

export function ghCli(args, input) {
  const r = spawnSync('gh', ['api', ...args], {
    input,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function call(gh, method, route, body) {
  const args = ['-X', method, route];
  if (body !== undefined) args.push('--input', '-');
  const r = gh(args, body === undefined ? undefined : JSON.stringify(body));
  return { ok: r.status === 0, status: r.status, json: safeJson(r.stdout), stderr: r.stderr || '' };
}

const safeJson = (s) => {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};

/** Finds the freeze ruleset: an explicit id, else the known one, else by name prefix. */
export function locateFreezeRuleset(gh, repo, rulesetId) {
  if (rulesetId) return Number(rulesetId);
  const list = call(gh, 'GET', `repos/${repo}/rulesets`);
  if (!list.ok || !Array.isArray(list.json)) throw new Error(`cannot list rulesets: ${list.stderr.trim()}`);
  const known = list.json.find((r) => r.id === KNOWN_RULESET_ID);
  if (known) return known.id;
  const byName = list.json.find((r) => String(r.name).startsWith(RULESET_PREFIX));
  return byName ? byName.id : null;
}

function writeVariable(gh, repo, value) {
  const patch = call(gh, 'PATCH', `repos/${repo}/actions/variables/${VARIABLE_NAME}`, {
    name: VARIABLE_NAME,
    value,
  });
  if (patch.ok) return patch;
  return call(gh, 'POST', `repos/${repo}/actions/variables`, { name: VARIABLE_NAME, value });
}

export function freezeMain({ gh, repo = REPO, windows, windowId, now }) {
  const w = windows.find((x) => x.id === windowId);
  if (!w) throw new Error(`window ${windowId} is not booked in ${WINDOWS_FILE}`);
  if (+new Date(w.notAfter) <= +new Date(now)) {
    throw new Error(`window ${w.id} ended at ${w.notAfter}; a hold must not outlive its booking`);
  }
  const v = writeVariable(gh, repo, freezeVariableValue(w, { rulesetId: null, now, scope: 'release-controls' }));
  if (!v.ok) throw new Error(`${VARIABLE_NAME} write refused: ${v.stderr.trim()}`);
  return { scoped: true, rulesetId: null, name: null, variableWritten: true, variableError: null };
}

export function thawMain({ gh, repo = REPO, windows, now, rulesetId }) {
  const id = locateFreezeRuleset(gh, repo, rulesetId);
  if (!id) {
    const v = writeVariable(gh, repo, freezeVariableValue(null, { rulesetId: null, now, state: 'lifted', scope: 'release-controls' }));
    return { rulesetId: null, variableWritten: v.ok, variableError: v.ok ? null : v.stderr.trim() };
  }
  const cur = call(gh, 'GET', `repos/${repo}/rulesets/${id}`);
  const prev = cur.ok ? parseFreezeRulesetName(cur.json && cur.json.name) : null;
  const w = prev ? findWindow(windows, prev.windowId) : null;
  const body = {
    name: RULESET_PREFIX,
    target: 'branch',
    enforcement: 'disabled',
    conditions: (cur.json && cur.json.conditions) || freezeRulesetBody({ id: '', notAfter: now }).conditions,
    rules: (cur.json && cur.json.rules) || freezeRulesetBody({ id: '', notAfter: now }).rules,
    bypass_actors: (cur.json && cur.json.bypass_actors) || [],
  };
  const rs = call(gh, 'PUT', `repos/${repo}/rulesets/${id}`, body);
  if (!rs.ok) throw new Error(`ruleset write refused: ${rs.stderr.trim()}`);
  const v = writeVariable(gh, repo, freezeVariableValue(w, { rulesetId: id, now, state: 'lifted' }));
  return { rulesetId: id, variableWritten: v.ok, variableError: v.ok ? null : v.stderr.trim() };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) out._.push(a);
    else if (a.includes('=')) out[a.slice(2, a.indexOf('='))] = a.slice(a.indexOf('=') + 1);
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[a.slice(2)] = argv[++i];
    else out[a.slice(2)] = true;
  }
  return out;
}

function main(argv) {
  const args = parseArgs(argv);
  const cmd = args._[0];
  const now = args.now ? new Date(args.now) : new Date();
  const windows = loadWindows(args['windows-file'] ? path.resolve(args['windows-file']) : undefined);
  const repo = args.repo || REPO;
  if (cmd === 'freeze') {
    const w = windows.find((x) => x.id === args.window);
    if (!w) throw new Error(`--window ${args.window || '(missing)'} is not booked in ${WINDOWS_FILE}`);
    if (!args.apply) {
      console.log(`DRY RUN (add --apply). Would publish the engine window ${w.id}; main stays open and only release inputs are marked:`);
      console.log(`  ${VARIABLE_NAME} = ${freezeVariableValue(w, { rulesetId: null, now, scope: 'release-controls' })}`);
      return 0;
    }
    freezeMain({ gh: ghCli, repo, windows, windowId: w.id, now });
    console.log(`engine window ${w.id} published until ${w.notAfter}; main stays open, release inputs are marked`);
    return 0;
  }
  if (cmd === 'thaw') {
    if (!args.apply) {
      console.log('DRY RUN (add --apply). Would set the RELEASE FREEZE ruleset to enforcement=disabled and mark the variable lifted.');
      return 0;
    }
    const r = thawMain({ gh: ghCli, repo, windows, now, rulesetId: args['ruleset-id'] });
    console.log(`main thawed: ruleset ${r.rulesetId} disabled`);
    if (!r.variableWritten) console.log(`WARNING: ${VARIABLE_NAME} not written (${r.variableError})`);
    return 0;
  }
  console.error('usage: main-freeze.mjs freeze --window <id> [--apply] | thaw [--apply]');
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(`main-freeze: ${e.message}`);
    process.exitCode = 1;
  }
}
