#!/usr/bin/env node
/**
 * Cross-build Horse decision replay (read-only; no database, no network).
 *
 * "Does this change alter any Horse decision while its switches are as they are in production?" The same decision
 * states go through `HorseLogic.decide` on two builds, with the same option rows and the same random seeds, and the
 * action, amount, full decision JSON and rule receipts are compared.
 *
 *   capture   generate a seeded state set by playing league hands on one build
 *   replay    run a state set through one build with one option set
 *   diff      compare two replays; prints "0 differences" or the differing decisions grouped by receipt
 *   bisect    find the commit between two refs that first changes the differing decisions
 *
 * The one-command form for a lane is scripts/ops/horse-flag-off-check.sh <base-ref> <head-ref>.
 * Method, how to read the result and what it does NOT cover: docs/ops/horse-flag-off-check.md.
 */
import { spawn, execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AUGMENT_VERSION,
  DEFAULT_MEMORY_HANDS,
  DEFAULT_SEEDS,
  GROUP_PLANS,
  MEMORY_MODES,
  REPLAY_SCHEMA,
  STATE_SET_SCHEMA,
  applyVariants,
  classifyAgainst,
  comparisonRefused,
  decisionKey,
  diffDecisions,
  digestOf,
  formatDiffReport,
  optionRowsFromJson,
  parseVariant,
  planTargets,
} from './horse-decision-crossbuild-replay-lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const ENGINE_ENTRY = join(__dirname, 'horse-decision-crossbuild-replay-engine.mjs');
export const DEFAULT_OPTIONS_FILE = join(REPO_ROOT, 'docs', 'horse-option-switch-state.json');
export const MAX_JOBS = 3;

export const USAGE = `Usage: node scripts/ops/horse-decision-crossbuild-replay.mjs <command> [options]

  capture --build <worktree> --out <states dir>
          [--options <file>] [--variant +option=on]... [--set quick|full] [--scale <n>] [--groups a,b] [--jobs 1..${MAX_JOBS}]
      Plays seeded league hands on <worktree> and records every decision state.
      quick = about 3,000 states (default); full = about 14,000 (the 2026-11-22 set).

  replay  --build <worktree> --states <states dir> --out <replay dir>
          [--options <file>] [--variant +option=on]... [--seeds 1,20261122]
          [--memory some|off|all] [--memory-hands ${DEFAULT_MEMORY_HANDS}] [--jobs 1..${MAX_JOBS}]
      Runs every state through that build's HorseLogic.decide and writes the decisions.

  diff    --head <replay dir> --base <replay dir> [--states <states dir>] [--json <file>] [--max-groups <n>]
      Exit 0 and "0 differences", or exit 1 and the differing decisions grouped by receipt.
      Exit 2 when the two replays cannot be compared (different states, seeds or input variations).

  bisect  --good <ref> --bad <ref> --states <states dir> --scratch <dir on the external SSD>
          [--repo <checkout>] [--options <file>] [--variant ...] [--paths server/src] [--node-modules <dir>] [--keep]
      Replays on both refs, takes the states that differ, and finds the first commit that changes them.

Options file: the production switch snapshot kept in the repo (default docs/horse-option-switch-state.json) or
plain rows {"rows": {"<option>": "on"}}. A variant changes one row ("+omahaStreetPlan=on") or sets a decide option
past the switch registry ("+raw:someOption=true"). Each build maps the rows with its OWN switch code.

<worktree> needs server/node_modules (a symlink to an installed one is enough) for the TypeScript loader.
`;

function parseArgs(argv) {
  const out = { _: [], variant: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') out.help = true;
    else if (a === '--keep') out.keep = true;
    else if (a === '--variant') out.variant.push(argv[++i]);
    else if (a.startsWith('--')) {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      out[a.slice(2)] = v;
    } else out._.push(a);
  }
  return out;
}

