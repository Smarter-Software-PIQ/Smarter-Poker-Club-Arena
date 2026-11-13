import { afterEach, describe, expect, it, vi } from 'vitest';
import { HorseMind } from './HorseMind.js';
import { ALL_SPOTS, HERO, VILLAIN, VILLAINS, decide, install, preflopJam, preflopOpen, preflopThreeBet, turnPotBet, type Mode, type Villain } from './HorseOpponentStyle.contexts.test-support.js';
import { counters } from './HorseOpponentStyle.test-support.js';

const ALL_ON = { styleValueBettorNotManiac: true, styleBigBetHonesty: true, styleRaiseRespect: true, styleTightReRaiserRespect: true };
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
