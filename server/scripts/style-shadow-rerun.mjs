#!/usr/bin/env node
/**
 * STYLE READ OFFLINE RE-RUN (pre-activation, 2026-11-13): one row per changed decision for
 * phase1-verify/style-evaluation.sql, derived from a read-only copy of the decision journal.
 *
 *   node scripts/style-shadow-rerun.mjs <journal copy .ndjson> --out <dir outside the repo>
 *        [--since <iso>] [--until <iso>] [--limit N] [--concurrency K] [--store-snapshot <json>]...
 *        [--node <node executable>] [--esbuild-binary <esbuild executable>]
 *
 *   node scripts/style-shadow-rerun.mjs --child --running-source <sha> [--store-snapshot <json>]...
 *        (stdin: {"record": <decision record>})
 *
 * Every decision record whose replay state carries the switch states (horse-decision-replay-state-v4) is re-run in
 * its own fresh process (styleShadowRerun.ts): the baseline must replay exactly, then each option that was not off
 * for that Horse is re-decided on and off. The running source is `git rev-parse HEAD` of a clean checkout; a record
 * made by any other source is refused by name, never re-run on a different brain.
 *
 * Output (in --out, which must be outside the repository, because the rows carry table ids and hand numbers):
 *   style-shadow-decisions-<stamp>.csv   the rows; load with
 *        \copy style_shadow_decisions from '<file>' csv header
 *   style-shadow-rerun-<stamp>.json      coverage: decisions read, v3 (all off) vs v4, re-run status, baseline
 *        outcomes, failed options, and changed rows per aggregate cell (opt.format.street.actual.would_be.arm) to
 *        set against the live style_shadow.* counters (query 0).
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  exactReplayChildEnv,
  hydrateReplayStores,
  refuseNetwork,
} from './phase15-exact-replay.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(here, '..');
const repoRoot = resolve(serverRoot, '..');
const SHA = /^[0-9a-f]{40}$/;
const V4 = 'horse-decision-replay-state-v4';

function parseArgs(argv) {
  const out = {
    child: false,
    runningSource: null,
    journal: null,
    limit: Number.POSITIVE_INFINITY,
    since: null,
    until: null,
    storeSnapshots: [],
    concurrency: 4,
    out: null,
    node: process.execPath,
    esbuildBinary: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--child') out.child = true;
    else if (a === '--running-source') out.runningSource = next();
    else if (a === '--limit') out.limit = Number(next());
    else if (a === '--since') out.since = next();
    else if (a === '--until') out.until = next();
    else if (a === '--store-snapshot') out.storeSnapshots.push(resolve(next()));
    else if (a === '--concurrency') out.concurrency = Number(next());
    else if (a === '--out') out.out = resolve(next());
    else if (a === '--node') out.node = resolve(next());
    else if (a === '--esbuild-binary') out.esbuildBinary = resolve(next());
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else out.journal = resolve(a);
  }
  return out;
}

async function child(args) {
  if (!SHA.test(String(args.runningSource))) throw new Error('--running-source must be a full SHA');
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const attempts = await refuseNetwork();
  const { register } = await import('tsx/esm/api');
  register();
  const src = (p) => pathToFileURL(join(serverRoot, 'src', p)).href;
  await hydrateReplayStores(args.storeSnapshots, src);
  const { styleShadowRerunRecord } = await import(
    src('engine/horseDecision/replay/styleShadowRerun.ts')
  );
  const { currentReplaySolverStores } = await import(
    src('engine/horseDecision/replay/references.ts')
  );
  const result = await styleShadowRerunRecord(input.record, {
    runningSource: args.runningSource,
    stores: currentReplaySolverStores(),
  });
  process.stdout.write(`${JSON.stringify({ ...result, networkAttempts: attempts })}\n`);
}

function rerunInFreshProcess({ record, runningSource, storeSnapshots, node, esbuildBinary }) {
  return new Promise((done) => {
    const argv = [fileURLToPath(import.meta.url), '--child', '--running-source', runningSource];
    for (const file of storeSnapshots) argv.push('--store-snapshot', file);
    const proc = spawn(node, argv, {
      cwd: serverRoot,
      env: exactReplayChildEnv(process.env, esbuildBinary),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d));
    proc.stderr.on('data', (d) => (stderr += d));
    proc.on('close', (code) => {
      try {
        if (code !== 0) throw new Error(`child exited ${code}`);
        done({ result: JSON.parse(stdout.trim().split('\n').pop()) });
      } catch (error) {
        done({ result: null, error: `${error.message}: ${stderr.slice(-400)}` });
      }
    });
    proc.stdin.end(JSON.stringify({ record }));
  });
}

/** The replay-state version of a decision record, without replaying it. */
function replayStateVersion(record) {
  try {
    return JSON.parse(record.body)?.replayState?.version ?? null;
  } catch {
    return null;
  }
}