const need = (args, name) => {
  if (!args[name]) throw new Error(`--${name} is required`);
  return args[name];
};
const jobsOf = (args) => {
  const n = args.jobs === undefined ? MAX_JOBS : Number(args.jobs);
  if (!Number.isInteger(n) || n < 1 || n > MAX_JOBS)
    throw new Error(`--jobs must be 1..${MAX_JOBS} (the Mac is shared)`);
  return n;
};

function git(dir, ...args) {
  return execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

export function buildIdentity(build) {
  const root = resolve(build);
  let commit = null;
  let dirtyFiles = null;
  try {
    commit = git(root, 'rev-parse', 'HEAD');
    dirtyFiles = git(root, 'status', '--porcelain', '--', 'server/src')
      .split('\n')
      .filter(Boolean).length;
  } catch {
    /* not a git checkout: the header says unknown */
  }
  return { root, commit, dirtyFiles };
}

function serverDirOf(build) {
  const root = resolve(build);
  const server = existsSync(join(root, 'server', 'src', 'engine', 'HorseLogic.ts'))
    ? join(root, 'server')
    : root;
  if (!existsSync(join(server, 'src', 'engine', 'HorseLogic.ts')))
    throw new Error(`${build} is not a Club Arena checkout (no server/src/engine/HorseLogic.ts)`);
  if (!existsSync(join(server, 'node_modules', 'tsx')))
    throw new Error(
      `${server}/node_modules has no tsx: link an installed server/node_modules into the worktree (ln -s <installed>/server/node_modules ${server}/node_modules)`
    );
  return server;
}

function loadOptions(args) {
  const file = resolve(args.options ?? DEFAULT_OPTIONS_FILE);
  const { rows, source } = optionRowsFromJson(JSON.parse(readFileSync(file, 'utf8')));
  const variants = args.variant.map((v) => {
    parseVariant(v);
    return v.startsWith('+') ? v : `+${v}`;
  });
  return { file, rows, source, variants, rowsDigest: digestOf(applyVariants(rows, variants)) };
}

/** Runs engine jobs, each in its own `node --import tsx` process inside the build's server directory. */
async function runJobs(build, jobs, parallel, jobDir, label) {
  const server = serverDirOf(build);
  mkdirSync(jobDir, { recursive: true });
  const env = {
    ...process.env,
    SUPABASE_URL: 'https://supabase.invalid',
    SUPABASE_SERVICE_ROLE_KEY: 'unit-test-placeholder-key',
    VITEST: '1',
    NODE_ENV: 'test',
    NODE_NO_WARNINGS: '1',
    EQUITY_GOVERNOR: 'off',
  };
  const results = new Array(jobs.length);
  let next = 0;
  const one = async () => {
    for (;;) {
      const i = next++;
      if (i >= jobs.length) return;
      const job = {
        ...jobs[i],
        build: resolve(build),
        result: join(jobDir, `${label}-${i}.result.json`),
      };
      const jobFile = join(jobDir, `${label}-${i}.job.json`);
      writeFileSync(jobFile, JSON.stringify(job));
      const code = await new Promise((done) => {
        const child = spawn(process.execPath, ['--import', 'tsx', ENGINE_ENTRY, jobFile], {
          cwd: server,
          env,
          stdio: ['ignore', 'ignore', 'pipe'],
        });
        let err = '';
        child.stderr.on('data', (d) => {
          err = (err + d).slice(-4000);
        });
        child.on('close', (c) => {
          if (c !== 0 && err) process.stderr.write(err + '\n');
          done(c);
        });
      });
      let result = null;
      try {
        result = JSON.parse(readFileSync(job.result, 'utf8'));
      } catch {
        /* the child died before writing */
      }
      if (code !== 0 || !result?.ok)
        throw new Error(
          `${label} job ${jobs[i].group ?? i} failed on ${build}: ${result?.error ?? 'exit ' + code}`
        );
      results[i] = result;
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, jobs.length) }, one));
  return results;
}

