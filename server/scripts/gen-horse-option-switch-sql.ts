/**
 * Writes the database name lists of the Horse option switch from the engine registry (HorseOptionSwitch.ts, which is
 * derived from HORSE_DATA_LEDGER). Every list sits between a pair of marker comments:
 *   -- registry:style-options:begin / -- registry:style-options:end   the seven style options
 *   -- registry:plain-options:begin / -- registry:plain-options:end   every other registered option
 *   -- registry:off-only-options:begin / -- registry:off-only-options:end   those of them that are off-only
 *
 * The database whitelist is the NEWEST migration that carries those markers (HorseOptionSwitchMigrationLists.ts).
 * Migration 20261114072215 wrote the first lists and is installed, so it is never rewritten: a change to the
 * registry (an option added to or removed from the ledger, or moved to off-only) ships as a NEW follow-up migration.
 *
 * Run from server/:
 *   npx tsx scripts/gen-horse-option-switch-sql.ts --follow-up <YYYYMMDDHHMMSS>_horse_option_switch_<what>
 *       write supabase/migrations/<that name>.sql re-asserting the lists, and set the lists of the PostgreSQL proof
 *       script (scripts/ci/test-horse-option-switch-evidence-postgres.sh); refuses an existing file, a version that
 *       is not later than the newest list migration, and a registry that already equals the newest lists
 *   npx tsx scripts/gen-horse-option-switch-sql.ts --check
 *       exit 1 when the newest list migration or the proof script lists differ from the registry; writes nothing
 *   npx tsx scripts/gen-horse-option-switch-sql.ts
 *       rewrite the newest list migration in place, ONLY when it is your own follow-up that main does not hold yet
 *       (after merging main), setting its follows line to the list migration now before it; refused for
 *       20261114072215, for any other file and for any file on origin/main
 *
 * everyUpgradeHasALiveSwitch.law.test.ts fails when the newest list migration differs from the registry and names
 * the --follow-up command. aSwitchListIsNeverStale.law.test.ts fails when a list migration does not follow the one
 * before it, or a branch adds a list migration older than main's newest one.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OPTION_SWITCH_OFF_ONLY_NAMES,
  OPTION_SWITCH_PLAIN_NAMES,
} from '../src/engine/HorseOptionSwitch.js';
import {
  OPTION_SWITCH_BASE_MIGRATION,
  OPTION_SWITCH_CHAIN_ANCHOR,
  OPTION_SWITCH_LIST_MARKER,
  OPTION_SWITCH_MIGRATIONS_DIR,
  OPTION_SWITCH_PROOF_SCRIPT,
  newestOptionSwitchListMigration,
  optionSwitchFollowUpRefusal,
  optionSwitchFollowUpSql,
  optionSwitchListDrift,
  optionSwitchRewriteRefusal,
  proofScriptWithRegistryLists,
  sqlNameList,
  withFollowsLine,
  withRegistryLists,
} from '../src/engine/HorseOptionSwitchMigrationLists.js';
import { STYLE_SWITCH_OPTIONS } from '../src/engine/HorseStyleSwitch.js';

/** Kept for readers of the former export: the first list migration. */
export const OPTION_SWITCH_MIGRATION = OPTION_SWITCH_BASE_MIGRATION;
export { sqlNameList, withRegistryLists };

const REPO = fileURLToPath(new URL('../../', import.meta.url));

/** The newest list migration of this checkout, repository-relative. */
export function newestListMigrationOnDisk(repo: string = REPO): string {
  const dir = join(repo, OPTION_SWITCH_MIGRATIONS_DIR);
  return newestOptionSwitchListMigration(
    readdirSync(dir)
      .filter((name) => name.endsWith('.sql'))
      .map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }))
  );
}

