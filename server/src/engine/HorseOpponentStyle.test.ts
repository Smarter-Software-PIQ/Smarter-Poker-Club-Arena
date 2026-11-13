/**
 * Opponent style read (2026-11-13): behaviour of the pure classifier and its
 * consumer helpers on SYNTHETIC opponents (HorseOpponentStyle.test-support).
 * DEVELOPMENT set: these archetypes were built while the thresholds were set.
 * The 80 audit fixtures are consumed separately (HorseOpponentStyleFixtures.test.ts).
 */
import { describe, expect, it } from 'vitest';
import {
  STYLE_FAMILY_PARAMS,
  STYLE_THRESHOLDS,
  bigBetRespect,
  carryOverCounters,
  classifyOpponentStyle,
  describeTactical,
  identifyAffectedProfiles,
  isValueBettor,
  profileQualification,
  raiseRespectShade,
  styleFamilyOf,
  tightOpenerRespect,
  tightReRaiserRespect,
  unknownStyle,
  type OpponentStyleInput,
  type OpponentStyleRead,
} from './HorseOpponentStyle.js';
import {
  callingStation,
  counters,
  frequentBluffer,
  maniac,
  tightAggressive,
  valueHeavyGrinder,
  type Archetype,
} from './HorseOpponentStyle.test-support.js';
import { decayAndAdd, exploitHandIncrements, freshExploitCounters } from './HorseOpponentExploit.js';

const read = (a: Archetype, extra: Partial<OpponentStyleInput> = {}): OpponentStyleRead =>
  classifyOpponentStyle({
    scope: 'holdem:full',
    variant: 'nlh',
    domain: 'cash',
    counters: a.counters,
    tallies: a.tallies,
    provenance: { source: 'live', complete: true },
    ...extra,
  });

const VARIANTS = ['nlh', 'flh', 'pineapple', 'short_deck', 'plo4', 'plo5', 'plo6', 'plo8', 'flo8'] as const;
const SCOPES = ['holdem:full', 'holdem:short', 'holdem:hu', 'omaha:full', 'omaha:short', 'sixplus:full'] as const;

describe('the four states of not knowing are separate and neutral', () => {
  it('(a) no scope, no population cell, no evidence: neutral, uncertain, protective logic armed', () => {
    const reads = [
      classifyOpponentStyle({ scope: null }),
      classifyOpponentStyle({ scope: 'holdem:full', variant: 'nlh' }),
      unknownStyle('x'),
    ];
    for (const r of reads) {
      expect(r.label).toBe('unknown');
      expect(r.evidence.state).toBe('no_reliable_individual_evidence');
      expect(r.evidence.supported).toBe(false);
      expect(r.evidence.uncertain).toBe(true);
      expect(r.evidence.protectiveLogicArmed).toBe(true);
      expect(r.participation).toMatchObject({ score: 0, side: 'neutral', credible: false });
      expect(r.aggression).toMatchObject({ score: 0, side: 'neutral', credible: false });
      expect(r.bettingRange).toMatchObject({ score: 0, side: 'neutral', credible: false });
      expect(r.release.standDown).toBe(false);
      expect(isValueBettor(r)).toBe(false);
      expect(bigBetRespect(r, { street: 'river', potFraction: 1, isRaise: false })).toBe(0);
      expect(raiseRespectShade(r, { decisionSpr: 20 })).toBe(0);
      expect(tightOpenerRespect(r)).toBeNull();
      expect(tightReRaiserRespect(r)).toBeNull();
    }
  });

  it('unknown is neutral in EVERY variant and table size', () => {
    for (const variant of VARIANTS)
      for (const scope of SCOPES) {
        const r = classifyOpponentStyle({ scope, variant, domain: 'tournament', counters: null, tallies: null });
        expect(r.label, `${variant} ${scope}`).toBe('unknown');
        expect(r.evidence.state).toBe('no_reliable_individual_evidence');
        expect(r.participation.side).toBe('neutral');
        expect(r.aggression.side).toBe('neutral');
        expect(r.bettingRange.side).toBe('neutral');
      }
  });

  it('is not read aggressive (or passive) until 15 hands have passed, whatever else is on file', () => {
    const m = maniac();
    const young = counters({ hands: 14, vpip: 0.9, pfr: 0.8, threeBetOpp: 12, threeBet: 9, betCheckedToOpp: 12, betCheckedTo: 12 });
    const r14 = read({ counters: young, tallies: { ...m.tallies, hands: 14 } });
    expect(r14.evidence.state).toBe('no_reliable_individual_evidence');
    expect(r14.evidence.individualHands).toBe(14);
    expect(r14.aggression.side).toBe('neutral');
    expect(r14.label).toBe('unknown');
    const r15 = read({ counters: { ...young, hands: 15, vpip: 13.5, pfr: 12 }, tallies: { ...m.tallies, hands: 15 } });
    expect(r15.evidence.state).toBe('supported_individual_read');
    expect(r15.aggression.side).toBe('aggressive');
  });

  it('(b) the population prior is a separate, bounded, shrinking, never-individual field that disables nothing', () => {
    const r = unknownStyle('x', 'holdem:full', 'nlh', 'cash', 4);
    const p = r.evidence.populationPrior;
    expect(p.measuredIndividualTrait).toBe(false);
    expect(p.mayDisableProtection).toBe(false);
    expect(p.available).toBe(false); // no measured human prior exists yet
    expect(p.weight).toBe(0);
    expect(p.uncertainty).toBe(1);
    expect(p.participationShift + p.aggressionShift + p.bettingRangeShift).toBe(0);
    expect(STYLE_THRESHOLDS.populationPriorMaxFraction).toBeLessThanOrEqual(0.25);
  });

  it('(d) tactical aggression is a feature of the situation, never of the player', () => {
    const t = describeTactical({ street: 'river', potFraction: 0.9, isRaise: true, decisionSpr: 1.5 });
    expect(t).toMatchObject({ kind: 'situation', trait: false, isRiverRaise: true, isLargeWager: true, isShortSpr: true });
    // describing a tactical spot cannot change a read
    const before = read(valueHeavyGrinder());
    describeTactical({ street: 'turn', potFraction: 1, isRaise: false, decisionSpr: 9 });
    expect(read(valueHeavyGrinder())).toEqual(before);
  });
});

