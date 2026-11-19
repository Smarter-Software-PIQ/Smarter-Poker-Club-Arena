import { describe, expect, it } from 'vitest';
import { HorseMind } from '../engine/HorseMind.js';
import { omahaUnderpairNoDraw } from '../engine/HorseOmahaUnderpair.js';
import {
  leagueDealtCards,
  leaguePairHandClock,
  playHand,
  runMatchup,
  type LeagueMatchup,
} from './HorseLeague.js';
import { HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID } from './HorseLeagueHumanField.js';
import {
  LEAGUE_SPOT_NOTE,
  leagueSpotProbe,
  leagueSpotReached,
  validateLeagueSpotSelection,
  type LeagueSpotPassObservation,
  type LeagueSpotPredicate,
  type LeagueSpotSelection,
} from './HorseLeagueSpotSelection.js';

const card = (rank: string, suit = 'h') => ({ rank, suit }) as never;
const UNDERPAIR_SPOT: LeagueSpotPredicate = {
  street: 'flop',
  minLive: 3,
  actionsBefore: ['bet', 'call'],
  unpairedBoard: true,
};

describe('spot predicate on the public state', () => {
  const hand = (board: string[], flop: Array<[number, string, number]>) => ({
    board: board.map((r) => card(r)),
    cards: [],
    events: [
      { seatIdx: 0, stage: 'preflop', action: 'raise', liveBefore: 6 },
      ...flop.map(([seatIdx, action, liveBefore]) => ({
        seatIdx,
        stage: 'flop',
        action,
        liveBefore,
      })),
    ],
  });
  it('holds only where a subject faces a bet then a call, three or more live, on an unpaired flop', () => {
    const all = () => true;
    const h = hand(
      ['K', '9', '4', '2'],
      [
        [1, 'bet', 4],
        [2, 'call', 4],
        [3, 'fold', 4],
      ]
    );
    expect(leagueSpotReached(UNDERPAIR_SPOT, h, all)).toBe(true);
    // Only seat 3 faced the bet and the call: a hero-only subject elsewhere is not there.
    expect(leagueSpotReached(UNDERPAIR_SPOT, h, (s) => s === 1)).toBe(false);
    expect(leagueSpotReached(UNDERPAIR_SPOT, h, (s) => s === 3)).toBe(true);
    // Paired flop, too few live, call before the bet, no flop: not there.
    expect(
      leagueSpotReached(
        UNDERPAIR_SPOT,
        hand(
          ['K', 'K', '4'],
          [
            [1, 'bet', 4],
            [2, 'call', 4],
            [3, 'fold', 4],
          ]
        ),
        all
      )
    ).toBe(false);
    expect(
      leagueSpotReached(
        UNDERPAIR_SPOT,
        hand(
          ['K', '9', '4'],
          [
            [1, 'bet', 2],
            [2, 'call', 2],
          ]
        ),
        all
      )
    ).toBe(false);
    expect(
      leagueSpotReached(
        UNDERPAIR_SPOT,
        hand(
          ['K', '9', '4'],
          [
            [1, 'check', 4],
            [2, 'call', 4],
            [3, 'call', 4],
          ]
        ),
        all
      )
    ).toBe(false);
    expect(
      leagueSpotReached(
        UNDERPAIR_SPOT,
        hand(
          [],
          [
            [1, 'bet', 4],
            [2, 'call', 4],
            [3, 'fold', 4],
          ]
        ),
        all
      )
    ).toBe(false);
    // An alternative list matches any of its actions.
    expect(
      leagueSpotReached(
        { ...UNDERPAIR_SPOT, actionsBefore: [['bet', 'raise'], 'call'] },
        hand(
          ['K', '9', '4'],
          [
            [1, 'raise', 4],
            [2, 'call', 4],
            [3, 'fold', 4],
          ]
        ),
        all
      )
    ).toBe(true);
  });
  it('refuses a malformed rule', () => {
    const ok: LeagueSpotSelection = { name: 'x', predicate: UNDERPAIR_SPOT, mode: 'filter' };
    expect(() => validateLeagueSpotSelection(ok)).not.toThrow();
    expect(() => validateLeagueSpotSelection({ ...ok, name: '' })).toThrow('name');
    expect(() =>
      validateLeagueSpotSelection({
        ...ok,
        predicate: { ...UNDERPAIR_SPOT, street: 'preflop' as never },
      })
    ).toThrow('street');
    expect(() =>
      validateLeagueSpotSelection({
        ...ok,
        predicate: { ...UNDERPAIR_SPOT, actionsBefore: ['shove'] },
      })
    ).toThrow('unknown action');
    expect(() =>
      validateLeagueSpotSelection({ ...ok, predicate: { ...UNDERPAIR_SPOT, pairedBoard: true } })
    ).toThrow('paired and unpaired');
    expect(() => validateLeagueSpotSelection({ ...ok, mode: 'all' as never })).toThrow('mode');
  });
});

