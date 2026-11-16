/**
 * LAW (2026-11-16, Fixed-Limit lane): A FIXED-LIMIT READ IS JUDGED AGAINST THE FIXED-LIMIT HORSE POPULATION, with
 * HorseDecideOpts.fixedLimitPopulationCells on (read as === true, DEFAULT OFF), and nothing else moves.
 *
 * The defect (Phase 3 diagnosis, P3-TIGHT-READ-DESIGN.md). The style and exploit reads judge an opponent against the
 * Horse population cell of his game and table size (exploitEnvelopeFor). The 2026-10-16 fixed-limit cells are sparse
 * (+/- 0.20 around a few horses) and there is no flo8 full-ring cell, so a full-ring flo8 read borrowed flo8 short:
 * a VPIP mean of 0.526 against the 0.31 Horses actually play, so an ordinary flo8 player read tight. The option
 * swaps in FIXED_LIMIT_POPULATION_ENVELOPE, measured from 107,538 Horse-only fixed-limit cash hands
 * (2026-11-09..16, public actions only), at the decision's own game and size; thresholds, margins, minimum hands
 * and credibility are unchanged.
 *
 * SCOPE (2026-11-16, lane owner's decision on AB-EVALUATION-2 section 3.13): fixed-limit hold'em only. flo8 was
 * measured and is out of scope by code (FIXED_LIMIT_POPULATION_CELLS_IN_SCOPE): at six seats against the Horse field
 * the option lost 2.29 +/- 0.71 BB/100, almost all preflop.
 *
 * CASH ONLY (2026-11-16, lane owner's decision on the independent review, note 2): the cells were measured from cash
 * hands only, so HorseLogic adds the option to the decision's read options only at a cash table (!isTournamentMode,
 * the same cash/tournament test W5 uses); at a tournament table every read is main's envelope.
 *
 * (1) With the option on, every no-limit and pot-limit read gets exactly main's envelope (same object), at every
 *     size; a flh read gets its own measured cell; outside a decision the option cannot engage, asserted at flh
 *     (the variant it acts on), so a scope-less option that survived would fail here. The cell is taken only when
 *     the variant's betting structure is fixed limit: a decision whose variant has a frozen cell but whose structure
 *     is not fixed limit (here a stubbed structure: today bettingStructureFor derives the structure from the variant
 *     name, so no production state can carry flh without fixed limit) gets main's envelope. Only an explicit true
 *     engages: 'true', 1, 'yes', {} and [] add no key in HorseLogic and, set straight on the read options, take main's
 *     envelope. Every read frame (opponentExploitRead, presumedAggressorRead) and the style receipt name the version
 *     of the envelope they were judged against.
 * (2) A PROPERTY OF THE FROZEN CENSUS ONLY: at the frozen census (every Horse's own decayed counters at the end of
 *     the export window, built as the learner builds them, fixture fixed-limit-population-census.json), ON labels no
 *     more players tight than OFF for each tight read (participation tight, tight-opener respect, tight-reraiser
 *     respect), in every cell; at full-ring flh tight-opener respect engages on at most 1% of Horses. This is NOT a
 *     general claim that ON never labels more players tight than OFF: in play and on early samples tight-reraiser
 *     respect engages MORE often with ON (AB-EVALUATION-2 3.13: flh 6 against the Horse field 528 hero decisions on
 *     against 104 off; a Horse seat read tight against the tight-passive script 885 against 252), because the ON
 *     three-bet cell means are higher at every flh size (hu 0.0897 -> 0.0997, short 0.0623 -> 0.0762, full
 *     0.0347 -> 0.0527), so "three-bet credibly low" is reached more easily; case (3b) shows it on seeded histories.
 *     Measured at 3c2a13338a83, before the scope (share of census Horses, off -> on; participation tight /
 *     tight-opener): flh hu 2.6% -> 1.1% / 0 -> 0; flh short 8.1% -> 3.9% / 1.1% -> 0.3%; flh full 35.2% -> 18.2%
 *     / 14.1% -> 0.9%; and with the flo8 cells, now unused: flo8 hu 4.9% -> 2.4%; flo8 short 57.2% -> 15.0%;
 *     flo8 full 73.8% -> 26.7% (tight-opener respect never acts in an Omaha scope). The participation label reads
 *     "tight" relative to half the band (score below the tight threshold and credible), not "outside the band", so
 *     the lower part of the Horse distribution keeps that label with the option on; that rule is unchanged here.
 * (2b) REGRESSION PIN: the exact count of census Horses every consumer of the tight reads engages on, ON and OFF, in
 *     every cell (participation tight, tight-opener respect, tight-reraiser respect, isValueBettor,
 *     tightPassiveFolder, tightNotAggressive). Any change to a cell mean, band or threshold that moves one Horse fails
 *     here, including a change that law (2) would let through (a full-ring three-bet mean raised to 0.09 keeps ON
 *     under OFF but moves the count). One downstream consumer rises at the census: tightPassiveFolder at flh short,
 *     0 -> 1.
 * (3) A synthetic 10% VPIP / 6% PFR history reads tight by its 40th hand at full-ring flh with the option on; a 20%
 *     history never does.
 * (3b) EARLY SAMPLES: seeded full-ring flh preflop histories (150 seeds per profile; a Horse opens in front of him on
 *     40% of hands) document tight-reraiser respect at hand 40, ON against OFF, including the players it engages on
 *     only with ON; the sample gates are identical ON and OFF at every hand: the evidence state and the three-bet
 *     opportunities are the same, and with too few hands (fewer than 15 decayed hands, or fewer than 8 three-bet
 *     opportunities for the three-bet side) neither arm fires.
 * (4) The option is registered in the live switch, release default OFF, owner Fixed-Limit, and OFF-ONLY under the
 *     owner's preflop range hold (main's rule: an option that changes a preflop range is off-only until the owner lifts
 *     the hold for it by name, in source). Turning it on needs that lift, then Hand Analysis's route (its exact-head
 *     ACCEPT and the recorded evidence row).
 * (5) flo8 is inert with the option on: every flo8 envelope is main's (full ring still borrows flo8 short), every
 *     flo8 census read equals the read with the option off, and seeded flo8 cash and tournament decision streams are
 *     identical with the option on and off (the same comparison sees the option at flh cash).
 * (6) Tournament flh is inert with the option on: HorseLogic adds no key at a tournament table (gameMode tournament,
 *     or a tournament snapshot without a mode), every read there is main's envelope and names main's version, and a
 *     seeded flh tournament decision stream is identical with the option on and off.
 * (7) The frozen table is pinned by value: every mean, lo and hi of all six cells equals the generator's output for
 *     version fixed-limit-population-2026-11-16, and the table holds nothing else. Law (2b) catches only a change that
 *     moves a consumer of the tight reads; this catches any change to a cell value (a postflop mean, a band edge).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
// A stubbed betting structure for law (1): empty = the real bettingStructureFor; a variant added here reads no_limit.
const structureStub = vi.hoisted(() => ({ noLimit: new Set<string>() }));
vi.mock('./BettingStructure.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('./BettingStructure.js')>();
  return {
    ...real,
    bettingStructureFor: (variant?: string | null) =>
      structureStub.noLimit.has((variant || '').toLowerCase())
        ? ('no_limit' as const)
        : real.bettingStructureFor(variant),
  };
});
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HorseMind, readScopeOf } from './HorseMind.js';
import { HorseLogic } from './HorseLogic.js';
import {
  EXPLOIT_COUNTER_FIELDS,
  EXPLOIT_LONG_FIELDS,
  EXPLOIT_STATS,
  FIXED_LIMIT_POPULATION_ENVELOPE,
  FIXED_LIMIT_POPULATION_ENVELOPE_VERSION,
  FIXED_LIMIT_POPULATION_CELLS_IN_SCOPE,
  OPPONENT_EXPLOIT_ENVELOPE,
  OPPONENT_EXPLOIT_ENVELOPE_VERSION,
  exploitEnvelopeFor,
  exploitEnvelopeVersionFor,
  exploitHandIncrements,
  observeExploitRow,
  opponentExploitRead,
  presumedAggressorRead,
  type ExploitCounters,
  type ExploitHandAction,
} from './HorseOpponentExploit.js';
import {
  STYLE_THRESHOLDS,
  classifyOpponentStyle,
  isValueBettor,
  tightOpenerRespect,
  tightReRaiserRespect,
  type OpponentStyleRead,
} from './HorseOpponentStyle.js';
import { tightNotAggressive, tightPassiveFolder } from './HorseTightPlayerExploit.js';
import { OPTION_SWITCH_REGISTRY, optionSwitchOffOnly } from './HorseOptionSwitch.js';
import { HORSE_DATA_LEDGER } from './HorseDataLedger.js';
import { bettingStructureFor } from './BettingStructure.js';
import { playNeutralityRun } from './HorseOpponentExploitNeutrality.test-support.js';
import type { ReadScope } from './HorseMind.js';

const SIZES = ['hu', 'short', 'full'] as const;
const DEALT = { hu: 2, short: 4, full: 6 } as const;
const NON_FIXED_LIMIT = ['nlh', 'plo4', 'plo5', 'plo6', 'plo8', 'short_deck', 'pineapple'] as const;
const FIXED_LIMIT = ['flh', 'flo8'] as const;

function inDecision<T>(scope: ReadScope, variant: string, on: boolean, fn: () => T): T {
  HorseMind.setDecisionScope(scope, variant, 'cash');
  HorseMind.setDecisionReadOptions(on ? { fixedLimitPopulationCells: true } : {});
  try {
    return fn();
  } finally {
    HorseMind.setDecisionScope(null);
  }
}
/** main's answer: the variant's own cell at the nearest measured size, else the family cell */
function mainEnvelope(scope: ReadScope, variant: string) {
  const size = scope.slice(scope.indexOf(':') + 1);
  for (const s of [size, 'short', 'full', 'hu']) {
    const own = OPPONENT_EXPLOIT_ENVELOPE[`${variant}:${s}`];
    if (own) return own;
  }
  return OPPONENT_EXPLOIT_ENVELOPE[scope];
}

