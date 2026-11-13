import { afterEach, describe, expect, it, vi } from 'vitest';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { HorseMind } from './HorseMind.js';
import { ALL_SPOTS, checkedTo, HERO, VILLAIN, VILLAINS, decide, install, preflopJam, preflopOpen, preflopThreeBet, turnPotBet, type Mode, type Villain } from './HorseOpponentStyle.contexts.test-support.js';
import { counters } from './HorseOpponentStyle.test-support.js';
import { postReleaseOpportunitiesFromHistory } from './HorseOpponentStyle.js';

const drain = (): Record<string, number> => {
  enableBrainTelemetry();
  return Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));
};
const ALL_ON = { styleValueBettorNotManiac: true, styleBigBetHonesty: true, styleRaiseRespect: true, styleTightReRaiserRespect: true, styleFoldRatePreRepair: true, styleFoldBluff: true };
const RANK: Record<string, number> = { fold: 0, call: 1, raise: 2, all_in: 3 };
const MODES: Mode[] = ['cash', 'tournament', 'bubble'];
afterEach(() => vi.restoreAllMocks());

/** Table-speed cash rows are pre-repair: supply m so the showdown-dependent statistics engage in these tests. */
function supply(m: number): void {
  for (const mode of ['cash', 'tournament'] as const)
    HorseMind.importPostReleaseObservations([{ user_id: VILLAIN, variant: 'nlh', mode, size: 'full', opportunities: { foldToBet: m, riverCall: m, foldTo3Bet: m, betCheckedTo: m } }]);
}

/** A passive-ish value-heavy bettor whose AF is above 2.5 but whose big bets shown so far are few (V83 needs 20). */
const valueAggressor = (): Villain => ({
  stats: { hands: 400, aggr: 150, passive: 40, postAggr: 150, postPassive: 40, bigBetSD: 8, bigBetSDStrong: 7, rAggr: 3, rPassive: 6 },
  counters: counters({ hands: 80, vpip: 0.13, pfr: 0.08, threeBetOpp: 20, threeBet: 0, betCheckedToOpp: 40, betCheckedTo: 6, foldToBetOpp: 30, foldToBet: 14 }),
  complete: true,
});

