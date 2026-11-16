/**
 * omahaStrategyInPlo6 REGISTERED OFF-ONLY, AND THE PLO6 CALIBRATION HOOKED TO
 * THE OMAHA STRATEGY ACCESSOR (PLO6 lane 2026-11-16).
 *
 * What is pinned here:
 *  - the accessor's 17 keys each name the calibration entry their PLO6 value
 *    comes from; what is registered is exactly the three keys that differ;
 *  - registered, PLO4, PLO5 and every other game still read the defaults, and
 *    PLO6 reads its three values; cleared, PLO6 reads the defaults too;
 *  - the option is off-only: an `on` row is refused by the registry, the
 *    parser of a switched set and the decision options;
 *  - through HorseLogic.decide, unset and false are the same decision byte for
 *    byte on five PLO6, two PLO5 and one PLO4 state at eight seeds;
 *  - the off-identity of the hookup: the same states decide the same before
 *    the registration, after it, and with the six-card values held in the
 *    accessor through the whole decision; and inside a decision whose gate is
 *    off the accessor holds no PLO6 value, whatever was registered before.
 *
 * The states: the synthetic three-way flop of
 * HorsePlo6MultiwayWeakBetWiring.test.ts (invented cards, the same builder),
 * and two recorded turn nodes (a raise over a turn bet, a bet into the fresh
 * card) dealt a sixth card, as HorseOmahaReadConditional.test.ts deals them.
 * On the two turn nodes the gate is shown to be live: on, with a strategy
 * option on, the PLO6 decision changes; so "nothing changes" below is not the
 * silence of states no rule reaches.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Card, CardRank, CardSuit } from '../types.js';
import { UNMEASURABLE_MATCHUPS } from '../benchmark/HorseLeague.js';
import {
  replayProfiles,
  stateAt,
  type ComplaintAction,
  type ComplaintFixture,
} from './HorseComplaintReplay.js';
import { HORSE_DATA_LEDGER } from './HorseDataLedger.js';
import { omahaNutStatus, seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { omahaBeatenByBoard } from './HorseOmahaMadeHandDefense.js';
import type { OmahaReadConditional } from './HorseOmahaReadConditional.js';
import {
  OMAHA_STRATEGY_CONSTANT_DEFAULTS,
  omahaStrategyConstant,
  omahaStrategyGameScopeNow,
  type OmahaStrategyConstantKey,
} from './HorseOmahaStrategyGame.js';
import {
  OPTION_SWITCH_OFF_ONLY,
  OPTION_SWITCH_OFF_ONLY_NAMES,
  OPTION_SWITCH_PLAIN_REGISTRY,
  OPTION_SWITCH_REGISTRY,
  OPTION_SWITCH_RELEASE_DEFAULT_OFF,
  assertOptionSwitchRegistry,
  optionSwitchDecisionOpts,
  optionSwitchOffOnly,
  optionSwitchStatesFrom,
  parseOptionSwitchConfig,
} from './HorseOptionSwitch.js';
import {
  PLO6_OMAHA_STRATEGY_ACCESSOR_VALUES,
  PLO6_OMAHA_STRATEGY_CONSTANTS,
  applyPlo6OmahaStrategyCalibration,
  clearPlo6OmahaStrategyCalibration,
  plo6OmahaStrategyAccessorCalibration,
  registerPlo6OmahaStrategyCalibration,
} from './HorsePlo6StrategyCalibration.js';
import SET_LEADS from './horseComplaints/plo5-set-leads-the-straight-card-out-of-position.fixture.json';
import TOP_TWO_JAMS from './horseComplaints/plo5-top-two-pair-jams-over-a-turn-bet-on-the-straight-card.fixture.json';

/** Test seam: HorseLogic.decide's own call is skipped, so what was registered stays through the decision. */
const forced = vi.hoisted(() => ({ decideLeavesTheAccessorAlone: false }));
vi.mock('./HorsePlo6StrategyCalibration.js', async (original) => {
  const real = await original<typeof import('./HorsePlo6StrategyCalibration.js')>();
  return {
    ...real,
    applyPlo6OmahaStrategyCalibration: (gateOn: boolean) => {
      if (!forced.decideLeavesTheAccessorAlone) real.applyPlo6OmahaStrategyCalibration(gateOn);
    },
  };
});

