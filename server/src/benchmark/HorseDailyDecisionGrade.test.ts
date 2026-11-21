import { describe, expect, it } from 'vitest';
import {
  buildReport,
  chicagoStamp,
  classTable,
  clusteredStat,
  compareReports,
  flagged,
  gameTable,
  gradeHand as gradeHandWith,
  horseHandClass,
  mostFrequentPerson,
  optionSetAt,
  parseCards,
  parseInstant,
  renderExcludedSql,
  renderHandsSql,
  renderMarkdown,
  renderSwitchSql,
  rollupKey,
  classKey,
  sizeBucket,
  timeSlices,
  utcIso,
  type GradedDecision,
  type RawAction,
  type RawHand,
  type SeatTuple,
} from './HorseDailyDecisionGrade.js';
import { insuranceEquity } from '../engine/InsuranceEquity.js';

const gradeHand = (h: RawHand) => gradeHandWith(h, insuranceEquity);
const CARDS_TABLE = 'private_schema.horse_cards_table';

const cards = (s: string) => parseCards(s)!;

/** seat tuple: [seat, behind, street wager, invested, dead, individual ante, flags (folded 1, all-in 2, sitting out 4)] */
const seat = (n: number, stack: number, sbet: number, inv: number, flags = 0): SeatTuple => [
  n,
  stack,
  sbet,
  inv,
  0,
  0,
  flags,
];
const act = (a: Partial<RawAction> & Pick<RawAction, 'seat' | 'stage' | 'action'>): RawAction => ({
  amount: 0,
  origin: 'horse_policy',
  pot: 0,
  toCall: 0,
  currentBet: 0,
  board: '',
  seats: [],
  ...a,
});

// Seat 1 a person ("vera"), seats 2 and 3 Horses. PLO4, blinds 1/2. River board As Td 6s 4c 9h.
const BOARD = 'AsTd6s4c9h';
function riverHand(over: Partial<RawHand> = {}): RawHand {
  return {
    id: 'h1',
    created_at: '2026-11-20T20:00:00Z',
    g: 'plo4',
    bb: 2,
    tournament: false,
    ltg: false,
    bomb: false,
    build: '26c2e74930dd0ec0',
    facts: [
      { uid: 'p', seat: 1, net: 60, net_bb: 30, invested: 60, horse: false, alias: 'vera' },
      { uid: 'h2', seat: 2, net: -20, net_bb: -10, invested: 20, horse: true, alias: 'slow_cocoa' },
      { uid: 'h3', seat: 3, net: -60, net_bb: -30, invested: 60, horse: true, alias: 'MrFox' },
    ],
    acts: [
      // the person bets 40 into 60 on the river
      act({
        seat: 1,
        stage: 'river',
        action: 'bet',
        amount: 40,
        origin: 'player',
        pot: 60,
        board: BOARD,
        seats: [seat(1, 200, 0, 20), seat(2, 200, 0, 20), seat(3, 200, 0, 20)],
      }),
      // Horse 2 folds top pair facing it
      act({
        seat: 2,
        stage: 'river',
        action: 'fold',
        pot: 100,
        toCall: 40,
        currentBet: 40,
        board: BOARD,
        seats: [seat(1, 160, 40, 60), seat(2, 200, 0, 20), seat(3, 200, 0, 20)],
      }),
      // Horse 3 calls and loses
      act({
        seat: 3,
        stage: 'river',
        action: 'call',
        amount: 40,
        pot: 100,
        toCall: 40,
        currentBet: 40,
        board: BOARD,
        seats: [seat(1, 160, 40, 60), seat(2, 200, 0, 20, 1), seat(3, 200, 0, 20)],
      }),
    ],
    horse_cards: [
      { uid: 'h2', seat: 2, cards: ['Ah', 'Kd', '7c', '2d'] },
      { uid: 'h3', seat: 3, cards: ['Ac', 'Tc', '3d', '2h'] },
    ],
    // the person showed a set of sixes
    shown: {
      p: [
        { rank: '6', suit: 'diamonds' },
        { rank: '6', suit: 'clubs' },
        { rank: 'K', suit: 'hearts' },
        { rank: 'Q', suit: 'hearts' },
      ],
    },
    ...over,
  };
}

