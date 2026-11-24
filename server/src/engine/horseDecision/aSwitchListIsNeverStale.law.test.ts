/**
 * LAW (2026-11-20, reconciled with whitelist-as-rows 2026-11-22): A SWITCH LIST IS NEVER STALE.
 *
 * Historically (2026-11-15..2026-11-22), every Horse option switch list migration REPLACED the database's
 * allowed-state lists wholesale. PR #11545 was branched before PR #11538 merged; its regenerated list migration
 * still listed huBbDefendsUnreadToPrice as off-only, and merged after 20261120210905 it would have silently
 * re-held an option the owner's delegate had just lifted.
 *
 * With the row-based whitelist (`OPTION_SWITCH_WHITELIST_MIGRATION`), full-list migrations are frozen at
 * `OPTION_SWITCH_LAST_LIST_MIGRATION` (47 files) and new lanes ship commuting `--register` migrations
 * (`SELECT public.fn_ca_horse_option_register(...)`) that add no full-list migration.
 *
 * The three guards (HorseOptionSwitchMigrationLists.ts) stay active together:
 *   1. THE FROZEN HISTORICAL CHAIN: the 47 full-list migrations from the base through OPTION_SWITCH_CHAIN_ANCHOR
 *      through OPTION_SWITCH_LAST_LIST_MIGRATION form one unbroken chain (pre-chain versions pinned; every
 *      post-anchor list names its immediate predecessor on `-- registry:follows:` and stamps its version into
 *      fn_ca_horse_option_switch_states). Commuting `--register` migrations carry no list marker and pass cleanly.
 *   2. MAIN: on a pull request, a branch adding commuting `--register` migrations adds no full-list migration and
 *      passes; once `origin/main` holds `OPTION_SWITCH_WHITELIST_MIGRATION`, ANY added full-list migration is
 *      refused (before that, an added full-list migration older than or lacking `origin/main`'s newest is refused).
 *   3. THE DATABASE: every post-anchor full-list migration AND the whitelist migration's own
 *      `fn_ca_horse_option_switch_states` stamp their version into the states function, so an older stamped
 *      full-list migration refuses at install time to overwrite a newer list or the row-based whitelist.
 * Every failure names the remedy: bring main in, delete your list migration, and register only your own options
 * with `--register`.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  OPTION_SWITCH_CHAIN_ANCHOR,
  OPTION_SWITCH_LAST_LIST_MIGRATION,
  OPTION_SWITCH_LIST_MARKER,
  OPTION_SWITCH_MIGRATIONS_DIR,
  OPTION_SWITCH_VERSION_STAMP,
  OPTION_SWITCH_WHITELIST_MIGRATION,
  optionSwitchChainProblem,
  optionSwitchFollowsLines,
  optionSwitchRegisterSql,
  optionSwitchStaleAgainstMain,
  optionSwitchVersionStamp,
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
const newestList = () => listNames(onDisk()).sort().at(-1)!;
const REMEDY = [
  /bring main into your branch/,
  /delete your list migration/,
  /gen-horse-option-switch-sql\.ts --register/,
];

/** Synthetic post-anchor full-list migration text for testing chain-break detection without a --follow-up generator. */
function syntheticFullListSql(name: string, follows: string): string {
  const version = /^(\d{14})_/.exec(name)![1]!;
  const prev = follows.replace(/^.*\//, '').replace(/\.sql$/, '');
  return (
    `-- HORSE OPTION SWITCH: SYNTHETIC FIXTURE (${name})\n` +
    `-- registry:follows: ${prev}\n` +
    `BEGIN;\n` +
    `DO $existing_rows_fit$ BEGIN\n` +
    `  IF substring((SELECT p.prosrc FROM pg_proc p WHERE p.oid = 'public.fn_ca_horse_option_switch_states(text)'::regprocedure)\n` +
    `       FROM '${OPTION_SWITCH_VERSION_STAMP}([0-9]{14})') > '${version}' THEN\n` +
    `    RAISE EXCEPTION 'switch list migration ${version} is older than the installed list %', '';\n` +
    `  END IF;\n` +
    `END $existing_rows_fit$;\n` +
    `-- registry:plain-options:begin\n` +
    `'v7'\n` +
    `-- registry:plain-options:end\n` +
    `CREATE OR REPLACE FUNCTION public.fn_ca_horse_option_switch_states(p_option text)\n` +
    `RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $function$\n` +
    `  -- ${OPTION_SWITCH_VERSION_STAMP}${version}\n` +
    `  SELECT ARRAY['off', 'on'];\n` +
    `$function$;\n` +
    `COMMIT;\n`
  );
}

/** The list migrations origin/main holds, or null when this checkout cannot tell (no origin/main ref). */
function mainListMigrations(): { lists: string[]; hasWhitelist: boolean } | null {
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
    const lists = out
      .split('\n')
      .filter((l) => l.endsWith('.sql'))
      .map((l) => l.replace(/^.*\//, ''));
    const wl = execFileSync(
      'git',
      [
        '-C',
        REPO,
        'ls-tree',
        '--name-only',
        'origin/main',
        '--',
        `${OPTION_SWITCH_MIGRATIONS_DIR}/${OPTION_SWITCH_WHITELIST_MIGRATION}`,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    return { lists, hasWhitelist: wl.trim() !== '' };
  } catch (error) {
    // git grep exits 1 when nothing matches: main always holds the base list migration, so that is not an answer
    throw new Error(`could not read origin/main's switch list migrations: ${String(error)}`);
  }
}

describe('a switch list is never stale', () => {
  it('the frozen historical full-list migrations of this tree form one unbroken chain after the anchor', () => {
    expect(newestList()).toBe(OPTION_SWITCH_LAST_LIST_MIGRATION);
    expect(optionSwitchChainProblem(onDisk())).toBeNull();
  });

  it('commuting row-based --register migrations pass the chain check in any combination without re-asserting a full list', () => {
    const files = onDisk();
    const laneA = '20991231000001_horse_option_register_lane_a';
    const laneB = '20991231000002_horse_option_register_lane_b';
    const regA = {
      name: `${laneA}.sql`,
      text: optionSwitchRegisterSql(laneA, [
        {
          fn: 'register',
          option: 'laneAOption',
          kind: 'plain',
          offOnly: false,
          shadow: 'none',
          migration: laneA,
        },
      ]),
    };
    const regB = {
      name: `${laneB}.sql`,
      text: optionSwitchRegisterSql(laneB, [
        {
          fn: 'register',
          option: 'laneBOption',
          kind: 'plain',
          offOnly: true,
          shadow: 'none',
          migration: laneB,
        },
      ]),
    };
    expect(optionSwitchChainProblem([...files, regA])).toBeNull();
    expect(optionSwitchChainProblem([...files, regA, regB])).toBeNull();
    expect(optionSwitchChainProblem([...files, regB, regA])).toBeNull();
    // neither register migration carries the full-list marker
    expect(listNames([...files, regA, regB])).toEqual(listNames(files));
  });

  it('two full-list lanes generated from the same list migration break the chain in any tree holding both, whichever is newer', () => {
    const files = onDisk();
    const NEWEST = newestList();
    const lifted = { name: '29991231000001_horse_option_switch_lane_a.sql' };
    const stale = { name: '29991231000002_horse_option_switch_lane_b.sql' };
    const a = { ...lifted, text: syntheticFullListSql(lifted.name.slice(0, -4), NEWEST) };
    const b = { ...stale, text: syntheticFullListSql(stale.name.slice(0, -4), NEWEST) };
    expect(optionSwitchChainProblem([...files, a])).toBeNull();
    expect(optionSwitchChainProblem([...files, b])).toBeNull();
    // the stale lane sorts after the merged one: it follows NEWEST, not lane a
    const after = optionSwitchChainProblem([...files, a, b])!;
    expect(after).toContain(`${OPTION_SWITCH_MIGRATIONS_DIR}/${stale.name}`);
    expect(after).toContain(`was generated after ${NEWEST}`);
    expect(after).toContain(lifted.name);
    for (const step of REMEDY) expect(after).toMatch(step);
    // the stale lane sorts BEFORE the merged one (the #11545 shape with an older version)
    const older = { name: '29991230000000_horse_option_switch_lane_b.sql' };
    const o = { ...older, text: syntheticFullListSql(older.name.slice(0, -4), NEWEST) };
    const before = optionSwitchChainProblem([...files, a, o])!;
    expect(before).toContain(`${OPTION_SWITCH_MIGRATIONS_DIR}/${lifted.name}`);
    expect(before).toContain(older.name);
    for (const step of REMEDY) expect(before).toMatch(step);
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
    const sql = syntheticFullListSql(name, newestList());
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

  it('the frozen post-anchor list migration and the whitelist migration both carry their version stamp in fn_ca_horse_option_switch_states', () => {
    const lastSql = readFileSync(join(DIR, OPTION_SWITCH_LAST_LIST_MIGRATION), 'utf8');
    const lastVersion = /^(\d{14})_/.exec(OPTION_SWITCH_LAST_LIST_MIGRATION)![1]!;
    expect(optionSwitchFollowsLines(lastSql)).toHaveLength(1);
    expect(optionSwitchVersionStamp(lastSql)).toBe(lastVersion);
    const refusal = lastSql.slice(
      lastSql.indexOf('$existing_rows_fit$'),
      lastSql.indexOf('ALTER TABLE')
    );
    expect(refusal).toContain(
      `FROM '${OPTION_SWITCH_VERSION_STAMP}([0-9]{14})') > '${lastVersion}' THEN`
    );
    expect(lastSql.indexOf('is older than the installed list')).toBeLessThan(
      lastSql.indexOf('ALTER TABLE')
    );
    // the whitelist migration stamps its own newer version into fn_ca_horse_option_switch_states so any stamped
    // historical full-list migration refuses at install time to overwrite the row-based whitelist
    const wlSql = readFileSync(join(DIR, OPTION_SWITCH_WHITELIST_MIGRATION), 'utf8');
    const wlVersion = /^(\d{14})_/.exec(OPTION_SWITCH_WHITELIST_MIGRATION)![1]!;
    expect(wlVersion > lastVersion).toBe(true);
    expect(optionSwitchVersionStamp(wlSql)).toBe(wlVersion);
  });

  it('a branch adding a stale or post-whitelist full-list migration is refused against main, while commuting --register branches pass', () => {
    const main = ['20261120181452_x.sql', ANCHOR];
    // a branch that adds no full-list migration (including commuting --register branches) is never refused
    expect(optionSwitchStaleAgainstMain(['20261120181452_x.sql'], main, false)).toBeNull();
    expect(optionSwitchStaleAgainstMain(main, main, true)).toBeNull();
    // before the whitelist migration lands on main, a newer list holding main newest passes
    expect(
      optionSwitchStaleAgainstMain([...main, '20261121000000_mine.sql'], main, false)
    ).toBeNull();
    // once the whitelist migration is on main, ANY added full-list migration is refused
    const postWhitelist = optionSwitchStaleAgainstMain(
      [...main, '20991231000000_mine.sql'],
      main,
      true
    )!;
    expect(postWhitelist).toContain(OPTION_SWITCH_WHITELIST_MIGRATION);
    for (const step of REMEDY) expect(postWhitelist).toMatch(step);
    // pre-whitelist: the branch lacks main's newest list and adds its own
    const behind = optionSwitchStaleAgainstMain(
      ['20261120181452_x.sql', '20261121000000_mine.sql'],
      main,
      false
    )!;
    expect(behind).toContain(`main holds the switch list migration ${ANCHOR}`);
    for (const step of REMEDY) expect(behind).toMatch(step);
    // pre-whitelist: the branch holds main's newest list but its own is older
    const older = optionSwitchStaleAgainstMain([...main, '20261120190000_mine.sql'], main, false)!;
    expect(older).toContain('is not newer than main');
    for (const step of REMEDY) expect(older).toMatch(step);
  });

  it('this branch adds no stale or post-whitelist full-list migration against origin/main', () => {
    const main = mainListMigrations();
    const event = process.env.GITHUB_EVENT_NAME ?? '';
    if (main === null) {
      if (event === 'pull_request' || event === 'merge_group')
        throw new Error(
          'UNKNOWN: origin/main is not in this checkout, so a stale switch list migration cannot be ruled out'
        );
      console.warn(
        'aSwitchListIsNeverStale: no origin/main ref here; the check against main was not run'
      );
      return;
    }
    expect(main.lists.length).toBeGreaterThan(0);
    expect(
      optionSwitchStaleAgainstMain(listNames(onDisk()), main.lists, main.hasWhitelist)
    ).toBeNull();
  });
});
