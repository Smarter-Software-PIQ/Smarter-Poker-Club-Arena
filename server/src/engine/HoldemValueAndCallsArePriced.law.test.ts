/**
 * LAW: HOLD'EM VALUE AND CALLS ARE PRICED (option holdemValueAndCallsArePriced, default OFF).
 *
 * Auditor D (hvh48-audit-01TLQer7J, NLH cash against people, 2026-11-18/19) found value raises left to a random
 * draw, strong made hands checked by the V11 initiative gate and the slowplay mix, facing-bet calls priced
 * against a preflop band, and river thin and block bets made with no comparison against the check. With the
 * option on, heads-up postflop decisions in no-limit hold'em cash are priced against the bettor's line range
 * (HorseHoldemValueAndCallsArePriced.ts; docs/horse-option-authority.d/holdemValueAndCallsArePriced.md).
 *
 * The fixtures are the audit's flagged decisions rebuilt from the public node, the public line and the
 * deciding Horse's own two cards (ids replaced by p<seat>), replayed with the production option set of
 * 2026-11-19 and the live cash profile.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import FIXTURES from './HoldemValueAndCallsArePriced.fixture.json';
import {
  replayAt,
  replayProfiles,
  stateAt,
  type ActionKind,
  type ExtractedHand,
} from './HorseComplaintReplay.js';
import { restoreFastRandom, saveFastRandom, seedFastRandom } from './HorseEval.js';
import {
  HOLDEM_PRICED_FOLD_CAP,
  holdemEquityOfShare,
  holdemFillEquities,
  holdemHandIsMade,
  holdemLineBucket,
  holdemLineRange,
  holdemPricedFold,
  holdemPricedSeed,
  holdemPricedVerdict,
  holdemPricedWagerTargets,
  type HoldemPricedRange,
  type HoldemPricedSpot,
} from './HorseHoldemValueAndCallsArePriced.js';
import type { Card } from '../types.js';

/** The options switched on in production on 2026-11-19 that touch no-limit hold'em cash (option_switch rows). */
const LIVE: Record<string, boolean> = Object.fromEntries(
  [
    'holdemCallDownExcludesCurrentHand',
    'holdemCallDownNeedsStyleEvidence',
    'holdemGearShiftReach',
    'holdemManiacSampleGate',
    'holdemManiacShortHandedReach',
    'holdemPersonaPostflop',
    'holdemProfileCompletenessCap',
    'holdemRiverFullHouseValue',
    'horseActionTimeIsPublicOnly',
    'styleBigBetHonesty',
    'styleFoldBluff',
    'styleFoldRatePreRepair',
    'styleLongShownMemory',
    'styleRaiseRespect',
    'styleTightMultiSignal',
    'styleTightPlayerExploit',
    'styleTightReRaiserRespect',
    'styleValueBettorNotManiac',
    'styleValueExtraction',
    'vpipFloorLimpOnly',
  ].map((o) => [o, true])
);
const ON = { ...LIVE, holdemValueAndCallsArePriced: true };
const SEEDS = Array.from({ length: 12 }, (_, i) => i + 1);
const PROFILE = replayProfiles('cash')[0];

interface Fixture {
  slug: string;
  cls: string;
  audit: { hand: string; best: string; lossBb: number; recorded: string };
  hand: ExtractedHand;
}
const ALL = (FIXTURES as unknown as { fixtures: Fixture[] }).fixtures;
const bySlug = (slug: string): Fixture => {
  const f = ALL.find((x) => x.slug === slug);
  if (!f) throw new Error(`no fixture ${slug}`);
  return f;
};
const state = (f: Fixture) => stateAt(f.hand, f.hand.actions[f.hand.actions.length - 1]);
const run = (f: Fixture, opts: Record<string, unknown>, profile = PROFILE) =>
  replayAt(state(f), profile, SEEDS, opts);
