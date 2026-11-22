/**
 * LAW (2026-11-20, Phase 2 of anUnknownOptionRowIsSkippedAlone): EVERY OPTION NAME A SWITCH LIST OF THIS TREE
 * CARRIES IS AN OPTION THIS TREE REGISTERS.
 *
 * A name the serving build does not register used to void a worker's WHOLE switch configuration: every switched
 * option silently went back to its release default (fd13371b69e now skips such a row alone at run time and raises
 * option_switch_config_invalid_seen). That runtime guard catches a row written for ANOTHER build. This law is the
 * guard before the merge, for the same tree: no list that names switchable options may name one the registry
 * (OPTION_SWITCH_REGISTRY, derived from HORSE_DATA_LEDGER) does not carry, so a misspelt, retired or not yet
 * registered name fails the server suite of the local gate instead of reaching a switch row. The lists:
 *   1. the hand-written lists of HorseOptionSwitch.ts (release defaults, off-only, holds, shadow refusals);
 *   2. every marked list of the newest switch-list migration (the database whitelist the switch rows obey);
 *   3. every option list of the evidence proof script (scripts/ci/test-horse-option-switch-evidence-postgres.sh);
 *   4. every option authority file (docs/horse-option-authority.d/<option>.md), the citation an `on` row needs.
 * And the converse: a name the switch refuses, or names as not a switch, is never registered.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  OPTION_SWITCH_HELD_PATTERN_OFF_ONLY_NAMES,
  OPTION_SWITCH_NAMES,
  OPTION_SWITCH_NOT_A_SWITCH,
  OPTION_SWITCH_OFF_ONLY,
  OPTION_SWITCH_OFF_ONLY_PENDING,
  OPTION_SWITCH_PLUMBING,
  OPTION_SWITCH_PREFLOP_HELD_NAMES,
  OPTION_SWITCH_PREFLOP_HOLD_LIFTED,
  OPTION_SWITCH_REFUSED,
  OPTION_SWITCH_RELEASE_DEFAULT_CODE,
  OPTION_SWITCH_RELEASE_DEFAULT_OFF,
  OPTION_SWITCH_RELEASE_DEFAULT_ON,
  OPTION_SWITCH_SHADOW_REFUSED,
} from '../HorseOptionSwitch.js';
import {
  OPTION_SWITCH_MIGRATIONS_DIR,
  OPTION_SWITCH_PROOF_SCRIPT,
  newestOptionSwitchListMigration,
} from '../HorseOptionSwitchMigrationLists.js';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const registered = new Set(OPTION_SWITCH_NAMES);

/** The names of a list this tree does not register, with the list named. */
function unregistered(list: string, names: readonly string[]): string[] {
  return names.filter((name) => !registered.has(name)).map((name) => `${list}: ${name}`);
}

/** Every quoted name inside every `-- registry:<list>:begin ... -- registry:<list>:end` block. */
function markedLists(sql: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of sql.matchAll(
    /-- registry:([a-z-]+):begin\n([\s\S]*?)\n[ \t]*-- registry:\1:end/g
  )) {
    const names = [...m[2]!.matchAll(/'([^']*)'/g)].map((q) => q[1]!);
    out.set(m[1]!, [...(out.get(m[1]!) ?? []), ...names]);
  }
  return out;
}

/** The space-separated option lists of the proof script: `name='a b c'` lines. */
function scriptLists(script: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of script.matchAll(/^([a-z_]+)='([A-Za-z0-9 ]*)'$/gm))
    out.set(m[1]!, m[2]!.split(/\s+/).filter(Boolean));
  return out;
}

