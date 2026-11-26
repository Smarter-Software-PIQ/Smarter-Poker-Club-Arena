/**
 * THE DATABASE WHITELIST OF THE OPTION SWITCH, AND HOW AN OPTION JOINS IT (2026-11-19: a Horse option registers
 * itself; before that, 2026-11-15, every change re-asserted the whole list).
 *
 * The engine registry (HorseOptionSwitch.ts, derived from HORSE_DATA_LEDGER) and the database whitelist of the switch
 * must name the same options. The whitelist is the ROWS of public.ca_horse_option_whitelist (migration
 * OPTION_SWITCH_WHITELIST_MIGRATION): one row per option, its kind (style or plain), the migrations holding it
 * off-only and how far its counterfactual re-decision goes (shadow: none, on_shadow or shadow; 2026-11-20 port to
 * the shadow and on_shadow lists of main). The switch table refers to it (foreign key, row trigger) and
 * fn_ca_horse_option_switch_states reads it.
 *
 * WHY ROWS. Until 2026-11-19 the whitelist was literal lists in three CHECK constraints and one function, so every
 * pull request that registered one option carried a migration re-asserting all the registered names. Migrations
 * install in merge order: the second of two such pull requests overwrote the first, and one generated before the
 * first merged silently un-locked what the first had locked. Now a pull request ships one line per option,
 *   SELECT public.fn_ca_horse_option_register('<option>', 'plain' | 'style', <off-only>,
 *     'none' | 'on_shadow' | 'shadow', '<its migration name>');
 * which is idempotent and commutes with every other such line, in either install order.
 *
 * THE RULE THIS MODULE COMPUTES: the whitelist a database holds after installing main is
 *   the lists of OPTION_SWITCH_LAST_LIST_MIGRATION (the last full-list migration, frozen)
 *   + every fn_ca_horse_option_register / _unlock / _unregister / _allow_shadow call of every migration
 * and everyUpgradeHasALiveSwitch.law.test.ts requires it to equal the registry. Registering only ever adds a name,
 * adds an off-only hold or NARROWS the shadow level (the lower of the two), so the result does not depend on the
 * order. An un-lock, a removal or a wider shadow level is explicit, names what it does, and fails the law unless it
 * is listed in OPTION_SWITCH_APPROVED_UNLOCKS.
 *
 * FROZEN HISTORICAL CHAIN (#11553, #11668): the 47 historical full-list migrations from the base through
 * OPTION_SWITCH_CHAIN_ANCHOR through OPTION_SWITCH_LAST_LIST_MIGRATION remain verified as one unbroken chain
 * (optionSwitchChainProblem) and merge-time freshness (optionSwitchStaleAgainstMain) accepts commuting --register
 * migrations while refusing any stale branch that still carries a full-list follow-up.
 *
 * TO REGISTER A NEW OPTION (or hold one off-only), two commands:
 *   node scripts/new-migration.mjs "horse option register <what>"          (repository root; reserves the version)
 *   npx tsx scripts/gen-horse-option-switch-sql.ts --register <the file>   (server/; writes the calls it needs)
 *
 * This module reads no file and touches no database.
 */
import { createHash } from 'node:crypto';
import {
  OPTION_SWITCH_OFF_ONLY_NAMES,
  OPTION_SWITCH_ON_SHADOW_NAMES,
  OPTION_SWITCH_PLAIN_NAMES,
  OPTION_SWITCH_SHADOW_NAMES,
} from './HorseOptionSwitch.js';
import { STYLE_SWITCH_OPTIONS } from './HorseStyleSwitch.js';

export const OPTION_SWITCH_MIGRATIONS_DIR = 'supabase/migrations';
/** The first list migration: the switch functions (set, clear, effective) are read from it by the law. */
export const OPTION_SWITCH_BASE_MIGRATION =
  'supabase/migrations/20261114072215_every_horse_upgrade_has_a_live_switch.sql';
/** A migration carrying this marker is one of the full-list migrations. There are no new ones. */
export const OPTION_SWITCH_LIST_MARKER = '-- registry:plain-options:begin';
/**
 * The LAST full-list migration: the lists the whitelist table is seeded with. Frozen. The whitelist migration reads
 * its seed from the installed database and refuses to install unless that is exactly these lists (by fingerprint,
 * optionSwitchListsFingerprint). If another full-list follow-up reaches main BEFORE the whitelist migration is
 * installed, these two constants, the file name in the proof script and the fingerprint line of the (not yet
 * installed) whitelist migration move to it; the law names each.
 */
export const OPTION_SWITCH_LAST_LIST_MIGRATION =
  '20261124141237_horse_option_switch_oop_reraise_range_holds.sql';
/** How many full-list migrations there are: the base and its follow-ups. One more is a full-list follow-up. */
export const OPTION_SWITCH_LIST_MIGRATION_COUNT = 47;
/** The migration that turned the lists into rows. */
export const OPTION_SWITCH_WHITELIST_MIGRATION =
  '20261125234502_a_horse_option_registers_itself.sql';
/**
 * The migration that makes the switch functions tell the style options by canary, so a non-style option in shadow
 * keeps every rule of `on` (2026-11-18). aShadowOptionKeepsEveryRuleOfOn.law.test.ts reads it.
 */
export const OPTION_SWITCH_STYLE_BY_NAME_MIGRATION_SUFFIX =
  '_the_horse_option_switch_tells_style_options_by_name.sql';
/**
 * The migration that gives on_shadow every rule of `on` in the set function (own citation, recorded evidence, the
 * serving-registry guard), lets the publish accept on_shadow and widens the table's state check (2026-11-19).
 */
