/**
 * LAW: AN OMAHA OPTION GIVEN A GAME IS ON ONLY IN THAT GAME, NO SCOPE CHANGES NOTHING, AND PLO6 IS UNTOUCHED
 * (EMERG lane PLO4-FIX 2026-11-20; owner 2026-11-19 8:27 PM: "DON'T TOUCH PLO6").
 *
 *  1. The list: exactly the registered omaha* switch options except the omahaMathCore family, the PLO6 options and
 *     the tournament-only options; each is a ledger flag and has one runtime setting, compiled default 0.
 *  2. Default identical, for EVERY listed option: with no scope, an empty scope, or the option scoped to the
 *     decision's own game, the very same options object runs. Scoped to the other game, that option alone is false.
 *  3. Never in scope: PLO6, a tournament, a hi-lo game, a bomb pot: the same options object runs whatever the scope.
 *  4. Decisions (56 recorded Horse decisions, dealt four, five and six cards): with every listed option ON and every
 *     one scoped to PLO5, the PLO4 decisions equal the decisions with every listed option OFF (action, amount and
 *     every receipt but the scope's own) and the PLO5 decisions equal the unscoped ones; scoped to PLO4, the mirror.
 *     PLO6 is byte-identical with and without the scope, receipts included.
 *  5. Receipts: each option switched off by its scope is named with the decision's game.
 *  6. The channel: the scope is a runtime setting (0, 4 or 5 per option; anything else refuses the version), absent
 *     from the decision request at the compiled defaults; the receipt validator admits the off value of a gate
 *     option the request scopes, and its candidates are unchanged without a scope.
 * Hand ids only; no hole card of any opponent is read.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { HORSE_DATA_LEDGER } from './HorseDataLedger.js';
import { seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import {
  OMAHA_OPTION_GAME_SCOPE_OPTIONS,
  OMAHA_OPTION_GAME_SCOPE_SETTING_PREFIX,
  omahaOptionGameOf,
  omahaOptionGameScopable,
  omahaOptionGameScopeFromSettings,
  withOmahaOptionGameScope,
  type OmahaOptionGame,
} from './HorseOmahaOptionGameScope.js';
import { OPTION_SWITCH_NAMES, OPTION_SWITCH_NOT_A_SWITCH } from './HorseOptionSwitch.js';
import {
  LIVE,
  LIVE_OPTIONS,
  recordedState,
  type RecordedDecision,
} from './HorseOmahaPricedRules.test-support.js';
import RECORDED from './HorseOmahaPricedRules.fixture.json';
import {
  omahaPricedInLightningGateCandidates,
  omahaPricedRaiseGateCandidates,
  omahaSlowplayMixInLightningGateCandidates,
} from './horseDecision/responseValidation.js';
import { horseDecideOptsFromRuntimeSettings } from './runtimeSettings/apply.js';
import { RUNTIME_SETTINGS_REGISTRY } from './runtimeSettings/registry.js';
import { parseRuntimeSettings, validateRuntimeSettingValues } from './runtimeSettings/snapshot.js';

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

const RECORDS = RECORDED as unknown as RecordedDecision[];
const LISTED = OMAHA_OPTION_GAME_SCOPE_OPTIONS;
const every = <T>(value: T): Record<string, T> => Object.fromEntries(LISTED.map((o) => [o, value]));
const ALL_ON = { ...LIVE_OPTIONS, ...every(true) } as HorseDecideOpts;
const ALL_OFF = { ...LIVE_OPTIONS, ...every(false) } as HorseDecideOpts;
const scoped = (game: OmahaOptionGame): HorseDecideOpts =>
  ({ ...ALL_ON, omahaOptionGameScope: every(game) }) as HorseDecideOpts;
const SCOPE_RECEIPT = /^omaha_option_game_scope_(.+)_off_in_plo([45])_seen$/;

/** The recorded decision dealt `n` hole cards (PLO4: the first four; PLO6: a sixth card no one shows). */
function dealt(r: RecordedDecision, n: 4 | 5 | 6): RecordedDecision {
  if (n === 5) return r;
  const hole = r.hole.match(/.{2}/g) ?? [];
  if (n === 4) return { ...r, variant: 'plo4', hole: hole.slice(0, 4).join('') };
  const used = new Set([...hole, ...(r.boards.join('').match(/.{2}/g) ?? [])]);
  const extra = ['2c', '2d', '2h', '2s', '3c', '3d', '3h', '3s'].find((c) => !used.has(c))!;
  return { ...r, variant: 'plo6', hole: [...hole, extra].join('') };
}
type State = { hero: never; gs: never };
const state = (n: 4 | 5 | 6, i = 0): State =>
  recordedState(dealt(RECORDS[i]!, n)) as unknown as State;

