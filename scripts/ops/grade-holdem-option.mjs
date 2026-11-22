#!/usr/bin/env node
// scripts/ops/grade-holdem-option.mjs
// Unified One-Command Hold'em Grade Harness CLI.
// Replaces ad-hoc per-branch lane.sh / devpass2.sh / verdict.py / grade-league.mts
// with a single permanent, tested, VERIFIER-10-reproducible runner.
//
// Subcommands:
//   preflight  Validate manifest + criteria SHA256 + system/git gates (no simulation).
//   run        Preflight -> run all declared cells under nice -n 10 -> ONE-LOOK score.
//   score      Score a completed results.jsonl (enforces criteria SHA256 + 100% exit=0).
//   recompute  VERIFIER-10 independent recomputation from raw results.jsonl (+ --compare).

import { execFileSync, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { loadavg } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  DEFAULT_CORE_GATE_SCRIPT,
  DEFAULT_SHEPHERD_LOCK,
  compareVerdictsForRecompute,
  evaluateHoldemGrade,
  evaluateSystemGate,
  normalizeSha256,
  parseGradeCliArgs,
  parseHorseLeagueOutput,
  parseResultsJsonl,
  renderVerdictMarkdown,
  serializeResultsJsonl,
  sha256Hex,
  validateCriteriaManifest,
  verifyCriteriaContent,
} from './grade-holdem-option-lib.mjs';

export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_REFUSED = 2;

const THIS_FILE = fileURLToPath(import.meta.url);
const LIB_FILE = join(dirname(THIS_FILE), 'grade-holdem-option-lib.mjs');

const USAGE = `Unified Hold'em Option Grade Harness (VERIFIER-10 reproducible)

Usage:
  node scripts/ops/grade-holdem-option.mjs preflight \\
    --manifest=<manifest.json> --criteria-sha=<64-hex> [--workdir=<repo>] [--json]

  node scripts/ops/grade-holdem-option.mjs run \\
    --manifest=<manifest.json> --criteria-sha=<64-hex> --out=<out-dir> \\
    [--workdir=<repo>] [--lane-lock=<path> --lane-owner=<id>] [--resume] [--json]

  node scripts/ops/grade-holdem-option.mjs score \\
    --manifest=<manifest.json> --results=<results.jsonl> [--criteria-sha=<64-hex>] \\
    [--out=<out-dir>] [--workdir=<repo>] [--json]

  node scripts/ops/grade-holdem-option.mjs recompute \\
    --manifest=<manifest.json> --results=<results.jsonl> [--criteria-sha=<64-hex>] \\
    [--compare=<verdict.json>] [--out=<out-dir>] [--json]

Options:
  --manifest=<path>          JSON grade manifest declaring option, criteria, cells & bars
  --criteria-sha=<64-hex>    Expected SHA256 of the pre-run CRITERIA markdown file
  --criteria-path=<path>     Override manifest.criteriaPath (still checked against SHA256)
  --out=<dir>                Output directory for logs, results.jsonl, verdict.json, VERDICT.md
  --results=<path>           Path to raw results.jsonl (for score / recompute)
  --compare=<path>           Existing verdict.json to verify parity against (recompute)
  --workdir=<dir>            Git worktree root containing server/ (defaults to cwd)
  --shepherd-lock=<path>     Override shepherd.lock path (default: ${DEFAULT_SHEPHERD_LOCK}; respects HS_LOCK_DIR)
  --core-gate-script=<path>  Override core-gate-running.py path (default: ${DEFAULT_CORE_GATE_SCRIPT}; respects HS_LOCK_DIR)
  --lane-lock=<path>         Optional owner-checked lane lock file (never steals foreign lock)
  --lane-owner=<id>          Lane owner string matching --lane-lock
  --max-load=<num>           Override 1-minute load ceiling (default: manifest.bars.maxLoad1m or 35)
  --resume                   (run) Keep the cell-seed jobs an earlier run of this exact grade
                             already finished (same manifest, criteria, git HEAD/tree and harness
                             bytes) and run only the rest. A gate abort no longer throws away
                             finished cells. A finished job that failed is never re-run: the
                             grade stays refused (ONE-LOOK).
  --json                     Emit machine-readable JSON to stdout
`;