describe('cards and classes come from the engine helpers', () => {
  it('parses the three stored card forms and refuses a broken or repeated card', () => {
    expect(cards('AsTd6s')).toEqual([
      { rank: 'A', suit: 'spades' },
      { rank: 'T', suit: 'diamonds' },
      { rank: '6', suit: 'spades' },
    ]);
    expect(parseCards(['As', 'Kd'])).toHaveLength(2);
    expect(parseCards([{ rank: '10', suit: 'hearts' }])).toEqual([{ rank: 'T', suit: 'hearts' }]);
    expect(parseCards(['As', 'Xx'])).toBeNull();
    expect(parseCards(['As', 'As'])).toBeNull();
    expect(parseCards(null)).toBeNull();
  });

  it('names the made hand and the draw', () => {
    expect(horseHandClass('plo4', cards('7s7hKdQc'), cards('7dAc2h'))).toBe('set');
    expect(horseHandClass('plo4', cards('AsKsQdJc'), cards('Ts9s2h'))).toMatch(/\+ nut draw$/);
    expect(horseHandClass('plo4', cards('AsKs3d2c'), cards('Qs7s2s8h4d'))).toBe('nut flush');
    expect(horseHandClass('nlh', cards('AsKh'), cards('Ad7c2h'))).toBe('pair');
    expect(horseHandClass('nlh', cards('AsKh'), cards('Qd7c2h9s3c'))).toBe('high card');
    expect(horseHandClass('plo4', cards('AsAhKsKh'), [])).toBe('preflop top 10%');
    expect(horseHandClass('nlh', cards('7s2h'), [])).toBe('preflop bottom 40%');
  });

  it('buckets a wager against the pot', () => {
    expect([0.25, 0.5, 1, 1.5, 0].map(sizeBucket)).toEqual([
      '<=33% pot',
      '34-66% pot',
      '67-100% pot',
      '>100% pot',
      'unknown size',
    ]);
  });
});