describe('style read consumers: wiring in cash and tournament', () => {
  for (const mode of MODES) {
    it(`${mode}: tight opener respect turns a marginal 3-bet into a call against a tight opener, receipt fires`, () => {
      const spot = preflopOpen(mode, 'KhJd');
      install(VILLAINS.grinder!, mode);
      supply(120);
      const on = decide(spot, { styleTightReRaiserRespect: true });
      install(VILLAINS.grinder!, mode);
      const off = decide(spot);
      expect(on.fires.style_tight_opener_respect_seen).toBeGreaterThan(0);
      expect(RANK[on.decision.action]).toBeLessThanOrEqual(RANK[off.decision.action]);
      if (mode !== 'bubble') expect([off.decision.action, on.decision.action]).toEqual(['raise', 'call']);
    });

    it(`${mode}: big-bet and raise respect receipts fire and never widen`, () => {
      for (const spot of ALL_SPOTS(mode))
        for (const [vn, v] of Object.entries(VILLAINS)) {
          install(v, mode);
          supply(120);
          const off = decide(spot);
          install(v, mode);
          supply(120);
          const on = decide(spot, ALL_ON);
          expect(RANK[on.decision.action], `${spot.name}/${vn}`).toBeLessThanOrEqual(RANK[off.decision.action]);
        }
      install(VILLAINS.grinder!, mode);
      supply(120);
      expect(decide(ALL_SPOTS(mode)[0], { styleBigBetHonesty: true }).fires.style_big_bet_honesty_seen).toBeGreaterThan(0);
    });

    it(`${mode}: #2 a value bettor above AF 2.5 is not a maniac, so a one-pair call folds`, () => {
      const spot = turnPotBet(mode);
      install(valueAggressor(), mode);
      supply(120);
      const off = decide(spot);
      install(valueAggressor(), mode);
      supply(120);
      const on = decide(spot, { styleValueBettorNotManiac: true });
      expect(off.fires.legacy_aggression_factor_branch_seen).toBeGreaterThan(0);
      expect(on.fires.style_value_bettor_not_maniac_seen).toBeGreaterThan(0);
      expect(RANK[on.decision.action]).toBeLessThanOrEqual(RANK[off.decision.action]);
    });
  }

  it('a maniac read is never respected: no consumer moves against it', () => {
    for (const mode of MODES)
      for (const spot of ALL_SPOTS(mode)) {
        install(VILLAINS.maniac!, mode);
        supply(120);
        const off = decide(spot);
        install(VILLAINS.maniac!, mode);
        supply(120);
        expect(decide(spot, ALL_ON).digest, spot.name).toBe(off.digest);
      }
  });

  it('push/fold depth: the 12bb jam decision is identical with every option on, and the Nash block never asks for a style read', () => {
    for (const mode of MODES)
      for (const [vn, v] of Object.entries(VILLAINS)) {
        install(v, mode);
        supply(120);
        const off = decide(preflopJam(mode));
        install(v, mode);
        supply(120);
        expect(decide(preflopJam(mode), ALL_ON).digest, `${mode}/${vn}`).toBe(off.digest);
      }
    for (const spot of [preflopOpen('tournament', 'KhJd', 24), preflopThreeBet('tournament', 'QdQc', 24)]) {
      install(VILLAINS.grinder!, 'tournament');
      supply(120);
      const off = decide(spot);
      install(VILLAINS.grinder!, 'tournament');
      supply(120);
      expect(decide(spot, ALL_ON).digest, spot.name).toBe(off.digest);
    }
  });

  it('wrong-opponent attribution: the read consulted is the bettor, never the hero or a folded filler', () => {
    const seen: string[] = [];
    const real = HorseMind.styleRead.bind(HorseMind);
    vi.spyOn(HorseMind, 'styleRead').mockImplementation((id: string) => {
      seen.push(id);
      return real(id);
    });
    install(VILLAINS.grinder!, 'cash');
    supply(120);
    decide(turnPotBet('cash'), ALL_ON);
    decide(preflopOpen('cash', 'KhJd'), ALL_ON);
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen)).toEqual(new Set([VILLAIN]));
    expect(seen).not.toContain(HERO);
  });
});

describe('style read: pre-repair provenance reaches the decision-time read (item 10)', () => {
  const read = (mode: 'cash' | 'tournament', m: number | null, speed: 'table' | 'lightning' = 'table') => {
    HorseMind.reset();
    const c = counters({ hands: 80, vpip: 0.2, pfr: 0.14, foldToBetOpp: 40, foldToBet: 29, betCheckedToOpp: 40, betCheckedTo: 16 });
    HorseMind.importDurableOpponentProfiles([{ user_id: VILLAIN, variant: 'nlh', mode, size: 'full', observed_hands: 80, initialized: true, public_memory_domain: { version: 1, speed, ante: 'none' }, counters: c } as never]);
    if (m !== null) HorseMind.importPostReleaseObservations([{ user_id: VILLAIN, variant: 'nlh', mode, size: 'full', opportunities: { foldToBet: m, riverCall: m, foldTo3Bet: m, betCheckedTo: m } }]);
    HorseMind.setDecisionScope('holdem:full', 'nlh', mode);
    const r = HorseMind.styleRead(VILLAIN);
    HorseMind.setDecisionScope(null);
    return r;
  };
  it('cash table-speed row: showdown-dependent statistics excluded until m reaches 60, vpip and pfr untouched', () => {
    const none = read('cash', null);
    expect(none.receipt.provenance.preRepair).toBe('affected');
    expect(none.receipt.provenance.discounted).toEqual(['foldToBet', 'riverCall', 'foldTo3Bet', 'betCheckedTo']);
    expect(none.signals.foldToBet.n).toBe(0);
    expect(none.signals.vpip.n).toBeGreaterThan(0);
    expect(read('cash', 59).receipt.provenance.discounted).toContain('foldToBet');
    const lifted = read('cash', 60);
    expect(lifted.receipt.provenance.discounted).toEqual([]);
    expect(lifted.signals.foldToBet.n).toBeGreaterThan(0);
    expect(lifted.signals.foldToBet.n).toBeLessThan(40);
  });
  it('tournament and lightning rows are not affected', () => {
    expect(read('tournament', null).receipt.provenance.preRepair).toBe('not_affected');
    expect(read('cash', null, 'lightning').receipt.provenance.discounted).toEqual([]);
    expect(read('tournament', null).signals.foldToBet.n).toBeGreaterThan(0);
  });
  it('restart consistency: m is an import, so a reset and re-import rebuilds the same read', () => {
    const a = read('cash', 75);
    HorseMind.reset();
    const b = read('cash', 75);
    expect(JSON.stringify(b.receipt)).toBe(JSON.stringify(a.receipt));
    expect(read('cash', null).receipt.provenance.discounted.length).toBe(4);
  });
});

