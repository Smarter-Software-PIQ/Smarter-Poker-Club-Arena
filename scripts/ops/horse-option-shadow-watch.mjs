#!/usr/bin/env node
// scripts/ops/horse-option-shadow-watch.mjs
// Read-only watcher of one live Horse option shadow trial (PLO or hold'em). See docs/ops/horse-option-shadow-watch.md.
//
// Security invariant: SELECTs only, through `supabase db query --linked -o json --agent=no` (the switch CLI's
// defaultQueryDb). Never reads, sources or prints `.env` or a key. Writes nothing anywhere.

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defaultQueryDb } from './horse-option-switch.mjs';
import {
  USAGE,
  buildWatchQueries,
  evaluateWatch,
  formatWatchReport,
  parseWatchArgs,
} from './horse-option-shadow-watch-lib.mjs';

export async function runWatch(argv, deps = {}) {
  const queryDb = deps.queryDb ?? ((sql) => defaultQueryDb(sql));
  const stdout = deps.stdout ?? ((s) => process.stdout.write(`${s}\n`));
  let args;
  try {
    args = parseWatchArgs(argv);
  } catch (err) {
    stdout(`ERROR: ${err?.message || String(err)}\n${USAGE}`);
    return { exitCode: 2, report: null };
  }
  if (args.help) {
    stdout(USAGE);
    return { exitCode: 0, report: null };
  }
  const queries = buildWatchQueries(args);
  const rows = {};
  for (const [name, sql] of Object.entries(queries)) {
    if (!/^SELECT /.test(sql)) throw new Error(`refusing a non-SELECT query (${name})`);
    rows[name] = await queryDb(sql);
  }
  const report = evaluateWatch(args, rows);
  stdout(args.json ? JSON.stringify(report, null, 2) : formatWatchReport(report));
  if (args.json) stdout(formatWatchReport(report).split('\n').at(-1));
  return { exitCode: report.verdict === 'CLEAN' ? 0 : 1, report };
}

const isDirectRun =
  process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  runWatch(process.argv.slice(2))
    .then(({ exitCode }) => process.exit(exitCode))
    .catch((err) => {
      console.error(`ERROR: ${err?.message || String(err)}`);
      console.error('VERDICT=DIRTY reasons=watch_failed');
      process.exit(2);
    });
}