describe('grading one hand', () => {
  it('grades a fold on the shown cards and a call on its realised result', () => {
    const [fold, call] = gradeHand(riverHand());
    expect(fold).toMatchObject({
      action: 'fold',
      street: 'river',
      situation: 'facing 34-66% pot',
      cls: 'pair',
      persons: ['vera'],
      headsUp: false,
      basis: 'fold_showdown_equity',
    });
    // river, top pair against a shown set and Horse 3's two pair: equity 0, so the fold saved the 40 call = 20 bb
    expect(fold.lossBb).toBeCloseTo(-20, 6);
    expect(call).toMatchObject({ action: 'call', cls: 'top2p', basis: 'realised', headsUp: true });
    // net -60 with 20 already in before the call: the call itself lost 40 = 20 bb
    expect(call.lossBb).toBeCloseTo(20, 6);
  });

  it('leaves a fold ungraded when the person did not show (never guessed)', () => {
    const [fold] = gradeHand(riverHand({ shown: null }));
    expect(fold).toMatchObject({
      action: 'fold',
      lossBb: null,
      basis: null,
      ungraded: 'person_cards_not_shown',
    });
  });

  it('calls a fold exact when the call would end the betting, and prices a call for less', () => {
    const h = riverHand();
    // Horse 2 has only 10 behind: the call is all-in for 10 into 60 + 10 from the bettor
    h.acts![1].seats = [seat(1, 160, 40, 60), seat(2, 10, 0, 20), seat(3, 200, 0, 20, 1)];
    h.acts!.pop();
    h.horse_cards![0].cards = ['6h', '6c', '7c', '2d'];
    h.shown = {
      p: [
        { rank: 'A', suit: 'diamonds' },
        { rank: 'K', suit: 'clubs' },
        { rank: 'Q', suit: 'hearts' },
        { rank: 'J', suit: 'hearts' },
      ],
    };
    const [fold] = gradeHand(h);
    expect(fold.basis).toBe('fold_all_in_exact');
    // a set against one pair wins: 1 x (70 + 10) - 10 = 70 chips = 35 bb given up
    expect(fold.lossBb).toBeCloseTo(35, 6);
  });

  it('keeps an all-in bettor live (flag 2 is all-in, not folded) and leaves a sitting-out seat out', () => {
    const h = riverHand();
    // the person shoved: flags 2. Horse 3 already folded, a sitting-out seat 4 is not an opponent.
    h.acts![1].seats = [
      seat(1, 0, 40, 60, 2),
      seat(2, 200, 0, 20),
      seat(3, 200, 0, 20, 1),
      seat(4, 500, 0, 0, 4),
    ];
    h.acts!.pop();
    const [fold] = gradeHand(h);
    expect(fold).toMatchObject({ headsUp: true, basis: 'fold_all_in_exact', persons: ['vera'] });
    expect(fold.lossBb).toBeCloseTo(-20, 6); // top pair against the shown set: the fold saved the call
    // not shown: a heads-up fold to a person stays ungraded
    expect(gradeHand({ ...h, shown: null })[0]).toMatchObject({
      lossBb: null,
      ungraded: 'person_cards_not_shown',
    });
  });

  // The person shoved 40 on the river; Horse 3 already folded: Horse 2 is heads-up against an all-in person.
  function allInHand(over: Partial<RawHand> = {}): RawHand {
    const h = riverHand(over);
    h.acts![1].seats = [seat(1, 0, 40, 60, 2), seat(2, 200, 0, 20), seat(3, 200, 0, 20, 1)];
    h.acts!.pop();
    return h;
  }
  const SET_OF_SIXES = ['6d', '6c', 'Kh', 'Qh'];

  it("grades a heads-up fold to a person's all-in on the person's stored chips-in cards", () => {
    const [fold] = gradeHand(allInHand({ shown: null, allin_cards: { p: SET_OF_SIXES } }));
    expect(fold).toMatchObject({
      action: 'fold',
      headsUp: true,
      basis: 'fold_all_in_exact',
      personCards: 'chips_in_all_in',
      ungraded: null,
    });
    expect(fold.lossBb).toBeCloseTo(-20, 6); // top pair against the set: the fold saved the 40 call
    // the showdown, when there is one, stays the first source
    expect(gradeHand(allInHand())[0]).toMatchObject({ personCards: 'showdown' });
  });

  it('never reads a person who put no chips in, nor a Horse row, even if the rows came back', () => {
    const h = allInHand({ shown: null, allin_cards: { p: SET_OF_SIXES } });
    h.facts![0].invested = 0;
    expect(gradeHand(h)[0]).toMatchObject({ lossBb: null, ungraded: 'person_cards_not_shown' });
    // a Horse's uid in the map is dropped (Horse 2's own cards are not the person's)
    const k = allInHand({ shown: null, allin_cards: { h3: ['Ac', 'Tc', '3d', '2h'] } });
    expect(gradeHand(k)[0]).toMatchObject({ lossBb: null, ungraded: 'person_cards_not_shown' });
  });

  it('uses stored cards only heads-up against the all-in: not a live bet, not multiway', () => {
    // the person bet 40 with 160 behind (not all-in), heads-up: stays ungraded
    const live = allInHand({ shown: null, allin_cards: { p: SET_OF_SIXES } });
    live.acts![1].seats = [seat(1, 160, 40, 60), seat(2, 200, 0, 20), seat(3, 200, 0, 20, 1)];
    expect(gradeHand(live)[0]).toMatchObject({ lossBb: null, ungraded: 'person_cards_not_shown' });
    // all-in person but Horse 3 still live: multiway, stays ungraded
    const multi = allInHand({ shown: null, allin_cards: { p: SET_OF_SIXES } });
    multi.acts![1].seats = [seat(1, 0, 40, 60, 2), seat(2, 200, 0, 20), seat(3, 200, 0, 20)];
    expect(gradeHand(multi)[0]).toMatchObject({ lossBb: null, ungraded: 'person_cards_not_shown' });
  });

  it("grades a heads-up call of a person's all-in on its EV, not on the realised result", () => {
    const h = allInHand({ shown: null, allin_cards: { p: SET_OF_SIXES } });
    h.acts![1] = { ...h.acts![1], action: 'call', amount: 40 };
    const [call] = gradeHand(h);
    expect(call).toMatchObject({
      action: 'call',
      basis: 'call_all_in_exact',
      personCards: 'chips_in_all_in',
    });
    // equity 0 against the set: 0 x (100 + 40) - 40 = -40 chips of EV = 20 bb lost
    expect(call.lossBb).toBeCloseTo(20, 6);
  });

  // River: the person checks, Horse 3 (last to act, Horse 2 folded) bets 40 into 60, the person calls.
  function checkThenBet(over: Partial<RawHand> = {}): RawHand {
    const h = riverHand({
      final_board: ['Aspades', '10diamonds', '6spades', '4clubs', '9hearts'],
      ...over,
    });
    const s0 = [seat(1, 200, 0, 20), seat(2, 200, 0, 20, 1), seat(3, 200, 0, 20)];
    h.acts = [
      act({
        seat: 1,
        stage: 'river',
        action: 'check',
        origin: 'player',
        pot: 60,
        board: BOARD,
        seats: s0,
      }),
      act({ seat: 3, stage: 'river', action: 'bet', amount: 40, pot: 60, board: BOARD, seats: s0 }),
      act({
        seat: 1,
        stage: 'river',
        action: 'call',
        amount: 40,
        origin: 'player',
        pot: 100,
        toCall: 40,
        board: BOARD,
        seats: [seat(1, 200, 0, 20), seat(2, 200, 0, 20, 1), seat(3, 160, 40, 60)],
      }),
    ];
    return h;
  }

  it('grades an unopened bet against checking where the check would end the hand', () => {
    const [bet] = gradeHand(checkThenBet());
    expect(bet).toMatchObject({ action: 'bet', basis: 'bet_vs_check_river_exact', headsUp: true });
    // two pair against the shown set: checking wins 0 of 60, betting lost 40 more = 20 bb worse
    expect(bet.lossBb).toBeCloseTo(20, 6);
    expect(classKey(bet)).toBe('plo4 table | river | unopened 34-66% pot | bet vs check | top2p');
  });

  it('keeps a bet against giving up where the check is not knowable, and never reads stored cards for it', () => {
    // the person did not show (only stored chips-in cards): not knowable
    const [hidden] = gradeHand(checkThenBet({ shown: null, allin_cards: { p: SET_OF_SIXES } }));
    expect(hidden).toMatchObject({ basis: 'realised' });
    expect(classKey(hidden)).toContain('| bet vs give up |');
    // a run-it-twice hand has no single final board
    expect(gradeHand(checkThenBet({ rit: true }))[0]).toMatchObject({ basis: 'realised' });
    // the person had not acted yet: the check would not close the street
    const first = checkThenBet();
    first.acts!.shift();
    expect(gradeHand(first)[0]).toMatchObject({ basis: 'realised' });
  });

  it('grades an unopened Horse bet into a person, and skips decisions that face a Horse', () => {
    const h = riverHand();
    h.acts = [
      act({
        seat: 2,
        stage: 'turn',
        action: 'bet',
        amount: 30,
        pot: 60,
        board: 'AsTd6s4c',
        seats: [seat(1, 200, 0, 20), seat(2, 200, 0, 20), seat(3, 200, 0, 20)],
      }),
      act({
        seat: 3,
        stage: 'turn',
        action: 'fold',
        pot: 90,
        toCall: 30,
        currentBet: 30,
        board: 'AsTd6s4c',
        seats: [seat(1, 200, 0, 20), seat(2, 170, 30, 50), seat(3, 200, 0, 20)],
      }),
      act({
        seat: 1,
        stage: 'turn',
        action: 'fold',
        origin: 'player',
        pot: 90,
        toCall: 30,
        currentBet: 30,
        board: 'AsTd6s4c',
        seats: [seat(1, 200, 0, 20), seat(2, 170, 30, 50), seat(3, 200, 0, 20, 1)],
      }),
    ];
    h.facts![1].net = 40;
    const ds = gradeHand(h);
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({
      action: 'bet',
      situation: 'unopened 34-66% pot',
      persons: ['vera'],
      basis: 'realised',
    });
    expect(ds[0].lossBb).toBeCloseTo(-30, 6); // net +40 with 20 sunk: +60 from the decision point = 30 bb won
  });

  it('labels preflop wagers and grades a preflop fold only when it is all-in', () => {
    const h = riverHand();
    h.acts = [
      act({
        seat: 1,
        stage: 'preflop',
        action: 'raise',
        amount: 7,
        origin: 'player',
        pot: 3,
        toCall: 2,
        board: '',
        seats: [seat(1, 200, 0, 0), seat(2, 199, 1, 1), seat(3, 198, 2, 2)],
      }),
      act({
        seat: 2,
        stage: 'preflop',
        action: 'fold',
        pot: 10,
        toCall: 6,
        board: '',
        seats: [seat(1, 193, 7, 7), seat(2, 199, 1, 1), seat(3, 198, 2, 2)],
      }),
      act({
        seat: 3,
        stage: 'preflop',
        action: 'call',
        amount: 5,
        pot: 10,
        toCall: 5,
        board: '',
        seats: [seat(1, 193, 7, 7), seat(2, 199, 1, 1, 1), seat(3, 198, 2, 2)],
      }),
    ];
    const [fold, call] = gradeHand(h);
    expect(fold).toMatchObject({
      situation: 'facing open',
      ungraded: 'preflop_fold_not_all_in',
      lossBb: null,
    });
    expect(call).toMatchObject({ situation: 'facing open', action: 'call', basis: 'realised' });
  });

  it('grades nothing in a bomb pot, an unsupported game or a hand without a person', () => {
    expect(gradeHand(riverHand({ bomb: true }))).toEqual([]);
    expect(gradeHand(riverHand({ g: 'plo8' }))).toEqual([]);
    const h = riverHand();
    h.facts![0].horse = true;
    expect(gradeHand(h)).toEqual([]);
  });
});