/** Every kept deal: both passes (both arms) dealt exactly the probe's deal. */
function expectPaired(seen: LeagueSpotPassObservation[], kept: number[]) {
  for (const c of kept) {
    const probe = seen.find((o) => o.candidate === c && o.pass === 'probe_b')!;
    const p1 = seen.find((o) => o.candidate === c && o.pass === 'pass1')!;
    const p2 = seen.find((o) => o.candidate === c && o.pass === 'pass2')!;
    expect(probe && p1 && p2).toBeTruthy();
    for (const o of [p1, p2]) {
      expect(o.handSeed).toBe(probe.handSeed);
      expect(o.dealerSeat).toBe(probe.dealerSeat);
      expect(o.cards).toEqual(probe.cards);
      const n = Math.min(o.board.length, probe.board.length);
      expect(o.board.slice(0, n)).toEqual(probe.board.slice(0, n));
      expect(n).toBeGreaterThanOrEqual(3); // the spot is on the flop: it was dealt
    }
  }
  // No unkept candidate was ever played as a pair.
  for (const o of seen)
    if (o.pass === 'pass1' || o.pass === 'pass2') expect(kept).toContain(o.candidate);
}

describe('spot probe', () => {
  it('stops early with the same answer a full hand gives, and deals what playHand deals', () => {
    let hits = 0;
    for (let c = 0; c < 40; c++) {
      const seed = (41_990_003 ^ (c * 2654435761)) >>> 0 || 1;
      const dealt = leagueDealtCards(seed, 'plo4', 6);
      const full: Array<{ seatIdx: number; stage: string; action: string; liveBefore: number }> =
        [];
      let end: { cards: unknown; board: unknown } | null = null;
      playHand(
        seed,
        (c % 6) + 1,
        () => ({}),
        undefined,
        HorseMind.createSandbox(),
        'plo4',
        6,
        100,
        undefined,
        undefined,
        undefined,
        undefined,
        false,
        {
          onAction: (e) => void full.push(e),
          onEnd: (e) => void (end = { cards: e.cards, board: e.board }),
        },
        leaguePairHandClock(c, 41_990_003)
      );
      expect(end!.cards).toEqual(dealt.holes);
      expect(end!.board).toEqual(dealt.board);
      const whole = leagueSpotReached(
        UNDERPAIR_SPOT,
        { events: full, board: dealt.board, cards: dealt.holes },
        () => true
      );
      const early = leagueSpotProbe(
        UNDERPAIR_SPOT,
        dealt,
        () => true,
        false,
        (observer) =>
          playHand(
            seed,
            (c % 6) + 1,
            () => ({}),
            undefined,
            HorseMind.createSandbox(),
            'plo4',
            6,
            100,
            undefined,
            undefined,
            undefined,
            undefined,
            false,
            observer as never,
            leaguePairHandClock(c, 41_990_003)
          )
      );
      expect(leagueSpotReached(UNDERPAIR_SPOT, early, () => true)).toBe(whole);
      expect(early.reached).toBe(whole);
      expect(early.events.length).toBeLessThanOrEqual(full.length);
      if (whole) hits++;
      // The optional subject hole class: only holders count, and a deal with none is not played.
      const flop = dealt.board.slice(0, 3);
      const holders = dealt.holes.flatMap((h, s) => (omahaUnderpairNoDraw(h, flop) ? [s] : []));
      let played = false;
      const classed = leagueSpotProbe(
        { ...UNDERPAIR_SPOT, subjectHoleClass: 'omaha_underpair_no_draw_flop' },
        dealt,
        () => true,
        false,
        (observer) => {
          played = true;
          playHand(
            seed,
            (c % 6) + 1,
            () => ({}),
            undefined,
            HorseMind.createSandbox(),
            'plo4',
            6,
            100,
            undefined,
            undefined,
            undefined,
            undefined,
            false,
            observer as never,
            leaguePairHandClock(c, 41_990_003)
          );
        }
      );
      const flopPaired = new Set(flop.map((x) => x.rank)).size < 3;
      if (!holders.length || flopPaired) expect(played).toBe(false);
      expect(classed.reached).toBe(
        leagueSpotReached(
          UNDERPAIR_SPOT,
          { events: full, board: dealt.board, cards: dealt.holes },
          (s) => holders.includes(s)
        )
      );
    }
    expect(hits).toBeGreaterThan(0);
  }, 120_000);
});