describe('reference case: the passive value-heavy winning grinder', () => {
  const r = read(valueHeavyGrinder());
  it('is labelled value-heavy-passive, not a maniac, with a supported read', () => {
    expect(r.evidence.state).toBe('supported_individual_read');
    expect(r.label).toBe('value-heavy-passive');
    expect(r.participation.side).toBe('tight');
    expect(r.aggression.side).toBe('passive');
    expect(r.bettingRange.side).toBe('value-weighted');
  });
  it('is a value bettor, earns capped big-bet respect on large river bets only, and shades one pair against his raise at depth', () => {
    expect(isValueBettor(r)).toBe(true);
    const cap = STYLE_THRESHOLDS.bigBetRespectCap;
    expect(cap).toBe(0.15);
    const big = bigBetRespect(r, { street: 'river', potFraction: 0.75, isRaise: false });
    expect(big).toBeGreaterThan(0);
    expect(big).toBeLessThanOrEqual(cap);
    expect(bigBetRespect(r, { street: 'river', potFraction: 0.3, isRaise: false })).toBe(0);
    expect(bigBetRespect(r, { street: 'flop', potFraction: 0.9, isRaise: false })).toBe(0);
    expect(bigBetRespect(r, { street: 'flop', potFraction: 0.9, isRaise: true })).toBe(0);
    // shown strength is not generalised: a turn bet and a river raise get at most half
    const turn = bigBetRespect(r, { street: 'turn', potFraction: 0.9, isRaise: false });
    const riverRaise = bigBetRespect(r, { street: 'river', potFraction: 0.5, isRaise: true });
    expect(turn).toBeLessThanOrEqual(big * STYLE_THRESHOLDS.bigBetNonRiverBetShare + 1e-12);
    expect(riverRaise).toBeLessThanOrEqual(big * STYLE_THRESHOLDS.bigBetNonRiverBetShare + 1e-12);
    expect(riverRaise).toBeGreaterThan(0);
    // a blocker halves it
    expect(bigBetRespect(r, { street: 'river', potFraction: 0.75, isRaise: false, heroHasBlocker: true })).toBeCloseTo(big * STYLE_THRESHOLDS.bigBetBlockerShare, 10);
    expect(raiseRespectShade(r, { decisionSpr: 10 })).toBeGreaterThan(0);
  });
  it('is not forced into a fold: a river raise from him is bounded well under the cap', () => {
    const riverRaise = bigBetRespect(r, { street: 'river', potFraction: 2, isRaise: true });
    expect(riverRaise).toBeLessThan(STYLE_THRESHOLDS.bigBetRespectCap);
  });
});