/** The sample gates, unchanged by the option: decayed hands before any side, three-bet opportunities. */
const STYLE_MIN_HANDS = STYLE_THRESHOLDS.preflopMinHands;
const STYLE_MIN_THREE_BET_OPPS = STYLE_THRESHOLDS.conditionedMinOpps;
/** Truthy values that are not the boolean true: each is OFF (read as === true). */
const TRUTHY_NOT_TRUE: readonly unknown[] = ['true', 1, 'yes', {}, []];
const SEAT_A = { user_id: 'a', seat: 1 } as never;
/** a six-handed flh decision state for HorseLogic.prepareOriginalReads */
function flhState(extra: Readonly<Record<string, unknown>>) {
  return {
    gameVariant: 'flh',
    players: ['a', 'b', 'c', 'd', 'e', 'f'].map((user_id, i) => ({ user_id, seat: i + 1 })),
    ...extra,
  };
}

/**
 * (7) The frozen table, by value: the generator's output for version fixed-limit-population-2026-11-16
 * (server/src/scripts/fixedLimitPopulationEnvelope.ts over the archived 1,008 ten-minute slices; agent evidence
 * fixed-limit-01Gw7aDr/p3-population/out/envelope.ts.txt, sha256 45ffc9510036e2b2, which the independent review rebuilt
 * byte-identical), [mean, lo, hi] per statistic in EXPLOIT_STATS order. A new measurement gets a new version.
 */
