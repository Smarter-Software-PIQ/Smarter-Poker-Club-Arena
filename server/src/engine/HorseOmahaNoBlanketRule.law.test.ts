/**
 * LAW: NO BLANKET RULE DECIDES A PLO4/PLO5 CASH ACTION WHEN THE PRICED RULES
 * ARE ON (owner 2026-11-17 11:49 Chicago: "there should not be any blanket
 * rules ... a blanket rule shouldn't be allowed to effect a decision, they
 * must all be done by math, gto, players hand or preceived range of hands as
 * well as the opponents range of hand, equity, EV etc.").
 *
 * The register is HorseOmahaRuleSites.ts. This law fails the build when:
 *
 *  1. an Omaha decision option in the ledger is not classified there (a new
 *     rule must say whether it prices its decision), or a class is wrong:
 *     a 'categorical' option without a registered priced option that is
 *     default OFF, or the list of 'open' rules changed without this file;
 *  2. a registered categorical rule site no longer hands its decision to the
 *     priced rule (the guard text is gone from the source);
 *  3. with every priced option on, on a corpus of built spots and of real
 *     Horse decisions recorded from production, a registered categorical
 *     rule fires its receipt: it decided an action by a size, a chip count, a
 *     stack share, a hand category, a betting line or an opponent label;
 *  4. with the two facing-bet input options on, the bettor's range or the
 *     realization of a call moves by a step when the bet's share of the pot
 *     crosses a size line.
 *
 * With the options off the same corpus fires those categorical receipts: the
 * corpus reaches the rules, so (3) is not vacuous.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { HORSE_DATA_LEDGER } from './HorseDataLedger.js';
import { seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { omahaFacingBetEvSpot, omahaFacingBetEvVerdict } from './HorseOmahaFacingBetEv.js';
import { withOmahaPricedMode } from './HorseOmahaPricedMode.js';
import { OPTION_SWITCH_RELEASE_DEFAULT_OFF, OPTION_SWITCH_REGISTRY } from './HorseOptionSwitch.js';
import {
  OMAHA_CATEGORICAL_RULE_SITES,
  OMAHA_OPEN_RULE_SITES,
  OMAHA_OPTION_CLASSES,
  type OmahaCategoricalRuleSite,
} from './HorseOmahaRuleSites.js';
import {
  LIVE,
  LIVE_OPTIONS,
  PRICED_OPTIONS,
  allPriced,
  pricedSpot,
  recordedState,
  type PricedSpot,
  type RecordedDecision,
} from './HorseOmahaPricedRules.test-support.js';
import RECORDED from './HorseOmahaPricedRules.fixture.json';
import { allSitesPriced } from './HorseOmahaPricedSites.test-support.js';

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

const src = (file: string): string =>
  readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), 'utf8');
const matches = (receipt: string, pattern: string): boolean =>
  pattern.endsWith('*') ? receipt.startsWith(pattern.slice(0, -1)) : receipt === pattern;
const siteFired = (site: OmahaCategoricalRuleSite, fires: readonly string[]): string[] =>
  fires.filter((f) => site.legacyReceipts.some((p) => matches(f, p)));

/** The corpus: built heads-up spots across the rule sites, and the recorded real decisions. */
const BUILT: PricedSpot[] = [
  // turn and river facing a bet: non-nut made hands, the nuts, air (the raise sites and the big-bet cells)
  ...[
    'QcJd6c6d4h',
    '7c7d2s3s4c',
    'Qc7c2s3s4c',
    '8c6c2s3s4d',
    '5d3d2c8s4s',
    'KcTc2s3s4d',
    'AdKd2c8s4s',
  ].flatMap((hole) =>
    [1, 0.5, 0.33].map((f) => ({ hole, board: '9dQdJh7h', bet: Math.round(216 * f) }))
  ),
  ...['JcJs2s3s4c', 'QcJs5s3s4c', '8c6c2s3s4d', '5h3h2c8s4s', 'AhKh2c8s4s', '3d3c4c8s5s'].flatMap(
    (hole) => [1, 0.5].map((f) => ({ hole, board: '9dQdJh7h2h', bet: Math.round(216 * f) }))
  ),
  // paired river facing a pot bet: trips, a small full house, the flush
  ...['AcQd6c5d2h', '9c9s6c5d2h', 'AhKh6c5d2c'].map((hole) => ({ hole, board: '9dQsQh7h3h' })),
  // flop facing a bet with draws, in and out of position (the draw-raise bar)
  ...['AhKhJcTc2s', 'AhKh7c6c2s', 'JcTc8s7s2d', 'KhJh8c2c2s'].flatMap((hole) => [
    { hole, board: 'Qh9h3d' },
    { hole, board: 'Qh9h3d', inPosition: true },
  ]),
  // out of position on the turn after the flop bet was called (the barrel), with and without a hand
  ...['AcAd6c5d2h', 'QcQd6c5d2h', 'Ac5d6c4d2h', 'KhJh8c2c2s'].map((hole) => ({
    hole,
    board: '9dQs3h7h',
    bet: 0,
    heroBetFlop: true,
  })),
  // flop, nothing to call, a bare big pair with the betting lead (the bare-overpair check and its price), both positions;
  // the owner fixture txHiARhC (hand 59833576) and its KK / QQ forms among them (sites-013U37)
  ...['AdAhKdJd4h', 'KdKhAdJd4h', 'QdQhKdJd4h', 'AcAdKs4h2c', 'KcKdQs4h2c'].flatMap((hole) =>
    ['8s6c9s', '9h7s3d', 'Th4c2d'].flatMap((board) =>
      [false, true].map((inPosition) => ({ hole, board, bet: 0, inPosition }))
    )
  ),
  // river, nothing to call, a nut blocker with no showdown (the nut-blocker bluff), both positions (sites-013U37)
  ...[false, true].map((inPosition) => ({
    hole: 'AcAd6c5d2h',
    board: '9dQs3hJhKc',
    bet: 0,
    heroBetTurn: true,
    inPosition,
  })),
  // paired turn and river, nothing to call (the paired-board checks), both positions
  ...['AcQd6c5d2h', 'AcAd6c5d2h', 'AcKd6c5d2h'].flatMap((hole) => [
    { hole, board: '9dQsQh7h', bet: 0, heroBetFlop: true },
    { hole, board: '9dQsQh7h3c', bet: 0, heroBetTurn: true },
    { hole, board: '9dQsQh7h3c', bet: 0, inPosition: true },
  ]),
];
const RECORDS = RECORDED as unknown as RecordedDecision[];
const SEEDS = [1, 7];