/** The audit's action as a replay kind: a bet or raise is `raise` (an all-in raise is `jam`). */
const kindsOf = (best: string): ActionKind[] =>
  best.startsWith('raise') || best.startsWith('bet') ? ['raise', 'jam'] : [best as ActionKind];
const recordedKind = (r: string): ActionKind[] =>
  r === 'bet' || r === 'raise' ? ['raise', 'jam'] : [r as ActionKind];
const count = (kinds: Partial<Record<ActionKind, number>>, want: ActionKind[]) =>
  want.reduce((s, k) => s + (kinds[k] ?? 0), 0);

/** The audit and this pricing agree, and the off line reproduces the flagged action on these seeds. */
const GREEN = [
  'turn-77-boat-calls',
  'flop-jj-topset-calls',
  'river-js3-trips-calls',
  'turn-qq-overpair-calls',
  'turn-77-boat-checks',
  'flop-jj-set-checks',
  'turn-js3-trips-checks-back',
  'turn-nut-flush-checks',
  'river-a9-two-pair-checks',
  'turn-q9-straight-checks',
  'river-jq-folds',
  'turn-at-folds-top-pair',
  'river-tt-hero-call',
  'river-a7-dead-call',
  'river-tt-thin-bet',
  'river-ak-thin-bet',
  'river-q9-blocker-bet',
];
/** The audit and this pricing agree; the off line does not take the flagged action on these seeds. */
const AGREE_NOT_REPRODUCED = ['river-a4-thin-bet', 'river-q9-two-pair-underbet'];
/** The pricing disagrees with the audit's model (authority file, "Disagreements"): pinned at the priced action. */
const DISAGREE: Record<string, ActionKind> = {
  'river-a7-two-pair-calls': 'call',
  'turn-kq-top-pair-calls': 'call',
  'river-66-boat-calls': 'call',
  'river-kq-checks-back': 'check',
  'turn-a8-dead-call': 'call',
  'turn-66-dead-call': 'call',
};
const MULTIWAY = ['river-q8-multiway-fold', 'river-q9-threeway-call'];
const VALUE_RAISES = ['turn-77-boat-calls', 'flop-jj-topset-calls', 'river-js3-trips-calls'];

describe('holdemValueAndCallsArePriced: the fixtures cover every flagged class', () => {
  it('every fixture is in exactly one group', () => {
    const groups = [...GREEN, ...AGREE_NOT_REPRODUCED, ...Object.keys(DISAGREE), ...MULTIWAY];
    expect(new Set(groups).size).toBe(groups.length);
    expect([...groups].sort()).toEqual(ALL.map((f) => f.slug).sort());
    for (const cls of ['value_raise', 'value_bet', 'price_call', 'price_fold', 'river_thin'])
      expect(GREEN.some((s) => bySlug(s).cls === cls) || cls === 'price_fold', cls).toBe(true);
  });
});

describe('holdemValueAndCallsArePriced off: byte-identical', () => {
  it('unset, false and a truthy non-boolean replay identically on every fixture', () => {
    for (const f of ALL) {
      const unset = run(f, LIVE);
      expect(run(f, { ...LIVE, holdemValueAndCallsArePriced: false }), f.slug).toEqual(unset);
      expect(run(f, { ...LIVE, holdemValueAndCallsArePriced: 'yes' }), f.slug).toEqual(unset);
      expect(Object.keys(unset.receipts).filter((k) => k.startsWith('holdem_priced_'))).toEqual([]);
    }
  });
  it('and for every base profile on a value raise, a check and a call', () => {
    for (const slug of ['turn-77-boat-calls', 'turn-77-boat-checks', 'river-tt-hero-call'])
      for (const p of replayProfiles('cash').slice(1)) {
        const f = bySlug(slug);
        expect(run(f, { holdemValueAndCallsArePriced: false }, p), `${slug} ${p.name}`).toEqual(
          run(f, {}, p)
        );
      }
  });
});