// Offline CONTROL runner evaluated via `nice -n 10 npx tsx -e ...` inside <workdir>/server.
// Mirrors horseLeagueCard.ts offline semantics with a = b = matchup.b (OFF-vs-OFF).
// Uses a namespace dynamic import for HorseLeague.js so DEVELOPMENT_LEAGUE_CARDS is resolved
// when exported and gracefully falls back to [] on older branches without that export.
export const CONTROL_RUNNER_SOURCE = `
process.env.EQUITY_GOVERNOR = 'off';
process.env.SUPABASE_URL = 'https://supabase.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'horse-league-card-offline-placeholder';
const [card, seedS, pairsS, revision] = process.argv.slice(1);
const HL = await import('./src/benchmark/HorseLeague.js');
const { resolveLeagueCard } = await import('./src/benchmark/HorseLeagueCard.js');
const { prepareTournamentFutureHandFacts } = await import('./src/engine/HorseTournamentFutureHand.js');
prepareTournamentFutureHandFacts();
const matchups = [...HL.LEAGUE_MATCHUPS, ...(HL.DEVELOPMENT_LEAGUE_CARDS ?? [])];
const base = resolveLeagueCard(card, matchups, HL.UNMEASURABLE_MATCHUPS ?? []);
const ctrl = { ...base, name: base.name + '_control', a: { ...base.b }, b: { ...base.b } };
const pairs = Number(pairsS);
const seed = Number(seedS);
const r = await HL.runMatchup(ctrl, pairs, seed);
console.log('DEVRESULT ' + JSON.stringify({
  card,
  mode: 'control',
  seed,
  pairs,
  engineRevision: revision,
  hands: r.hands,
  bb100: r.bb100,
  stderr: r.stderr,
  divergentPairs: r.divergentPairs ?? 0,
  partedHands: r.divergentPairs ?? 0,
  inert: Boolean(r.inert),
  illegalActions: r.illegalActions ?? 0,
  truncatedStreets: r.truncatedStreets ?? 0,
  brainExceptionFallbacks: r.brainExceptionFallbacks ?? 0,
  durationMs: r.durationMs ?? null,
}));
process.exit(0);
`.trim();

// --- Default I/O Dependencies (all injectable for unit tests) ----------------------------------

function defaultReadFileBuffer(filePath) {
  return readFileSync(filePath);
}

function defaultReadFileUtf8(filePath) {
  return readFileSync(filePath, 'utf8');
}

function defaultWriteFileUtf8(filePath, content) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
}

function defaultAppendFileUtf8(filePath, content) {
  mkdirSync(dirname(filePath), { recursive: true });
  appendFileSync(filePath, content, 'utf8');
}

function defaultExists(filePath) {
  return existsSync(filePath);
}