describe('statistics', () => {
  it('clusters the standard error by hand', () => {
    const s = clusteredStat([
      { cluster: 'a', x: 1 },
      { cluster: 'a', x: 1 },
      { cluster: 'b', x: 3 },
      { cluster: 'c', x: -1 },
    ]);
    expect(s).toMatchObject({ n: 4, clusters: 3, total: 4, mean: 1 });
    // cluster residuals 0, 2, -2: sqrt(3/2 x 8) / 4
    expect(s.se).toBeCloseTo(Math.sqrt(12) / 4, 10);
    expect(clusteredStat([{ cluster: 'a', x: 5 }]).se).toBeNull();
    expect(clusteredStat([])).toMatchObject({ n: 0, se: null });
  });

  it('flags only a mean beyond 1 SE at n >= 10', () => {
    expect(flagged({ n: 10, clusters: 10, total: 30, mean: 3, se: 2 })).toBe(true);
    expect(flagged({ n: 9, clusters: 9, total: 27, mean: 3, se: 2 })).toBe(false);
    expect(flagged({ n: 10, clusters: 10, total: 30, mean: 3, se: 3 })).toBe(false);
    expect(flagged({ n: 10, clusters: 1, total: 30, mean: 3, se: null })).toBe(false);
    expect(flagged({ n: 50, clusters: 50, total: -100, mean: -2, se: 0.5 })).toBe(false);
  });

  const d = (
    hand: string,
    lossBb: number | null,
    person: string,
    over: Partial<GradedDecision> = {}
  ): GradedDecision => ({
    hand,
    game: 'plo5',
    pool: 'table',
    street: 'turn',
    situation: 'facing 67-100% pot',
    action: 'call',
    cls: 'pair',
    headsUp: true,
    persons: [person],
    lossBb,
    basis: lossBb === null ? null : 'realised',
    ungraded: lossBb === null ? 'no_result' : null,
    ...over,
  });

  it('ranks classes by total loss, keeps pools apart and finds the most frequent person', () => {
    const ds = [
      ...Array.from({ length: 12 }, (_, i) => d(`a${i}`, 4 + (i % 3), 'vera')),
      d('b1', 100, 'omar', { pool: 'Lightning' }),
      d('b2', null, 'omar'),
      d('c1', -9, 'omar', { action: 'fold' }),
    ];
    const rows = classTable(ds);
    expect(rows.map((r) => r.key)).toEqual([
      'plo5 Lightning | turn | facing 67-100% pot | call | pair',
      'plo5 table | turn | facing 67-100% pot | call | pair',
      'plo5 table | turn | facing 67-100% pot | fold | pair',
    ]);
    expect(rows[0]).toMatchObject({ n: 1, flagged: false });
    expect(rows[1]).toMatchObject({ n: 12, flagged: true, topPersonShare: 1 });
    expect(mostFrequentPerson(ds)).toEqual({ alias: 'vera', n: 12, share: 12 / 14 });
    expect(classTable(ds, rollupKey).map((r) => [r.key, r.n])).toEqual([
      ['plo5 Lightning | turn | call', 1],
      ['plo5 table | turn | call', 12],
      ['plo5 table | turn | fold', 1],
    ]);
  });

  it('reports bb/100 for people and for Horses per game and pool', () => {
    const rows = gameTable([
      riverHand(),
      riverHand({ id: 'h2', ltg: true }),
      riverHand({ id: 'h3', bomb: true }),
    ]);
    expect(rows.map((r) => [r.game, r.pool, r.hands])).toEqual([
      ['plo4', 'Lightning', 1],
      ['plo4', 'table', 1],
    ]);
    expect(rows[1].persons).toMatchObject({ n: 1, mean: 30 });
    expect(rows[1].horses).toMatchObject({ n: 2, mean: -20 });
  });
});