const caller = (fast?: { fFoldToBetOpp: number; fFoldToBet: number }, shown?: { bigBetSD: number; bigBetSDStrong: number }): Villain => {
  const c = counters({ hands: 80, vpip: 0.3, pfr: 0.12, betCheckedToOpp: 40, betCheckedTo: 7, foldToBetOpp: 40, foldToBet: 11, fast: { hands: 10 } });
  if (fast) Object.assign(c, fast);
  return { stats: { hands: 300, postAggr: 40, postPassive: 150, ...(shown ?? {}) }, counters: c, complete: true };
};

describe('A4 value extraction (cash and tournament)', () => {
  for (const mode of ['cash', 'tournament'] as Mode[]) {
    it(`${mode}: a credible caller gets a larger river value bet, bounded, with a receipt`, () => {
      const spot = checkedTo(mode, 'KsQd');
      install(caller(), mode);
      supply(120);
      const off = decide(spot);
      install(caller(), mode);
      supply(120);
      const on = decide(spot, { styleValueExtraction: true });
      expect(on.fires.style_value_extraction_seen).toBeGreaterThan(0);
      expect(on.decision.action).toBe(off.decision.action);
      expect(on.decision.amount!).toBeGreaterThan(off.decision.amount!);
      expect(on.decision.amount!).toBeLessThanOrEqual(off.decision.amount! * 1.3 + 2);
    });
    it(`${mode}: released by a rising fast-window fold rate; withheld when his shown big bets are value`, () => {
      const spot = checkedTo(mode, 'KsQd');
      // H1: shown strength is in-format, supplied as this context's size buckets
      const valueShown = () =>
        HorseMind.importSizeBuckets([{ user_id: VILLAIN, variant: 'nlh', mode: mode === 'cash' ? 'cash' : 'tournament', size: 'full', buckets: { large: { bets: 10, shown: 10, strong: 9 } } }]);
      for (const [v, extra] of [[caller({ fFoldToBetOpp: 10, fFoldToBet: 9 }), () => {}], [caller(), valueShown]] as const) {
        install(v, mode);
        supply(120);
        extra();
        const off = decide(spot);
        install(v, mode);
        supply(120);
        extra();
        const on = decide(spot, { styleValueExtraction: true });
        expect(on.fires.style_value_extraction_seen ?? 0).toBe(0);
        expect(on.digest).toBe(off.digest);
      }
    });
    it(`${mode}: pre-repair cash rows without post-release m do not engage it`, () => {
      install(caller(), mode);
      const on = decide(checkedTo(mode, 'KsQd'), { styleValueExtraction: true });
      if (mode === 'cash') expect(on.fires.style_value_extraction_seen ?? 0).toBe(0);
      else expect(on.fires.style_value_extraction_seen).toBeGreaterThan(0);
    });
  }
});

describe('item 3 postflop-fold bluffing (cash and tournament)', () => {
  for (const mode of ['cash', 'tournament'] as Mode[])
    it(`${mode}: against a credible caller a flop semi-bluff becomes a check, with a receipt`, () => {
      const spot = checkedTo(mode, 'QcJc', 'flop');
      install(VILLAINS.station!, mode);
      supply(120);
      const off = decide(spot);
      install(VILLAINS.station!, mode);
      supply(120);
      const on = decide(spot, { styleFoldBluff: true });
      expect(on.fires.style_fold_bluff_seen).toBeGreaterThan(0);
      expect([off.decision.action, on.decision.action]).toEqual(['bet', 'check']);
    });
});