describe('other archetypes are read for what they are', () => {
  it('a maniac is a maniac and gets no respect from any consumer', () => {
    const r = read(maniac());
    expect(r.label).toBe('maniac');
    expect(r.participation.side).toBe('loose');
    expect(r.aggression.side).toBe('aggressive');
    expect(r.bettingRange.side).toBe('bluff-weighted');
    expect(isValueBettor(r)).toBe(false);
    expect(bigBetRespect(r, { street: 'river', potFraction: 1, isRaise: false })).toBe(0);
    expect(raiseRespectShade(r, { decisionSpr: 20 })).toBe(0);
    expect(tightOpenerRespect(r)).toBeNull();
    expect(tightReRaiserRespect(r)).toBeNull();
  });
  it("'raises more than Horses' alone is not 'maniac'", () => {
    const a: Archetype = {
      counters: counters({ hands: 80, vpip: 0.27, pfr: 0.22, threeBetOpp: 20, threeBet: 2, betCheckedToOpp: 40, betCheckedTo: 14 }),
      tallies: { hands: 400, postAggr: 150, postPassive: 70 },
    };
    const r = read(a);
    expect(r.signals.pfr.side).toBe('high');
    expect(r.label).not.toBe('maniac');
  });
  it('a calling station enters many pots and rarely raises: loose-passive, and entry is separate from aggression', () => {
    const r = read(callingStation());
    expect(r.label).toBe('loose-passive');
    expect(r.participation.side).toBe('loose');
    expect(r.aggression.side).toBe('passive');
  });
  it('a frequent bluffer is bluff-weighted and gets no big-bet respect', () => {
    const r = read(frequentBluffer());
    expect(r.bettingRange.side).toBe('bluff-weighted');
    expect(isValueBettor(r)).toBe(false);
    expect(bigBetRespect(r, { street: 'river', potFraction: 0.8, isRaise: false })).toBe(0);
  });
  it('a tight-aggressive regular is tight with the raise ratio placing him aggressive; not a value bettor', () => {
    const r = read(tightAggressive());
    expect(r.label).toBe('tight-aggressive');
    expect(isValueBettor(r)).toBe(false);
    expect(tightReRaiserRespect(r)).toBeNull();
  });
  it('a player can enter many pots and bet selectively: participation and aggression disagree', () => {
    const a: Archetype = {
      counters: counters({ hands: 90, vpip: 0.42, pfr: 0.12, threeBetOpp: 25, threeBet: 1, betCheckedToOpp: 40, betCheckedTo: 12 }),
      tallies: { hands: 300, postAggr: 80, postPassive: 100 },
    };
    const r = read(a);
    expect(r.participation.side).toBe('loose');
    expect(r.aggression.side).not.toBe('aggressive');
  });
});

describe('sparse and conflicting observations stay modest', () => {
  it('three shown strong big bets alone are value evidence, but a conflicting aggressive profile offsets it', () => {
    const quiet = read({
      counters: counters({ hands: 40, vpip: 0.2, pfr: 0.13 }),
      tallies: { hands: 40, postAggr: 6, postPassive: 6, bigBetSD: 3, bigBetSDStrong: 3 },
    });
    expect(quiet.signals.shownStrength.side).toBe('value');
    const conflicted = read({
      counters: counters({ hands: 40, vpip: 0.35, pfr: 0.3, betCheckedToOpp: 30, betCheckedTo: 26 }),
      tallies: { hands: 40, postAggr: 50, postPassive: 8, bigBetSD: 3, bigBetSDStrong: 3 },
    });
    expect(conflicted.bettingRange.score).toBeLessThan(quiet.bettingRange.score);
    expect(conflicted.bettingRange.side).not.toBe('value-weighted');
  });
  it('two shown big bets are not enough: no shown-strength side (engaged from 3, not 20)', () => {
    const r = read({
      counters: counters({ hands: 40, vpip: 0.2, pfr: 0.13 }),
      tallies: { hands: 40, postAggr: 10, postPassive: 10, bigBetSD: 2, bigBetSDStrong: 2 },
    });
    expect(r.signals.shownStrength.side).toBeNull();
    const three = read({
      counters: counters({ hands: 40, vpip: 0.2, pfr: 0.13 }),
      tallies: { hands: 40, postAggr: 10, postPassive: 10, bigBetSD: 3, bigBetSDStrong: 3 },
    });
    expect(three.signals.shownStrength.side).toBe('value');
  });
});