describe('the window, the statements and the option set', () => {
  it('reads a bare time as Chicago wall time and an offset as written', () => {
    expect(utcIso(parseInstant('2026-11-20T13:12'))).toBe('2026-11-20T19:12:00Z'); // CST, UTC-6
    expect(utcIso(parseInstant('2026-07-01T13:12:30'))).toBe('2026-07-01T18:12:30Z'); // CDT, UTC-5
    expect(utcIso(parseInstant('2026-11-20T19:12:44Z'))).toBe('2026-11-20T19:12:44Z');
    expect(chicagoStamp(Date.parse('2026-11-20T19:12:00Z'))).toBe('Nov 20, 2026, 1:12 PM Chicago');
    expect(() => parseInstant('yesterday')).toThrow();
  });

  it('slices a window and refuses an empty or oversized one', () => {
    const a = Date.parse('2026-11-20T19:00:00Z');
    expect(timeSlices(a, a + 40 * 60_000, 15)).toEqual([
      ['2026-11-20T19:00:00Z', '2026-11-20T19:15:00Z'],
      ['2026-11-20T19:15:00Z', '2026-11-20T19:30:00Z'],
      ['2026-11-20T19:30:00Z', '2026-11-20T19:40:00Z'],
    ]);
    expect(() => timeSlices(a, a, 15)).toThrow();
    expect(() => timeSlices(a, a + 9 * 86_400_000, 15)).toThrow();
  });

  it("renders single read-only statements that take a person's cards only from a showdown", () => {
    const sql = renderHandsSql('2026-11-20T19:12:44Z', '2026-11-20T19:27:44Z', CARDS_TABLE);
    expect(sql).toContain(
      "h.created_at >= '2026-11-20T19:12:44Z' and h.created_at < '2026-11-20T19:27:44Z'"
    );
    expect(sql).toContain('h.has_human is true');
    expect(sql).toContain("coalesce((s->>'mucked')::boolean, false) = false");
    // ca_hand_facts' cards: only a person (never a Horse) who put chips in AND went all-in
    expect(sql).toContain(
      'where f.hand_id = h.id and p.is_horse is not true and f.invested > 0 and f.was_all_in is true'
    );
    expect(sql.match(/f\.hole_cards/g)).toHaveLength(2); // the select and its not-null check, once
    const excluded = renderExcludedSql('2026-11-20T19:12:44Z', '2026-11-20T19:27:44Z');
    expect(excluded).toContain("h.game_variant not in ('nlh', 'plo4', 'plo5', 'plo6')");
    expect(excluded).toContain('h.has_human is true');
    expect(excluded).not.toContain(';');
    expect(sql).not.toMatch(/email/i);
    expect(sql).not.toContain(';');
    expect(sql).toContain('from private_schema.horse_cards_table c where c.hand_id = h.id');
    expect(() =>
      renderHandsSql('2026-11-20T19:12:44Z', '2026-11-20T19:27:44Z', 'x; drop')
    ).toThrow();
    expect(renderSwitchSql('2026-11-20T19:12:44Z')).toContain('ca_horse_style_switch_audit');
    expect(() =>
      renderHandsSql("2026-11-20T19:12:44Z'; drop table x; --", '2026-11-20T19:27:44Z', CARDS_TABLE)
    ).toThrow();
    expect(() => renderHandsSql('2026-11-20 19:12', '2026-11-20T19:27:44Z', CARDS_TABLE)).toThrow();
  });

  it('rolls the option rows back through the audit to the window', () => {
    const start = Date.parse('2026-11-20T19:00:00Z');
    const end = Date.parse('2026-11-20T21:00:00Z');
    const set = optionSetAt(
      [
        { option: 'a', state: 'on', updated_at: '2026-11-19T00:00:00Z' },
        { option: 'b', state: 'off', updated_at: '2026-11-20T20:13:00Z' },
        { option: 'c', state: 'on', updated_at: '2026-11-20T22:00:00Z' },
      ],
      [
        { option: 'b', old_state: null, new_state: 'on', changed_at: '2026-11-20T19:19:00Z' },
        { option: 'b', old_state: 'on', new_state: 'off', changed_at: '2026-11-20T20:13:00Z' },
        { option: 'c', old_state: 'off', new_state: 'on', changed_at: '2026-11-20T22:00:00Z' },
      ],
      start,
      end
    );
    expect(set.atEnd).toEqual({ a: 'on', b: 'off', c: 'off' });
    expect(set.atStartWhereDifferent).toEqual({ b: 'absent' });
    expect(set.changes.map((c) => c.new_state)).toEqual(['on', 'off']);
    expect(set.laterChanges).toBe(1);
  });
});