const GENERATOR_OUTPUT: Readonly<Record<string, readonly (readonly [number, number, number])[]>> = {
  'flh:hu': [
    [0.7164, 0.6364, 0.7964], // vpip
    [0.4658, 0.3858, 0.5458], // pfr
    [0.7338, 0.6538, 0.8138], // rfi
    [0.0997, 0.0197, 0.1797], // threeBet
    [0, 0, 0.08], // foldTo3Bet
    [0.3228, 0.1719, 0.4737], // betCheckedTo
    [0.3546, 0.2746, 0.4346], // foldToBet
    [0.5884, 0.3386, 0.8381], // riverCall
  ],
  'flh:short': [
    [0.3471, 0.2142, 0.4576], // vpip
    [0.2055, 0.1219, 0.3103], // pfr
    [0.2662, 0.1612, 0.3934], // rfi
    [0.0762, 0.0131, 0.1504], // threeBet
    [0.0075, 0, 0.0875], // foldTo3Bet
    [0.383, 0.2223, 0.5702], // betCheckedTo
    [0.3569, 0.2177, 0.4852], // foldToBet
    [0.599, 0.519, 0.679], // riverCall
  ],
  'flh:full': [
    [0.2143, 0.1352, 0.3216], // vpip
    [0.1066, 0.0675, 0.1578], // pfr
    [0.1298, 0.0788, 0.1991], // rfi
    [0.0527, 0.0126, 0.1032], // threeBet
    [0.0032, 0, 0.0832], // foldTo3Bet
    [0.3576, 0.2274, 0.5222], // betCheckedTo
    [0.3324, 0.2039, 0.4751], // foldToBet
    [0.653, 0.528, 0.817], // riverCall
  ],
  'flo8:hu': [
    [0.4769, 0.3015, 0.5866], // vpip
    [0.2716, 0.1698, 0.3759], // pfr
    [0.3163, 0.2363, 0.3963], // rfi
    [0.101, 0.021, 0.181], // threeBet
    [0, 0, 0.08], // foldTo3Bet
    [0.3939, 0.218, 0.5698], // betCheckedTo
    [0.17, 0.09, 0.25], // foldToBet
    [0.6573, 0.5773, 0.7373], // riverCall
  ],
  'flo8:short': [
    [0.3471, 0.1795, 0.4865], // vpip
    [0.1642, 0.0671, 0.26], // pfr
    [0.1955, 0.095, 0.3111], // rfi
    [0.0722, 0.0175, 0.1708], // threeBet
    [0.0026, 0, 0.0826], // foldTo3Bet
    [0.3564, 0.1669, 0.5435], // betCheckedTo
    [0.2065, 0.0928, 0.3013], // foldToBet
    [0.6879, 0.5968, 0.7791], // riverCall
  ],
  'flo8:full': [
    [0.3116, 0.1838, 0.5417], // vpip
    [0.1412, 0.0784, 0.2018], // pfr
    [0.1782, 0.115, 0.2558], // rfi
    [0.0654, 0, 0.1424], // threeBet
    [0.0076, 0, 0.0876], // foldTo3Bet
    [0.307, 0.1726, 0.4481], // betCheckedTo
    [0.211, 0.1033, 0.3169], // foldToBet
    [0.7007, 0.5838, 0.8028], // riverCall
  ],
};

/** The six per-Horse consumers of the tight reads, as booleans. */
function tightConsumers(s: OpponentStyleRead) {
  return {
    participationTight: s.participation.side === 'tight' && s.participation.credible,
    tightOpener: tightOpenerRespect(s) !== null,
    tightReRaiser: tightReRaiserRespect(s) !== null,
    valueBettor: isValueBettor(s),
    tightPassiveFolder: tightPassiveFolder(s) !== null,
    tightNotAggressive: tightNotAggressive(s) !== null,
  };
}
type ConsumerCounts = Record<keyof ReturnType<typeof tightConsumers>, number>;

afterEach(() => HorseMind.setDecisionScope(null));