interface Played {
  where: string;
  action: string;
  amount: number | null;
  fires: string[];
}
function play(opts: HorseDecideOpts, holes: 4 | 5 | 6): Played[] {
  enableBrainTelemetry();
  const out: Played[] = [];
  for (const r of RECORDS) {
    HorseMind.reset();
    const st = recordedState(dealt(r, holes)) as unknown as State;
    drainFires();
    seedFastRandom(1);
    const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
      telemetry: true,
      observeMind: false,
      decisionTimeMs: 1794938400000,
      ...opts,
    } as never);
    out.push({
      where: `hand ${r.n} seat ${r.seat} ${r.street} plo${holes}`,
      action: String(d.action),
      amount: d.amount ?? null,
      fires: drainFires().map((f) => f.feature),
    });
  }
  return out;
}
const withoutScopeReceipts = (played: Played[]): Played[] =>
  played.map((p) => ({ ...p, fires: p.fires.filter((f) => !SCOPE_RECEIPT.test(f)) }));
const scopeReceipts = (played: Played[]): string[] =>
  [...new Set(played.flatMap((p) => p.fires.filter((f) => SCOPE_RECEIPT.test(f))))].sort();

describe('the game scope of an omaha option: the list', () => {
  it('is every registered omaha* switch option except the math core family, PLO6 and tournament-only options', () => {
    const rule = OPTION_SWITCH_NAMES.filter(
      (n) => n.startsWith('omaha') && !/^omahaMathCore|Plo6|Tournament/.test(n)
    );
    expect([...LISTED].sort()).toEqual([...rule].sort());
    expect(new Set(LISTED).size).toBe(LISTED.length);
    expect(LISTED.length).toBeGreaterThan(100);
    for (const o of LISTED) expect(omahaOptionGameScopable(o), o).toBe(true);
    for (const o of ['omahaMathCore', 'omahaMathCorePlo4Flop', 'omahaStrategyInPlo6', 'v40Omaha'])
      expect(omahaOptionGameScopable(o), o).toBe(false);
  });
  it('every listed option is a ledger flag; the scope itself is a ledger flag and a parameter, not a switch', () => {
    const flags = new Set(HORSE_DATA_LEDGER.filter((e) => e.kind === 'flag').map((e) => e.key));
    expect(LISTED.filter((o) => !flags.has(o))).toEqual([]);
    expect(flags.has('omahaOptionGameScope')).toBe(true);
    expect(OPTION_SWITCH_NOT_A_SWITCH.omahaOptionGameScope).toBeDefined();
    expect(OPTION_SWITCH_NAMES).not.toContain('omahaOptionGameScope');
  });
  it('every listed option has one runtime setting, an integer 0..5 with compiled default 0', () => {
    const specs = RUNTIME_SETTINGS_REGISTRY.filter((s) => s.consumer === 'horse_option_game_scope');
    expect(specs.map((s) => s.key)).toEqual(
      LISTED.map((o) => OMAHA_OPTION_GAME_SCOPE_SETTING_PREFIX + o)
    );
    for (const s of specs)
      expect([s.kind, s.min, s.max, s.compiledDefault], s.key).toEqual(['integer', 0, 5, 0]);
  });
});