const NAME = 'omahaStrategyInPlo6';
const KEYS = Object.keys(OMAHA_STRATEGY_CONSTANT_DEFAULTS) as OmahaStrategyConstantKey[];
const PLO6 = { gameVariant: 'plo6' };
const REGISTERED = {
  turnRedrawNutFullHouseOnly: 1,
  cardImpactDistinctDrawOuts: 1,
  bigDrawContinueStraightOuts: 13,
} as const;
const plo6Reads = () => Object.fromEntries(KEYS.map((k) => [k, omahaStrategyConstant(k, PLO6)]));

afterEach(() => {
  forced.decideLeavesTheAccessorAlone = false;
  clearPlo6OmahaStrategyCalibration();
  vi.restoreAllMocks();
  HorseMind.reset();
});

describe('the accessor keys and the calibration entries', () => {
  /** key: [PLO6 value, source entry, same as the default]. */
  const TABLE: Record<OmahaStrategyConstantKey, [number | null, string | null, boolean]> = {
    facingBetEvMargin: [0.02, 'OMAHA_FACING_BET_EV_MARGIN', true],
    riverMediumBetRangeFactor: [null, 'OMAHA_RIVER_MEDIUM_BET_RANGE_FACTOR', true],
    pairedFoldRespectedMaxPrice: [0.25, 'PAIRED_FOLD_RESPECTED_MAX_PRICE', true],
    pairedFoldRespectedInvestedShare: [0.6, 'PAIRED_FOLD_RESPECTED_INVESTED_SHARE', true],
    oopTurnMinNutOuts: [4, 'OMAHA_OOP_TURN_MIN_NUT_OUTS', true],
    oopTurnShowdownCredit: [0.15, 'OMAHA_OOP_TURN_SHOWDOWN_CREDIT', true],
    oopTurnTokenPrice: [0.15, 'OMAHA_OOP_TURN_TOKEN_PRICE', true],
    cardImpactMargin: [0.04, 'OMAHA_CARD_IMPACT_MARGIN', true],
    streetPlanMarginPotShare: [0.02, 'OMAHA_STREET_PLAN_MARGIN_POT_SHARE', true],
    bigDrawMargin: [0.02, 'OMAHA_BIG_DRAW_MARGIN', true],
    raiseNeedsNutsFoldPrice: [1 / 3, 'OMAHA_RAISE_NEEDS_NUTS_FOLD_PRICE', true],
    eliteContinueMaxPotOdds: [null, null, true],
    bigBetPotShare: [0.7, 'OMAHA_BIG_BET_POT_SHARE', true],
    tournamentPushFoldMaxBB: [null, null, true],
    turnRedrawNutFullHouseOnly: [1, 'omahaTurnRedrawShare', false],
    cardImpactDistinctDrawOuts: [1, 'outsOf', false],
    bigDrawContinueStraightOuts: [13, 'omahaBigDrawContinues', false],
  };

  it('all 17 keys are mapped, each to an entry of the calibration or to none', () => {
    expect(KEYS).toHaveLength(17);
    expect(Object.keys(PLO6_OMAHA_STRATEGY_ACCESSOR_VALUES).sort()).toEqual([...KEYS].sort());
    for (const key of KEYS) {
      const { source, value } = PLO6_OMAHA_STRATEGY_ACCESSOR_VALUES[key];
      const [wantValue, wantSource, same] = TABLE[key];
      expect(value, key).toBe(wantValue);
      expect(source, key).toBe(wantSource);
      if (source !== null)
        expect(Object.keys(PLO6_OMAHA_STRATEGY_CONSTANTS), key).toContain(source);
      // a value that is one number in the calibration is that number, not a copy
      const entry = source === null ? undefined : PLO6_OMAHA_STRATEGY_CONSTANTS[source].value;
      if (typeof entry === 'number') expect(value, key).toBe(entry);
      // "same": no PLO6 number, or the default itself
      expect(value === null || value === OMAHA_STRATEGY_CONSTANT_DEFAULTS[key], key).toBe(same);
    }
    expect(Object.isFrozen(PLO6_OMAHA_STRATEGY_ACCESSOR_VALUES)).toBe(true);
  });

  it('the three switches follow their entries (H9, H19, H15)', () => {
    const c = PLO6_OMAHA_STRATEGY_CONSTANTS;
    expect(c.omahaTurnRedrawShare.value).toBe('full_house_only_when_no_bigger_full_house');
    expect(c.outsOf.value).toBe('distinct_unseen_completing_cards_each_once');
    expect(c.omahaBigDrawContinues.value).toBe('plo5_class_plus_13_straight_out_wraps');
    expect((c['omahaBigDrawAggression.outClasses'].value as number[])[0]).toBe(13);
  });

  it('what is registered is exactly the keys whose PLO6 value differs from the default', () => {
    const registered = plo6OmahaStrategyAccessorCalibration();
    expect(registered).toEqual(REGISTERED);
    for (const key of Object.keys(registered)) expect(KEYS).toContain(key);
    for (const key of KEYS)
      if (!(key in registered)) {
        const v = PLO6_OMAHA_STRATEGY_ACCESSOR_VALUES[key].value;
        expect(v === null || v === OMAHA_STRATEGY_CONSTANT_DEFAULTS[key], key).toBe(true);
      }
  });
});

