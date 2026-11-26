import { describe, expect, it } from 'vitest';
import {
  OPTION_SWITCH_LAST_LIST_MIGRATION,
  OPTION_SWITCH_WHITELIST_MIGRATION,
} from '../HorseOptionSwitchMigrationLists.js';
import { switchListStaleAtMerge, type GitRun } from './switchListFreshAtMerge.js';

const D = 'supabase/migrations';
const BASE = '20261121042010_horse_option_switch_plo_dark_train.sql';
const TRAIN = '20261121143225_horse_option_switch_plo_list_train.sql';
const LANE = '20261121070901_horse_option_switch_button_open_priced.sql';
/** A git that answers `git grep -l` (list migrations) and `git ls-tree` (whitelist migration) per ref. */
const gitOf =
  (trees: Record<string, string[]>, whitelistRefs: ReadonlySet<string> = new Set()): GitRun =>
  (args) => {
    const ref = args[args.length - 3]!;
    const files = trees[ref];
    if (!files) throw new Error(`no ref ${ref}`);
    if (args[0] === 'ls-tree') {
      return whitelistRefs.has(ref) ? `${D}/${OPTION_SWITCH_WHITELIST_MIGRATION}\n` : '';
    }
    return files.map((f) => `${ref}:${D}/${f}`).join('\n') + '\n';
  };

describe('the switch list at merge time (AUDIT-B item 8: a branch green before main moved)', () => {
  it('a lane generated before the list train merged is refused against the main of the merge, though its own CI passed', () => {
    // its CI ran when main's newest was BASE: fresh then
    expect(
      switchListStaleAtMerge(gitOf({ lane: [BASE, LANE], 'origin/main': [BASE] }), 'lane')
    ).toBeNull();
    // the list train merged meanwhile: the same head is now stale and is refused
    const problem = switchListStaleAtMerge(
      gitOf({ lane: [BASE, LANE], 'origin/main': [BASE, TRAIN] }),
      'lane'
    );
    expect(problem).toMatch(/20261121143225_horse_option_switch_plo_list_train/);
  });

  it('a head regenerated after main newest, or adding no list, may merge before the whitelist migration lands', () => {
    const regenerated = '20261121190000_horse_option_switch_button_open_priced.sql';
    const main = [BASE, TRAIN];
    expect(
      switchListStaleAtMerge(gitOf({ lane: [...main, regenerated], 'origin/main': main }), 'lane')
    ).toBeNull();
    expect(switchListStaleAtMerge(gitOf({ lane: main, 'origin/main': main }), 'lane')).toBeNull();
  });

  it('once the whitelist-as-rows migration is on main, commuting --register branches pass and ANY new full-list migration is refused', () => {
    const frozen = [BASE, TRAIN, OPTION_SWITCH_LAST_LIST_MIGRATION];
    const withWhitelist = new Set(['origin/main']);
    // a lane using commuting fn_ca_horse_option_register adds no full-list migration: always passes
    expect(
      switchListStaleAtMerge(gitOf({ lane: frozen, 'origin/main': frozen }, withWhitelist), 'lane')
    ).toBeNull();
    // even a lane behind main by another lane's --register migration adds no full-list migration: passes
    expect(
      switchListStaleAtMerge(
        gitOf({ lane: [BASE, TRAIN], 'origin/main': frozen }, withWhitelist),
        'lane'
      )
    ).toBeNull();
    // a stale lane carrying an old full-list follow-up (even newer than the frozen last list) is refused
    const lateList = '20991231000000_horse_option_switch_stale_follow_up.sql';
    const refused = switchListStaleAtMerge(
      gitOf({ lane: [...frozen, lateList], 'origin/main': frozen }, withWhitelist),
      'lane'
    );
    expect(refused).toContain(OPTION_SWITCH_WHITELIST_MIGRATION);
    expect(refused).toContain(lateList);
    expect(refused).toContain('gen-horse-option-switch-sql.ts --register');
  });

  it('a main with no list, or a git that fails, is never a pass', () => {
    expect(switchListStaleAtMerge(gitOf({ lane: [BASE], 'origin/main': [] }), 'lane')).toMatch(
      /UNKNOWN/
    );
    expect(() => switchListStaleAtMerge(gitOf({ lane: [BASE] }), 'lane')).toThrow();
  });
});