describe('the game scope of an omaha option: one read site', () => {
  it('default identical for every option: no scope, an empty scope and the own game give the same object', () => {
    const four = state(4);
    const five = state(5);
    expect(omahaOptionGameOf(four.hero, four.gs)).toBe(4);
    expect(omahaOptionGameOf(five.hero, five.gs)).toBe(5);
    expect(withOmahaOptionGameScope(ALL_ON, four.hero, four.gs)).toBe(ALL_ON);
    const empty = { ...ALL_ON, omahaOptionGameScope: {} } as HorseDecideOpts;
    expect(withOmahaOptionGameScope(empty, four.hero, four.gs)).toBe(empty);
    for (const o of LISTED) {
      const own4 = { ...ALL_ON, omahaOptionGameScope: { [o]: 4 } } as HorseDecideOpts;
      const own5 = { ...ALL_ON, omahaOptionGameScope: { [o]: 5 } } as HorseDecideOpts;
      expect(withOmahaOptionGameScope(own4, four.hero, four.gs), o).toBe(own4);
      expect(withOmahaOptionGameScope(own5, five.hero, five.gs), o).toBe(own5);
    }
  });
  it('for every option: scoped to the other game, that option alone is false, and a second pass is the identity', () => {
    const four = state(4);
    const five = state(5);
    for (const o of LISTED)
      for (const [only, st, game] of [
        [5, four, 4],
        [4, five, 5],
      ] as const) {
        const given = { ...ALL_ON, omahaOptionGameScope: { [o]: only } } as HorseDecideOpts;
        const noted: string[] = [];
        const ran = withOmahaOptionGameScope(given, st.hero, st.gs, (name, g) =>
          noted.push(`${name}:${g}`)
        );
        expect(ran, o).not.toBe(given);
        expect(ran, o).toEqual({ ...given, [o]: false });
        expect(noted, o).toEqual([`${o}:${game}`]);
        expect(withOmahaOptionGameScope(ran, st.hero, st.gs), o).toBe(ran);
        // an option already off stays the same object: nothing to switch
        const off = { ...given, [o]: false } as HorseDecideOpts;
        expect(withOmahaOptionGameScope(off, st.hero, st.gs), o).toBe(off);
      }
  });
  it('never in scope: PLO6, a tournament, hi-lo and a bomb pot run the same options object', () => {
    const five = state(5);
    const six = state(6);
    expect(omahaOptionGameOf(six.hero, six.gs)).toBeNull();
    const gs = five.gs as object;
    const others: [string, never][] = [
      ['tournament', { ...gs, gameMode: 'tournament' } as never],
      ['hi-lo', { ...gs, variantRules: { splitLow8OrBetter: true } } as never],
      ['bomb pot', { ...gs, bombPot: true } as never],
      ['two boards', { ...gs, boardCount: 2 } as never],
      ['holdem', { ...gs, gameVariant: 'nlh' } as never],
    ];
    for (const game of [4, 5] as const) {
      const given = scoped(game);
      expect(withOmahaOptionGameScope(given, six.hero, six.gs)).toBe(given);
      for (const [name, other] of others) {
        expect(omahaOptionGameOf(five.hero, other), name).toBeNull();
        expect(withOmahaOptionGameScope(given, five.hero, other), name).toBe(given);
      }
    }
  });
  it('a name that is not listed, or a game that is not 4 or 5, is ignored', () => {
    const four = state(4);
    const given = {
      ...ALL_ON,
      omahaMathCore: true,
      omahaOptionGameScope: { omahaMathCore: 5, v40Omaha: 5, [LISTED[0]!]: 6, [LISTED[1]!]: 0 },
    } as unknown as HorseDecideOpts;
    expect(withOmahaOptionGameScope(given, four.hero, four.gs)).toBe(given);
  });
  it('HorseLogic reads the scope first in decide and in prepareOriginalReads', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./HorseLogic.ts', import.meta.url), 'utf8');
    const decide = src.slice(
      src.indexOf('  static decide('),
      src.indexOf('  private static decideCaptured(')
    );
    expect(decide.indexOf('withOmahaOptionGameScope(')).toBeGreaterThan(0);
    expect(decide.indexOf('withOmahaOptionGameScope(')).toBeLessThan(
      decide.indexOf('opts.omahaNoCategoricalRules')
    );
    const reads = src.slice(
      src.indexOf('  static prepareOriginalReads('),
      src.indexOf('  static decide(')
    );
    expect(reads.indexOf('withOmahaOptionGameScope(')).toBeGreaterThan(0);
    expect(reads.indexOf('withOmahaOptionGameScope(')).toBeLessThan(
      reads.indexOf('HorseMind.setDecisionScope(')
    );
    expect(src.match(/withOmahaOptionGameScope\(/g)).toHaveLength(2);
  });
});

