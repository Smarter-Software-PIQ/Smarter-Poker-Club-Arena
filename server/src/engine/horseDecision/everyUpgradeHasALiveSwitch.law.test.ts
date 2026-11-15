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
 *      before this existed, and every registered option is read by the brain as `=== true` / `!== true` only, so
 *      "not passed" and "off" are the same answer. An unknown or held option is refused by the database function
 *      and by the worker.
 *   5. WHO MAY WRITE. service_role only; SECURITY DEFINER with a pinned search_path.
 *   6. FAILURE. Nothing delivered, unreadable, invalid or malformed all leave every option at its release default,
 *      and a real decision still completes.
 *   7. REPLAY. A decision replays with the switched set its own record carries, never the live one.
 *   8. THE DATABASE WHITELIST IS THE ENGINE REGISTRY, and the schema manifest names the functions the migration adds.
 *
 * The decisions are real: HorseDecisionWorkerRuntime DECIDE_FAST through runtime.receive with the real
 * HorseLogic.decide underneath (the harness of styleSwitchRuntime.law.test.ts). The database half is read from the
 * migration source; the migration's own read-back block runs the same refusals where it is installed.
 */
import { performance } from 'node:perf_hooks';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HorseLogic } from '../HorseLogic.js';
import { HorseMind } from '../HorseMind.js';
import { seedFastRandom } from '../HorseEval.js';
import { HORSE_FEATURE_FLAGS } from '../HorseFeatureAuthority.js';
import { STYLE_SWITCH_OPTIONS, StyleSwitchHolder } from '../HorseStyleSwitch.js';
import {
  assertOptionSwitchRegistry,
  OPTION_SWITCH_EVIDENCED_ON,
  OPTION_SWITCH_NAMES,
  OPTION_SWITCH_PLAIN_NAMES,
  OPTION_SWITCH_PLAIN_REGISTRY,
  OPTION_SWITCH_REFUSED,
  OPTION_SWITCH_REGISTRY,
  OptionSwitchHolder,
  optionSwitchDecisionOpts,
  optionSwitchRefusal,
  optionSwitchSourceFromStates,
  optionSwitchStatesFrom,
  parseOptionSwitchConfig,
  type OptionSwitchStates,
} from '../HorseOptionSwitch.js';
import { computeHorseUpgradeActivationManifest } from '../HorseUpgradeActivationManifest.js';
import { createStyleSwitchWorkerInbox, readSwitchThrough } from './styleSwitchDelivery.js';
import { isHorseDecisionReplayState } from './replayState.js';
import { recordedSwitchStates } from './replay/HorseDecisionReplay.js';
import { requestAt, workerHarness } from '../../testing/horseRegression/plan/fixture.js';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (path: string) => readFileSync(join(REPO, path), 'utf8');
const MIGRATION_PATH =
  'supabase/migrations/20261114072215_every_horse_upgrade_has_a_live_switch.sql';
/** The migration without its comments: what the database executes. */
const SQL = read(MIGRATION_PATH).replace(/--[^\n]*/g, '');
/** TypeScript without comments: what runs. */
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[\s;{}(),])\/\/[^\n]*/g, '$1');
const quoted = (text: string) => [...text.matchAll(/'([A-Za-z0-9]+)'/g)].map((m) => m[1]!);
const sorted = (names: readonly string[]) => [...names].sort();

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