export async function capture(args) {
  const build = need(args, 'build');
  const out = resolve(need(args, 'out'));
  const options = loadOptions(args);
  const set = args.set ?? 'quick';
  const targets = planTargets(
    set,
    args.scale ?? null,
    args.groups ? args.groups.split(',').filter(Boolean) : null
  );
  mkdirSync(out, { recursive: true });
  const jobs = Object.entries(targets).map(([group, target]) => ({
    kind: 'capture',
    group,
    target,
    rows: options.rows,
    variants: options.variants,
    out: join(out, `states-${group}.ndjson`),
  }));
  const started = Date.now();
  const results = await runJobs(build, jobs, jobsOf(args), join(out, '.jobs'), 'capture');
  const identity = buildIdentity(build);
  const counts = Object.fromEntries(results.map((r) => [r.group, r.total]));
  const total = results.reduce((a, r) => a + r.total, 0);
  const manifest = {
    schema: STATE_SET_SCHEMA,
    id: `${args.scale ? 'scale' + args.scale : set}@${(identity.commit ?? 'unknown').slice(0, 12)}/${options.rowsDigest}/${total}`,
    set: args.scale ? `scale ${args.scale}` : set,
    total,
    targets,
    counts,
    streets: Object.fromEntries(results.map((r) => [r.group, r.kept])),
    weak: Object.fromEntries(
      Object.entries(GROUP_PLANS)
        .filter(([g, p]) => p.weak && targets[g])
        .map(([g, p]) => [g, p.weak])
    ),
    handErrors: results.reduce((a, r) => a + r.handErrors, 0),
    firstHandError: results.find((r) => r.firstHandError)?.firstHandError ?? null,
    generator: {
      ...identity,
      node: results[0]?.node ?? process.version,
      tool: buildIdentity(REPO_ROOT).commit,
    },
    options: {
      file: options.file,
      source: options.source,
      variants: options.variants,
      rowsDigest: options.rowsDigest,
      receivedDigest: digestOf(results[0]?.received ?? {}),
      refusedOnThisBuild: results[0]?.refused ?? [],
    },
    seconds: Math.round((Date.now() - started) / 1000),
  };
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  rmSync(join(out, '.jobs'), { recursive: true, force: true });
  console.log(`captured ${total} states in ${manifest.seconds}s -> ${out} (set ${manifest.id})`);
  if (manifest.handErrors)
    console.log(
      `WARNING: ${manifest.handErrors} hands threw while being dealt (${manifest.firstHandError})`
    );
  return manifest;
}

function stateFilesOf(dir) {
  return readdirSync(dir)
    .filter((f) => /^states-.+\.ndjson$/.test(f))
    .sort()
    .map((f) => ({ group: f.replace(/^states-|\.ndjson$/g, ''), file: join(dir, f) }));
}

