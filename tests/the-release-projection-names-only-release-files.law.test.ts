/**
 * LAW: the release-control projection names only release files, and every
 * release file is inside it.
 *
 * Background (O31, 2026-11-26). `projection(sha)` in
 * scripts/ci/read-engine-prequalification.py must be equal between a certified
 * commit and the control commit or the selector refuses the certificate
 * ("qualification inputs differ from selected control"). It hashes the whole
 * of server/scripts minus a short list of proven non-release families. At
 * 07:15 Chicago the Horse lane merged ad8d1e8f1 (#12085), which changed
 * server/scripts/oop-reraise-range/league.ts, a Horse research league that no
 * release surface reads. The freshly certified build 13bce958d4c3 became
 * unselectable and the 10:00 Chicago cycle had nothing to ship.
 *
 * Three invariants:
 *   (a) every server/scripts file reached from the release surfaces (the four
 *       release workflows, server/Dockerfile, server/standby, the lifecycle
 *       scripts of server/package.json the qualification runs, the explicit
 *       CONTROL_INPUTS files and every scripts/ci, scripts/release or
 *       .github helper they name, transitively) is hashed by the projection;
 *   (b) on a real git repository, a commit touching only Horse research
 *       scripts leaves projection() unchanged, and a commit touching
 *       engine-release-transaction.sh changes it;
 *   (c) the exclusion rule and the proven release set are pinned, so widening
 *       or narrowing either is a deliberate diff in this file.
 *
 * Pure test files stay outside by the earlier O4 rule and are not walked.
 * A file under server/scripts that nothing here names stays hashed: the rule
 * is an exclusion list, so the default for a new or unknown script is IN.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(__dirname, '..');
const PREQUAL_REL = 'scripts/ci/read-engine-prequalification.py';

const RELEASE_WORKFLOWS = [
  '.github/workflows/stage-engine-release.yml',
  '.github/workflows/auto-deploy-hetzner.yml',
  '.github/workflows/backup-engine.yml',
  '.github/workflows/engine-release-prequalification.yml',
];

/** npm lifecycle names the qualification can run: `npm ci`, `npm run build`, `npm test`. */
const QUALIFICATION_NPM_SCRIPTS = [
  'preinstall',
  'install',
  'postinstall',
  'prepare',
  'prebuild',
  'build',
  'postbuild',
  'pretest',
  'test',
  'posttest',
];

/** (c) The exclusion rule, pinned. Changing it is a release-control change. */
const PINNED_NON_RELEASE_PREFIXES = [
  'server/scripts/opponent-hud-',
  'server/scripts/horse-',
  'server/scripts/holdem-',
  'server/scripts/audited-',
  'server/scripts/hvh48-',
  'server/scripts/benchmark-',
  'server/scripts/gen-',
  'server/scripts/generate-',
  'server/scripts/measure-',
  'server/scripts/nash-push-fold/',
  'server/scripts/fixtures/',
  'server/scripts/oop-reraise-range/',
  'server/scripts/omaha-reraised-pot-priced/',
  'server/scripts/feature-ablation-',
  'server/scripts/gto-v31-',
  'server/scripts/assemble-public215-',
];
const PINNED_NON_RELEASE_EXACT = [
  'server/scripts/style-shadow-rerun.mjs',
  'server/scripts/river-one-pair-fixture.ts',
  'server/scripts/prepare-public215-feature-request.py',
];

