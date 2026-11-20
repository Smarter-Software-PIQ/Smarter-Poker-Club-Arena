/**
 * Every Horse's dealt hole cards ride the accepted-hand stats payload
 * (migration 20261120014240). Horses only; a human's cards never enter it;
 * a card that does not read cleanly leaves its Horse out rather than guessed.
 */
import { describe, expect, it, vi } from 'vitest';
vi.mock('./client.js', () => ({
  supabase: {
    from: vi.fn(() => {
      throw Error('collectOnly must not touch the database');
    }),
    rpc: vi.fn(() => {
      throw Error('collectOnly must not touch the database');
    }),
  },
  maintenanceSupabase: {},
}));
vi.mock('../errorReporter.js', () => ({ reportError: vi.fn(), describeError: String }));
const { horseDealtHoleCards, dealtCardCode, writeHandFacts } = await import('./handFacts.js');

const H1 = '00000000-0000-4000-8000-0000000000a1';
const H2 = '00000000-0000-4000-8000-0000000000a2';
const P1 = '00000000-0000-4000-8000-0000000000b1';
const c = (rank: string, suit: string) => ({ rank, suit });

describe('horseDealtHoleCards', () => {
  it('reads cards as two characters', () => {
    expect(dealtCardCode(c('A', 'spades'))).toBe('As');
    expect(dealtCardCode(c('T', 'hearts'))).toBe('Th');
    expect(dealtCardCode(c('10', 'diamonds'))).toBe('Td');
    expect(dealtCardCode(c('q', 'c'))).toBe('Qc');
    for (const bad of [null, 'As', c('1', 'spades'), c('A', 'stars'), { rank: 'A' }])
      expect(dealtCardCode(bad)).toBeNull();
  });

  it('keeps Horses only, ordered by seat, and never a human', () => {
    const dealt = new Map<string, { seat: number; cards: unknown }>([
      [P1, { seat: 1, cards: [c('Q', 'spades'), c('Q', 'hearts')] }],
      [
        H2,
        { seat: 6, cards: [c('2', 'clubs'), c('3', 'clubs'), c('4', 'clubs'), c('5', 'clubs')] },
      ],
      [H1, { seat: 3, cards: [c('A', 'spades'), c('K', 'diamonds')] }],
    ]);
    const roster = [
      { userId: P1, isHorse: false },
      { userId: H1, isHorse: true },
      { userId: H2, isHorse: true },
    ];
    expect(horseDealtHoleCards(dealt, roster)).toEqual([
      { user_id: H1, seat: 3, cards: ['As', 'Kd'] },
      { user_id: H2, seat: 6, cards: ['2c', '3c', '4c', '5c'] },
    ]);
    // A seat missing from the roster, or flagged anything but true, is not a Horse.
    expect(horseDealtHoleCards(dealt, [{ userId: H1, isHorse: 1 as unknown as boolean }])).toEqual(
      []
    );
    expect(horseDealtHoleCards(dealt, [])).toEqual([]);
  });

  it('leaves a Horse out when its cards do not read cleanly', () => {
    const roster = [{ userId: H1, isHorse: true }];
    for (const cards of [
      [c('A', 'spades')],
      [c('A', 'spades'), c('A', 'spades')],
      [c('A', 'spades'), c('X', 'spades')],
      'AsKd',
      null,
    ])
      expect(horseDealtHoleCards(new Map([[H1, { seat: 2, cards }]]), roster)).toEqual([]);
    expect(
      horseDealtHoleCards(new Map([[H1, { seat: 11, cards: [c('A', 's'), c('K', 's')] }]]), roster)
    ).toEqual([]);
  });

  it('rides the accepted cash payload, free fold included, absent without a Horse', async () => {
    const base = {
      handId: '00000000-0000-4000-8000-00000000f001',
      tableId: '00000000-0000-4000-8000-00000000f002',
      clubId: '00000000-0000-4000-8000-00000000f003',
      handNumber: 7,
      gameVariant: 'nlh',
      bigBlind: 2,
      playedAt: '2026-11-19T12:00:00.000Z',
      buttonSeat: 1,
      rakeAmount: 0,
      boardLength: 0,
      holeCardsAll: new Map<string, { seat: number; cards: unknown }>([
        [P1, { seat: 1, cards: [c('Q', 'spades'), c('Q', 'hearts')] }],
        [H1, { seat: 2, cards: [c('A', 'spades'), c('K', 'diamonds')] }],
        [H2, { seat: 3, cards: [c('7', 'clubs'), c('2', 'hearts')] }],
      ]),
      contributions: new Map([
        [P1, 2],
        [H1, 1],
        [H2, 0],
      ]),
      winners: [{ userId: P1, amount: 3 }],
      actions: [{ userId: H2, action: 'fold', street: 'preflop', amount: 0 }] as never,
      roster: [
        { userId: P1, isHorse: false },
        { userId: H1, isHorse: true },
        { userId: H2, isHorse: true },
      ],
      collectOnly: true,
      horseHoleCardsAccepted: true,
    };
    const payload = (await writeHandFacts(base))!;
    expect(payload.horse_hole_cards).toEqual([
      { user_id: H1, seat: 2, cards: ['As', 'Kd'] },
      { user_id: H2, seat: 3, cards: ['7c', '2h'] },
    ]);
    // The free-folding Horse's fact row keeps no cards; the list does.
    expect(payload.facts.find((f) => f.user_id === H2)!.hole_cards).toBeNull();
    expect(JSON.stringify(payload.horse_hole_cards)).not.toContain(P1);

    const humansOnly = (await writeHandFacts({
      ...base,
      roster: base.roster.map((p) => ({ ...p, isHorse: false })),
    }))!;
    expect(humansOnly).not.toHaveProperty('horse_hole_cards');
  });

  it('review B1: the key is attached only where the installed retention basis accepts it', async () => {
    const base = {
      handId: '00000000-0000-4000-8000-00000000f011',
      tableId: '00000000-0000-4000-8000-00000000f012',
      clubId: '00000000-0000-4000-8000-00000000f013',
      handNumber: 8,
      gameVariant: 'nlh',
      bigBlind: 2,
      playedAt: '2026-11-19T12:00:00.000Z',
      buttonSeat: 1,
      rakeAmount: 0,
      boardLength: 0,
      holeCardsAll: new Map<string, { seat: number; cards: unknown }>([
        [P1, { seat: 1, cards: [c('Q', 'spades'), c('Q', 'hearts')] }],
        [H1, { seat: 2, cards: [c('A', 'spades'), c('K', 'diamonds')] }],
      ]),
      contributions: new Map([
        [P1, 1],
        [H1, 1],
      ]),
      winners: [{ userId: P1, amount: 2 }],
      actions: [] as never,
      roster: [
        { userId: P1, isHorse: false },
        { userId: H1, isHorse: true },
      ],
      collectOnly: true,
    };
    // unknown (absent) or refused (false): exactly the keys an older basis accepts
    for (const accepted of [undefined, false]) {
      const payload = (await writeHandFacts({ ...base, horseHoleCardsAccepted: accepted }))!;
      expect(Object.keys(payload).sort()).toEqual(['facts', 'transfers', 'version']);
    }
    const on = (await writeHandFacts({ ...base, horseHoleCardsAccepted: true }))!;
    expect(Object.keys(on).sort()).toEqual(['facts', 'horse_hole_cards', 'transfers', 'version']);
  });

  it('costs microseconds at hand commit (measured)', () => {
    const dealt = new Map<string, { seat: number; cards: unknown }>();
    const roster: Array<{ userId: string; isHorse: boolean }> = [];
    const suits = ['spades', 'hearts', 'diamonds', 'clubs'];
    for (let s = 1; s <= 9; s++) {
      const id = `00000000-0000-4000-8000-0000000000${String(s).padStart(2, '0')}`;
      dealt.set(id, {
        seat: s,
        cards: [0, 1, 2, 3, 4, 5].map((k) =>
          c('23456789TJQKA'[(s * 6 + k) % 13]!, suits[(s + k) % 4]!)
        ),
      });
      roster.push({ userId: id, isHorse: s !== 5 });
    }
    const n = 20_000;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) horseDealtHoleCards(dealt, roster);
    const us = ((performance.now() - t0) * 1000) / n;
    console.log(`[horseDealtHoleCards] 9 seats x 6 cards, 8 Horses: ${us.toFixed(2)} us per hand`);
    expect(us).toBeLessThan(500);
  });
});