function defaultGetLoad1m() {
  try {
    const out = execFileSync('sysctl', ['-n', 'vm.loadavg'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const parts = out.replace(/[{}]/g, '').trim().split(/\s+/);
    const val = Number(parts[0]);
    if (Number.isFinite(val)) return val;
  } catch {
    // Fall back to os.loadavg() on non-macOS or restricted shells
  }
  const [oneMin] = loadavg();
  return oneMin;
}

function defaultRunCoreGate(scriptPath) {
  if (!existsSync(scriptPath)) {
    return { exitCode: 2, output: `core-gate script missing: ${scriptPath}` };
  }
  const res = spawnSync('python3', [scriptPath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    exitCode: typeof res.status === 'number' ? res.status : 2,
    output: `${res.stdout || ''}${res.stderr || ''}`.trim(),
  };
}

function defaultReadGitState(workdir) {
  const git = (args) =>
    execFileSync('git', ['-C', workdir, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  try {
    const gitHead = git(['rev-parse', 'HEAD']).trim();
    const gitTree = git(['rev-parse', 'HEAD^{tree}']).trim();
    const gitPorcelain = git(['status', '--porcelain']);
    return { gitHead, gitTree, gitPorcelain };
  } catch (err) {
    return {
      gitHead: '',
      gitTree: '',
      gitPorcelain: null,
      error: err?.message || String(err),
    };
  }
}

function defaultReadLaneLock(lockPath) {
  if (!lockPath || !existsSync(lockPath)) {
    return { exists: false, path: lockPath || null, owner: null, pid: null };
  }
  try {
    const raw = readFileSync(lockPath, 'utf8').trim();
    try {
      const parsed = JSON.parse(raw);
      return {
        exists: true,
        path: lockPath,
        owner: typeof parsed.owner === 'string' ? parsed.owner : null,
        pid: typeof parsed.pid === 'number' ? parsed.pid : null,
      };
    } catch {
      const m = /^owner=(.+)$/m.exec(raw);
      return {
        exists: true,
        path: lockPath,
        owner: m ? m[1].trim() : raw || null,
        pid: null,
      };
    }
  } catch {
    return { exists: true, path: lockPath, owner: null, pid: null };
  }
}

function defaultAcquireLaneLock(lockPath, owner, pid) {
  if (!lockPath) return { acquired: false };
  mkdirSync(dirname(lockPath), { recursive: true });
  const payload = JSON.stringify({ owner, pid, acquiredAtUtc: new Date().toISOString() }, null, 2);
  writeFileSync(lockPath, `${payload}\n`, { encoding: 'utf8', flag: 'wx' });
  return { acquired: true };
}

function defaultReleaseLaneLock(lockPath, owner, pid) {
  if (!lockPath || !existsSync(lockPath)) return;
  const current = defaultReadLaneLock(lockPath);
  if (current.owner === owner && (current.pid === null || current.pid === pid)) {
    unlinkSync(lockPath);
  }
}

function defaultRunCellCommand({ cell, seed, workdir, hydrateSolverStores, gitHead }) {
  const serverDir = join(workdir, 'server');
  const env = {
    ...process.env,
    EQUITY_GOVERNOR: 'off',
  };
  if (!hydrateSolverStores) {
    env.SUPABASE_URL = 'https://supabase.invalid';
    env.SUPABASE_SERVICE_ROLE_KEY = 'horse-league-card-offline-placeholder';
  }
  if (gitHead) {
    env.GIT_COMMIT_SHA = gitHead;
  }

  let args;
  if (cell.role === 'CONTROL') {
    args = [
      '-n',
      '10',
      'npx',
      'tsx',
      '-e',
      CONTROL_RUNNER_SOURCE,
      cell.card,
      String(seed),
      String(cell.pairs),
      gitHead || 'UNKNOWN',
    ];
  } else {
    args = [
      '-n',
      '10',
      'npx',
      'tsx',
      'src/scripts/horseLeagueCard.ts',
      `--card=${cell.card}`,
      `--seed=${seed}`,
      `--pairs=${cell.pairs}`,
    ];
    if (hydrateSolverStores) {
      args.push('--hydrate-solver-stores');
    }
  }

  const res = spawnSync('nice', args, {
    cwd: serverDir,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  return {
    exitCode: typeof res.status === 'number' ? res.status : 1,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
    command: `nice ${args.join(' ')}`,
  };
}

// --- Helpers -----------------------------------------------------------------------------------

function resolveRelativePath(baseDir, targetPath) {
  if (!targetPath) return null;
  return isAbsolute(targetPath) ? targetPath : resolve(baseDir, targetPath);
}

function loadAndVerifyManifestAndCriteria(flags, deps, { requireCliCriteriaSha }) {
  if (!flags.manifest) {
    throw new Error('--manifest=<path> is required');
  }
  const manifestPath = resolve(flags.manifest);
  const manifestRaw = deps.readFileUtf8(manifestPath);
  const manifestSha256 = sha256Hex(manifestRaw);
  const rawObj = JSON.parse(manifestRaw);
  const manifest = validateCriteriaManifest(rawObj);

  if (requireCliCriteriaSha && !flags.criteriaSha) {
    throw new Error(
      '--criteria-sha=<64-hex> is required (refuses to start without pre-run SHA256)'
    );
  }

  let cliSha = null;
  if (flags.criteriaSha) {
    cliSha = normalizeSha256(flags.criteriaSha, '--criteria-sha');
    if (cliSha !== manifest.criteriaSha256) {
      return {
        manifestPath,
        manifestSha256,
        manifest,
        criteriaVerification: {
          ok: false,
          criteriaPath: flags.criteriaPath ?? manifest.criteriaPath,
          expectedSha256: cliSha,
          actualSha256: null,
          byteLength: 0,
          failures: [
            {
              code: 'CRITERIA_SHA_MANIFEST_MISMATCH',
              reason: `--criteria-sha (${cliSha}) does not match manifest.criteriaSha256 (${manifest.criteriaSha256})`,
            },
          ],
        },
      };
    }
  }

  const criteriaPathRaw = flags.criteriaPath ?? manifest.criteriaPath;
  const criteriaAbsPath = resolveRelativePath(dirname(manifestPath), criteriaPathRaw);
  let criteriaBytes = null;
  if (criteriaAbsPath && deps.exists(criteriaAbsPath)) {
    criteriaBytes = deps.readFileBuffer(criteriaAbsPath);
  }
  const criteriaVerification = verifyCriteriaContent({
    criteriaPath: criteriaAbsPath,
    criteriaBytes,
    expectedSha256: cliSha ?? manifest.criteriaSha256,
  });

  return {
    manifestPath,
    manifestSha256,
    manifest,
    criteriaVerification,
  };
}

function readRunnerHashes(deps) {
  let runnerSha256 = null;
  let libSha256 = null;
  try {
    if (deps.exists(THIS_FILE)) {
      runnerSha256 = sha256Hex(deps.readFileBuffer(THIS_FILE));
    }
    if (deps.exists(LIB_FILE)) {
      libSha256 = sha256Hex(deps.readFileBuffer(LIB_FILE));
    }
  } catch {
    // Leave null if unavailable in synthetic test env
  }
  return { runnerSha256, libSha256 };
}

function runPreflightCheck(flags, deps) {
  const loaded = loadAndVerifyManifestAndCriteria(flags, deps, { requireCliCriteriaSha: true });
  const workdir = resolve(flags.workdir || process.cwd());
  const gitState = deps.readGitState(workdir);
  const coreGate = deps.runCoreGate(flags.coreGateScript);
  const laneLock = flags.laneLock ? deps.readLaneLock(flags.laneLock) : null;
  const maxLoad1m =
    typeof flags.maxLoad1m === 'number' && Number.isFinite(flags.maxLoad1m)
      ? flags.maxLoad1m
      : loaded.manifest.bars.maxLoad1m;

  const gate = evaluateSystemGate({
    shepherdLockExists: deps.exists(flags.shepherdLock),
    shepherdLockPath: flags.shepherdLock,
    laneLock,
    expectedLaneOwner: flags.laneOwner,
    load1m: deps.getLoad1m(),
    maxLoad1m,
    coreGateExitCode: coreGate.exitCode,
    coreGateOutput: coreGate.output,
    gitHead: gitState.gitHead,
    gitTree: gitState.gitTree,
    gitPorcelain: gitState.gitPorcelain,
    criteriaVerification: loaded.criteriaVerification,
    checkedAtUtc: deps.now().toISOString(),
  });

  return {
    ...loaded,
    workdir,
    gate,
  };
}

// --- Subcommand Handlers -----------------------------------------------------------------------

async function handlePreflight(flags, deps) {
  const { manifest, manifestSha256, gate } = runPreflightCheck(flags, deps);
  const payload = {
    command: 'preflight',
    option: manifest.option,
    manifestSha256,
    ok: gate.ok,
    checks: gate.checks,
    failures: gate.failures,
    provenance: gate.provenance,
  };

  if (flags.json) {
    deps.stdout(JSON.stringify(payload, null, 2));
  } else {
    const lines = [
      `== PREFLIGHT ${manifest.option} ==`,
      `   criteriaSha256: ${gate.checks.criteriaSha256.actual ?? 'n/a'} (ok=${gate.checks.criteriaSha256.ok})`,
      `   shepherd.lock:  exists=${gate.checks.shepherdLock.exists} (ok=${gate.checks.shepherdLock.ok})`,
      `   load1m:         ${gate.checks.load1m.value ?? 'n/a'} < ${gate.checks.load1m.threshold} (ok=${gate.checks.load1m.ok})`,
      `   core-gate:      exit=${gate.checks.coreGate.exitCode} (ok=${gate.checks.coreGate.ok})`,
      `   git clean:      dirty=${gate.checks.gitClean.dirtyCount} head=${gate.provenance.gitHead ?? 'n/a'} tree=${gate.provenance.gitTree ?? 'n/a'}`,
      ...gate.failures.map((f) => `   BLOCKED [${f.code}]: ${f.reason}`),
      `   PREFLIGHT: ${gate.ok ? 'CLEAR' : 'REFUSED'}`,
    ];
    deps.stdout(lines.join('\n'));
  }

  return { exitCode: gate.ok ? EXIT_OK : EXIT_REFUSED, data: payload };
}

// Reads the cell-seed results an earlier run of this exact grade finished, for --resume.
// Reuse requires the identical provenance key; any finished job that failed refuses the grade
// rather than being re-run (re-running a failure until it passes would be a second look).
function loadResumableRecords({ deps, manifest, resumeKey, resumeKeyPath, resultsJsonlPath }) {
  const hasKey = deps.exists(resumeKeyPath);
  const hasResults = deps.exists(resultsJsonlPath);
  if (!hasKey && !hasResults) return { ok: true, records: [] };
  if (!hasKey) {
    return {
      ok: false,
      status: 'RESUME_PROVENANCE_UNKNOWN',
      message: `${resultsJsonlPath} exists without resume-key.json; its results cannot be tied to this exact grade. Use a fresh --out directory.`,
    };
  }
  let savedKey;
  try {
    savedKey = JSON.parse(deps.readFileUtf8(resumeKeyPath));
  } catch (err) {
    return {
      ok: false,
      status: 'RESUME_PROVENANCE_UNKNOWN',
      message: `resume-key.json is unreadable: ${err.message}`,
    };
  }
  const fields = Object.keys(resumeKey);
  const mismatched = fields.filter((f) => savedKey?.[f] !== resumeKey[f]);
  if (mismatched.length > 0 || Object.keys(savedKey ?? {}).length !== fields.length) {
    return {
      ok: false,
      status: 'RESUME_PROVENANCE_MISMATCH',
      message: `earlier results were produced under a different ${mismatched.join(', ') || 'key'}; they are not reused. Use a fresh --out directory.`,
      savedKey,
    };
  }
  if (!hasResults) return { ok: true, records: [] };
  let prior;
  try {
    prior = parseResultsJsonl(deps.readFileUtf8(resultsJsonlPath));
  } catch (err) {
    return { ok: false, status: 'RESUME_RESULTS_UNREADABLE', message: err.message };
  }
  const declared = new Set();
  for (const cell of manifest.cells) for (const seed of cell.seeds) declared.add(`${cell.id}::${seed}`);
  const seen = new Set();
  const failed = {};
  for (const rec of prior) {
    const key = `${rec.cellId}::${rec.seed}`;
    if (!declared.has(key) || seen.has(key)) {
      return {
        ok: false,
        status: 'RESUME_RESULTS_UNREADABLE',
        message: `results.jsonl holds ${seen.has(key) ? 'a duplicate' : 'an undeclared'} cell-seed ${key}`,
      };
    }
    seen.add(key);
    if (rec.exitCode !== 0) failed[key] = rec.exitCode;
  }
  if (Object.keys(failed).length > 0) {
    return {
      ok: false,
      status: 'ONE_LOOK_REFUSED_NONZERO_EXIT',
      message:
        'An earlier run of this exact grade finished a cell-seed job with a non-zero exit; it is not re-run and the grade is not scored (ONE-LOOK rule).',
      cellExitCodes: failed,
    };
  }
  return { ok: true, records: prior };
}

async function handleRun(flags, deps) {
  if (!flags.outDir) {
    throw new Error('--out=<out-dir> is required for run');
  }
  const outDir = resolve(flags.outDir);
  const pre = runPreflightCheck(flags, deps);
  if (!pre.gate.ok) {
    const payload = {
      command: 'run',
      option: pre.manifest.option,
      status: 'PREFLIGHT_REFUSED',
      failures: pre.gate.failures,
      checks: pre.gate.checks,
    };
    if (flags.json) {
      deps.stdout(JSON.stringify(payload, null, 2));
    } else {
      deps.stderr(
        [
          `REFUSED: preflight failed for ${pre.manifest.option}`,
          ...pre.gate.failures.map((f) => `  [${f.code}] ${f.reason}`),
        ].join('\n')
      );
    }
    return { exitCode: EXIT_REFUSED, data: payload };
  }

  const { manifest, manifestSha256, workdir, gate } = pre;
  const { runnerSha256, libSha256 } = readRunnerHashes(deps);
  const resultsJsonlPath = join(outDir, 'results.jsonl');
  const frozenManifestPath = join(outDir, 'manifest.frozen.json');
  const statusPath = join(outDir, 'run-status.json');
  const verdictJsonPath = join(outDir, 'verdict.json');
  const verdictMdPath = join(outDir, 'VERDICT.md');
  const resumeKeyPath = join(outDir, 'resume-key.json');
  // Everything a finished cell-seed result depends on. A result is reused only under this exact key.
  const resumeKey = {
    option: manifest.option,
    manifestSha256,
    criteriaSha256: pre.criteriaVerification.actualSha256,
    gitHead: gate.provenance.gitHead,
    gitTree: gate.provenance.gitTree,
    runnerSha256,
    libSha256,
  };

  // Optional owner-checked lane lock acquisition
  let acquiredLaneLock = false;
  if (flags.laneLock) {
    if (!flags.laneOwner) {
      throw new Error('--lane-owner=<id> is required when --lane-lock=<path> is specified');
    }
    const current = deps.readLaneLock(flags.laneLock);
    if (!current.exists) {
      deps.acquireLaneLock(flags.laneLock, flags.laneOwner, process.pid);
      acquiredLaneLock = true;
    }
  }

  try {
    const records = [];
    const cellExitCodes = {};
    let anyNonZero = false;
    const finished = new Set();

    if (flags.resume) {
      const prior = loadResumableRecords({
        deps,
        manifest,
        resumeKey,
        resumeKeyPath,
        resultsJsonlPath,
      });
      if (!prior.ok) {
        const payload = {
          command: 'run',
          option: manifest.option,
          status: prior.status,
          message: prior.message,
          ...(prior.cellExitCodes ? { cellExitCodes: prior.cellExitCodes } : {}),
          ...(prior.savedKey ? { savedKey: prior.savedKey, currentKey: resumeKey } : {}),
        };
        deps.writeFileUtf8(statusPath, `${JSON.stringify(payload, null, 2)}\n`);
        if (flags.json) deps.stdout(JSON.stringify(payload, null, 2));
        else deps.stderr(`RESUME REFUSED (${prior.status}): ${prior.message}`);
        return { exitCode: EXIT_REFUSED, data: payload };
      }
      for (const rec of prior.records) {
        const key = `${rec.cellId}::${rec.seed}`;
        finished.add(key);
        cellExitCodes[key] = 0;
        records.push(rec);
      }
    }

    deps.writeFileUtf8(frozenManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    deps.writeFileUtf8(resumeKeyPath, `${JSON.stringify(resumeKey, null, 2)}\n`);
    deps.writeFileUtf8(
      resultsJsonlPath,
      records.length > 0 ? records.map((r) => `${JSON.stringify(r)}\n`).join('') : ''
    );

    for (const cell of manifest.cells) {
      for (const seed of cell.seeds) {
        if (finished.has(`${cell.id}::${seed}`)) continue;
        // Re-check system gate before EVERY cell-seed job
        const midGate = evaluateSystemGate({
          shepherdLockExists: deps.exists(flags.shepherdLock),
          shepherdLockPath: flags.shepherdLock,
          laneLock: flags.laneLock ? deps.readLaneLock(flags.laneLock) : null,
          expectedLaneOwner: flags.laneOwner,
          load1m: deps.getLoad1m(),
          maxLoad1m:
            typeof flags.maxLoad1m === 'number' && Number.isFinite(flags.maxLoad1m)
              ? flags.maxLoad1m
              : manifest.bars.maxLoad1m,
          coreGateExitCode: deps.runCoreGate(flags.coreGateScript).exitCode,
          coreGateOutput: '',
          gitHead: gate.provenance.gitHead,
          gitTree: gate.provenance.gitTree,
          gitPorcelain: '',
          criteriaVerification: pre.criteriaVerification,
          checkedAtUtc: deps.now().toISOString(),
        });
        if (!midGate.ok) {
          const payload = {
            command: 'run',
            option: manifest.option,
            status: 'MIDRUN_GATE_ABORTED',
            abortedBefore: `${cell.id}::${seed}`,
            failures: midGate.failures,
            cellExitCodes,
          };
          deps.writeFileUtf8(statusPath, `${JSON.stringify(payload, null, 2)}\n`);
          if (flags.json) deps.stdout(JSON.stringify(payload, null, 2));
          else
            deps.stderr(
              `ABORTED before ${cell.id}::${seed}: ${midGate.failures.map((f) => f.code).join(', ')}`
            );
          return { exitCode: EXIT_REFUSED, data: payload };
        }

        const runRes = deps.runCellCommand({
          cell,
          seed,
          workdir,
          hydrateSolverStores: manifest.hydrateSolverStores,
          gitHead: gate.provenance.gitHead,
        });
        const key = `${cell.id}::${seed}`;
        const exitCode = typeof runRes.exitCode === 'number' ? runRes.exitCode : 1;
        cellExitCodes[key] = exitCode;

        const logFile = join(outDir, 'logs', `${cell.id}_${seed}.log`);
        deps.writeFileUtf8(
          logFile,
          `# command: ${runRes.command || ''}\n# exitCode: ${exitCode}\n${runRes.stdout || ''}${
            runRes.stderr ? `\n--- STDERR ---\n${runRes.stderr}` : ''
          }\n`
        );

        const parsed = parseHorseLeagueOutput(runRes.stdout || '');
        const match = parsed.find((p) => p.seed === seed) ?? parsed[0] ?? null;

        if (exitCode !== 0 || !match) {
          anyNonZero = true;
          const failRecord = {
            cellId: cell.id,
            card: cell.card,
            role: cell.role,
            group: cell.group,
            inertGuard: cell.inertGuard,
            seed,
            pairs: cell.pairs,
            hands: match?.hands ?? 0,
            bb100: match?.bb100 ?? 0,
            stderr: match?.stderr ?? 0,
            divergentPairs: match?.divergentPairs ?? 0,
            partedHands: match?.partedHands ?? 0,
            inert: true,
            illegalActions: match?.illegalActions ?? 0,
            truncatedStreets: match?.truncatedStreets ?? 0,
            brainExceptionFallbacks: match?.brainExceptionFallbacks ?? 0,
            exitCode: exitCode !== 0 ? exitCode : 1,
            engineRevision: match?.engineRevision ?? gate.provenance.gitHead,
            durationMs: match?.durationMs ?? null,
            logFile,
          };
          cellExitCodes[key] = failRecord.exitCode;
          records.push(failRecord);
          deps.appendFileUtf8(resultsJsonlPath, `${JSON.stringify(failRecord)}\n`);
          continue;
        }

        const okRecord = {
          cellId: cell.id,
          card: cell.card,
          role: cell.role,
          group: cell.group,
          inertGuard: cell.inertGuard,
          seed,
          pairs: cell.pairs,
          hands: match.hands,
          bb100: match.bb100,
          stderr: match.stderr,
          divergentPairs: match.divergentPairs,
          partedHands: match.partedHands,
          inert: match.inert,
          illegalActions: match.illegalActions,
          truncatedStreets: match.truncatedStreets,
          brainExceptionFallbacks: match.brainExceptionFallbacks,
          candidateIllegalActions: match.candidateIllegalActions,
          candidateTruncatedHands: match.candidateTruncatedHands,
          candidateBrainFallbacks: match.candidateBrainFallbacks,
          decidedSpots: match.decidedSpots ?? null,
          exitCode: 0,
          engineRevision: match.engineRevision ?? gate.provenance.gitHead,
          durationMs: match.durationMs,
          logFile,
        };
        records.push(okRecord);
        deps.appendFileUtf8(resultsJsonlPath, `${JSON.stringify(okRecord)}\n`);
      }
    }

    // STRICT ONE-LOOK ENFORCEMENT: never score if any cell exited non-zero!
    if (anyNonZero) {
      const payload = {
        command: 'run',
        option: manifest.option,
        status: 'ONE_LOOK_REFUSED_NONZERO_EXIT',
        message:
          'One or more cell-seed runs exited non-zero; refusing to score partial results (ONE-LOOK rule).',
        cellExitCodes,
        resultsJsonlPath,
      };
      deps.writeFileUtf8(statusPath, `${JSON.stringify(payload, null, 2)}\n`);
      if (flags.json) {
        deps.stdout(JSON.stringify(payload, null, 2));
      } else {
        deps.stderr(
          `ONE-LOOK REFUSED: non-zero exit code(s) detected; verdict NOT scored. See ${statusPath}`
        );
      }
      return { exitCode: EXIT_REFUSED, data: payload };
    }

    const jsonlContent = serializeResultsJsonl(records);
    deps.writeFileUtf8(resultsJsonlPath, jsonlContent);
    const resultsJsonlSha256 = sha256Hex(jsonlContent);

    const verdict = evaluateHoldemGrade({
      manifest,
      records,
      provenance: {
        criteriaSha256: pre.criteriaVerification.actualSha256,
        manifestSha256,
        gitHead: gate.provenance.gitHead,
        gitTree: gate.provenance.gitTree,
        runnerSha256,
        libSha256,
        resultsJsonlPath,
        resultsJsonlSha256,
      },
    });
    const markdown = renderVerdictMarkdown(verdict);

    deps.writeFileUtf8(verdictJsonPath, `${JSON.stringify(verdict, null, 2)}\n`);
    deps.writeFileUtf8(verdictMdPath, markdown);
    deps.writeFileUtf8(
      statusPath,
      `${JSON.stringify(
        {
          command: 'run',
          option: manifest.option,
          status: 'SCORED',
          verdict: verdict.verdict,
          cellExitCodes,
          verdictJsonPath,
          verdictMdPath,
          resultsJsonlPath,
          resultsJsonlSha256,
        },
        null,
        2
      )}\n`
    );

    if (flags.json) {
      deps.stdout(JSON.stringify(verdict, null, 2));
    } else {
      deps.stdout(
        `GRADE ${manifest.option}: ${verdict.verdict} (verdict: ${verdictJsonPath}, report: ${verdictMdPath})`
      );
    }

    return {
      exitCode: verdict.verdict === 'PASS' ? EXIT_OK : EXIT_REFUSED,
      data: verdict,
    };
  } finally {
    if (acquiredLaneLock && flags.laneLock) {
      deps.releaseLaneLock(flags.laneLock, flags.laneOwner, process.pid);
    }
  }
}

async function handleScore(flags, deps) {
  if (!flags.results) {
    throw new Error('--results=<results.jsonl> is required for score');
  }
  const loaded = loadAndVerifyManifestAndCriteria(flags, deps, { requireCliCriteriaSha: false });
  if (!loaded.criteriaVerification.ok) {
    const payload = {
      command: 'score',
      option: loaded.manifest.option,
      verdict: 'VOID',
      failures: loaded.criteriaVerification.failures,
    };
    if (flags.json) deps.stdout(JSON.stringify(payload, null, 2));
    else {
      deps.stderr(
        `REFUSED: criteria verification failed: ${loaded.criteriaVerification.failures
          .map((f) => f.reason)
          .join('; ')}`
      );
    }
    return { exitCode: EXIT_REFUSED, data: payload };
  }

  const resultsPath = resolve(flags.results);
  const rawJsonl = deps.readFileUtf8(resultsPath);
  const resultsJsonlSha256 = sha256Hex(rawJsonl);
  const records = parseResultsJsonl(rawJsonl);

  const workdir = flags.workdir ? resolve(flags.workdir) : null;
  const gitState = workdir ? deps.readGitState(workdir) : { gitHead: null, gitTree: null };
  const { runnerSha256, libSha256 } = readRunnerHashes(deps);

  const verdict = evaluateHoldemGrade({
    manifest: loaded.manifest,
    records,
    provenance: {
      criteriaSha256: loaded.criteriaVerification.actualSha256,
      manifestSha256: loaded.manifestSha256,
      gitHead: gitState.gitHead || null,
      gitTree: gitState.gitTree || null,
      runnerSha256,
      libSha256,
      resultsJsonlPath: resultsPath,
      resultsJsonlSha256,
    },
  });

  const markdown = renderVerdictMarkdown(verdict);
  if (flags.outDir) {
    const outDir = resolve(flags.outDir);
    deps.writeFileUtf8(join(outDir, 'verdict.json'), `${JSON.stringify(verdict, null, 2)}\n`);
    deps.writeFileUtf8(join(outDir, 'VERDICT.md'), markdown);
  }

  if (flags.json) {
    deps.stdout(JSON.stringify(verdict, null, 2));
  } else {
    deps.stdout(
      `SCORE ${loaded.manifest.option}: ${verdict.verdict} (bar1=${verdict.bars.bar1.ok} bar2=${verdict.bars.bar2.ok} bar3=${verdict.bars.bar3.ok} bar4=${verdict.bars.bar4.ok})`
    );
  }

  return {
    exitCode: verdict.verdict === 'PASS' ? EXIT_OK : EXIT_REFUSED,
    data: verdict,
  };
}

async function handleRecompute(flags, deps) {
  if (!flags.results) {
    throw new Error('--results=<results.jsonl> is required for recompute');
  }
  const loaded = loadAndVerifyManifestAndCriteria(flags, deps, { requireCliCriteriaSha: false });
  if (!loaded.criteriaVerification.ok) {
    const payload = {
      command: 'recompute',
      ok: false,
      failures: loaded.criteriaVerification.failures,
    };
    if (flags.json) deps.stdout(JSON.stringify(payload, null, 2));
    else {
      deps.stderr(
        `RECOMPUTE REFUSED: ${loaded.criteriaVerification.failures.map((f) => f.reason).join('; ')}`
      );
    }
    return { exitCode: EXIT_REFUSED, data: payload };
  }

  const resultsPath = resolve(flags.results);
  const rawJsonl = deps.readFileUtf8(resultsPath);
  const resultsJsonlSha256 = sha256Hex(rawJsonl);
  const records = parseResultsJsonl(rawJsonl);
  const { runnerSha256, libSha256 } = readRunnerHashes(deps);

  let existingVerdict = null;
  if (flags.compare) {
    existingVerdict = JSON.parse(deps.readFileUtf8(resolve(flags.compare)));
  }

  const recomputed = evaluateHoldemGrade({
    manifest: loaded.manifest,
    records,
    provenance: {
      criteriaSha256: loaded.criteriaVerification.actualSha256,
      manifestSha256: loaded.manifestSha256,
      gitHead: existingVerdict?.provenance?.gitHead ?? null,
      gitTree: existingVerdict?.provenance?.gitTree ?? null,
      runnerSha256,
      libSha256,
      resultsJsonlPath: resultsPath,
      resultsJsonlSha256,
    },
  });

  if (flags.outDir) {
    const outDir = resolve(flags.outDir);
    deps.writeFileUtf8(
      join(outDir, 'verdict.recomputed.json'),
      `${JSON.stringify(recomputed, null, 2)}\n`
    );
    deps.writeFileUtf8(join(outDir, 'VERDICT.recomputed.md'), renderVerdictMarkdown(recomputed));
  }

  let comparison = null;
  if (existingVerdict) {
    comparison = compareVerdictsForRecompute(existingVerdict, recomputed);
  }

  const ok = comparison ? comparison.ok : true;
  const payload = {
    command: 'recompute',
    ok,
    verdict: recomputed.verdict,
    resultsJsonlSha256,
    criteriaSha256: loaded.criteriaVerification.actualSha256,
    comparison,
    recomputed,
  };

  if (flags.json) {
    deps.stdout(JSON.stringify(payload, null, 2));
  } else if (comparison) {
    deps.stdout(
      `RECOMPUTE ${loaded.manifest.option}: verdict=${recomputed.verdict} parity=${comparison.ok ? 'EXACT' : 'MISMATCH'}` +
        (comparison.diffs.length > 0 ? `\n  diffs: ${comparison.diffs.join('; ')}` : '')
    );
  } else {
    deps.stdout(
      `RECOMPUTE ${loaded.manifest.option}: verdict=${recomputed.verdict} resultsSha256=${resultsJsonlSha256}`
    );
  }

  return { exitCode: ok ? EXIT_OK : EXIT_REFUSED, data: payload };
}

// --- Entrypoint --------------------------------------------------------------------------------

export async function runGradeCli(argv, injectedDeps = {}) {
  const deps = {
    readFileBuffer: defaultReadFileBuffer,
    readFileUtf8: defaultReadFileUtf8,
    writeFileUtf8: defaultWriteFileUtf8,
    appendFileUtf8: defaultAppendFileUtf8,
    exists: defaultExists,
    env: process.env,
    getLoad1m: defaultGetLoad1m,
    runCoreGate: defaultRunCoreGate,
    readGitState: defaultReadGitState,
    readLaneLock: defaultReadLaneLock,
    acquireLaneLock: defaultAcquireLaneLock,
    releaseLaneLock: defaultReleaseLaneLock,
    runCellCommand: defaultRunCellCommand,
    now: () => new Date(),
    stdout: (msg) => console.log(msg),
    stderr: (msg) => console.error(msg),
    ...injectedDeps,
  };
  const { command, flags } = parseGradeCliArgs(argv, {
    env: deps.env,
    pathExists: deps.exists,
  });

  if (command === 'help') {
    deps.stdout(USAGE);
    return { exitCode: EXIT_OK, data: null };
  }
  if (command === 'preflight') return handlePreflight(flags, deps);
  if (command === 'run') return handleRun(flags, deps);
  if (command === 'score') return handleScore(flags, deps);
  if (command === 'recompute') return handleRecompute(flags, deps);

  throw new Error(
    `Unknown subcommand "${command}". Expected: preflight, run, score, recompute, help`
  );
}

const isDirectRun =
  process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  runGradeCli(process.argv.slice(2))
    .then(({ exitCode }) => {
      process.exit(exitCode);
    })
    .catch((err) => {
      console.error(`ERROR: ${err?.message || String(err)}`);
      process.exit(EXIT_ERROR);
    });
}