/** (c) The server/scripts files proven to be on the release route, pinned. */
const PINNED_RELEASE_SCRIPTS = [
  'server/scripts/build-engine-image.sh',
  'server/scripts/build-public-hist215-native.mjs',
  'server/scripts/collect-monitoring-health.sh',
  'server/scripts/engine-crash-drill.sh',
  'server/scripts/engine-drill-database-proof.py',
  'server/scripts/engine-prestage-config-proof.py',
  'server/scripts/engine-release-activation-floor.py',
  'server/scripts/engine-release-database-proof.py',
  'server/scripts/engine-release-inflight-hands.py',
  'server/scripts/engine-release-installed-migrations.py',
  'server/scripts/engine-release-intake.sh',
  'server/scripts/engine-release-lightning-hold.py',
  'server/scripts/engine-release-protocol-v1.schema',
  'server/scripts/engine-release-recover.sh',
  'server/scripts/engine-release-seal.py',
  'server/scripts/engine-release-transaction.sh',
  'server/scripts/engine-release-unit-wrapper.sh',
  'server/scripts/engine-release-window-doors.py',
  'server/scripts/engine-supervisor.sh',
  'server/scripts/engine-up.sh',
  'server/scripts/fix-vitest-esbuild.mjs',
  'server/scripts/install-engine-drill.sh',
  'server/scripts/install-engine-intake.sh',
  'server/scripts/install-engine-supervisor.sh',
  'server/scripts/launch-engine-release.sh',
  'server/scripts/legacy-census-scale-composition.mjs',
  'server/scripts/legacy-census-scale-fixture.mjs',
  'server/scripts/legacy-census-scale-preflight.py',
  'server/scripts/legacy-engine-checkpoint-guard.mjs',
  'server/scripts/legacy-engine-checkpoint.mjs',
  'server/scripts/legacy-engine-checkpoint.sh',
  'server/scripts/main-inspector-retirement-entry.mjs',
  'server/scripts/main-inspector-retirement.py',
  'server/scripts/main-inspector-socket-qualification.mjs',
  'server/scripts/native/build-legacy-census.mjs',
  'server/scripts/native/legacy-census.cc',
  'server/scripts/observe-engine-release.sh',
  'server/scripts/phase6d-population.mjs',
  'server/scripts/phase6d-turn-census.mjs',
  'server/scripts/prewarm-engine-image.sh',
  'server/scripts/qualification/retained-original-checkpoint/README.md',
  'server/scripts/qualification/retained-original-checkpoint/owned-command.mjs',
  'server/scripts/qualification/retained-original-checkpoint/qualify.mjs',
  'server/scripts/qualify-terminal-intent-transport.ts',
  'server/scripts/quarantine-generated-control-cache.py',
  'server/scripts/retain-engine-images.sh',
  'server/scripts/retained-original-checkpoint-guard.mjs',
  'server/scripts/retire-owned-main-inspector.mjs',
  'server/scripts/verify-recovery-stack.sh',
];

/** Files that are read as data and cannot run or import a script themselves. */
const DATA_FILE = /\.(json|md|sql|txt|csv|schema|lock|cc|node)$/;

interface Constants {
  CONTROL_INPUTS: string[];
  NON_RELEASE_SERVER_SCRIPT_PREFIXES: string[];
  NON_RELEASE_SERVER_SCRIPT_EXACT: string[];
  PURE_TEST_FILE_SUFFIXES: string[];
  stripLineRanges: Array<[number, number]>;
}

function readConstants(): Constants {
  const py = [
    'import ast, json, pathlib, sys',
    'tree = ast.parse(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))',
    'wanted = {"CONTROL_INPUTS", "NON_RELEASE_SERVER_SCRIPT_PREFIXES", "NON_RELEASE_SERVER_SCRIPT_EXACT", "PURE_TEST_FILE_SUFFIXES"}',
    'found, ranges = {}, []',
    'for node in tree.body:',
    '    if isinstance(node, ast.Assign):',
    '        for target in node.targets:',
    '            if isinstance(target, ast.Name) and target.id in wanted:',
    '                found[target.id] = list(ast.literal_eval(node.value))',
    '                if target.id.startswith("NON_RELEASE"):',
    '                    ranges.append([node.lineno, node.end_lineno])',
    'assert set(found) == wanted, sorted(wanted - set(found))',
    'found["stripLineRanges"] = ranges',
    'print(json.dumps(found))',
  ].join('\n');
  const res = spawnSync('python3', ['-B', '-c', py, join(ROOT, PREQUAL_REL)], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 15000,
  });
  expect(res.status, res.stderr || res.stdout).toBe(0);
  return JSON.parse(res.stdout) as Constants;
}

