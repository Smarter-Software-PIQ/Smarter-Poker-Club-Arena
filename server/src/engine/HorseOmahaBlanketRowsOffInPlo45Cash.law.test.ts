/**
 * LAW: A DECLARED BLANKET ROW IS OFF IN PLO4/PLO5 CASH ONLY, NOTHING ELSE CHANGES, AND NO PRICED RULE CAN BE LISTED
 * (EMERG lane BLANKET-AUDIT 2026-11-21; owner 2026-11-20 3:28 PM Chicago: "THERE SHOULD NEVER EVER EVER BY ANY BLANKET
 * RULES"; owner 2026-11-19 8:27 PM: "DON'T TOUCH PLO6"; PLO-OWNER lead ruling 2026-11-21 ~1:55 AM).
 *
 *  1. The registry: exactly OMAHA_NO_CATEGORICAL_RULES_OFF minus every name the rule-site register classes 'priced',
 *     in that list's order, then the five extra blanket rules (OMAHA_BLANKET_ROWS_OFF_EXTRA: none priced, none on that
 *     list, `false` the off path of each); it holds the first members (v74OmahaSemiBluffNeedsDraw and the hidden four); a priced
 *     rule is never listable and is ignored when named.
 *  2. Registration: the option is a ledger flag, a switch, release default OFF and game-scopable; the list is a ledger
 *     flag and a parameter, not a switch; one runtime setting per registry member, an integer 0..1, default 0.
 *  3. One read site: off, no list or an empty list give the same options object; on with a list, in PLO4/PLO5 cash,
 *     the listed members alone are false and a second pass is the identity; PLO6, a tournament, hi-lo, a bomb pot,
 *     two boards and hold'em run the same options object.
 *  4. Decisions (recorded Horse decisions, dealt four, five and six cards): off with a list, PLO4/PLO5/PLO6 equal
 *     today's brain; on with the first members listed, PLO4 and PLO5 equal the decisions with those members off
 *     (every receipt but the option's own) and PLO6 and tournament decisions are byte-identical; each member listed
 *     alone decides exactly as that member's own off path.
 *  5. The channel: the list is a runtime setting (0 or 1 per member; anything else, or a name outside the registry,
 *     refuses the version), absent from the decision request at the compiled defaults.
 * Hand ids only; no hole card of any opponent is read.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { HORSE_DATA_LEDGER } from './HorseDataLedger.js';
import { seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import {
  OMAHA_BLANKET_ROWS_OFF_EXTRA,
  OMAHA_BLANKET_ROWS_OFF_REGISTRY,
  OMAHA_BLANKET_ROW_OFF_SETTING_PREFIX,
  omahaBlanketRowListable,
  omahaBlanketRowsOffListFromSettings,
  withBlanketRowsOffInPlo45Cash,
} from './HorseOmahaBlanketRowsOffInPlo45Cash.js';
import { OMAHA_NO_CATEGORICAL_RULES_OFF } from './HorseOmahaNoCategoricalRules.js';
import { OMAHA_OPTION_GAME_SCOPE_OPTIONS } from './HorseOmahaOptionGameScope.js';
import { OMAHA_OPTION_CLASSES } from './HorseOmahaRuleSites.js';
import {
  OPTION_SWITCH_NAMES,
  OPTION_SWITCH_NOT_A_SWITCH,
  OPTION_SWITCH_REFUSED,
  OPTION_SWITCH_RELEASE_DEFAULT_OFF,
} from './HorseOptionSwitch.js';
import {
  LIVE,
  LIVE_OPTIONS,
  recordedState,
  type RecordedDecision,
} from './HorseOmahaPricedRules.test-support.js';
import RECORDED from './HorseOmahaPricedRules.fixture.json';
import { horseDecideOptsFromRuntimeSettings } from './runtimeSettings/apply.js';
import { RUNTIME_SETTINGS_REGISTRY } from './runtimeSettings/registry.js';
import { parseRuntimeSettings, validateRuntimeSettingValues } from './runtimeSettings/snapshot.js';

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

const RECORDS = RECORDED as unknown as RecordedDecision[];
const REGISTRY = OMAHA_BLANKET_ROWS_OFF_REGISTRY;
const FIRST = [
  'v74OmahaSemiBluffNeedsDraw',
  'ploPairedBoardFold',
  'ploPairedBoardRiverCheck',
  'omahaRiverNutRaiseOnly',
  'omahaTurnSetPound',
] as const;
const OWN_RECEIPT = 'omaha_blanket_rows_off_in_plo45_cash_applied';
const on = (list: readonly string[], base: HorseDecideOpts = LIVE_OPTIONS): HorseDecideOpts =>
  ({
    ...base,
    omahaBlanketRowsOffInPlo45Cash: true,
    omahaBlanketRowsOffList: list,
  }) as HorseDecideOpts;
const offOf = (names: readonly string[], base: HorseDecideOpts = LIVE_OPTIONS): HorseDecideOpts =>
  ({ ...base, ...Object.fromEntries(names.map((n) => [n, false])) }) as HorseDecideOpts;

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
function play(
  opts: HorseDecideOpts,
  holes: 4 | 5 | 6,
  game: (gs: object) => object = (gs) => gs
): Played[] {
  enableBrainTelemetry();
  const out: Played[] = [];
  for (const r of RECORDS) {
    HorseMind.reset();
    const st = recordedState(dealt(r, holes)) as unknown as State;
    drainFires();
    seedFastRandom(1);
    const d = HorseLogic.decide(st.hero, game(st.gs as object) as never, LIVE.style, LIVE.mods, {
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
const withoutOwnReceipt = (played: Played[]): Played[] =>
  played.map((p) => ({ ...p, fires: p.fires.filter((f) => f !== OWN_RECEIPT) }));
const ownReceipts = (played: Played[]): number =>
  played.filter((p) => p.fires.includes(OWN_RECEIPT)).length;

describe('omahaBlanketRowsOffInPlo45Cash: the registry holds blanket rows only', () => {
  it('is the no-categorical list minus every rule the register classes priced, in that order', () => {
    const rule = OMAHA_NO_CATEGORICAL_RULES_OFF.filter(
      (n) => OMAHA_OPTION_CLASSES[n]?.cls !== 'priced'
    );
    expect([...REGISTRY]).toEqual([...rule, ...OMAHA_BLANKET_ROWS_OFF_EXTRA]);
    expect(new Set(REGISTRY).size).toBe(REGISTRY.length);
    for (const n of FIRST) expect(REGISTRY, n).toContain(n);
  });
  it('the extra members: not on the no-categorical list, never priced, real options whose off path is false', async () => {
    const { readFileSync } = await import('node:fs');
    const read = (f: string): string => readFileSync(new URL(f, import.meta.url), 'utf8');
    const src = read('./HorseLogic.ts') + read('./HorseOmahaCurrentNuts.ts');
    expect([...OMAHA_BLANKET_ROWS_OFF_EXTRA]).toEqual([
      'omahaBigBetIsPotShare',
      'omahaCurrentNutsRaise',
      'ploSuitedAcesFourBet',
      'v86PloOverhaul',
      'v46Charts',
      'omahaPairedBoardFoldRespectsPrice',
    ]);
    for (const n of OMAHA_BLANKET_ROWS_OFF_EXTRA) {
      expect(OMAHA_NO_CATEGORICAL_RULES_OFF, n).not.toContain(n);
      expect(OMAHA_OPTION_CLASSES[n]?.cls, n).not.toBe('priced');
      expect(OPTION_SWITCH_NAMES, n).toContain(n);
      expect(omahaBlanketRowListable(n), n).toBe(true);
      // every read of the option in the brain is one of the forms for which `false` is "the rule does not run"
      const reads = src.match(new RegExp(`opts\\.${n}\\b[^;,)&|\\n]*`, 'g')) ?? [];
      expect(reads.length, n).toBeGreaterThan(0);
      for (const r of reads)
        expect(
          /^opts\.\w+\s*(!== false|=== false|=== true|!== true|\?\? true)/.test(r),
          `${n}: ${r}`
        ).toBe(true);
    }
  });
  it('AUDIT-B items 5 and 14: omahaPairedBoardFoldRespectsPrice and V81/V84 are listable; owner-held V87 stays excluded', () => {
    expect(OMAHA_OPTION_CLASSES.omahaPairedBoardFoldRespectsPrice?.cls).toBe('open');
    for (const n of [
      'omahaPairedBoardFoldRespectsPrice',
      'v81OmahaBigBetCalls',
      'v84OmahaRiverReraiseCalls',
    ]) {
      expect(omahaBlanketRowListable(n), n).toBe(true);
    }
    // V87 is owner-held (OPTION_SWITCH_REFUSED) and MUST NOT be on the off-list registry.
    expect(OPTION_SWITCH_REFUSED.v87DeepDiveDiscipline).toBeDefined();
    expect(omahaBlanketRowListable('v87DeepDiveDiscipline')).toBe(false);
  });
  it('no priced rule can be listed, and a priced name in the list changes nothing', () => {
    const priced = Object.entries(OMAHA_OPTION_CLASSES)
      .filter(([, r]) => r.cls === 'priced')
      .map(([n]) => n);
    expect(priced.length).toBeGreaterThan(20);
    for (const n of priced) expect(omahaBlanketRowListable(n), n).toBe(false);
    for (const n of REGISTRY) expect(OMAHA_OPTION_CLASSES[n]?.cls, n).not.toBe('priced');
    const five = state(5);
    const given = on([
      'omahaStreetPlan',
      'omahaTurnRiverRaiseIsPriced',
      'omahaFacingBetEv',
      'v40Omaha',
    ]);
    expect(withBlanketRowsOffInPlo45Cash(given, five.hero, five.gs)).toBe(given);
  });
});

describe('omahaBlanketRowsOffInPlo45Cash: registration', () => {
  it('the option is a ledger flag, a switch, release default OFF and game-scopable; the list is a parameter', () => {
    const flags = new Set(HORSE_DATA_LEDGER.filter((e) => e.kind === 'flag').map((e) => e.key));
    expect(flags.has('omahaBlanketRowsOffInPlo45Cash')).toBe(true);
    expect(OPTION_SWITCH_NAMES).toContain('omahaBlanketRowsOffInPlo45Cash');
    expect(OPTION_SWITCH_RELEASE_DEFAULT_OFF).toContain('omahaBlanketRowsOffInPlo45Cash');
    expect(OMAHA_OPTION_GAME_SCOPE_OPTIONS).toContain('omahaBlanketRowsOffInPlo45Cash');
    expect(flags.has('omahaBlanketRowsOffList')).toBe(true);
    expect(OPTION_SWITCH_NOT_A_SWITCH.omahaBlanketRowsOffList).toBeDefined();
    expect(OPTION_SWITCH_NAMES).not.toContain('omahaBlanketRowsOffList');
    expect(OMAHA_OPTION_CLASSES.omahaBlanketRowsOffInPlo45Cash?.cls).toBe('outside');
    expect(HORSE_DATA_LEDGER.some((e) => e.kind === 'receipt' && e.key === OWN_RECEIPT)).toBe(true);
  });
  it('every registry member has one runtime setting, an integer 0..1 with compiled default 0', () => {
    const specs = RUNTIME_SETTINGS_REGISTRY.filter((s) => s.consumer === 'horse_blanket_rows_off');
    expect(specs.map((s) => s.key)).toEqual(
      REGISTRY.map((o) => OMAHA_BLANKET_ROW_OFF_SETTING_PREFIX + o)
    );
    for (const s of specs)
      expect([s.kind, s.min, s.max, s.compiledDefault], s.key).toEqual(['integer', 0, 1, 0]);
  });
});

describe('omahaBlanketRowsOffInPlo45Cash: one read site', () => {
  it('off, no list or an empty list: the same options object', () => {
    const five = state(5);
    const four = state(4);
    const offWithList = { ...LIVE_OPTIONS, omahaBlanketRowsOffList: [...FIRST] } as HorseDecideOpts;
    expect(withBlanketRowsOffInPlo45Cash(offWithList, five.hero, five.gs)).toBe(offWithList);
    const falseWithList = {
      ...offWithList,
      omahaBlanketRowsOffInPlo45Cash: false,
    } as HorseDecideOpts;
    expect(withBlanketRowsOffInPlo45Cash(falseWithList, four.hero, four.gs)).toBe(falseWithList);
    const noList = { ...LIVE_OPTIONS, omahaBlanketRowsOffInPlo45Cash: true } as HorseDecideOpts;
    expect(withBlanketRowsOffInPlo45Cash(noList, five.hero, five.gs)).toBe(noList);
    const empty = on([]);
    expect(withBlanketRowsOffInPlo45Cash(empty, five.hero, five.gs)).toBe(empty);
  });
  it('for every member, in PLO4 and PLO5: listed alone, that member alone is false; a second pass is the identity', () => {
    for (const st of [state(4), state(5)])
      for (const n of REGISTRY) {
        const given = on([n]);
        const noted: string[] = [];
        const ran = withBlanketRowsOffInPlo45Cash(given, st.hero, st.gs, (name) =>
          noted.push(name)
        );
        expect(ran, n).not.toBe(given);
        expect(ran, n).toEqual({ ...given, [n]: false });
        expect(noted, n).toEqual([n]);
        expect(withBlanketRowsOffInPlo45Cash(ran, st.hero, st.gs), n).toBe(ran);
        const already = { ...given, [n]: false } as HorseDecideOpts;
        expect(withBlanketRowsOffInPlo45Cash(already, st.hero, st.gs), n).toBe(already);
      }
  });
  it("never in scope: PLO6, a tournament, hi-lo, a bomb pot, two boards and hold'em run the same object", () => {
    const five = state(5);
    const six = state(6);
    const given = on([...REGISTRY]);
    expect(withBlanketRowsOffInPlo45Cash(given, six.hero, six.gs)).toBe(given);
    const gs = five.gs as object;
    for (const other of [
      { ...gs, gameMode: 'tournament' },
      { ...gs, variantRules: { splitLow8OrBetter: true } },
      { ...gs, bombPot: true },
      { ...gs, boardCount: 2 },
      { ...gs, gameVariant: 'nlh' },
      { ...gs, gameVariant: 'plo6' },
      { ...gs, gameVariant: 'plo8' },
    ])
      expect(withBlanketRowsOffInPlo45Cash(given, five.hero, other as never)).toBe(given);
  });
  it('the mode is never guessed: a state without gameMode cash is out of scope whatever its blinds', () => {
    const five = state(5);
    const given = on([...REGISTRY]);
    expect((five.gs as { gameMode?: unknown }).gameMode).toBe('cash');
    expect(withBlanketRowsOffInPlo45Cash(given, five.hero, five.gs)).not.toBe(given);
    const gs = five.gs as object;
    for (const other of [
      { ...gs, gameMode: undefined },
      { ...gs, gameMode: undefined, bigBlind: 0.02 },
      { ...gs, gameMode: undefined, bigBlind: 2, tournament: undefined },
      { ...gs, gameMode: '' },
      { ...gs, gameMode: 'sit_and_go' },
    ])
      expect(withBlanketRowsOffInPlo45Cash(given, five.hero, other as never)).toBe(given);
  });
  it('the live builders of a decision state always say the mode', async () => {
    const { readFileSync } = await import('node:fs');
    const turns = readFileSync(new URL('./ServerTableEngineTurns.ts', import.meta.url), 'utf8');
    expect(turns).toContain(
      "gameMode: this.isTournamentTable() ? ('tournament' as const) : ('cash' as const),"
    );
    const lightning = readFileSync(
      new URL('../lightning/LightningHorse.ts', import.meta.url),
      'utf8'
    );
    expect(lightning).toContain("gameMode: 'cash' as const,");
  });
  it('HorseLogic reads it after the game scope and before omahaNoCategoricalRules, in decide and prepareOriginalReads', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./HorseLogic.ts', import.meta.url), 'utf8');
    const decide = src.slice(
      src.indexOf('  static decide('),
      src.indexOf('  private static decideCaptured(')
    );
    const at = decide.indexOf('withBlanketRowsOffInPlo45Cash(');
    expect(at).toBeGreaterThan(decide.indexOf('withOmahaOptionGameScope('));
    expect(at).toBeLessThan(decide.indexOf('opts.omahaNoCategoricalRules'));
    const reads = src.slice(
      src.indexOf('  static prepareOriginalReads('),
      src.indexOf('  static decide(')
    );
    const r = reads.indexOf('withBlanketRowsOffInPlo45Cash(');
    expect(r).toBeGreaterThan(reads.indexOf('withOmahaOptionGameScope('));
    expect(r).toBeLessThan(reads.indexOf('HorseMind.setDecisionScope('));
    expect(src.match(/withBlanketRowsOffInPlo45Cash\(/g)).toHaveLength(2);
  });
});

describe('omahaBlanketRowsOffInPlo45Cash: recorded decisions', () => {
  // As in the game-scope law: a play leaves public records the next play reads, so each comparison is played from the
  // same history (one warm-up, then plays that decide alike).
  it('off with a list: PLO4, PLO5 and PLO6 decide exactly as today', () => {
    const offWithList = {
      ...LIVE_OPTIONS,
      omahaBlanketRowsOffList: [...REGISTRY],
    } as HorseDecideOpts;
    for (const holes of [4, 5, 6] as const) {
      play(LIVE_OPTIONS, holes);
      const live = play(LIVE_OPTIONS, holes);
      expect(play(offWithList, holes), `plo${holes}`).toEqual(live);
    }
  }, 900000);
  it('the switch on with no list, or an empty one: PLO4, PLO5 and PLO6 decide exactly as today, no receipt', () => {
    const onNoList = { ...LIVE_OPTIONS, omahaBlanketRowsOffInPlo45Cash: true } as HorseDecideOpts;
    for (const holes of [4, 5, 6] as const) {
      play(LIVE_OPTIONS, holes);
      const live = play(LIVE_OPTIONS, holes);
      for (const opts of [onNoList, on([])]) {
        const played = play(opts, holes);
        expect(played, `plo${holes}`).toEqual(live);
        expect(ownReceipts(played), `plo${holes}`).toBe(0);
      }
    }
  }, 900000);
  it('on with the first members: PLO4 and PLO5 decide as with those members off; PLO6 is byte-identical', () => {
    for (const holes of [4, 5] as const) {
      play(LIVE_OPTIONS, holes);
      const off = play(offOf(FIRST), holes);
      const listed = play(on(FIRST), holes);
      expect(withoutOwnReceipt(listed), `plo${holes}`).toEqual(off);
      expect(ownReceipts(listed), `plo${holes}`).toBe(RECORDS.length);
    }
    play(LIVE_OPTIONS, 6);
    const six = play(LIVE_OPTIONS, 6);
    const sixOn = play(on([...REGISTRY]), 6);
    expect(sixOn).toEqual(six);
    expect(ownReceipts(sixOn)).toBe(0);
  }, 900000);
  it('tournaments, hi-lo and bomb pots: byte-identical with every registry member listed', () => {
    const others: [string, (gs: object) => object][] = [
      ['tournament', (gs) => ({ ...gs, gameMode: 'tournament' })],
      ['hi-lo', (gs) => ({ ...gs, variantRules: { splitLow8OrBetter: true } })],
      ['bomb pot', (gs) => ({ ...gs, bombPot: true })],
    ];
    for (const [name, game] of others) {
      play(LIVE_OPTIONS, 5, game);
      const plain = play(LIVE_OPTIONS, 5, game);
      const listed = play(on([...REGISTRY]), 5, game);
      expect(listed, name).toEqual(plain);
      expect(ownReceipts(listed), name).toBe(0);
    }
  }, 900000);
  it('each first member listed alone decides exactly as its own off path (PLO5)', () => {
    for (const n of FIRST) {
      play(LIVE_OPTIONS, 5);
      const off = play(offOf([n]), 5);
      expect(withoutOwnReceipt(play(on([n]), 5)), n).toEqual(off);
    }
  }, 900000);
  it('every registry member listed ALONE: PLO5 decides as its own off path; a tournament and PLO6 are byte-identical', () => {
    const tournament = (gs: object): object => ({ ...gs, gameMode: 'tournament' });
    play(LIVE_OPTIONS, 5, tournament);
    const plainTournament = play(LIVE_OPTIONS, 5, tournament);
    play(LIVE_OPTIONS, 6);
    const plainSix = play(LIVE_OPTIONS, 6);
    for (const n of REGISTRY) {
      play(LIVE_OPTIONS, 5);
      const off = play(offOf([n]), 5);
      expect(withoutOwnReceipt(play(on([n]), 5)), n).toEqual(off);
      play(LIVE_OPTIONS, 5, tournament);
      expect(play(on([n]), 5, tournament), `${n} tournament`).toEqual(plainTournament);
      play(LIVE_OPTIONS, 6);
      expect(play(on([n]), 6), `${n} plo6`).toEqual(plainSix);
    }
  }, 1800000);
  it('every registry member listed: PLO4 decides as with the whole registry off, and the corpus reaches it', () => {
    play(LIVE_OPTIONS, 4);
    const off = play(offOf(REGISTRY), 4);
    expect(withoutOwnReceipt(play(on([...REGISTRY]), 4))).toEqual(off);
    expect(play(LIVE_OPTIONS, 4)).not.toEqual(off);
  }, 900000);
});

describe('omahaBlanketRowsOffInPlo45Cash: the channel', () => {
  const key = (o: string) => OMAHA_BLANKET_ROW_OFF_SETTING_PREFIX + o;
  it('the compiled defaults pass nothing; a published list passes only the members set to 1, in registry order', () => {
    expect(omahaBlanketRowsOffListFromSettings(undefined)).toBeUndefined();
    const none = parseRuntimeSettings({ version: 2, settings: {} });
    expect(none.ok && horseDecideOptsFromRuntimeSettings(none.snapshot)).toBeUndefined();
    const zero = parseRuntimeSettings({ version: 2, settings: { [key(FIRST[0])]: 0 } });
    expect(zero.ok && horseDecideOptsFromRuntimeSettings(zero.snapshot)).toBeUndefined();
    const some = parseRuntimeSettings({
      version: 3,
      settings: { [key('omahaTurnSetPound')]: 1, [key('v74OmahaSemiBluffNeedsDraw')]: 1 },
    });
    expect(some.ok).toBe(true);
    expect(some.ok && horseDecideOptsFromRuntimeSettings(some.snapshot)).toEqual({
      omahaBlanketRowsOffList: ['omahaTurnSetPound', 'v74OmahaSemiBluffNeedsDraw'],
    });
  });
  it('a value that is not 0 or 1, or a name outside the registry, refuses the whole version', () => {
    for (const bad of [2, -1, 0.5, 5])
      expect(validateRuntimeSettingValues({ [key(FIRST[0])]: bad }).ok, String(bad)).toBe(false);
    for (const priced of ['omahaStreetPlan', 'omahaFacingBetEv', 'notAnOption'])
      expect(validateRuntimeSettingValues({ [key(priced)]: 1 }).ok, priced).toBe(false);
    for (const good of [0, 1])
      expect(validateRuntimeSettingValues({ [key(FIRST[0])]: good }).ok, String(good)).toBe(true);
  });
});