describe('omahaStrategyConstant after the registration', () => {
  it('PLO4, PLO5 and every other game read the defaults; PLO6 reads its three values', () => {
    registerPlo6OmahaStrategyCalibration();
    for (const gs of [
      { gameVariant: 'plo4' },
      { gameVariant: 'plo5' },
      { gameVariant: 'PLO5' },
      { gameVariant: 'plo8' },
      { gameVariant: 'nlh' },
      {},
      null,
      undefined,
    ])
      for (const key of KEYS)
        expect(omahaStrategyConstant(key, gs), `${key} ${JSON.stringify(gs)}`).toBe(
          OMAHA_STRATEGY_CONSTANT_DEFAULTS[key]
        );
    expect(plo6Reads()).toEqual({ ...OMAHA_STRATEGY_CONSTANT_DEFAULTS, ...REGISTERED });
  });

  it('cleared, PLO6 reads the defaults again; the gate form registers only when on', () => {
    registerPlo6OmahaStrategyCalibration();
    clearPlo6OmahaStrategyCalibration();
    expect(plo6Reads()).toEqual({ ...OMAHA_STRATEGY_CONSTANT_DEFAULTS });
    applyPlo6OmahaStrategyCalibration(true);
    expect(plo6Reads()).toEqual({ ...OMAHA_STRATEGY_CONSTANT_DEFAULTS, ...REGISTERED });
    applyPlo6OmahaStrategyCalibration(false);
    expect(plo6Reads()).toEqual({ ...OMAHA_STRATEGY_CONSTANT_DEFAULTS });
    // only a boolean true is on
    for (const notOn of [undefined, null, 1, 'true', {}]) {
      applyPlo6OmahaStrategyCalibration(notOn as never);
      expect(plo6Reads(), String(notOn)).toEqual({ ...OMAHA_STRATEGY_CONSTANT_DEFAULTS });
    }
  });
});