function tracked(...paths: string[]): string[] {
  const res = spawnSync('git', ['ls-files', '-z', '--', ...paths], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  expect(res.status, res.stderr).toBe(0);
  return res.stdout.split('\0').filter(Boolean).sort();
}

function isPureTest(path: string, suffixes: string[]): boolean {
  const name = basename(path);
  if (suffixes.some((suffix) => name.endsWith(suffix) && name.length > suffix.length)) return true;
  return name.startsWith('test_') && name.endsWith('.py') && name.length > 'test_.py'.length;
}

function isExcluded(path: string, constants: Constants): boolean {
  if (!path.startsWith('server/scripts/')) return false;
  if (constants.NON_RELEASE_SERVER_SCRIPT_EXACT.includes(path)) return true;
  return constants.NON_RELEASE_SERVER_SCRIPT_PREFIXES.some(
    (prefix) => path.startsWith(prefix) && path.length > prefix.length
  );
}

function tokensOf(text: string): Set<string> {
  const out = new Set<string>();
  for (const match of text.matchAll(/[A-Za-z0-9_@./-]+/g)) {
    const token = match[0].replace(/^[./]+/, '').replace(/[.]+$/, '');
    if (token) out.add(token);
  }
  return out;
}

function surfaceText(path: string, constants: Constants): string {
  const text = readFileSync(join(ROOT, path), 'utf8');
  if (path === PREQUAL_REL) {
    // The exclusion constants name the excluded scripts; that is not a use.
    return text
      .split('\n')
      .map((line, index) =>
        constants.stripLineRanges.some(([a, b]) => index + 1 >= a && index + 1 <= b) ? '' : line
      )
      .join('\n');
  }
  if (path === 'server/package.json') {
    const scripts = (JSON.parse(text).scripts ?? {}) as Record<string, string>;
    return QUALIFICATION_NPM_SCRIPTS.map((name) => scripts[name] ?? '').join('\n');
  }
  return text;
}

/** Every repository file the release surfaces reach, with the surface that named it. */
function releaseClosure(constants: Constants): Map<string, string> {
  const serverScripts = tracked('server/scripts');
  const helpers = tracked('scripts', '.github/actions', '.github/scripts');
  const helperSet = new Set(helpers);
  const scriptDirs = new Map<string, string[]>();
  for (const file of serverScripts) {
    const rel = file.slice('server/scripts/'.length);
    if (rel.includes('/')) {
      const dir = rel.split('/')[0];
      scriptDirs.set(dir, [...(scriptDirs.get(dir) ?? []), file]);
    }
  }

  const reached = new Map<string, string>();
  const queue: string[] = [];
  const add = (path: string, via: string) => {
    if (!reached.has(path)) {
      reached.set(path, via);
      queue.push(path);
    }
  };
  for (const root of [
    ...RELEASE_WORKFLOWS,
    'server/Dockerfile',
    'server/package.json',
    ...tracked('server/standby'),
    ...constants.CONTROL_INPUTS.filter((entry) => helperSet.has(entry)),
  ]) {
    add(root, 'release root');
  }

  while (queue.length > 0) {
    const current = queue.pop() as string;
    // A pure test proves a script; it is not a step of the release.
    if (
      current.startsWith('server/scripts/') &&
      isPureTest(current, constants.PURE_TEST_FILE_SUFFIXES)
    ) {
      continue;
    }
    // A data file is read, never run: what it lists is an inventory, not a step.
    if (current !== 'server/package.json' && DATA_FILE.test(current)) continue;
    const tokens = tokensOf(surfaceText(current, constants));
    const names = new Set<string>();
    for (const token of tokens) names.add(token.slice(token.lastIndexOf('/') + 1));
    for (const file of serverScripts) {
      if (names.has(basename(file))) add(file, current);
    }
    // A whole directory named as scripts/<dir>, or as <dir>/... from a sibling script.
    const sibling = dirname(current) === 'server/scripts';
    for (const [dir, files] of scriptDirs) {
      const named = [...tokens].some(
        (token) =>
          token === `scripts/${dir}` ||
          token.includes(`scripts/${dir}/`) ||
          token.endsWith(`scripts/${dir}`) ||
          (sibling && (token === dir || token.startsWith(`${dir}/`)))
      );
      if (named) for (const file of files) add(file, current);
    }
    const sameDir = dirname(current);
    for (const token of tokens) {
      if (helperSet.has(token)) add(token, current);
      const beside = `${sameDir}/${token}`;
      if (!token.includes('/') && helperSet.has(beside)) add(beside, current);
    }
  }
  return reached;
}

describe('the release projection names only release files (O31)', () => {
  const constants = readConstants();
  const closure = releaseClosure(constants);
  const reachedScripts = [...closure.keys()]
    .filter((path) => path.startsWith('server/scripts/'))
    .sort();

  it('(a) hashes every server/scripts file the release surfaces reach', () => {
    expect(constants.CONTROL_INPUTS).toContain('server/scripts');
    expect(constants.CONTROL_INPUTS).toContain('server/src/maintenance');
    for (const workflow of RELEASE_WORKFLOWS) expect(constants.CONTROL_INPUTS).toContain(workflow);
    // The walk is alive: it finds the transaction and what the transaction runs.
    expect(reachedScripts).toContain('server/scripts/engine-release-transaction.sh');
    expect(reachedScripts).toContain('server/scripts/install-engine-supervisor.sh');
    expect(reachedScripts).toContain('server/scripts/engine-release-seal.py');
    expect(reachedScripts.length).toBeGreaterThan(40);

    const outside = reachedScripts
      .filter((path) => !isPureTest(path, constants.PURE_TEST_FILE_SUFFIXES))
      .filter((path) => isExcluded(path, constants))
      .map((path) => `${path} (named by ${closure.get(path)})`);
    expect(
      outside,
      'A script the release route reaches is excluded from projection(). Remove its ' +
        'exclusion in scripts/ci/read-engine-prequalification.py; never edit this list to pass.'
    ).toEqual([]);
  });

  it('(b) a Horse research commit leaves projection() unchanged; a release script commit changes it', () => {
    const repo = mkdtempSync(join(tmpdir(), 'o31-projection-'));
    const git = (...args: string[]) => {
      const res = spawnSync(
        'git',
        [
          '-c',
          'user.name=law',
          '-c',
          'user.email=law@example.invalid',
          '-c',
          'commit.gpgsign=false',
          ...args,
        ],
        { cwd: repo, encoding: 'utf8' }
      );
      expect(res.status, `git ${args.join(' ')}: ${res.stderr}`).toBe(0);
      return res.stdout.trim();
    };
    const write = (path: string, body: string) => {
      mkdirSync(dirname(join(repo, path)), { recursive: true });
      writeFileSync(join(repo, path), body);
    };
    const commit = (message: string) => {
      git('add', '-A');
      git('commit', '-q', '--no-verify', '-m', message);
      return git('rev-parse', 'HEAD');
    };
    try {
      git('init', '-q');
      for (const entry of constants.CONTROL_INPUTS) {
        if (!entry.startsWith('server/')) write(entry, `fixture ${entry}\n`);
      }
      write('server/src/maintenance/maintenanceSchedulePolicy.json', '{}\n');
      write('server/scripts/engine-release-transaction.sh', '#!/usr/bin/env bash\n');
      write('server/scripts/generate-horse-opener-response-vectors.ts', 'export {};\n');
      write('server/scripts/oop-reraise-range/league.ts', 'export {};\n');
      write('server/scripts/brand-new-unknown-script.ts', 'export {};\n');
      const base = commit('base');

      write('server/scripts/generate-horse-opener-response-vectors.ts', 'export const a = 1;\n');
      write('server/scripts/oop-reraise-range/league.ts', 'export const b = 2;\n');
      const horse = commit('horse research only');

      write('server/scripts/brand-new-unknown-script.ts', 'export const c = 3;\n');
      const unknown = commit('a script nobody classified');

      write('server/scripts/engine-release-transaction.sh', '#!/usr/bin/env bash\ntrue\n');
      const release = commit('release transaction');

      const py = [
        'import importlib.util, json, sys',
        'spec = importlib.util.spec_from_file_location("reader", sys.argv[1])',
        'reader = importlib.util.module_from_spec(spec)',
        'spec.loader.exec_module(reader)',
        'print(json.dumps([[reader.projection(sha), reader.projection(sha, release_authority=True)] for sha in sys.argv[2:]]))',
      ].join('\n');
      const res = spawnSync(
        'python3',
        ['-B', '-c', py, join(ROOT, PREQUAL_REL), base, horse, unknown, release],
        { cwd: repo, encoding: 'utf8', timeout: 30000 }
      );
      expect(res.status, res.stderr || res.stdout).toBe(0);
      const [atBase, atHorse, atUnknown, atRelease] = JSON.parse(res.stdout) as string[][];

      expect(atBase[0]).toContain('server/scripts/engine-release-transaction.sh');
      expect(atBase[0]).not.toContain('oop-reraise-range');
      expect(atBase[0]).not.toContain('generate-horse-opener-response-vectors');
      expect(atHorse).toEqual(atBase);
      // Fail closed: a script no rule names is hashed.
      expect(atUnknown[0]).not.toEqual(atHorse[0]);
      expect(atUnknown[1]).not.toEqual(atHorse[1]);
      expect(atRelease[0]).not.toEqual(atUnknown[0]);
      expect(atRelease[1]).not.toEqual(atUnknown[1]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }, 60000);

  it('(c) pins the exclusion rule and the proven release set', () => {
    expect(constants.NON_RELEASE_SERVER_SCRIPT_PREFIXES).toEqual(PINNED_NON_RELEASE_PREFIXES);
    expect(constants.NON_RELEASE_SERVER_SCRIPT_EXACT).toEqual(PINNED_NON_RELEASE_EXACT);

    for (const path of PINNED_RELEASE_SCRIPTS) {
      expect(existsSync(join(ROOT, path)), `pinned release script missing: ${path}`).toBe(true);
      expect(isExcluded(path, constants), `pinned release script excluded: ${path}`).toBe(false);
    }
    const proven = reachedScripts.filter(
      (path) => !isPureTest(path, constants.PURE_TEST_FILE_SUFFIXES)
    );
    console.log('PROVEN' + JSON.stringify(proven));
    expect(proven).toEqual(PINNED_RELEASE_SCRIPTS);

    // What the exclusion removes today, family by family, is Horse research only.
    const excludedNow = tracked('server/scripts').filter((path) => isExcluded(path, constants));
    for (const family of [
      'server/scripts/oop-reraise-range/league.ts',
      'server/scripts/omaha-reraised-pot-priced/probe.mts',
      'server/scripts/feature-ablation-assemble.mjs',
      'server/scripts/gto-v31-evaluate-worker.mjs',
      'server/scripts/assemble-public215-input-draft.py',
      'server/scripts/prepare-public215-feature-request.py',
      'server/scripts/generate-horse-opener-response-vectors.ts',
    ]) {
      expect(excludedNow).toContain(family);
    }
    for (const kept of [
      'server/scripts/legacy-census-scale-fixture.mjs',
      'server/scripts/finite-evaluation-worker.mjs',
      'server/scripts/fix-vitest-esbuild.mjs',
      'server/scripts/install-legacy-sealed-reconciliation-v1.py',
    ]) {
      expect(excludedNow).not.toContain(kept);
    }
  });
});