/** The names the brief holds, beside OPTION_SWITCH_REFUSED: each must be refused by name or by pattern. */
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
  'allInOrFoldWidening',
  'aofWidening',
  'blindSteal',
  'vpipFloorDeepStackOff',
  'omahaPreflopCallWithActionBehind',
  // the preflop range hold
  'v46ShortDeck',
  'nashPushFoldIcm',
  'huBbDefendsToPrice',
  'huOpenerDefendsToPrice',
  'huLimpDefendsToPrice',
  'facingOpenFullRingZone',
  'committedStackPricedIn',
  'vs3BetShortStack',
  'holdemPersonaReRaiseMix',
];
const REFUSED_NAMES = [...new Set([...Object.keys(OPTION_SWITCH_REFUSED), ...HELD_BY_THE_OWNER])];

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
    const check = /ca_horse_style_switch_option_is_registered CHECK \(option IN \(([^)]*)\)\)/.exec(
      SQL
    );
    expect(check).not.toBeNull();
    expect(sorted(quoted(check![1]!))).toEqual(sorted(OPTION_SWITCH_NAMES));
  });

  it('shadow and canary are accepted only for the seven style options', () => {
    const check =
      /ca_horse_style_switch_state_fits_option CHECK \(\s*state IN \('off', 'on'\)\s*OR option IN \(([^)]*)\)\)/.exec(
        SQL
      );
    expect(check).not.toBeNull();
    expect(sorted(quoted(check![1]!))).toEqual(sorted(STYLE_SWITCH_OPTIONS));
  });

  it('fn_ca_horse_option_switch_states answers each registered option with its states and anything else with NULL', () => {
    const body = fn('fn_ca_horse_option_switch_states').body;
    const arms = [
      ...body.matchAll(
        /WHEN p_option (?:IN \(([^)]*)\)|= ANY \(ARRAY\[([^\]]*)\]::text\[\]\))\s*THEN ARRAY\[([^\]]*)\]/g
      ),
    ].map((m) => ({ names: sorted(quoted(m[1] ?? m[2]!)), states: quoted(m[3]!) }));
    // the evidenced arm comes before the off-only arm, so an evidenced option answers off and on (HA-10878-1)
    expect(arms).toEqual([
      { names: sorted(STYLE_SWITCH_OPTIONS), states: ['off', 'shadow', 'canary', 'on'] },
      { names: sorted(OPTION_SWITCH_EVIDENCED_ON), states: ['off', 'on'] },
      { names: sorted(OPTION_SWITCH_PLAIN_NAMES), states: ['off'] },
    ]);
    const answer = (name: string) => arms.find((a) => a.names.includes(name))?.states;
    expect(body).toMatch(/ELSE NULL\s*END/);
    for (const entry of OPTION_SWITCH_REGISTRY)
      expect(answer(entry.name), entry.name).toEqual([...entry.states]);
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

/**
 * HA-10878-1: a fleet-wide `on` row for a non-style option is the same behaviour as turning it on by default, so the
 * switch offers `on` only where docs/horse-default-on.d/<option>.md exists (the naming rule of
 * HorseDefaultOnNeedsEvidence.law.test.ts) and binds to that option. The style options keep their own controls.
 */
