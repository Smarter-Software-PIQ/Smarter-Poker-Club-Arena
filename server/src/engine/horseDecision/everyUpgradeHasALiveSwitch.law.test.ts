/**
 * LAW: EVERY DECISION UPGRADE HAS A LIVE SWITCH, AND THE SWITCH DOES ONLY WHAT IT IS REGISTERED TO DO (2026-11-14).
 *
 * The option switch (HorseOptionSwitch.ts, migration 20261114072215) widens the style read switch to every
 * registered decision option. This law holds the eight conditions it was accepted on:
 *
 *   1. AUTHORITY. A switch never reaches an option an authority or the upgrade manifest owns: no registered name is
 *      an authority-gated flag, the worker-owned keys are written after the switched ones in every decision, and the
 *      upgrade activation manifest is the same whatever is switched.
 *   2. FLEET-WIDE. No Horse, lane, club or table is read anywhere between the table and the brain.
 *   3. READABLE AND AUDITED. The effective state has a read function; set and clear each write the audit table with
 *      the actor and the time.
 *   4. EMPTY = RELEASE DEFAULT. With nothing switched a real decision is handed exactly the options it was handed
 *      before this existed; off passes false and on passes true for every registered option. An unknown or refused
 *      option is refused by the database function and by the worker.
 *   5. WHO MAY WRITE. service_role only; SECURITY DEFINER with a pinned search_path.
 *   6. FAILURE. Nothing delivered, unreadable, invalid or malformed all leave every option at its release default,
 *      and a real decision still completes.
 *   7. REPLAY. A decision replays with the switched set its own record carries, never the live one.
 *   8. THE DATABASE WHITELIST IS THE ENGINE REGISTRY, and the schema manifest names the functions the migration adds.
 *
 * THE OWNER ORDER OF 2026-11-14 22:01 CHICAGO (OWNER-MESSAGE-20261114-2201CT-EVERY-FEATURE-ON-WITH-SWITCH.md, sha256
 * 2080c2026d5553e11ac288a74fcef51d20f81b30c0a9da446b5063a9f7196bf1) replaces HA-10878-1's evidence-file rule FOR THE
 * SWITCH: "EVERY SINGLE FUNCTION FEATURE, SKILL ETC ... HAS AN ON OFF SWITCH". So the registry is exactly the on/off
 * options of the data ledger minus the refused names; `on` is accepted by the engine for every registered option and
 * by the database when the note cites the authority (proven on a real PostgreSQL 17 by
 * scripts/ci/test-horse-option-switch-evidence-postgres.sh); an option under an owner hold or measured harmful is
 * registered; and a started, restarted or replaced worker resolves the persisted
 * switch state before it serves a decision that reads a switched option. Nothing here enables an option, and nothing
 * here is described as passing promotion evidence (the source-default law HorseDefaultOnNeedsEvidence is untouched).
 *
 * THE OWNER RULING OF 2026-11-14 23:10 CHICAGO: "Preserve approved OFF states. No automatic blanket switch-on after
 * sealing." So holds are ENFORCED: an option in OPTION_SWITCH_OFF_ONLY (owner hold, measured harm, superseded) offers
 * off only at the registry, the parser, the decision options and the database (states function, table CHECK, setter),
 * and `on` for every other option needs the option's OWN citation (authority: <option> <file> sha256 <64 hex>).
 *
 * WHEN THIS LAW FAILS ON THE DATABASE WHITELIST: the whitelist is the rows of public.ca_horse_option_whitelist, that
 * is the frozen lists of the last full-list migration plus every fn_ca_horse_option_register call of every migration
 * (HorseOptionSwitchMigrationLists.ts). Reserve a migration with `node scripts/new-migration.mjs "horse option
 * register <what>"` and fill it with `npx tsx scripts/gen-horse-option-switch-sql.ts --register <that file>` in
 * server/: it holds only your own options, and never needs regenerating because another pull request merged.
 *
 * The decisions are real: HorseDecisionWorkerRuntime DECIDE_FAST through runtime.receive with the real
 * HorseLogic.decide underneath (the harness of styleSwitchRuntime.law.test.ts). The database half is read from the
 * migration source; the migration's own read-back block runs the same refusals where it is installed.
 */
import { performance } from 'node:perf_hooks';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HORSE_DATA_LEDGER } from '../HorseDataLedger.js';
import { HorseLogic } from '../HorseLogic.js';
import { HorseMind } from '../HorseMind.js';
import { seedFastRandom } from '../HorseEval.js';
import { HORSE_FEATURE_FLAGS } from '../HorseFeatureAuthority.js';
import { STYLE_SWITCH_OPTIONS, StyleSwitchHolder } from '../HorseStyleSwitch.js';
import {
  assertOptionSwitchRegistry,
  OPTION_SWITCH_OFF_ONLY,
  OPTION_SWITCH_OFF_ONLY_NAMES,
  OPTION_SWITCH_OFF_ONLY_PENDING,
  OPTION_SWITCH_ON_AUTHORITY_FILE,
  OPTION_SWITCH_ON_AUTHORITY_SHA256,
  OPTION_SWITCH_ON_OFF_NAMES,
  optionSwitchOffOnly,
  optionSwitchOnNote,
  optionSwitchOnNoteCites,
  OPTION_SWITCH_NAMES,
  OPTION_SWITCH_NOT_A_SWITCH,
  OPTION_SWITCH_ON_AUTHORITY,
  OPTION_SWITCH_PLUMBING,
  OPTION_SWITCH_PLAIN_NAMES,
  OPTION_SWITCH_PLAIN_REGISTRY,
  OPTION_SWITCH_REFUSED,
  OPTION_SWITCH_REGISTRY,
  OPTION_SWITCH_RELEASE_DEFAULT_CODE,
  OPTION_SWITCH_RELEASE_DEFAULT_OFF,
  OPTION_SWITCH_RELEASE_DEFAULT_ON,
  OPTION_SWITCH_SHADOW_NAMES,
  OPTION_SWITCH_ON_SHADOW_NAMES,
  OptionSwitchHolder,
  optionSwitchDecisionOpts,
  optionSwitchRefusal,
  optionSwitchSourceFromStates,
  optionSwitchStatesFrom,
  parseOptionSwitchConfig,
  type OptionSwitchStates,
} from '../HorseOptionSwitch.js';
import {
  OPTION_SWITCH_APPROVED_UNLOCKS,
  OPTION_SWITCH_BASE_MIGRATION,
  OPTION_SWITCH_LAST_LIST_MIGRATION,
  OPTION_SWITCH_LIST_MARKER,
  OPTION_SWITCH_MIGRATIONS_DIR,
  OPTION_SWITCH_REGISTER_COMMAND,
  OPTION_SWITCH_WHITELIST_MIGRATION,
  optionSwitchListMigrationsRefusal,
  optionSwitchListsFingerprint,
  optionSwitchListsOf,
  optionSwitchRegisterMigrationRefusal,
  optionSwitchRowStates,
  optionSwitchWhitelistDrift,
  optionSwitchWhitelistFromMigrations,
} from '../HorseOptionSwitchMigrationLists.js';
import { computeHorseUpgradeActivationManifest } from '../HorseUpgradeActivationManifest.js';
import { createStyleSwitchWorkerInbox, readSwitchThrough } from './styleSwitchDelivery.js';
import { isHorseDecisionReplayState } from './replayState.js';
import { recordedSwitchStates } from './replay/HorseDecisionReplay.js';
import { requestAt, workerHarness } from '../../testing/horseRegression/plan/fixture.js';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (path: string) => readFileSync(join(REPO, path), 'utf8');
const MIGRATION_PATH = OPTION_SWITCH_BASE_MIGRATION;
/** The migration without its comments: what the database executes. */
const SQL = read(MIGRATION_PATH).replace(/--[^\n]*/g, '');
/** Every migration that can bear on the whitelist: a full-list migration, or one naming a whitelist object. */
const WHITELIST_FILES = readdirSync(join(REPO, OPTION_SWITCH_MIGRATIONS_DIR))
  .filter((name) => name.endsWith('.sql'))
  .map((name) => ({ name, text: read(`${OPTION_SWITCH_MIGRATIONS_DIR}/${name}`) }))
  .filter((f) => f.text.includes(OPTION_SWITCH_LIST_MARKER) || f.text.includes('ca_horse_option_'));
/**
 * The database whitelist: the rows public.ca_horse_option_whitelist holds after every migration is installed (the
 * frozen lists of the last full-list migration, then every register call; HorseOptionSwitchMigrationLists.ts).
 */
const whitelistOfMain = (() => {
  let memo: ReturnType<typeof optionSwitchWhitelistFromMigrations> | undefined;
  return () => (memo ??= optionSwitchWhitelistFromMigrations(WHITELIST_FILES));
})();
const whitelistNames = (
  pick: (row: { kind: string; lockedBy: readonly string[]; shadow: string }) => boolean
) => [...whitelistOfMain().whitelist].filter(([, row]) => pick(row)).map(([name]) => name);
/** The migration that turned the lists into rows, without its comments. */
const WHITELIST_MIGRATION_PATH = `${OPTION_SWITCH_MIGRATIONS_DIR}/${OPTION_SWITCH_WHITELIST_MIGRATION}`;
const LIST_SQL = read(WHITELIST_MIGRATION_PATH).replace(/--[^\n]*/g, '');
/** TypeScript without comments: what runs. */
const strip = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[\s;{}(),])\/\/[^\n]*/g, '$1');
const code = (path: string) => strip(read(path));
const quoted = (text: string) => [...text.matchAll(/'([A-Za-z0-9]+)'/g)].map((m) => m[1]!);
const sorted = (names: readonly string[]) => [...names].sort();
/** The quoted states of an ARRAY[...] (on_shadow included, 2026-11-19). */
const statesIn = (text: string) => [...text.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);

/** Every function the migration creates: name, arguments, the header before the body, the body. */
const FUNCTIONS = [
  ...SQL.matchAll(
    /CREATE (OR REPLACE )?FUNCTION public\.(\w+)\(([^)]*)\)([\s\S]*?)AS \$function\$([\s\S]*?)\$function\$;/g
  ),
].map((m) => ({ replaced: !!m[1], name: m[2]!, args: m[3]!, header: m[4]!, body: m[5]! }));
const fn = (name: string) => {
  const found = FUNCTIONS.find((f) => f.name === name);
  if (!found) throw new Error(`the migration does not create ${name}`);
  return found;
};
/** The functions of the whitelist migration. */
const LIST_FUNCTIONS = [
  ...LIST_SQL.matchAll(
    /CREATE (OR REPLACE )?FUNCTION public\.(\w+)\(([^)]*)\)([\s\S]*?)AS \$function\$([\s\S]*?)\$function\$;/g
  ),
].map((m) => ({ replaced: !!m[1], name: m[2]!, args: m[3]!, header: m[4]!, body: m[5]! }));
const listFn = (name: string) => {
  const found = LIST_FUNCTIONS.find((f) => f.name === name);
  if (!found) throw new Error(`${WHITELIST_MIGRATION_PATH} does not create ${name}`);
  return found;
};

/** The names refused, beside OPTION_SWITCH_REFUSED: each must be refused by name or by pattern. */
const HELD_BY_THE_OWNER = [
  ...HORSE_FEATURE_FLAGS,
  'v53PloTourneyIcm',
  'phase8Postflop',
  'phase8PolicyFamily',
  'phase8CatastropheGuard',
  'phase10Plo4',
  'phase11Omaha',
  'phase12Remaining',
  'phase13Joint',
  'phase14',
  'phase14Corrective',
  'phase15Anything',
  'v87DeepDiveDiscipline',
  'v87ShouldSuppressOmahaPositionStab',
  'pillar2PositionStab',
  'v31GtoSuitAware',
  'solverRound7',
  'heldOutPack',
  'leakMapRead',
  'vpipFloorDeepStackOff',
  'omahaPreflopCallWithActionBehind',
];
const REFUSED_NAMES = [...new Set([...Object.keys(OPTION_SWITCH_REFUSED), ...HELD_BY_THE_OWNER])];
/** Registered under an owner hold or a measured verdict: each exists in the ledger and carries its text. */
const PREFLOP_HOLD_NAMES = [
  'v46ShortDeck',
  'nashPushFoldIcm',
  'huBbDefendsToPrice',
  'huOpenerDefendsToPrice',
  'huLimpDefendsToPrice',
  'facingOpenFullRingZone',
  'committedStackPricedIn',
  'vs3BetShortStack',
  'fixedLimitPricedPreflop',
];
const GENERATOR = `the option switch whitelist differs from the registry: ${OPTION_SWITCH_REGISTER_COMMAND}`;
const noteFor = (option: string) =>
  optionSwitchOnNote(option, OPTION_SWITCH_ON_AUTHORITY_FILE, OPTION_SWITCH_ON_AUTHORITY_SHA256);
