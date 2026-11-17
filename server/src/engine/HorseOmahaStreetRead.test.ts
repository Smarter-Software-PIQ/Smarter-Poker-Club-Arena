/**
 * The postflop read by street and flop texture (HorseOmahaStreetRead.ts): the reducer counts what it
 * says it counts, an unknown cell answers null, and a player who bets most unpaired flops and little
 * afterwards is not one label on every street.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Card } from '../types.js';
import type { ExploitHandAction } from './HorseOpponentExploit.js';
import {
  addStreetReadEvidence,
  copyStreetRead,
  emptyStreetRead,
  flopTextureOf,
  publicFlopOfHistory,
  streetLabel,
  streetReadCarriedFor,
  streetReadDecayAndAdd,
  streetReadFromRow,
  streetReadHandIncrements,
  streetReadRate,
  streetReadRow,
  validStreetRead,
  STREET_READ_DECAY,
  STREET_READ_MIN_OPPORTUNITIES,
  STREET_READ_ROW_LENGTH,
  type StreetReadCounters,
} from './HorseOmahaStreetRead.js';
import {
  decodeStreetReadLog,
  engineStreetReadIncrements,
} from './HorseOmahaStreetRead.test-support.js';
import { copyStreetCounters } from './HorseOpponentMemory.js';

const c = (rank: string, suit: string) => ({ rank, suit }) as unknown as Card;
const act = (userId: string, stage: string, action: string): ExploitHandAction => ({
  userId,
  stage,
  action,
  origin: 'player',
  isFullRaise: true,
});
const RAINBOW = [c('K', 'spades'), c('8', 'hearts'), c('3', 'clubs')];
const PAIRED = [c('8', 'spades'), c('8', 'hearts'), c('Q', 'clubs')];

describe('flopTextureOf', () => {
  it('classes the flop by pairing first, then suits', () => {
    expect(flopTextureOf(PAIRED)).toBe('paired');
    expect(flopTextureOf(RAINBOW)).toBe('rainbow');
    expect(flopTextureOf([c('K', 'spades'), c('8', 'spades'), c('3', 'clubs')])).toBe('twoTone');
    expect(flopTextureOf([c('K', 'spades'), c('8', 'spades'), c('3', 'spades')])).toBe('monotone');
    expect(flopTextureOf([c('8', 'spades'), c('8', 'hearts'), c('8', 'spades')])).toBe('paired');
  });
  it('is null without three known flop cards', () => {
    expect(flopTextureOf(null)).toBeNull();
    expect(flopTextureOf([c('K', 'spades')])).toBeNull();
  });
  it('reads only the first three cards', () => {
    expect(flopTextureOf([...RAINBOW, c('K', 'hearts')])).toBe('rainbow');
  });
});

describe('streetReadHandIncrements', () => {
  it('counts a continuation bet for the last preflop raiser on that texture only', () => {
    const inc = streetReadHandIncrements(
      [
        act('h', 'preflop', 'raise'),
        act('w', 'preflop', 'raise'),
        act('h', 'preflop', 'call'),
        act('h', 'flop', 'check'),
        act('w', 'flop', 'bet'),
        act('h', 'flop', 'fold'),
      ],
      RAINBOW
    );
    const w = inc.get('w')!;
    expect(w.cbet.rainbow).toEqual({ hit: 1, opp: 1 });
    expect(w.flopBet.rainbow).toEqual({ hit: 1, opp: 1 });
    expect(w.cbet.paired).toEqual({ hit: 0, opp: 0 });
    expect(w.bet.flop).toEqual({ hit: 1, opp: 1 });
    const h = inc.get('h')!;
    // h checked with no bet out: a bet opportunity not taken, and not a continuation-bet opportunity.
    expect(h.bet.flop).toEqual({ hit: 0, opp: 1 });
    expect(h.cbet.rainbow).toEqual({ hit: 0, opp: 0 });
    expect(h.foldToBet.flop).toEqual({ hit: 1, opp: 1 });
  });
  it('separates folding to a raise from folding to a bet', () => {
    const inc = streetReadHandIncrements(
      [
        act('w', 'preflop', 'raise'),
        act('h', 'preflop', 'call'),
        act('w', 'flop', 'bet'),
        act('h', 'flop', 'raise'),
        act('w', 'flop', 'fold'),
      ],
      PAIRED
    );
    const w = inc.get('w')!;
    expect(w.foldToRaise.flop).toEqual({ hit: 1, opp: 1 });
    expect(w.foldToBet.flop).toEqual({ hit: 0, opp: 0 });
    expect(w.cbet.paired).toEqual({ hit: 1, opp: 1 });
    expect(inc.get('h')!.foldToBet.flop).toEqual({ hit: 0, opp: 1 });
  });
  it('keeps streets apart and gives one opportunity per cell per hand', () => {
    const inc = streetReadHandIncrements(
      [
        act('w', 'preflop', 'raise'),
        act('h', 'preflop', 'call'),
        act('w', 'flop', 'bet'),
        act('h', 'flop', 'call'),
        act('w', 'turn', 'check'),
        act('h', 'turn', 'bet'),
        act('w', 'turn', 'raise'),
        act('h', 'turn', 'raise'),
        act('w', 'turn', 'call'),
        act('w', 'river', 'check'),
        act('h', 'river', 'check'),
      ],
      RAINBOW
    );
    const w = inc.get('w')!;
    expect(w.bet.flop).toEqual({ hit: 1, opp: 1 });
    expect(w.bet.turn).toEqual({ hit: 0, opp: 1 });
    expect(w.bet.river).toEqual({ hit: 0, opp: 1 });
    expect(w.foldToBet.turn).toEqual({ hit: 0, opp: 1 });
    expect(w.foldToRaise.turn).toEqual({ hit: 0, opp: 1 });
    const h = inc.get('h')!;
    expect(h.bet.turn).toEqual({ hit: 1, opp: 1 });
    expect(h.foldToRaise.turn).toEqual({ hit: 0, opp: 1 });
  });
  it('ignores forced and unattributed actions, as the pooled counters do', () => {
    const inc = streetReadHandIncrements(
      [
        { userId: 'w', stage: 'flop', action: 'fold', origin: 'forced' },
        { userId: 'w', stage: 'flop', action: 'fold' },
        { stage: 'flop', action: 'bet', origin: 'player' },
      ],
      RAINBOW
    );
    expect(inc.size).toBe(0);
  });
  it('without a flop keeps the street cells and leaves the texture cells empty', () => {
    const inc = streetReadHandIncrements([act('w', 'flop', 'bet')], null);
    const w = inc.get('w')!;
    expect(w.bet.flop).toEqual({ hit: 1, opp: 1 });
    expect(w.flopBet.rainbow.opp + w.flopBet.paired.opp).toBe(0);
  });
});

describe('rates and labels', () => {
  const grow = (flopBets: number, flopOpp: number, turnBets: number, turnOpp: number) => {
    const row = emptyStreetRead();
    row.flopBet.rainbow = { hit: flopBets, opp: flopOpp };
    row.bet.flop = { hit: flopBets, opp: flopOpp };
    row.bet.turn = { hit: turnBets, opp: turnOpp };
    return row;
  };
  const means = { bet: 0.35, foldToBet: 0.45 };
  it('an unknown cell answers null', () => {
    expect(streetReadRate({ hit: 3, opp: STREET_READ_MIN_OPPORTUNITIES - 1 }, 0.3)).toBeNull();
    expect(streetLabel(emptyStreetRead(), 'flop', 'rainbow', means)).toBeNull();
    expect(streetLabel(null, 'turn', null, means)).toBeNull();
  });
  it('a wide flop bettor who slows down is two different reads, not one', () => {
    const row = grow(30, 40, 4, 40);
    const flop = streetLabel(row, 'flop', 'rainbow', means)!;
    const turn = streetLabel(row, 'turn', null, means)!;
    expect(flop.valueLeader).toBe(false);
    expect(flop.betRatio).toBeGreaterThan(1.5);
    expect(turn.valueLeader).toBe(true);
    expect(turn.betRatio).toBeLessThan(0.6);
    // the texture he has not been seen on stays unknown
    expect(streetLabel(row, 'flop', 'paired', means)).toBeNull();
  });
  it('shrinks toward the prior with few opportunities', () => {
    const r = streetReadRate({ hit: 8, opp: 8 }, 0.35)!;
    expect(r.rate).toBeCloseTo((8 + 6 * 0.35) / 14, 10);
  });
  it('a cell ages only on a hand that gave it an opportunity', () => {
    const row = emptyStreetRead();
    row.bet.flop = { hit: 5, opp: 10 };
    row.bet.turn = { hit: 2, opp: 10 };
    const inc = emptyStreetRead();
    inc.bet.flop = { hit: 1, opp: 1 };
    streetReadDecayAndAdd(row, inc);
    expect(row.bet.turn).toEqual({ hit: 2, opp: 10 });
    expect(row.bet.flop.opp).toBeLessThan(11);
    expect(row.bet.flop.opp).toBeGreaterThan(10);
    expect(validStreetRead(row)).toBe(true);
  });
  it('refuses a malformed stored row', () => {
    const bad = emptyStreetRead();
    bad.bet.flop = { hit: 3, opp: 1 };
    expect(validStreetRead(bad)).toBe(false);
    expect(validStreetRead({})).toBe(false);
    expect(streetLabel(bad, 'flop', null, means)).toBeNull();
  });
});

// ───────────── the durable record: the stored shape, the wire row, the add rule, the history flop ─────────────

/** A row with every cell learned (hit below opp), distinct per cell. */
function fullRow(): StreetReadCounters {
  const r = emptyStreetRead();
  let i = 0;
  for (const group of [r.bet, r.foldToBet, r.foldToRaise, r.cbet, r.flopBet])
    for (const cell of Object.values(group)) {
      cell.opp = 9 + i;
      cell.hit = 1 + i / 2;
      i++;
    }
  return r;
}