const tally = (items, key) => {
  const out = {};
  for (const item of items) {
    const k = key(item);
    out[k] = (out[k] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
};

async function batch(args) {
  if (!args.journal) throw new Error('a journal copy (.ndjson) is required');
  if (!args.out) throw new Error('--out <dir outside the repository> is required');
  const rel = relative(realpathSync(repoRoot), args.out);
  if (!rel.startsWith('..') && !isAbsolute(rel))
    throw new Error('--out must be outside the repository: the rows carry table ids and hands');
  const runningSource = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
  if (
    execFileSync('git', ['status', '--porcelain', '--', 'server'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim()
  )
    throw new Error('the server tree differs from HEAD; the re-run runs only on a clean checkout');
  const sinceMs = args.since ? Date.parse(args.since) : 0;
  const untilMs = args.until ? Date.parse(args.until) : Number.POSITIVE_INFINITY;
  if (Number.isNaN(sinceMs) || Number.isNaN(untilMs))
    throw new Error('--since/--until must be ISO times');

  const decisions = [];
  for (const line of readFileSync(args.journal, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const parsed = JSON.parse(line);
    const record = parsed && typeof parsed.kind === 'string' ? parsed : parsed?.record;
    if (record?.kind !== 'decision') continue;
    const at = Number(record.atMs);
    if (at >= sinceMs && at < untilMs) decisions.push(record);
  }
  const versions = tally(decisions, (r) => replayStateVersion(r) ?? 'unreadable');
  const selected = decisions
    .filter((r) => replayStateVersion(r) === V4)
    .sort((a, b) => Number(a.atMs) - Number(b.atMs))
    .slice(0, args.limit);

  const startedAt = new Date();
  const results = new Array(selected.length);
  let next = 0;
  const worker = async () => {
    while (next < selected.length) {
      const i = next++;
      results[i] = await rerunInFreshProcess({
        record: selected[i],
        runningSource,
        storeSnapshots: args.storeSnapshots,
        node: args.node,
        esbuildBinary: args.esbuildBinary,
      });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, args.concurrency) }, worker));
  const ok = results.map((r) => r.result).filter(Boolean);
  const rows = ok.flatMap((r) => r.rows);
  const { styleShadowRerunCsvHeader, styleShadowRerunCsvLine } = await (async () => {
    const { register } = await import('tsx/esm/api');
    register();
    return import(
      pathToFileURL(join(serverRoot, 'src/engine/horseDecision/replay/styleShadowRerun.ts')).href
    );
  })();
  mkdirSync(args.out, { recursive: true });
  const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
  const csv = join(args.out, `style-shadow-decisions-${stamp}.csv`);
  writeFileSync(
    csv,
    [styleShadowRerunCsvHeader(), ...rows.map(styleShadowRerunCsvLine), ''].join('\n')
  );
  const summary = {
    version: 'style-shadow-rerun-evidence-v1',
    command: ['node', 'scripts/style-shadow-rerun.mjs', ...process.argv.slice(2)].join(' '),
    runningSource,
    journalCopySha256: createHash('sha256').update(readFileSync(args.journal)).digest('hex'),
    window: { since: args.since, until: args.until },
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    // coverage of the copy: v3 = ran with every option off (nothing to re-run), v4 = carries switch states
    decisionsInWindow: decisions.length,
    replayStateVersions: versions,
    selectedV4: selected.length,
    childFailures: results.length - ok.length,
    networkAttempts: ok.reduce((n, r) => n + r.networkAttempts.fetch + r.networkAttempts.socket, 0),
    status: tally(ok, (r) => r.status),
    baseline: tally(ok, (r) => r.baseline ?? 'none'),
    baselineByCell: tally(
      ok,
      (r) =>
        `${r.context?.format ?? '?'}/${r.context?.variant ?? '?'}/${r.context?.stage ?? '?'} ${r.baseline}`
    ),
    optionsRerun: tally(
      ok.flatMap((r) => r.rerunOptions),
      (o) => o
    ),
    optionsFailed: tally(
      ok.flatMap((r) => r.failedOptions),
      (o) => o
    ),
    rows: rows.length,
    // the live counters' cell shape, for query 0: offline counts are at least the live ones (no skips, no rotation)
    rowsByCell: tally(
      rows,
      (r) =>
        `${r.opt}.${r.format === 'tournament' ? 't' : 'c'}.${r.street}.${r.actual}.${r.would_be}.${r.arm}`
    ),
    csv,
  };
  writeFileSync(
    join(args.out, `style-shadow-rerun-${stamp}.json`),
    `${JSON.stringify(summary, null, 2)}\n`
  );
  process.stdout.write(
    `${JSON.stringify({ csv, rows: rows.length, selectedV4: selected.length, status: summary.status })}\n`
  );
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  (args.child ? child(args) : batch(args)).then(
    () => process.exit(0),
    (error) => {
      process.stderr.write(`${error?.stack ?? error}\n`);
      process.exit(1);
    }
  );
}