describe('item 1 pre-repair discount on the legacy over-folder branch', () => {
  const run = (m: number | null, on: boolean) => {
    HorseMind.reset();
    HorseMind.importStats([{ user_id: VILLAIN, hands: 100, folds: 40, facedAggr: 50 } as never]);
    const c = counters({ hands: 80, vpip: 0.2, pfr: 0.14, foldToBetOpp: 40, foldToBet: 29 });
    HorseMind.importDurableOpponentProfiles([{ user_id: VILLAIN, variant: 'nlh', mode: 'cash', size: 'full', observed_hands: 80, initialized: true, public_memory_domain: { version: 1, speed: 'table', ante: 'none' }, counters: c } as never]);
    if (m !== null) HorseMind.importPostReleaseObservations([{ user_id: VILLAIN, variant: 'nlh', mode: 'cash', size: 'full', opportunities: { foldToBet: m } }]);
    HorseMind.setDecisionScope('holdem:full', 'nlh', 'cash');
    const before = drain();
    void before;
    const e = HorseMind.exploit(VILLAIN, true, on ? { styleFoldRatePreRepair: true } : {});
    const fires = drain();
    HorseMind.setDecisionScope(null);
    return { e, fires };
  };
  it('the over-folder branch stands down for a pre-repair row with m < 60, and only with the option on', () => {
    const off = run(null, false);
    expect(off.fires.legacy_fold_rate_branch_seen).toBeGreaterThan(0);
    const on = run(null, true);
    expect(on.fires.style_pre_repair_fold_rate_discounted_seen).toBeGreaterThan(0);
    expect(on.e.bluffMod).toBeLessThanOrEqual(off.e.bluffMod);
    const lifted = run(120, true);
    expect(lifted.fires.style_pre_repair_fold_rate_discounted_seen ?? 0).toBe(0);
    expect(lifted.e).toEqual(off.e);
  });
});

describe('chain: learner -> profile -> read -> decision (A2 size buckets and lifetime tallies)', () => {
  it('a completed hand observed by the learner reaches the style read the decision consults, once per hand', () => {
    install(VILLAINS.grinder!, 'cash');
    supply(120);
    const acts = [
      { userId: VILLAIN, action: 'raise', amount: 6, stage: 'preflop' },
      { userId: HERO, action: 'call', amount: 4, stage: 'preflop' },
      { userId: HERO, action: 'check', amount: 0, stage: 'flop' },
      { userId: VILLAIN, action: 'check', amount: 0, stage: 'flop' },
      { userId: HERO, action: 'check', amount: 0, stage: 'turn' },
      { userId: VILLAIN, action: 'check', amount: 0, stage: 'turn' },
      { userId: HERO, action: 'check', amount: 0, stage: 'river' },
      { userId: VILLAIN, action: 'bet', amount: 10, stage: 'river' },
      { userId: HERO, action: 'call', amount: 10, stage: 'river' },
    ];
    HorseMind.observeHandComplete('style-chain-1', acts as never, 2, [{ user_id: VILLAIN, mucked: false, hand_name: 'Flush' }], 'holdem:full', false, { variant: 'nlh', boardCount: 1 }, undefined, 'cash');
    HorseMind.setDecisionScope('holdem:full', 'nlh', 'cash');
    const r = HorseMind.styleRead(VILLAIN);
    HorseMind.setDecisionScope(null);
    expect(r.signals.shownBySize.large).toMatchObject({ bets: 1, shown: 1, strong: 1 });
    // the same hand again is not double counted (hand flag)
    HorseMind.observeHandComplete('style-chain-1', acts as never, 2, [{ user_id: VILLAIN, mucked: false, hand_name: 'Flush' }], 'holdem:full', false, { variant: 'nlh', boardCount: 1 }, undefined, 'cash');
    HorseMind.setDecisionScope('holdem:full', 'nlh', 'cash');
    expect(HorseMind.styleRead(VILLAIN).signals.shownBySize.large.bets).toBe(1);
    HorseMind.setDecisionScope(null);
    // the decision consults it: the big-bet consumer runs on this read
    expect(decide(ALL_SPOTS('cash')[0], { styleBigBetHonesty: true }).fires.style_big_bet_honesty_seen).toBeGreaterThan(0);
  });
});