/** The list migration immediately before `path` by version, repository-relative, or null. */
function previousListMigrationOnDisk(path: string, repo: string = REPO): string | null {
  const dir = join(repo, OPTION_SWITCH_MIGRATIONS_DIR);
  const target = path.replace(/^.*\//, '');
  const earlier = readdirSync(dir)
    .filter((name) => name.endsWith('.sql') && name < target)
    .filter((name) => readFileSync(join(dir, name), 'utf8').includes(OPTION_SWITCH_LIST_MARKER))
    .sort();
  const previous = earlier[earlier.length - 1];
  return previous ? `${OPTION_SWITCH_MIGRATIONS_DIR}/${previous}` : null;
}

/** True when origin/main holds `path`. Fails closed: if git cannot answer, the file is treated as on main. */
function onMain(path: string): boolean {
  try {
    const out = execFileSync(
      'git',
      ['-C', REPO, 'ls-tree', '--name-only', 'origin/main', '--', path],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }
    );
    return out.trim() !== '';
  } catch {
    return true;
  }
}

function counts(): string {
  return `(${STYLE_SWITCH_OPTIONS.length} style, ${OPTION_SWITCH_PLAIN_NAMES.length} other options, ${OPTION_SWITCH_OFF_ONLY_NAMES.length} of them off-only)`;
}

function writeProofScriptLists(): boolean {
  const path = join(REPO, OPTION_SWITCH_PROOF_SCRIPT);
  const before = readFileSync(path, 'utf8');
  const after = proofScriptWithRegistryLists(before);
  if (after !== before) writeFileSync(path, after);
  return after !== before;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const newest = newestListMigrationOnDisk();
  const newestSql = readFileSync(join(REPO, newest), 'utf8');
  if (args.includes('--check')) {
    const drift = optionSwitchListDrift(newest, newestSql);
    if (drift) fail(drift);
    const script = readFileSync(join(REPO, OPTION_SWITCH_PROOF_SCRIPT), 'utf8');
    if (proofScriptWithRegistryLists(script) !== script)
      fail(
        `the option lists of ${OPTION_SWITCH_PROOF_SCRIPT} differ from the registry: run the --follow-up command, or this script without arguments for your own unmerged follow-up`
      );
    console.log(
      `the option switch lists of ${newest} and the proof script equal the registry ${counts()}`
    );
  } else if (args[0] === '--follow-up') {
    const name = args[1] ?? '';
    const refusal = optionSwitchFollowUpRefusal(name, newest);
    if (refusal) fail(refusal);
    const target = `${OPTION_SWITCH_MIGRATIONS_DIR}/${name}.sql`;
    if (existsSync(join(REPO, target))) fail(`${target} exists already`);
    if (!optionSwitchListDrift(newest, newestSql))
      fail(`the lists of ${newest} already equal the registry ${counts()}: no follow-up is needed`);
    // the follows line names the list migration this one was generated after (aSwitchListIsNeverStale.law.test.ts)
    writeFileSync(join(REPO, target), optionSwitchFollowUpSql(name, newest));
    const script = writeProofScriptLists();
    console.log(
      `wrote ${target} ${counts()}${script ? `; updated the lists of ${OPTION_SWITCH_PROOF_SCRIPT}` : ''}`
    );
  } else if (args.length === 0) {
    const refusal = optionSwitchRewriteRefusal(newest, newest, onMain(newest));
    if (refusal) fail(refusal);
    // your own unmerged follow-up, regenerated after merging main: it now follows main's newest list migration
    const previous = previousListMigrationOnDisk(newest);
    const relisted = withRegistryLists(newestSql);
    const after =
      previous && newest.replace(/^.*\//, '') > `${OPTION_SWITCH_CHAIN_ANCHOR}.sql`
        ? withFollowsLine(relisted, previous)
        : relisted;
    if (after !== newestSql) writeFileSync(join(REPO, newest), after);
    const script = writeProofScriptLists();
    console.log(
      after === newestSql && !script
        ? 'unchanged'
        : `rewrote ${newest}${script ? ' and the proof script lists' : ''}`,
      counts()
    );
  } else {
    fail(
      'usage: gen-horse-option-switch-sql.ts [--check | --follow-up <YYYYMMDDHHMMSS>_<snake_name>]'
    );
  }
}