describe('(1) only a fixed-limit read moves, and only with the option on inside a decision', () => {
  it('no-limit and pot-limit reads get exactly main envelope at every size, option on or off', () => {
    for (const v of NON_FIXED_LIMIT)
      for (const size of SIZES) {
        const scope = readScopeOf(v, DEALT[size]);
        const off = inDecision(scope, v, false, () => exploitEnvelopeFor(scope, v));
        const on = inDecision(scope, v, true, () => exploitEnvelopeFor(scope, v));
        expect(on, `${v}:${size}`).toBe(off);
        expect(on, `${v}:${size}`).toBe(mainEnvelope(scope, v));
        expect(inDecision(scope, v, true, () => exploitEnvelopeVersionFor(scope, v))).toBe(
          OPPONENT_EXPLOIT_ENVELOPE_VERSION
        );
      }
  });

  it('a flh read gets its own measured cell with the option on, and main envelope with it off', () => {
    for (const size of SIZES) {
      const scope = readScopeOf('flh', DEALT[size]);
      const on = inDecision(scope, 'flh', true, () => exploitEnvelopeFor(scope, 'flh'));
      expect(on, `flh:${size}`).toBe(FIXED_LIMIT_POPULATION_ENVELOPE[`flh:${size}`]);
      expect(on, `flh:${size}`).toBeDefined();
      expect(inDecision(scope, 'flh', false, () => exploitEnvelopeFor(scope, 'flh'))).toBe(
        mainEnvelope(scope, 'flh')
      );
      expect(inDecision(scope, 'flh', true, () => exploitEnvelopeVersionFor(scope, 'flh'))).toBe(
        FIXED_LIMIT_POPULATION_ENVELOPE_VERSION
      );
    }
    expect([...FIXED_LIMIT_POPULATION_CELLS_IN_SCOPE]).toEqual(['flh']);
  });

  it('a decision whose variant has a frozen cell but whose structure is not fixed limit gets main envelope', () => {
    structureStub.noLimit.add('flh');
    try {
      expect(bettingStructureFor('flh')).toBe('no_limit');
      for (const size of SIZES) {
        const scope = readScopeOf('flh', DEALT[size]);
        expect(FIXED_LIMIT_POPULATION_ENVELOPE[`flh:${size}`]).toBeDefined();
        const on = inDecision(scope, 'flh', true, () => exploitEnvelopeFor(scope, 'flh'));
        expect(on, `flh:${size} no-limit`).toBe(mainEnvelope(scope, 'flh'));
        expect(on, `flh:${size} no-limit`).not.toBe(FIXED_LIMIT_POPULATION_ENVELOPE[`flh:${size}`]);
        expect(inDecision(scope, 'flh', true, () => exploitEnvelopeVersionFor(scope, 'flh'))).toBe(
          OPPONENT_EXPLOIT_ENVELOPE_VERSION
        );
      }
    } finally {
      structureStub.noLimit.clear();
    }
    expect(bettingStructureFor('flh')).toBe('fixed_limit');
  });

  it('outside a decision the option cannot engage (asserted at flh, the variant it acts on)', () => {
    for (const size of SIZES) {
      const scope = readScopeOf('flh', DEALT[size]);
      HorseMind.setDecisionScope(null);
      HorseMind.setDecisionReadOptions({ fixedLimitPopulationCells: true });
      expect(HorseMind.currentDecisionReadOptions(), `flh:${size}`).toEqual({});
      expect(exploitEnvelopeFor(scope, 'flh'), `flh:${size}`).toBe(mainEnvelope(scope, 'flh'));
      expect(exploitEnvelopeVersionFor(scope, 'flh')).toBe(OPPONENT_EXPLOIT_ENVELOPE_VERSION);
      // a decision that ends takes its options with it
      HorseMind.setDecisionScope(scope, 'flh', 'cash');
      HorseMind.setDecisionReadOptions({ fixedLimitPopulationCells: true });
      expect(exploitEnvelopeFor(scope, 'flh')).toBe(FIXED_LIMIT_POPULATION_ENVELOPE[`flh:${size}`]);
      HorseMind.setDecisionScope(null);
      expect(exploitEnvelopeFor(scope, 'flh'), `flh:${size} after`).toBe(
        mainEnvelope(scope, 'flh')
      );
    }
  });

  it('HorseLogic carries the option beside the scope only when it is explicitly true', () => {
    const gameState = flhState({ gameMode: 'cash' });
    HorseLogic.prepareOriginalReads(SEAT_A, gameState as never, {
      fixedLimitPopulationCells: true,
      mind: false,
    });
    expect(HorseMind.currentDecisionReadOptions().fixedLimitPopulationCells).toBe(true);
    const scope = HorseMind.currentScope()!;
    expect(exploitEnvelopeFor(scope, 'flh')).toBe(
      FIXED_LIMIT_POPULATION_ENVELOPE[`flh:${scope.slice(scope.indexOf(':') + 1)}`]
    );
    HorseMind.setDecisionScope(null);
    HorseLogic.prepareOriginalReads(SEAT_A, gameState as never, { mind: false });
    expect('fixedLimitPopulationCells' in HorseMind.currentDecisionReadOptions()).toBe(false);
    HorseMind.setDecisionScope(null);
    // truthy values that are not the boolean true are OFF: no key, main's envelope, main's version
    for (const truthy of TRUTHY_NOT_TRUE) {
      HorseLogic.prepareOriginalReads(SEAT_A, gameState as never, {
        fixedLimitPopulationCells: truthy as never,
        mind: false,
      });
      const label = JSON.stringify(truthy);
      expect('fixedLimitPopulationCells' in HorseMind.currentDecisionReadOptions(), label).toBe(
        false
      );
      const sc = HorseMind.currentScope()!;
      expect(exploitEnvelopeFor(sc, 'flh'), label).toBe(mainEnvelope(sc, 'flh'));
      expect(exploitEnvelopeVersionFor(sc, 'flh'), label).toBe(OPPONENT_EXPLOIT_ENVELOPE_VERSION);
      HorseMind.setDecisionScope(null);
    }
  });

  it('the decision probe reads only an explicit true: truthy read options take main envelope', () => {
    for (const size of SIZES) {
      const scope = readScopeOf('flh', DEALT[size]);
      for (const truthy of TRUTHY_NOT_TRUE) {
        HorseMind.setDecisionScope(scope, 'flh', 'cash');
        HorseMind.setDecisionReadOptions({ fixedLimitPopulationCells: truthy as never });
        try {
          const label = `flh:${size} ${JSON.stringify(truthy)}`;
          expect(exploitEnvelopeFor(scope, 'flh'), label).toBe(mainEnvelope(scope, 'flh'));
          expect(exploitEnvelopeVersionFor(scope, 'flh'), label).toBe(
            OPPONENT_EXPLOIT_ENVELOPE_VERSION
          );
        } finally {
          HorseMind.setDecisionScope(null);
        }
      }
    }
  });

  it('every read frame and the style receipt name the envelope version they were judged against', () => {
    // a player who raises every hand: an engaged exploit read and a supported style read in both arms, every size
    const rows = new Map<string, ExploitCounters>();
    const id = '30000000-0000-4000-8000-000000000031';
    for (let n = 0; n < 60; n++) {
      const actions: ExploitHandAction[] = [
        {
          userId: id,
          stage: 'preflop',
          action: 'raise',
          origin: 'player',
          amount: 2,
          isFullRaise: true,
        },
      ];
      for (const [k, inc] of exploitHandIncrements(actions, true))
        observeExploitRow(rows, k, inc, 1e9, true);
    }
    const counters = rows.get(id)!;
    for (const size of SIZES) {
      const scope = readScopeOf('flh', DEALT[size]);
      for (const on of [true, false]) {
        const want = on
          ? FIXED_LIMIT_POPULATION_ENVELOPE_VERSION
          : OPPONENT_EXPLOIT_ENVELOPE_VERSION;
        const label = `flh:${size} ${on ? 'on' : 'off'}`;
        inDecision(scope, 'flh', on, () => {
          const frame = opponentExploitRead(counters, scope, 'flh');
          expect(frame, label).not.toBeNull();
          expect(frame!.envelope, label).toBe(want);
          const presumed = presumedAggressorRead(null, undefined, scope, 'flh');
          expect(presumed.outcome, label).toBe('presumed');
          expect(presumed.read!.envelope, label).toBe(want);
          const style = classifyOpponentStyle({ scope, variant: 'flh', domain: 'cash', counters });
          expect(style.evidence.state, label).toBe('supported_individual_read');
          expect(style.receipt.envelope, label).toBe(want);
        });
      }
    }
    expect(FIXED_LIMIT_POPULATION_ENVELOPE_VERSION).toBe('fixed-limit-population-2026-11-16');
    expect(FIXED_LIMIT_POPULATION_ENVELOPE_VERSION).not.toBe(OPPONENT_EXPLOIT_ENVELOPE_VERSION);
  });
});