describe('omahaStrategyInPlo6 in the ledger, the switch registry and the league', () => {
  it('is a typed option with a default-off ledger row', () => {
    const typed: HorseDecideOpts = { omahaStrategyInPlo6: true };
    expect(typed.omahaStrategyInPlo6).toBe(true);
    const rows = HORSE_DATA_LEDGER.filter((e) => e.kind === 'flag' && e.key === NAME);
    expect(rows).toHaveLength(1);
    expect(rows[0].note).toMatch(/default off/i);
    expect(rows[0].note).toMatch(/OFF-ONLY/);
    expect(rows[0].note).toContain('docs/horse-option-authority.d/omahaStrategyInPlo6.md');
  });

  it('is registered off-only, a hold of the PLO6 lane, release default off', () => {
    const entry = OPTION_SWITCH_PLAIN_REGISTRY.find((e) => e.name === NAME)!;
    expect(entry).toBeDefined();
    expect([...entry.states]).toEqual(['off']);
    expect(entry.releaseDefault).toBe('off');
    expect(OPTION_SWITCH_RELEASE_DEFAULT_OFF).toContain(NAME);
    expect(OPTION_SWITCH_OFF_ONLY_NAMES).toContain(NAME);
    expect(Object.hasOwn(OPTION_SWITCH_OFF_ONLY, NAME)).toBe(true);
    expect(entry.offOnly).toEqual(optionSwitchOffOnly(NAME));
    expect(entry.offOnly?.status).toBe('hold');
    expect(entry.offOnly?.reason).toBe(
      'PLO6 lane keeps it OFF until the six-card port is complete and reviewed (PLO6 checkpoint 2026-11-16)'
    );
  });

  it('an on row is refused everywhere an on row of any off-only option is', () => {
    const v2 = (options: Record<string, string>) => ({
      version: 2,
      style: { version: 1, options: {} },
      options,
    });
    expect(optionSwitchStatesFrom({ [NAME]: 'on' })).toBeNull();
    expect(parseOptionSwitchConfig(v2({ [NAME]: 'on', v16Ratio: 'off' }))).toEqual({ ok: false });
    expect(optionSwitchDecisionOpts({ [NAME]: 'on' } as never)).toEqual({});
    expect(optionSwitchStatesFrom({ [NAME]: 'off' })).toEqual({ [NAME]: 'off' });
    expect(parseOptionSwitchConfig(v2({ [NAME]: 'off' }))).toEqual({
      ok: true,
      states: { [NAME]: 'off' },
    });
    expect(optionSwitchDecisionOpts({ [NAME]: 'off' })).toEqual({ [NAME]: false });
    const entry = OPTION_SWITCH_PLAIN_REGISTRY.find((e) => e.name === NAME)!;
    expect(() =>
      assertOptionSwitchRegistry(
        OPTION_SWITCH_REGISTRY.map((e) =>
          e.name === NAME ? { ...entry, states: ['off', 'on'] as const } : e
        )
      )
    ).toThrow(/is off-only/);
  });

  it('the league refuses the one-option matchup, with its reason', () => {
    const refusal = UNMEASURABLE_MATCHUPS.find(
      (m) => (m.a as Record<string, unknown>)[NAME] === true
    )!;
    expect(refusal.name).toBe('plo6_omaha_strategy_in_plo6');
    expect(refusal.variant).toBe('plo6');
    expect(refusal.b).toEqual({});
    expect(refusal.reason).toMatch(/0 of 300 pairs diverged/);
  });
});

// ── Through HorseLogic.decide ──
const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (s: string): Card[] =>
  (s.match(/../g) ?? []).map((t) => ({ rank: t[0] as CardRank, suit: SUIT[t[1]] }));

const HERO = 4;
const NODE = 12;
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

interface Over {
  hole?: string;
  board?: string;
  variant?: string;
  /** the big blind bets the flop: the Horse faces a wager */
  facingBet?: boolean;
}

