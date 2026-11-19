import { afterEach, describe, expect, it, vi } from 'vitest';
import { HorseLogic } from '../engine/HorseLogic.js';
import { horseSwitchArms, parseHorseSwitchSet } from './HorseSwitchArms.js';
import { runTournamentLeague, tournamentRunCanPromote } from './HorseTournamentLeague.js';
import {
  resolveTournamentSwitchCard,
  summarizeTournamentSwitchPairs,
  tournamentSwitchStartingStacks,
  TOURNAMENT_SWITCH_RESERVED_SEEDS,
} from './HorseTournamentSwitchCard.js';

const BASE = {
  icmBustPaysPlace: true,
  omahaStrategyInTournaments: true,
  tournamentUtilityStackScaledMargin: true,
  styleFoldBluff: true,
};

describe('production switch sets as arms (HorseSwitchArms)', () => {
  it('reads a map, arms.json entries, an arms.json and live switch rows alike', () => {
    const entries = Object.entries(BASE);
    const fromMap = parseHorseSwitchSet(BASE).set;
    expect(parseHorseSwitchSet(entries).set).toEqual(fromMap);
    expect(parseHorseSwitchSet({ a: [], b: [...entries, ['telemetry', true]] })).toEqual({
      set: fromMap,
      ignored: ['telemetry'],
    });
    expect(
      parseHorseSwitchSet(entries.map(([option, v]) => ({ option, state: v ? 'on' : 'off' }))).set
    ).toEqual(fromMap);
    expect(Object.keys(fromMap)).toEqual([...Object.keys(BASE)].sort());
  });

  it('refuses an unknown name, a parameter, a duplicate, a non-boolean, an off-only on and a shadow row', () => {
    expect(() => parseHorseSwitchSet({ notAnOption: true })).toThrow('not a registered switch');
    expect(() => parseHorseSwitchSet({ decisionTimeMs: true })).toThrow('not a registered switch');
    expect(() =>
      parseHorseSwitchSet([
        ['icmBustPaysPlace', true],
        ['icmBustPaysPlace', false],
      ])
    ).toThrow('given twice');
    expect(() => parseHorseSwitchSet({ icmBustPaysPlace: 'on' })).toThrow('not a boolean');
    expect(() => parseHorseSwitchSet({ nashPushFoldIcm: true })).toThrow('off-only');
    expect(() => parseHorseSwitchSet([{ option: 'styleFoldBluff', state: 'shadow' }])).toThrow(
      'not on or off'
    );
  });

  it('builds A = B with only the flag changed, and refuses identical arms', () => {
    const arms = horseSwitchArms(BASE, 'icmBustPaysPlace');
    expect(arms.candidateValue).toBe(false);
    expect(arms.b).toEqual(parseHorseSwitchSet(BASE).set);
    expect({ ...arms.a, icmBustPaysPlace: true }).toEqual(arms.b);
    expect(horseSwitchArms(BASE, 'icmBustPaysPlace').digest).toBe(arms.digest);
    expect(() => horseSwitchArms(BASE, 'icmBustPaysPlace', true)).toThrow('arm A equals arm B');
    expect(() => horseSwitchArms(BASE, 'v24Bounty')).toThrow('declare the candidate value');
    const absent = horseSwitchArms(BASE, 'v24Bounty', false);
    expect(absent.baseValue).toBeUndefined();
    expect(absent.a.v24Bounty).toBe(false);
    expect('v24Bounty' in absent.b).toBe(false);
    expect(() => horseSwitchArms(BASE, 'nashPushFoldIcm', true)).toThrow('off-only');
  });
});