describe('the game scope of an omaha option: recorded decisions', () => {
  // Order matters in these two: a play with the options ON leaves public records in the process (the Horse's own
  // bet sizes) that the next play reads, so the two sides of each comparison are played from the same history:
  // one warm-up with everything on, then only plays that decide alike.
  it('scoped to PLO5: PLO4 decides as with every listed option off, PLO5 as unscoped', () => {
    play(ALL_ON, 4);
    const off4 = play(ALL_OFF, 4);
    const scoped4 = play(scoped(5), 4);
    expect(withoutScopeReceipts(scoped4)).toEqual(off4);
    // receipts: every listed option, and only those, named with the decision's game
    expect(scopeReceipts(scoped4)).toEqual(
      LISTED.map((o) => `omaha_option_game_scope_${o}_off_in_plo4_seen`).sort()
    );
    // the corpus reaches the options: all on and all off do not decide PLO4 alike
    expect(play(ALL_ON, 4)).not.toEqual(off4);
    play(LIVE_OPTIONS, 5);
    const live5 = { ...LIVE_OPTIONS, omahaOptionGameScope: every(5) } as HorseDecideOpts;
    const scoped5 = play(live5, 5);
    expect(scopeReceipts(scoped5)).toEqual([]);
    expect(scoped5).toEqual(play(LIVE_OPTIONS, 5));
  }, 900000);
  it('scoped to PLO4: PLO5 decides as with every listed option off, PLO4 as unscoped', () => {
    play(ALL_ON, 5);
    const off5 = play(ALL_OFF, 5);
    const scoped5 = play(scoped(4), 5);
    expect(withoutScopeReceipts(scoped5)).toEqual(off5);
    expect(scopeReceipts(scoped5)).toEqual(
      LISTED.map((o) => `omaha_option_game_scope_${o}_off_in_plo5_seen`).sort()
    );
    expect(play(ALL_ON, 5)).not.toEqual(off5);
    play(LIVE_OPTIONS, 4);
    const live4 = { ...LIVE_OPTIONS, omahaOptionGameScope: every(4) } as HorseDecideOpts;
    expect(play(live4, 4)).toEqual(play(LIVE_OPTIONS, 4));
  }, 900000);
  it('PLO6: byte-identical with and without a scope (action, amount and every receipt)', () => {
    play(ALL_ON, 6);
    const plain = play(ALL_ON, 6);
    expect(play(scoped(5), 6)).toEqual(plain);
    expect(play(scoped(4), 6)).toEqual(plain);
    play(LIVE_OPTIONS, 6);
    expect(play({ ...LIVE_OPTIONS, omahaOptionGameScope: every(5) } as HorseDecideOpts, 6)).toEqual(
      play(LIVE_OPTIONS, 6)
    );
  }, 900000);
  it("one option scoped (production's live set): the other game decides as with that option off", () => {
    for (const o of [
      'omahaFacingBetIsPricedByEquity',
      'omahaFacingBetRangeIsContinuous',
      'omahaRiverBluffCatchIsPriced',
      'omahaBluffShareFromBetRate',
    ]) {
      expect(LISTED, o).toContain(o);
      const on = { ...LIVE_OPTIONS, [o]: true } as HorseDecideOpts;
      const off = { ...LIVE_OPTIONS, [o]: false } as HorseDecideOpts;
      const only5 = { ...on, omahaOptionGameScope: { [o]: 5 } } as HorseDecideOpts;
      play(on, 4);
      const off4 = play(off, 4);
      const scoped4 = play(only5, 4);
      expect(withoutScopeReceipts(scoped4), o).toEqual(off4);
      expect(scopeReceipts(scoped4), o).toEqual([`omaha_option_game_scope_${o}_off_in_plo4_seen`]);
    }
  }, 900000);
});

