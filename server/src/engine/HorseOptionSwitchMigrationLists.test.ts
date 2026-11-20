/**
 * The supported route for changing the option switch's database lists after migration 20261114072215 is installed
 * (HorseOptionSwitchMigrationLists.ts, server/scripts/gen-horse-option-switch-sql.ts): the newest marker-bearing
 * migration is the whitelist, a change ships as a generated follow-up, and an installed file is never rewritten.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  OPTION_SWITCH_OFF_ONLY_NAMES,
  OPTION_SWITCH_ON_SHADOW_NAMES,
  OPTION_SWITCH_PLAIN_NAMES,
  OPTION_SWITCH_SHADOW_NAMES,
} from './HorseOptionSwitch.js';
import { STYLE_SWITCH_OPTIONS } from './HorseStyleSwitch.js';
import {
  OPTION_SWITCH_BASE_MIGRATION,
  OPTION_SWITCH_FOLLOW_UP_COMMAND,
  OPTION_SWITCH_PROOF_SCRIPT,
  newestOptionSwitchListMigration,
  optionSwitchFollowUpRefusal,
  optionSwitchFollowUpSql,
  optionSwitchListDrift,
  optionSwitchRewriteRefusal,
  proofScriptWithRegistryLists,
  withRegistryLists,
} from './HorseOptionSwitchMigrationLists.js';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const read = (path: string) => readFileSync(join(REPO, path), 'utf8');
const NAME = '20261116000000_horse_option_switch_test';
const FOLLOW_UP = `supabase/migrations/${NAME}.sql`;
const quoted = (text: string) => [...text.matchAll(/'([A-Za-z0-9]+)'/g)].map((m) => m[1]!);
const sorted = (names: readonly string[]) => [...names].sort();
/** The quoted states of an ARRAY[...] (on_shadow included, 2026-11-19). */
const statesIn = (text: string) => [...text.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
const code = (sql: string) => sql.replace(/--[^\n]*/g, '');
const constraint = (sql: string, name: string) =>
  new RegExp(`ADD CONSTRAINT ${name} CHECK \\(([\\s\\S]*?)\\);`).exec(code(sql))![1]!;

describe('a Horse option added after the switch is installed ships as a follow-up migration', () => {
  it('(a) a ledger option missing from the newest list fails with a message naming the --follow-up command', () => {
    const sql = optionSwitchFollowUpSql(NAME);
    expect(optionSwitchListDrift(FOLLOW_UP, sql)).toBeNull();
    // the newest list migration on disk (the base, or the latest follow-up) equals the registry today
    const onDisk = newestOptionSwitchListMigration(
      readdirSync(join(REPO, 'supabase/migrations'))
        .filter((name) => name.endsWith('.sql'))
        .map((name) => ({
          name,
          text: read(`supabase/migrations/${name}`),
        }))
    );
    expect(optionSwitchListDrift(onDisk, read(onDisk))).toBeNull();
    // drop the last plain (switchable on/off) option from every plain list: the registry now has an option the
    // database whitelist does not
    const missing = OPTION_SWITCH_PLAIN_NAMES.filter(
      (n) => !OPTION_SWITCH_OFF_ONLY_NAMES.includes(n)
    ).at(-1)!;
    const stale = sql.replace(
      /(-- registry:plain-options:begin\n)([\s\S]*?)(\n[ \t]*-- registry:plain-options:end)/g,
      (_a, b: string, list: string, e: string) =>
        b + list.replace(new RegExp(`,?\\s*'${missing}'`), '') + e
    );
    expect(stale).not.toBe(sql);
    const message = optionSwitchListDrift(FOLLOW_UP, stale);
    expect(message).toContain('--follow-up');
    expect(message).toContain(OPTION_SWITCH_FOLLOW_UP_COMMAND);
    expect(message).toContain(FOLLOW_UP);
    expect(message).toContain(OPTION_SWITCH_PROOF_SCRIPT);
    expect(message).toMatch(/Do not edit an installed migration/);
  });

  it('(b) a generated follow-up re-asserts exactly the registry, in one idempotent transaction that never fixes data', () => {
    const sql = optionSwitchFollowUpSql(NAME);
    const run = code(sql);
    expect(withRegistryLists(sql)).toBe(sql);
    expect(run.trim()).toMatch(/^BEGIN;\s*SET LOCAL lock_timeout = '3s';[\s\S]*COMMIT;$/);
    // the table whitelist
    expect(sorted(quoted(constraint(sql, 'ca_horse_style_switch_option_is_registered')))).toEqual(
      sorted([...STYLE_SWITCH_OPTIONS, ...OPTION_SWITCH_PLAIN_NAMES])
    );
    // on cites its own authority (style options apart), the same text as the base migration but for on_shadow
    // (2026-11-19), which acts as on and so cites its own authority too
    expect(constraint(sql, 'ca_horse_style_switch_on_cites_authority')).toBe(
      constraint(
        read(OPTION_SWITCH_BASE_MIGRATION),
        'ca_horse_style_switch_on_cites_authority'
      ).replace("state <> 'on'", "state NOT IN ('on', 'on_shadow')")
    );
    // off-only, the shadow options (2026-11-18), the on_shadow options (2026-11-19) and the style states
    const fits =
      /^\s*state = 'off'\s*OR \(state = 'on' AND option NOT IN \(([^)]*)\)\)\s*OR \(state = 'shadow' AND option IN \(([^)]*)\)\)\s*OR \(state = 'on_shadow' AND option IN \(([^)]*)\)\)\s*OR \(state <> 'on_shadow' AND option IN \(([^)]*)\)\)\s*$/.exec(
        constraint(sql, 'ca_horse_style_switch_state_fits_option')
      )!;
    expect(sorted(quoted(fits[1]!))).toEqual(sorted(OPTION_SWITCH_OFF_ONLY_NAMES));
    expect(sorted(quoted(fits[2]!))).toEqual(sorted(OPTION_SWITCH_SHADOW_NAMES));
    expect(sorted(quoted(fits[3]!))).toEqual(sorted(OPTION_SWITCH_ON_SHADOW_NAMES));
    expect(sorted(quoted(fits[4]!))).toEqual(sorted(STYLE_SWITCH_OPTIONS));
    // the states function: style, then off-only before plain
    const body =
      /CREATE OR REPLACE FUNCTION public\.fn_ca_horse_option_switch_states\(p_option text\)[\s\S]*?AS \$function\$([\s\S]*?)\$function\$;/.exec(
        run
      )![1]!;
    expect(
      [...body.matchAll(/WHEN p_option IN \(([^)]*)\)\s*THEN ARRAY\[([^\]]*)\]/g)].map((m) => ({
        names: sorted(quoted(m[1]!)),
        states: statesIn(m[2]!),
      }))
    ).toEqual([
      { names: sorted(STYLE_SWITCH_OPTIONS), states: ['off', 'shadow', 'canary', 'on'] },
      { names: sorted(OPTION_SWITCH_OFF_ONLY_NAMES), states: ['off'] },
      { names: sorted(OPTION_SWITCH_SHADOW_NAMES), states: ['off', 'shadow', 'on_shadow', 'on'] },
      { names: sorted(OPTION_SWITCH_ON_SHADOW_NAMES), states: ['off', 'on_shadow', 'on'] },
      { names: sorted(OPTION_SWITCH_PLAIN_NAMES), states: ['off', 'on'] },
    ]);
    // idempotent: drop-if-exists then add, create or replace; no table, column, index, trigger or row
    for (const name of [
      'ca_horse_style_switch_option_is_registered',
      'ca_horse_style_switch_on_cites_authority',
      'ca_horse_style_switch_state_fits_option',
    ])
      expect(run).toContain(`DROP CONSTRAINT IF EXISTS ${name},\n  ADD CONSTRAINT ${name} CHECK (`);
    expect(run).not.toMatch(
      /CREATE FUNCTION|CREATE\s+TABLE|ADD\s+COLUMN|CREATE\s+(UNIQUE\s+)?INDEX|CREATE\s+TRIGGER|INSERT\s+INTO|DELETE\s+FROM|UPDATE\s+public/i
    );
    // it never fixes data: an existing row that breaks the new lists raises before the first ALTER
    const check = run.indexOf('$existing_rows_fit$');
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(run.indexOf('ALTER TABLE'));
    const block = run.slice(check, run.indexOf('$existing_rows_fit$;'));
    expect(block).toMatch(
      /RAISE EXCEPTION 'switch row % \(state %\) names an option the registry no longer has/
    );
    expect(block).toMatch(
      /IF r\.state IN \('on', 'on_shadow'\) AND r\.option IN \(([^)]*)\) THEN\s*RAISE EXCEPTION 'switch row % is % and the option is now off-only/
    );
    expect(
      sorted(
        quoted(/IF r\.state IN \('on', 'on_shadow'\) AND r\.option IN \(([^)]*)\)/.exec(block)![1]!)
      )
    ).toEqual(sorted(OPTION_SWITCH_OFF_ONLY_NAMES));
    // 2026-11-19: an on_shadow row for an option the new lists do not give on_shadow raises, and the file refuses to
    // install before the set function and the registry publish know on_shadow
    expect(
      sorted(
        quoted(
          /IF r\.state = 'on_shadow' AND NOT \(r\.option IN \(([^)]*)\)\) THEN/.exec(block)![1]!
        )
      )
    ).toEqual(sorted(OPTION_SWITCH_ON_SHADOW_NAMES));
    expect(block).toMatch(
      /RAISE EXCEPTION 'the switch functions do not know on_shadow: install \*_the_horse_option_switch_on_shadow_keeps_every_rule_of_on\.sql first'/
    );
    expect(block).not.toMatch(/UPDATE|DELETE|INSERT/);
    // a shadow or canary row the new lists no longer allow raises too, and the file refuses to install while the
    // switch functions still tell the style options by shadow
    expect(block).toMatch(/RAISE EXCEPTION 'switch row % is % and the option no longer takes it/);
    expect(block).toMatch(
      /RAISE EXCEPTION 'the switch functions still tell the style options by shadow: install \*_the_horse_option_switch_tells_style_options_by_name\.sql first'/
    );
    // the read-back proves the answer for every registered name where it is installed
    expect(run).toMatch(
      /DO \$readback\$[\s\S]*RAISE EXCEPTION 'a registered option does not answer with its states'/
    );
    expect([...run.matchAll(/GRANT\s+[^;]*?\sTO\s+([^;]*);/g)].map((m) => m[1]!.trim())).toEqual([
      'service_role',
    ]);
  });

  it('(c) the generator never rewrites the installed base migration, nor any file main holds or that is not the newest', () => {
    // the base migration: refused whether or not a follow-up exists
    expect(optionSwitchRewriteRefusal(OPTION_SWITCH_BASE_MIGRATION, FOLLOW_UP, false)).toMatch(
      /is installed and is never rewritten: write a follow-up with --follow-up/
    );
    expect(
      optionSwitchRewriteRefusal(OPTION_SWITCH_BASE_MIGRATION, OPTION_SWITCH_BASE_MIGRATION, false)
    ).toMatch(/never rewritten/);
    // an older follow-up is not the whitelist
    expect(
      optionSwitchRewriteRefusal(
        FOLLOW_UP,
        'supabase/migrations/20261117000000_horse_option_switch_b.sql',
        false
      )
    ).toMatch(/is not the newest list migration/);
    // a follow-up already on main is installed or about to be
    expect(optionSwitchRewriteRefusal(FOLLOW_UP, FOLLOW_UP, true)).toMatch(/is on main/);
    // only your own unmerged newest follow-up may be regenerated in place
    expect(optionSwitchRewriteRefusal(FOLLOW_UP, FOLLOW_UP, false)).toBeNull();
    // a new follow-up: a proper name, later than the newest list migration
    expect(optionSwitchFollowUpRefusal(NAME, OPTION_SWITCH_BASE_MIGRATION)).toBeNull();
    expect(optionSwitchFollowUpRefusal(`${NAME}.sql`, OPTION_SWITCH_BASE_MIGRATION)).toMatch(
      /without \.sql/
    );
    expect(
      optionSwitchFollowUpRefusal('horse_option_switch_test', OPTION_SWITCH_BASE_MIGRATION)
    ).toMatch(/is named/);
    expect(
      optionSwitchFollowUpRefusal('20261114072215_again', OPTION_SWITCH_BASE_MIGRATION)
    ).toMatch(/must be later than/);
    expect(optionSwitchFollowUpRefusal('20261115000000_horse_option_switch_x', FOLLOW_UP)).toMatch(
      /must be later than/
    );
  });

  it('the newest marker-bearing migration is the whitelist; files without the markers are ignored', () => {
    const marked = '-- registry:plain-options:begin\n-- registry:plain-options:end\n';
    const files = [
      { name: '20261114072215_every_horse_upgrade_has_a_live_switch.sql', text: marked },
      { name: '20261116000000_horse_option_switch_a.sql', text: marked },
      { name: '20261117000000_unrelated.sql', text: 'SELECT 1;' },
      { name: 'README.md', text: marked },
    ];
    expect(newestOptionSwitchListMigration(files)).toBe(
      'supabase/migrations/20261116000000_horse_option_switch_a.sql'
    );
    expect(newestOptionSwitchListMigration(files.slice(0, 1))).toBe(OPTION_SWITCH_BASE_MIGRATION);
    expect(() => newestOptionSwitchListMigration(files.slice(2))).toThrow(
      /carries the registry markers/
    );
  });

  it('the proof script lists are written from the registry, and its refused list is kept', () => {
    const script = read(OPTION_SWITCH_PROOF_SCRIPT);
    expect(proofScriptWithRegistryLists(script)).toBe(script);
    const refused = /^refused='[^']*'$/m.exec(script)![0]!;
    const drifted = script
      .replace(/^plain='([^']*)'$/m, "plain='onlyThisOne'")
      .replace(/^offonly='[^']*'$/m, "offonly=''");
    const restored = proofScriptWithRegistryLists(drifted);
    expect(restored).toBe(script);
    expect(restored).toContain(refused);
  });
});