describe('showdown selection bias is carried and discounted', () => {
  const base = { counters: counters({ hands: 80, vpip: 0.2, pfr: 0.13 }) };
  it('the same shown strength weighs less when it is a sliver of all his betting', () => {
    const revealed = read({ ...base, tallies: { hands: 400, postAggr: 40, postPassive: 40, bigBetSD: 8, bigBetSDStrong: 8 } });
    const sliver = read({ ...base, tallies: { hands: 400, postAggr: 4000, postPassive: 4000, bigBetSD: 8, bigBetSDStrong: 8 } });
    expect(sliver.bettingRange.evidence.shownValue).toBeLessThan(revealed.bettingRange.evidence.shownValue);
    expect(sliver.bettingRange.availability.discount).toBeLessThan(revealed.bettingRange.availability.discount);
    expect(sliver.bettingRange.availability.discount).toBeGreaterThanOrEqual(STYLE_THRESHOLDS.availabilityFloor);
  });
  it('carries shown-versus-unshown counts, and caps shown strength below full weight however many shown', () => {
    const r = read({ ...base, tallies: { hands: 900, postAggr: 120, postPassive: 100, bigBetSD: 100, bigBetSDStrong: 100 } });
    expect(r.bettingRange.availability).toMatchObject({ shown: 100, opportunities: 120, unrevealed: 20 });
    expect(r.receipt.availability.shown).toBe(100);
    expect(r.bettingRange.evidence.shownValue).toBeLessThanOrEqual(STYLE_THRESHOLDS.showdownEvidenceCap + 1e-12);
  });
});

describe('a gear change is followed proportionally, never by a reset', () => {
  const tight = (fast: { hands: number; pfr?: number }) => ({
    counters: counters({ hands: 80, vpip: 0.13, pfr: 0.07, threeBetOpp: 20, threeBet: 0, betCheckedToOpp: 40, betCheckedTo: 6, fast }),
    tallies: valueHeavyGrinder().tallies,
  });
  it('release grows with the fast window and value evidence shrinks with it; stand-down only at the line', () => {
    const calm = read(tight({ hands: 10, pfr: 0.7 }));
    const mild = read(tight({ hands: 8, pfr: 2.4 }));
    const loud = read(tight({ hands: 10, pfr: 7 }));
    expect(calm.release.fraction).toBe(0);
    expect(loud.release.fraction).toBeGreaterThan(mild.release.fraction);
    expect(mild.release.fraction).toBeGreaterThanOrEqual(calm.release.fraction);
    expect(loud.bettingRange.evidence.frequencyValue).toBeLessThan(calm.bettingRange.evidence.frequencyValue);
    expect(loud.bettingRange.evidence.shownValue).toBeLessThan(calm.bettingRange.evidence.shownValue);
    expect(loud.bettingRange.evidence.frequencyBluff).toBeGreaterThan(calm.bettingRange.evidence.frequencyBluff);
    expect(loud.release.standDown).toBe(true);
    expect(calm.release.standDown).toBe(false);
    // every consumer stands down at the line
    expect(isValueBettor(loud)).toBe(false);
    expect(bigBetRespect(loud, { street: 'river', potFraction: 1, isRaise: false })).toBe(0);
    expect(raiseRespectShade(loud, { decisionSpr: 10 })).toBe(0);
  });
  it('is monotone: a stronger fast window never gives more respect', () => {
    let last = Infinity;
    for (const fp of [0.7, 1.2, 2, 3, 4.5, 6, 8]) {
      const r = read(tight({ hands: 10, pfr: fp }));
      const v = bigBetRespect(r, { street: 'river', potFraction: 0.8, isRaise: false });
      expect(v).toBeLessThanOrEqual(last + 1e-12);
      last = v;
    }
  });
  it("one bluff does not erase earlier evidence: a shown bluff lowers the shown share in proportion", () => {
    const before = read({ ...valueHeavyGrinder(), tallies: { ...valueHeavyGrinder().tallies, bigBetSD: 10, bigBetSDStrong: 10 } });
    const oneBluff = read({ ...valueHeavyGrinder(), tallies: { ...valueHeavyGrinder().tallies, bigBetSD: 11, bigBetSDStrong: 10 } });
    const manyBluffs = read({ ...valueHeavyGrinder(), tallies: { ...valueHeavyGrinder().tallies, bigBetSD: 20, bigBetSDStrong: 10 } });
    expect(oneBluff.signals.shownStrength.share).toBeLessThan(before.signals.shownStrength.share);
    expect(oneBluff.signals.shownStrength.side).toBe('value'); // not erased
    expect(manyBluffs.signals.shownStrength.side).not.toBe('value');
  });
});