const EVIDENCE_DIR = 'docs/horse-default-on.d';
const EVIDENCE_ROWS = [
  'Mechanism',
  'Input fidelity',
  'Value',
  'Continuation',
  'Reach',
  'Scope',
  'Visibility',
  'Limits',
] as const;
const hasEvidenceFile = (name: string) => existsSync(join(REPO, EVIDENCE_DIR, `${name}.md`));
const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** What an evidence file lacks before it may unlock `on` for this option; empty means it binds. */
function switchEvidenceGaps(name: string, scope: string, text: string): string[] {
  const gaps: string[] = [];
  if (!new RegExp(`^#\\s+${escapeRe(name)}\\b`, 'm').test(text)) gaps.push(`a "# ${name}" title`);
  if (!/#[1-9]\d{3,}|\/pull\/[1-9]\d*/.test(text)) gaps.push('a pull request reference');
  const measured = /^Switch scope:\s*(.+?)\s*$/m.exec(text)?.[1];
  if (measured !== scope) gaps.push(`"Switch scope: ${scope}" (the registry scope)`);
  if (!/^Reviewed head:\s*[0-9a-f]{40}\s*$/m.test(text)) gaps.push('"Reviewed head: <40-hex sha>"');
  const lines = text.split('\n');
  for (const row of EVIDENCE_ROWS) {
    const at = lines.findIndex((l) =>
      new RegExp(`^#{1,6}\\s*(?:\\d+[.)]?\\s*)?${row}\\s*$`, 'i').test(l.trim())
    );
    const body =
      at < 0
        ? ''
        : (lines
            .slice(at + 1)
            .join('\n')
            .split(/^#{1,6}\s/m)[0] ?? '');
    if (body.replace(/\s/g, '').length < 20) gaps.push(`content under "## ${row}"`);
  }
  return gaps;
}

/** The names between each pair of registry:evidenced-on-options markers of the migration, as written. */
const evidencedBlocks = () =>
  [
    ...read(MIGRATION_PATH).matchAll(
      /registry:evidenced-on-options:begin([\s\S]*?)registry:evidenced-on-options:end/g
    ),
  ].map((m) => sorted(quoted(m[1]!)));

describe('HA-10878-1: on needs promotion evidence, at the registry, the database and the engine', () => {
  const unevidenced = OPTION_SWITCH_PLAIN_NAMES.filter(
    (n) => !OPTION_SWITCH_EVIDENCED_ON.includes(n)
  );

  it('the options offered on are exactly the registered non-style options with an evidence file, by exact name', () => {
    expect(sorted(OPTION_SWITCH_EVIDENCED_ON)).toEqual(
      sorted(OPTION_SWITCH_PLAIN_NAMES.filter(hasEvidenceFile))
    );
    for (const name of OPTION_SWITCH_EVIDENCED_ON)
      expect(OPTION_SWITCH_PLAIN_NAMES).toContain(name);
    for (const entry of OPTION_SWITCH_PLAIN_REGISTRY)
      expect(entry.states.includes('on'), entry.name).toBe(
        OPTION_SWITCH_EVIDENCED_ON.includes(entry.name)
      );
    // the evidence directory is read, not assumed empty: it holds files for options this switch does not carry
    expect(readdirSync(join(REPO, EVIDENCE_DIR)).length).toBeGreaterThan(1);
  });

  it('every evidence file that unlocks on names its option, its pull request, its scope and its reviewed head', () => {
    for (const entry of OPTION_SWITCH_PLAIN_REGISTRY.filter((e) => e.states.includes('on')))
      expect(
        switchEvidenceGaps(entry.name, entry.scope, read(join(EVIDENCE_DIR, `${entry.name}.md`))),
        entry.name
      ).toEqual([]);
    // the reader is not vacuous
    const complete = (name: string, scope: string) =>
      `# ${name} (#12345)\n\nSwitch scope: ${scope}\nReviewed head: ${'a'.repeat(40)}\n\n` +
      EVIDENCE_ROWS.map((row) => `## ${row}\nA real answer of useful length for this row.\n`).join(
        '\n'
      );
    expect(
      switchEvidenceGaps('v16Hu', 'Heads-up postflop', complete('v16Hu', 'Heads-up postflop'))
    ).toEqual([]);
    // evidence for one option does not unlock another
    expect(
      switchEvidenceGaps('v16Ratio', 'Heads-up postflop', complete('v16Hu', 'Heads-up postflop'))
    ).toContain('a "# v16Ratio" title');
    expect(switchEvidenceGaps('v16Hu', 'All', complete('v16Hu', 'Heads-up postflop'))).toEqual([
      '"Switch scope: All" (the registry scope)',
    ]);
    expect(
      switchEvidenceGaps(
        'v16Hu',
        'Heads-up postflop',
        complete('v16Hu', 'Heads-up postflop').replace(/Reviewed head.*\n/, '')
      )
    ).toEqual(['"Reviewed head: <40-hex sha>"']);
    expect(
      switchEvidenceGaps(
        'v16Hu',
        'Heads-up postflop',
        complete('v16Hu', 'Heads-up postflop').replace(
          '## Value\nA real answer of useful length for this row.',
          '## Value\nTBD'
        )
      )
    ).toEqual(['content under "## Value"']);
  });

  it('a registry that offers on without evidence throws where it is declared', () => {
    for (const name of unevidenced) {
      const entry = OPTION_SWITCH_PLAIN_REGISTRY.find((e) => e.name === name)!;
      expect(() =>
        assertOptionSwitchRegistry(
          OPTION_SWITCH_REGISTRY.map((e) =>
            e.name === name ? { ...entry, states: ['off', 'on'] as const } : e
          )
        )
      ).toThrow(/no promotion evidence/);
    }
  });

  it('the database: the table and the states function list exactly the evidenced names, and set refuses on before any write', () => {
    expect(evidencedBlocks()).toEqual([
      sorted(OPTION_SWITCH_EVIDENCED_ON),
      sorted(OPTION_SWITCH_EVIDENCED_ON),
    ]);
    const table =
      /ca_horse_style_switch_on_needs_evidence CHECK \(\s*state <> 'on'\s*OR option IN \(([^)]*)\)\s*OR option = ANY \(ARRAY\[([^\]]*)\]::text\[\]\)\s*\)/.exec(
        SQL
      );
    expect(table).not.toBeNull();
    expect(sorted(quoted(table![1]!))).toEqual(sorted(STYLE_SWITCH_OPTIONS));
    expect(sorted(quoted(table![2]!))).toEqual(sorted(OPTION_SWITCH_EVIDENCED_ON));
    const body = fn('fn_ca_horse_option_switch_set').body;
    const guard = body.search(
      /IF p_state = 'on' AND NOT \('on' = ANY \(v_states\)\) THEN\s*RAISE EXCEPTION 'option % has no promotion evidence/
    );
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(body.search(/INSERT INTO/));
    // the old style setter writes the seven style names only, so it cannot write on for any other option
    const oldSetter = read(
      'supabase/migrations/20261113201841_the_horse_style_read_has_a_live_switch.sql'
    );
    expect(oldSetter).toMatch(/p_option NOT IN \('styleValueBettorNotManiac'/);
    // proven by execution on a throwaway PostgreSQL 17
    expect(existsSync(join(REPO, 'scripts/ci/test-horse-option-switch-evidence-postgres.sh'))).toBe(
      true
    );
  });

  it('the engine refuses a configuration carrying on for an option without evidence: every non-style option runs at its release default', () => {
    expect(unevidenced.length).toBeGreaterThan(0);
    for (const name of unevidenced) {
      // a valid off for another option beside it: the bad on takes the whole set down, not just itself
      const other = name === 'v16Hu' ? 'commitUnderPot' : 'v16Hu';
      expect(optionSwitchStatesFrom({ [name]: 'on' }), name).toBeNull();
      expect(parseOptionSwitchConfig(v2({ [name]: 'on', [other]: 'off' })), name).toEqual({
        ok: false,
      });
      expect(optionSwitchDecisionOpts({ [name]: 'on' } as never), name).toEqual({});
      const notes: string[] = [];
      let raw: unknown = v2({ [other]: 'off' });
      const holder = new OptionSwitchHolder(
        (now) => ({ kind: 'present', raw, receivedAtMs: now }),
        (f) => notes.push(f)
      );
      expect(holder.refresh(0)).toEqual({ [other]: 'off' });
      raw = v2({ [name]: 'on', [other]: 'off' });
      expect(holder.refresh(60_000), name).toEqual({});
      expect(notes, name).toContain('option_switch_config_invalid_seen');
      expect(notes, name).not.toContain(`option_switch_${name}_on_seen`);
      // off and clear stay available
      expect(optionSwitchStatesFrom({ [name]: 'off' }), name).toEqual({ [name]: 'off' });
    }
  });

  it('a worker that starts while an un-evidenced on row exists never applies it, on its very first read', async () => {
    const w = opened({ wired: true });
    expect(w.deliver(v2({ v62RiverBettorPolarity: 'on', v16Hu: 'off' }))).toBe(true);
    const look = await w.fast();
    for (const opts of look.opts) expect(switchedKeys(opts)).toEqual([]);
    expect(look.replayState.version).toBe(V3);
    expect(w.features).toContain('option_switch_config_invalid_seen');
    expect(w.features).not.toContain('option_switch_v62RiverBettorPolarity_on_seen');
  });
});

describe('the held options are refused on both sides', () => {
  it('no registered option is a held one, and registering one throws where the registry is declared', () => {
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
    const whitelisted = new Set(quoted(SQL.slice(0, SQL.indexOf('$readback$'))));
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
      'committedStackPricedIn',
      'huBbDefendsToPrice',
      'notAnOption',
    ])
      expect(readback, name).toContain(`fn_ca_horse_option_switch_states('${name}') IS NOT NULL`);
  });

  it('the worker ignores them: a delivery naming one switches nothing, and no key reaches the brain', () => {
    for (const name of [...REFUSED_NAMES, 'notAnOption', '__proto__', 'constructor']) {
      expect(parseOptionSwitchConfig(v2({ [name]: 'on' })), name).toEqual({ ok: false });
      expect(optionSwitchStatesFrom({ [name]: 'on' }), name).toBeNull();
      expect(optionSwitchDecisionOpts({ [name]: 'on' } as never), name).toEqual({});
      expect(optionSwitchDecisionOpts({ [name]: 'on', v16Hu: 'off' } as never), name).toEqual({
        v16Hu: false,
      });
    }
  });

  it('no registered option is read by the preflop range code (the preflop range hold)', () => {
    const preflop = ['HorsePreflop.ts', 'HorseHuBbDefence.ts', 'HorseGtoVs3BetRanges.ts']
      .map((f) => code(`server/src/engine/${f}`))
      .join('\n');
    for (const name of OPTION_SWITCH_PLAIN_NAMES)
      expect(new RegExp(`\\b${name}\\b`).test(preflop), name).toBe(false);
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
    expect(SQL).not.toMatch(WHO);
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
    expect(calls.sort()).toEqual(['deepOptionStates', 'optionStates']);
    const refreshes = [...runtime.matchAll(/this\.optionSwitch\.refresh\(([^;]*)\);/g)].map((m) =>
      m[1]!.trim()
    );
    expect(refreshes).toEqual(['performance.now()', 'performance.now()']);
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
  it('every registered option ships off, and the brain reads it only as "=== true" or "!== true"', () => {
    const dir = join(REPO, 'server/src/engine');
    const sources = (readdirSync(dir, { recursive: true }) as string[])
      .filter(
        (f) =>
          f.endsWith('.ts') &&
          !/\.test\.|test-support|HorseOptionSwitch\.ts$|HorseDataLedger\.ts$/.test(f)
      )
      .map((f) => ({ f, text: code(join('server/src/engine', f)) }));
    for (const entry of OPTION_SWITCH_PLAIN_REGISTRY) {
      expect(entry.releaseDefault, entry.name).toBe('off');
      let reads = 0;
      for (const { f, text } of sources)
        for (const m of text.matchAll(
          new RegExp(`\\.${entry.name}\\b(?!\\s*[:?(])([^\\n]{0,16})`, 'g')
        )) {
          reads++;
          expect(
            m[1],
            `${f}: ${entry.name} is read as something other than a strict true test`
          ).toMatch(/^\s*(===|!==)\s*true\b/);
        }
      expect(reads, `${entry.name} is read by the brain`).toBeGreaterThan(0);
    }
  });

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

  it('a row reaches a real decision as off = false (on = true only with evidence), the same way for every decision, and is journaled', async () => {
    const before = await baseline();
    const w = opened({ wired: true });
    w.deliver(v2({ v62RiverBettorPolarity: 'off', v16Hu: 'off' }));
    for (const requestId of [1, 2]) {
      const look = await w.fast(requestId);
      for (const opts of look.opts) {
        expect(switchedKeys(opts).sort()).toEqual(['v16Hu', 'v62RiverBettorPolarity']);
        expect(opts.v62RiverBettorPolarity).toBe(false);
        expect(opts.v16Hu).toBe(false);
      }
      expect(look.replayState.version).toBe(V5);
      expect(look.replayState.options).toEqual({ v16Hu: 'off', v62RiverBettorPolarity: 'off' });
    }
    expect(w.features).toEqual(
      expect.arrayContaining([
        'option_switch_v16Hu_off_seen',
        'option_switch_v62RiverBettorPolarity_off_seen',
      ])
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

  it('with every registered option switched (on where evidenced, else off), the authority-owned options a real decision is handed do not move', async () => {
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
    ['a held option', v2({ committedStackPricedIn: 'on', v16Hu: 'on' })],
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

  it('a worker that has just started has nothing switched', async () => {
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
  it('the record carries the set (v5), an older version carrying one is refused, and a held option is not a valid record', async () => {
    const w = opened({ wired: true });
    w.deliver(v2({ v62RiverBettorPolarity: 'off', v16Hu: 'off' }));
    const { replayState } = await w.fast();
    expect(isHorseDecisionReplayState(replayState)).toBe(true);
    const record = (state: unknown) => ({ body: JSON.stringify({ replayState: state }) });
    expect(recordedSwitchStates(record(replayState))).toEqual({
      ok: true,
      states: null,
      options: { v16Hu: 'off', v62RiverBettorPolarity: 'off' },
    });
    expect(recordedSwitchStates(record({ ...replayState, version: V3 }))).toEqual({ ok: false });
    expect(
      recordedSwitchStates(record({ ...replayState, options: { committedStackPricedIn: 'on' } }))
    ).toEqual({ ok: false });
    expect(recordedSwitchStates(record({ ...replayState, options: {} }))).toEqual({ ok: false });
    // HA-10878-1: a record carrying on for an option without evidence is not a valid record either
    expect(
      recordedSwitchStates(record({ ...replayState, options: { v62RiverBettorPolarity: 'on' } }))
    ).toEqual({ ok: false });
  });

  it('the replay wiring hands the brain the recorded set at any later time, with no live read', async () => {
    const live = opened({ wired: true });
    live.deliver(v2({ v62RiverBettorPolarity: 'off', v16Hu: 'off' }));
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
