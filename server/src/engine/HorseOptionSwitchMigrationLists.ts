/**
 * THE DATABASE NAME LISTS OF THE OPTION SWITCH, AND HOW THEY CHANGE AFTER INSTALL (2026-11-15, Hold'em Strategy,
 * registry writer).
 *
 * The engine registry (HorseOptionSwitch.ts, derived from HORSE_DATA_LEDGER) and the database whitelist of the switch
 * (the CHECK constraints of public.ca_horse_style_switch and public.fn_ca_horse_option_switch_states) must name the
 * same options. Migration 20261114072215 wrote the first lists. Once it is installed its bytes never change again (an
 * installed migration and its file agree), so a later change to the registry (an option added to or removed from the
 * ledger, or moved to OPTION_SWITCH_OFF_ONLY) ships as a NEW migration that re-asserts the lists: a FOLLOW-UP.
 *
 * THE RULE: the database whitelist is the NEWEST migration under supabase/migrations (by its version prefix) that
 * carries the `-- registry:plain-options:begin` marker. everyUpgradeHasALiveSwitch.law.test.ts compares that file to
 * the registry, and server/scripts/gen-horse-option-switch-sql.ts writes follow-ups. This module holds the pure parts
 * both use: the marker rewrite, the follow-up text, the choice of the newest list migration, the drift message and
 * the in-place rewrite refusal. It reads no file and touches no database.
 *
 * TO REGISTER A NEW OPTION AFTER THE SWITCH IS INSTALLED (one command, one new file), from server/:
 *   npx tsx scripts/gen-horse-option-switch-sql.ts --follow-up <YYYYMMDDHHMMSS>_horse_option_switch_<what>
 * It writes supabase/migrations/<that name>.sql and updates the option lists of the PostgreSQL proof script.
 */
import {
  OPTION_SWITCH_OFF_ONLY_NAMES,
  OPTION_SWITCH_ON_SHADOW_NAMES,
  OPTION_SWITCH_PLAIN_NAMES,
  OPTION_SWITCH_SHADOW_NAMES,
} from './HorseOptionSwitch.js';
import { STYLE_SWITCH_OPTIONS } from './HorseStyleSwitch.js';

/** The first list migration. Installed: the tool never rewrites it. */
export const OPTION_SWITCH_BASE_MIGRATION =
  'supabase/migrations/20261114072215_every_horse_upgrade_has_a_live_switch.sql';
export const OPTION_SWITCH_MIGRATIONS_DIR = 'supabase/migrations';
/** A migration carrying this marker holds a full set of the switch's name lists. */
export const OPTION_SWITCH_LIST_MARKER = '-- registry:plain-options:begin';
/** The proof script whose option lists must equal the registry (everyUpgradeHasALiveSwitch.law.test.ts). */
export const OPTION_SWITCH_PROOF_SCRIPT =
  'scripts/ci/test-horse-option-switch-evidence-postgres.sh';
/** A follow-up's name: the 14-digit version and a snake_case name, no extension. */
/** The dollar-quote character of the generated SQL, spelled so no rendered text holds it (check-ui-dollar). */
const Q = String.fromCharCode(36);
export const OPTION_SWITCH_FOLLOW_UP_NAME = /^(\d{14})_[a-z0-9]+(?:_[a-z0-9]+)*$/;
/** What a lane runs when the lists differ from the registry. */
export const OPTION_SWITCH_FOLLOW_UP_COMMAND =
  'npx tsx scripts/gen-horse-option-switch-sql.ts --follow-up <YYYYMMDDHHMMSS>_horse_option_switch_<what>';