export const OPTION_SWITCH_ON_SHADOW_RULES_MIGRATION_SUFFIX =
  '_the_horse_option_switch_on_shadow_keeps_every_rule_of_on.sql';
/** The proof script that executes all of it on a throwaway PostgreSQL. */
export const OPTION_SWITCH_PROOF_SCRIPT =
  'scripts/ci/test-horse-option-switch-evidence-postgres.sh';
/** A migration's name: the 14-digit version and a snake_case name, no extension. */
export const OPTION_SWITCH_MIGRATION_NAME = /^(\d{14})_[a-z0-9]+(?:_[a-z0-9]+)*$/;
/** What a lane runs when the whitelist differs from the registry. */
export const OPTION_SWITCH_REGISTER_COMMAND =
  'node scripts/new-migration.mjs "horse option register <what>" (repository root), then ' +
  'npx tsx scripts/gen-horse-option-switch-sql.ts --register <the file it printed> (server/)';
/**
 * The un-locks, removals and wider shadow levels that were approved, each '<migration name>:unlock:<option>',
 * '<migration name>:unregister:<option>' or '<migration name>:allow_shadow:<option>'. Lifting an off-only hold,
 * removing an option or letting an option take shadow / on_shadow is never a side effect of registering something
 * else: it is its own call, in its own migration, and listed here by hand.
 */
export const OPTION_SWITCH_APPROVED_UNLOCKS: readonly string[] = [];

/**
 * FROZEN HISTORICAL CHAIN CONSTANTS (2026-11-20, #11553; reconciled with whitelist-as-rows 2026-11-22).
 *
 * The 47 historical full-list migrations up through OPTION_SWITCH_LAST_LIST_MIGRATION remain audited as one unbroken
 * chain: pre-chain versions up through OPTION_SWITCH_CHAIN_ANCHOR are pinned, and every full-list migration after
 * the anchor names its predecessor on one `-- registry:follows: <file>` line and stamps its version into
 * fn_ca_horse_option_switch_states.
 */
export const OPTION_SWITCH_FOLLOWS_PREFIX = '-- registry:follows: ';
/** The last list migration written before the chain: it and every older list migration carry no follows line. */
export const OPTION_SWITCH_CHAIN_ANCHOR =
  '20261120210905_horse_option_switch_heads_up_big_blind_hold_lift';
/**
 * The versions of every list migration written before the chain (the anchor included). A list migration at or below
 * the anchor's version that is not one of these was added later with a hand-picked old version: refused.
 */
export const OPTION_SWITCH_PRE_CHAIN_VERSIONS: readonly string[] = [
  '20261114072215',
  '20261115185244',
  '20261115191000',
  '20261115230000',
  '20261116003412',
  '20261116005000',
  '20261116005515',
  '20261116005904',
  '20261116010528',
  '20261116011129',
  '20261116073430',
  '20261116074500',
  '20261116140705',
  '20261116180400',
  '20261116191200',
  '20261117182301',
  '20261118000436',
  '20261118013329',
  '20261118070047',
  '20261118092009',
  '20261119051508',
  '20261119094119',
  '20261119144317',
  '20261119144324',
  '20261119175723',
  '20261119193736',
  '20261119205115',
  '20261119232145',
  '20261119234131',
  '20261120022006',
  '20261120023016',
  '20261120113718',
  '20261120163307',
  '20261120181452',
  '20261120210905',
];
/** The comment inside fn_ca_horse_option_switch_states that records which list or whitelist migration wrote it. */
export const OPTION_SWITCH_VERSION_STAMP = 'registry-lists-version: ';

