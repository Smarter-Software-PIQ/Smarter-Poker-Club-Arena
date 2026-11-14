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
 * Output (in --out, which must be outside the repository, because the rows carry table ids and hand numbers; both
 * files are created with mode 0600 and never overwrite an existing file):
 *   style-shadow-decisions-<stamp>.csv   the rows; load with
 *        \copy style_shadow_decisions from '<file>' csv header
 *   style-shadow-rerun-<stamp>.json      coverage: decisions read, v3 (all off) vs v4, re-run status, baseline
 *        outcomes, failed options, child error text, and changed rows per aggregate cell
 *        (opt.format.street.actual.would_be.arm) to set against the live style_shadow.* counters (query 0).
 *
 * The journal copy is read as a stream, twice, and never held in memory (review finding B3): the first pass selects
 * the decisions and keeps only where each one is in the file; the second finds the execution witness of each
 * selected decision and the FAST records a selected DEEP look needs. Each record is read back from the file when
 * its turn comes. Memory grows with the number of SELECTED decisions (a few hundred bytes each), not with the size
 * of the copy; use --since/--until or --limit on a full-day copy. A line that is not JSON, a header line whose
 * `records` count is not the count read, or a copy that changes between the two passes stops the run by name.
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  createReadStream,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve, relative, isAbsolute, sep } from 'node:path';
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

/** Review finding B6: a count that is not a positive whole number is an error, never zero work. */
function positiveWholeNumber(name, raw) {
  if (
    typeof raw !== 'string' ||
    !/^[0-9]+$/.test(raw) ||
    !Number.isSafeInteger(Number(raw)) ||
    Number(raw) < 1
  )
    throw new Error(
      `${name} must be a positive whole number, got ${raw === undefined ? 'nothing' : JSON.stringify(raw)}`
    );
  return Number(raw);
}

export function parseArgs(argv) {
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
    else if (a === '--limit') out.limit = positiveWholeNumber('--limit', next());
    else if (a === '--since') out.since = next();
    else if (a === '--until') out.until = next();
    else if (a === '--store-snapshot') out.storeSnapshots.push(resolve(next()));
    else if (a === '--concurrency') out.concurrency = positiveWholeNumber('--concurrency', next());
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
    execution: input.execution ?? null,
    originalFastRecords: input.originalFastRecords ?? [],
  });
  process.stdout.write(`${JSON.stringify({ ...result, networkAttempts: attempts })}\n`);
}