interface Played {
  where: string;
  action: string;
  fires: string[];
}
/** A measured postflop value leader, as HorseOmahaReadConditional labels one (the paired-board rules need him). */
const stat = (mean: number, n: number) => ({ mean, n, engaged: null, excess: 0 });
const VALUE_LEADER = {
  hands: 400,
  measured: true,
  tightReRaiser: false,
  wideReRaiser: false,
  valueLeader: true,
  postflopAggressor: false,
  threeBet: stat(0.08, 200),
  betCheckedTo: stat(0.27, 300),
  foldToBet: stat(0.5, 120),
  riverCall: stat(0.2, 60),
};
const PAIRED = [
  ...BUILT.filter((s) => s.board.startsWith('9dQsQh') && s.bet === 0),
  // a fresh straight or flush card against a value leader, out of position (the made-hand defence bet half, sites-013U37)
  { hole: 'AcQd6c5d2h', board: '9dQs3h7h4h', bet: 0, heroBetTurn: true },
  { hole: 'JcTc8s7s2d', board: '9dQs3hJh', bet: 0, heroBetFlop: true },
];

/** Each priced family's receipt for a spot it could not price (the categorical rule then acts). */
const UNPRICED_KEPT: Readonly<Record<string, readonly string[]>> = {
  omahaTurnRiverRaiseIsPriced: ['omaha_priced_raise_unpriced_kept'],
  omahaDrawRaiseIsPriced: ['omaha_priced_draw_raise_unpriced_kept'],
  omahaOopTurnBarrelIsPriced: ['omaha_priced_oop_turn_barrel_unpriced_kept'],
  omahaPairedBoardBetIsPriced: ['omaha_priced_paired_board_bet_unpriced_kept'],
  omahaPressureIsPriced: ['omaha_priced_pressure_unpriced_kept'],
  omahaBigBetCallsArePriced: ['omaha_priced_big_bet_call_unpriced_kept'],
};
function play(opts: HorseDecideOpts, leader = false): Played[] {
  enableBrainTelemetry();
  const out: Played[] = [];
  if (leader) {
    // every opponent a labelled value leader: the paired-board spots only
    for (const seed of [1, 3, 7, 11, 42, 2026])
      PAIRED.forEach((s, i) => {
        HorseMind.reset();
        const st = pricedSpot(s);
        vi.spyOn(HorseMind, 'omahaReadConditionalOf').mockReturnValue(VALUE_LEADER as never);
        drainFires();
        seedFastRandom(seed);
        const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
          telemetry: true,
          observeMind: false,
          decisionTimeMs: 1794938400000,
          ...opts,
        } as never);
        vi.restoreAllMocks();
        out.push({
          where: `paired ${i} ${s.hole} ${s.board} against a value leader`,
          action: d.action,
          fires: drainFires().map((f) => f.feature),
        });
      });
    return out;
  }
  const one = (where: string, build: () => { hero: never; gs: never }, seed: number): void => {
    HorseMind.reset();
    const st = build();
    drainFires();
    seedFastRandom(seed);
    const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
      telemetry: true,
      observeMind: false,
      decisionTimeMs: 1794938400000,
      ...opts,
    } as never);
    out.push({ where, action: d.action, fires: drainFires().map((f) => f.feature) });
  };
  for (const seed of SEEDS) {
    BUILT.forEach((s, i) =>
      one(`built ${i} ${s.hole} ${s.board}`, () => pricedSpot(s) as never, seed)
    );
    for (const r of RECORDS)
      one(`hand ${r.n} seat ${r.seat} ${r.street}`, () => recordedState(r) as never, seed);
  }
  return out;
}