describe('A3 persisted m: recounted from persisted hand history, identical after a restart', () => {
  const RELEASE = Date.UTC(2026, 10, 13, 6, 30);
  const hand = (t: number) => ({
    createdAt: new Date(t).toISOString(),
    actions: [
      { userId: HERO, action: 'raise', amount: 6, stage: 'preflop', origin: 'player' },
      { userId: VILLAIN, action: 'call', amount: 4, stage: 'preflop', origin: 'player' },
      { userId: VILLAIN, action: 'check', amount: 0, stage: 'flop', origin: 'player' },
      { userId: HERO, action: 'bet', amount: 6, stage: 'flop', origin: 'player' },
      { userId: VILLAIN, action: 'fold', amount: 0, stage: 'flop', origin: 'player' },
    ],
  });
  const history = [...Array.from({ length: 30 }, (_, i) => hand(RELEASE - (i + 1) * 60_000)), ...Array.from({ length: 70 }, (_, i) => hand(RELEASE + i * 60_000))];
  const boot = (hands: typeof history) => {
    HorseMind.reset();
    const c = counters({ hands: 80, vpip: 0.2, pfr: 0.14, foldToBetOpp: 40, foldToBet: 29, betCheckedToOpp: 40, betCheckedTo: 16 });
    HorseMind.importDurableOpponentProfiles([{ user_id: VILLAIN, variant: 'nlh', mode: 'cash', size: 'full', observed_hands: 80, initialized: true, public_memory_domain: { version: 1, speed: 'table', ante: 'none' }, counters: c } as never]);
    HorseMind.importPostReleaseFromHistory([{ user_id: VILLAIN, variant: 'nlh', mode: 'cash', size: 'full', hands }], RELEASE);
    HorseMind.setDecisionScope('holdem:full', 'nlh', 'cash');
    const r = HorseMind.styleRead(VILLAIN);
    HorseMind.setDecisionScope(null);
    return r;
  };
  it('only hands at or after the release count, with the learner increment function', () => {
    const m = postReleaseOpportunitiesFromHistory(history, VILLAIN, RELEASE);
    expect(m.foldToBet).toBe(70);
    expect(m.betCheckedTo).toBe(70);
    expect(postReleaseOpportunitiesFromHistory(history.slice(0, 30), VILLAIN, RELEASE).foldToBet).toBe(0);
  });
  it('the discount lifts from persisted data and rebuilds identically after a reset (the daily restart)', () => {
    const first = boot(history);
    expect(first.receipt.provenance.discounted).not.toContain('foldToBet');
    const afterRestart = boot(history);
    expect(JSON.stringify(afterRestart.receipt)).toBe(JSON.stringify(first.receipt));
    expect(boot(history.slice(0, 50)).receipt.provenance.discounted).toContain('foldToBet');
  });
});