describe('spot-seeded league sessions', () => {
  it('mirror, filter: keeps only deals that reach the spot, plays both arms on each, and records the rule', async () => {
    const seen: LeagueSpotPassObservation[] = [];
    const matchup: LeagueMatchup = {
      name: 'spot_unit_mirror',
      variant: 'plo4',
      seats: 6,
      stackBB: 100,
      a: { omahaUnderpairNoMultiwayFlopContinue: true },
      b: {},
      spot: {
        name: 'underpair_flop_bet_call',
        predicate: UNDERPAIR_SPOT,
        mode: 'filter',
        observe: (o) => seen.push(o),
      },
    };
    const r = await runMatchup(matchup, 24, 41_990_001);
    const sel = r.spotSelection!;
    expect(sel).toMatchObject({
      name: 'underpair_flop_bet_call',
      rule: UNDERPAIR_SPOT,
      mode: 'filter',
      probe: 'b',
      subject: 'any_horse_seat',
      candidatesDealt: 24,
      exhausted: false,
      note: LEAGUE_SPOT_NOTE,
    });
    expect(sel.ruleDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(sel.kept).toBe(sel.keptCandidates.length);
    expect(sel.kept).toBeGreaterThan(0);
    expect(sel.kept).toBeLessThan(24);
    expect(r.hands).toBe(sel.kept * 2);
    expect(r.illegalActions).toBe(0);
    expectPaired(seen, sel.keptCandidates);
    // An unselected card carries no selection record.
    const plain = await runMatchup({ ...matchup, spot: undefined }, 2, 41_990_001);
    expect(plain.spotSelection).toBeUndefined();
  }, 300_000);

  it('human field, redeal: deals until the requested pairs reach the hero spot, both arms on the same deals', async () => {
    const seen: LeagueSpotPassObservation[] = [];
    const r = await runMatchup(
      {
        name: 'spot_unit_field',
        variant: 'plo4',
        seats: 6,
        stackBB: 100,
        a: { omahaUnderpairNoMultiwayFlopContinue: true },
        b: {},
        opponentPopulation: HUMAN_CALIBRATED_OMAHA_DEV_POPULATION_ID,
        spot: {
          name: 'hero_flop_facing_bet',
          predicate: { street: 'flop', actionsBefore: ['bet'] },
          mode: 'redeal',
          maxCandidatesPerPair: 40,
          observe: (o) => seen.push(o),
        },
      },
      3,
      41_990_002
    );
    const sel = r.spotSelection!;
    expect(sel.subject).toBe('hero');
    expect(sel.kept).toBe(3);
    expect(r.hands).toBe(6);
    expect(sel.candidatesDealt).toBeGreaterThanOrEqual(3);
    expect([...sel.keptCandidates].sort((x, y) => x - y)).toEqual(sel.keptCandidates);
    expectPaired(seen, sel.keptCandidates);
  }, 300_000);
});
