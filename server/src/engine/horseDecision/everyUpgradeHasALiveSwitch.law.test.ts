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
 * WHEN THIS LAW FAILS ON THE DATABASE LISTS: the database whitelist is the NEWEST migration carrying the registry
 * markers (HorseOptionSwitchMigrationLists.ts). Migration 20261114072215 is installed and never edited; run
 * `npx tsx scripts/gen-horse-option-switch-sql.ts --follow-up <YYYYMMDDHHMMSS>_horse_option_switch_<what>` in server/
 * (a new migration re-asserting the lists; it also sets the lists of the PostgreSQL proof script).
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
  OPTION_SWITCH_BASE_MIGRATION,
  OPTION_SWITCH_MIGRATIONS_DIR,
  newestOptionSwitchListMigration,
  optionSwitchListDrift,
  optionSwitchListDriftMessage,
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
/** The database whitelist: the newest migration carrying the registry markers (the base, or its latest follow-up). */
const LIST_MIGRATION_PATH = newestOptionSwitchListMigration(
  readdirSync(join(REPO, OPTION_SWITCH_MIGRATIONS_DIR))
    .filter((name) => name.endsWith('.sql'))
    .map((name) => ({ name, text: read(`${OPTION_SWITCH_MIGRATIONS_DIR}/${name}`) }))
);
const LIST_SQL = read(LIST_MIGRATION_PATH).replace(/--[^\n]*/g, '');
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
/** The functions of the list migration (the base, or the newest follow-up that re-asserts the lists). */
const LIST_FUNCTIONS = [
  ...LIST_SQL.matchAll(
    /CREATE (OR REPLACE )?FUNCTION public\.(\w+)\(([^)]*)\)([\s\S]*?)AS \$function\$([\s\S]*?)\$function\$;/g
  ),
].map((m) => ({ replaced: !!m[1], name: m[2]!, args: m[3]!, header: m[4]!, body: m[5]! }));
const listFn = (name: string) => {
  const found = LIST_FUNCTIONS.find((f) => f.name === name);
  if (!found) throw new Error(`${LIST_MIGRATION_PATH} does not create ${name}`);
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
const GENERATOR = optionSwitchListDriftMessage(LIST_MIGRATION_PATH);
const noteFor = (option: string) =>
  optionSwitchOnNote(option, OPTION_SWITCH_ON_AUTHORITY_FILE, OPTION_SWITCH_ON_AUTHORITY_SHA256);
/** One CHECK constraint of the list migration, by name, up to its closing semicolon. */
const constraint = (name: string) => {
  const found = new RegExp(`ADD CONSTRAINT ${name} CHECK \\(([\\s\\S]*?)\\);`).exec(LIST_SQL);
  if (!found) throw new Error(`${LIST_MIGRATION_PATH} does not add ${name}`);
  return found[1]!;
};

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
    expect(
      sorted(quoted(constraint('ca_horse_style_switch_option_is_registered'))),
      GENERATOR
    ).toEqual(sorted(OPTION_SWITCH_NAMES));
  });

  it('canary only for the seven style options, shadow for them and the shadow options, on_shadow only for the on_shadow options, and on never for an off-only option', () => {
    const check = constraint('ca_horse_style_switch_state_fits_option');
    const parts =
      /^\s*state = 'off'\s*OR \(state = 'on' AND option NOT IN \(([^)]*)\)\)\s*OR \(state = 'shadow' AND option IN \(([^)]*)\)\)\s*OR \(state = 'on_shadow' AND option IN \(([^)]*)\)\)\s*OR \(state <> 'on_shadow' AND option IN \(([^)]*)\)\)\s*$/.exec(
        check
      );
    expect(parts, GENERATOR).not.toBeNull();
    expect(sorted(quoted(parts![1]!)), GENERATOR).toEqual(sorted(OPTION_SWITCH_OFF_ONLY_NAMES));
    expect(sorted(quoted(parts![2]!)), GENERATOR).toEqual(sorted(OPTION_SWITCH_SHADOW_NAMES));
    expect(sorted(quoted(parts![3]!)), GENERATOR).toEqual(sorted(OPTION_SWITCH_ON_SHADOW_NAMES));
    expect(sorted(quoted(parts![4]!))).toEqual(sorted(STYLE_SWITCH_OPTIONS));
    // on_shadow never for an off-only name or a style option; every shadow option takes it
    for (const name of OPTION_SWITCH_ON_SHADOW_NAMES) {
      expect(OPTION_SWITCH_OFF_ONLY_NAMES, name).not.toContain(name);
      expect(STYLE_SWITCH_OPTIONS as readonly string[], name).not.toContain(name);
    }
    for (const name of OPTION_SWITCH_SHADOW_NAMES)
      expect(OPTION_SWITCH_ON_SHADOW_NAMES, name).toContain(name);
    // never for an off-only name, never for a style option (its shadow is its own arm)
    for (const name of OPTION_SWITCH_SHADOW_NAMES) {
      expect(OPTION_SWITCH_OFF_ONLY_NAMES, name).not.toContain(name);
      expect(STYLE_SWITCH_OPTIONS as readonly string[], name).not.toContain(name);
    }
  });

  it('fn_ca_horse_option_switch_states answers each registered option with its states and anything else with NULL', () => {
    const body = listFn('fn_ca_horse_option_switch_states').body;
    const arms = [...body.matchAll(/WHEN p_option IN \(([^)]*)\)\s*THEN ARRAY\[([^\]]*)\]/g)].map(
      (m) => ({ names: sorted(quoted(m[1]!)), states: statesIn(m[2]!) })
    );
    // the off-only arm comes before the plain arm, so an off-only option answers off alone; the shadow arm before the
    // on_shadow arm, so a shadow option answers all four of its states
    expect(arms, GENERATOR).toEqual([
      { names: sorted(STYLE_SWITCH_OPTIONS), states: ['off', 'shadow', 'canary', 'on'] },
      { names: sorted(OPTION_SWITCH_OFF_ONLY_NAMES), states: ['off'] },
      { names: sorted(OPTION_SWITCH_SHADOW_NAMES), states: ['off', 'shadow', 'on_shadow', 'on'] },
      { names: sorted(OPTION_SWITCH_ON_SHADOW_NAMES), states: ['off', 'on_shadow', 'on'] },
      { names: sorted(OPTION_SWITCH_PLAIN_NAMES), states: ['off', 'on'] },
    ]);
    const answer = (name: string) => arms.find((a) => a.names.includes(name))?.states;
    expect(body).toMatch(/ELSE NULL\s*END/);
    for (const entry of OPTION_SWITCH_REGISTRY)
      expect(answer(entry.name), entry.name).toEqual([...entry.states]);
    // one attempt, no retry: the ALTERs wait at most three seconds for the table
    expect(SQL).toMatch(/^\s*BEGIN;\s*SET LOCAL lock_timeout = '3s';/);
    expect(LIST_SQL).toMatch(/^\s*BEGIN;\s*SET LOCAL lock_timeout = '3s';/);
  });

  it('the whitelist is the newest migration carrying the registry markers; a follow-up re-asserts the lists and nothing else', () => {
    // the generator's own check agrees with this law
    expect(
      optionSwitchListDrift(LIST_MIGRATION_PATH, read(LIST_MIGRATION_PATH)),
      GENERATOR
    ).toBeNull();
    if (LIST_MIGRATION_PATH === MIGRATION_PATH) return;
    // a follow-up: one transaction; every existing row is checked before anything changes; the three constraints are
    // dropped and re-added (idempotent); the states function is replaced; nothing else is created, granted or written
    expect(LIST_SQL.trim()).toMatch(/^BEGIN;[\s\S]*COMMIT;$/);
    const check = LIST_SQL.indexOf('$existing_rows_fit$');
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(LIST_SQL.indexOf('ALTER TABLE'));
    for (const name of [
      'ca_horse_style_switch_option_is_registered',
      'ca_horse_style_switch_on_cites_authority',
      'ca_horse_style_switch_state_fits_option',
    ])
      expect(LIST_SQL, name).toContain(
        `DROP CONSTRAINT IF EXISTS ${name},\n  ADD CONSTRAINT ${name} CHECK (`
      );
    expect(LIST_FUNCTIONS.map((f) => [f.name, f.replaced])).toEqual([
      ['fn_ca_horse_option_switch_states', true],
    ]);
    // 2026-11-18: a follow-up naming shadow options refuses to install before the switch functions tell the style
    // options by canary (*_the_horse_option_switch_tells_style_options_by_name.sql), before it changes anything
    if (OPTION_SWITCH_SHADOW_NAMES.length > 0) {
      const guard = LIST_SQL.indexOf(
        'install *_the_horse_option_switch_tells_style_options_by_name.sql first'
      );
      expect(guard, GENERATOR).toBeGreaterThan(0);
      expect(guard).toBeLessThan(LIST_SQL.indexOf('ALTER TABLE'));
    }
    // 2026-11-19: a follow-up naming on_shadow options refuses to install before the set function and the registry
    // publish know on_shadow (*_the_horse_option_switch_on_shadow_keeps_every_rule_of_on.sql)
    if (OPTION_SWITCH_ON_SHADOW_NAMES.length > 0) {
      const guard = LIST_SQL.indexOf(
        'install *_the_horse_option_switch_on_shadow_keeps_every_rule_of_on.sql first'
      );
      expect(guard, GENERATOR).toBeGreaterThan(0);
      expect(guard).toBeLessThan(LIST_SQL.indexOf('ALTER TABLE'));
    }
    expect(LIST_SQL).not.toMatch(
      /CREATE\s+TABLE|ADD\s+COLUMN|CREATE\s+(UNIQUE\s+)?INDEX|CREATE\s+TRIGGER|INSERT\s+INTO|UPDATE\s+public|DELETE\s+FROM/i
    );
    expect(
      [...LIST_SQL.matchAll(/GRANT\s+[^;]*?\sTO\s+([^;]*);/g)].map((m) => m[1]!.trim())
    ).toEqual(['service_role']);
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
    const table = constraint('ca_horse_style_switch_on_cites_authority');
    expect(table).toMatch(
      /^\s*state NOT IN \('on', 'on_shadow'\)\s*OR option IN \(([^)]*)\)\s*OR \(note IS NOT NULL AND note LIKE 'authority: ' \|\| option \|\| ' %' AND note ~ 'sha256 \[0-9a-f\]\{64\}'\)\s*$/
    );
    expect(sorted(quoted(/OR option IN \(([^)]*)\)/.exec(table)![1]!))).toEqual(
      sorted(STYLE_SWITCH_OPTIONS)
    );
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
    expect(sorted(list('style'))).toEqual(sorted(STYLE_SWITCH_OPTIONS));
    expect(sorted(list('plain')), 'update the plain list of the proof script').toEqual(
      sorted(OPTION_SWITCH_PLAIN_NAMES)
    );
    for (const name of REFUSED_NAMES) expect(list('refused'), name).toContain(name);
    expect(sorted(list('offonly')), 'update the offonly list of the proof script').toEqual(
      sorted(OPTION_SWITCH_OFF_ONLY_NAMES)
    );
    expect(sorted(list('onshadow')), 'update the onshadow list of the proof script').toEqual(
      sorted(OPTION_SWITCH_ON_SHADOW_NAMES)
    );
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
    const whitelisted = new Set(quoted(LIST_SQL.slice(0, LIST_SQL.indexOf('$readback$'))));
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