describe('profiles built before complete observations are discounted, never trusted at full weight', () => {
  it('confidence is capped and no value-bettor guard is reachable when the profile is incomplete', () => {
    const full = read(valueHeavyGrinder());
    const incomplete = read(valueHeavyGrinder(), { provenance: { source: 'durable', complete: false } });
    const unknown = read(valueHeavyGrinder(), { provenance: { source: 'durable', complete: null } });
    expect(full.confidenceCap).toBe(1);
    expect(incomplete.confidenceCap).toBeCloseTo(STYLE_THRESHOLDS.incompleteProfileCap, 10);
    expect(unknown.confidenceCap).toBeCloseTo(STYLE_THRESHOLDS.unqualifiedProfileCap, 10);
    expect(isValueBettor(full)).toBe(true);
    expect(isValueBettor(incomplete)).toBe(false);
    expect(isValueBettor(unknown)).toBe(true);
    const spot = { street: 'river', potFraction: 0.8, isRaise: false } as const;
    const a = bigBetRespect(full, spot);
    const b = bigBetRespect(unknown, spot);
    const c = bigBetRespect(incomplete, spot);
    expect(c).toBeLessThan(b);
    expect(b).toBeLessThan(a + 1e-12);
    expect(incomplete.receipt.provenance).toMatchObject({ source: 'durable', complete: false, cap: STYLE_THRESHOLDS.incompleteProfileCap });
  });
  it('qualification marks a profile without its back-fill or public domain, and lists the affected ones without replaying anything', () => {
    expect(profileQualification({ initialized: true, public_memory_domain: { x: 1 } }).complete).toBe(true);
    expect(profileQualification({ initialized: false, public_memory_domain: { x: 1 } })).toMatchObject({ complete: false, reasons: ['backfill_pending'] });
    expect(profileQualification({ initialized: true })).toMatchObject({ complete: false, reasons: ['no_public_memory_domain'] });
    expect(profileQualification(null).complete).toBe(false);
    const affected = identifyAffectedProfiles([
      { user_id: 'a', variant: 'nlh', mode: 'cash', size: 'full', initialized: true, public_memory_domain: {} },
      { user_id: 'b', variant: 'nlh', mode: 'cash', size: 'full', initialized: true },
      { user_id: 'c', variant: 'plo5', mode: 'tournament', size: 'short', initialized: false },
    ]);
    expect(affected.map((x) => x.key)).toEqual(['nlh:cash:full|b', 'plo5:tournament:short|c']);
  });
});

describe('format-specific by default; carry-over is an option at weight 0', () => {
  const tournamentRegular = counters({ hands: 80, vpip: 0.1, pfr: 0.06, threeBetOpp: 20, threeBet: 0 });
  it('the other format counters are ignored at the default weight, even for a player with no hands here', () => {
    const r = classifyOpponentStyle({
      scope: 'holdem:full', variant: 'nlh', domain: 'cash',
      counters: counters({ hands: 5, vpip: 0.2, pfr: 0.1 }), carry: tournamentRegular,
      tallies: null, provenance: { complete: true },
    });
    expect(r.evidence.state).toBe('no_reliable_individual_evidence');
    expect(r.receipt.carried).toBeNull();
    expect(carryOverCounters(undefined, tournamentRegular).weight).toBe(0);
    expect(STYLE_THRESHOLDS.carryWeight).toBe(0);
  });
  it('a stated weight carries the other format, tapering to nothing as own hands arrive, and says so in the receipt', () => {
    const own = counters({ hands: 5, vpip: 0.2, pfr: 0.1 });
    const r = classifyOpponentStyle({
      scope: 'holdem:full', variant: 'nlh', domain: 'cash', counters: own, carry: tournamentRegular,
      carryWeight: 0.4, tallies: null, provenance: { complete: true },
    });
    expect(r.receipt.carried).toBeGreaterThan(0);
    const rich = classifyOpponentStyle({
      scope: 'holdem:full', variant: 'nlh', domain: 'cash', counters: counters({ hands: 40, vpip: 0.2, pfr: 0.1 }),
      carry: tournamentRegular, carryWeight: 0.4, tallies: null, provenance: { complete: true },
    });
    expect(rich.receipt.carried).toBeNull();
  });
});

