/**
 * LAW (2026-11-20): A SWITCH LIST IS NEVER STALE.
 *
 * Every Horse option switch list migration (server/scripts/gen-horse-option-switch-sql.ts --follow-up) REPLACES the
 * database's allowed-state lists wholesale. PR #11545 was branched before PR #11538 merged; its regenerated list
 * migration still listed huBbDefendsUnreadToPrice as off-only, and merged after 20261120210905 it would have
 * silently re-held an option the owner's delegate had just lifted. Its CI was green because the branch was
 * internally consistent: pull request CI checks out the PR HEAD (ci.yml, `ref: head.sha`), the ruleset's required
 * checks are not strict, and no merge queue is required, so nothing ever ran the branch against the newer main.
 *
 * Three guards (HorseOptionSwitchMigrationLists.ts):
 *   1. THE CHAIN: every list migration after the anchor names the list migration it was generated after, and that
 *      must be the one immediately before it by version. Any tree holding both a lane's file and a list it never
 *      saw (the merge-group tree, main after a merge, every later branch) fails here, whichever version is larger.
 *   2. MAIN: on a pull request, a list migration the branch adds must be newer than every list migration on
 *      origin/main, and the branch must hold main's newest one. CI reads origin/main from the full-history checkout
 *      of the server shards; locally it reads whatever origin/main the clone last fetched.
 *   3. THE DATABASE: each follow-up stamps its version into fn_ca_horse_option_switch_states and refuses to install
 *      over a newer stamp, so the applier (one run per file, no ordering between runs) can never put an older list
 *      back over a newer one.
 * Every failure names the remedy: bring main in, delete your list migration, regenerate it with --follow-up.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  OPTION_SWITCH_CHAIN_ANCHOR,
  OPTION_SWITCH_LIST_MARKER,
  OPTION_SWITCH_MIGRATIONS_DIR,
  OPTION_SWITCH_VERSION_STAMP,
  optionSwitchChainProblem,
  optionSwitchFollowsLines,
  optionSwitchFollowUpSql,
  optionSwitchStaleAgainstMain,
  optionSwitchVersionStamp,
  withFollowsLine,
} from '../HorseOptionSwitchMigrationLists.js';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const DIR = join(REPO, OPTION_SWITCH_MIGRATIONS_DIR);
const onDisk = () =>
  readdirSync(DIR)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => ({ name, text: readFileSync(join(DIR, name), 'utf8') }));
const listNames = (files: readonly { name: string; text: string }[]) =>
  files.filter((f) => f.text.includes(OPTION_SWITCH_LIST_MARKER)).map((f) => f.name);
const ANCHOR = `${OPTION_SWITCH_CHAIN_ANCHOR}.sql`;
/** The newest list migration in this tree: a new lane's follow-up is generated after it, never after the anchor once
 * a later list has merged (a fixture following the anchor would itself be stale on every tree after the first one). */
const newestList = () => listNames(onDisk()).sort().at(-1)!;
const REMEDY = [
  /bring main into your branch/,
  /delete your list migration/,
  /gen-horse-option-switch-sql\.ts --follow-up/,
];