function rerunInFreshProcess({
  record,
  execution,
  originalFastRecords,
  runningSource,
  storeSnapshots,
  node,
  esbuildBinary,
}) {
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
    proc.stdin.end(JSON.stringify({ record, execution, originalFastRecords }));
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

/**
 * Review bd7a5cc2, finding 1: `--out` must be outside the repository after every symlink is resolved, on both
 * sides. The directory may not exist yet, so the nearest existing ancestor is resolved and the rest appended.
 */
export function outputIsOutsideRepo(out, root = repoRoot) {
  let existing = resolve(out);
  const rest = [];
  for (;;) {
    try {
      existing = realpathSync(existing);
      break;
    } catch {
      const parent = dirname(existing);
      if (parent === existing) return false;
      rest.unshift(basename(existing));
      existing = parent;
    }
  }
  const real = join(existing, ...rest);
  const rel = relative(realpathSync(root), real);
  return rel === '..' || (rel.startsWith(`..${sep}`) && !isAbsolute(rel)) || isAbsolute(rel);
}

/** The earlier FAST decisions a DEEP second look may bind (exactReplay's originalFastRecords): same producer and
 * hand, earlier sequence, at most the 256 latest. */
export function originalFastCandidates(record, decisionsByHand) {
  if (laneOf(record) !== 'deep') return [];
  return (decisionsByHand.get(`${record.producerId}\u0000${record.handKey}`) ?? [])
    .filter((r) => Number(r.sequence) < Number(record.sequence))
    .slice(-256);
}

/** DECIDE_FAST or DECIDE_DEEP, without replaying. */
function laneOf(record) {
  try {
    const type = JSON.parse(record.body)?.snapshot?.type;
    return type === 'DECIDE_DEEP' ? 'deep' : type === 'DECIDE_FAST' ? 'fast' : 'other';
  } catch {
    return 'unreadable';
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

/** Review finding B8: the rows carry table ids and hand numbers on a shared machine. Owner-only, never overwritten. */
export function writePrivateFile(path, text) {
  writeFileSync(path, text, { mode: 0o600, flag: 'wx' });
}

/** A journal record from one line of a copy: the record itself, or an export row that wraps it as `record`. */
function journalRecordOf(parsed) {
  if (parsed === null || typeof parsed !== 'object') return null;
  const record = typeof parsed.kind === 'string' ? parsed : parsed.record;
  return record && typeof record === 'object' && typeof record.kind === 'string' ? record : null;
}

/** One streamed pass: every line as raw bytes with its number and byte offset; nothing else is kept. */
async function eachJournalLine(path, onLine) {
  const hash = createHash('sha256');
  let carry = [];
  let offset = 0;
  let lines = 0;
  let bytes = 0;
  const emit = (line) => {
    lines++;
    onLine(line, lines, offset);
    offset += line.length + 1;
  };
  for await (const chunk of createReadStream(path, { highWaterMark: 1 << 20 })) {
    hash.update(chunk);
    bytes += chunk.length;
    let start = 0;
    for (let nl = chunk.indexOf(10, start); nl !== -1; nl = chunk.indexOf(10, start)) {
      const piece = chunk.subarray(start, nl);
      emit(carry.length ? Buffer.concat([...carry, piece]) : piece);
      carry = [];
      start = nl + 1;
    }
    if (start < chunk.length) carry.push(chunk.subarray(start));
  }
  if (carry.length) emit(Buffer.concat(carry));
  return { lines, bytes, sha256: hash.digest('hex') };
}

/**
 * Read a journal copy as a stream (review finding B3) and select the v4 decisions of the window.
 *
 * Returns the selected decisions as small index entries (where each record is in the file, its turn key, lane and
 * time; `execution` is where its own execution witness is, or null), the coverage counts, and `load(entry)`, which
 * reads the decision record, its witness and, for a DEEP look, its original FAST candidates back from the file.
 * Throws by name on a line that is not JSON, on a header line whose `records` count is not the count read, and on a
 * copy that is not the same in the second pass.
 */
export async function readJournalCopy(
  path,
  { sinceMs = 0, untilMs = Number.POSITIVE_INFINITY, limit = Number.POSITIVE_INFINITY } = {}
) {
  const unreadable = [];
  let unreadableCount = 0;
  const parseLine = (line, number, offset) => {
    try {
      return JSON.parse(line.toString('utf8'));
    } catch {
      unreadableCount++;
      if (unreadable.length < 3) unreadable.push(`line ${number} (byte ${offset})`);
      return undefined;
    }
  };
  const blank = (line) => line.length === 0 || line.toString('utf8').trim() === '';

  // pass 1: count, and index the v4 decisions of the window
  const recordsByKind = {};
  const versions = {};
  const candidates = [];
  let blankLines = 0;
  let otherLines = 0;
  let records = 0;
  let declaredRecords = null;
  let decisionsInWindow = 0;
  let decisionsWithoutTime = 0;
  const first = await eachJournalLine(path, (line, number, offset) => {
    if (blank(line)) return void blankLines++;
    const parsed = parseLine(line, number, offset);
    if (parsed === undefined) return;
    const record = journalRecordOf(parsed);
    if (!record) {
      otherLines++;
      if (parsed && Number.isSafeInteger(parsed.records)) declaredRecords = parsed.records;
      return;
    }
    records++;
    recordsByKind[record.kind] = (recordsByKind[record.kind] ?? 0) + 1;
    if (record.kind !== 'decision') return;
    const atMs = Number(record.atMs);
    if (record.atMs === undefined || record.atMs === null || !Number.isFinite(atMs))
      return void decisionsWithoutTime++;
    if (!(atMs >= sinceMs && atMs < untilMs)) return;
    decisionsInWindow++;
    const version = replayStateVersion(record) ?? 'unreadable';
    versions[version] = (versions[version] ?? 0) + 1;
    if (version !== V4) return;
    const lane = laneOf(record);
    candidates.push({
      offset,
      length: line.length,
      atMs,
      eventId: record.eventId,
      turnKey: record.turnKey,
      lane,
      sequence: Number(record.sequence),
      handOf: lane === 'deep' ? `${record.producerId}\u0000${record.handKey}` : null,
      execution: null,
    });
  });
  if (unreadableCount)
    throw new Error(
      `journal copy ${path}: ${unreadableCount} of ${first.lines} lines are not readable JSON (${unreadable.join(', ')}${unreadableCount > unreadable.length ? ', ...' : ''}); the copy is truncated or damaged, nothing was re-run`
    );
  if (declaredRecords !== null && declaredRecords !== records)
    throw new Error(
      `journal copy ${path}: its header line declares ${declaredRecords} records but ${records} were read; the copy is incomplete, nothing was re-run`
    );
  const selected = candidates.sort((a, b) => a.atMs - b.atMs).slice(0, limit);

  // pass 2: the execution witness of each selected decision (the last one under its own turn key, as the journal
  // reader joins it) and the FAST decisions of every hand that has a selected DEEP look
  const byTurn = new Map(selected.map((e) => [e.turnKey, e]));
  const fastByHand = new Map(selected.filter((e) => e.handOf).map((e) => [e.handOf, []]));
  if (selected.length) {
    const second = await eachJournalLine(path, (line, number, offset) => {
      if (blank(line)) return;
      const record = journalRecordOf(parseLine(line, number, offset));
      if (!record) return;
      if (record.kind === 'execution') {
        const entry = byTurn.get(record.turnKey);
        if (entry) entry.execution = { offset, length: line.length };
      } else if (record.kind === 'decision') {
        const list = fastByHand.get(`${record.producerId}\u0000${record.handKey}`);
        if (list && laneOf(record) === 'fast')
          list.push({ offset, length: line.length, sequence: Number(record.sequence) });
      }
    });
    if (
      unreadableCount ||
      second.sha256 !== first.sha256 ||
      second.lines !== first.lines ||
      second.bytes !== first.bytes
    )
      throw new Error(
        `journal copy ${path} changed while it was being read (first pass ${first.lines} lines, ${first.bytes} bytes; second pass ${second.lines} lines, ${second.bytes} bytes); re-run on a copy that is not being written`
      );
    for (const list of fastByHand.values()) list.sort((a, b) => a.sequence - b.sequence);
  }

  let fd = null;
  const readAt = ({ offset, length }) => {
    fd ??= openSync(path, 'r');
    const buffer = Buffer.allocUnsafe(length);
    let record = null;
    if (readSync(fd, buffer, 0, length, offset) === length) {
      try {
        record = journalRecordOf(JSON.parse(buffer.toString('utf8')));
      } catch {
        record = null;
      }
    }
    if (!record)
      throw new Error(
        `journal copy ${path} changed after it was read (no record at byte ${offset}); re-run on a copy that is not being written`
      );
    return record;
  };
  return {
    sha256: first.sha256,
    bytes: first.bytes,
    lines: first.lines,
    blankLines,
    otherLines,
    records,
    recordsByKind: Object.fromEntries(
      Object.entries(recordsByKind).sort(([a], [b]) => (a < b ? -1 : 1))
    ),
    declaredRecords,
    decisionsInWindow,
    decisionsWithoutTime,
    replayStateVersions: Object.fromEntries(
      Object.entries(versions).sort(([a], [b]) => (a < b ? -1 : 1))
    ),
    selected,
    load(entry) {
      const record = readAt(entry);
      return {
        record,
        execution: entry.execution ? readAt(entry.execution) : null,
        originalFastRecords: originalFastCandidates(record, fastByHand).map(readAt),
      };
    },
    close() {
      if (fd !== null) closeSync(fd);
      fd = null;
    },
  };
}

async function batch(args) {
  if (!args.journal) throw new Error('a journal copy (.ndjson) is required');
  if (!args.out) throw new Error('--out <dir outside the repository> is required');
  if (!outputIsOutsideRepo(args.out))
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

  const journal = await readJournalCopy(args.journal, { sinceMs, untilMs, limit: args.limit });
  const selected = journal.selected;

  const startedAt = new Date();
  const results = new Array(selected.length);
  let next = 0;
  const worker = async () => {
    while (next < selected.length) {
      const i = next++;
      results[i] = await rerunInFreshProcess({
        // read back from the copy now, so only the records being re-run are in memory
        ...journal.load(selected[i]),
        runningSource,
        storeSnapshots: args.storeSnapshots,
        node: args.node,
        esbuildBinary: args.esbuildBinary,
      });
    }
  };
  try {
    await Promise.all(Array.from({ length: args.concurrency }, worker));
  } finally {
    journal.close();
  }
  const ok = results.map((r) => r.result).filter(Boolean);
  const failed = results.flatMap((r, i) =>
    r.result ? [] : [{ decision_id: String(selected[i].eventId), error: String(r.error) }]
  );
  const rows = ok.flatMap((r) => r.rows);
  const { styleShadowRerunCsvHeader, styleShadowRerunCsvLine, styleShadowCountedRows } =
    await (async () => {
      const { register } = await import('tsx/esm/api');
      register();
      return import(
        pathToFileURL(join(serverRoot, 'src/engine/horseDecision/replay/styleShadowRerun.ts')).href
      );
    })();
  mkdirSync(args.out, { recursive: true });
  const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
  const csv = join(args.out, `style-shadow-decisions-${stamp}.csv`);
  writePrivateFile(
    csv,
    [styleShadowRerunCsvHeader(), ...rows.map(styleShadowRerunCsvLine), ''].join('\n')
  );
  const summary = {
    version: 'style-shadow-rerun-evidence-v2',
    command: ['node', 'scripts/style-shadow-rerun.mjs', ...process.argv.slice(2)].join(' '),
    runningSource,
    journalCopySha256: journal.sha256,
    journalCopy: {
      bytes: journal.bytes,
      lines: journal.lines,
      blankLines: journal.blankLines,
      records: journal.records,
      recordsByKind: journal.recordsByKind,
      // lines that are JSON but hold no journal record (an export header, for example)
      otherLines: journal.otherLines,
      declaredRecords: journal.declaredRecords,
    },
    window: { since: args.since, until: args.until },
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    // coverage of the copy: v3 = ran with every option off (nothing to re-run), v4 = carries switch states
    decisionsInWindow: journal.decisionsInWindow,
    // a decision record with no usable atMs cannot be placed in the window: left out, and counted here
    decisionsWithoutTime: journal.decisionsWithoutTime,
    replayStateVersions: journal.replayStateVersions,
    selectedV4: selected.length,
    // a DEEP second look replays only with its original FAST record from the same copy; a DEEP record whose FAST
    // record is outside the copy is reported here, by lane, and not counted as a FAST failure
    selectedV4ByLane: tally(selected, (e) => e.lane),
    selectedWithExecutionWitness: selected.filter((e) => e.execution).length,
    baselineByLane: tally(ok, (r) => `${r.lane ?? '?'} ${r.baseline ?? 'none'}`),
    childFailures: failed.length,
    // the error text of the failed children, most frequent first, and the first five with their decision
    childErrors: Object.fromEntries(
      Object.entries(tally(failed, (f) => f.error.replace(/\s+/g, ' ').trim().slice(0, 300))).sort(
        ([, a], [, b]) => b - a
      )
    ),
    childErrorSamples: failed.slice(0, 5),
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
    // executed comes from the witness status: t = this request's proposal was executed (intended, coerced),
    // f = it was not (not_executed, fallback), u = unknown (no witness for this request, unverified, pending)
    rowsByLaneAndExecuted: tally(
      rows,
      (r) => `${r.lane} executed=${r.executed} status=${r.execution_status}`
    ),
    // what the evaluation counts: executed rows only, one per lane-independent turn and option
    rowsCounted: styleShadowCountedRows(rows).length,
    turnsWithRows: new Set(rows.map((r) => r.turn_identity)).size,
    // a size-only change (same action class, other amount) is reported apart and is not in the 30-decision gate
    rowsSizeOnly: rows.filter((r) => r.actual === r.would_be).length,
    // the live counters' cell shape, for query 0: offline counts are at least the live ones (no skips, no rotation)
    rowsByCell: tally(
      rows,
      (r) =>
        `${r.opt}.${r.format === 'tournament' ? 't' : 'c'}.${r.street}.${r.actual}.${r.would_be}.${r.arm}`
    ),
    csv,
  };
  writePrivateFile(
    join(args.out, `style-shadow-rerun-${stamp}.json`),
    `${JSON.stringify(summary, null, 2)}\n`
  );
  if (failed.length)
    process.stderr.write(
      `${failed.length} of ${selected.length} re-runs failed in the child; first: ${failed[0].decision_id}: ${failed[0].error}\n`
    );
  process.stdout.write(
    `${JSON.stringify({ csv, rows: rows.length, rowsCounted: summary.rowsCounted, selectedV4: selected.length, childFailures: failed.length, status: summary.status })}\n`
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