describe('the game scope of an omaha option: the channel', () => {
  const key = (o: string) => OMAHA_OPTION_GAME_SCOPE_SETTING_PREFIX + o;
  it('the compiled defaults pass nothing; a published scope passes only the options given a game', () => {
    expect(omahaOptionGameScopeFromSettings(undefined)).toBeUndefined();
    const none = parseRuntimeSettings({ version: 2, settings: {} });
    expect(none.ok && horseDecideOptsFromRuntimeSettings(none.snapshot)).toBeUndefined();
    const zero = parseRuntimeSettings({ version: 2, settings: { [key(LISTED[0]!)]: 0 } });
    expect(zero.ok && horseDecideOptsFromRuntimeSettings(zero.snapshot)).toBeUndefined();
    const some = parseRuntimeSettings({
      version: 3,
      settings: { [key('omahaFacingBetIsPricedByEquity')]: 5, [key('omahaEvFoldModelHeadsUp')]: 4 },
    });
    expect(some.ok).toBe(true);
    expect(some.ok && horseDecideOptsFromRuntimeSettings(some.snapshot)).toEqual({
      omahaOptionGameScope: { omahaEvFoldModelHeadsUp: 4, omahaFacingBetIsPricedByEquity: 5 },
    });
  });
  it('a game that is not 0, 4 or 5, or an option that is not listed, refuses the whole version', () => {
    for (const bad of [1, 2, 3, 6, -1, 4.5])
      expect(validateRuntimeSettingValues({ [key(LISTED[0]!)]: bad }).ok, String(bad)).toBe(false);
    expect(validateRuntimeSettingValues({ [key('omahaMathCore')]: 5 }).ok).toBe(false);
    expect(validateRuntimeSettingValues({ [key('notAnOption')]: 5 }).ok).toBe(false);
    for (const good of [0, 4, 5])
      expect(validateRuntimeSettingValues({ [key(LISTED[0]!)]: good }).ok, String(good)).toBe(true);
  });
  it('the receipt validator admits the off value of a gate option the request scopes, and only then', () => {
    const row = (name: string) => ({
      version: 2,
      style: { version: 1, options: {} },
      options: { [name]: 'on' },
    });
    const cases: [string, (opts: never, config: unknown) => boolean[]][] = [
      ['omahaTurnRiverRaiseIsPriced', omahaPricedRaiseGateCandidates as never],
      ['omahaBigBetCallsArePriced', omahaPricedRaiseGateCandidates as never],
      ['omahaPricedInLightning', omahaPricedInLightningGateCandidates as never],
      ['omahaSlowplayMixInLightning', omahaSlowplayMixInLightningGateCandidates as never],
    ];
    for (const [name, candidates] of cases) {
      expect(LISTED, name).toContain(name);
      // the request itself carries the option on and a row turns it on: without a scope only `true` is admitted
      expect(candidates({ [name]: true } as never, row(name)), name).toEqual([true]);
      expect(
        candidates({ [name]: true, omahaOptionGameScope: { [name]: 5 } } as never, row(name)),
        name
      ).toEqual([true, false]);
      // a scope of another option changes nothing
      expect(
        candidates(
          { [name]: true, omahaOptionGameScope: { omahaStreetPlan: 5 } } as never,
          row(name)
        ),
        name
      ).toEqual([true]);
    }
  });
});