/** HorsePlo6MultiwayWeakBetWiring.test.ts's node: a three-way cash flop checked (or bet) to the preflop raiser. */
function fixture(o: Over = {}): ComplaintFixture {
  const variant = o.variant ?? 'plo6';
  const facing = o.facingBet === true;
  const pot = 2.55 + (facing ? 1.5 : 0);
  const actions: ComplaintAction[] = [
    { ord: 1, seat: 1, stage: 'preflop', action: 'sb', amount: 0.1 },
    { ord: 2, seat: 2, stage: 'preflop', action: 'bb', amount: 0.25 },
    { ord: 4, seat: 3, stage: 'preflop', action: 'fold', amount: 0 },
    { ord: 5, seat: 4, stage: 'preflop', action: 'raise', amount: 0.85, isFullRaise: true },
    { ord: 6, seat: 5, stage: 'preflop', action: 'fold', amount: 0 },
    { ord: 7, seat: 6, stage: 'preflop', action: 'fold', amount: 0 },
    { ord: 8, seat: 1, stage: 'preflop', action: 'call', amount: 0.75 },
    { ord: 9, seat: 2, stage: 'preflop', action: 'call', amount: 0.6 },
    { ord: 10, seat: 1, stage: 'flop', action: 'check', amount: 0 },
    facing
      ? { ord: 11, seat: 2, stage: 'flop', action: 'bet', amount: 1.5, isFullRaise: true }
      : { ord: 11, seat: 2, stage: 'flop', action: 'check', amount: 0 },
  ];
  return {
    version: 1,
    slug: 'plo6-strategy-registration-synthetic',
    title: 'synthetic three-way flop, the preflop raiser to act',
    complaint: 'synthetic',
    handId: 'synthetic',
    fmt: 'cash',
    variant,
    players: [1, 2, 3, 4, 5, 6].map((seat) => ({ seat, isHorse: true })),
    hole: { [HERO]: cards(o.hole ?? '3s3d9s6d5hQs') },
    actions: [
      ...actions,
      {
        ord: NODE,
        seat: HERO,
        stage: 'flop',
        action: 'check',
        amount: 0,
        publicNode: {
          pot,
          ante: 0,
          anteType: 'none',
          mode: 'cash',
          asset: 'chips',
          seats: [
            [1, 40.02, 0, 0.85, 0, 0, 0],
            [2, 92.93 - (facing ? 1.5 : 0), facing ? 1.5 : 0, facing ? 2.35 : 0.85, 0, 0, 0],
            [3, 54.43, 0, 0, 0, 0, 1],
            [4, 31.11, 0, 0.85, 0, 0, 0],
            [5, 216.74, 0, 0, 0, 0, 1],
            [6, 47.54, 0, 0, 0, 0, 1],
          ],
          boards: [o.board ?? 'QdAs5s'],
          street: 'flop',
          toCall: facing ? 1.5 : 0,
          currentBet: facing ? 1.5 : 0,
          minRaiseTo: facing ? 3 : 0.25,
          maxRaiseTo: facing ? 7.05 : pot,
          legalActions: facing ? ['fold', 'call', 'raise'] : ['check', 'bet'],
          dealerSeat: 6,
          chipUnit: 0.01,
          bigBlind: 0.25,
          smallBlind: 0.1,
          variant,
          structure: 'pot_limit',
          actorSeat: HERO,
          bombPot: false,
          boardCount: 1,
          allInOrFold: false,
          fixedBetSize: null,
          wagersCapped: false,
          deductions: {
            bbj: { feeBB: 0, enabled: false, minPotBB: 10, minPlayersDealt: 3 },
            rake: {
              cap: 0.62,
              percent: 10,
              noFlopNoDrop: true,
              playerCountCaps: [
                [2, 0.31],
                [3, 0.62],
                [4, 0.62],
              ],
            },
            rules: 'controller-rake-bbj-v1',
            status: 'captured',
            version: 1,
          } as never,
          tournamentStage: { status: 'not_applicable', version: 1 },
        },
      },
    ],
    forbidden: [],
    seeds: SEEDS,
  } as ComplaintFixture;
}