describe('(2) the frozen census through the style read (a property of the census snapshot only)', () => {
  const fx = JSON.parse(
    readFileSync(
      resolve(process.cwd(), 'src/engine/fixtures/fixed-limit-population-census.json'),
      'utf8'
    )
  ) as { fields: string[]; cells: Record<string, number[][]> };
  const fields = [...EXPLOIT_COUNTER_FIELDS, ...EXPLOIT_LONG_FIELDS] as string[];
  const tally = (cell: string, on: boolean): ConsumerCounts & { horses: number } => {
    const [variant, size] = cell.split(':') as [string, keyof typeof DEALT];
    const scope = readScopeOf(variant, DEALT[size]);
    const counts: ConsumerCounts = {
      participationTight: 0,
      tightOpener: 0,
      tightReRaiser: 0,
      valueBettor: 0,
      tightPassiveFolder: 0,
      tightNotAggressive: 0,
    };
    for (const r of fx.cells[cell]!) {
      const counters = Object.fromEntries(
        fields.map((f, i) => [f, r[i]])
      ) as unknown as ExploitCounters;
      const s: OpponentStyleRead = inDecision(scope, variant, on, () =>
        classifyOpponentStyle({ scope, variant, domain: 'cash', counters })
      );
      for (const [k, v] of Object.entries(tightConsumers(s)))
        if (v) counts[k as keyof ConsumerCounts]++;
    }
    return { horses: fx.cells[cell]!.length, ...counts };
  };

  it('the fixture is the declared census: fields in wire order, all six cells', () => {
    expect(fx.fields).toEqual(fields);
    expect(Object.keys(fx.cells).sort()).toEqual(
      ['flh:full', 'flh:hu', 'flh:short', 'flo8:full', 'flo8:hu', 'flo8:short'].sort()
    );
  });

  it('at the frozen census, ON labels no more players tight than OFF for each tight read, in every cell', () => {
    for (const v of FIXED_LIMIT)
      for (const size of SIZES) {
        const off = tally(`${v}:${size}`, false);
        const on = tally(`${v}:${size}`, true);
        expect(on.participationTight, `${v}:${size} participation tight`).toBeLessThanOrEqual(
          off.participationTight
        );
        expect(on.tightOpener, `${v}:${size} tight-opener`).toBeLessThanOrEqual(off.tightOpener);
        expect(on.tightReRaiser, `${v}:${size} tight-reraiser`).toBeLessThanOrEqual(
          off.tightReRaiser
        );
      }
  });

  it('full-ring flh: tight-opener respect engages on at most 1% of census Horses', () => {
    const on = tally('flh:full', true);
    expect(on.tightOpener / on.horses).toBeLessThanOrEqual(0.01);
  });

  it('(2b) regression pin: the exact census count of every consumer of the tight reads, ON and OFF, every cell', () => {
    // [participationTight, tightOpener, tightReRaiser, valueBettor, tightPassiveFolder, tightNotAggressive]
    const pin: Record<string, { horses: number; off: number[]; on: number[] }> = {
      'flh:hu': { horses: 189, off: [5, 0, 3, 5, 0, 5], on: [2, 0, 3, 5, 0, 2] },
      'flh:short': { horses: 356, off: [29, 4, 12, 26, 0, 21], on: [14, 1, 11, 24, 1, 10] },
      'flh:full': { horses: 455, off: [160, 64, 69, 264, 24, 155], on: [83, 4, 17, 117, 5, 75] },
      // flo8 is out of scope: ON is OFF
      'flo8:hu': { horses: 246, off: [12, 0, 0, 0, 0, 0], on: [12, 0, 0, 0, 0, 0] },
      'flo8:short': { horses: 432, off: [247, 0, 0, 0, 0, 0], on: [247, 0, 0, 0, 0, 0] },
      'flo8:full': { horses: 461, off: [340, 0, 0, 0, 0, 0], on: [340, 0, 0, 0, 0, 0] },
    };
    const order: (keyof ConsumerCounts)[] = [
      'participationTight',
      'tightOpener',
      'tightReRaiser',
      'valueBettor',
      'tightPassiveFolder',
      'tightNotAggressive',
    ];
    const measured: typeof pin = {};
    for (const cell of Object.keys(pin)) {
      const off = tally(cell, false);
      const on = tally(cell, true);
      measured[cell] = {
        horses: off.horses,
        off: order.map((k) => off[k]),
        on: order.map((k) => on[k]),
      };
    }
    expect(measured).toEqual(pin);
  });
});