describe('LAW: every option name a switch list of this tree carries is registered', () => {
  it('the checker names an unregistered name and its list, and passes a registered one', () => {
    expect(unregistered('probe', [OPTION_SWITCH_NAMES[0]!, 'optionOfAnotherBuild'])).toEqual([
      'probe: optionOfAnotherBuild',
    ]);
    expect([
      ...markedLists(
        "x\n  -- registry:plain-options:begin\n  'a', 'b'\n  -- registry:plain-options:end\n"
      ),
    ]).toEqual([['plain-options', ['a', 'b']]]);
    expect([...scriptLists("plain='a b'\nrefused='c'\nlast_list=''\n")]).toEqual([
      ['plain', ['a', 'b']],
      ['refused', ['c']],
      ['last_list', []],
    ]);
  });

  it('the hand-written lists of HorseOptionSwitch.ts name only registered options', () => {
    expect([
      ...unregistered('OPTION_SWITCH_RELEASE_DEFAULT_ON', OPTION_SWITCH_RELEASE_DEFAULT_ON),
      ...unregistered('OPTION_SWITCH_RELEASE_DEFAULT_OFF', OPTION_SWITCH_RELEASE_DEFAULT_OFF),
      ...unregistered('OPTION_SWITCH_RELEASE_DEFAULT_CODE', OPTION_SWITCH_RELEASE_DEFAULT_CODE),
      ...unregistered('OPTION_SWITCH_OFF_ONLY', Object.keys(OPTION_SWITCH_OFF_ONLY)),
      ...unregistered('OPTION_SWITCH_OFF_ONLY_PENDING', OPTION_SWITCH_OFF_ONLY_PENDING),
      ...unregistered(
        'OPTION_SWITCH_HELD_PATTERN_OFF_ONLY_NAMES',
        OPTION_SWITCH_HELD_PATTERN_OFF_ONLY_NAMES
      ),
      ...unregistered(
        'OPTION_SWITCH_PREFLOP_HOLD_LIFTED',
        Object.keys(OPTION_SWITCH_PREFLOP_HOLD_LIFTED)
      ),
      ...unregistered('OPTION_SWITCH_PREFLOP_HELD_NAMES', OPTION_SWITCH_PREFLOP_HELD_NAMES),
      ...unregistered('OPTION_SWITCH_SHADOW_REFUSED', Object.keys(OPTION_SWITCH_SHADOW_REFUSED)),
    ]).toEqual([]);
  });

  it('a name the switch refuses or names as not a switch is never registered', () => {
    const never = [
      ...Object.keys(OPTION_SWITCH_REFUSED),
      ...Object.keys(OPTION_SWITCH_NOT_A_SWITCH),
      ...OPTION_SWITCH_PLUMBING,
    ];
    expect(never.length).toBeGreaterThan(0);
    expect(never.filter((name) => registered.has(name))).toEqual([]);
  });

  it('every marked list of the newest switch-list migration (the database whitelist) names only registered options', () => {
    const dir = join(repo, OPTION_SWITCH_MIGRATIONS_DIR);
    const files = readdirSync(dir)
      .filter((name) => name.endsWith('.sql'))
      .map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }));
    const newest = newestOptionSwitchListMigration(files);
    const lists = markedLists(readFileSync(join(repo, newest), 'utf8'));
    expect([...lists.keys()], newest).toContain('plain-options');
    expect([...lists].flatMap(([list, names]) => unregistered(`${newest} ${list}`, names))).toEqual(
      []
    );
  });

  it('every option list of the evidence proof script names only registered options, and its refused list none', () => {
    const lists = scriptLists(readFileSync(join(repo, OPTION_SWITCH_PROOF_SCRIPT), 'utf8'));
    for (const name of ['style', 'plain', 'offonly', 'shadow', 'onshadow', 'refused'])
      expect(lists.has(name), `${OPTION_SWITCH_PROOF_SCRIPT} list ${name}`).toBe(true);
    const optionLists = ['style', 'plain', 'offonly', 'shadow', 'onshadow'];
    expect(
      optionLists.flatMap((list) =>
        unregistered(`${OPTION_SWITCH_PROOF_SCRIPT} ${list}`, lists.get(list)!)
      )
    ).toEqual([]);
    expect(lists.get('refused')!.filter((name) => registered.has(name))).toEqual([]);
  });

  it('every option authority file names a registered option', () => {
    const dir = join(repo, 'docs/horse-option-authority.d');
    const options = readdirSync(dir)
      .filter((name) => /^[A-Za-z][A-Za-z0-9]*\.md$/.test(name) && name !== 'README.md')
      .map((name) => name.slice(0, -'.md'.length));
    expect(options.length).toBeGreaterThan(0);
    expect(unregistered('docs/horse-option-authority.d', options)).toEqual([]);
  });
});