const versionOf = (name: string): string => /(\d{14})_/.exec(name)?.[1] ?? '';
const baseName = (name: string): string => name.replace(/^.*\//, '').replace(/\.sql$/, '');

/** What the author of a stale or retired full-list migration does, in the order they do it. */
export function optionSwitchStaleRemedy(own: string, newest: string): string {
  return (
    `To fix: (1) bring main into your branch (git fetch origin main, then rebase onto origin/main or merge it); ` +
    `(2) delete your list migration ${own} (full-list migrations are frozen at ${OPTION_SWITCH_LAST_LIST_MIGRATION}; ` +
    `the newest list on main is ${newest}, and never-installed list files are safe to delete); ` +
    `(3) register only your own options with ${OPTION_SWITCH_REGISTER_COMMAND}`
  );
}

/** The follows lines of a migration, by name (without .sql). */
export function optionSwitchFollowsLines(sql: string): string[] {
  return [...sql.matchAll(/^-- registry:follows: (\S*)[ \t]*$/gm)].map((m) => m[1]!);
}

/** The version stamp inside the migration's fn_ca_horse_option_switch_states body, or null. */
export function optionSwitchVersionStamp(sql: string): string | null {
  const body =
    /CREATE OR REPLACE FUNCTION public\.fn_ca_horse_option_switch_states\(p_option text\)[\s\S]*?AS \$function\$([\s\S]*?)\$function\$;/.exec(
      sql
    )?.[1];
  return body ? (/-- registry-lists-version: (\d{14})\b/.exec(body)?.[1] ?? null) : null;
}

/**
 * Null when the full-list migrations of a tree form one unbroken chain after the anchor, otherwise what is wrong and
 * the remedy. `files` is every migration of the tree (non-list files, including commuting `--register` migrations,
 * are ignored).
 */
export function optionSwitchChainProblem(
  files: readonly { readonly name: string; readonly text: string }[]
): string | null {
  const lists = files
    .filter((f) => f.name.endsWith('.sql') && f.text.includes(OPTION_SWITCH_LIST_MARKER))
    .map((f) => ({ ...f, base: baseName(f.name) }))
    .sort((a, b) => (a.base < b.base ? -1 : a.base > b.base ? 1 : 0));
  const anchor = lists.findIndex((f) => f.base === OPTION_SWITCH_CHAIN_ANCHOR);
  if (anchor < 0)
    return `the chain anchor ${OPTION_SWITCH_CHAIN_ANCHOR}.sql is not a list migration of this tree`;
  const newest = lists[lists.length - 1]!.base;
  for (const file of lists.slice(0, anchor + 1))
    if (!OPTION_SWITCH_PRE_CHAIN_VERSIONS.includes(versionOf(file.base)))
      return (
        `the switch list migration ${OPTION_SWITCH_MIGRATIONS_DIR}/${file.name} sorts before the chain anchor ` +
        `${OPTION_SWITCH_CHAIN_ANCHOR}.sql and is not one of the list migrations written before the chain: its version ` +
        `is older than lists already installed, so it would put back older allowed states. ` +
        optionSwitchStaleRemedy(`${OPTION_SWITCH_MIGRATIONS_DIR}/${file.name}`, newest)
      );
  for (let i = anchor + 1; i < lists.length; i++) {
    const file = lists[i]!;
    const previous = lists[i - 1]!.base;
    const follows = optionSwitchFollowsLines(file.text);
    const path = `${OPTION_SWITCH_MIGRATIONS_DIR}/${file.name}`;
    if (follows.length !== 1 || follows[0] !== previous) {
      const said =
        follows.length === 0
          ? 'names no list migration it follows'
          : follows.length > 1
            ? `has ${follows.length} follows lines`
            : `was generated after ${follows[0]}.sql`;
      return (
        `the switch list migration ${path} ${said}, but the list migration immediately before it in this tree is ` +
        `${previous}.sql. Its lists were generated without seeing ${previous}.sql, and installing it would put ` +
        `back the older allowed states of every option that file changed. ` +
        optionSwitchStaleRemedy(path, lists.filter((f) => f !== file).at(-1)!.base)
      );
    }
    if (optionSwitchVersionStamp(file.text) !== versionOf(file.base))
      return (
        `the switch list migration ${path} does not stamp its own version (${OPTION_SWITCH_VERSION_STAMP}` +
        `${versionOf(file.base)}) into fn_ca_horse_option_switch_states, so the database cannot refuse an older ` +
        `list installed after it. ` +
        optionSwitchStaleRemedy(path, newest)
      );
    if (!file.text.includes(`'${OPTION_SWITCH_VERSION_STAMP}([0-9]{14})'`))
      return (
        `the switch list migration ${path} lacks the refusal of an older list. ` +
        optionSwitchStaleRemedy(path, newest)
      );
  }
  return null;
}

/**
 * Null when the full-list migrations a branch adds (in `tree`, not on main) are safe against main; otherwise what is
 * wrong and the remedy. Names may be paths or bare file names; only full-list migrations are passed, so branches
 * adding commuting `--register` migrations have `added.length === 0` and always pass.
 *
 * When `mainHasWhitelist` is true, main already holds `OPTION_SWITCH_WHITELIST_MIGRATION` (the row-based whitelist):
 * full-list follow-ups are frozen and ANY newly added full-list migration is refused, because installing it after the
 * whitelist would overwrite the rows with literal lists.
 */
export function optionSwitchStaleAgainstMain(
  treeLists: readonly string[],
  mainLists: readonly string[],
  mainHasWhitelist = false
): string | null {
  const tree = new Set(treeLists.map(baseName));
  const main = [...new Set(mainLists.map(baseName))].sort();
  const added = [...tree].filter((n) => !main.includes(n)).sort();
  const mainNewest = main[main.length - 1];
  if (added.length === 0 || !mainNewest) return null;
  const own = `${OPTION_SWITCH_MIGRATIONS_DIR}/${added[added.length - 1]}.sql`;
  if (mainHasWhitelist)
    return (
      `main already uses the row-based whitelist (${OPTION_SWITCH_WHITELIST_MIGRATION}), so full-list switch ` +
      `migrations are frozen at ${mainNewest}.sql and this branch adds ${added.map((n) => `${n}.sql`).join(', ')}: ` +
      `installing a full-list migration after the whitelist would overwrite the whitelist rows with literal lists. ` +
      optionSwitchStaleRemedy(own, `${mainNewest}.sql`)
    );
  if (!tree.has(mainNewest))
    return (
      `main holds the switch list migration ${mainNewest}.sql and this branch does not, while it adds ` +
      `${added.map((n) => `${n}.sql`).join(', ')}: its lists were generated from an older main and would put back ` +
      `whatever ${mainNewest}.sql changed. ` +
      optionSwitchStaleRemedy(own, `${mainNewest}.sql`)
    );
  const older = added.filter((n) => versionOf(n) <= versionOf(mainNewest));
  if (older.length > 0)
    return (
      `the switch list migration ${older[0]}.sql this branch adds is not newer than main's newest list migration ` +
      `${mainNewest}.sql, so it is not the whitelist and it could install after it. ` +
      optionSwitchStaleRemedy(
        `${OPTION_SWITCH_MIGRATIONS_DIR}/${older[0]}.sql`,
        `${mainNewest}.sql`
      )
    );
  return null;
}

export type OptionSwitchKind = 'style' | 'plain';
/**
 * How far the engine's counterfactual re-decision goes for a plain option (HorseOptionSwitch.ts): 'none' (off, on),
 * 'on_shadow' (off, on_shadow, on) or 'shadow' (off, shadow, on_shadow, on: every shadow option takes on_shadow).
 * A style option has its own shadow arm and is always 'none' here. A ladder, so that two registrations settle on
 * the lower level whichever installs first.
 */
export type OptionSwitchShadowLevel = 'none' | 'on_shadow' | 'shadow';
export const OPTION_SWITCH_SHADOW_LEVELS: readonly OptionSwitchShadowLevel[] = [
  'none',
  'on_shadow',
  'shadow',
];
const level = (shadow: OptionSwitchShadowLevel) => OPTION_SWITCH_SHADOW_LEVELS.indexOf(shadow);
export interface OptionSwitchMigrationFile {
  readonly name: string;
  readonly text: string;
}
/**
 * One whitelist row: the kind, the migrations holding the option off-only (sorted; empty = not off-only) and the
 * shadow level (stored for a held option too; it answers only while the option is not held).
 */
export interface OptionSwitchWhitelistRow {
  readonly kind: OptionSwitchKind;
  readonly lockedBy: readonly string[];
  readonly shadow: OptionSwitchShadowLevel;
}
/** The states a row answers, exactly as fn_ca_horse_option_switch_states does. */
export function optionSwitchRowStates(row: OptionSwitchWhitelistRow): readonly string[] {
  if (row.kind === 'style') return ['off', 'shadow', 'canary', 'on'];
  if (row.lockedBy.length > 0) return ['off'];
  if (row.shadow === 'shadow') return ['off', 'shadow', 'on_shadow', 'on'];
  if (row.shadow === 'on_shadow') return ['off', 'on_shadow', 'on'];
  return ['off', 'on'];
}
export type OptionSwitchWhitelist = ReadonlyMap<string, OptionSwitchWhitelistRow>;
/** One call of a whitelist writer, as a migration spells it. */
export type OptionSwitchWhitelistCall =
  | {
      readonly fn: 'register';
      readonly option: string;
      readonly kind: OptionSwitchKind;
      readonly offOnly: boolean;
      readonly shadow: OptionSwitchShadowLevel;
      readonly migration: string;
    }
  | {
      readonly fn: 'allow_shadow';
      readonly option: string;
      readonly shadow: OptionSwitchShadowLevel;
      readonly migration: string;
    }
  | {
      readonly fn: 'unlock';
      readonly option: string;
      readonly lifts: readonly string[];
      readonly migration: string;
    }
  | { readonly fn: 'unregister'; readonly option: string; readonly migration: string };

const noComments = (sql: string) => sql.replace(/--[^\n]*/g, '');
const quoted = (text: string) => [...text.matchAll(/'([A-Za-z0-9_]+)'/g)].map((m) => m[1]!);
const sortedUnique = (names: readonly string[]) => [...new Set(names)].sort();
const WRITER_OR_TABLE =
  /fn_ca_horse_option_(?:register|unlock|unregister|allow_shadow)\b|ca_horse_option_whitelist\b/g;
const NAME = "'([A-Za-z][A-Za-z0-9]{0,62})'";
const MIGRATION = "'(\\d{14}_[a-z0-9]+(?:_[a-z0-9]+)*)'";
const CALL = new RegExp(
  'SELECT public\\.fn_ca_horse_option_(?:' +
    `(register)\\(${NAME}, '(style|plain)', (true|false), '(none|on_shadow|shadow)', ${MIGRATION}\\)` +
    `|(unlock)\\(${NAME}, ARRAY\\[([^\\]]*)\\], ${MIGRATION}\\)` +
    `|(unregister)\\(${NAME}, ${MIGRATION}\\)` +
    `|(allow_shadow)\\(${NAME}, '(on_shadow|shadow)', ${MIGRATION}\\)` +
    ');',
  'g'
);

export interface OptionSwitchLists {
  readonly style: readonly string[];
  readonly plain: readonly string[];
  readonly offOnly: readonly string[];
  readonly shadow: readonly string[];
  readonly onShadow: readonly string[];
}
/** The shadow level a full list gives a plain option: off-only answers off alone, so its level is none. */
function listedShadowLevel(lists: OptionSwitchLists, name: string): OptionSwitchShadowLevel {
  if (lists.offOnly.includes(name)) return 'none';
  if (lists.shadow.includes(name)) return 'shadow';
  return lists.onShadow.includes(name) ? 'on_shadow' : 'none';
}

/** The five lists of a full-list migration, read from its first marked blocks. */
export function optionSwitchListsOf(sql: string): OptionSwitchLists {
  const block = (marker: string) => {
    const found = new RegExp(
      `-- registry:${marker}:begin\\n([\\s\\S]*?)\\n[ \\t]*-- registry:${marker}:end`
    ).exec(sql);
    if (!found) throw new Error(`the migration has no registry:${marker} markers`);
    return quoted(found[1]!);
  };
  return {
    style: block('style-options'),
    plain: block('plain-options'),
    offOnly: block('off-only-options'),
    shadow: block('shadow-options'),
    onShadow: block('on-shadow-options'),
  };
}

/**
 * The fingerprint of a full list, as the whitelist migration computes it over the rows it seeded: md5 of
 * 'option:kind:off-only(0|1):shadow level' joined by ',' in byte order of the option name.
 */
export function optionSwitchListsFingerprint(lists: OptionSwitchLists): string {
  const offOnly = new Set(lists.offOnly);
  const rows = [
    ...lists.style.map((name) => [name, `${name}:style:0:none`] as const),
    ...lists.plain.map(
      (name) =>
        [
          name,
          `${name}:plain:${offOnly.has(name) ? 1 : 0}:${listedShadowLevel(lists, name)}`,
        ] as const
    ),
  ].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash('md5')
    .update(rows.map(([, row]) => row).join(','))
    .digest('hex');
}

/**
 * The newest full-list migration among `files`, repository-relative. The laws that read the frozen lists as SQL
 * (a shadow option keeps every rule of on; every switch-list name is registered) read this file; with the whitelist
 * as rows it is OPTION_SWITCH_LAST_LIST_MIGRATION and stays so (optionSwitchListMigrationsRefusal).
 */
export function newestOptionSwitchListMigration(
  files: readonly OptionSwitchMigrationFile[]
): string {
  const carrying = files
    .filter((f) => f.name.endsWith('.sql') && f.text.includes(OPTION_SWITCH_LIST_MARKER))
    .map((f) => f.name)
    .sort();
  const newest = carrying[carrying.length - 1];
  if (!newest)
    throw new Error(`no migration in ${OPTION_SWITCH_MIGRATIONS_DIR} carries the registry markers`);
  return `${OPTION_SWITCH_MIGRATIONS_DIR}/${newest}`;
}

/**
 * Why the full-list migrations on disk are not the frozen set, or null. A new one (an old --follow-up written before
 * the whitelist became rows) would, installed after the whitelist migration, put the literal lists back over it.
 */
export function optionSwitchListMigrationsRefusal(
  files: readonly OptionSwitchMigrationFile[]
): string | null {
  const carrying = files
    .filter((f) => f.name.endsWith('.sql') && f.text.includes(OPTION_SWITCH_LIST_MARKER))
    .map((f) => f.name)
    .sort();
  const newest = carrying[carrying.length - 1];
  if (
    newest === OPTION_SWITCH_LAST_LIST_MIGRATION &&
    carrying.length === OPTION_SWITCH_LIST_MIGRATION_COUNT
  )
    return null;
  const extra = carrying.filter((name) => name > OPTION_SWITCH_LAST_LIST_MIGRATION);
  return (
    `the full-list migrations are frozen at ${OPTION_SWITCH_LAST_LIST_MIGRATION} ` +
    `(${OPTION_SWITCH_LIST_MIGRATION_COUNT} files) and this tree holds ${carrying.length}, newest ${newest ?? 'none'}` +
    (extra.length ? ` (new: ${extra.join(', ')})` : '') +
    `. A full-list follow-up installed after ${OPTION_SWITCH_WHITELIST_MIGRATION} would overwrite the whitelist rows ` +
    `with its literal lists: delete it and register its options instead, ${OPTION_SWITCH_REGISTER_COMMAND}`
  );
}

/**
 * The whitelist-writer calls of one migration, in file order. Throws when the file mentions a writer or the whitelist
 * table in any other way than `SELECT public.fn_ca_horse_option_<writer>(<literals>);` naming the file itself: a
 * migration never writes the whitelist with its own INSERT, UPDATE or DELETE, nor on behalf of another migration.
 */
export function optionSwitchWhitelistCalls(
  file: OptionSwitchMigrationFile
): OptionSwitchWhitelistCall[] {
  const sql = noComments(file.text);
  const self = file.name.replace(/\.sql$/, '');
  const calls: OptionSwitchWhitelistCall[] = [];
  for (const m of sql.matchAll(CALL)) {
    const call: OptionSwitchWhitelistCall = m[1]
      ? {
          fn: 'register',
          option: m[2]!,
          kind: m[3] as OptionSwitchKind,
          offOnly: m[4] === 'true',
          shadow: m[5] as OptionSwitchShadowLevel,
          migration: m[6]!,
        }
      : m[7]
        ? { fn: 'unlock', option: m[8]!, lifts: sortedUnique(quoted(m[9]!)), migration: m[10]! }
        : m[11]
          ? { fn: 'unregister', option: m[12]!, migration: m[13]! }
          : {
              fn: 'allow_shadow',
              option: m[15]!,
              shadow: m[16] as OptionSwitchShadowLevel,
              migration: m[17]!,
            };
    if (call.migration !== self)
      throw new Error(
        `${file.name} calls fn_ca_horse_option_${call.fn} for ${call.option} in the name of ${call.migration}: a migration names itself`
      );
    calls.push(call);
  }
  const mentions = [...sql.matchAll(WRITER_OR_TABLE)].length;
  if (mentions !== calls.length)
    throw new Error(
      `${file.name} touches the option whitelist outside a plain "SELECT public.fn_ca_horse_option_register('<option>', ` +
        `'plain' | 'style', true | false, 'none' | 'on_shadow' | 'shadow', '<this migration>');" call (${mentions} mentions, ${calls.length} such calls): ` +
        `write it with ${OPTION_SWITCH_REGISTER_COMMAND}`
    );
  return calls;
}

/** One call applied to the whitelist, exactly as the database function applies it (and refuses it). */
export function applyOptionSwitchWhitelistCall(
  whitelist: Map<string, OptionSwitchWhitelistRow>,
  call: OptionSwitchWhitelistCall
): void {
  const row = whitelist.get(call.option);
  if (call.fn === 'register') {
    if (call.kind === 'style' && call.offOnly)
      throw new Error(`style option ${call.option} cannot be off-only`);
    if (call.kind === 'style' && call.shadow !== 'none')
      throw new Error(
        `style option ${call.option} has its own shadow arm: its shadow level is none`
      );
    if (call.offOnly && call.shadow !== 'none')
      throw new Error(`off-only option ${call.option} takes off alone: its shadow level is none`);
    if (!row) {
      whitelist.set(call.option, {
        kind: call.kind,
        lockedBy: call.offOnly ? [call.migration] : [],
        shadow: call.shadow,
      });
      return;
    }
    if (row.kind !== call.kind)
      throw new Error(
        `option ${call.option} is registered as ${row.kind} and cannot be registered as ${call.kind}`
      );
    // an off-only hold is only ever added; the shadow level only ever narrows (the lower of the two)
    whitelist.set(call.option, {
      kind: row.kind,
      lockedBy: call.offOnly ? sortedUnique([...row.lockedBy, call.migration]) : row.lockedBy,
      shadow: level(call.shadow) < level(row.shadow) ? call.shadow : row.shadow,
    });
    return;
  }
  if (!row) throw new Error(`option ${call.option} is not registered (${call.migration})`);
  if (call.fn === 'allow_shadow') {
    if (row.kind === 'style')
      throw new Error(
        `style option ${call.option} has its own shadow arm: its shadow level is none`
      );
    if (row.lockedBy.length > 0)
      throw new Error(
        `option ${call.option} is held off-only: lift the hold by name before widening its shadow level`
      );
    if (level(call.shadow) < level(row.shadow))
      throw new Error(
        `option ${call.option} takes ${row.shadow}: a narrower level is a register call, not allow_shadow`
      );
    whitelist.set(call.option, { kind: row.kind, lockedBy: row.lockedBy, shadow: call.shadow });
    return;
  }
  if (call.fn === 'unlock') {
    if (row.lockedBy.length === 0)
      throw new Error(`option ${call.option} is not off-only: there is no hold to lift`);
    if (row.lockedBy.join(' ') !== call.lifts.join(' '))
      throw new Error(
        `option ${call.option} is held off-only by ${row.lockedBy.join(', ')}, and ${call.migration} lifts ` +
          `${call.lifts.join(', ')}: every hold is lifted by name or none is`
      );
    whitelist.set(call.option, { kind: row.kind, lockedBy: [], shadow: row.shadow });
    return;
  }
  if (row.lockedBy.length > 0)
    throw new Error(
      `option ${call.option} is held off-only: lift the hold by name before removing it`
    );
  whitelist.delete(call.option);
}

/**
 * The whitelist a database holds after installing these migrations: the frozen lists, then every writer call. Calls
 * are applied in version order; registering commutes, so only an un-lock, a removal or a wider shadow level can depend
 * on that order, and those are returned in `explicit` ('<migration>:unlock:<option>') for the law to hold against the
 * approved list.
 */
export function optionSwitchWhitelistFromMigrations(files: readonly OptionSwitchMigrationFile[]): {
  readonly whitelist: OptionSwitchWhitelist;
  readonly explicit: readonly string[];
} {
  const refusal = optionSwitchListMigrationsRefusal(files);
  if (refusal) throw new Error(refusal);
  const last = files.find((f) => f.name === OPTION_SWITCH_LAST_LIST_MIGRATION)!;
  const lists = optionSwitchListsOf(last.text);
  const seed = OPTION_SWITCH_WHITELIST_MIGRATION.replace(/\.sql$/, '');
  const whitelist = new Map<string, OptionSwitchWhitelistRow>();
  const offOnly = new Set(lists.offOnly);
  for (const name of lists.style)
    whitelist.set(name, { kind: 'style', lockedBy: [], shadow: 'none' });
  for (const name of lists.plain)
    whitelist.set(name, {
      kind: 'plain',
      lockedBy: offOnly.has(name) ? [seed] : [],
      shadow: listedShadowLevel(lists, name),
    });
  const explicit: string[] = [];
  for (const file of [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (!file.name.endsWith('.sql') || file.name === OPTION_SWITCH_WHITELIST_MIGRATION) continue;
    if (!file.text.includes('ca_horse_option_')) continue;
    for (const call of optionSwitchWhitelistCalls(file)) {
      applyOptionSwitchWhitelistCall(whitelist, call);
      if (call.fn !== 'register') explicit.push(`${call.migration}:${call.fn}:${call.option}`);
    }
  }
  return { whitelist, explicit };
}

/** The whitelist the registry asks for, as rows without their holders: name to [kind, off-only, shadow level]. */
function registryRows(): Map<
  string,
  readonly [OptionSwitchKind, boolean, OptionSwitchShadowLevel]
> {
  const offOnly = new Set(OPTION_SWITCH_OFF_ONLY_NAMES);
  const shadow = new Set(OPTION_SWITCH_SHADOW_NAMES);
  const onShadow = new Set(OPTION_SWITCH_ON_SHADOW_NAMES);
  const rows = new Map<string, readonly [OptionSwitchKind, boolean, OptionSwitchShadowLevel]>();
  for (const name of STYLE_SWITCH_OPTIONS as readonly string[])
    rows.set(name, ['style', false, 'none']);
  for (const name of OPTION_SWITCH_PLAIN_NAMES)
    rows.set(name, [
      'plain',
      offOnly.has(name),
      offOnly.has(name)
        ? 'none'
        : shadow.has(name)
          ? 'shadow'
          : onShadow.has(name)
            ? 'on_shadow'
            : 'none',
    ]);
  return rows;
}

/**
 * The register calls that bring the whitelist to the registry, in registry order: a name the whitelist lacks, an
 * off-only hold it lacks, and a shadow level it must narrow to. It never proposes an un-lock, a removal or a wider
 * shadow level (optionSwitchWhitelistDrift names those; optionSwitchAllowShadowCallsNeeded writes the last).
 */
export function optionSwitchRegisterCallsNeeded(
  whitelist: OptionSwitchWhitelist,
  migration: string
): OptionSwitchWhitelistCall[] {
  const calls: OptionSwitchWhitelistCall[] = [];
  for (const [option, [kind, offOnly, shadow]] of registryRows()) {
    const row = whitelist.get(option);
    if (
      !row ||
      (row.kind === kind &&
        ((offOnly && row.lockedBy.length === 0) ||
          (!offOnly && row.lockedBy.length === 0 && level(shadow) < level(row.shadow))))
    )
      calls.push({ fn: 'register', option, kind, offOnly, shadow, migration });
  }
  return calls;
}

/**
 * The allow_shadow calls the registry asks for: a registered, not held, plain option whose registry level is wider
 * than its row's. Each is explicit and must be listed in OPTION_SWITCH_APPROVED_UNLOCKS.
 */
export function optionSwitchAllowShadowCallsNeeded(
  whitelist: OptionSwitchWhitelist,
  migration: string
): OptionSwitchWhitelistCall[] {
  const calls: OptionSwitchWhitelistCall[] = [];
  for (const [option, [kind, offOnly, shadow]] of registryRows()) {
    const row = whitelist.get(option);
    if (row && row.kind === kind && kind === 'plain' && !offOnly && row.lockedBy.length === 0)
      if (level(shadow) > level(row.shadow))
        calls.push({ fn: 'allow_shadow', option, shadow, migration });
  }
  return calls;
}

/** Null when the whitelist equals the registry, otherwise what differs and the command or call that settles it. */
export function optionSwitchWhitelistDrift(whitelist: OptionSwitchWhitelist): string | null {
  const registry = registryRows();
  const missing: string[] = [];
  const toHold: string[] = [];
  const wrongKind: string[] = [];
  const held: string[] = [];
  const gone: string[] = [];
  const toNarrow: string[] = [];
  const toWiden: string[] = [];
  for (const [option, [kind, offOnly, shadow]] of registry) {
    const row = whitelist.get(option);
    if (!row) missing.push(option);
    else if (row.kind !== kind) wrongKind.push(option);
    else if (offOnly && row.lockedBy.length === 0) toHold.push(option);
    else if (!offOnly && row.lockedBy.length > 0) held.push(option);
    else if (!offOnly && level(shadow) < level(row.shadow))
      toNarrow.push(`${option} (${row.shadow} -> ${shadow})`);
    else if (!offOnly && level(shadow) > level(row.shadow))
      toWiden.push(`${option} (${row.shadow} -> ${shadow})`);
  }
  for (const option of whitelist.keys()) if (!registry.has(option)) gone.push(option);
  const parts: string[] = [];
  if (missing.length) parts.push(`not registered in the database: ${missing.join(', ')}`);
  if (toHold.length)
    parts.push(`off-only in the registry and not held in the database: ${toHold.join(', ')}`);
  if (toNarrow.length)
    parts.push(
      `takes a wider shadow level in the database than in the registry: ${toNarrow.join(', ')}`
    );
  if (missing.length || toHold.length || toNarrow.length)
    parts.push(`RUN ${OPTION_SWITCH_REGISTER_COMMAND}`);
  if (toWiden.length)
    parts.push(
      `takes a NARROWER shadow level in the database than in the registry: ${toWiden.join(', ')}. A wider level ` +
        `is never a side effect of registering something else: the same command with --allow-shadow writes the ` +
        `fn_ca_horse_option_allow_shadow calls, each listed in OPTION_SWITCH_APPROVED_UNLOCKS`
    );
  if (held.length)
    parts.push(
      `HELD OFF-ONLY in the database and offered on by the registry: ${held.join(', ')}. A hold is never lifted by ` +
        `registering something else. If your branch dropped it from OPTION_SWITCH_OFF_ONLY by a stale merge, restore ` +
        `it there. If the owner lifted the hold, call fn_ca_horse_option_unlock in its own migration, naming every ` +
        `holder, and list it in OPTION_SWITCH_APPROVED_UNLOCKS`
    );
  if (gone.length)
    parts.push(
      `registered in the database and gone from the registry: ${gone.join(', ')}. Removing an option is ` +
        `fn_ca_horse_option_unregister in its own migration, listed in OPTION_SWITCH_APPROVED_UNLOCKS`
    );
  if (wrongKind.length)
    parts.push(
      `registered with another kind (style or plain) than the registry has: ${wrongKind.join(', ')}`
    );
  return parts.length
    ? `the option switch whitelist differs from the registry. ${parts.join('. ')}.`
    : null;
}

/** Why `name` cannot be a register migration, or null when it can. */
export function optionSwitchRegisterNameRefusal(name: string): string | null {
  if (!OPTION_SWITCH_MIGRATION_NAME.test(name))
    return `a migration is named <YYYYMMDDHHMMSS>_<snake_case>, without .sql (got "${name}"): reserve one with node scripts/new-migration.mjs`;
  if (`${name}.sql` === OPTION_SWITCH_WHITELIST_MIGRATION)
    return `${name} is the whitelist migration itself`;
  return null;
}

const callSql = (call: OptionSwitchWhitelistCall) =>
  call.fn === 'register'
    ? `SELECT public.fn_ca_horse_option_register('${call.option}', '${call.kind}', ${call.offOnly}, '${call.shadow}', '${call.migration}');`
    : call.fn === 'allow_shadow'
      ? `SELECT public.fn_ca_horse_option_allow_shadow('${call.option}', '${call.shadow}', '${call.migration}');`
      : call.fn === 'unlock'
        ? `SELECT public.fn_ca_horse_option_unlock('${call.option}', ARRAY[${call.lifts.map((l) => `'${l}'`).join(', ')}], '${call.migration}');`
        : `SELECT public.fn_ca_horse_option_unregister('${call.option}', '${call.migration}');`;

/**
 * The live proof of a register migration (tests/a-merged-migration-must-be-live.law.test.ts): it creates no object,
 * so it states the boolean a reader runs to see it installed: every option it names has its whitelist row, and every
 * option it holds off-only is held. A later register migration can only narrow a shadow level or add a hold, never
 * remove a row or a hold without an approved migration of its own, so the proof stays true once installed.
 */
export function optionSwitchRegisterLiveProof(calls: readonly OptionSwitchWhitelistCall[]): string {
  const quoted = (names: readonly string[]) => names.map((n) => `'${n}'`).join(', ');
  const options = [...new Set(calls.map((c) => c.option))].sort();
  const held = [
    ...new Set(calls.filter((c) => c.fn === 'register' && c.offOnly).map((c) => c.option)),
  ].sort();
  const rows = `(SELECT count(*) FROM public.ca_horse_option_whitelist WHERE option IN (${quoted(options)})) = ${options.length}`;
  return held.length === 0
    ? rows
    : `(${rows} AND (SELECT count(*) FROM public.ca_horse_option_whitelist WHERE off_only AND option IN (${quoted(held)})) = ${held.length})`;
}

/**
 * A register migration: one call per option, in one transaction. It creates nothing and switches nothing, and two of
 * them give the same whitelist in either install order.
 */
export function optionSwitchRegisterSql(
  name: string,
  calls: readonly OptionSwitchWhitelistCall[]
): string {
  if (calls.length === 0) throw new Error('a register migration registers at least one option');
  for (const call of calls)
    if ((call.fn !== 'register' && call.fn !== 'allow_shadow') || call.migration !== name)
      throw new Error(`${name} holds register (and allow_shadow) calls of its own only`);
  const held = calls.filter((c) => c.fn === 'register' && c.offOnly).length;
  return `-- ${name}.sql
-- @live-proof: ${optionSwitchRegisterLiveProof(calls)}
--
-- HORSE OPTION SWITCH: ${calls.length} OPTION${calls.length === 1 ? '' : 'S'} REGISTERED${held ? ` (${held} OFF-ONLY)` : ''}
--
-- Generated by server/scripts/gen-horse-option-switch-sql.ts --register from the engine registry
-- (server/src/engine/HorseOptionSwitch.ts, derived from HORSE_DATA_LEDGER). The database whitelist is the rows of
-- public.ca_horse_option_whitelist (${OPTION_SWITCH_WHITELIST_MIGRATION}); this file adds the rows, or the
-- off-only holds, the registry has and the whitelist lacks. everyUpgradeHasALiveSwitch.law.test.ts requires the
-- whitelist of all migrations together to equal OPTION_SWITCH_REGISTRY.
--
-- WHAT IT DOES: one fn_ca_horse_option_register call per option. A new option gets its row; an option already
-- registered can only gain an off-only hold (false never lifts one) or a NARROWER shadow level (the lower of the
-- two; a wider one is fn_ca_horse_option_allow_shadow, by name). It adds no table, column, function or switch
-- row and switches nothing; running it twice leaves the same state. Registering an option ENABLES NOTHING: no
-- switch row is the release default.
--
-- ORDER DOES NOT MATTER: this file and any other register migration give the same whitelist whichever installs
-- first, so it is never regenerated because another pull request merged.
--
-- IT NEVER FIXES DATA: holding an option off-only while its switch row is not 'off', or narrowing its shadow level
-- while its row is in a state it would lose, raises and installs nothing. Set that
-- row off or clear it first with fn_ca_horse_option_switch_set / fn_ca_horse_option_switch_clear (audited).
--
-- COST: one primary-key write per option on the whitelist table; each call takes SHARE ROW EXCLUSIVE on
-- the switch table (one row per switched option, read once per 30 seconds; reads are not blocked). No DDL.
BEGIN;

-- One attempt, no retry.
SET LOCAL lock_timeout = '3s';

${calls.map(callSql).join('\n')}

COMMIT;
`;
}

/**
 * Why a migration that calls the whitelist writers is not a plain register migration, or null: one transaction, the
 * lock timeout, the calls and nothing else. (An approved un-lock or removal has the same shape, with its call.)
 */
export function optionSwitchRegisterMigrationRefusal(
  file: OptionSwitchMigrationFile
): string | null {
  let calls: OptionSwitchWhitelistCall[];
  try {
    calls = optionSwitchWhitelistCalls(file);
  } catch (error) {
    return (error as Error).message;
  }
  if (calls.length === 0) return null;
  const shape = `BEGIN; SET LOCAL lock_timeout = '3s'; ${calls.map(callSql).join(' ')} COMMIT;`;
  const actual = noComments(file.text).replace(/\s+/g, ' ').trim();
  return actual === shape
    ? null
    : `${file.name} calls a whitelist writer and holds something else: a register migration is BEGIN, ` +
        `SET LOCAL lock_timeout = '3s', its calls and COMMIT (write it with ${OPTION_SWITCH_REGISTER_COMMAND})`;
}