describe('holdemValueAndCallsArePriced: red off, green on', () => {
  it.each(GREEN)('%s', (slug) => {
    const f = bySlug(slug);
    const off = run(f, LIVE);
    const on = run(f, ON);
    // red: the flagged action is taken on at least one seed with the option off
    expect(
      count(off.kinds, recordedKind(f.audit.recorded)),
      `${slug} off ${JSON.stringify(off.kinds)}`
    ).toBeGreaterThan(0);
    // green: the audit's action class on every seed with it on, priced
    expect(count(on.kinds, kindsOf(f.audit.best)), `${slug} on ${JSON.stringify(on.kinds)}`).toBe(
      SEEDS.length
    );
    const priced = Object.entries(on.receipts)
      .filter(([k]) => /^holdem_priced_(raise|call|fold|bet|check)$/.test(k))
      .reduce((s, [, v]) => s + v, 0);
    expect(priced).toBe(SEEDS.length);
  });
  it.each(AGREE_NOT_REPRODUCED)('%s takes the audit action on every seed', (slug) => {
    const f = bySlug(slug);
    expect(count(run(f, ON).kinds, kindsOf(f.audit.best))).toBe(SEEDS.length);
  });
  it.each(Object.entries(DISAGREE))('%s (a stated disagreement) is pinned at %s', (slug, kind) => {
    const on = run(bySlug(slug), ON);
    expect(on.kinds).toEqual({ [kind]: SEEDS.length });
  });
});

describe('holdemValueAndCallsArePriced: scope', () => {
  it('more than one live opponent keeps the decision', () => {
    for (const slug of MULTIWAY) {
      const f = bySlug(slug);
      const off = run(f, LIVE);
      const on = run(f, ON);
      expect(on.kinds).toEqual(off.kinds);
      expect(on.actions).toEqual(off.actions);
      expect(on.sizesBb).toEqual(off.sizesBb);
      expect(on.receipts.holdem_priced_unpriced_multiway).toBe(SEEDS.length);
    }
  });
  it('a tournament is out of scope; a Lightning pool is in', () => {
    const f = bySlug('turn-77-boat-checks');
    const t = state(f);
    const tour = { ...t, gs: { ...t.gs, gameMode: 'tournament' } as typeof t.gs };
    const offT = replayAt(tour, PROFILE, SEEDS, LIVE);
    const onT = replayAt(tour, PROFILE, SEEDS, ON);
    expect(onT).toEqual(offT);
    const light = {
      ...t,
      gs: { ...t.gs, publicMemoryDomain: { speed: 'lightning' } } as unknown as typeof t.gs,
    };
    const onL = replayAt(light, PROFILE, SEEDS, ON);
    expect(onL.receipts.holdem_priced_bet).toBe(SEEDS.length);
  });
  it("production's single-board state (communityCards2: []) is in scope; a dealt second board is out", () => {
    // Production and the league hand the brain communityCards2 = [] on every single-board table
    // (ServerTableEngineTurns, LightningHorse, LeagueDecisionState). Testing `!== undefined` read
    // that as a second board, so the option never acted live (league card inert: 0 receipts in 600 hands).
    const f = bySlug('turn-77-boat-checks');
    const t = state(f);
    const single = { ...t, gs: { ...t.gs, communityCards2: [] } as unknown as typeof t.gs };
    const onS = replayAt(single, PROFILE, SEEDS, ON);
    expect(onS.receipts.holdem_priced_bet).toBe(SEEDS.length);
    const dealt = {
      ...t,
      gs: { ...t.gs, communityCards2: t.gs.communityCards.slice(0, 3) } as unknown as typeof t.gs,
    };
    expect(replayAt(dealt, PROFILE, SEEDS, ON)).toEqual(replayAt(dealt, PROFILE, SEEDS, LIVE));
  });
});