describe('the stored street read', () => {
  it('is valid only in its exact shape: five statistics, their streets or textures, cells of hit and opp', () => {
    expect(validStreetRead(emptyStreetRead())).toBe(true);
    expect(validStreetRead(fullRow())).toBe(true);
    const cases: Array<(r: Record<string, any>) => void> = [
      (r) => delete r.cbet,
      (r) => (r.extra = {}),
      (r) => delete r.bet.turn,
      (r) => (r.bet.preflop = { hit: 0, opp: 0 }),
      (r) => (r.flopBet.wet = { hit: 0, opp: 0 }),
      (r) => delete r.foldToBet.river.opp,
      (r) => (r.foldToRaise.flop.note = 1),
      (r) => (r.bet.flop.hit = '1'),
      (r) => (r.bet.flop.opp = null),
      (r) => (r.bet.flop.hit = -1),
      (r) => (r.bet.flop.hit = r.bet.flop.opp + 1),
      (r) => (r.cbet.paired.opp = Number.POSITIVE_INFINITY),
      (r) => (r.cbet.paired.hit = Number.NaN),
      (r) => (r.bet = []),
    ];
    for (const spoil of cases) {
      const r = JSON.parse(JSON.stringify(fullRow()));
      spoil(r);
      expect(validStreetRead(r), spoil.toString()).toBe(false);
    }
    for (const junk of [null, undefined, 7, 'x', [], {}]) expect(validStreetRead(junk)).toBe(false);
  });

  it('a profile copy keeps a well-formed record detached, keeps null and absent apart, and drops a malformed one', () => {
    const record = fullRow();
    const kept = copyStreetCounters({ street_counters: record });
    expect(kept).toEqual({ street_counters: record });
    expect(kept.street_counters).not.toBe(record);
    expect(kept.street_counters!.bet).not.toBe(record.bet);
    expect(copyStreetCounters({ street_counters: null })).toEqual({ street_counters: null });
    expect(copyStreetCounters({})).toEqual({});
    expect(copyStreetCounters({ street_counters: { bet: {} } })).toEqual({});
    expect(copyStreetCounters({ street_counters: 'x' })).toEqual({});
  });

  it('travels as 34 numbers and comes back the same; a row that is not one is refused', () => {
    const record = fullRow();
    const row = streetReadRow(record);
    expect(row).toHaveLength(STREET_READ_ROW_LENGTH);
    expect(streetReadFromRow(row)).toEqual(record);
    expect(streetReadFromRow(row.slice(1))).toBeNull();
    expect(streetReadFromRow([...row, 0])).toBeNull();
    const hitAboveOpp = [...row];
    hitAboveOpp[0] = hitAboveOpp[1]! + 1;
    expect(streetReadFromRow(hitAboveOpp)).toBeNull();
    expect(streetReadFromRow(row.map((x, i) => (i === 5 ? -1 : x)))).toBeNull();
    expect(copyStreetRead(record)).toEqual(record);
  });

  it('adds one hand: only a cell the hand gave an opportunity ages; a hand with none returns the base itself', () => {
    const base = fullRow();
    const inc = emptyStreetRead();
    inc.bet.turn = { hit: 1, opp: 1 };
    inc.foldToBet.river = { hit: 0, opp: 1 };
    const before = JSON.stringify(base);
    const out = addStreetReadEvidence(base, inc)!;
    expect(JSON.stringify(base)).toBe(before);
    expect(out).not.toBe(base);
    expect(out.bet.turn.opp).toBeCloseTo(base.bet.turn.opp * STREET_READ_DECAY + 1, 12);
    expect(out.bet.turn.hit).toBeCloseTo(base.bet.turn.hit * STREET_READ_DECAY + 1, 12);
    expect(out.foldToBet.river.opp).toBeCloseTo(
      base.foldToBet.river.opp * STREET_READ_DECAY + 1,
      12
    );
    expect(out.foldToBet.river.hit).toBeCloseTo(base.foldToBet.river.hit * STREET_READ_DECAY, 12);
    expect(out.bet.flop).toEqual(base.bet.flop);
    expect(out.cbet).toEqual(base.cbet);
    expect(addStreetReadEvidence(base, emptyStreetRead())).toBe(base);
    expect(addStreetReadEvidence(base, null)).toBe(base);
    expect(addStreetReadEvidence(null, emptyStreetRead())).toBeNull();
    expect(addStreetReadEvidence(null, null)).toBeNull();
    expect(addStreetReadEvidence(null, inc)).toEqual(inc);
  });

  it('is carried for the Omaha family only', () => {
    for (const v of ['plo4', 'plo5', 'plo6', 'plo8', 'flo8', 'PLO4'])
      expect(streetReadCarriedFor(v)).toBe(true);
    for (const v of ['nlh', 'flh', 'short_deck', 'pineapple', '', null, undefined])
      expect(streetReadCarriedFor(v)).toBe(false);
  });
});

