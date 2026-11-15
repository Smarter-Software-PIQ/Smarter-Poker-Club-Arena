import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { gitFixtureEnvironment } from '../helpers/gitFixtureEnvironment';

// Each case builds a real bare repository and runs the real proof against it.
vi.setConfig({ testTimeout: 60_000 });

/*
 * THE PROOF MUST NOT LEAVE A BACKGROUND WRITER IN THE REPOSITORY ITS TRAP
 * REMOVES (2026-11-15).
 *
 * scripts/ci/selected-revision-is-on-main.sh fetches protected main into a
 * throwaway repository and removes it in an EXIT trap. A fetch then runs
 * `git maintenance run --auto`, and since Git 2.47 that DETACHES by default
 * (maintenance.autoDetach): on the runner's git 2.56.1 the fetch returned while
 * a background `git commit-graph write --split --reachable` still held
 * objects/maintenance.lock (20 of 20 local runs), so the trap's `rm -rf` raced
 * it and failed with "Directory not empty" after the ancestry proof had already
 * passed. That made "Confirm The Hetzner Web Publish Reached Production" red
 * and PostDeployVerificationIncomplete fire as "nothing verified" (post-deploy
 * runs 43555229653, 43667942070, 43678854398).
 *
 * The race itself is timing-dependent, so the pin is on its cause: the proof's
 * own git commands must never start automatic maintenance, even when inherited
 * configuration turns it on, and the throwaway repository must be gone when the
 * script exits, on success and on refusal alike.
 */
const script = resolve('scripts/ci/selected-revision-is-on-main.sh');

let fixture: string;
let bare: string;
let scratch: string;
let trace: string;
let mainSha: string;
let offMainSha: string;

const git = (cwd: string, ...args: string[]) => {
  const result = spawnSync(
    'git',
    [
      '-c',
      'user.name=Proof Fixture',
      '-c',
      'user.email=proof@example.invalid',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd, env: gitFixtureEnvironment(), encoding: 'utf8' }
  );
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
};

const prove = (shas: string[], inherited: NodeJS.ProcessEnv = {}) =>
  spawnSync('bash', [script, ...shas], {
    env: {
      ...gitFixtureEnvironment(),
      GITHUB_SERVER_URL: pathToFileURL(join(fixture, 'srv')).href,
      GITHUB_REPOSITORY: 'owner/repo.git',
      GH_TOKEN: 'fixture-token',
      TMPDIR: scratch,
      GIT_TRACE2_EVENT: trace,
      ...inherited,
    },
    encoding: 'utf8',
  });

/** Every git child the proof started, by argv, read from its own trace. */
const spawned = () =>
  readFileSync(trace, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { event: string; argv?: string[] })
    .filter((event) => event.event === 'start' && Array.isArray(event.argv))
    .map((event) => (event.argv as string[]).join(' '));

const startedMaintenance = (argv: string) =>
  /(^|\s|\/)git(\s+-\S+(\s+\S+)?)*\s+(maintenance\s+run|gc)(\s|$)/.test(argv);

beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), 'selected-revision-'));
  bare = join(fixture, 'srv', 'owner', 'repo.git');
  scratch = join(fixture, 'scratch');
  trace = join(fixture, 'trace.json');
  mkdirSync(scratch);
  mkdirSync(join(fixture, 'srv', 'owner'), { recursive: true });
  git(fixture, 'init', '-q', '--bare', '-b', 'main', bare);
  git(bare, 'config', 'uploadpack.allowFilter', 'true');
  git(bare, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
  const seed = join(fixture, 'seed');
  git(fixture, 'init', '-q', '-b', 'main', seed);
  for (let i = 0; i < 5; i++) git(seed, 'commit', '-q', '--allow-empty', '-m', `main ${i}`);
  mainSha = git(seed, 'rev-parse', 'HEAD');
  git(seed, 'push', '-q', bare, 'main');
  git(seed, 'checkout', '-q', '-b', 'side');
  git(seed, 'commit', '-q', '--allow-empty', '-m', 'never merged');
  offMainSha = git(seed, 'rev-parse', 'HEAD');
  git(seed, 'push', '-q', bare, 'side');
});

afterEach(() => {
  rmSync(fixture, { recursive: true, force: true });
});

describe('the selected-revision proof leaves no background writer behind', () => {
  it('the trace matcher recognises an automatic maintenance child', () => {
    // Guards the matcher itself, so a passing case below cannot be vacuous.
    expect(startedMaintenance('git maintenance run --auto --quiet --detach')).toBe(true);
    expect(startedMaintenance('/usr/lib/git-core/git maintenance run --auto --quiet')).toBe(true);
    expect(startedMaintenance('git gc --auto --quiet')).toBe(true);
    expect(startedMaintenance('git -C /tmp/x config maintenance.auto false')).toBe(false);
    expect(startedMaintenance('git -C /tmp/x merge-base --is-ancestor a b')).toBe(false);
  });

  it('proves a revision on main, starts no maintenance, and removes its repository', () => {
    const result = prove([mainSha]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`Selected revision ${mainSha} is on protected main.`);
    const children = spawned();
    expect(
      children.some((argv) => / fetch /.test(argv)),
      children.join('\n')
    ).toBe(true);
    expect(children.filter(startedMaintenance), children.join('\n')).toEqual([]);
    expect(readdirSync(scratch)).toEqual([]);
  });

  it('stays free of maintenance when inherited configuration turns it on', () => {
    const result = prove([mainSha], {
      GIT_CONFIG_COUNT: '3',
      GIT_CONFIG_KEY_0: 'maintenance.auto',
      GIT_CONFIG_VALUE_0: 'true',
      GIT_CONFIG_KEY_1: 'maintenance.autoDetach',
      GIT_CONFIG_VALUE_1: 'true',
      GIT_CONFIG_KEY_2: 'gc.auto',
      GIT_CONFIG_VALUE_2: '1',
    });
    expect(result.status, result.stderr).toBe(0);
    const children = spawned();
    expect(children.filter(startedMaintenance), children.join('\n')).toEqual([]);
    expect(readdirSync(scratch)).toEqual([]);
  });

  it('still refuses a revision that is not on protected main, and still cleans up', () => {
    const result = prove([mainSha, offMainSha]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      `::error::Selected revision ${offMainSha} is not on protected main; nothing from it runs.`
    );
    expect(spawned().filter(startedMaintenance)).toEqual([]);
    expect(readdirSync(scratch)).toEqual([]);
    expect(existsSync(bare)).toBe(true);
  });
});