/**
 * A SWITCH LIST IS NEVER STALE (2026-11-20, aSwitchListIsNeverStale.law.test.ts).
 *
 * Every list migration REPLACES the database's allowed-state lists wholesale. A lane that branched before another
 * lane's list migration merged regenerates a file that is internally consistent with its own tree and still carries
 * the OLD lists for every option the other lane changed (PR #11545 would have re-held huBbDefendsUnreadToPrice,
 * lifted by 20261120210905). Three guards make that impossible to land quietly:
 *
 * 1. THE CHAIN. Every list migration after OPTION_SWITCH_CHAIN_ANCHOR names, on one `-- registry:follows: <file>`
 *    line, the list migration it was generated after, and that must be the list migration immediately before it by
 *    version. Two lanes generated from the same predecessor, or a lane whose file sorts on either side of a newer
 *    list it never saw, break the chain in any tree holding both files: the PR's merge-group tree, main after the
 *    merge, and every later branch.
 * 2. MAIN. On a pull request (head checkout, non-strict required checks), a list migration the branch adds must be
 *    newer than every list migration on origin/main, and the branch must hold main's newest list migration.
 * 3. THE DATABASE. A follow-up stamps its version into fn_ca_horse_option_switch_states and refuses to install over
 *    a newer stamp, so an older list never replaces a newer one whatever order the applier runs them in.
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
/** The comment inside fn_ca_horse_option_switch_states that records which list migration wrote it. */
export const OPTION_SWITCH_VERSION_STAMP = 'registry-lists-version: ';

/** What the author of a stale list migration does, in the order they do it. */
export function optionSwitchStaleRemedy(own: string, newest: string): string {
  return (
    `To fix: (1) bring main into your branch (git fetch origin main, then rebase onto origin/main or merge it); ` +
    `(2) delete your list migration ${own} (it was generated from lists main no longer has; never installed, so ` +
    `deleting it is safe); (3) from server/, regenerate it with "npx tsx scripts/gen-horse-option-switch-sql.ts ` +
    `--follow-up <a version later than ${newest}>_horse_option_switch_<what>" (node scripts/new-migration.mjs ` +
    `gives a free version), which re-reads the merged registry, writes the follows line and updates ` +
    `${OPTION_SWITCH_PROOF_SCRIPT}`
  );
}

const versionOf = (name: string): string => /(\d{14})_/.exec(name)?.[1] ?? '';
const baseName = (name: string): string => name.replace(/^.*\//, '').replace(/\.sql$/, '');

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
 * Null when the list migrations of a tree form one unbroken chain after the anchor, otherwise what is wrong and the
 * remedy. `files` is every migration of the tree (non-list files are ignored).
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
        `list installed after it: regenerate it with --follow-up`
      );
    if (!file.text.includes(`'${OPTION_SWITCH_VERSION_STAMP}([0-9]{14})'`))
      return `the switch list migration ${path} lacks the refusal of an older list: regenerate it with --follow-up`;
  }
  return null;
}

/**
 * Null when the list migrations a branch adds (in `tree`, not on main) are newer than every list migration on main
 * and the branch holds main's newest list migration; otherwise what is wrong and the remedy. Names may be paths or
 * bare file names; only list migrations are passed.
 */
