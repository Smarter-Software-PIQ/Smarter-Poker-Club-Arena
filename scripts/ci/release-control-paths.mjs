#!/usr/bin/env node
/**
 * WHICH FILES ARE RELEASE CONTROLS (2026-11-26, release custody).
 *
 * A Backup certificate is selectable only while the release-control
 * projection of its commit equals main's (`projection()` in
 * scripts/ci/read-engine-prequalification.py). A merge that changes one file
 * of that projection makes every existing certificate unselectable, and a new
 * one takes about an hour on the single Backup host. On 2026-11-25 and
 * 2026-11-26 that cost two cycles: O27 merged at 22:50 Chicago (01:00 kept
 * serving) and the O31 batch merged at 12:40 (13:00 kept serving). The rule
 * "merge release controls only after a cycle" lived in a checklist and in
 * memory.
 *
 * This module answers, for a pull request's file list, which paths are in the
 * projection. It has ONE source of truth: the constants of
 * read-engine-prequalification.py, read as text. No list is copied here, so a
 * path added to or excluded from the projection there is classified the same
 * way here in the same commit
 * (tests/a-release-control-change-merges-only-after-a-cycle.law.test.ts runs
 * both classifiers over every tracked file).
 *
 * When the Python source cannot be read or parsed the answer is the
 * FALLBACK below, which holds at least the four release workflows and the two
 * release directories: unreadable never means "nothing is a control"
 * (CLAUDE.md 10.86).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'read-engine-prequalification.py'
);

export const CONTROL_LIST_NAMES = [
  'CONTROL_INPUTS',
  'CONTROL_INPUT_TEST_EXCLUDED_DIRS',
  'PURE_TEST_FILE_SUFFIXES',
  'NON_RELEASE_SERVER_SCRIPT_PREFIXES',
  'NON_RELEASE_SERVER_SCRIPT_EXACT',
];

/** Held when the Python constants cannot be read: no exclusion applies. */
export const FALLBACK_CONTROL_LISTS = Object.freeze({
  CONTROL_INPUTS: Object.freeze([
    '.github/workflows/engine-release-prequalification.yml',
    '.github/workflows/stage-engine-release.yml',
    '.github/workflows/auto-deploy-hetzner.yml',
    '.github/workflows/backup-engine.yml',
    'scripts/ci',
    'server/scripts',
    'server/src/maintenance',
  ]),
  CONTROL_INPUT_TEST_EXCLUDED_DIRS: Object.freeze([]),
  PURE_TEST_FILE_SUFFIXES: Object.freeze([]),
  NON_RELEASE_SERVER_SCRIPT_PREFIXES: Object.freeze([]),
  NON_RELEASE_SERVER_SCRIPT_EXACT: Object.freeze([]),
  fallback: true,
});

/**
 * The five lists, parsed from the Python source text. Each is a top-level
 * `NAME = [ ... ]` or `NAME = ( ... )` of double-quoted strings; comments are
 * dropped first. Throws when a list is missing or empty where it may not be.
 */
export function parseControlLists(pythonSource) {
  if (typeof pythonSource !== 'string') throw new Error('release control source is not text');
  const lists = {};
  for (const name of CONTROL_LIST_NAMES) {
    const match = pythonSource.match(
      new RegExp(`^${name} = ([\\[(])\\n([\\s\\S]*?)\\n[\\])]$`, 'm')
    );
    if (!match) throw new Error(`release control list ${name} not found`);
    const body = match[2]
      .split('\n')
      .map((line) => line.replace(/#.*$/, ''))
      .join('\n');
    const rest = body.replace(/"[^"\\\n]*"/g, '').replace(/[\s,]/g, '');
    if (rest !== '')
      throw new Error(`release control list ${name} holds something other than plain strings`);
    lists[name] = [...body.matchAll(/"([^"\\\n]*)"/g)].map((m) => m[1]);
  }
  if (lists.CONTROL_INPUTS.length === 0) throw new Error('CONTROL_INPUTS is empty');
  return lists;
}

let cached = null;
/** The lists of this checkout (read once), or the fallback when they cannot be read. */
export function controlLists(read) {
  if (!read && cached) return cached;
  let lists;
  try {
    lists = parseControlLists((read ?? (() => readFileSync(SOURCE_PATH, 'utf8')))());
  } catch {
    lists = FALLBACK_CONTROL_LISTS;
  }
  if (!read) cached = lists;
  return lists;
}

const endsAsTest = (name, suffix) => name.endsWith(suffix) && name.length > suffix.length;

/** Mirrors _is_pure_test_control_path. */
function isPureTest(path, lists) {
  if (!lists.CONTROL_INPUT_TEST_EXCLUDED_DIRS.some((dir) => path.startsWith(dir))) return false;
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (lists.PURE_TEST_FILE_SUFFIXES.some((suffix) => endsAsTest(name, suffix))) return true;
  return name.startsWith('test_') && name.endsWith('.py') && name.length > 'test_.py'.length;
}

/** Mirrors _is_non_release_server_script_path. */
function isNonReleaseServerScript(path, lists) {
  if (!path.startsWith('server/scripts/')) return false;
  if (lists.NON_RELEASE_SERVER_SCRIPT_EXACT.includes(path)) return true;
  return lists.NON_RELEASE_SERVER_SCRIPT_PREFIXES.some(
    (prefix) => path.startsWith(prefix) && path.length > prefix.length
  );
}

/** True when a change to `path` changes projection() and so stales every certificate. */
export function isReleaseControlPath(path, lists = controlLists()) {
  if (typeof path !== 'string' || path === '') return false;
  const inside = lists.CONTROL_INPUTS.some(
    (input) => path === input || path.startsWith(`${input}/`)
  );
  if (!inside) return false;
  return !isPureTest(path, lists) && !isNonReleaseServerScript(path, lists);
}

/**
 * The release-control paths among a pull request's files ({ path, changeType,
 * previousPath? }). Every change type counts, a deletion included: removing a
 * projected file changes the projection. A rename counts under either name.
 */
export function releaseControlChanges(files, lists = controlLists()) {
  const out = new Set();
  for (const file of files ?? []) {
    for (const path of [file?.path, file?.previousPath]) {
      if (isReleaseControlPath(path, lists)) out.add(path);
    }
  }
  return [...out].sort();
}