/** The row trigger of the switch table: the two state rules the CHECK constraints held, for every writer. */
const rowRules = () => listFn('fn_ca_horse_option_switch_row_fits').body;

const v2 = (options: Record<string, unknown>, style: Record<string, unknown> = {}) => ({
  version: 2,
  style: { version: 1, options: style },
  options,
});

// ---------------------------------------------------------------------------------------------------------------
// A real worker.
// ---------------------------------------------------------------------------------------------------------------

const V3 = 'horse-decision-replay-state-v3';
const V5 = 'horse-decision-replay-state-v5';
const WALL_EPOCH = 1_700_000_000_000;
type Journaled = {
  snapshot: { type: string; requestId: number };
  replayState: {
    version: string;
    options?: Record<string, string>;
    style?: Record<string, string>;
  };
};

/** `wired`: the production wiring (inbox, both holders). `recorded`: the replay wiring. Neither: no switch at all. */
function worker(mode: { wired: true } | { recorded: OptionSwitchStates | null } | 'none') {
  let t = 1_000;
  vi.spyOn(performance, 'now').mockImplementation(() => t);
  seedFastRandom(20261114);
  HorseMind.reset();
  const features: string[] = [];
  const note = (feature: string) => void features.push(feature);
  const decideOpts: Array<Record<string, unknown>> = [];
  const inbox = createStyleSwitchWorkerInbox(
    () => t,
    () => WALL_EPOCH + t
  );
  const h = workerHarness({
    now: () => t,
    noteFeature: note,
    decide: (...args) => {
      decideOpts.push({ ...(args[4] as Record<string, unknown>) });
      return HorseLogic.decide(...args);
    },
    ...(mode === 'none'
      ? {}
      : 'wired' in mode
        ? {
            styleSwitch: new StyleSwitchHolder(inbox.source, note),
            optionSwitch: new OptionSwitchHolder(inbox.optionSource, note),
          }
        : {
            optionSwitch: new OptionSwitchHolder(
              optionSwitchSourceFromStates(mode.recorded),
              () => {}
            ),
          }),
  });
  let seq = 0;
  return {
    h,
    features,
    advance: (ms: number) => {
      t += ms;
    },
    deliver(config: unknown, status: 'ok' | 'unreadable' = 'ok') {
      return inbox.receive({
        type: 'STYLE_SWITCH_STATE',
        seq: ++seq,
        status,
        readAtEpochMs: WALL_EPOCH + t,
        config,
      });
    },
    async fast(requestId = 1) {
      const from = decideOpts.length;
      const result = await h.fast(requestAt(requestId));
      const journaled = (h.captures as unknown as Journaled[]).filter(
        (c) => c.snapshot.type === 'DECIDE_FAST' && c.snapshot.requestId === requestId
      );
      expect(journaled).toHaveLength(1);
      expect(decideOpts.length).toBeGreaterThan(from);
      return { result, opts: decideOpts.slice(from), replayState: journaled[0]!.replayState };
    },
  };
}
const open: Array<ReturnType<typeof worker>> = [];
function opened(mode: Parameters<typeof worker>[0]) {
  const w = worker(mode);
  open.push(w);
  return w;
}
async function closeAll() {
  for (const w of open.splice(0)) await w.h.close();
  vi.restoreAllMocks();
}
afterEach(closeAll);

const switchedKeys = (opts: Record<string, unknown>) =>
  Object.keys(opts).filter((k) => OPTION_SWITCH_PLAIN_NAMES.includes(k));
/** What a decision was handed, in a form two runs can be compared by (functions and undefined drop out alike). */
/** The wager itself; the rest of a decision carries the worker's own authority epoch, which is random per worker. */
const wagerOf = (decision: { action: string; amount?: number | null; thinkTime?: number }) => ({
  action: decision.action,
  amount: decision.amount ?? null,
  thinkTime: decision.thinkTime,
});
/** The published manifest without its clock reading. */
const manifestNow = () =>
  JSON.stringify({ ...computeHorseUpgradeActivationManifest(), generatedAt: null });
const handed = (opts: Array<Record<string, unknown>>) =>
  opts.map((o) => ({ keys: Object.keys(o).sort(), values: JSON.parse(JSON.stringify(o)) }));

/** One real decision with no switch wired at all: the build before this change. */
async function baseline() {
  const w = opened('none');
  const look = await w.fast();
  await closeAll();
  return look;
}

// ---------------------------------------------------------------------------------------------------------------