describe('(3) synthetic histories: a tight player is read tight, an ordinary one never', () => {
  const PHI = (Math.sqrt(5) - 1) / 2;
  const regular = '30000000-0000-4000-8000-000000000011';
  const horse = '40000000-0000-4000-8000-000000000013';
  /** his preflop action on hand n at the given rates (raise, call or fold, a low-discrepancy sequence) */
  function hand(n: number, vpip: number, pfr: number): ExploitHandAction[] {
    const u = ((n + 1) * PHI) % 1;
    const a = u < pfr ? 'raise' : u < vpip ? 'call' : 'fold';
    return [
      {
        userId: regular,
        stage: 'preflop',
        action: a,
        origin: 'player',
        amount: a === 'raise' ? 2 : a === 'call' ? 1 : 0,
        isFullRaise: a === 'raise' ? true : undefined,
      },
      { userId: horse, stage: 'preflop', action: 'fold', origin: 'horse_policy', amount: 0 },
    ];
  }
  /** the first hand (1-based) at which the full-ring read is tight, or -1 within `max` hands */
  function firstTight(variant: string, vpip: number, pfr: number, max = 400): number {
    const scope = readScopeOf(variant, 6);
    const rows = new Map<string, ExploitCounters>();
    for (let n = 0; n < max; n++) {
      for (const [id, inc] of exploitHandIncrements(hand(n, vpip, pfr), true))
        observeExploitRow(rows, id, inc, 1e9, true);
      const s = inDecision(scope, variant, true, () =>
        classifyOpponentStyle({ scope, variant, domain: 'cash', counters: rows.get(regular)! })
      );
      if (s.participation.side === 'tight' && s.participation.credible) return n + 1;
    }
    return -1;
  }

  it('a 10% VPIP / 6% PFR player reads tight by his 40th hand at full-ring flh', () => {
    const n = firstTight('flh', 0.1, 0.06);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(40);
  });

  it('an ordinary player (20%) never reads tight at full-ring flh', () => {
    expect(firstTight('flh', 0.2, 0.1)).toBe(-1);
  });
});

/**
 * (3b) tight-reraiser respect over 150 seeded runs per profile, recorded 2026-11-16: engaged at hand 40, engaged at
 * any hand up to 40, and engaged at hand 60; on/off = runs engaged in that arm, onOnly/offOnly = in that arm alone.
 */
const EARLY_SAMPLE_PIN = {
  tight: {
    at40: { on: 58, off: 89, onOnly: 4, offOnly: 35 },
    anyBy40: { on: 79, off: 108, onOnly: 3, offOnly: 32 },
    at60: { on: 85, off: 111, onOnly: 8, offOnly: 34 },
  },
  horseLike: {
    at40: { on: 6, off: 11, onOnly: 2, offOnly: 7 },
    anyBy40: { on: 19, off: 35, onOnly: 2, offOnly: 18 },
    at60: { on: 31, off: 27, onOnly: 15, offOnly: 11 },
  },
  loose: {
    at40: { on: 2, off: 1, onOnly: 2, offOnly: 1 },
    anyBy40: { on: 3, off: 5, onOnly: 2, offOnly: 4 },
    at60: { on: 24, off: 4, onOnly: 20, offOnly: 0 },
  },
};