export async function replay(args) {
  const build = need(args, 'build');
  const statesDir = resolve(need(args, 'states'));
  const out = resolve(need(args, 'out'));
  const options = loadOptions(args);
  const seeds = args.seeds ? args.seeds.split(',').map(Number) : [...DEFAULT_SEEDS];
  if (!seeds.length || seeds.some((s) => !Number.isInteger(s)))
    throw new Error('--seeds must be integers');
  const memory = args.memory ?? 'some';
  if (!MEMORY_MODES.includes(memory))
    throw new Error(`--memory must be one of ${MEMORY_MODES.join(', ')}`);
  const memoryHands =
    args['memory-hands'] === undefined ? DEFAULT_MEMORY_HANDS : Number(args['memory-hands']);
  if (!Number.isInteger(memoryHands) || memoryHands < 1 || memoryHands > 2000)
    throw new Error('--memory-hands must be 1..2000');
  const files = stateFilesOf(statesDir);
  if (!files.length) throw new Error(`${statesDir} has no states-*.ndjson`);
  let manifest = null;
  try {
    manifest = JSON.parse(readFileSync(join(statesDir, 'manifest.json'), 'utf8'));
  } catch {
    /* a hand-made state set: the header says so */
  }
  mkdirSync(out, { recursive: true });
  const jobs = files.map(({ group, file }) => ({
    kind: 'replay',
    group,
    states: file,
    rows: options.rows,
    variants: options.variants,
    seeds,
    memory,
    memoryHands,
    out: join(out, `dec-${group}.ndjson`),
    allowUnmet: args['allow-unmet'] === 'yes',
  }));
  const started = Date.now();
  const results = await runJobs(build, jobs, jobsOf(args), join(out, '.jobs'), 'replay');
  const memoryStatus = { seeded: 0, error: 0, unavailable: 0, firstError: null };
  for (const r of results) {
    memoryStatus.seeded += r.memoryStatus.seeded;
    memoryStatus.error += r.memoryStatus.error;
    memoryStatus.unavailable += r.memoryStatus.unavailable;
    memoryStatus.firstError ??= r.memoryStatus.firstError;
  }
  const states = results.reduce((a, r) => a + r.states, 0);
  const header = {
    schema: REPLAY_SCHEMA,
    node: results[0].node,
    platform: `${process.platform}-${process.arch}`,
    build: buildIdentity(build),
    tool: buildIdentity(REPO_ROOT).commit,
    stateSet: {
      id: `${manifest?.id ?? 'hand-made'}:${files.map((f) => f.group).join(',')}:${states}`,
      dir: statesDir,
      states,
      generator: manifest?.generator?.commit ?? null,
    },
    seeds,
    augmentVersion: AUGMENT_VERSION,
    memory,
    memoryHands,
    memoryStatus,
    options: {
      file: options.file,
      source: options.source,
      variants: options.variants,
      rowsDigest: options.rowsDigest,
      received: results[0].received,
      unknownOnThisBuild: results[0].unknown,
      refusedOnThisBuild: results[0].refused ?? [],
      unmetVariants: results[0].unmet,
    },
    missingParts: results[0].missingParts,
    decisions: results.reduce((a, r) => a + r.decisions, 0),
    errors: results.reduce((a, r) => a + r.errors, 0),
    perGroup: Object.fromEntries(
      results.map((r) => [r.group, { states: r.states, decisions: r.decisions, errors: r.errors }])
    ),
    seconds: Math.round((Date.now() - started) / 1000),
  };
  writeFileSync(join(out, 'replay-header.json'), JSON.stringify(header, null, 1) + '\n');
  rmSync(join(out, '.jobs'), { recursive: true, force: true });
  console.log(
    `replayed ${header.decisions} decisions (${states} states x ${seeds.length} seeds) on ${header.build.commit?.slice(0, 12) ?? build} in ${header.seconds}s, Node ${header.node}, ${header.errors} errors -> ${out}`
  );
  if (header.options.refusedOnThisBuild?.length)
    console.log(
      `NOTE: this build REFUSES the row(s) ${header.options.refusedOnThisBuild.join(', ')}; they were dropped there and every other row kept`
    );
  if (header.options.unknownOnThisBuild?.length)
    console.log(
      `NOTE: this build does not know ${header.options.unknownOnThisBuild.join(', ')}; it did not receive them`
    );
  return header;
}

function readReplay(dir) {
  const rows = [];
  for (const f of readdirSync(dir)
    .filter((f) => /^dec-.+\.ndjson$/.test(f))
    .sort())
    for (const line of readFileSync(join(dir, f), 'utf8').split('\n'))
      if (line) rows.push(JSON.parse(line));
  let header = null;
  try {
    header = JSON.parse(readFileSync(join(dir, 'replay-header.json'), 'utf8'));
  } catch {
    /* reported by the comparison */
  }
  return { rows, header };
}

function readStates(dir) {
  const states = new Map();
  if (!dir || !existsSync(dir)) return null;
  for (const { file } of stateFilesOf(dir))
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line) continue;
      const s = JSON.parse(line);
      states.set(s.k, s);
    }
  return states;
}