describe('publicFlopOfHistory', () => {
  it('reads the flop as the history writes it', () => {
    expect(publicFlopOfHistory(['Qspades', 'Aspades', 'Qclubs', '8diamonds', 'Qhearts'])).toEqual([
      { rank: 'Q', suit: 'spades' },
      { rank: 'A', suit: 'spades' },
      { rank: 'Q', suit: 'clubs' },
    ]);
    expect(flopTextureOf(publicFlopOfHistory(['Tspades', '9spades', '2spades']))).toBe('monotone');
  });
  it('is null without three well-written cards', () => {
    for (const cc of [
      null,
      undefined,
      'Qspades',
      [],
      ['Qspades', 'Aspades'],
      ['10spades', 'Aspades', 'Qclubs'],
      ['Qs', 'As', 'Qc'],
      ['Qspades', null, 'Qclubs'],
      ['Qspades', 7, 'Qclubs'],
    ])
      expect(publicFlopOfHistory(cc)).toBeNull();
  });
  it('is null when a second board has its own flop, and stands when the second board shares it or is empty', () => {
    const flop = ['Kspades', '8hearts', '3clubs'];
    expect(publicFlopOfHistory(flop, ['Qspades', 'Qhearts', '2clubs'])).toBeNull();
    expect(publicFlopOfHistory(flop, ['Kspades', '8hearts'])).toBeNull();
    expect(publicFlopOfHistory(flop, [...flop, 'Aspades'])).not.toBeNull();
    expect(publicFlopOfHistory(flop, [])).not.toBeNull();
    expect(publicFlopOfHistory(flop, null)).not.toBeNull();
  });
});