describe('the register (HorseOmahaRuleSites.ts)', () => {
  const ledgerOptions = HORSE_DATA_LEDGER.filter(
    (e) => e.kind === 'flag' && /^(omaha|plo[A-Z0-9])/.test(e.key)
  ).map((e) => e.key);
  it('classifies every Omaha decision option of the ledger, and nothing that is not one', () => {
    expect(ledgerOptions.length).toBeGreaterThan(60);
    const unclassified = ledgerOptions.filter((o) => !(o in OMAHA_OPTION_CLASSES));
    expect(
      unclassified,
      'Omaha options in the ledger with no class in OMAHA_OPTION_CLASSES. A new Omaha rule must be classed: ' +
        "'priced' when it compares priced lines, 'categorical' with the priced option that replaces it, 'open' " +
        "with the reason when it decides by a category and is not replaced, 'outside' when it is not a PLO4/PLO5 " +
        'cash postflop decision rule'
    ).toEqual([]);
    const stale = Object.keys(OMAHA_OPTION_CLASSES).filter((o) => !ledgerOptions.includes(o));
    expect(stale, 'classes for options the ledger does not hold').toEqual([]);
  });
  it('every categorical option names a registered priced option that is default OFF and has a rule site', () => {
    const registered = new Set(OPTION_SWITCH_REGISTRY.map((e) => e.name));
    for (const [option, ruling] of Object.entries(OMAHA_OPTION_CLASSES)) {
      if (ruling.cls !== 'categorical') continue;
      expect(OMAHA_OPTION_CLASSES[ruling.note]?.cls, `${option} -> ${ruling.note}`).toBe('priced');
      expect(registered.has(ruling.note), `${ruling.note} is registered in the live switch`).toBe(
        true
      );
      expect(OPTION_SWITCH_RELEASE_DEFAULT_OFF, `${ruling.note} is default off`).toContain(
        ruling.note
      );
      expect(
        OMAHA_CATEGORICAL_RULE_SITES.some(
          (s) => s.legacyOptions.includes(option) && s.pricedBy === ruling.note
        ),
        `${option} has a rule site handing it to ${ruling.note}`
      ).toBe(true);
    }
    for (const option of PRICED_OPTIONS) {
      expect(OMAHA_OPTION_CLASSES[option]?.cls).toBe('priced');
      expect(OPTION_SWITCH_RELEASE_DEFAULT_OFF).toContain(option);
    }
  });
  it('the categorical rules not yet replaced are exactly these (the list shrinks on purpose, never grows unseen)', () => {
    const openRules = Object.entries(OMAHA_OPTION_CLASSES)
      .filter(([, r]) => r.cls === 'open')
      .map(([o]) => o)
      .sort();
    expect(openRules).toEqual(
      [
        'omahaBigBetIsPotShare',
        // registered 2026-11-20 (EMERG ledger L43): the rule is from 2026-11-06 and was a hidden default-on read
        'omahaCurrentNutsRaise',
        'omahaNoRiverBluffIntoValueLeader',
        'omahaOnePairDiscipline',
        // reclassed 2026-11-21 (EMERG RULES-FIX-1, AUDIT-B item 5): fixed price and stack thresholds decide
        'omahaPairedBoardFoldRespectsPrice',
        'omahaReraisedPotFlopContinueNeedsEquityShape',
        // reclassed 2026-11-21 (EMERG BLANKET-AUDIT-3): a stack share and a fixed share of river cards decide
        'omahaTurnBetNeedsRiverPlan',
        'ploPairedBoardFold',
      ].sort()
    );
  });
  it('the parts of categorical rules that still decide with the options on are exactly these (they shrink on purpose)', () => {
    expect(OMAHA_OPEN_RULE_SITES.map((x) => `${x.audit}: ${x.legacyReceipts.join(' ')}`)).toEqual([
      '10: omaha_oop_turn_check_fold_no_outs omaha_oop_turn_check_call_nut_draw omaha_oop_turn_check_raise_flatted',
      'S1b (sites-013U37): omaha_bare_overpair_oop_flop_check_called omaha_bare_overpair_oop_flop_check_folded omaha_bare_overpair_oop_flop_check_raise_flatted omaha_bare_overpair_oop_flop_check_failsafe_flatted',
      'S6b (sites-013U37, review R3 B1): omaha_priced_site_blocker_bluff_gate_withheld',
      '14 (verifier D9, 2026-11-19): range_read_big_bet_counted v16_sizecond_bigbet',
    ]);
    for (const site of OMAHA_OPEN_RULE_SITES) {
      expect(site.why.length, `audit ${site.audit}: the reason is stated`).toBeGreaterThan(40);
      // an open part never shares a receipt with a replaced site: the law below still sees every replaced one
      for (const replaced of OMAHA_CATEGORICAL_RULE_SITES)
        expect(siteFired(replaced, [...site.legacyReceipts]), `audit ${site.audit}`).toEqual([]);
    }
  });
  it('every rule site still hands its decision to the priced rule', () => {
    for (const site of OMAHA_CATEGORICAL_RULE_SITES) {
      expect(
        src(site.file ?? 'HorseLogic.ts').includes(site.guard),
        `audit ${site.audit} (${site.rule}): the hand-off "${site.guard}" is in ${site.file ?? 'HorseLogic.ts'}`
      ).toBe(true);
      expect(OMAHA_OPTION_CLASSES[site.pricedBy]?.cls).toBe('priced');
    }
  });
});