describe('whole-tournament switch card', () => {
  afterEach(() => vi.restoreAllMocks());

  it('deals uneven starting stacks from the seed alone, total unchanged', () => {
    for (const n of [3, 6, 18]) {
      const s = tournamentSwitchStartingStacks(46600001, n, 'uneven');
      expect(s.reduce((a, b) => a + b, 0)).toBe(2000 * n);
      expect(new Set(s).size).toBe(n);
      expect(Math.min(...s)).toBe(500);
      expect(s).toEqual(tournamentSwitchStartingStacks(46600001, n, 'uneven'));
      expect(tournamentSwitchStartingStacks(46600001, n, 'equal')).toEqual(Array(n).fill(2000));
    }
    expect(tournamentSwitchStartingStacks(46600001, 18, 'uneven')).not.toEqual(
      tournamentSwitchStartingStacks(46600002, 18, 'uneven')
    );
  });

  it('refuses reserved seeds, flag cards, promotion and an unknown variant', () => {
    const card = { name: 't', variant: 'nlh' as const, flag: 'icmBustPaysPlace', base: BASE };
    for (const seed of TOURNAMENT_SWITCH_RESERVED_SEEDS)
      expect(() => resolveTournamentSwitchCard({ switchCard: card, seed, pairs: 1 })).toThrow(
        'Reserved'
      );
    expect(() =>
      resolveTournamentSwitchCard({ switchCard: card, flagCard: 'x', seed: 46600001, pairs: 1 })
    ).toThrow('cannot be combined');
    expect(() =>
      resolveTournamentSwitchCard({
        switchCard: card,
        evidenceMode: 'promotion',
        seed: 46600001,
        pairs: 1,
      })
    ).toThrow('cannot be combined');
    expect(() =>
      resolveTournamentSwitchCard({
        switchCard: { ...card, variant: 'plo6' as never },
        seed: 46600001,
        pairs: 1,
      })
    ).toThrow('variant');
  });

  it('summarizes the per-pair prize and bounty differences with their standard errors', () => {
    const pair = (i: number, c: number, r: number, cb = 0, rb = 0) => ({
      index: i,
      candidate: c + cb,
      reference: r + rb,
      candidatePrize: c,
      referencePrize: r,
      candidateBounty: cb,
      referenceBounty: rb,
      heroStartStack: 2000,
    });
    const s = summarizeTournamentSwitchPairs(
      [pair(0, 0.5, 0, 0.1, 0), pair(1, 0, 0.5, 0, 0.2), pair(2, 0.3, 0.3)],
      true,
      4,
      9
    );
    expect(s.pairs).toBe(3);
    expect(s.prizeShare.mean).toBeCloseTo(0, 12);
    expect(s.bountyShare!.mean).toBeCloseTo(-0.1 / 3, 12);
    expect(s.prizeShare.standardError).toBeCloseTo(Math.sqrt(0.5 / 2 / 3), 12);
    expect(summarizeTournamentSwitchPairs([], false, 0, 0).bountyShare).toBeNull();
  });

  it('plays every Horse on the base, only the hero on arm A, both tournaments from the same deal and stacks', async () => {
    const seen: Array<{
      user: string;
      flag: unknown;
      keys: string;
      stacks: string;
      cards: string;
    }> = [];
    const real = HorseLogic.decide.bind(HorseLogic);
    vi.spyOn(HorseLogic, 'decide').mockImplementation(((...args: Parameters<typeof real>) => {
      const [player, gs, , , opts] = args;
      const o = (opts ?? {}) as Record<string, unknown>;
      seen.push({
        user: String((player as { user_id: string }).user_id),
        flag: o.icmBustPaysPlace,
        keys: Object.keys(BASE)
          .filter((k) => k !== 'icmBustPaysPlace')
          .map((k) => `${k}=${String(o[k])}`)
          .join(','),
        stacks: JSON.stringify(gs.tournament?.stackByUser ?? {}),
        cards: JSON.stringify((player as { cards: unknown }).cards),
      });
      return real(...args);
    }) as never);
    const r = await runTournamentLeague({
      objective: 'spin',
      seed: 46990001,
      pairs: 1,
      switchCard: {
        name: 'unit_spin_icm_bust',
        variant: 'nlh',
        flag: 'icmBustPaysPlace',
        base: BASE,
        startingStacks: 'uneven',
      },
    });
    expect(r.pairs).toBe(1);
    expect(r.illegalActions + r.conservationErrors + r.truncatedHands).toBe(0);
    expect(r.promotionEligible).toBe(false);
    expect(tournamentRunCanPromote(r)).toBe(false);
    expect(r.switchCard).toMatchObject({ flag: 'icmBustPaysPlace', candidateValue: false });
    expect(r.switchPairs).toHaveLength(1);
    expect(r.switchSummary!.fundedReturn.mean).toBeCloseTo(r.meanDifference, 12);
    expect(r.switchSummary!.decisionsCompared).toBeGreaterThan(0);
    // Every decision carries the rest of the base unchanged.
    const restOfBase = Object.keys(BASE)
      .filter((k) => k !== 'icmBustPaysPlace')
      .map((k) => `${k}=true`)
      .join(',');
    expect(seen.every((d) => d.keys === restOfBase)).toBe(true);
    // The hero (entrant 1 for pair 0) is the only seat that ever plays the flag off.
    const hero = 'phase8-league-1';
    expect(seen.filter((d) => d.flag === false).every((d) => d.user === hero)).toBe(true);
    expect(seen.some((d) => d.flag === false)).toBe(true);
    expect(seen.filter((d) => d.user !== hero).every((d) => d.flag === true)).toBe(true);
    // Both tournaments of the pair start from the same stacks and the same first deal.
    const firsts = seen.filter((d) => d.stacks === seen[0]!.stacks && d.cards === seen[0]!.cards);
    expect(firsts.length).toBeGreaterThanOrEqual(2); // the same seat, same hand 1, in A and in B
    expect(JSON.parse(seen[0]!.stacks)).not.toEqual({
      'phase8-league-1': 2000,
      'phase8-league-2': 2000,
      'phase8-league-3': 2000,
    });
  }, 300_000);
});