/** The list migrations origin/main holds, or null when this checkout cannot tell (no origin/main ref). */
function mainListMigrations(): string[] | null {
  try {
    execFileSync('git', ['-C', REPO, 'rev-parse', '--verify', '--quiet', 'origin/main^{commit}'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
  try {
    const out = execFileSync(
      'git',
      [
        '-C',
        REPO,
        'grep',
        '-l',
        '-F',
        '-e',
        OPTION_SWITCH_LIST_MARKER,
        'origin/main',
        '--',
        `${OPTION_SWITCH_MIGRATIONS_DIR}/`,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 }
    );
    return out
      .split('\n')
      .filter((l) => l.endsWith('.sql'))
      .map((l) => l.replace(/^.*\//, ''));
  } catch (error) {
    // git grep exits 1 when nothing matches: main always holds the base list migration, so that is not an answer
    throw new Error(`could not read origin/main's switch list migrations: ${String(error)}`);
  }
}

describe('a switch list is never stale', () => {
  it('the list migrations of this tree form one unbroken chain after the anchor', () => {
    expect(optionSwitchChainProblem(onDisk())).toBeNull();
  });

  it('two lanes generated from the same list migration break the chain in any tree holding both, whichever is newer', () => {
    const files = onDisk();
    const NEWEST = newestList();
    const lifted = { name: '29991231000001_horse_option_switch_lane_a.sql' };
    const stale = { name: '29991231000002_horse_option_switch_lane_b.sql' };
    const a = { ...lifted, text: optionSwitchFollowUpSql(lifted.name.slice(0, -4), NEWEST) };
    const b = { ...stale, text: optionSwitchFollowUpSql(stale.name.slice(0, -4), NEWEST) };
    // each lane alone is whole
    expect(optionSwitchChainProblem([...files, a])).toBeNull();
    expect(optionSwitchChainProblem([...files, b])).toBeNull();
    // the stale lane sorts after the merged one: it follows the anchor, not lane a
    const after = optionSwitchChainProblem([...files, a, b])!;
    expect(after).toContain(`${OPTION_SWITCH_MIGRATIONS_DIR}/${stale.name}`);
    expect(after).toContain(`was generated after ${NEWEST}`);
    expect(after).toContain(lifted.name);
    for (const step of REMEDY) expect(after).toMatch(step);
    // the stale lane sorts BEFORE the merged one (the #11545 shape with an older version): lane a no longer follows
    // the file before it, so the tree is refused too
    const older = { name: '29991230000000_horse_option_switch_lane_b.sql' };
    const o = { ...older, text: optionSwitchFollowUpSql(older.name.slice(0, -4), NEWEST) };
    const before = optionSwitchChainProblem([...files, a, o])!;
    expect(before).toContain(`${OPTION_SWITCH_MIGRATIONS_DIR}/${lifted.name}`);
    expect(before).toContain(older.name);
    for (const step of REMEDY) expect(before).toMatch(step);
    // regenerated after bringing main in, lane b follows lane a and the tree is whole again
    const fixed = { ...stale, text: optionSwitchFollowUpSql(stale.name.slice(0, -4), lifted.name) };
    expect(optionSwitchChainProblem([...files, a, fixed])).toBeNull();
    // the in-place rewrite of an unmerged follow-up sets its follows line the same way
    expect(
      optionSwitchChainProblem([
        ...files,
        a,
        { ...stale, text: withFollowsLine(b.text, lifted.name) },
      ])
    ).toBeNull();
  });

  it('a list migration added below the anchor with a hand-picked old version breaks the chain', () => {
    const files = onDisk();
    const old = files.find((f) => f.name.startsWith('20261120181452_'))!;
    const problem = optionSwitchChainProblem([
      ...files,
      { name: '20261120200000_horse_option_switch_stale_lane.sql', text: old.text },
    ])!;
    expect(problem).toContain(
      '20261120200000_horse_option_switch_stale_lane.sql sorts before the chain anchor'
    );
    for (const step of REMEDY) expect(problem).toMatch(step);
  });

  it('a list migration after the anchor without a follows line, or without its version stamp, is refused', () => {
    const files = onDisk();
    const name = '29991231000001_horse_option_switch_lane_a';
    const sql = optionSwitchFollowUpSql(name, newestList());
    const unchained = optionSwitchChainProblem([
      ...files,
      { name: `${name}.sql`, text: sql.replace(/^-- registry:follows: .*\n/m, '') },
    ])!;
    expect(unchained).toMatch(/names no list migration it follows/);
    const unstamped = optionSwitchChainProblem([
      ...files,
      { name: `${name}.sql`, text: sql.replace(/-- registry-lists-version: \d{14}/, '') },
    ])!;
    expect(unstamped).toMatch(/does not stamp its own version/);
  });

  it('a generated follow-up names its predecessor once, stamps its own version and refuses to install over a newer list', () => {
    const name = '20261121000000_horse_option_switch_test';
    const sql = optionSwitchFollowUpSql(name, `${OPTION_SWITCH_MIGRATIONS_DIR}/${ANCHOR}`);
    expect(optionSwitchFollowsLines(sql)).toEqual([OPTION_SWITCH_CHAIN_ANCHOR]);
    expect(optionSwitchVersionStamp(sql)).toBe('20261121000000');
    const refusal = sql.slice(sql.indexOf('$existing_rows_fit$'), sql.indexOf('ALTER TABLE'));
    expect(refusal).toContain(
      `FROM '${OPTION_SWITCH_VERSION_STAMP}([0-9]{14})') > '20261121000000' THEN`
    );
    expect(refusal).toMatch(
      /RAISE EXCEPTION 'switch list migration 20261121000000 is older than the installed list %/
    );
    // the refusal comes before every ALTER: an older list changes nothing
    expect(sql.indexOf('is older than the installed list')).toBeLessThan(
      sql.indexOf('ALTER TABLE')
    );
  });

  it('a branch that adds a list migration older than main newest, or without main newest, is refused against main', () => {
    const main = ['20261120181452_x.sql', ANCHOR];
    // a branch that adds nothing is never refused, however far behind main it is
    expect(optionSwitchStaleAgainstMain(['20261120181452_x.sql'], main)).toBeNull();
    // the branch holds main's newest list and adds a newer one: fine
    expect(optionSwitchStaleAgainstMain([...main, '20261121000000_mine.sql'], main)).toBeNull();
    // the branch lacks main's newest list (branched before it merged) and adds its own
    const behind = optionSwitchStaleAgainstMain(
      ['20261120181452_x.sql', '20261121000000_mine.sql'],
      main
    )!;
    expect(behind).toContain(`main holds the switch list migration ${ANCHOR}`);
    for (const step of REMEDY) expect(behind).toMatch(step);
    // the branch holds main's newest list but its own is older (a hand-picked or reused version)
    const older = optionSwitchStaleAgainstMain([...main, '20261120190000_mine.sql'], main)!;
    expect(older).toContain('is not newer than main');
    for (const step of REMEDY) expect(older).toMatch(step);
  });

  it('this branch adds no switch list migration older than, or without, origin/main newest', () => {
    const main = mainListMigrations();
    const event = process.env.GITHUB_EVENT_NAME ?? '';
    if (main === null) {
      // a pull request must be checked against main: the server shards check out full history, so origin/main is
      // there. Anywhere else (a shallow release checkout, a clone with no remote) this is "could not tell", said out
      // loud, and the chain test above still guards every tree that holds both files.
      if (event === 'pull_request' || event === 'merge_group')
        throw new Error(
          'UNKNOWN: origin/main is not in this checkout, so a stale switch list migration cannot be ruled out'
        );
      console.warn(
        'aSwitchListIsNeverStale: no origin/main ref here; the check against main was not run'
      );
      return;
    }
    expect(main.length).toBeGreaterThan(0);
    expect(optionSwitchStaleAgainstMain(listNames(onDisk()), main)).toBeNull();
  });
});