describe('with every priced option on, no registered categorical rule decides', () => {
  const ON: HorseDecideOpts = { ...LIVE_OPTIONS, ...allPriced(true), ...allSitesPriced(true) };
  let off: Played[] = [];
  let on: Played[] = [];
  it('the corpus reaches the categorical rules with the options off', () => {
    off = [...play(LIVE_OPTIONS), ...play(LIVE_OPTIONS, true)];
    const reached = OMAHA_CATEGORICAL_RULE_SITES.filter((site) =>
      off.some((p) => siteFired(site, p.fires).length > 0)
    ).map((s) => s.audit);
    // eslint-disable-next-line no-console
    console.log(
      `[law] decisions ${off.length}; categorical sites reached with the options off: ${reached.join(' | ')}`
    );
    expect(off.some((p) => p.fires.some((f) => f.startsWith('omaha_priced_')))).toBe(false);
    for (const audit of [
      '7',
      '10',
      '11',
      '3, 4, 5, 6',
      'S1 (sites-013U37)',
      'S3 (sites-013U37)',
      'S5 (sites-013U37)',
      'S6 (sites-013U37)',
    ])
      expect(reached).toContain(audit);
  }, 600000);
  /** Categorical receipts that decided (violations) or that fired beside an _unpriced_kept receipt (fellClosed). */
  function categoricalDecided(decisions: Played[]): { violations: string[]; fellClosed: string[] } {
    const violations: string[] = [];
    const fellClosed: string[] = [];
    for (const p of decisions)
      for (const site of OMAHA_CATEGORICAL_RULE_SITES) {
        const fired = siteFired(site, p.fires);
        if (fired.length === 0) continue;
        if (site.sharedWith && p.fires.some((f) => site.sharedWith!.includes(f))) continue;
        const unpriced = UNPRICED_KEPT[site.pricedBy] ?? [];
        if (unpriced.some((u) => p.fires.includes(u))) {
          fellClosed.push(`${p.where}: audit ${site.audit}`);
          continue;
        }
        violations.push(`${p.where}: audit ${site.audit} (${site.rule}) fired ${fired.join(', ')}`);
      }
    return { violations, fellClosed };
  }
  it('with omahaPricedPriorsByOpponentKind on as well, none fires and no unpriceable spot falls closed (ROWFIX 2026-11-18)', () => {
    const withPriors: HorseDecideOpts = { ...ON, omahaPricedPriorsByOpponentKind: true };
    const played = [...play(withPriors), ...play(withPriors, true)];
    const { violations, fellClosed } = categoricalDecided(played);
    // eslint-disable-next-line no-console
    console.log(`[law] priors on: decisions ${played.length}; fell closed ${fellClosed.length}`);
    expect(
      fellClosed,
      'the priors option handed an unpriceable spot to a categorical rule'
    ).toEqual([]);
    expect(violations, 'a categorical rule decided with the priors option on').toEqual([]);
  }, 600000);
  it('with the options on none of them fires: every changed action carries a priced receipt', () => {
    on = [...play(ON), ...play(ON, true)];
    const violations: string[] = [];
    const fellClosed: string[] = [];
    for (const p of on)
      for (const site of OMAHA_CATEGORICAL_RULE_SITES) {
        const fired = siteFired(site, p.fires);
        if (fired.length === 0) continue;
        if (site.sharedWith && p.fires.some((f) => site.sharedWith!.includes(f))) continue;
        // A spot its priced comparison could not price falls CLOSED: the categorical rule acts as with
        // the option off, only beside that family's own `_unpriced_kept` receipt (review N4 of
        // REVIEW-9f803db63df-013U37.md). Without that receipt it is a violation.
        const unpriced = UNPRICED_KEPT[site.pricedBy] ?? [];
        if (unpriced.some((u) => p.fires.includes(u))) {
          fellClosed.push(`${p.where}: audit ${site.audit}`);
          continue;
        }
        violations.push(`${p.where}: audit ${site.audit} (${site.rule}) fired ${fired.join(', ')}`);
      }
    console.log(
      `[law] unpriceable spots that fell closed: ${fellClosed.length} ${fellClosed.join(' | ')}`
    );
    // ROWFIX 2026-11-18: no priced family falls closed any more (omahaPricedPriorsByOpponentKind no longer
    // hands an unpriceable spot to the categorical rule), so a categorical receipt beside an _unpriced_kept
    // one is a violation too.
    expect(fellClosed, 'an unpriceable spot fell closed to a categorical rule').toEqual([]);
    expect(
      violations,
      'a categorical rule decided a PLO4/PLO5 cash action with its priced option on'
    ).toEqual([]);
    const pricedFired = new Set(
      on.flatMap((p) => p.fires.filter((f) => f.startsWith('omaha_priced_')))
    );
    // eslint-disable-next-line no-console
    console.log(
      `[law] priced receipts fired with the options on: ${[...pricedFired].sort().join(' ')}`
    );
    for (const family of [
      'omaha_priced_raise_',
      'omaha_priced_oop_turn_barrel_',
      'omaha_priced_paired_board_bet_',
      'omaha_priced_big_bet_',
      'omaha_priced_site_flop_bet_',
      'omaha_priced_site_made_hand_bet_',
      'omaha_priced_site_turn_set_size_',
      'omaha_priced_site_blocker_bluff_',
    ])
      expect(
        [...pricedFired].some((f) => f.startsWith(family)),
        family
      ).toBe(true);
    expect(on.some((p) => p.fires.includes('omaha_strategy_rule_failed'))).toBe(false);
  }, 600000);
});