describe('condition 8: the database whitelist is the engine registry', () => {
  it('the table accepts exactly the registered options', () => {
    expect(optionSwitchWhitelistDrift(whitelistOfMain().whitelist), GENERATOR).toBeNull();
    expect(sorted([...whitelistOfMain().whitelist.keys()]), GENERATOR).toEqual(
      sorted(OPTION_SWITCH_NAMES)
    );
    // any writer: the switch table refers to the whitelist by a foreign key under the name the CHECK had, and the
    // row trigger refuses a row whose option has no whitelist row
    expect(LIST_SQL).toMatch(
      /ADD CONSTRAINT ca_horse_style_switch_option_is_registered\s+FOREIGN KEY \(option\) REFERENCES public\.ca_horse_option_whitelist \(option\)\s+ON UPDATE RESTRICT ON DELETE RESTRICT;/
    );
    expect(rowRules()).toMatch(
      /FROM public\.ca_horse_option_whitelist w\s+WHERE w\.option = NEW\.option;\s+IF NOT FOUND THEN\s+RAISE EXCEPTION [^;]*CONSTRAINT = 'ca_horse_style_switch_option_is_registered';/
    );
    expect(LIST_SQL).toMatch(
      /CREATE TRIGGER ca_horse_style_switch_row_fits\s+AFTER INSERT OR UPDATE ON public\.ca_horse_style_switch\s+FOR EACH ROW EXECUTE FUNCTION public\.fn_ca_horse_option_switch_row_fits\(\);/
    );
  });

  it('canary only for the seven style options, shadow at level shadow, on_shadow at level on_shadow or shadow, and nothing but off for an off-only option', () => {
    expect(sorted(whitelistNames((row) => row.kind === 'style'))).toEqual(
      sorted(STYLE_SWITCH_OPTIONS)
    );
    expect(sorted(whitelistNames((row) => row.lockedBy.length > 0)), GENERATOR).toEqual(
      sorted(OPTION_SWITCH_OFF_ONLY_NAMES)
    );
    // the shadow level of a row that is not held is the registry's: shadow, on_shadow (every shadow option takes
    // it) or none; an off-only or style row has none
    expect(
      sorted(whitelistNames((row) => row.lockedBy.length === 0 && row.shadow === 'shadow')),
      GENERATOR
    ).toEqual(sorted(OPTION_SWITCH_SHADOW_NAMES));
    expect(
      sorted(whitelistNames((row) => row.lockedBy.length === 0 && row.shadow !== 'none')),
      GENERATOR
    ).toEqual(sorted(OPTION_SWITCH_ON_SHADOW_NAMES));
    expect(
      whitelistNames(
        (row) => row.shadow !== 'none' && (row.kind === 'style' || row.lockedBy.length > 0)
      )
    ).toEqual([]);
    for (const name of OPTION_SWITCH_SHADOW_NAMES)
      expect(OPTION_SWITCH_ON_SHADOW_NAMES, name).toContain(name);
    const rules = rowRules();
    // a style option takes every state but on_shadow (its shadow is its own arm); for any other, off always, and
    // while it is not off-only: on, on_shadow at level on_shadow or shadow, shadow at level shadow. Never canary.
    const style = rules.search(
      /IF v_kind = 'style' THEN\s+IF NEW\.state = 'on_shadow' THEN\s+RAISE EXCEPTION [^;]*CONSTRAINT = 'ca_horse_style_switch_state_fits_option';\s+END IF;\s+RETURN NULL;\s+END IF;/
    );
    const fits = rules.search(
      /IF NOT coalesce\(\s+NEW\.state = 'off'\s+OR \(NOT v_off_only\s+AND \(NEW\.state = 'on'\s+OR \(NEW\.state = 'on_shadow' AND v_shadow IN \('on_shadow', 'shadow'\)\)\s+OR \(NEW\.state = 'shadow' AND v_shadow = 'shadow'\)\)\), false\) THEN\s+RAISE EXCEPTION [^;]*CONSTRAINT = 'ca_horse_style_switch_state_fits_option';/
    );
    expect(style).toBeGreaterThan(0);
    expect(fits).toBeGreaterThan(style);
    expect(rules).not.toContain("'canary'");
    // the level is one of three, and a style option has none
    expect(LIST_SQL).toMatch(
      /shadow\s+text NOT NULL DEFAULT 'none' CHECK \(shadow IN \('none', 'on_shadow', 'shadow'\)\)/
    );
    expect(LIST_SQL).toMatch(
      /CONSTRAINT ca_horse_option_whitelist_a_style_option_has_its_own_shadow_arm\s+CHECK \(kind <> 'style' OR shadow = 'none'\)/
    );
    // off-only is the row's holders, and nothing else decides it
    expect(LIST_SQL).toMatch(
      /off_only\s+boolean GENERATED ALWAYS AS \(cardinality\(locked_by\) > 0\) STORED/
    );
  });

  it('fn_ca_horse_option_switch_states answers each registered option with its states and anything else with NULL', () => {
    const states = listFn('fn_ca_horse_option_switch_states');
    expect(states.replaced).toBe(true);
    expect(states.args).toBe('p_option text');
    expect(states.header).toMatch(/RETURNS text\[\]\s+LANGUAGE sql\s+STABLE\s+SECURITY DEFINER/);
    // one row or none: an unregistered name finds no row, and a scalar SQL function then answers NULL
    expect(states.body.replace(/\s+/g, ' ').trim()).toBe(
      "SELECT CASE WHEN w.kind = 'style' THEN ARRAY['off', 'shadow', 'canary', 'on'] " +
        "WHEN w.off_only THEN ARRAY['off'] " +
        "WHEN w.shadow = 'shadow' THEN ARRAY['off', 'shadow', 'on_shadow', 'on'] " +
        "WHEN w.shadow = 'on_shadow' THEN ARRAY['off', 'on_shadow', 'on'] ELSE ARRAY['off', 'on'] END " +
        'FROM public.ca_horse_option_whitelist w WHERE w.option = p_option;'
    );
    const answer = (name: string) => {
      const row = whitelistOfMain().whitelist.get(name);
      return row ? [...optionSwitchRowStates(row)] : undefined;
    };
    for (const entry of OPTION_SWITCH_REGISTRY)
      expect(answer(entry.name), entry.name).toEqual([...entry.states]);
    // one attempt, no retry: the ALTERs wait at most three seconds for the table
    expect(SQL).toMatch(/^\s*BEGIN;\s*SET LOCAL lock_timeout = '3s';/);
    expect(LIST_SQL).toMatch(/^\s*BEGIN;\s*SET LOCAL lock_timeout = '3s';/);
  });

  it('the whitelist is rows: the frozen lists plus the register calls; no full list is re-asserted and no hold is lifted in passing', () => {
    // no full-list follow-up joins the frozen ones: installed after the whitelist it would overwrite the rows
    expect(optionSwitchListMigrationsRefusal(WHITELIST_FILES)).toBeNull();
    expect(read(`${OPTION_SWITCH_MIGRATIONS_DIR}/${OPTION_SWITCH_LAST_LIST_MIGRATION}`)).toContain(
      OPTION_SWITCH_LIST_MARKER
    );
    // every other migration that names a whitelist writer or the table is a register migration: one transaction,
    // the lock timeout, its own calls and nothing else
    for (const file of WHITELIST_FILES)
      if (file.name !== OPTION_SWITCH_WHITELIST_MIGRATION)
        expect(optionSwitchRegisterMigrationRefusal(file), file.name).toBeNull();
    // an un-lock or a removal is its own call, and approved by name
    expect(sorted(whitelistOfMain().explicit)).toEqual(sorted(OPTION_SWITCH_APPROVED_UNLOCKS));

    // the whitelist migration: one transaction, and NO LIST of its own (the seed is read from the installed CHECK
    // and the installed states function, which must agree), so it never goes stale against another pull request
    expect(LIST_SQL.trim()).toMatch(/^BEGIN;[\s\S]*COMMIT;$/);
    const raw = read(WHITELIST_MIGRATION_PATH);
    expect(raw).not.toContain(OPTION_SWITCH_LIST_MARKER);
    const named = new Set(quoted(LIST_SQL));
    expect(OPTION_SWITCH_NAMES.filter((name) => named.has(name))).toEqual([]);
    const seed = /DO \$seed\$([\s\S]*?)\$seed\$;/.exec(LIST_SQL)![1]!;
    expect(seed).toMatch(/pg_get_constraintdef\(c\.oid\)/);
    expect(seed).toMatch(/c\.conname = 'ca_horse_style_switch_option_is_registered'/);
    expect(seed).toMatch(
      /IF v_names IS NULL OR v_names IS DISTINCT FROM v_fn_names THEN\s+RAISE EXCEPTION/
    );
    expect(seed).toMatch(/v_states := public\.fn_ca_horse_option_switch_states\(v_name\);/);
    // and it installs only over exactly the frozen lists this law counts from, so the rows and the law agree from
    // the first row. When another full-list follow-up reaches main first, move OPTION_SWITCH_LAST_LIST_MIGRATION,
    // its count, the file name in the proof script and this line of the (not yet installed) whitelist migration.
    const frozen = optionSwitchListsOf(
      read(`${OPTION_SWITCH_MIGRATIONS_DIR}/${OPTION_SWITCH_LAST_LIST_MIGRATION}`)
    );
    expect(seed).toContain(
      `v_lists    constant text := '${optionSwitchListsFingerprint(frozen)}';`
    );
    expect(seed).toMatch(/IF v_found IS DISTINCT FROM v_lists THEN\s+RAISE EXCEPTION/);
    expect(raw).toContain(
      `is not the one of ${OPTION_SWITCH_LAST_LIST_MIGRATION.replace(/\.sql$/, '')} (lists %)`
    );
    // the seed runs before the states function it reads is replaced
    expect(LIST_SQL.indexOf('$seed$')).toBeLessThan(
      LIST_SQL.indexOf('CREATE OR REPLACE FUNCTION public.fn_ca_horse_option_switch_states')
    );
    // the three literal-list CHECKs go in the statement that adds the key
    for (const name of [
      'ca_horse_style_switch_option_is_registered',
      'ca_horse_style_switch_on_cites_authority',
      'ca_horse_style_switch_state_fits_option',
    ])
      expect(LIST_SQL, name).toContain(`DROP CONSTRAINT IF EXISTS ${name},`);
    // it redefines the states function and nothing else of the switch: the setters, the readers, the evidence
    // record and the serving-registry guard (#11391) keep the bodies their own migrations gave them
    expect(LIST_FUNCTIONS.map((f) => [f.name, f.replaced])).toEqual([
      ['fn_ca_horse_option_switch_states', true],
      ['fn_ca_horse_option_switch_row_fits', true],
      ['fn_ca_horse_option_whitelist_guard', true],
      ['fn_ca_horse_option_register', true],
      ['fn_ca_horse_option_allow_shadow', true],
      ['fn_ca_horse_option_unlock', true],
      ['fn_ca_horse_option_unregister', true],
    ]);
    for (const f of LIST_FUNCTIONS)
      expect(f.header, f.name).toContain('SET search_path = pg_catalog, public');
    // the only grants: the states function to its one grantee, as before, and the rows readable by service_role
    expect(
      [...LIST_SQL.matchAll(/GRANT\s+([^;]*?)\sTO\s+([^;]*);/g)].map((m) => [
        m[1]!.trim(),
        m[2]!.trim(),
      ])
    ).toEqual([
      ['EXECUTE ON FUNCTION public.fn_ca_horse_option_switch_states(text)', 'service_role'],
      ['SELECT ON TABLE public.ca_horse_option_whitelist', 'service_role'],
    ]);
    for (const writer of [
      'fn_ca_horse_option_register(text, text, boolean, text, text)',
      'fn_ca_horse_option_allow_shadow(text, text, text)',
      'fn_ca_horse_option_unlock(text, text[], text)',
      'fn_ca_horse_option_unregister(text, text)',
    ])
      expect(LIST_SQL, writer).toContain(
        `REVOKE ALL ON FUNCTION public.${writer} FROM PUBLIC, anon, authenticated, service_role;`
      );
    // it writes no switch row: outside the probe, which always unwinds, nothing writes the switch table
    const probe = LIST_SQL.indexOf('DO $probe$');
    expect(probe).toBeGreaterThan(0);
    expect(LIST_SQL.slice(0, probe)).not.toMatch(
      /(INSERT INTO|UPDATE|DELETE FROM|TRUNCATE)\s+public\.ca_horse_style_switch\b/
    );
    expect(LIST_SQL.slice(probe)).toMatch(
      /RAISE EXCEPTION 'probe-unwind';\s*EXCEPTION WHEN raise_exception THEN\s+IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;\s+END \$probe\$;\s+COMMIT;\s*$/
    );
  });

  it('off-only is monotonic: registering only adds a hold, and lifting one names every holder', () => {
    const register = listFn('fn_ca_horse_option_register').body;
    // the only UPDATE of the holders in register is a union with the caller, or the holders as they are
    expect(
      [...register.matchAll(/SET locked_by = ([\s\S]*?),\s+shadow = /g)].map((m) =>
        m[1]!.replace(/\s+/g, ' ').trim()
      )
    ).toEqual([
      'CASE WHEN v_hold THEN ARRAY(SELECT x FROM unnest(w.locked_by || p_migration) AS x GROUP BY x ORDER BY x COLLATE "C") ELSE w.locked_by END',
    ]);
    // and the only UPDATE of the shadow level in register is a NARROWER one (the lower of the two)
    expect(register).toMatch(
      /v_narrow := array_position\(v_levels, p_shadow\) < array_position\(v_levels, v_row\.shadow\);/
    );
    expect([...register.matchAll(/\n\s+shadow = ([^\n]*)/g)].map((m) => m[1]!.trim())).toEqual([
      'CASE WHEN v_narrow THEN p_shadow ELSE w.shadow END,',
    ]);
    expect(register).not.toMatch(
      /DELETE FROM|ca_horse_option\.unlock|ca_horse_option\.unregister|ca_horse_option\.allow_shadow/
    );
    // it refuses to add a row nothing reads (an old full-list follow-up installed over the whitelist)
    expect(register).toMatch(/p\.prosrc LIKE '%public\.ca_horse_option_whitelist%'/);
    const guard = listFn('fn_ca_horse_option_whitelist_guard').body;
    expect(guard).toMatch(
      /IF NOT \(NEW\.locked_by @> OLD\.locked_by\)\s+AND current_setting\('ca_horse_option\.unlock', true\) IS DISTINCT FROM OLD\.option THEN\s+RAISE EXCEPTION/
    );
    expect(guard).toMatch(
      /IF TG_OP = 'DELETE' THEN\s+IF current_setting\('ca_horse_option\.unregister', true\) IS DISTINCT FROM OLD\.option THEN\s+RAISE EXCEPTION/
    );
    expect(guard).toMatch(/IF TG_OP = 'TRUNCATE' THEN\s+RAISE EXCEPTION/);
    // no hold under a switch row that is not off; no narrower level under a row in a state it would lose
    expect(guard).toMatch(/s\.option = NEW\.option AND s\.state <> 'off'\) THEN\s+RAISE EXCEPTION/);
    expect(guard).toMatch(
      /\(s\.state = 'shadow' AND NEW\.shadow <> 'shadow'\)\s+OR \(s\.state = 'on_shadow' AND NEW\.shadow = 'none'\)\)\) THEN\s+RAISE EXCEPTION/
    );
    // a wider level only inside fn_ca_horse_option_allow_shadow
    expect(guard).toMatch(
      /IF array_position\(ARRAY\['none', 'on_shadow', 'shadow'\], NEW\.shadow\) > array_position\(ARRAY\['none', 'on_shadow', 'shadow'\], OLD\.shadow\)\s+AND current_setting\('ca_horse_option\.allow_shadow', true\) IS DISTINCT FROM OLD\.option THEN\s+RAISE EXCEPTION/
    );
    expect(LIST_SQL).toMatch(
      /CREATE TRIGGER ca_horse_option_whitelist_guard\s+BEFORE UPDATE OR DELETE ON public\.ca_horse_option_whitelist\s+FOR EACH ROW EXECUTE FUNCTION public\.fn_ca_horse_option_whitelist_guard\(\);/
    );
    expect(LIST_SQL).toMatch(
      /CREATE TRIGGER ca_horse_option_whitelist_guard_truncate\s+BEFORE TRUNCATE ON public\.ca_horse_option_whitelist/
    );
    // the two settings that let a hold go or a row leave are set in exactly one function each
    const setters = (setting: string) =>
      LIST_FUNCTIONS.filter((f) => f.body.includes(`set_config('${setting}', p_option, true)`)).map(
        (f) => f.name
      );
    expect(setters('ca_horse_option.unlock')).toEqual(['fn_ca_horse_option_unlock']);
    expect(setters('ca_horse_option.unregister')).toEqual(['fn_ca_horse_option_unregister']);
    expect(setters('ca_horse_option.allow_shadow')).toEqual(['fn_ca_horse_option_allow_shadow']);
    const allow = listFn('fn_ca_horse_option_allow_shadow').body;
    // never for a style or a held option, never narrower, and all of that before the setting is made
    for (const refusal of [
      "IF v_row.kind = 'style' THEN",
      'IF cardinality(v_row.locked_by) > 0 THEN',
      'IF array_position(v_levels, p_shadow) < array_position(v_levels, v_row.shadow) THEN',
    ]) {
      expect(allow.indexOf(refusal), refusal).toBeGreaterThan(0);
      expect(allow.indexOf(refusal), refusal).toBeLessThan(allow.indexOf('set_config('));
    }
    const unlock = listFn('fn_ca_horse_option_unlock').body;
    expect(unlock).toMatch(/IF v_held <> v_lifts THEN\s+RAISE EXCEPTION/);
    expect(unlock.indexOf('IF v_held <> v_lifts THEN')).toBeLessThan(unlock.indexOf('set_config('));
    const unregister = listFn('fn_ca_horse_option_unregister').body;
    expect(unregister).toMatch(/IF cardinality\(v_held\) > 0 THEN\s+RAISE EXCEPTION/);
    expect(unregister.indexOf('IF cardinality(v_held) > 0 THEN')).toBeLessThan(
      unregister.indexOf('set_config(')
    );
  });

  it('the schema manifest names the whitelist table and the functions the whitelist migration adds', () => {
    const manifest = JSON.parse(read('scripts/ci/schema-manifest.d/horse-option-whitelist.json'));
    expect(manifest.tables).toEqual(['ca_horse_option_whitelist']);
    expect(sorted(manifest.functions)).toEqual(
      sorted(
        LIST_FUNCTIONS.map((f) => f.name).filter(
          (name) => name !== 'fn_ca_horse_option_switch_states'
        )
      )
    );
  });

  it('the schema manifest names exactly the functions the migration adds, and the migration adds no table or column', () => {
    const manifest = JSON.parse(
      read('scripts/ci/schema-manifest.d/horse-option-switch-20261114.json')
    );
    expect(sorted(manifest.functions)).toEqual(
      sorted(FUNCTIONS.filter((f) => !f.replaced).map((f) => f.name))
    );
    expect(FUNCTIONS.filter((f) => f.replaced).map((f) => f.name)).toEqual([
      'fn_ca_horse_style_switch_effective',
    ]);
    expect(manifest.tables).toBeUndefined();
    expect(SQL).not.toMatch(
      /CREATE\s+TABLE|ADD\s+COLUMN|CREATE\s+(UNIQUE\s+)?INDEX|CREATE\s+TRIGGER/i
    );
    // one transaction, as the production DDL policy requires
    expect(SQL.trim()).toMatch(/^BEGIN;[\s\S]*COMMIT;$/);
  });
});

/** The on/off type of every member of HorseDecideOpts, read from the interface source. */
function decideOptTypes(): Map<string, string> {
  const file = ts.createSourceFile(
    'HorseLogic.ts',
    read('server/src/engine/HorseLogic.ts'),
    ts.ScriptTarget.Latest,
    true
  );
  const types = new Map<string, string>();
  const walk = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === 'HorseDecideOpts')
      for (const member of node.members)
        if (member.name && ts.isPropertySignature(member))
          types.set(member.name.getText(file), member.type?.getText(file) ?? '');
    ts.forEachChild(node, walk);
  };
  walk(file);
  return types;
}
/** boolean, or a union with boolean in it (boolean | <object>). */
const acceptsBoolean = (type: string) =>
  type
    .split('|')
    .map((part) => part.trim())
    .includes('boolean');

