#!/usr/bin/env node
/**
 * main-freeze-status - is main frozen, until when, by which window, and what
 * is booked next? Read-only. One command for any session:
 *
 *   node scripts/ci/main-freeze-status.mjs            # human summary
 *   node scripts/ci/main-freeze-status.mjs --json     # machine-readable
 *
 * It reads the repository rulesets (any active branch ruleset that blocks
 * updates to refs/heads/main is a freeze), the MAIN_RELEASE_FREEZE repository
 * variable written by scripts/ci/main-freeze.mjs, and the bookings in
 * server/release/owner-maintenance-windows.json. The end time comes from, in
 * order: the ruleset name ("RELEASE FREEZE until <notAfter>Z (<window id>)"),
 * the variable, and - for a freeze applied by hand with no label - the
 * latest-ending booked window covering now, reported as inferred.
 *
 * The end time is the booked notAfter. The ruleset is lifted by the custodian
 * (scripts/ci/main-freeze.mjs thaw), not by a clock; an OVERDUE line means the
 * window has ended and the ruleset is still on.
 *
 * Offline / tests: --rulesets-file <json array of ruleset detail objects>,
 * --variable-file <json or raw value> (or --no-variable), --windows-file,
 * --now <ISO>. Never writes anything.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REPO,
  VARIABLE_NAME,
  describeStatus,
  ghCli,
  loadWindows,
  parseArgs,
} from './main-freeze.mjs';

function readLive(repo, gh = ghCli) {
  const list = gh(['repos/' + repo + '/rulesets']);
  let rulesets = null;
  if (list.status === 0) {
    try {
      const stubs = JSON.parse(list.stdout);
      rulesets = [];
      for (const s of stubs) {
        if (s.enforcement !== 'active' || s.target !== 'branch') continue;
        const d = gh(['repos/' + repo + '/rulesets/' + s.id]);
        if (d.status !== 0) {
          rulesets = null;
          break;
        }
        rulesets.push(JSON.parse(d.stdout));
      }
    } catch {
      rulesets = null;
    }
  }
  let variable = null;
  const v = gh(['repos/' + repo + '/actions/variables/' + VARIABLE_NAME]);
  if (v.status === 0) {
    try {
      variable = JSON.parse(v.stdout).value ?? null;
    } catch {
      variable = null;
    }
  }
  return { rulesets, variable };
}

function rel(fromMs, toIso) {
  let s = Math.round((+new Date(toIso) - fromMs) / 1000);
  const past = s < 0;
  s = Math.abs(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const txt = h ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m`;
  return past ? `${txt} ago` : `in ${txt}`;
}

export function formatStatus(st) {
  const now = +new Date(st.now);
  const out = [];
  if (st.frozen === null) {
    out.push('main: UNKNOWN - the rulesets could not be read (token lacks Administration: read?)');
  } else if (!st.frozen) {
    out.push('main: OPEN - no active ruleset blocks updates to refs/heads/main');
  } else if (st.scoped) {
    out.push('main: OPEN - only release inputs are held (scripts/ci/release-freeze-scope.mjs GUARDED); client, docs, tests and engine source merge and ship now');
    out.push(`  window:  ${st.windowId || 'unknown'} (from the ${VARIABLE_NAME} variable)`);
    out.push(`  release inputs held until: ${st.until} (${rel(now, st.until)})`);
    if (st.release) out.push(`  protects release: ${st.release}`);
  } else {
    out.push('main: FROZEN');
    for (const r of st.rulesets) out.push(`  ruleset: ${r.id} "${r.name}"`);
    const how = {
      'ruleset-name': 'from the ruleset name',
      variable: `from the ${VARIABLE_NAME} variable`,
      'booking-inferred': 'INFERRED: the ruleset is unlabeled; this is the latest-ending booked window covering now',
      unlabeled: 'the ruleset is unlabeled and no booked window covers now',
    }[st.source];
    out.push(`  window:  ${st.windowId || 'unknown'} (${how})`);
    out.push(`  until:   ${st.until ? `${st.until} (${rel(now, st.until)})` : 'unknown'}`);
    if (st.release) out.push(`  protects release: ${st.release}`);
    if (st.overdue) out.push(`  OVERDUE: the window ended ${rel(now, st.until)} and the ruleset is still active; ask the custodian to thaw`);
  }
  if (st.activeWindows.length) {
    out.push('booked windows open now:');
    for (const w of st.activeWindows) out.push(`  ${w.id}  ${w.notBefore} -> ${w.notAfter}`);
  }
  out.push(
    st.next
      ? `next booked window: ${st.next.id}  ${st.next.notBefore} -> ${st.next.notAfter} (starts ${rel(now, st.next.notBefore)})`
      : 'next booked window: none booked',
  );
  return out.join('\n');
}

export function run(argv, { gh = ghCli, log = console.log } = {}) {
  const args = parseArgs(argv);
  const now = args.now ? new Date(args.now) : new Date();
  const windows = loadWindows(args['windows-file'] ? path.resolve(args['windows-file']) : undefined);
  let rulesets;
  let variable = null;
  if (args['rulesets-file']) {
    rulesets = JSON.parse(fs.readFileSync(path.resolve(args['rulesets-file']), 'utf8'));
    if (args['variable-file']) variable = fs.readFileSync(path.resolve(args['variable-file']), 'utf8').trim();
  } else {
    ({ rulesets, variable } = readLive(args.repo || REPO, gh));
    if (args['no-variable']) variable = null;
  }
  const st = describeStatus({ rulesets, variable, windows, now });
  log(args.json ? JSON.stringify(st, null, 2) : formatStatus(st));
  return st.frozen === null ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch (e) {
    console.error(`main-freeze-status: ${e.message}`);
    process.exitCode = 1;
  }
}