const LIVE = replayProfiles('cash').find((p) => p.live)!;
type NodeState = ReturnType<typeof stateAt>;
const flopNode = (o: Over) => (): NodeState => {
  const fx = fixture(o);
  return stateAt(fx, fx.actions.find((a) => a.ord === NODE)!);
};
/** A recorded node, and the same node dealt a sixth card that leaves the hand the same beaten made hand. */
const recorded = (fx: unknown, ord: number, six: boolean) => (): NodeState => {
  const f = JSON.parse(JSON.stringify(fx)) as ComplaintFixture;
  const st = stateAt(f, f.actions.find((a) => a.ord === ord)!);
  if (!six) return st;
  const board = st.gs.communityCards ?? [];
  const taken = new Set([...st.hero.cards, ...board].map((c) => `${c.rank}${c.suit}`));
  const before = omahaNutStatus(st.hero.cards, board).category;
  for (const rank of ['2', '3', '4', '5', '6', '7', '8', '9'] as CardRank[])
    for (const suit of Object.values(SUIT)) {
      if (taken.has(`${rank}${suit}`)) continue;
      const cards6 = [...st.hero.cards, { rank, suit } as Card];
      if (!omahaBeatenByBoard(cards6, board) || omahaNutStatus(cards6, board).category !== before)
        continue;
      st.hero.cards = cards6;
      const me = st.gs.players.find((p) => p.seat === st.hero.seat);
      if (me) me.cards = cards6;
      st.gs.gameVariant = 'plo6';
      return st;
    }
  throw new Error('no neutral sixth card');
};
const bytesOf = (d: unknown): string =>
  JSON.stringify(d, (k, v) => (/Ms$/.test(k) ? undefined : v));
const leader = { measured: true, tightReRaiser: false, valueLeader: true } as OmahaReadConditional;

/**
 * The live cash profile's decision at the node, one string per seed. Every
 * opponent reads as a measured value leader (the read the made-hand defence
 * option needs). `before` runs just before each decision.
 */
function play(
  build: () => NodeState,
  opts: HorseDecideOpts = {},
  before: () => void = () => {}
): string[] {
  const out: string[] = [];
  for (const seed of SEEDS) {
    HorseMind.reset();
    const read = vi
      .spyOn(HorseMind, 'omahaReadConditionalOf')
      .mockImplementation((() => leader) as never);
    seedFastRandom(seed);
    const st = build();
    expect(st.hero.cards).toHaveLength(Number(String(st.gs.gameVariant).slice(3)));
    before();
    out.push(bytesOf(HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, opts)));
    read.mockRestore();
  }
  HorseMind.reset();
  return out;
}

/** PLO strategy options of 2026-11-15, among them the readers of the three constants PLO6 changes. */
const STRATEGY_ON: HorseDecideOpts = {
  omahaMadeHandDefenseVsValueLeader: true,
  omahaBareOverpairOopFlopCheck: true,
  omahaOopTurnCheckAfterFlopCall: true,
  omahaTurnRiverRaiseNeedsNuts: true,
  omahaNoDrawRaiseOutOfPosition: true,
  omahaFacingBetEv: true,
  omahaCardImpact: true,
  omahaStreetPlan: true,
  omahaBigDrawAggression: true,
  omahaBluffCatcherRaiseFold: true,
  omahaUnderpairNoMultiwayFlopContinue: true,
};

const TURN_RAISE = recorded(TOP_TWO_JAMS, 19, true);
const TURN_BET = recorded(SET_LEADS, 18, true);
const STATES: Array<[string, () => NodeState]> = [
  ['PLO6 flop, a pair below the top card, checked to', flopNode({})],
  ['PLO6 flop, bottom two pair, checked to', flopNode({ hole: '5c6d9h8hAhQd', board: 'Kd5s9d' })],
  [
    'PLO6 flop, a flush draw with straight outs, facing a bet',
    flopNode({ hole: '3s3d4s6d5hQs', facingBet: true }),
  ],
  ['PLO6 turn, a beaten made hand facing a bet (recorded node, sixth card dealt)', TURN_RAISE],
  ['PLO6 turn, a beaten made hand on the fresh card (recorded node, sixth card dealt)', TURN_BET],
  [
    'PLO5 flop, a pair below the top card, checked to',
    flopNode({ variant: 'plo5', hole: '3s3d4s6d5h' }),
  ],
  ['PLO5 turn, the recorded raise over a turn bet', recorded(TOP_TWO_JAMS, 19, false)],
  ['PLO4 turn, the recorded bet into the fresh card', recorded(SET_LEADS, 18, false)],
];