// ───────────── the hands the database reducer is compared on (scripts/ci/test-horse-exact-public-memory.py) ─────────────

interface VectorFile {
  named: Array<{
    name: string;
    actions: unknown[];
    community_cards: unknown;
    community_cards2: unknown;
    expected: Record<string, string>;
  }>;
  random: Array<{
    log: string;
    community_cards: unknown;
    community_cards2: unknown;
    expected: Record<string, string>;
  }>;
  chain: { steps: string[]; checkpoints: Array<{ after: number; row: number[] | null }> };
}
const vectors: VectorFile = JSON.parse(
  readFileSync(
    resolve(process.cwd(), '..', 'scripts/ci/fixtures/horse-street-read-vectors.json'),
    'utf8'
  )
);
const flags = (actions: unknown, cc: unknown, cc2: unknown): Record<string, string> =>
  Object.fromEntries(
    [...engineStreetReadIncrements(actions, cc, cc2)].map(([id, r]) => [
      id,
      streetReadRow(r).join(''),
    ])
  );

describe('the pinned hands of horse-street-read-vectors.json', () => {
  it('the engine reducer gives the expected increments on every named hand', () => {
    expect(vectors.named.length).toBeGreaterThanOrEqual(11);
    for (const v of vectors.named)
      expect(flags(v.actions, v.community_cards, v.community_cards2), v.name).toEqual(v.expected);
  });

  it('named hands, derived by hand: the cells are what the names say', () => {
    const byName = (part: string) => vectors.named.find((v) => v.name.includes(part))!;
    const A = '00000000-0000-4000-8000-0000000000a1';
    const B = '00000000-0000-4000-8000-0000000000a2';
    const C = '00000000-0000-4000-8000-0000000000a3';
    const row = (digits: string) => streetReadFromRow(digits.split('').map(Number))!;
    const cbet = byName('bets a rainbow flop');
    expect(row(cbet.expected[A]!).cbet.rainbow).toEqual({ hit: 1, opp: 1 });
    expect(row(cbet.expected[A]!).flopBet.rainbow).toEqual({ hit: 1, opp: 1 });
    expect(row(cbet.expected[A]!).bet.flop).toEqual({ hit: 1, opp: 1 });
    expect(row(cbet.expected[B]!).foldToBet.flop).toEqual({ hit: 1, opp: 1 });
    expect(row(cbet.expected[B]!).flopBet.rainbow).toEqual({ hit: 0, opp: 1 });
    expect(row(cbet.expected[B]!).cbet.rainbow).toEqual({ hit: 0, opp: 0 });
    // hole cards written on the actions change nothing
    expect(byName('hole cards').expected).toEqual(cbet.expected);
    expect(byName('hole cards').actions.every((a) => 'holeCards' in (a as object))).toBe(true);
    const lead = byName('the caller leads');
    expect(row(lead.expected[B]!).flopBet.paired).toEqual({ hit: 1, opp: 1 });
    expect(row(lead.expected[B]!).cbet.paired).toEqual({ hit: 0, opp: 0 });
    expect(row(lead.expected[A]!).cbet.paired).toEqual({ hit: 0, opp: 0 });
    expect(row(lead.expected[A]!).bet.turn).toEqual({ hit: 1, opp: 1 });
    expect(row(lead.expected[B]!).foldToBet.turn).toEqual({ hit: 0, opp: 1 });
    expect(row(lead.expected[A]!).bet.river).toEqual({ hit: 0, opp: 1 });
    const raised = byName('raised and folds');
    expect(row(raised.expected[B]!).foldToRaise.flop).toEqual({ hit: 0, opp: 1 });
    expect(row(raised.expected[B]!).cbet.twoTone).toEqual({ hit: 1, opp: 1 });
    expect(row(raised.expected[A]!).foldToBet.flop).toEqual({ hit: 0, opp: 1 });
    expect(row(raised.expected[C]!).foldToBet.flop).toEqual({ hit: 0, opp: 1 });
    expect(row(raised.expected[C]!).foldToRaise.flop).toEqual({ hit: 0, opp: 1 });
    const forced = byName('teach nothing');
    expect(forced.expected[B]).toBeUndefined();
    expect(row(forced.expected[C]!).flopBet.monotone).toEqual({ hit: 0, opp: 1 });
    expect(row(forced.expected[C]!).foldToBet.flop).toEqual({ hit: 0, opp: 0 });
    expect(row(forced.expected[A]!).cbet.monotone).toEqual({ hit: 1, opp: 1 });
    const two = byName('two different flops');
    expect(row(two.expected[A]!).bet.flop).toEqual({ hit: 1, opp: 1 });
    expect(two.expected[A]!.slice(18)).toBe('0'.repeat(16));
    expect(two.expected[B]!.slice(18)).toBe('0'.repeat(16));
    expect(row(byName('shares the flop').expected[A]!).cbet.rainbow).toEqual({ hit: 0, opp: 1 });
    expect(byName('no flop cards').expected[A]!.slice(18)).toBe('0'.repeat(16));
    expect(byName('not written as the history').expected[A]!.slice(18)).toBe('0'.repeat(16));
    const skipped = byName('are skipped');
    expect(Object.keys(skipped.expected).sort()).toEqual([A, B]);
    expect(row(skipped.expected[A]!).flopBet.paired).toEqual({ hit: 0, opp: 1 });
    const reraise = byName('re-raiser');
    expect(row(reraise.expected[A]!).cbet.paired).toEqual({ hit: 0, opp: 0 });
    expect(row(reraise.expected[B]!).cbet.paired).toEqual({ hit: 0, opp: 1 });
    expect(row(reraise.expected[A]!).foldToRaise.turn).toEqual({ hit: 0, opp: 1 });
    expect(row(reraise.expected[A]!).foldToBet.river).toEqual({ hit: 1, opp: 1 });
  });

  it('the engine reducer gives the expected increments on every random public action log', () => {
    expect(vectors.random.length).toBeGreaterThanOrEqual(200);
    let learned = 0;
    for (const [i, v] of vectors.random.entries()) {
      const got = flags(decodeStreetReadLog(v.log), v.community_cards, v.community_cards2);
      expect(got, `random ${i}`).toEqual(v.expected);
      learned += Object.keys(got).length;
    }
    expect(learned).toBeGreaterThan(400);
  });

  it('the add rule reproduces every checkpoint of the chain', () => {
    const wanted = new Map(vectors.chain.checkpoints.map((c) => [c.after, c.row]));
    let chained: StreetReadCounters | null = null;
    vectors.chain.steps.forEach((digits, k) => {
      chained = addStreetReadEvidence(chained, streetReadFromRow(digits.split('').map(Number)));
      if (!wanted.has(k + 1)) return;
      const want = wanted.get(k + 1)!;
      if (want === null) expect(chained).toBeNull();
      else {
        const got = streetReadRow(chained!);
        expect(got).toHaveLength(want.length);
        got.forEach((x, i) => expect(Math.abs(x - want[i]!)).toBeLessThan(1e-12));
      }
    });
    expect(wanted.get(1)).toBeNull();
    expect(Math.max(...wanted.get(vectors.chain.steps.length)!)).toBeGreaterThan(5);
  });
});