export function optionSwitchStaleAgainstMain(
  treeLists: readonly string[],
  mainLists: readonly string[]
): string | null {
  const tree = new Set(treeLists.map(baseName));
  const main = [...new Set(mainLists.map(baseName))].sort();
  const added = [...tree].filter((n) => !main.includes(n)).sort();
  const mainNewest = main[main.length - 1];
  if (added.length === 0 || !mainNewest) return null;
  const own = `${OPTION_SWITCH_MIGRATIONS_DIR}/${added[added.length - 1]}.sql`;
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

/** The migration with its follows line set to `follows` (added under the first line when it has none). */
export function withFollowsLine(sql: string, follows: string): string {
  const line = `${OPTION_SWITCH_FOLLOWS_PREFIX}${baseName(follows)}`;
  if (/^-- registry:follows: .*$/m.test(sql))
    return sql.replace(/^-- registry:follows: .*$/m, line);
  const nl = sql.indexOf('\n');
  return `${sql.slice(0, nl + 1)}${line}\n${sql.slice(nl + 1)}`;
}

type ListName =
  'style-options' | 'plain-options' | 'off-only-options' | 'shadow-options' | 'on-shadow-options';
const LISTS: readonly (readonly [ListName, () => readonly string[]])[] = [
  ['style-options', () => STYLE_SWITCH_OPTIONS as readonly string[]],
  ['plain-options', () => OPTION_SWITCH_PLAIN_NAMES],
  ['off-only-options', () => OPTION_SWITCH_OFF_ONLY_NAMES],
  // 2026-11-18: the non-style options that take shadow (a worker re-decision, HorseOptionShadow.ts)
  ['shadow-options', () => OPTION_SWITCH_SHADOW_NAMES],
  // 2026-11-19: the non-style options that take on_shadow (acted true as on, re-decided false; HorseOptionSwitch.ts)
  ['on-shadow-options', () => OPTION_SWITCH_ON_SHADOW_NAMES],
];
/**
 * The migration every follow-up that carries the shadow list installs after: it makes the switch functions tell the
 * style options by canary, so a non-style option in shadow keeps every rule of `on` (2026-11-18).
 */
export const OPTION_SWITCH_STYLE_BY_NAME_MIGRATION_SUFFIX =
  '_the_horse_option_switch_tells_style_options_by_name.sql';
/**
 * The migration every follow-up that carries the on_shadow list installs after (2026-11-19): it gives on_shadow every
 * rule of `on` in the set function (own citation, recorded evidence, the serving-registry guard), lets the publish
 * accept on_shadow and widens the table's state check.
 */
export const OPTION_SWITCH_ON_SHADOW_RULES_MIGRATION_SUFFIX =
  '_the_horse_option_switch_on_shadow_keeps_every_rule_of_on.sql';

/** The names as SQL string literals, comma separated, wrapped under 100 columns with a four space indent. */
export function sqlNameList(names: readonly string[]): string {
  const lines: string[] = [];
  let line = '   ';
  for (const [i, name] of names.entries()) {
    const item = ` '${name}'${i < names.length - 1 ? ',' : ''}`;
    if (line.length + item.length > 100 && line.trim() !== '') {
      lines.push(line);
      line = '   ';
    }
    line += item;
  }
  if (line.trim() !== '') lines.push(line);
  return lines.join('\n');
}

/** The migration text with every marked list replaced by the registry's names. */
export function withRegistryLists(sql: string): string {
  let out = sql;
  for (const [marker, names] of LISTS) {
    const block = new RegExp(
      `(-- registry:${marker}:begin\\n)[\\s\\S]*?(\\n[ \\t]*-- registry:${marker}:end)`,
      'g'
    );
    if (!block.test(out)) throw new Error(`the migration has no registry:${marker} markers`);
    out = out.replace(
      block,
      (_all, begin: string, end: string) => begin + sqlNameList(names()) + end
    );
  }
  return out;
}

/** The marker-bearing migration the database whitelist is read from: the newest by version (file name order). */
export function newestOptionSwitchListMigration(
  files: readonly { readonly name: string; readonly text: string }[]
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

/** The message every list check gives when the newest list migration differs from the registry. */
export function optionSwitchListDriftMessage(listPath: string): string {
  return (
    `the option switch lists of ${listPath} differ from the registry. Do not edit an installed migration: ` +
    `run "${OPTION_SWITCH_FOLLOW_UP_COMMAND}" in server/ (a new migration re-asserting the lists; it also updates ` +
    `the lists of ${OPTION_SWITCH_PROOF_SCRIPT})`
  );
}

/** Null when the list migration's marked lists already equal the registry, otherwise the drift message. */
export function optionSwitchListDrift(listPath: string, listSql: string): string | null {
  let rewritten: string;
  try {
    rewritten = withRegistryLists(listSql);
  } catch {
    // a list migration written before a list existed (the shadow list, 2026-11-18) lacks its markers: that is drift
    return optionSwitchListDriftMessage(listPath);
  }
  return rewritten === listSql ? null : optionSwitchListDriftMessage(listPath);
}

/**
 * Why the tool must NOT rewrite `target` in place, or null when it may. It may rewrite only the newest list migration,
 * only when that is not the base migration, and only when protected main does not hold that file yet (a lane
 * regenerating its own unmerged follow-up after merging main). Anything on main is, or is about to be, installed.
 */
export function optionSwitchRewriteRefusal(
  target: string,
  newest: string,
  onMain: boolean
): string | null {
  if (target === OPTION_SWITCH_BASE_MIGRATION)
    return `${OPTION_SWITCH_BASE_MIGRATION} is installed and is never rewritten: write a follow-up with --follow-up`;
  if (target !== newest)
    return `${target} is not the newest list migration (${newest}): only the newest one is the whitelist`;
  if (onMain)
    return `${target} is on main (installed or about to be): write a new follow-up with --follow-up`;
  return null;
}

/** Why `name` cannot be a new follow-up after `newest`, or null when it can. */
export function optionSwitchFollowUpRefusal(name: string, newest: string): string | null {
  const m = OPTION_SWITCH_FOLLOW_UP_NAME.exec(name);
  if (!m) return `a follow-up is named <YYYYMMDDHHMMSS>_<snake_case>, without .sql (got "${name}")`;
  const newestVersion = /\/(\d{14})_/.exec(newest)?.[1] ?? '';
  if (!(m[1]! > newestVersion))
    return `the follow-up version ${m[1]} must be later than the newest list migration ${newest}, so that it becomes the whitelist`;
  return null;
}

/** The proof script with its style, plain, off-only, shadow and on_shadow lists set to the registry (refused is kept). */
export function proofScriptWithRegistryLists(script: string): string {
  let out = script;
  for (const [variable, names] of [
    ['style', STYLE_SWITCH_OPTIONS as readonly string[]],
    ['plain', OPTION_SWITCH_PLAIN_NAMES],
    ['offonly', OPTION_SWITCH_OFF_ONLY_NAMES],
    ['shadow', OPTION_SWITCH_SHADOW_NAMES],
    ['onshadow', OPTION_SWITCH_ON_SHADOW_NAMES],
  ] as const) {
    const line = new RegExp(`^${variable}='[^']*'$`, 'm');
    if (!line.test(out)) throw new Error(`the proof script has no ${variable}='...' line`);
    out = out.replace(line, `${variable}='${names.join(' ')}'`);
  }
  return out;
}

/**
 * A follow-up migration: the three CHECK constraints of public.ca_horse_style_switch and
 * public.fn_ca_horse_option_switch_states re-asserted with the registry's current lists, in one transaction. The
 * constraint and function texts are the base migration's, unchanged but for the lists (the law reads them by shape).
 * Idempotent: DROP CONSTRAINT IF EXISTS then ADD, CREATE OR REPLACE. It never fixes data: a row that breaks the new
 * lists stops the install with a named error before anything changes.
 */
export function optionSwitchFollowUpSql(name: string, follows?: string): string {
  const version = versionOf(name);
  // Each list is an empty line between its markers: withRegistryLists replaces what lies between a begin line and the
  // next "\n<indent>-- registry:<list>:end", so an empty list needs its own line (or the match would run on to the
  // next block's end marker).
  const template = `-- HORSE OPTION SWITCH: THE REGISTERED NAMES, RE-ASSERTED (${name}; follow-up of 20261114072215)
${follows ? `${OPTION_SWITCH_FOLLOWS_PREFIX}${baseName(follows)}\n` : ''}--
-- Generated by server/scripts/gen-horse-option-switch-sql.ts --follow-up from the engine registry
-- (server/src/engine/HorseOptionSwitch.ts, derived from HORSE_DATA_LEDGER). The installed switch migrations are never
-- edited; the NEWEST migration carrying the registry markers is the database whitelist
-- (server/src/engine/HorseOptionSwitchMigrationLists.ts), and everyUpgradeHasALiveSwitch.law.test.ts compares it to
-- OPTION_SWITCH_REGISTRY.
--
-- WHAT IT DOES: re-asserts the three CHECK constraints of public.ca_horse_style_switch (an option is registered; on
-- for a non-style option cites its own authority; canary only for the style options, shadow only for the style
-- options and the listed shadow options, on_shadow only for the listed on_shadow options, on and on_shadow never for
-- an off-only option) and public.fn_ca_horse_option_switch_states with the registry's current lists. A shadow option
-- passes nothing to the engine's decision (the release default acts); an on_shadow option passes true (exactly as
-- on, and it cites its own authority exactly as on); the engine re-decides either once flipped and records the
-- counterfactual, never acting on it (HorseOptionShadow.ts). Same table, same functions, same grants. It adds no
-- table, column or row and switches nothing; running it twice leaves the same
-- state. Registering an option ENABLES NOTHING: no row is the release default.
--
-- IT NEVER FIXES DATA. If a row already in the table would break the new lists (an option the registry no longer
-- has, or on for an option that is now off-only), it raises and installs nothing. Clear or turn off that row first
-- with fn_ca_horse_option_switch_set / fn_ca_horse_option_switch_clear (audited), then install.
--
-- COST: three ALTERs on a table of one row per switched option, read once per 30 seconds; no live table is touched.
BEGIN;

-- One attempt, no retry: the ALTERs below take ACCESS EXCLUSIVE on a table read every 30 seconds.
SET LOCAL lock_timeout = '3s';

-- Every row already written fits the new lists, or nothing changes.
DO ${Q}existing_rows_fit${Q}
DECLARE
  r record;
BEGIN
  -- A list migration never installs over a newer one (2026-11-20): each follow-up stamps its version into
  -- fn_ca_horse_option_switch_states, and an older list installed after a newer one would put back older allowed
  -- states. This file is then superseded: never force it; delete it from main if it was never installed.
  IF substring((SELECT p.prosrc FROM pg_proc p WHERE p.oid = 'public.fn_ca_horse_option_switch_states(text)'::regprocedure)
       FROM '${OPTION_SWITCH_VERSION_STAMP}([0-9]{14})') > '${version}' THEN
    RAISE EXCEPTION 'switch list migration ${version} is older than the installed list %: it is superseded and installing it would put back older allowed states',
      substring((SELECT p.prosrc FROM pg_proc p WHERE p.oid = 'public.fn_ca_horse_option_switch_states(text)'::regprocedure)
        FROM '${OPTION_SWITCH_VERSION_STAMP}([0-9]{14})');
  END IF;
  -- A shadow option keeps every rule of 'on' only when the switch functions tell the style options by canary
  -- (*${OPTION_SWITCH_STYLE_BY_NAME_MIGRATION_SUFFIX}); refuse to install before that file.
  IF position('''shadow'' = ANY' IN pg_get_functiondef('public.fn_ca_horse_option_switch_set(text, text, text, text)'::regprocedure)) > 0
     OR position('ARRAY[''shadow'']' IN pg_get_functiondef('public.fn_ca_horse_style_switch_effective()'::regprocedure)) > 0
     OR position('ARRAY[''shadow'']' IN pg_get_functiondef('public.fn_ca_horse_option_switch_effective()'::regprocedure)) > 0 THEN
    RAISE EXCEPTION 'the switch functions still tell the style options by shadow: install *${OPTION_SWITCH_STYLE_BY_NAME_MIGRATION_SUFFIX} first';
  END IF;
  -- An on_shadow option keeps every rule of 'on' only when the set function and the registry publish know on_shadow
  -- (*${OPTION_SWITCH_ON_SHADOW_RULES_MIGRATION_SUFFIX}); refuse to install before that file.
  IF position('''on_shadow''' IN pg_get_functiondef('public.fn_ca_horse_option_switch_set(text, text, text, text)'::regprocedure)) = 0
     OR position('''on_shadow''' IN pg_get_functiondef('public.fn_ca_horse_option_registry_publish(text, jsonb, text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'the switch functions do not know on_shadow: install *${OPTION_SWITCH_ON_SHADOW_RULES_MIGRATION_SUFFIX} first';
  END IF;
  FOR r IN SELECT s.option, s.state FROM public.ca_horse_style_switch s ORDER BY s.option LOOP
    IF NOT (r.option IN (
    -- registry:style-options:begin

    -- registry:style-options:end
    ) OR r.option IN (
    -- registry:plain-options:begin

    -- registry:plain-options:end
    )) THEN
      RAISE EXCEPTION 'switch row % (state %) names an option the registry no longer has: clear it before this migration',
        r.option, r.state;
    END IF;
    IF r.state IN ('on', 'on_shadow') AND r.option IN (
    -- registry:off-only-options:begin

    -- registry:off-only-options:end
    ) THEN
      RAISE EXCEPTION 'switch row % is % and the option is now off-only: set it off or clear it before this migration',
        r.option, r.state;
    END IF;
    IF r.state = 'on_shadow' AND NOT (r.option IN (
    -- registry:on-shadow-options:begin

    -- registry:on-shadow-options:end
    )) THEN
      RAISE EXCEPTION 'switch row % is on_shadow and the option no longer takes it: set it on or off, or clear it, before this migration',
        r.option;
    END IF;
    IF r.state IN ('shadow', 'canary') AND NOT (r.option IN (
    -- registry:style-options:begin

    -- registry:style-options:end
    )) AND NOT (r.state = 'shadow' AND r.option IN (
    -- registry:shadow-options:begin

    -- registry:shadow-options:end
    )) THEN
      RAISE EXCEPTION 'switch row % is % and the option no longer takes it: set it off or clear it before this migration',
        r.option, r.state;
    END IF;
  END LOOP;
END
${Q}existing_rows_fit${Q};

ALTER TABLE public.ca_horse_style_switch
  DROP CONSTRAINT IF EXISTS ca_horse_style_switch_option_is_registered,
  ADD CONSTRAINT ca_horse_style_switch_option_is_registered CHECK (
    option IN (
    -- registry:style-options:begin

    -- registry:style-options:end
    )
    OR option IN (
    -- registry:plain-options:begin

    -- registry:plain-options:end
    ));

-- 'on' and 'on_shadow' (which acts as on) for a non-style option carry the option's OWN citation in the note, from
-- any writer: 'authority: <option> <file> sha256 <64 lowercase hex>'.
ALTER TABLE public.ca_horse_style_switch
  DROP CONSTRAINT IF EXISTS ca_horse_style_switch_on_cites_authority,
  ADD CONSTRAINT ca_horse_style_switch_on_cites_authority CHECK (
    state NOT IN ('on', 'on_shadow')
    OR option IN (
    -- registry:style-options:begin

    -- registry:style-options:end
    )
    OR (note IS NOT NULL AND note LIKE 'authority: ' || option || ' %' AND note ~ 'sha256 [0-9a-f]{64}')
  );

-- Canary only where the engine has a shadow arm: the seven style options. Shadow for them and for the listed shadow
-- options (re-decided flipped by the engine, never acted on); on_shadow for the listed on_shadow options only (never a
-- style or off-only option). 'on' never for an off-only option (an owner hold, a measured harm, a superseded option),
-- from any writer.
ALTER TABLE public.ca_horse_style_switch
  DROP CONSTRAINT IF EXISTS ca_horse_style_switch_state_fits_option,
  ADD CONSTRAINT ca_horse_style_switch_state_fits_option CHECK (
    state = 'off'
    OR (state = 'on' AND option NOT IN (
    -- registry:off-only-options:begin

    -- registry:off-only-options:end
    ))
    OR (state = 'shadow' AND option IN (
    -- registry:shadow-options:begin

    -- registry:shadow-options:end
    ))
    OR (state = 'on_shadow' AND option IN (
    -- registry:on-shadow-options:begin

    -- registry:on-shadow-options:end
    ))
    OR (state <> 'on_shadow' AND option IN (
    -- registry:style-options:begin

    -- registry:style-options:end
    )));

-- The states an option may be set to; NULL for an option that is not registered.
CREATE OR REPLACE FUNCTION public.fn_ca_horse_option_switch_states(p_option text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS ${Q}function${Q}
  -- ${OPTION_SWITCH_VERSION_STAMP}${version}
  SELECT CASE
    WHEN p_option IN (
    -- registry:style-options:begin

    -- registry:style-options:end
    )
      THEN ARRAY['off', 'shadow', 'canary', 'on']
    WHEN p_option IN (
    -- registry:off-only-options:begin

    -- registry:off-only-options:end
    )
      THEN ARRAY['off']
    WHEN p_option IN (
    -- registry:shadow-options:begin

    -- registry:shadow-options:end
    )
      THEN ARRAY['off', 'shadow', 'on_shadow', 'on']
    WHEN p_option IN (
    -- registry:on-shadow-options:begin

    -- registry:on-shadow-options:end
    )
      THEN ARRAY['off', 'on_shadow', 'on']
    WHEN p_option IN (
    -- registry:plain-options:begin

    -- registry:plain-options:end
    )
      THEN ARRAY['off', 'on']
    ELSE NULL
  END;
${Q}function${Q};

REVOKE ALL ON FUNCTION public.fn_ca_horse_option_switch_states(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_horse_option_switch_states(text) TO service_role;

-- Read back: every registered option answers its states, anything else NULL, and no browser role reaches it.
DO ${Q}readback${Q}
BEGIN
  IF EXISTS (
       SELECT 1 FROM unnest(ARRAY[
    -- registry:style-options:begin

    -- registry:style-options:end
       ]::text[]) AS n
       WHERE public.fn_ca_horse_option_switch_states(n) IS DISTINCT FROM ARRAY['off', 'shadow', 'canary', 'on'])
     OR EXISTS (
       SELECT 1 FROM unnest(ARRAY[
    -- registry:off-only-options:begin

    -- registry:off-only-options:end
       ]::text[]) AS n
       WHERE public.fn_ca_horse_option_switch_states(n) IS DISTINCT FROM ARRAY['off'])
     OR EXISTS (
       SELECT 1 FROM unnest(ARRAY[
    -- registry:shadow-options:begin

    -- registry:shadow-options:end
       ]::text[]) AS n
       WHERE public.fn_ca_horse_option_switch_states(n) IS DISTINCT FROM ARRAY['off', 'shadow', 'on_shadow', 'on'])
     OR EXISTS (
       SELECT 1 FROM unnest(ARRAY[
    -- registry:on-shadow-options:begin

    -- registry:on-shadow-options:end
       ]::text[]) AS n
       WHERE NOT (public.fn_ca_horse_option_switch_states(n) @> ARRAY['off', 'on_shadow', 'on']))
     OR EXISTS (
       SELECT 1 FROM unnest(ARRAY[
    -- registry:plain-options:begin

    -- registry:plain-options:end
       ]::text[]) AS n
       WHERE public.fn_ca_horse_option_switch_states(n) IS NULL) THEN
    RAISE EXCEPTION 'a registered option does not answer with its states';
  END IF;
  IF public.fn_ca_horse_option_switch_states('notAnOption') IS NOT NULL
     OR public.fn_ca_horse_option_switch_states(NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'an unregistered name is switchable';
  END IF;
  IF has_function_privilege('anon', 'public.fn_ca_horse_option_switch_states(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_ca_horse_option_switch_states(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'a browser role can reach the option switch';
  END IF;
END
${Q}readback${Q};

COMMIT;
`;
  return withRegistryLists(template);
}