export function diff(args) {
  const head = readReplay(resolve(need(args, 'head')));
  const base = readReplay(resolve(need(args, 'base')));
  const states = readStates(args.states ? resolve(args.states) : head.header?.stateSet?.dir);
  const result = diffDecisions({ head: head.rows, base: base.rows, states });
  const refused = comparisonRefused(head.header, base.header);
  const report = formatDiffReport(result, {
    headHeader: head.header,
    baseHeader: base.header,
    maxGroups: args['max-groups'] ? Number(args['max-groups']) : 30,
  });
  if (args.json)
    writeFileSync(
      resolve(args.json),
      JSON.stringify({ ...result, head: head.header, base: base.header, refused }, null, 1) + '\n'
    );
  if (refused) {
    console.log(
      'NOT COMPARABLE: the two replays did not run the same inputs. Nothing below is a verdict.'
    );
    console.log(report);
    return 2;
  }
  if (result.totals.compared === 0) {
    console.log('NOT COMPARABLE: no decision is present in both replays.');
    return 2;
  }
  console.log(report);
  return result.differences === 0 ? 0 : 1;
}

function addWorktree(repo, dir, ref, nodeModules) {
  git(repo, 'worktree', 'add', '--detach', dir, ref);
  symlinkSync(nodeModules, join(dir, 'server', 'node_modules'));
}

