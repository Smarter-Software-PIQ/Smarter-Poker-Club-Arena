/**
 * REFUSE A STALE SWITCH LIST AT MERGE TIME, NOT ONLY IN THE PULL REQUEST'S OWN CI (2026-11-21, #11668; reconciled
 * with whitelist-as-rows 2026-11-22).
 *
 * `aSwitchListIsNeverStale.law.test.ts` checks the branch against `origin/main` inside pull-request CI, which runs
 * against the `origin/main` of the moment that job ran. The ruleset's required checks are not strict and no merge
 * queue is required, so a branch that went green before another list migration (or the whitelist-as-rows migration)
 * merged stays green while its list migration is now stale or retired.
 *
 * `switchListStaleAtMerge` applies the same `optionSwitchStaleAgainstMain` rule to the head and the `origin/main` of
 * the moment of the merge:
 * - commuting `--register` branches add NO full-list migration and always pass;
 * - once `origin/main` holds `OPTION_SWITCH_WHITELIST_MIGRATION`, ANY newly added full-list migration is refused
 *   (it would overwrite the whitelist rows with literal lists);
 * - before that, any added full-list migration older than or lacking `origin/main`'s newest list is refused.
 *
 * `server/scripts/switch-list-fresh-at-merge.ts <head sha>` calls this immediately before every squash merge, and
 * merges only on exit 0. Nothing here writes; it reads two trees.
 */
import {
  OPTION_SWITCH_LIST_MARKER,
  OPTION_SWITCH_MIGRATIONS_DIR,
  OPTION_SWITCH_WHITELIST_MIGRATION,
  optionSwitchStaleAgainstMain,
} from '../HorseOptionSwitchMigrationLists.js';

/** Runs git with these arguments and returns stdout; throws when git fails. */
export type GitRun = (args: readonly string[]) => string;

/** The switch list migrations (file names) the tree at `ref` holds. */
export function switchListsAt(git: GitRun, ref: string): string[] {
  let out = '';
  try {
    out = git([
      'grep',
      '-l',
      '-F',
      '-e',
      OPTION_SWITCH_LIST_MARKER,
      ref,
      '--',
      `${OPTION_SWITCH_MIGRATIONS_DIR}/`,
    ]);
  } catch (error) {
    // git grep exits 1 when nothing matches; every tree holds the base list migration, so that is not an answer
    throw new Error(`could not read the switch list migrations of ${ref}: ${String(error)}`);
  }
  return out
    .split('\n')
    .filter((l) => l.endsWith('.sql'))
    .map((l) => l.replace(/^.*\//, ''));
}

/** True when `ref` holds the whitelist-as-rows migration (full-list migrations are frozen from that point on). */
export function hasWhitelistMigrationAt(git: GitRun, ref: string): boolean {
  const path = `${OPTION_SWITCH_MIGRATIONS_DIR}/${OPTION_SWITCH_WHITELIST_MIGRATION}`;
  const out = git(['ls-tree', '--name-only', ref, '--', path]);
  return out.trim() !== '';
}

/** Null when `head` may merge onto `main` as far as the switch list goes; otherwise what is wrong and the remedy. */
export function switchListStaleAtMerge(
  git: GitRun,
  head: string,
  main = 'origin/main'
): string | null {
  const mainLists = switchListsAt(git, main);
  if (mainLists.length === 0)
    return `UNKNOWN: ${main} holds no switch list migration; refusing to judge`;
  const mainHasWhitelist = hasWhitelistMigrationAt(git, main);
  return optionSwitchStaleAgainstMain(switchListsAt(git, head), mainLists, mainHasWhitelist);
}