describe('the report', () => {
  const startMs = Date.parse('2026-11-20T19:12:44Z');
  const endMs = Date.parse('2026-11-20T21:00:00Z');
  const hands = [
    riverHand(),
    riverHand({ id: 'h1' }),
    riverHand({ id: 't1', tournament: true }),
    riverHand({ id: 'old', created_at: '2026-11-20T18:00:00Z' }),
  ];
  const report = buildReport({
    command: 'npx tsx scripts/horse-daily-decision-grade.ts --api',
    startMs,
    endMs,
    hands,
    switchRows: [{ option: 'a', state: 'on', updated_at: '2026-11-19T00:00:00Z' }],
    switchAudit: [],
    excluded: [
      { g: 'plo8', n: 3 },
      { g: 'flo8', n: 1 },
      { g: 'nlh', n: 9 },
    ],
    equity: insuranceEquity,
  });

  it('counts the variants left out, PLO8 by name', () => {
    expect(report.excludedVariants).toEqual({ flo8: 1, plo8: 3 });
    expect(renderMarkdown(report, null, null)).toContain(
      'Left out of grading explicitly (hands with a person dealt in): PLO8 3 (hi-lo split pots; high-only equity would misprice them); other variants: flo8 1.'
    );
  });

  it('keeps each hand once, inside the window, cash and tournament apart', () => {
    expect(report.hands).toBe(2);
    expect(report.sections.map((s) => [s.name, s.decisions, s.graded])).toEqual([
      ['cash', 2, 2],
      ['tournament', 2, 2],
    ]);
    expect(report.handsByBuild).toEqual({ '26c2e74930dd': 2 });
    expect(report.sections[0].topPerson?.alias).toBe('vera');
    expect(report.sections[0].classesExcludingTopPerson).toEqual([]);
  });

  it('prints aggregates only: no hole card, no hand id, the declared sign and the command', () => {
    const md = renderMarkdown(report, null, null);
    expect(md).toContain('Window: Nov 20, 2026, 1:12 PM Chicago to Nov 20, 2026, 3:00 PM Chicago');
    expect(md).toContain('`npx tsx scripts/horse-daily-decision-grade.ts --api`');
    expect(md).toContain('+ = the Horse lost bb');
    expect(md).toContain(
      '| 1 | plo4 table | river | facing 34-66% pot | call | top2p | 1 | 1 | +20.0 | +20.00 | n/a | 100% | no |'
    );
    expect(md).toContain('No previous report was found');
    expect(md).toContain(
      '| 1 | plo4 table | river | call | 1 | 1 | +20.0 | +20.00 | n/a | 100% | no |'
    );
    expect(md).not.toMatch(/\b(h1|t1)\b/);
    const json = JSON.stringify(report);
    expect(json).not.toMatch(/"cards"|"shown"|"horse_cards"|"allin_cards"|"final_board"|"hand":/);
  });

  it('says what changed against the previous report', () => {
    const flaggedRow = {
      key: 'k',
      n: 12,
      clusters: 12,
      total: 36,
      mean: 3,
      se: 1,
      flagged: true,
      topPersonShare: 0.5,
    };
    const prev = structuredClone(report);
    prev.sections[0].classes = [flaggedRow, { ...flaggedRow, key: 'gone' }];
    const cur = structuredClone(report);
    cur.sections[0].classes = [
      { ...flaggedRow, mean: 4 },
      { ...flaggedRow, key: 'new' },
      { ...flaggedRow, key: 'gone', flagged: false },
    ];
    const changes = compareReports(prev, cur);
    expect(changes.map((c) => [c.key, c.kind])).toEqual([
      ['new', 'newly flagged'],
      ['gone', 'no longer flagged'],
      ['k', 'still flagged'],
    ]);
    expect(renderMarkdown(cur, changes, 'REPORT-2026-11-19.json')).toContain(
      '| cash | new | newly flagged | absent | 12, +3.00 ± 1.00 |'
    );
  });
});