describe('the owner order of 2026-11-14 22:01: every ledger option has an on/off switch, and on cites the authority', () => {
  const ledgerFlags = HORSE_DATA_LEDGER.filter((e) => e.kind === 'flag').map((e) => e.key);
  const types = decideOptTypes();

  it('the registry is exactly the boolean-typed ledger options minus the refused ones; every other ledger option is refused or a named parameter', () => {
    expect(ledgerFlags.length).toBeGreaterThan(200);
    expect(new Set(ledgerFlags).size).toBe(ledgerFlags.length);
    expect(types.size).toBeGreaterThan(200);
    const style = STYLE_SWITCH_OPTIONS as readonly string[];
    const expected = ledgerFlags.filter(
      (name) =>
        !style.includes(name) &&
        !OPTION_SWITCH_PLUMBING.includes(name) &&
        acceptsBoolean(types.get(name) ?? '') &&
        optionSwitchRefusal(name) === null
    );
    // a new ledger option that is an on/off option registers itself; one that is not must be named a parameter
    expect(OPTION_SWITCH_PLAIN_NAMES).toEqual(expected);
    for (const name of ledgerFlags) {
      const type = types.get(name);
      expect(type, `${name} is a ledger flag and a key of HorseDecideOpts`).toBeDefined();
      const where = [
        OPTION_SWITCH_NAMES.includes(name) ? 'registered' : null,
        optionSwitchRefusal(name) !== null ? 'refused' : null,
        Object.hasOwn(OPTION_SWITCH_NOT_A_SWITCH, name) ? 'parameter' : null,
      ].filter(Boolean);
      expect(
        where,
        `${name} (${type}) must be registered, refused or listed in OPTION_SWITCH_NOT_A_SWITCH`
      ).toHaveLength(1);
      // not a switch = a non-boolean parameter, or the explicit decision plumbing list (telemetry and the mind)
      if (where[0] === 'parameter')
        expect(
          acceptsBoolean(type!),
          `${name} is listed as not a switch: a parameter is not boolean, plumbing is`
        ).toBe(OPTION_SWITCH_PLUMBING.includes(name));
    }
    for (const name of Object.keys(OPTION_SWITCH_NOT_A_SWITCH)) expect(ledgerFlags).toContain(name);
    // a switch never turns the receipts or the mind off: the plumbing is exactly these, never registered
    expect([...OPTION_SWITCH_PLUMBING]).toEqual(['telemetry', 'observeMind', 'mind']);
    for (const name of OPTION_SWITCH_PLUMBING) {
      expect(OPTION_SWITCH_NAMES, name).not.toContain(name);
      expect(OPTION_SWITCH_NOT_A_SWITCH[name], name).toBe(
        'decision plumbing (telemetry / mind), not a strategy option'
      );
      expect(optionSwitchStatesFrom({ [name]: 'off' }), name).toBeNull();
      expect(optionSwitchDecisionOpts({ [name]: 'off' } as never), name).toEqual({});
    }
    for (const name of style) expect(ledgerFlags).toContain(name);
    for (const name of [
      'omahaHiLoTournamentFirstIn',
      'huBbDefendsToPrice',
      'huOpenerDefendsToPrice',
      'huLimpDefendsToPrice',
    ])
      expect(OPTION_SWITCH_PLAIN_REGISTRY.find((e) => e.name === name)?.owner, name).toBe(
        'Heads Up'
      );
  });

  it('every registered option offers off, and on unless it is off-only, and its release default is on, off or code from the static lists', () => {
    for (const entry of OPTION_SWITCH_PLAIN_REGISTRY) {
      expect([...entry.states], entry.name).toEqual(
        optionSwitchOffOnly(entry.name)
          ? ['off']
          : OPTION_SWITCH_SHADOW_NAMES.includes(entry.name)
            ? ['off', 'shadow', 'on_shadow', 'on']
            : OPTION_SWITCH_ON_SHADOW_NAMES.includes(entry.name)
              ? ['off', 'on_shadow', 'on']
              : ['off', 'on']
      );
      expect(entry.offOnly ?? null, entry.name).toEqual(optionSwitchOffOnly(entry.name));
      expect(entry.shadowArm, entry.name).toBe(false);
      expect(entry.description.length, entry.name).toBeGreaterThan(0);
      expect(entry.description.length, entry.name).toBeLessThanOrEqual(160);
      expect(entry.releaseDefault, entry.name).toBe(
        OPTION_SWITCH_RELEASE_DEFAULT_ON.includes(entry.name)
          ? 'on'
          : OPTION_SWITCH_RELEASE_DEFAULT_OFF.includes(entry.name)
            ? 'off'
            : 'code'
      );
    }
    const listed = [
      ...OPTION_SWITCH_RELEASE_DEFAULT_ON,
      ...OPTION_SWITCH_RELEASE_DEFAULT_OFF,
      ...OPTION_SWITCH_RELEASE_DEFAULT_CODE,
    ];
    expect(new Set(listed).size).toBe(listed.length);
    for (const name of listed) expect(OPTION_SWITCH_PLAIN_NAMES, name).toContain(name);
    // a registry entry without on, or a parameter, throws where the registry is declared
    const first = OPTION_SWITCH_PLAIN_REGISTRY.find((e) => e.offOnly === undefined)!;
    expect(() => assertOptionSwitchRegistry([{ ...first, states: ['off'] as const }])).toThrow(
      /must support off and on/
    );
    expect(() => assertOptionSwitchRegistry([{ ...first, name: 'decisionTimeMs' }])).toThrow(
      /a parameter, not an on\/off option/
    );
  });

  it('2026-11-18: an option the engine reads only `=== true` / `!== true` states release default off, read from the source', () => {
    // swarm NLH-CASH IMPROVEMENTS I2: these reported 'code', so the switch audit bucketed styleTightMethodLine as on by
    // default although it is off in source. v46ShortDeck joins them once the unset-under-V86 short-deck path is gone.
    const offInSource = [
      'v46ShortDeck',
      'styleLongShownMemory',
      'holdemProfileCompletenessCap',
      'holdemPersonaReRaiseMix',
      'holdemPersonaPostflop',
      'holdemManiacSampleGate',
      'holdemManiacShortHandedReach',
      'holdemGearShiftReach',
      'holdemCallDownExcludesCurrentHand',
      'holdemCallDownNeedsStyleEvidence',
      'holdemRiverFullHouseValue',
      'styleTightPlayerExploit',
      'styleTightMultiSignal',
      'styleTightMethodLine',
      'horseActionTimeIsPublicOnly',
      'horsePlayStyles',
      'omahaNutClassValueSize',
    ];
    const sources = [
      'server/src/engine/HorseLogic.ts',
      'server/src/engine/HorseMind.ts',
      'server/src/engine/horseDecision/observerReads.ts',
    ].map((path) =>
      read(path)
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
        .join('\n')
    );
    for (const name of offInSource) {
      expect(OPTION_SWITCH_RELEASE_DEFAULT_OFF, name).toContain(name);
      expect(OPTION_SWITCH_RELEASE_DEFAULT_ON, name).not.toContain(name);
      expect(OPTION_SWITCH_RELEASE_DEFAULT_CODE, name).not.toContain(name);
      expect(OPTION_SWITCH_PLAIN_REGISTRY.find((e) => e.name === name)?.releaseDefault, name).toBe(
        'off'
      );
      const reads = sources.flatMap((text) => [
        ...text.matchAll(
          new RegExp(`(?:opts|decisionReadOptions|carriedOpts)\\??\\.${name}\\b([^\\n]{0,12})`, 'g')
        ),
      ]);
      expect(reads.length, `${name} is read`).toBeGreaterThan(0);
      for (const m of reads) expect(m[1], `${name}${m[1]}`).toMatch(/^\s*[!=]==\s*true\b/);
    }
  });

  it('2026-11-19: an option listed release default ON is on when unset at every read site in the engine, so its shadow re-decision passes false', () => {
    // DEFAULT-ON-AUDIT (Horse Switch lane): optionSwitchShadowFlip passes !releaseDefault, so an option listed ON
    // whose unset value is really off would be re-decided with the value it acted with and always receipt "same".
    // Every read of a listed ON option through the decision options (opts / o / carriedOpts / snapshot.opts), in every
    // engine source file but the replay reconstruction (which copies a record's options verbatim), must be one of:
    //   `!== false`, `=== false`, `?? true) !== false|=== false`, a fallback `?? <master>` to an ON master
    //   (v7, v8, v9, v10, v12), or a `typeof ... === '<type>'` guard and the value read it guards (whose default is
    //   pinned below). Values carried out of the options under another name are listed in CARRIERS with the line
    //   that carries them, which must stand in the source.
    const ENGINE = join(REPO, 'server/src/engine');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) {
          if (p.endsWith(join('horseDecision', 'replay'))) continue;
          walk(p);
        } else if (
          /\.ts$/.test(e.name) &&
          !/\.test\.ts$|test-support|replayState\.ts$/.test(e.name)
        )
          files.push(p);
      }
    };
    walk(ENGINE);
    const text = files.map((f) => ({
      f,
      src: readFileSync(f, 'utf8')
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
        .join('\n'),
    }));
    const MASTERS: Readonly<Record<string, string>> = {
      v7: 'v7',
      useV7: 'v7',
      useV8: 'v8',
      v9: 'v9',
      v10: 'v10',
      v12: 'v12',
    };
    const onWhenUnset = (before: string, after: string, name: string, src: string): boolean => {
      const a = after.replace(/\s+/g, ' ');
      // `!== false` / `=== false`, also as the master of a child fallback: `(opts.<child> ?? opts.<master>) !== false`
      if (/^ ?(\) ?)*(!==|===) false\b/.test(a)) return true;
      if (/^ ?\?\? true ?\) ?(!==|===) false\b/.test(a)) return true;
      const fb = a.match(/^ ?\?\? ?(?:[\w]+\??\.)*(\w+)/);
      if (fb && MASTERS[fb[1]!] && OPTION_SWITCH_RELEASE_DEFAULT_ON.includes(MASTERS[fb[1]!]!))
        return true;
      if (/typeof\s*$/.test(before) && /^ ?=== '\w+'/.test(a)) return true;
      // the value a typeof guard hands on: `typeof X.name === '...' ? X.name : <default>`
      if (
        /\?\s*$/.test(before) &&
        new RegExp(`typeof\\s+\\w+\\??\\.${name}\\s*===\\s*'\\w+'`).test(src)
      )
        return true;
      return false;
    };
    const bad: string[] = [];
    let readsSeen = 0;
    for (const name of OPTION_SWITCH_RELEASE_DEFAULT_ON) {
      for (const { f, src } of text) {
        const re = new RegExp(
          `(?:\\bopts|\\bo|\\bcarriedOpts|snapshot\\.opts)\\??\\.${name}\\b`,
          'g'
        );
        for (const m of src.matchAll(re)) {
          readsSeen++;
          const before = src.slice(Math.max(0, m.index! - 24), m.index!);
          const after = src.slice(m.index! + m[0].length, m.index! + m[0].length + 48);
          if (!onWhenUnset(before, after, name, src))
            bad.push(
              `${name} ${f.slice(ENGINE.length + 1)}: ...${before.slice(-12)}${m[0]}${after.slice(0, 24)}`
            );
        }
      }
    }
    expect(readsSeen).toBeGreaterThan(100);
    expect(
      bad,
      'a release-default ON option read as off-when-unset: classify it from its reads'
    ).toEqual([]);
    // the typeof-guarded ON option's own default is on
    expect(read('server/src/engine/HorseMind.ts')).toContain(
      'export const FIXED_LIMIT_BETS_ARE_NEVER_PROBES_DEFAULT = true;'
    );
    // CARRIERS: an ON option's value read under another name; each is carried by an on-when-unset expression.
    const CARRIERS: ReadonlyArray<{
      name: string;
      reader: string;
      read: RegExp;
      carrier: string;
      carried: RegExp;
    }> = [
      {
        name: 'omahaEvFoldModel',
        reader: 'server/src/engine/HorseMind.ts',
        read: /decisionReadOptions\.omahaEvFoldModel\b/g,
        carrier: 'server/src/engine/HorseLogic.ts',
        carried: /omahaEvFoldModel: \(opts\.omahaEvFoldModel \?\? true\) !== false,/,
      },
      {
        name: 'v86PloOverhaul',
        reader: 'server/src/engine/HorsePreflop.ts',
        read: /ctx\.v86PloOverhaul\b/g,
        carrier: 'server/src/engine/HorseLogic.ts',
        carried:
          /const v86 = opts\.v86PloOverhaul !== false;[\s\S]*?\.\.\.\(v86\s*\?\s*\{\s*v86PloOverhaul: true,/,
      },
      {
        name: 'facingClosedAllIn',
        reader: 'server/src/engine/HorsePreflop.ts',
        read: /ctx\.facingClosedAllIn\b/g,
        carrier: 'server/src/engine/HorseLogic.ts',
        carried:
          /facingClosedAllIn:\s*opts\.facingClosedAllIn === false\s*\?\s*undefined\s*:\s*facingClosedAllInRaise\(/,
      },
      {
        name: 'v86MultiStreetUnblocked',
        reader: 'server/src/engine/HorseOmahaOopChecks.ts',
        read: /env\.v86MultiStreetUnblocked\b/g,
        carrier: 'server/src/engine/HorseLogic.ts',
        carried: /v86MultiStreetUnblocked: opts\.v86MultiStreetUnblocked !== false,/,
      },
    ];
    for (const c of CARRIERS) {
      expect(OPTION_SWITCH_RELEASE_DEFAULT_ON, c.name).toContain(c.name);
      expect([...read(c.reader).matchAll(c.read)].length, `${c.name} carried read`).toBeGreaterThan(
        0
      );
      expect(read(c.carrier), `${c.name} carrier`).toMatch(c.carried);
    }
    // the omahaEvFoldModel carrier is the only engine caller of HorseMind.setDecisionReadOptions
    const setters = text.filter(({ src }) => src.includes('HorseMind.setDecisionReadOptions('));
    expect(setters.map(({ f }) => f.slice(ENGINE.length + 1))).toEqual(['HorseLogic.ts']);
    // the 2026-11-19 additions, and omahaNutClassValueSize (read only `=== true`) is off, not on
    for (const name of ['v9', 'v10', 'v86PloOverhaul', 'omahaEvFoldModel', 'facingClosedAllIn'])
      expect(OPTION_SWITCH_PLAIN_REGISTRY.find((e) => e.name === name)?.releaseDefault, name).toBe(
        'on'
      );
    expect(
      OPTION_SWITCH_PLAIN_REGISTRY.find((e) => e.name === 'omahaNutClassValueSize')?.releaseDefault
    ).toBe('off');
  });

  it('owner 23:10: an option under an owner hold, measured harmful or superseded is OFF-ONLY, enforced at the registry, the parser and the decision options', () => {
    const expectStatus = (name: string, status: string, source: RegExp) => {
      const entry = optionSwitchOffOnly(name);
      expect(entry?.status, name).toBe(status);
      expect(entry?.source ?? '', name).toMatch(source);
      expect((entry?.reason ?? '').length, name).toBeGreaterThan(5);
    };
    for (const name of PREFLOP_HOLD_NAMES) expectStatus(name, 'hold', /^owner preflop range hold$/);
    for (const name of ['omahaTightOpponent', 'omahaTightOpponentSteal'])
      expectStatus(
        name,
        'hold',
        /^owner ruling 2026-11-14 21:30 Chicago \(Omaha tight responses stay OFF/
      );
    for (const name of [
      'commitUnderPot',
      'v16Hu',
      'v17RiverProbe',
      'v23ShortDeck',
      'v32FacingDefense',
      'v33DepthCeiling',
      'v62RiverBettorPolarity',
      'readPostflopFoldRate',
    ])
      expectStatus(name, 'harm', /^declared evaluation measured harm/);
    expectStatus('omahaNeutralUnknown', 'harm', /failed evaluation/);
    expectStatus('fixedLimitRiverFullBetRead', 'harm', /failed evaluation/);
    // WooWoo 48-hour audit of 2026-11-18: measured harm on real hands, switched off live 01:42:08Z
    expectStatus(
      'omahaReraisedPotFlopContinueNeedsEquityShape',
      'harm',
      /^WooWoo 48-hour audit, 2026-11-18 /
    );
    expectStatus(
      'plo6NoMultiwayBetWithWeakMadeHand',
      'hold',
      /^owner order 2026-11-17 11:49 America\/Chicago \(no blanket rules/
    );
    // PLO Strategy's declared evaluations of 2026-11-15 that FAILED: off-only, each citing its inbox record
    for (const name of [
      'omahaReraisedPotDiscipline',
      'omahaOnePairDiscipline',
      'omahaBeatenMadeHandDefense',
      'omahaBluffCatcherRaiseFold',
      'omahaNutClassValueSize',
    ]) {
      expectStatus(
        name,
        'harm',
        /^PLO Strategy evaluation result, inbox 2026-11-15T\d\d:\d\d:\d\dZ \(/
      );
      expect(OPTION_SWITCH_OFF_ONLY[name]!.reason, name).toMatch(
        /^failed its declared evaluation: .*z -\d/
      );
    }
    // inconclusive or not yet evaluated: registered on/off (the activation manifest keeps them OFF)
    for (const name of [
      'omahaReraisedPotStackOffFold',
      'omahaReraisedPotStackOffRealistic',
      'fixedLimitHiLoNutLowRiverBet',
      'fixedLimitRiverOneBetValueRaise',
      'fixedLimitHiLoLowHalfFloor',
      'fixedLimitOmahaNoPresumption',
    ])
      expect(optionSwitchOffOnly(name), name).toBeNull();
    // 2026-11-20: measured harm in the scripted fixed-limit league field (PR #11565), off-only since
    expectStatus(
      'fixedLimitCallIsNotACommitment',
      'harm',
      /^league card flh_call_is_not_a_commitment_vs_maniac and _vs_tight_value, PR #11565 /
    );
    expect(OPTION_SWITCH_OFF_ONLY.fixedLimitCallIsNotACommitment!.reason).toMatch(/z -4\.53/);
    // 2026-11-21: measured harm in the scripted no-limit league field (PR #11634), off-only since
    expectStatus(
      'holdemCommittedNoPairIsPriced',
      'harm',
      /^league card nlh_committed_no_pair_is_priced_vs_value_barreler and _vs_pot_barreler, PR #11634 /
    );
    expect(OPTION_SWITCH_OFF_ONLY.holdemCommittedNoPairIsPriced!.reason).toMatch(/z -3\.02/);
    expectStatus(
      'holdemDangerBoardEquityIsPriced',
      'harm',
      /^league card nlh_danger_board_equity_is_priced_vs_danger_bettor and _vs_danger_value, PR #11634 /
    );
    expect(OPTION_SWITCH_OFF_ONLY.holdemDangerBoardEquityIsPriced!.reason).toMatch(/z -9\.74/);
    // 2026-11-21: measured harm in declared human-calibrated PLO6 field (eval-40aba893fbc9), off-only since
    expectStatus('plo6FacingBetIsPriced', 'harm', /^DECLARATION-PLO6-FACING-BET-IS-PRICED\.md/);
    expect(OPTION_SWITCH_OFF_ONLY.plo6FacingBetIsPriced!.reason).toMatch(/z = -5\.84/);
    expectStatus('v55OmahaRiverTripsFlat', 'superseded', /made-hand defense repair/);
    expect(OPTION_SWITCH_OFF_ONLY.commitUnderPot!.reason).toMatch(/RESULTS-HU-NLH-016, FAIL/);
    // future options are held by name pattern: a steal, All-In-Or-Fold widening
    for (const name of [
      'plo6BlindSteal',
      'omahaTightOpponentSteal',
      'allInOrFoldWidening',
      'aofWidening',
    ])
      expect(optionSwitchOffOnly(name)?.status, name).toBe('hold');
    expect(optionSwitchOffOnly('omahaHiLoTournamentFirstIn')).toBeNull();
    // one source of truth: a named entry is a registered ledger option, or is on the explicit pending list
    for (const name of Object.keys(OPTION_SWITCH_OFF_ONLY)) {
      expect(optionSwitchRefusal(name), name).toBeNull();
      expect(
        OPTION_SWITCH_PLAIN_NAMES.includes(name) !== OPTION_SWITCH_OFF_ONLY_PENDING.includes(name),
        `${name} is off-only by name: it must be a registered ledger option, or be listed in OPTION_SWITCH_OFF_ONLY_PENDING until it lands (and leave that list when it does)`
      ).toBe(true);
    }
    for (const name of OPTION_SWITCH_OFF_ONLY_PENDING) {
      expect(Object.hasOwn(OPTION_SWITCH_OFF_ONLY, name), name).toBe(true);
      expect(ledgerFlags, name).not.toContain(name);
    }
    expect(OPTION_SWITCH_OFF_ONLY_PENDING.length).toBeLessThanOrEqual(4);
    expect([...OPTION_SWITCH_OFF_ONLY_NAMES]).toEqual(
      OPTION_SWITCH_PLAIN_NAMES.filter((n) => optionSwitchOffOnly(n) !== null)
    );
    expect(sorted([...OPTION_SWITCH_OFF_ONLY_NAMES, ...OPTION_SWITCH_ON_OFF_NAMES])).toEqual(
      sorted(OPTION_SWITCH_PLAIN_NAMES)
    );
    expect(OPTION_SWITCH_OFF_ONLY_NAMES.length).toBeGreaterThanOrEqual(19);
    // measured harm is off-only for an option that ships off; the one exception is v24PloDefense, whose default
    // carries a PLO6-cash carve-out: off-only there only stops an explicit true
    for (const entry of OPTION_SWITCH_PLAIN_REGISTRY)
      if (entry.offOnly?.status === 'harm')
        expect(entry.releaseDefault, entry.name).toBe(
          entry.name === 'v24PloDefense' ? 'code' : 'off'
        );
    expectStatus('v24PloDefense', 'harm', /PLO6-cash measured-harm carve-out/);
    for (const name of [
      'plo6TopSetNutRealization',
      'omahaCommitZoneThreeBetPriceRelief',
      'lightningParticipationOmaha',
    ])
      expectStatus(name, 'hold', /^owning lane keeps it OFF/);
    // enforced: the registry, the parser (the whole set is invalid), the decision options, module load
    for (const name of OPTION_SWITCH_OFF_ONLY_NAMES) {
      const entry = OPTION_SWITCH_PLAIN_REGISTRY.find((e) => e.name === name)!;
      expect([...entry.states], name).toEqual(['off']);
      expect(optionSwitchStatesFrom({ [name]: 'on' }), name).toBeNull();
      expect(parseOptionSwitchConfig(v2({ [name]: 'on', v16Ratio: 'off' })), name).toEqual({
        ok: false,
      });
      expect(optionSwitchDecisionOpts({ [name]: 'on' } as never), name).toEqual({});
      expect(optionSwitchStatesFrom({ [name]: 'off' }), name).toEqual({ [name]: 'off' });
      expect(optionSwitchDecisionOpts({ [name]: 'off' }), name).toEqual({ [name]: false });
      expect(
        () =>
          assertOptionSwitchRegistry(
            OPTION_SWITCH_REGISTRY.map((e) =>
              e.name === name ? { ...entry, states: ['off', 'on'] as const } : e
            )
          ),
        name
      ).toThrow(/is off-only/);
      const notes: string[] = [];
      let raw: unknown = v2({ v16Ratio: 'off' });
      const holder = new OptionSwitchHolder(
        (now) => ({ kind: 'present', raw, receivedAtMs: now }),
        (f) => notes.push(f)
      );
      expect(holder.refresh(0)).toEqual({ v16Ratio: 'off' });
      raw = v2({ [name]: 'on', v16Ratio: 'off' });
      expect(holder.refresh(60_000), name).toEqual({});
      expect(notes, name).toContain('option_switch_config_invalid_seen');
      expect(notes, name).not.toContain(`option_switch_${name}_on_seen`);
    }
  });

  it('a worker that starts while an on row exists for an off-only option never applies it, on its very first read', async () => {
    for (const held of ['commitUnderPot', 'huBbDefendsToPrice', 'omahaTightOpponent', 'v16Hu']) {
      const w = opened({ wired: true });
      expect(w.deliver(v2({ [held]: 'on', v16Ratio: 'off' }))).toBe(true);
      const look = await w.fast();
      for (const opts of look.opts) expect(switchedKeys(opts), held).toEqual([]);
      expect(look.replayState.version, held).toBe(V3);
      expect(w.features, held).toContain('option_switch_config_invalid_seen');
      expect(w.features, held).not.toContain(`option_switch_${held}_on_seen`);
      await closeAll();
    }
  });

  it('the database: on for a non-style option needs the option OWN citation, at the set function and at the table', () => {
    expect(OPTION_SWITCH_ON_AUTHORITY).toBe(
      'OWNER-MESSAGE-20261114-2201CT-EVERY-FEATURE-ON-WITH-SWITCH.md sha256 2080c2026d5553e11ac288a74fcef51d20f81b30c0a9da446b5063a9f7196bf1'
    );
    expect(OPTION_SWITCH_ON_AUTHORITY).toBe(
      `${OPTION_SWITCH_ON_AUTHORITY_FILE} sha256 ${OPTION_SWITCH_ON_AUTHORITY_SHA256}`
    );
    const note = noteFor('omahaHiLoTournamentFirstIn');
    expect(note).toBe(`authority: omahaHiLoTournamentFirstIn ${OPTION_SWITCH_ON_AUTHORITY}`);
    expect(note.length).toBeLessThanOrEqual(500);
    for (const name of OPTION_SWITCH_ON_OFF_NAMES) {
      expect(optionSwitchOnNoteCites(name, noteFor(name)), name).toBe(true);
      expect(noteFor(name).length, name).toBeLessThanOrEqual(500);
    }
    // junk, the generic authority of the previous rule, another option's citation, a missing sha256
    for (const bad of [
      'try on',
      'authority: 0123456789abc',
      `authority: ${OPTION_SWITCH_ON_AUTHORITY}`,
      noteFor('readScopedShrink'),
      noteFor('omahaHiLoTournamentFirstInX'),
      `authority: omahaHiLoTournamentFirstIn ${OPTION_SWITCH_ON_AUTHORITY_FILE}`,
      `authority: omahaHiLoTournamentFirstIn file sha256 ${'A'.repeat(64)}`,
      null,
      undefined,
      '',
    ])
      expect(optionSwitchOnNoteCites('omahaHiLoTournamentFirstIn', bad), String(bad)).toBe(false);
    expect(() => optionSwitchOnNote('x y', 'f.md', 'a'.repeat(64))).toThrow();
    expect(() => optionSwitchOnNote('v16Ratio', 'f.md', 'a'.repeat(63))).toThrow();
    expect(() => optionSwitchOnNote('v16Ratio', 'two words.md', 'a'.repeat(64))).toThrow();
    // the table, any writer: the row trigger lets a style option through, then asks every other 'on' for the
    // option's own citation (the rule the CHECK ca_horse_style_switch_on_cites_authority held, under its name)
    const rules = rowRules();
    const cites = rules.search(
      /IF NEW\.state IN \('on', 'on_shadow'\)\s+AND NOT coalesce\(NEW\.note LIKE 'authority: ' \|\| NEW\.option \|\| ' %' AND NEW\.note ~ 'sha256 \[0-9a-f\]\{64\}', false\) THEN\s+RAISE EXCEPTION [^;]*CONSTRAINT = 'ca_horse_style_switch_on_cites_authority';/
    );
    expect(cites).toBeGreaterThan(rules.search(/IF v_kind = 'style' THEN[\s\S]*?RETURN NULL;/));
    expect(rules.search(/IF v_kind = 'style' THEN[\s\S]*?RETURN NULL;/)).toBeGreaterThan(0);
    expect(SQL).not.toMatch(/on_needs_evidence|promotion evidence|length\(note\) >= 24/);
    const body = fn('fn_ca_horse_option_switch_set').body;
    const guard = body.search(
      /IF p_state = 'on' AND NOT \('shadow' = ANY \(v_states\)\)\s*AND NOT \(p_note IS NOT NULL AND p_note LIKE 'authority: ' \|\| p_option \|\| ' %'\s*AND p_note ~ 'sha256 \[0-9a-f\]\{64\}'\) THEN\s*RAISE EXCEPTION 'option % may be set on only with a note that cites its own authority \(authority: % <file> sha256 <64 hex>\)'/
    );
    // an off-only option is refused first, with any note: the states check precedes the note check
    const statesGuard = body.search(
      /IF p_state IS NULL OR NOT \(p_state = ANY \(v_states\)\) THEN/
    );
    expect(statesGuard).toBeGreaterThan(0);
    expect(statesGuard).toBeLessThan(guard);
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(body.search(/INSERT INTO/));
    // the audit row keeps the note, the actor and the time
    expect(body).toMatch(/VALUES \(p_option, v_old, p_state, p_actor, v_at, p_note\);/);
    // the old style setter writes the seven style names only, so it cannot write on for any other option
    const oldSetter = read(
      'supabase/migrations/20261113201841_the_horse_style_read_has_a_live_switch.sql'
    );
    expect(oldSetter).toMatch(/p_option NOT IN \('styleValueBettorNotManiac'/);
  });

  it('the database half is proven by execution on a throwaway PostgreSQL 17 in the required accounting_postgres job, over exactly these option lists', () => {
    const ci = read('.github/workflows/ci.yml');
    const job = ci.slice(ci.search(/^  accounting_postgres:\s*$/m));
    const block = job.slice(0, job.slice(1).search(/^  [A-Za-z0-9_-]+:\s*$/m) + 1);
    expect(block).toMatch(
      /- name: The Horse option switch [^\n]*\n\s+if: matrix\.shard == \d\n\s+env:\n\s+PG_BIN: \/usr\/lib\/postgresql\/17\/bin\n\s+TMPDIR: \$\{\{ runner\.temp \}\}\n\s+run: bash scripts\/ci\/test-horse-option-switch-evidence-postgres\.sh\n/
    );
    // no second workflow of its own: the repository's real-PostgreSQL proofs run in that job
    expect(existsSync(join(REPO, '.github/workflows/horse-option-switch-evidence-proof.yml'))).toBe(
      false
    );
    const script = read('scripts/ci/test-horse-option-switch-evidence-postgres.sh');
    const list = (name: string) => {
      const found = new RegExp(`^${name}='([^']*)'$`, 'm').exec(script);
      expect(found, name).not.toBeNull();
      return found![1]!.split(/\s+/);
    };
    // the script carries no option list of its own to drift: it proves the switch as installed over the frozen
    // lists of the last full-list migration, then installs the whitelist migration, requires the seeded rows to be
    // exactly those lists, and proves every row of the table (the registered ones included) from any writer
    for (const variable of ['style', 'plain', 'offonly', 'shadow', 'onshadow'])
      expect(script, variable).not.toMatch(new RegExp(`^${variable}='`, 'm'));
    expect(script).toContain(
      `list_migration="$repo/supabase/migrations/${OPTION_SWITCH_LAST_LIST_MIGRATION}"`
    );
    expect(script).toContain(`$repo/supabase/migrations/${OPTION_SWITCH_WHITELIST_MIGRATION}}"`);
    for (const line of [
      'the seeded whitelist: the other options are the installed ones',
      'the seeded whitelist: the off-only options are the installed ones, each held by the seed',
      'the seeded whitelist: the options at shadow level shadow are the installed shadow options',
      'the seeded whitelist: the options at shadow level on_shadow or shadow are the installed on_shadow options',
      'two registrations of one name keep the LOWER shadow level',
      'a plain UPDATE does not widen a shadow level',
      'a level is not narrowed under a switch row in a state it would lose',
      'over an older full list the whitelist migration refuses to install',
      'give the same whitelist in either install order',
      'a stale register (off-only false) did not lift the hold another migration put on v7',
      'an un-lock that does not name every holder lifts nothing',
      'keeps its rules from any writer and at the setter; an unregistered one is refused',
      'the setters, the readers, the evidence record and the serving-registry guard are not redefined, and keep their grants',
    ])
      expect(script, line).toContain(line);
    for (const name of REFUSED_NAMES) expect(list('refused'), name).toContain(name);
    expect(script).toContain(
      `authority_tail='${OPTION_SWITCH_ON_AUTHORITY_FILE} sha256 ${OPTION_SWITCH_ON_AUTHORITY_SHA256}'`
    );
    // a proof that did not run is not a pass
    expect(script).not.toMatch(/SKIPPED/);
    expect(script).toMatch(/^\s*echo "FAIL  no PostgreSQL binaries .*exit 1$/m);
    expect(script).toMatch(/^  echo 'PASS  every option switch evidence assertion held'$/m);
  });

  it('the engine accepts on and off for every registered option that is not off-only: on passes true, off passes false', () => {
    expect(OPTION_SWITCH_ON_OFF_NAMES.length).toBeGreaterThan(100);
    for (const name of OPTION_SWITCH_ON_OFF_NAMES) {
      expect(optionSwitchStatesFrom({ [name]: 'on' }), name).toEqual({ [name]: 'on' });
      expect(optionSwitchStatesFrom({ [name]: 'off' }), name).toEqual({ [name]: 'off' });
      expect(parseOptionSwitchConfig(v2({ [name]: 'on' })), name).toEqual({
        ok: true,
        states: { [name]: 'on' },
      });
      expect(optionSwitchDecisionOpts({ [name]: 'on' }), name).toEqual({ [name]: true });
      expect(optionSwitchDecisionOpts({ [name]: 'off' }), name).toEqual({ [name]: false });
      for (const state of ['canary', 'default', '', true, 1, null])
        expect(optionSwitchStatesFrom({ [name]: state }), name).toBeNull();
      // shadow: accepted exactly for the shadow options, and it passes nothing to the decision (release default)
      if (OPTION_SWITCH_SHADOW_NAMES.includes(name)) {
        expect(optionSwitchStatesFrom({ [name]: 'shadow' }), name).toEqual({ [name]: 'shadow' });
        expect(optionSwitchDecisionOpts({ [name]: 'shadow' }), name).toEqual({});
      } else expect(optionSwitchStatesFrom({ [name]: 'shadow' }), name).toBeNull();
      // on_shadow (2026-11-19): accepted exactly for the on_shadow options, and it passes true, exactly as on
      if (OPTION_SWITCH_ON_SHADOW_NAMES.includes(name)) {
        expect(optionSwitchStatesFrom({ [name]: 'on_shadow' }), name).toEqual({
          [name]: 'on_shadow',
        });
        expect(optionSwitchDecisionOpts({ [name]: 'on_shadow' }), name).toEqual({ [name]: true });
      } else expect(optionSwitchStatesFrom({ [name]: 'on_shadow' }), name).toBeNull();
    }
    const notes: string[] = [];
    let raw: unknown = v2({ v16Hu: 'off' });
    const holder = new OptionSwitchHolder(
      (now) => ({ kind: 'present', raw, receivedAtMs: now }),
      (f) => notes.push(f)
    );
    expect(holder.refresh(0)).toEqual({ v16Hu: 'off' });
    raw = v2({ v16Ratio: 'on', commitUnderPot: 'off' });
    expect(holder.refresh(60_000)).toEqual({ v16Ratio: 'on', commitUnderPot: 'off' });
    expect(notes).toEqual(
      expect.arrayContaining([
        'option_switch_v16Ratio_on_seen',
        'option_switch_commitUnderPot_off_seen',
      ])
    );
    // a parameter is not a switch: the whole set is invalid
    for (const name of Object.keys(OPTION_SWITCH_NOT_A_SWITCH))
      expect(parseOptionSwitchConfig(v2({ [name]: 'on', v16Hu: 'off' })), name).toEqual({
        ok: false,
      });
  });

  /**
   * THE LIFECYCLE RULE (lane.ts, styleSwitchFirstDelivery and spawnShardClient): a started, restarted or replaced
   * worker resolves the persisted switch state before it serves a decision that reads a switched option. The lane
   * is not handed out until the first read has reached every shard (or has failed), and a replacement shard is
   * handed the last delivery as its first message: lane.test.ts and oneShardsLossIsOneShardsLoss.law.test.ts prove
   * both with the pool. So the delivery is in a new worker's inbox before its first decision, and these two tests
   * prove what that first decision does with it.
   */
  it('a worker that starts while a valid row exists (style on, plain off) decides its very first decision with it', async () => {
    const w = opened({ wired: true });
    expect(w.deliver(v2({ v16Hu: 'off' }, { styleFoldBluff: 'on' }))).toBe(true);
    const look = await w.fast();
    expect(look.opts.length).toBeGreaterThan(0);
    for (const opts of look.opts) {
      expect(switchedKeys(opts)).toEqual(['v16Hu']);
      expect(opts.v16Hu).toBe(false);
      expect(opts.styleFoldBluff).toBe(true);
    }
    expect(look.replayState.options).toEqual({ v16Hu: 'off' });
    expect(look.replayState.style).toEqual(expect.objectContaining({ styleFoldBluff: 'on' }));
    expect(w.features).toContain('option_switch_v16Hu_off_seen');
  });

  it('the lane resolves the switch state before it serves: the first read is awaited, and a replacement is handed the last delivery', () => {
    const lane = code('server/src/engine/horseDecision/lane.ts');
    expect(lane).toMatch(
      /styleSwitchFirstDelivery = styleSwitchDelivery\.start\(\)\.catch\(\(\) => undefined\);\s*\}\s*if \(styleSwitchFirstDelivery\) await styleSwitchFirstDelivery;\s*return singleton;/
    );
    expect(lane).toMatch(
      /onFatal: \(error\) => this\.shardFailed\(index, client, error\),\s*\}\);\s*if \(this\.lastStyleSwitch\) client\.postStyleSwitch\(this\.lastStyleSwitch\);\s*return client;/
    );
    expect(lane).toMatch(
      /broadcastStyleSwitch\(message: StyleSwitchStateMessage\): void \{\s*this\.lastStyleSwitch = message;/
    );
  });

  it('a worker that starts while an on row exists applies it on its very first decision: on passes true', async () => {
    const w = opened({ wired: true });
    expect(w.deliver(v2({ v16Ratio: 'on', v16Hu: 'off' }))).toBe(true);
    const look = await w.fast();
    expect(look.opts.length).toBeGreaterThan(0);
    for (const opts of look.opts) {
      expect(switchedKeys(opts).sort()).toEqual(['v16Hu', 'v16Ratio']);
      expect(opts.v16Ratio).toBe(true);
      expect(opts.v16Hu).toBe(false);
    }
    expect(look.replayState.version).toBe(V5);
    expect(look.replayState.options).toEqual({ v16Hu: 'off', v16Ratio: 'on' });
    expect(w.features).toContain('option_switch_v16Ratio_on_seen');
  });

  it('a worker that starts while a row names a refused option or decision plumbing never applies it, on its very first read', async () => {
    for (const bad of [
      'v54RiverBluff',
      'phase13Joint',
      'v87DeepDiveDiscipline',
      'telemetry',
      'mind',
    ]) {
      const w = opened({ wired: true });
      expect(w.deliver(v2({ [bad]: 'on', v16Hu: 'off' }))).toBe(true);
      const look = await w.fast();
      for (const opts of look.opts) expect(switchedKeys(opts), bad).toEqual([]);
      expect(look.replayState.version, bad).toBe(V3);
      expect(w.features, bad).toContain('option_switch_config_invalid_seen');
      expect(w.features, bad).not.toContain(`option_switch_${bad}_on_seen`);
      await closeAll();
    }
  });
});

describe('the refused options are refused on both sides', () => {
  it('no registered option is a refused one, and registering one throws where the registry is declared', () => {
    for (const entry of OPTION_SWITCH_REGISTRY)
      expect(optionSwitchRefusal(entry.name), entry.name).toBeNull();
    for (const name of REFUSED_NAMES) {
      expect(OPTION_SWITCH_NAMES, name).not.toContain(name);
      expect(optionSwitchRefusal(name), name).toEqual(expect.any(String));
      expect(
        () =>
          assertOptionSwitchRegistry([
            ...OPTION_SWITCH_REGISTRY,
            { ...OPTION_SWITCH_PLAIN_REGISTRY[0]!, name },
          ]),
        name
      ).toThrow(/may not be registered/);
    }
  });

  it('the database whitelist names none of them, and set and clear refuse a name that is not registered', () => {
    const whitelisted = new Set(whitelistOfMain().whitelist.keys());
    for (const name of OPTION_SWITCH_NAMES) expect(whitelisted.has(name), name).toBe(true);
    for (const name of REFUSED_NAMES) expect(whitelisted.has(name), name).toBe(false);
    for (const name of ['fn_ca_horse_option_switch_set', 'fn_ca_horse_option_switch_clear']) {
      const body = fn(name).body;
      const guard = body.indexOf("RAISE EXCEPTION 'not a switchable option: %'");
      expect(guard, name).toBeGreaterThan(0);
      expect(body.slice(0, guard), name).toMatch(/fn_ca_horse_option_switch_states\(p_option\)/);
      // the refusal comes before any row is written
      expect(guard, name).toBeLessThan(body.search(/INSERT INTO|DELETE FROM/));
    }
    // the installed migration proves the refusal by execution: its read-back raises when a held option answers
    const readback = SQL.slice(SQL.indexOf('$readback$'));
    for (const name of [
      'v54RiverBluff',
      'v53PloTourneyIcm',
      'phase13Joint',
      'v87DeepDiveDiscipline',
      'v31GtoSuitAware',
      'vpipFloorDeepStackOff',
      'comboDrawPressure',
      'omahaPreflopCallWithActionBehind',
      'notAnOption',
    ])
      expect(readback, name).toContain(`fn_ca_horse_option_switch_states('${name}') IS NOT NULL`);
    // and names no registered option as refused
    for (const name of OPTION_SWITCH_NAMES)
      expect(readback, name).not.toContain(
        `fn_ca_horse_option_switch_states('${name}') IS NOT NULL`
      );
  });

  it('the worker ignores them: a delivery naming one switches nothing, and no key reaches the brain', () => {
    for (const name of REFUSED_NAMES) {
      expect(parseOptionSwitchConfig(v2({ [name]: 'on' })), name).toEqual({ ok: false });
      expect(optionSwitchStatesFrom({ [name]: 'on' }), name).toBeNull();
    }
    // A name this build does not know at all is skipped alone since 2026-11-20
    // (anUnknownOptionRowIsSkippedAlone.law.test.ts): it still switches nothing.
    for (const name of ['notAnOption', '__proto__', 'constructor']) {
      expect(parseOptionSwitchConfig(v2({ [name]: 'on' })), name).toEqual({ ok: true, states: {} });
      expect(optionSwitchStatesFrom({ [name]: 'on' }), name).toEqual({});
      expect(optionSwitchStatesFrom({ [name]: 'on', v16Hu: 'off' }), name).toEqual({
        v16Hu: 'off',
      });
    }
    for (const name of [...REFUSED_NAMES, 'notAnOption', '__proto__', 'constructor']) {
      expect(optionSwitchDecisionOpts({ [name]: 'on' } as never), name).toEqual({});
      expect(optionSwitchDecisionOpts({ [name]: 'on', v16Hu: 'off' } as never), name).toEqual({
        v16Hu: false,
      });
    }
  });
});

describe('condition 2: the switch is fleet-wide per option', () => {
  const WHO = /user_id|userid|horse_?id|club_?id|table_?id|player|seat|lane|id_range|tournament/i;

  it('the table keeps one key, the option name, and no function takes anything that names a Horse, club or table', () => {
    expect(FUNCTIONS.map((f) => `${f.name}(${f.args.replace(/\s+/g, ' ').trim()})`).sort()).toEqual(
      [
        'fn_ca_horse_option_switch_clear(p_option text, p_actor text, p_note text)',
        'fn_ca_horse_option_switch_effective()',
        'fn_ca_horse_option_switch_set(p_option text, p_state text, p_actor text, p_note text)',
        'fn_ca_horse_option_switch_states(p_option text)',
        'fn_ca_horse_style_switch_effective()',
      ]
    );
    // the option names themselves are data (one is named for a tournament): everything else is judged
    expect(SQL.replace(/'[A-Za-z0-9]+'/g, "''")).not.toMatch(WHO);
    expect(SQL).toMatch(/ON CONFLICT \(option\) DO UPDATE/);
  });

  it('the engine side reads nothing but the switched set', () => {
    expect(optionSwitchDecisionOpts.length).toBe(1);
    const source = code('server/src/engine/HorseOptionSwitch.ts')
      // the registry's scope and description strings are prose, and `owner` is the lane that maintains an option
      .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, "''");
    expect(source).not.toMatch(
      /user_id|userId|horseId|clubId|tableId|club_id|table_id|request\b|gameState/
    );
    const runtime = code('server/src/engine/horseDecision/workerRuntime.ts');
    const calls = [...runtime.matchAll(/optionSwitchDecisionOpts\(([^()]*)\)/g)].map((m) =>
      m[1]!.trim()
    );
    // the fast and the deep decision; readViewStates (2026-11-15): the FAST read view is given the same fleet-wide
    // switched set, so the observer reads carry an option's evidence when a switch row turns it on
    // (workerRuntime.readViewOpts); and (2026-11-15, F1 live switch) the process switches applied before every
    // job (applyProcessSwitches): the same holder, the same clock, the same switched set and nothing else
    expect(calls.sort()).toEqual(['deepOptionStates', 'optionStates', 'readViewStates', 'states']);
    const refreshes = [...runtime.matchAll(/this\.optionSwitch\.refresh\(([^;]*)\);/g)].map((m) =>
      m[1]!.trim()
    );
    expect(refreshes).toEqual([
      'performance.now()',
      'performance.now()',
      'performance.now()',
      'performance.now()',
    ]);
  });
});

describe('conditions 3 and 5: readable, audited, and written by service_role only', () => {
  it('set and clear each write the audit table with the actor and the time, and refuse a missing actor', () => {
    for (const name of ['fn_ca_horse_option_switch_set', 'fn_ca_horse_option_switch_clear']) {
      const body = fn(name).body;
      expect(body, name).toMatch(
        /INSERT INTO public\.ca_horse_style_switch_audit \(option, old_state, new_state, changed_by, changed_at, note\)\s*VALUES \(p_option, v_old, (p_state|'default'), p_actor, v_at, p_note\);/
      );
      expect(body, name).toMatch(/v_at\s+timestamptz := now\(\);/);
      expect(body, name).toMatch(
        /IF p_actor IS NULL OR length\(p_actor\) NOT BETWEEN 1 AND 200 THEN\s*RAISE EXCEPTION 'an actor is required';/
      );
      // the same per-option lock as the style writer, so two writers of one option never interleave
      expect(body, name).toContain(
        "pg_advisory_xact_lock(hashtext('ca_horse_style_switch:' || p_option))"
      );
    }
  });

  it('the effective read names every option that has a row: the style half and the rest', () => {
    const wide = fn('fn_ca_horse_option_switch_effective').body;
    expect(wide).toContain("'version', 2");
    expect(wide).toContain("'style', public.fn_ca_horse_style_switch_effective()");
    expect(wide).toMatch(
      /WHERE NOT \(public\.fn_ca_horse_option_switch_states\(s\.option\) @> ARRAY\['shadow'\]\)/
    );
    expect(fn('fn_ca_horse_style_switch_effective').body).toMatch(
      /WHERE public\.fn_ca_horse_option_switch_states\(s\.option\) @> ARRAY\['shadow'\]/
    );
  });

  it('every function pins its search_path, and only service_role may execute any of them', () => {
    for (const f of FUNCTIONS) {
      expect(f.header, f.name).toMatch(/SET search_path = pg_catalog, public/);
      const signature = `public.${f.name}(${f.args
        .split(',')
        .map((a) => a.trim().split(/\s+/).pop())
        .filter(Boolean)
        .join(', ')})`;
      expect(SQL, f.name).toContain(
        `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC, anon, authenticated;`
      );
      expect(SQL, f.name).toContain(`GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`);
    }
    for (const name of [
      'fn_ca_horse_option_switch_set',
      'fn_ca_horse_option_switch_clear',
      'fn_ca_horse_option_switch_effective',
    ])
      expect(fn(name).header, name).toMatch(/SECURITY DEFINER/);
    const grants = [...SQL.matchAll(/GRANT\s+[^;]*?\sTO\s+([^;]*);/g)].map((m) => m[1]!.trim());
    expect(grants.length).toBeGreaterThan(0);
    expect([...new Set(grants)]).toEqual(['service_role']);
    // service_role reads the tables and writes them only through the functions
    expect([...SQL.matchAll(/GRANT\s+(\w+)\s+ON TABLE/g)].map((m) => m[1])).toEqual([
      'SELECT',
      'SELECT',
    ]);
  });

  it('the migration adds no row: nothing is switched by installing it', () => {
    const outside = SQL.replace(/\$function\$[\s\S]*?\$function\$/g, '');
    expect(outside).not.toMatch(
      /INSERT INTO|UPDATE public|DELETE FROM|fn_ca_horse_option_switch_set\('|fn_ca_horse_style_switch_set\(/
    );
  });
});

describe('condition 4: nothing switched is the release default', () => {
  it('the resolved options of an empty switch are exactly nothing, for every registered option', () => {
    for (const empty of [{}, null, undefined, optionSwitchStatesFrom({})])
      expect(optionSwitchDecisionOpts(empty)).toEqual({});
    const parsed = parseOptionSwitchConfig(v2({}));
    expect(parsed).toEqual({ ok: true, states: {} });
    const holder = new OptionSwitchHolder(
      (now) => ({ kind: 'present', raw: v2({}), receivedAtMs: now }),
      () => {}
    );
    expect(optionSwitchDecisionOpts(holder.refresh(0))).toEqual({});
    for (const name of OPTION_SWITCH_PLAIN_NAMES)
      expect(Object.hasOwn(optionSwitchDecisionOpts(holder.current()), name), name).toBe(false);
  });

  it('a real decision with an empty switch is handed what it was handed with no switch at all, and journals the same', async () => {
    const before = await baseline();
    expect(before.replayState.version).toBe(V3);
    for (const config of [v2({}), { version: 1, options: {} }, 'nothing delivered'] as const) {
      const w = opened({ wired: true });
      if (config !== 'nothing delivered') expect(w.deliver(config)).toBe(true);
      const look = await w.fast();
      expect(handed(look.opts)).toEqual(handed(before.opts));
      for (const opts of look.opts) expect(switchedKeys(opts)).toEqual([]);
      expect(look.replayState).toEqual(before.replayState);
      expect(wagerOf(look.result.decision)).toEqual(wagerOf(before.result.decision));
      expect(look.result.rngAfter).toBe(before.result.rngAfter);
      expect(w.features.filter((f) => f.startsWith('option_switch'))).toEqual([]);
      await closeAll();
    }
  });

  it('a row reaches a real decision as off = false and on = true, the same way for every decision, and is journaled', async () => {
    const before = await baseline();
    const w = opened({ wired: true });
    w.deliver(v2({ v16Ratio: 'off', v16Hu: 'off' }));
    for (const requestId of [1, 2]) {
      const look = await w.fast(requestId);
      for (const opts of look.opts) {
        expect(switchedKeys(opts).sort()).toEqual(['v16Hu', 'v16Ratio']);
        expect(opts.v16Ratio).toBe(false);
        expect(opts.v16Hu).toBe(false);
      }
      expect(look.replayState.version).toBe(V5);
      expect(look.replayState.options).toEqual({ v16Hu: 'off', v16Ratio: 'off' });
    }
    expect(w.features).toEqual(
      expect.arrayContaining(['option_switch_v16Hu_off_seen', 'option_switch_v16Ratio_off_seen'])
    );
    // without the wiring the same request carries neither key: the guard above is not vacuous
    for (const opts of before.opts) expect(switchedKeys(opts)).toEqual([]);
  });
});

describe('condition 1: a switch never reaches what an authority or the manifest owns', () => {
  const AUTHORITY_KEY = (k: string) =>
    (HORSE_FEATURE_FLAGS as readonly string[]).includes(k) ||
    k === 'v53PloTourneyIcm' ||
    /^phase\d/.test(k);

  it('with every registered option switched (on, or off where it is off-only), the authority-owned options a real decision is handed do not move', async () => {
    const manifestBefore = manifestNow();
    const before = await baseline();
    const w = opened({ wired: true });
    w.deliver(
      v2(Object.fromEntries(OPTION_SWITCH_PLAIN_REGISTRY.map((e) => [e.name, e.states.at(-1)!])))
    );
    const look = await w.fast();
    const pick = (opts: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(opts).filter(([k]) => AUTHORITY_KEY(k)));
    expect(look.opts.length).toBeGreaterThan(0);
    expect(Object.keys(pick(before.opts.at(-1)!)).length).toBeGreaterThan(
      HORSE_FEATURE_FLAGS.length
    );
    expect(pick(look.opts.at(-1)!)).toEqual(pick(before.opts.at(-1)!));
    expect(switchedKeys(look.opts.at(-1)!).sort()).toEqual(sorted(OPTION_SWITCH_PLAIN_NAMES));
    // with no switch at all a decision carries no registered key: the worker hands none of them itself
    expect(switchedKeys(before.opts.at(-1)!)).toEqual([]);
    // the published manifest does not depend on the switch
    expect(manifestNow()).toBe(manifestBefore);
    for (const name of OPTION_SWITCH_NAMES) expect(AUTHORITY_KEY(name), name).toBe(false);
  });

  it('the worker-owned keys are written after the switched ones in the fast and the deep decision', () => {
    const runtime = code('server/src/engine/horseDecision/workerRuntime.ts');
    const owned = /^\s*v53PloTourneyIcm: this\.tournamentFlagOn\(request\),\s*phase8Postflop:/;
    const afterFast = runtime.split('...styleBrainOpts,\n')[1]!;
    expect(afterFast).toMatch(/^\s*\.\.\.optionBrainOpts,/);
    expect(afterFast.replace(/^\s*\.\.\.optionBrainOpts,/, '')).toMatch(owned);
    const afterDeep = runtime.split('...optionSwitchDecisionOpts(deepOptionStates),')[1]!;
    expect(afterDeep).toMatch(owned);
    // and the switched options are spread after the request's own, never before
    expect(runtime).not.toMatch(
      /\.\.\.(optionBrainOpts|optionSwitchDecisionOpts\([^)]*\)),\s*\.\.\.(request\.opts|features\.flags)/
    );
  });
});

describe('condition 6: a failed or malformed read leaves the release default and never stops a decision', () => {
  it.each([
    ['an option this engine does not know', v2({ somethingNewer: 'on', v16Hu: 'on' })],
    ['a refused option', v2({ v54RiverBluff: 'on', v16Hu: 'on' })],
    ['a parameter', v2({ decisionTimeMs: 'on', v16Hu: 'on' })],
    ['a state that is not one', v2({ v16Hu: 7 })],
    ['shadow for an option without a shadow arm', v2({ v16Hu: 'shadow' })],
    [
      'options that are not an object',
      { version: 2, style: { version: 1, options: {} }, options: [['v16Hu', 'on']] },
    ],
    ['a string', 'garbage'],
    ['null', null],
    ['a number', 42],
    ['a nested bomb', v2({ v16Hu: { toString: 'on' } })],
  ])('%s: the decision completes with no switched option', async (_name, config) => {
    const before = await baseline();
    const w = opened({ wired: true });
    // a good configuration first, so the failure has something to take away
    w.deliver(v2({ v16Hu: 'off' }));
    const good = await w.fast(1);
    expect(good.opts.at(-1)!.v16Hu).toBe(false);
    w.advance(61_000);
    w.deliver(config);
    const look = await w.fast(2);
    for (const opts of look.opts) expect(switchedKeys(opts)).toEqual([]);
    expect(look.replayState.version).toBe(V3);
    expect(look.result.decision.action).toEqual(expect.any(String));
    expect(w.features).toEqual(
      expect.arrayContaining([
        'option_switch_config_invalid_seen',
        'option_switch_v16Hu_default_seen',
      ])
    );
    expect(before.replayState.version).toBe(V3);
  });

  it('unreadable, and deliveries that stop: back to the release default, not to the last value', async () => {
    const w = opened({ wired: true });
    w.deliver(v2({ v16Hu: 'off' }));
    expect((await w.fast(1)).opts.at(-1)!.v16Hu).toBe(false);
    w.advance(61_000);
    w.deliver(null, 'unreadable');
    const unreadable = await w.fast(2);
    for (const opts of unreadable.opts) expect(switchedKeys(opts)).toEqual([]);
    expect(w.features).toContain('option_switch_config_unreadable_seen');

    const stopped = opened({ wired: true });
    stopped.deliver(v2({ v16Hu: 'off' }));
    expect((await stopped.fast(1)).opts.at(-1)!.v16Hu).toBe(false);
    stopped.advance(121_000);
    const stale = await stopped.fast(2);
    for (const opts of stale.opts) expect(switchedKeys(opts)).toEqual([]);
    expect(stopped.features).toContain('option_switch_config_stale_seen');
  });

  it('a worker delivered nothing (no reading yet, or the first read failed) has nothing switched', async () => {
    const w = opened({ wired: true });
    const look = await w.fast();
    for (const opts of look.opts) expect(switchedKeys(opts)).toEqual([]);
    expect(look.replayState.version).toBe(V3);
  });
});

describe('condition 6: the read falls back only when the database does not have the wider function yet', () => {
  const rpc = (
    answers: Record<string, { data: unknown; error: { message?: string; code?: string } | null }>
  ) => {
    const called: string[] = [];
    return {
      called,
      call: async (name: string) => {
        called.push(name);
        return answers[name]!;
      },
    };
  };
  const WIDE = 'fn_ca_horse_option_switch_effective';
  const STYLE = 'fn_ca_horse_style_switch_effective';

  it('reads the wider function and nothing else when it answers', async () => {
    const r = rpc({ [WIDE]: { data: v2({ v16Hu: 'on' }), error: null } });
    await expect(readSwitchThrough(r.call)).resolves.toEqual(v2({ v16Hu: 'on' }));
    expect(r.called).toEqual([WIDE]);
  });

  it.each([
    [
      {
        code: 'PGRST202',
        message: 'Could not find the function public.fn_ca_horse_option_switch_effective',
      },
    ],
    [
      {
        code: '42883',
        message: 'function public.fn_ca_horse_option_switch_effective() does not exist',
      },
    ],
  ])(
    'a database without the migration (%o) is read through the style function: nothing else is switched',
    async (error) => {
      const style = { version: 1, options: { styleFoldBluff: 'on' } };
      const r = rpc({ [WIDE]: { data: null, error }, [STYLE]: { data: style, error: null } });
      const answer = await readSwitchThrough(r.call);
      expect(answer).toEqual(style);
      expect(r.called).toEqual([WIDE, STYLE]);
      expect(parseOptionSwitchConfig(answer)).toEqual({ ok: true, states: {} });
    }
  );

  it('any other failure rejects (the delivery then reports unreadable): nothing falls back silently', async () => {
    const r = rpc({
      [WIDE]: {
        data: null,
        error: { code: '57014', message: 'canceling statement due to statement timeout' },
      },
      [STYLE]: { data: { version: 1, options: {} }, error: null },
    });
    await expect(readSwitchThrough(r.call)).rejects.toThrow(/statement timeout/);
    expect(r.called).toEqual([WIDE]);
    const both = rpc({
      [WIDE]: { data: null, error: { code: 'PGRST202' } },
      [STYLE]: { data: null, error: { message: 'permission denied' } },
    });
    await expect(readSwitchThrough(both.call)).rejects.toThrow(/permission denied/);
  });
});

describe('condition 7: a decision replays with the switched set its record carries', () => {
  it('the record carries the set (v5), an older version carrying one is refused, and a refused option is not a valid record', async () => {
    const w = opened({ wired: true });
    w.deliver(v2({ v16Ratio: 'off', v16Hu: 'off' }));
    const { replayState } = await w.fast();
    expect(isHorseDecisionReplayState(replayState)).toBe(true);
    const record = (state: unknown) => ({ body: JSON.stringify({ replayState: state }) });
    expect(recordedSwitchStates(record(replayState))).toEqual({
      ok: true,
      states: null,
      options: { v16Hu: 'off', v16Ratio: 'off' },
    });
    expect(recordedSwitchStates(record({ ...replayState, version: V3 }))).toEqual({ ok: false });
    expect(
      recordedSwitchStates(record({ ...replayState, options: { v54RiverBluff: 'on' } }))
    ).toEqual({ ok: false });
    expect(recordedSwitchStates(record({ ...replayState, options: {} }))).toEqual({ ok: false });
    // a record carrying on for a registered option is a valid record
    expect(recordedSwitchStates(record({ ...replayState, options: { v16Ratio: 'on' } }))).toEqual({
      ok: true,
      states: null,
      options: { v16Ratio: 'on' },
    });
  });

  it('the replay wiring hands the brain the recorded set at any later time, with no live read', async () => {
    const live = opened({ wired: true });
    live.deliver(v2({ v16Ratio: 'off', v16Hu: 'off' }));
    const original = await live.fast();
    await closeAll();
    const recorded = optionSwitchStatesFrom(original.replayState.options);
    expect(recorded).not.toBeNull();

    // exactly what runtimeReplay.ts builds: a holder over the recorded set. Hours later, nothing delivered.
    const replay = opened({ recorded });
    replay.advance(6 * 3_600_000);
    const again = await replay.fast();
    expect(handed(again.opts)).toEqual(handed(original.opts));
    expect(again.replayState).toEqual(original.replayState);
    expect(wagerOf(again.result.decision)).toEqual(wagerOf(original.result.decision));
    await closeAll();

    // a record with nothing switched replays with nothing switched
    const none = opened({ recorded: null });
    for (const opts of (await none.fast()).opts) expect(switchedKeys(opts)).toEqual([]);
  });

  it('every replay entry point takes the set from the record', () => {
    const dir = 'server/src/engine/horseDecision/replay';
    expect(code(`${dir}/exactReplay.ts`)).toMatch(/optionStates: state\.options \?\? null/);
    expect(code(`${dir}/v56Counterfactual.ts`)).toMatch(/optionStates: state\.options \?\? null/);
    expect(code(`${dir}/HorseDecisionReplay.ts`)).toMatch(/optionStates: style\.options/);
    expect(code(`${dir}/runtimeReplay.ts`)).toMatch(
      /optionSwitch: new OptionSwitchHolder\(\s*optionSwitchSourceFromStates\(bindings\.optionStates\)/
    );
    for (const f of readdirSync(join(REPO, dir)).filter(
      (f) => f.endsWith('.ts') && !f.includes('.test.')
    ))
      expect(code(`${dir}/${f}`), f).not.toMatch(
        /styleSwitchDelivery|readStyleSwitchFromDatabase|readSwitchThrough|fn_ca_horse_option_switch_effective/
      );
  });
});