describe('variants have separate parameter sets; Omaha classifies but has no consumers here', () => {
  it('PLO4, PLO5 and PLO6 do not share one parameter set and none is the hold\'em set', () => {
    const f = STYLE_FAMILY_PARAMS;
    expect(f.plo4.marginScale).not.toBe(f.plo5.marginScale);
    expect(f.plo5.marginScale).not.toBe(f.plo6.marginScale);
    for (const k of ['plo4', 'plo5', 'plo6', 'omaha_other', 'sixplus'] as const) {
      expect(f[k].consumers).toBe(false);
      expect(f[k].calibrated).toBe(false);
      expect(f[k].horsePostflopAggressionShare).toBeNull();
      expect(f[k].marginScale).toBeGreaterThan(f.holdem.marginScale);
    }
    expect(f.holdem.consumers).toBe(true);
    expect(styleFamilyOf('plo4', null)).toBe('plo4');
    expect(styleFamilyOf('plo5', null)).toBe('plo5');
    expect(styleFamilyOf('plo6', null)).toBe('plo6');
    expect(styleFamilyOf('nlh', null)).toBe('holdem');
    expect(styleFamilyOf('short_deck', null)).toBe('sixplus');
  });
  it('an Omaha read is supported and receipted, but every consumer returns no adjustment', () => {
    for (const variant of ['plo4', 'plo5', 'plo6'] as const) {
      const r = classifyOpponentStyle({
        scope: 'omaha:full', variant, domain: 'cash',
        counters: valueHeavyGrinder().counters, tallies: valueHeavyGrinder().tallies, provenance: { complete: true },
      });
      expect(r.evidence.state, variant).toBe('supported_individual_read');
      expect(r.family).toBe(variant);
      expect(r.consumersMayAct).toBe(false);
      expect(isValueBettor(r)).toBe(false);
      expect(bigBetRespect(r, { street: 'river', potFraction: 1, isRaise: false })).toBe(0);
      expect(raiseRespectShade(r, { decisionSpr: 20 })).toBe(0);
      expect(tightOpenerRespect(r)).toBeNull();
      expect(tightReRaiserRespect(r)).toBeNull();
      // the hold'em Horse aggression share is not borrowed for Omaha
      expect(r.signals.aggressionShare.n).toBe(0);
    }
  });
});