describe('HorseLogic.decide with omahaStrategyInPlo6 unset or false', () => {
  for (const [name, build] of STATES) {
    it(`${name}: unset and false are the same decision at every seed`, () => {
      const unset = play(build);
      expect(unset).toHaveLength(SEEDS.length);
      expect(play(build, { omahaStrategyInPlo6: false })).toEqual(unset);
      // and with the strategy options themselves on
      expect(play(build, { ...STRATEGY_ON, omahaStrategyInPlo6: false })).toEqual(
        play(build, STRATEGY_ON)
      );
    }, 240_000);

    it(`${name}: the same decision before the registration, after it, and with the values held through the decision`, () => {
      for (const opts of [{}, STRATEGY_ON]) {
        clearPlo6OmahaStrategyCalibration();
        const before = play(build, opts);
        // registered before every decision: decide takes the values back, its gate being off
        const after = play(build, opts, registerPlo6OmahaStrategyCalibration);
        expect(after).toEqual(before);
        expect(plo6Reads()).toEqual({ ...OMAHA_STRATEGY_CONSTANT_DEFAULTS });
        // decide's own call skipped: the six-card values stay in the accessor for the whole
        // decision, and the readers' own game gates still keep the decision where it was
        forced.decideLeavesTheAccessorAlone = true;
        const held = play(build, opts, registerPlo6OmahaStrategyCalibration);
        expect(plo6Reads()).toEqual({ ...OMAHA_STRATEGY_CONSTANT_DEFAULTS, ...REGISTERED });
        forced.decideLeavesTheAccessorAlone = false;
        expect(held).toEqual(before);
      }
    }, 480_000);
  }

  it('the gate is live on the two PLO6 turn nodes: on, with the strategy options on, the decision changes', () => {
    for (const build of [TURN_RAISE, TURN_BET]) {
      const off = play(build, STRATEGY_ON);
      const on = play(build, { ...STRATEGY_ON, omahaStrategyInPlo6: true });
      expect(on).not.toEqual(off);
      // alone it is no rule: with no strategy option on, the gate changes nothing
      expect(play(build, { omahaStrategyInPlo6: true })).toEqual(play(build));
    }
  }, 240_000);

  /** One decision at the first state; what the accessor and the scope held inside it (decideCaptured's own first and last statement). */
  function inside(opts: object, before: () => void = () => {}) {
    const reads: Array<Record<string, number>> = [];
    const scopes: boolean[] = [];
    const spy = vi.spyOn(HorseMind, 'setProbeAwareAggression').mockImplementation((() => {
      reads.push(plo6Reads());
      scopes.push(omahaStrategyGameScopeNow().plo6);
    }) as never);
    const st = flopNode({})();
    before();
    HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, { mind: false, ...opts } as never);
    spy.mockRestore();
    expect(reads.length).toBeGreaterThan(0);
    return { reads, scopes };
  }

  it('inside a decision whose gate is off the accessor holds no PLO6 value, whatever was registered', () => {
    for (const opts of [
      {},
      { omahaStrategyInPlo6: false },
      { omahaStrategyInPlo6: 1 },
      STRATEGY_ON,
    ]) {
      const { reads, scopes } = inside(opts, registerPlo6OmahaStrategyCalibration);
      for (const r of reads) expect(r).toEqual({ ...OMAHA_STRATEGY_CONSTANT_DEFAULTS });
      expect(scopes.every((on) => on === false)).toBe(true);
    }
  }, 120_000);

  it('inside a decision whose gate is on the accessor holds the PLO6 values, and the next gate-off decision takes them back', () => {
    const on = { ...OMAHA_STRATEGY_CONSTANT_DEFAULTS, ...REGISTERED };
    const off = { ...OMAHA_STRATEGY_CONSTANT_DEFAULTS };
    for (const [opts, want] of [
      [{ omahaStrategyInPlo6: true }, on],
      [{}, off],
      [{ omahaStrategyInPlo6: true }, on],
      [{ omahaStrategyInPlo6: false }, off],
    ] as const) {
      const { reads, scopes } = inside(opts);
      for (const r of reads) expect(r).toEqual(want);
      expect(scopes.every((s) => s === (want === on))).toBe(true);
    }
  }, 120_000);
});