export async function bisect(args) {
  const repo = resolve(args.repo ?? REPO_ROOT);
  const statesDir = resolve(need(args, 'states'));
  const scratch = resolve(need(args, 'scratch'));
  if (!existsSync(scratch)) throw new Error(`--scratch ${scratch} does not exist`);
  const good = git(repo, 'rev-parse', '--verify', `${need(args, 'good')}^{commit}`);
  const bad = git(repo, 'rev-parse', '--verify', `${need(args, 'bad')}^{commit}`);
  const paths = (args.paths ?? 'server/src').split(',').filter(Boolean);
  const nodeModules = realpathSync(
    args['node-modules'] ?? join(REPO_ROOT, 'server', 'node_modules')
  );
  const own = join(scratch, `horse-bisect-${process.pid}-${Date.now().toString(36)}`);
  mkdirSync(own);
  const wt = join(own, 'wt');
  const pass = {
    options: args.options,
    variant: args.variant,
    seeds: args.seeds,
    memory: args.memory,
    'memory-hands': args['memory-hands'],
    jobs: args.jobs,
  };
  let added = false;
  try {
    addWorktree(repo, wt, good, nodeModules);
    added = true;
    console.log(
      `bisect: replaying the whole set on good ${good.slice(0, 12)} and bad ${bad.slice(0, 12)}`
    );
    await replay({ ...pass, build: wt, states: statesDir, out: join(own, 'good') });
    git(wt, 'checkout', '-q', '--detach', bad);
    await replay({ ...pass, build: wt, states: statesDir, out: join(own, 'bad') });
    const goodAll = readReplay(join(own, 'good'));
    const badAll = readReplay(join(own, 'bad'));
    const first = diffDecisions({ head: badAll.rows, base: goodAll.rows });
    if (first.differences === 0) {
      console.log(
        `bisect: 0 differences between ${good.slice(0, 12)} and ${bad.slice(0, 12)} on this state set; nothing to bisect`
      );
      return 0;
    }
    const keys = new Set(first.examples.map((d) => d.k));
    const decisionKeys = new Set(first.examples.map((d) => d.key));
    // the differing states, each keeping its original index so the input variations stay the same
    const subset = join(own, 'subset');
    mkdirSync(subset);
    for (const { group, file } of stateFilesOf(statesDir)) {
      const kept = [];
      let idx = 0;
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!line) continue;
        const s = JSON.parse(line);
        if (keys.has(s.k)) kept.push(JSON.stringify({ ...s, i0: s.i0 ?? idx }));
        idx++;
      }
      if (kept.length)
        writeFileSync(join(subset, `states-${group}.ndjson`), kept.join('\n') + '\n');
    }
    if (existsSync(join(statesDir, 'manifest.json')))
      copyFileSync(join(statesDir, 'manifest.json'), join(subset, 'manifest.json'));
    // The references are replays of the SUBSET on good and bad, not rows cut from the whole-set replays: a few
    // receipts fire once per process ("..._seen" on the first decision that meets a feature), so a decision's
    // receipts depend on what the same process decided before it. Every step below replays the same subset in the
    // same order, and so must the two references.
    await replay({ ...pass, build: wt, states: subset, out: join(own, 'bad-subset') });
    git(wt, 'checkout', '-q', '--detach', good);
    await replay({ ...pass, build: wt, states: subset, out: join(own, 'good-subset') });
    const goodRows = readReplay(join(own, 'good-subset')).rows.filter((r) =>
      decisionKeys.has(decisionKey(r))
    );
    const badRows = readReplay(join(own, 'bad-subset')).rows.filter((r) =>
      decisionKeys.has(decisionKey(r))
    );
    const commits = git(
      repo,
      'rev-list',
      '--reverse',
      '--first-parent',
      `${good}..${bad}`,
      '--',
      ...paths
    )
      .split('\n')
      .filter(Boolean);
    if (commits[commits.length - 1] !== bad) commits.push(bad);
    console.log(
      `bisect: ${first.differences} differing decisions in ${keys.size} states; ${commits.length} candidate commits touching ${paths.join(', ')}`
    );
    let lo = -1;
    let hi = commits.length - 1;
    const seen = [];
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      git(wt, 'checkout', '-q', '--detach', commits[mid]);
      const dir = join(own, `mid-${mid}`);
      await replay({ ...pass, build: wt, states: subset, out: dir });
      const c = classifyAgainst(
        readReplay(dir).rows.filter((r) => decisionKeys.has(decisionKey(r))),
        goodRows,
        badRows
      );
      seen.push({ commit: commits[mid], ...c });
      console.log(
        `bisect: ${commits[mid].slice(0, 12)} decides ${c.likeBase} like good, ${c.likeHead} like bad, ${c.neither} like neither -> ${c.verdict === 'base' ? 'unchanged' : 'changed'}`
      );
      if (c.verdict === 'base') lo = mid;
      else hi = mid;
    }
    const culprit = commits[hi];
    const at = seen.find((s) => s.commit === culprit);
    console.log('');
    console.log(
      `first commit that changes these decisions: ${git(repo, 'log', '-1', '--format=%H %ci %s', culprit)}`
    );
    console.log(
      `last commit that decides like good:        ${lo >= 0 ? git(repo, 'log', '-1', '--format=%H %ci %s', commits[lo]) : good + ' (good itself)'}`
    );
    if (at && at.verdict === 'mixed')
      console.log(
        `NOTE: at that commit ${at.likeBase} of the decisions still decide like good and ${at.neither} like neither: a later commit changes them too. Re-run with --good ${culprit.slice(0, 12)}.`
      );
    if (args.json)
      writeFileSync(
        resolve(args.json),
        JSON.stringify(
          {
            good,
            bad,
            culprit,
            lastGood: lo >= 0 ? commits[lo] : good,
            steps: seen,
            differences: first.differences,
            states: keys.size,
          },
          null,
          1
        ) + '\n'
      );
    return 1;
  } finally {
    if (!args.keep) {
      if (added) {
        try {
          git(repo, 'worktree', 'remove', '--force', wt);
        } catch (e) {
          console.error(`could not remove the bisect worktree ${wt}: ${e.message}`);
        }
      }
      rmSync(own, { recursive: true, force: true });
    } else console.log(`kept ${own}`);
  }
}

async function main(argv) {
  const args = parseArgs(argv);
  const command = args._[0];
  if (args.help || !command) {
    console.log(USAGE);
    return command || args.help ? 0 : 2;
  }
  if (command === 'capture') return (await capture(args)) && 0;
  if (command === 'replay') return (await replay(args)) && 0;
  if (command === 'diff') return diff(args);
  if (command === 'bisect') return bisect(args);
  throw new Error(`unknown command "${command}"`);
}

let isEntrypoint = false;
try {
  isEntrypoint =
    Boolean(process.argv[1]) &&
    realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
} catch {
  isEntrypoint = false;
}
if (isEntrypoint)
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      console.error(`horse-decision-crossbuild-replay: ${e?.message ?? e}`);
      process.exitCode = 2;
    }
  );