describe('what the decision-time counters cannot carry is stated, and the read stays deterministic', () => {
  it('lists position, depth, street-specific and sizing features as not available in the receipt', () => {
    const r = read(valueHeavyGrinder());
    for (const f of ['position', 'stack_depth', 'heads_up_versus_multiway', 'board_and_blocker_context', 'postflop_raise_per_opportunity'])
      expect(r.receipt.notAvailable).toContain(f);
  });
  it('is frozen, deterministic and does not mutate its input', () => {
    const a = valueHeavyGrinder();
    const snapshot = JSON.stringify(a);
    const r1 = read(a);
    const r2 = read(a);
    expect(JSON.stringify(a)).toBe(snapshot);
    expect(r1).toEqual(r2);
    expect(Object.isFrozen(r1)).toBe(true);
    expect(Object.isFrozen(r1.receipt)).toBe(true);
  });
  it('decayed counters rebuild identically after a restart (same hands, same order, same read)', () => {
    const hands = [
      [{ userId: 'u', action: 'call', stage: 'preflop' }],
      [{ userId: 'o', action: 'raise', stage: 'preflop' }, { userId: 'u', action: 'fold', stage: 'preflop', origin: 'player' }],
      [{ userId: 'u', action: 'raise', stage: 'preflop' }],
    ] as const;
    const build = () => {
      const c = freshExploitCounters();
      for (let i = 0; i < 60; i++) {
        const inc = exploitHandIncrements([...hands[i % hands.length]] as never).get('u');
        if (inc) decayAndAdd(c, inc);
      }
      return c;
    };
    const a = build();
    const b = build();
    expect(b).toEqual(a);
    const tallies = { hands: 60, postAggr: 20, postPassive: 30 };
    expect(read({ counters: a, tallies })).toEqual(read({ counters: b, tallies }));
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Pre-repair provenance (item 10), observable pattern, population prior
// ─────────────────────────────────────────────────────────────────────────
import { STYLE_POPULATION_PRIOR, preRepairDiscount, preRepairKeyed, preRepairWeight } from './HorseOpponentStyle.js';

describe('pre-repair discount (cash, table speed, built before the repaired learner)', () => {
  const biased = () =>
    counters({ hands: 80, vpip: 0.2, pfr: 0.14, foldToBetOpp: 40, foldToBet: 29, betCheckedToOpp: 40, betCheckedTo: 16 });
  const run = (provenance: OpponentStyleInput['provenance']) =>
    classifyOpponentStyle({ scope: 'holdem:full', variant: 'nlh', domain: 'cash', counters: biased(), provenance });
  it('weights follow 0.5^(m/30)', () => {
    const w = (m: number) => Number(preRepairWeight(m).toFixed(3));
    expect([0, 10, 20, 30, 60, 90, 120].map(w)).toEqual([1, 0.794, 0.63, 0.5, 0.25, 0.125, 0.063]);
    expect(preRepairWeight(null)).toBe(1);
  });
  it('is keyed from mode and speed only', () => {
    expect(preRepairKeyed('cash', { speed: 'table' })).toBe(true);
    expect(preRepairKeyed('cash', { speed: 'lightning' })).toBe(false);
    expect(preRepairKeyed('tournament', { speed: 'table' })).toBe(false);
    expect(preRepairKeyed('cash', undefined)).toBeNull();
  });
  it('a biased over-folder read does not engage while m is unknown or below 60; unaffected rows keep it', () => {
    const free = run({ preRepair: false });
    expect(free.signals.foldToBet.n).toBeGreaterThan(0);
    for (const prov of [{ preRepair: true }, { preRepair: null }, { preRepair: true, postRelease: { foldToBet: 59 } }]) {
      const r = run(prov);
      expect(r.signals.foldToBet.n).toBe(0);
      expect(r.signals.foldToBet.side).toBeNull();
      expect(r.receipt.provenance.discounted).toContain('foldToBet');
    }
  });
  it('after m >= 60 the statistic returns at the post-release share (1 - bound), never at full weight', () => {
    const lifted = run({ preRepair: true, postRelease: { foldToBet: 60, riverCall: 60, foldTo3Bet: 60, betCheckedTo: 60 } });
    const free = run({ preRepair: false });
    expect(lifted.receipt.provenance.discounted).toEqual([]);
    expect(lifted.signals.foldToBet.n).toBeCloseTo(free.signals.foldToBet.n * 0.75, 3);
    expect(preRepairDiscount({ preRepair: true, postRelease: { foldToBet: 60 } }, 'foldToBet').weight).toBe(0.75);
  });
  it('vpip and pfr are never discounted', () => {
    const a = run({ preRepair: true });
    const b = run({ preRepair: false });
    expect(a.signals.vpip).toEqual(b.signals.vpip);
    expect(a.signals.pfr).toEqual(b.signals.pfr);
  });
});

describe('observable pattern and population prior', () => {
  it("'enters wide, bets selectively' is first-class and never a maniac", () => {
    const c = counters({ hands: 80, vpip: 0.5, pfr: 0.09, threeBetOpp: 20, threeBet: 0, betCheckedToOpp: 40, betCheckedTo: 8, foldToBetOpp: 30, foldToBet: 10 });
    const r = classifyOpponentStyle({ scope: 'holdem:full', variant: 'nlh', domain: 'cash', counters: c, provenance: { complete: true }, tallies: { hands: 400, postAggr: 40, postPassive: 160 } });
    expect(r.participation.side).toBe('loose');
    expect(r.pattern).toBe('wide_entry_selective_betting');
    expect(r.label).not.toBe('maniac');
    const m = classifyOpponentStyle({ scope: 'holdem:full', variant: 'nlh', domain: 'cash', counters: maniac().counters, provenance: { complete: true }, tallies: maniac().tallies });
    expect(m.pattern).toBeNull();
  });
  it('a population prior can only be put on entry width, never on aggression or the betting range', () => {
    for (const p of Object.values(STYLE_POPULATION_PRIOR)) {
      expect(p.aggressionShift).toBe(0);
      expect(p.bettingRangeShift).toBe(0);
    }
  });
});

import { postflopFoldBluffScale, riverFirstBetFractions, sizeBucketOf, valueExtraction } from './HorseOpponentStyle.js';

describe('A2 sizing as betting-range evidence', () => {
  const read = (sizeBuckets: Parameters<typeof classifyOpponentStyle>[0]['sizeBuckets']) =>
    classifyOpponentStyle({ scope: 'holdem:full', variant: 'nlh', domain: 'cash', counters: valueHeavyGrinder().counters, tallies: valueHeavyGrinder().tallies, provenance: { complete: true }, sizeBuckets });
  const river = (r: OpponentStyleRead, potFraction: number) => bigBetRespect(r, { street: 'river', potFraction, isRaise: false });
  it('buckets: under 0.5, 0.5 to 0.66, 0.66 to 1, overbet', () => {
    expect([0.3, 0.55, 0.75, 1.4].map(sizeBucketOf)).toEqual(['small', 'medium', 'large', 'overbet']);
  });
  it('bluff-weighted at the size he bet: no respect, whatever the all-size read says', () => {
    const base = river(read(null), 0.75);
    expect(base).toBeGreaterThan(0);
    expect(river(read({ large: { bets: 12, shown: 8, strong: 1 } }), 0.75)).toBe(0);
    expect(river(read({ large: { bets: 12, shown: 8, strong: 1 } }), 1.4)).toBe(base > 0 ? river(read(null), 1.4) : 0);
  });
  it('value-weighted at the size adds evidence, bounded by the cap, discounted when few are shown', () => {
    const full = river(read({ large: { bets: 8, shown: 8, strong: 8 } }), 0.75);
    const sparse = read({ large: { bets: 4000, shown: 8, strong: 8 } });
    expect(full).toBeGreaterThanOrEqual(river(read(null), 0.75));
    expect(full).toBeLessThanOrEqual(STYLE_THRESHOLDS.bigBetRespectCap);
    expect(sparse.signals.shownBySize.large.discount).toBeLessThan(read({ large: { bets: 8, shown: 8, strong: 8 } }).signals.shownBySize.large.discount);
  });
  it('the learner replay measures the first river bet against the pot before it', () => {
    const f = riverFirstBetFractions([
      { userId: 'a', action: 'raise', amount: 6, stage: 'preflop' },
      { userId: 'b', action: 'call', amount: 6, stage: 'preflop' },
      { userId: 'a', action: 'bet', amount: 9, stage: 'river' },
      { userId: 'b', action: 'raise', amount: 30, stage: 'river' },
      { userId: 'a', action: 'raise', amount: 80, stage: 'river' },
    ]);
    expect(f.get('a')).toBeCloseTo(9 / 12, 6);
    expect(f.get('b')).toBeCloseTo(30 / 21, 6);
  });
});

describe('A4 value extraction and item 3 fold bluffing helpers', () => {
  const caller = (fast = {}) =>
    classifyOpponentStyle({ scope: 'holdem:full', variant: 'nlh', domain: 'cash', provenance: { complete: true }, tallies: { hands: 300, postAggr: 40, postPassive: 150 }, counters: { ...counters({ hands: 80, vpip: 0.3, pfr: 0.12, betCheckedToOpp: 40, betCheckedTo: 7, foldToBetOpp: 40, foldToBet: 11 }), ...fast } });
  it('bounded; slow-play cut only against a non-bettor; released by a rising fast fold rate', () => {
    const v = valueExtraction(caller())!;
    expect(v.sizeMul).toBeGreaterThan(1);
    expect(v.sizeMul).toBeLessThanOrEqual(1 + STYLE_THRESHOLDS.valueSizeMax);
    expect(v.thinShift).toBeLessThanOrEqual(STYLE_THRESHOLDS.valueThinShiftMax);
    expect(v.slowplayMul).toBeLessThan(1);
    expect(valueExtraction(caller({ fFoldToBetOpp: 10, fFoldToBet: 9 }))).toBeNull();
    expect(valueExtraction(unknownStyle('no_evidence'))).toBeNull();
    const bettor = classifyOpponentStyle({ scope: 'holdem:full', variant: 'nlh', domain: 'cash', provenance: { complete: true }, tallies: { hands: 300, postAggr: 150, postPassive: 150 }, counters: counters({ hands: 80, vpip: 0.3, pfr: 0.12, betCheckedToOpp: 40, betCheckedTo: 22, foldToBetOpp: 40, foldToBet: 11 }) });
    const vb = valueExtraction(bettor);
    if (vb) expect(vb.slowplayMul).toBe(1);
  });
  it('fold bluffing follows the street; the increase is withheld against a possible fold-faker', () => {
    const folder = (betCheckedTo: number) =>
      classifyOpponentStyle({ scope: 'holdem:full', variant: 'nlh', domain: 'cash', provenance: { complete: true }, tallies: { hands: 300, postAggr: 80, postPassive: 100 }, counters: counters({ hands: 80, vpip: 0.2, pfr: 0.14, betCheckedToOpp: 40, betCheckedTo, foldToBetOpp: 40, foldToBet: 30 }) });
    expect(postflopFoldBluffScale(folder(12), 'flop')!).toBeGreaterThan(1);
    expect(postflopFoldBluffScale(folder(12), 'flop')!).toBeLessThanOrEqual(1 + STYLE_THRESHOLDS.foldBluffUpMax);
    expect(postflopFoldBluffScale(folder(12), 'river')).toBeNull();
    expect(postflopFoldBluffScale(folder(32), 'flop')).toBe(1);
    expect(postflopFoldBluffScale(caller(), 'turn')!).toBeLessThan(1);
    expect(postflopFoldBluffScale(classifyOpponentStyle({ ...{ scope: 'holdem:full' as const, variant: 'nlh', domain: 'cash' as const }, provenance: { preRepair: true }, counters: counters({ hands: 80, vpip: 0.2, pfr: 0.14, foldToBetOpp: 40, foldToBet: 30 }) }), 'flop')).toBeNull();
  });
});
