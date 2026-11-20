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

type ListName =
  | 'style-options'
  | 'plain-options'
  | 'off-only-options'
  | 'shadow-options'
  | 'on-shadow-options';
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
export function optionSwitchFollowUpSql(name: string): string {
  // Each list is an empty line between its markers: withRegistryLists replaces what lies between a begin line and the
  // next "\n<indent>-- registry:<list>:end", so an empty list needs its own line (or the match would run on to the
  // next block's end marker).
  const template = `-- HORSE OPTION SWITCH: THE REGISTERED NAMES, RE-ASSERTED (${name}; follow-up of 20261114072215)
--
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