describe('with the facing-bet input options on, no size line moves the range or the realization by a step', () => {
  const HANDS: PricedSpot[] = [
    { hole: 'QcJd6c6d4h', board: '9dQdJh7h' },
    { hole: 'AcQd6c5d2h', board: '9dQsQh7h' },
    { hole: 'JcJs2s3s4c', board: '9dQdJh7h2h' },
    { hole: 'AcQd6c5d2h', board: '9dQsQh7h3c', heroBetTurn: true },
  ];
  const sweep = (s: PricedSpot, continuous: boolean) => {
    const rows: Array<{
      potFrac: number;
      valueShare: number;
      priorBluff: number;
      realization: number;
    }> = [];
    for (let bet = 12; bet <= 300; bet += 1) {
      const st = pricedSpot({ ...s, bet });
      withOmahaPricedMode(
        { rangeContinuous: continuous, bluffShareFromBetRate: continuous },
        () => {
          const spot = omahaFacingBetEvSpot(st.hero, st.gs);
          if (!spot) return;
          const v = omahaFacingBetEvVerdict(
            spot,
            st.hero.cards,
            st.gs.communityCards ?? [],
            [],
            null,
            {
              realization: 0.9,
            }
          );
          if (!v) return;
          rows.push({
            potFrac: spot.potFrac,
            valueShare: spot.valueShare,
            priorBluff: spot.priorBluff,
            realization: v.realization,
          });
        }
      );
    }
    return rows;
  };
  const worstStep = (
    rows: ReturnType<typeof sweep>,
    key: 'valueShare' | 'priorBluff' | 'realization'
  ) => {
    let worst = 0;
    for (let i = 1; i < rows.length; i++)
      worst = Math.max(worst, Math.abs(rows[i][key] - rows[i - 1][key]));
    return worst;
  };
  for (const s of HANDS)
    it(`${s.hole} on ${s.board}: one chip more never moves the value share, the bluff prior or the realization by a step`, () => {
      const stepped = sweep(s, false);
      const continuous = sweep(s, true);
      expect(continuous.length).toBeGreaterThan(250);
      // the stepped tables jump by 0.04 or more of the holdings when a size line is crossed
      expect(worstStep(stepped, 'valueShare')).toBeGreaterThan(0.04);
      // one chip is under half a percent of the pot: the continuous inputs move by under a point
      expect(worstStep(continuous, 'valueShare')).toBeLessThan(0.01);
      expect(worstStep(continuous, 'priorBluff')).toBeLessThan(0.01);
      expect(worstStep(continuous, 'realization')).toBeLessThan(0.02);
    });
});