describe('holdemValueAndCallsArePriced: no value-raise decision reads fastRandom', () => {
  it('the deferral returns before the random value-raise gate in decidePostflop', () => {
    const src = readFileSync(join(process.cwd(), 'src/engine/HorseLogic.ts'), 'utf8');
    const deferral = src.indexOf("noteFire('holdem_priced_value_raise_deferred')");
    const gate = src.indexOf('0.55 * params.aggression + params.checkRaiseFreq + oopBoost');
    expect(deferral).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(deferral);
    // nothing between them draws a random number
    expect(src.slice(deferral, src.indexOf('const originalValueRaise', deferral))).not.toMatch(
      /fastRandom\(/
    );
  });
  it('the pricing module never imports or calls fastRandom', () => {
    const mod = readFileSync(
      join(process.cwd(), 'src/engine/HorseHoldemValueAndCallsArePriced.ts'),
      'utf8'
    );
    expect(mod).not.toMatch(/import[^;]*fastRandom/);
    expect(mod.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')).not.toMatch(/fastRandom/);
  });
  it('pricing a spot leaves the fastRandom stream exactly where it was', () => {
    const f = bySlug('turn-77-boat-calls');
    const { hero, gs } = state(f);
    seedFastRandom(4242);
    const before = saveFastRandom();
    const range = holdemLineRange(hero.cards, gs.communityCards, [0.62, 1], []);
    holdemFillEquities(range, hero.cards, gs.communityCards, 7);
    holdemPricedVerdict(spotOf({ pot: 83.5, currentBet: 24, villainIn: 24 }), range, [77, 104]);
    expect(saveFastRandom()).toBe(before);
    restoreFastRandom(before);
  });
  it.each(VALUE_RAISES)('%s: the same decision on every seed, the gate deferred', (slug) => {
    const on = run(bySlug(slug), ON);
    expect(Object.keys(on.kinds)).toHaveLength(1);
    expect(new Set(on.sizesBb).size).toBeLessThanOrEqual(1);
    expect(on.receipts.holdem_priced_value_raise_deferred).toBe(SEEDS.length);
  });
});

// ─── the closed forms ───────────────────────────────────────────────────────
const SUIT = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' } as const;
const cards = (t: string): Card[] =>
  (t.match(/.{2}/g) ?? []).map((x) => ({
    rank: x[0] as Card['rank'],
    suit: SUIT[x[1] as keyof typeof SUIT],
  }));
function spotOf(over: Partial<HoldemPricedSpot>): HoldemPricedSpot {
  return {
    street: 'river',
    pot: 100,
    currentBet: 0,
    heroIn: 0,
    villainIn: 0,
    heroStack: 1000,
    villainStack: 1000,
    inPosition: true,
    villainToAct: false,
    foldAtReference: 0.4,
    betWhenCheckedTo: 0.3,
    bluffShare: 0.25,
    heroMade: true,
    ...over,
  };
}
/** A synthetic range of n combinations with given equities and buckets (strongest first). */
function synthetic(eqs: number[], buckets: number[]): HoldemPricedRange {
  const n = eqs.length;
  const weak = buckets.filter((b) => b <= 1).length / n;
  return {
    combos: eqs.map(() => []),
    weight: eqs.map(() => 1),
    bucket: buckets as never,
    strength: eqs.map((_, i) => n - i),
    equity: eqs,
    order: eqs.map((_, i) => i),
    total: n,
    weakShare: weak,
  };
}

describe('holdemValueAndCallsArePriced: the values', () => {
  it('the call is R eq (pot + c) - c; the fold is 0', () => {
    const r = synthetic([0, 0, 1, 1], [4, 4, 0, 0]);
    const v = holdemPricedVerdict(spotOf({ pot: 150, currentBet: 50, villainIn: 50 }), r, []);
    const call = v.options.find((o) => o.kind === 'call');
    expect(call?.ev).toBeCloseTo(0.5 * (150 + 50) - 50, 9);
    expect(v.options.find((o) => o.kind === 'fold')?.ev).toBe(0);
    expect(v.best.kind).toBe('call');
  });
  it('his fold rises with the price, is capped, and never exceeds the weak part of his range', () => {
    expect(holdemPricedFold(0.4, 33.7, 66.3)).toBeCloseTo(0.4, 6);
    expect(holdemPricedFold(0.4, 100, 100)).toBeGreaterThan(holdemPricedFold(0.4, 50, 100));
    expect(holdemPricedFold(1, 1e6, 1)).toBe(HOLDEM_PRICED_FOLD_CAP);
    // a range of strong hands only folds nothing to a bet: the bet is priced against all of it
    const strong = synthetic([0.9, 0.9, 0.9, 0.9], [4, 4, 3, 3]);
    const bet = holdemPricedVerdict(spotOf({}), strong, [100]).options.find(
      (o) => o.kind === 'bet'
    );
    expect(bet?.fold).toBe(0);
    expect(bet?.ev).toBeCloseTo(0.9 * 300 - 100, 9);
  });
  it('a raise is priced only as a value raise (ahead of the part that continues)', () => {
    // the strong half beats the Horse; the weak half is air: any raise is called only by better
    const r = synthetic([0, 0, 1, 1], [4, 4, 0, 0]);
    const v = holdemPricedVerdict(spotOf({ pot: 150, currentBet: 50, villainIn: 50 }), r, [200]);
    expect(v.options.some((o) => o.kind === 'raise')).toBe(false);
    // a draw (no made hand) prices fold and call only
    const nuts = synthetic([1, 1, 1, 1], [4, 3, 1, 0]);
    const d = holdemPricedVerdict(
      spotOf({ pot: 150, currentBet: 50, villainIn: 50, heroMade: false }),
      nuts,
      [200]
    );
    expect(d.options.map((o) => o.kind)).toEqual(['fold', 'call']);
    const m = holdemPricedVerdict(spotOf({ pot: 150, currentBet: 50, villainIn: 50 }), nuts, [200]);
    expect(m.best.kind).toBe('raise');
  });
  it('a tie keeps the passive option', () => {
    const r = synthetic([0.5], [3]);
    const v = holdemPricedVerdict(spotOf({ pot: 100 }), r, []);
    expect(v.best.kind).toBe('check');
  });
  it('the check out of position carries his bet and the Horse’s answer', () => {
    const nuts = synthetic([1, 1, 1, 1], [4, 3, 1, 0]);
    const v = holdemPricedVerdict(
      spotOf({ villainToAct: true, inPosition: false, betWhenCheckedTo: 1, bluffShare: 0 }),
      nuts,
      []
    );
    // he always bets; the Horse at least calls: the check is worth more than the pot
    expect(v.options[0].kind).toBe('check');
    expect(v.options[0].ev).toBeGreaterThan(100);
  });
  it('the wager targets are the fractions and, within 1.5 pots, all in', () => {
    expect(holdemPricedWagerTargets(spotOf({ pot: 100, heroStack: 120 }))).toEqual([
      33, 50, 75, 100, 120,
    ]);
    expect(
      holdemPricedWagerTargets(spotOf({ pot: 100, currentBet: 50, villainIn: 50, heroStack: 900 }))
    ).toEqual([125, 162.5, 200]);
  });
  it('the buckets, the made test and the seed', () => {
    expect(holdemLineBucket(cards('7s7d'), cards('2h4s4d7h'))).toBe(4);
    expect(holdemLineBucket(cards('AhKd'), cards('Ks7d2c'))).toBe(3);
    expect(holdemLineBucket(cards('Ah5h'), cards('Kh7h2c'))).toBe(2);
    expect(holdemLineBucket(cards('7c6c'), cards('Kh7h2d'))).toBe(1);
    expect(holdemLineBucket(cards('AhQh'), cards('Kh7h2d3c9s'))).toBe(0);
    expect(holdemHandIsMade(cards('7s7d'), cards('2h4s4d7h'))).toBe(true);
    expect(holdemHandIsMade(cards('AhKd'), cards('2h4s4d7h'))).toBe(false);
    expect(holdemPricedSeed(cards('7s7d'), cards('2h4s'), 10)).toBe(
      holdemPricedSeed(cards('7s7d'), cards('2h4s'), 10)
    );
    const r = holdemLineRange(cards('7s7d'), cards('2h4s4d7h'), null, []);
    expect(r.total).toBe((46 * 45) / 2);
    holdemFillEquities(r, cards('7s7d'), cards('2h4s4d7h'), 1);
    expect(holdemEquityOfShare(r, 1).equity).toBeGreaterThan(0.95);
  });
});

describe('holdemValueAndCallsArePriced: line-range construction invariants (2026-11-21)', () => {
  it('draws bluffs proportionally across Air rather than worst-kicker-first, so high-card Air does not beat 100% of bluffs', () => {
    const board = cards('Ks9d7c4h2s');
    const heroAir = cards('QhJc');
    const heroPair = cards('6h6c');
    const step = [{ board, keep: { top: 0.2, bottom: 0.1 } }];

    const rAir = holdemLineRange(heroAir, board, [0.3, 1], step);
    holdemFillEquities(rAir, heroAir, board, 1);
    let airBluffW = 0;
    let airBluffEq = 0;
    for (const i of rAir.order) {
      if (rAir.bucket[i] === 0) {
        airBluffW += rAir.weight[i];
        airBluffEq += rAir.weight[i] * rAir.equity[i];
      }
    }
    // Against proportional Air bluffs (containing Ax/Qx/Jx missed combos), QJ high card is well below 90% vs Air.
    expect(airBluffW).toBeGreaterThan(0);
    expect(airBluffEq / airBluffW).toBeLessThan(0.8);

    // Meanwhile a real made pair (66) still beats 100% of villain's Air bluffs.
    const rPair = holdemLineRange(heroPair, board, [0.3, 1], step);
    holdemFillEquities(rPair, heroPair, board, 1);
    let pairBluffW = 0;
    let pairBluffEq = 0;
    for (const i of rPair.order) {
      if (rPair.bucket[i] === 0) {
        pairBluffW += rPair.weight[i];
        pairBluffEq += rPair.weight[i] * rPair.equity[i];
      }
    }
    expect(pairBluffW).toBeGreaterThan(0);
    expect(pairBluffEq / pairBluffW).toBeCloseTo(1, 9);
  });

  it('recovers initial dead money from voluntary-only history (#11556) identically to forced-post history', () => {
    const f = bySlug('river-a7-dead-call');
    const st = state(f);
    // Strip any forced blind posts (already absent post-#11556) and compare with a synthetic blind post added:
    // both carry the same gs.pot, so initialPot = gs.pot - totalHistoryAdded yields the exact same decision.
    const base = replayAt(st, PROFILE, SEEDS, ON);
    expect(base.kinds).toEqual({ fold: SEEDS.length });
    const withBlind = {
      ...st,
      gs: {
        ...st.gs,
        actionHistory: [
          {
            seat: st.gs.players[0].seat,
            userId: st.gs.players[0].user_id,
            action: 'blind',
            amount: st.gs.bigBlind,
            stage: 'preflop',
            timestamp: 1,
          },
          ...(st.gs.actionHistory ?? []),
        ],
      },
    };
    const res = replayAt(withBlind as typeof st, PROFILE, SEEDS, ON);
    expect(res.kinds).toEqual(base.kinds);
  });

  it('does not turn a < 50% equity river made hand into an auto-profit bluff when foldAtReference > reference price', () => {
    // 10% overall equity (0% when called against top half), weakShare = 0.5, foldAtReference = 0.43 > 0.337:
    // without the river value-bet guard, f = 0.43 * (price / 0.337) > price makes every bet size auto-profit.
    const r = synthetic([0, 0, 0, 0, 0, 0, 0, 0, 0, 1], [4, 4, 3, 3, 3, 1, 1, 0, 0, 0]);
    const v = holdemPricedVerdict(
      spotOf({ street: 'river', pot: 100, foldAtReference: 0.43, villainToAct: false }),
      r,
      [33, 50, 75, 100]
    );
    expect(v.options.map((o) => o.kind)).toEqual(['check']);
    expect(v.best.kind).toBe('check');
  });

  it('prices fold equity against matched stack (not unmatched surplus) and caps wager targets at villain effective stack', () => {
    // Covering hero (stack 102.3) facing bet 41 from short villain (27 behind, effAllIn = 68).
    const facingSpot = spotOf({
      street: 'turn',
      pot: 147.5,
      currentBet: 41,
      heroIn: 0,
      villainIn: 41,
      heroStack: 102.3,
      villainStack: 27,
      foldAtReference: 0.43,
    });
    const raiseTargets = holdemPricedWagerTargets(facingSpot);
    expect(raiseTargets).toEqual([68]);
    expect(raiseTargets.every((t) => t <= facingSpot.villainIn + facingSpot.villainStack)).toBe(
      true
    );

    // Even if both min-raise (82) and unmatched shove (102.3) are supplied as legal wagers, both have
    // identical matched exposure (68), so they must produce identical fold share and EV, and ascending
    // tie-breaking keeps the smaller legal raise (82) instead of shoving surplus chips.
    const r = synthetic([0.7, 0.8, 0.9, 1, 1], [4, 3, 1, 0, 0]);
    const v = holdemPricedVerdict(facingSpot, r, [82, 102.3]);
    const r82 = v.options.find((o) => o.kind === 'raise' && o.to === 82);
    const rAll = v.options.find((o) => o.kind === 'raise' && o.to === 102.3);
    expect(r82).toBeDefined();
    expect(rAll).toBeDefined();
    expect(r82?.fold).toBeCloseTo(holdemPricedFold(0.43, 68, 147.5), 9);
    expect(rAll?.fold).toBeCloseTo(r82!.fold!, 9);
    expect(rAll?.ev).toBeCloseTo(r82!.ev, 9);
    expect(v.best.to).toBe(82);

    // First-in bet targets also never exceed villain's effective stack.
    const openTargets = holdemPricedWagerTargets(
      spotOf({ street: 'river', pot: 100, heroStack: 150, villainStack: 80 })
    );
    expect(openTargets).toEqual([33, 50, 75, 80]);
  });

  it('never defers value raises or rewrites non-fold tokens when the sole opponent is already all-in (opp.stack <= 0)', () => {
    const f = bySlug('turn-77-boat-calls');
    const st = state(f);
    const allInOppState = {
      ...st,
      gs: {
        ...st.gs,
        players: st.gs.players.map((p) =>
          p.seat === st.hero.seat || p.is_folded ? p : { ...p, stack: 0, is_all_in: true }
        ),
      },
    };
    const off = replayAt(allInOppState, PROFILE, SEEDS, LIVE);
    const on = replayAt(allInOppState, PROFILE, SEEDS, ON);
    expect(on.receipts.holdem_priced_value_raise_deferred ?? 0).toBe(0);
    // Every seed preserves the exact non-fold baseline action token when villain has 0 chips behind.
    expect(on.kinds).toEqual(off.kinds);
    expect(on.actions).toEqual(off.actions);

    // Losing calls facing an all-in opponent still fold as priced.
    const dead = bySlug('river-a7-dead-call');
    const deadSt = state(dead);
    const deadAllIn = {
      ...deadSt,
      gs: {
        ...deadSt.gs,
        players: deadSt.gs.players.map((p) =>
          p.seat === deadSt.hero.seat || p.is_folded ? p : { ...p, stack: 0, is_all_in: true }
        ),
      },
    };
    expect(replayAt(deadAllIn, PROFILE, SEEDS, ON).kinds).toEqual({ fold: SEEDS.length });
  });
});