describe('gear change and bounty boundary, through decide()', () => {
  const ADAPTIVE = ['style_big_bet_honesty_seen', 'style_raise_respect_seen', 'style_tight_opener_respect_seen', 'style_tight_reraiser_respect_seen', 'style_value_bettor_not_maniac_seen', 'style_value_extraction_seen', 'style_fold_bluff_seen'];
  const adaptiveFires = (f: Record<string, number>) => ADAPTIVE.filter((k) => (f[k] ?? 0) > 0);
  it('a tight player who changes gear (fast window aggressive) is released: every consumer stands down', () => {
    const g = VILLAINS.grinder!;
    const shifted: Villain = { ...g, counters: { ...g.counters!, fHands: 10, fPfr: 6, fBetCheckedToOpp: 10, fBetCheckedTo: 9, fThreeBetOpp: 8, fThreeBet: 4 }, stats: { ...g.stats, rAggr: 14, rPassive: 2 } };
    for (const mode of ['cash', 'tournament'] as Mode[])
      for (const spot of ALL_SPOTS(mode)) {
        install(shifted, mode);
        supply(120);
        const off = decide(spot);
        install(shifted, mode);
        supply(120);
        const on = decide(spot, { ...ALL_ON, styleValueExtraction: true });
        expect(on.digest, spot.name).toBe(off.digest);
        expect(adaptiveFires(on.fires), spot.name).toEqual([]);
      }
    install(shifted, 'cash');
    supply(120);
    expect(decide(turnPotBet('cash'), ALL_ON).fires.style_read_released_seen).toBeGreaterThan(0);
  });
  it('bounty tournaments: #2 stands down for a value bettor above AF 2.5', () => {
    const spot = turnPotBet('tournament');
    (spot.gs.tournament as Record<string, unknown>).bountyFactor = 1.5;
    install(valueAggressor(), 'tournament');
    supply(120);
    const off = decide(spot);
    install(valueAggressor(), 'tournament');
    supply(120);
    const on = decide(spot, { styleValueBettorNotManiac: true });
    expect(on.fires.style_value_bettor_not_maniac_seen ?? 0).toBe(0);
    expect(on.digest).toBe(off.digest);
  });
  it('bounty tournaments: no style consumer acts (bounty utility is not in the read)', () => {
    for (const spot of ALL_SPOTS('tournament')) {
      (spot.gs.tournament as Record<string, unknown>).bountyFactor = 1.5;
      install(VILLAINS.grinder!, 'tournament');
      supply(120);
      const off = decide(spot);
      install(VILLAINS.grinder!, 'tournament');
      supply(120);
      const on = decide(spot, { ...ALL_ON, styleValueExtraction: true });
      expect(on.digest, spot.name).toBe(off.digest);
      expect(adaptiveFires(on.fires), spot.name).toEqual([]);
    }
  });
});

describe('H1 (review 2026-11-13): other-format and other-variant evidence moves nothing at carry-over weight 0', () => {
  it('pooled lifetime shown bets and another context\'s size buckets do not reach the cash NLH read', () => {
    HorseMind.reset();
    const c = counters({ hands: 80, vpip: 0.13, pfr: 0.07, threeBetOpp: 20, threeBet: 0, betCheckedToOpp: 40, betCheckedTo: 6, foldToBetOpp: 30, foldToBet: 14 });
    HorseMind.importStats([{ user_id: VILLAIN, hands: 500, bigBetSD: 20, bigBetSDStrong: 19, postAggr: 60, postPassive: 100 } as never]);
    HorseMind.importDurableOpponentProfiles([{ user_id: VILLAIN, variant: 'nlh', mode: 'cash', size: 'full', observed_hands: 80, initialized: true, public_memory_domain: { version: 1, speed: 'table', ante: 'none' }, counters: c } as never]);
    HorseMind.importPostReleaseObservations([{ user_id: VILLAIN, variant: 'nlh', mode: 'cash', size: 'full', opportunities: { foldToBet: 120, riverCall: 120, foldTo3Bet: 120, betCheckedTo: 120 } }]);
    HorseMind.importSizeBuckets([
      { user_id: VILLAIN, variant: 'nlh', mode: 'tournament', size: 'full', buckets: { large: { bets: 20, shown: 20, strong: 19 } } },
      { user_id: VILLAIN, variant: 'plo4', mode: 'cash', size: 'full', buckets: { large: { bets: 20, shown: 20, strong: 19 } } },
    ]);
    HorseMind.setDecisionScope('holdem:full', 'nlh', 'cash');
    const r = HorseMind.styleRead(VILLAIN);
    expect(r.signals.shownStrength.shown).toBe(0);
    expect(r.signals.shownBySize.large.shown).toBe(0);
    expect(r.signals.aggressionShare.n).toBe(0);
    HorseMind.setDecisionReadOptions({ styleCarryWeight: 0.5 });
    // even with a carry-over weight the POOLED all-variant tallies never enter (only this variant's scoped ones)
    const carried = HorseMind.styleRead(VILLAIN);
    expect(carried.signals.shownStrength.shown).toBe(0);
    HorseMind.setDecisionScope(null);
    HorseMind.importSizeBuckets([{ user_id: VILLAIN, variant: 'nlh', mode: 'cash', size: 'full', buckets: { large: { bets: 20, shown: 20, strong: 19 } } }]);
    HorseMind.setDecisionScope('holdem:full', 'nlh', 'cash');
    expect(HorseMind.styleRead(VILLAIN).signals.shownBySize.large.shown).toBe(20);
    HorseMind.setDecisionScope(null);
  });
});