describe('(3b) early samples: ON against OFF on seeded full-ring flh histories; identical sample gates', () => {
  const subject = '30000000-0000-4000-8000-000000000021';
  const opener = '40000000-0000-4000-8000-000000000023';
  /** a small seeded generator (mulberry32), so every run deals the same histories */
  function rngOf(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  type Profile = { salt: number; vpip: number; pfr: number; threeBet: number };
  /** a Horse opens in front of him on 40% of hands (a three-bet opportunity); else he is first in */
  const FACED = 0.4;
  function hand(rng: () => number, p: Profile): ExploitHandAction[] {
    const his = (a: 'raise' | 'call' | 'fold', amount: number): ExploitHandAction => ({
      userId: subject,
      stage: 'preflop',
      action: a,
      origin: 'player',
      amount: a === 'fold' ? 0 : amount,
      isFullRaise: a === 'raise' ? true : undefined,
    });
    if (rng() < FACED) {
      const u = rng();
      return [
        {
          userId: opener,
          stage: 'preflop',
          action: 'raise',
          origin: 'horse_policy',
          amount: 2,
          isFullRaise: true,
        },
        u < p.threeBet ? his('raise', 4) : u < p.vpip ? his('call', 2) : his('fold', 0),
      ];
    }
    const u = rng();
    return [
      u < p.pfr ? his('raise', 2) : u < p.vpip ? his('call', 1) : his('fold', 0),
      { userId: opener, stage: 'preflop', action: 'fold', origin: 'horse_policy', amount: 0 },
    ];
  }
  const PROFILES: Record<string, Profile> = {
    tight: { salt: 1, vpip: 0.1, pfr: 0.06, threeBet: 0.03 },
    horseLike: { salt: 2, vpip: 0.21, pfr: 0.11, threeBet: 0.05 },
    loose: { salt: 3, vpip: 0.3, pfr: 0.15, threeBet: 0.07 },
  };
  const SEEDS = 150;
  const HANDS = 60;
  type Tally = { on: number; off: number; onOnly: number; offOnly: number };
  const add = (t: Tally, on: boolean, off: boolean) => {
    t.on += on ? 1 : 0;
    t.off += off ? 1 : 0;
    t.onOnly += on && !off ? 1 : 0;
    t.offOnly += !on && off ? 1 : 0;
  };

  it('documents tight-reraiser respect by hand 40, ON against OFF, and holds the sample gates identical', () => {
    expect([STYLE_MIN_HANDS, STYLE_MIN_THREE_BET_OPPS]).toEqual([15, 8]);
    const scope = readScopeOf('flh', 6);
    const measured: Record<string, { at40: Tally; anyBy40: Tally; at60: Tally }> = {};
    for (const [name, p] of Object.entries(PROFILES)) {
      const m = {
        at40: { on: 0, off: 0, onOnly: 0, offOnly: 0 },
        anyBy40: { on: 0, off: 0, onOnly: 0, offOnly: 0 },
        at60: { on: 0, off: 0, onOnly: 0, offOnly: 0 },
      };
      for (let seed = 1; seed <= SEEDS; seed++) {
        const rng = rngOf(seed * 7919 + p.salt);
        const rows = new Map<string, ExploitCounters>();
        let everOn = false;
        let everOff = false;
        for (let n = 1; n <= HANDS; n++) {
          for (const [id, inc] of exploitHandIncrements(hand(rng, p), true))
            observeExploitRow(rows, id, inc, 1e9, true);
          const counters = rows.get(subject)!;
          const read = (on: boolean) =>
            inDecision(scope, 'flh', on, () =>
              classifyOpponentStyle({ scope, variant: 'flh', domain: 'cash', counters })
            );
          const on = read(true);
          const off = read(false);
          const label = `${name} seed ${seed} hand ${n}`;
          // the gates are the same in both arms
          expect(on.evidence.state, label).toBe(off.evidence.state);
          expect(on.signals.threeBet.n, label).toBe(off.signals.threeBet.n);
          const cOn = tightConsumers(on);
          const cOff = tightConsumers(off);
          if (!(counters.hands >= STYLE_MIN_HANDS)) {
            // too few hands: neither arm reads him, and no consumer fires in either
            expect(on.evidence.supported, label).toBe(false);
            expect(Object.values(cOn).some(Boolean), label).toBe(false);
            expect(Object.values(cOff).some(Boolean), label).toBe(false);
          }
          if (on.signals.threeBet.n < STYLE_MIN_THREE_BET_OPPS) {
            expect(on.signals.threeBet.side, label).toBeNull();
            expect(off.signals.threeBet.side, label).toBeNull();
          }
          if (n <= 40) {
            everOn ||= cOn.tightReRaiser;
            everOff ||= cOff.tightReRaiser;
          }
          if (n === 40) {
            add(m.at40, cOn.tightReRaiser, cOff.tightReRaiser);
            add(m.anyBy40, everOn, everOff);
          }
          if (n === 60) add(m.at60, cOn.tightReRaiser, cOff.tightReRaiser);
        }
      }
      measured[name] = m;
    }
    // Documented counts of 150 runs, not a bound. With ON the higher three-bet cell mean lets "three-bet credibly low"
    // fire on players OFF does not engage on (onOnly): on loose histories by hand 60 it is on in 24 runs against 4.
    expect(measured).toEqual(EARLY_SAMPLE_PIN);
  });
});

describe('(4) registered, release default OFF, owner Fixed-Limit', () => {
  // Off-only under the owner's preflop range hold until the owner lifts it by name in source; then Hand Analysis's
  // route (exact-head ACCEPT and the recorded evidence row).
  it('is a ledger flag and a registry entry, released OFF, off-only under the owner preflop range hold', () => {
    expect(
      HORSE_DATA_LEDGER.some((e) => e.kind === 'flag' && e.key === 'fixedLimitPopulationCells')
    ).toBe(true);
    const entry = OPTION_SWITCH_REGISTRY.find((e) => e.name === 'fixedLimitPopulationCells');
    expect(entry).toBeDefined();
    expect(entry!.releaseDefault).toBe('off');
    expect(entry!.owner).toBe('Fixed-Limit');
    expect(optionSwitchOffOnly('fixedLimitPopulationCells')).toEqual({
      status: 'hold',
      source: 'owner preflop range hold',
      reason: 'changes a preflop range: held until the owner lifts it by name',
    });
    expect(entry!.states).toEqual(['off']);
  });
});

describe('(5) flo8 is out of scope: inert with the option on', () => {
  it('every flo8 envelope is main envelope (same object), at every size, and names main version', () => {
    for (const size of SIZES) {
      const scope = readScopeOf('flo8', DEALT[size]);
      const on = inDecision(scope, 'flo8', true, () => exploitEnvelopeFor(scope, 'flo8'));
      expect(on, `flo8:${size}`).toBe(mainEnvelope(scope, 'flo8'));
      expect(on, `flo8:${size}`).toBe(
        inDecision(scope, 'flo8', false, () => exploitEnvelopeFor(scope, 'flo8'))
      );
      expect(inDecision(scope, 'flo8', true, () => exploitEnvelopeVersionFor(scope, 'flo8'))).toBe(
        OPPONENT_EXPLOIT_ENVELOPE_VERSION
      );
    }
    const full = readScopeOf('flo8', 6);
    expect(inDecision(full, 'flo8', true, () => exploitEnvelopeFor(full, 'flo8'))).toBe(
      OPPONENT_EXPLOIT_ENVELOPE['flo8:short']
    );
  });

  it('every flo8 census read is the read with the option off', () => {
    const fx = JSON.parse(
      readFileSync(
        resolve(process.cwd(), 'src/engine/fixtures/fixed-limit-population-census.json'),
        'utf8'
      )
    ) as { cells: Record<string, number[][]> };
    const fields = [...EXPLOIT_COUNTER_FIELDS, ...EXPLOIT_LONG_FIELDS] as string[];
    for (const size of SIZES) {
      const scope = readScopeOf('flo8', DEALT[size]);
      for (const r of fx.cells[`flo8:${size}`]!) {
        const counters = Object.fromEntries(
          fields.map((f, i) => [f, r[i]])
        ) as unknown as ExploitCounters;
        const read = (on: boolean) =>
          inDecision(scope, 'flo8', on, () =>
            classifyOpponentStyle({ scope, variant: 'flo8', domain: 'cash', counters })
          );
        expect(read(true), `flo8:${size}`).toEqual(read(false));
      }
    }
  });

  it('seeded flo8 decision streams are identical with the option on and off; the same comparison sees it at flh', () => {
    const on = { fixedLimitPopulationCells: true };
    for (const mode of ['cash', 'tournament'] as const) {
      const off = playNeutralityRun('flo8', mode, 200);
      expect(playNeutralityRun('flo8', mode, 200, undefined, on), `flo8 ${mode}`).toEqual(off);
    }
    expect(playNeutralityRun('flh', 'cash', 200, undefined, on).chain).not.toEqual(
      playNeutralityRun('flh', 'cash', 200).chain
    );
  }, 180_000);
});

describe('(6) cash only: a tournament flh decision never takes a population cell', () => {
  it('HorseLogic adds the option only at a cash table (isTournamentMode, the W5 test)', () => {
    const on = { fixedLimitPopulationCells: true, mind: false };
    // gameMode is trusted first: a cash table with a large blind still carries the option
    HorseLogic.prepareOriginalReads(
      SEAT_A,
      flhState({ gameMode: 'cash', bigBlind: 20 }) as never,
      on
    );
    expect(HorseMind.currentDecisionReadOptions().fixedLimitPopulationCells).toBe(true);
    HorseMind.setDecisionScope(null);
    for (const t of [
      { gameMode: 'tournament' },
      { gameMode: 'tournament', tournament: { schemaVersion: 1 } },
      { tournament: { schemaVersion: 1 } },
    ]) {
      const label = JSON.stringify(t);
      HorseLogic.prepareOriginalReads(SEAT_A, flhState(t) as never, on);
      expect('fixedLimitPopulationCells' in HorseMind.currentDecisionReadOptions(), label).toBe(
        false
      );
      const scope = HorseMind.currentScope()!;
      expect(scope, label).toBe(readScopeOf('flh', 6));
      expect(exploitEnvelopeFor(scope, 'flh'), label).toBe(mainEnvelope(scope, 'flh'));
      expect(exploitEnvelopeVersionFor(scope, 'flh'), label).toBe(
        OPPONENT_EXPLOIT_ENVELOPE_VERSION
      );
      HorseMind.setDecisionScope(null);
    }
  });

  it('a seeded flh tournament decision stream is identical with the option on and off', () => {
    const on = { fixedLimitPopulationCells: true };
    const off = playNeutralityRun('flh', 'tournament', 200);
    expect(playNeutralityRun('flh', 'tournament', 200, undefined, on)).toEqual(off);
  }, 180_000);
});

describe('(7) the frozen table is pinned by value', () => {
  it('every mean, lo and hi of all six cells equals the generator output, and nothing else is in the table', () => {
    expect([...EXPLOIT_STATS]).toEqual([
      'vpip',
      'pfr',
      'rfi',
      'threeBet',
      'foldTo3Bet',
      'betCheckedTo',
      'foldToBet',
      'riverCall',
    ]);
    const expected = Object.fromEntries(
      Object.entries(GENERATOR_OUTPUT).map(([cell, rows]) => [
        cell,
        Object.fromEntries(
          EXPLOIT_STATS.map((stat, i) => [
            stat,
            { mean: rows[i]![0], lo: rows[i]![1], hi: rows[i]![2] },
          ])
        ),
      ])
    );
    expect(Object.keys(FIXED_LIMIT_POPULATION_ENVELOPE).sort()).toEqual(
      ['flh:full', 'flh:hu', 'flh:short', 'flo8:full', 'flo8:hu', 'flo8:short'].sort()
    );
    expect(JSON.parse(JSON.stringify(FIXED_LIMIT_POPULATION_ENVELOPE))).toStrictEqual(expected);
    expect(FIXED_LIMIT_POPULATION_ENVELOPE_VERSION).toBe('fixed-limit-population-2026-11-16');
  });
});
