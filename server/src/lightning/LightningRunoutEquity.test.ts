import { describe, expect, it, vi } from 'vitest';
import type { Card } from '../types.js';
import { priceLightningRunout, streetOfBoard, type RunoutPricer } from './LightningRunoutEquity.js';
import { lightningHandFactsInput } from './LightningHandFacts.js';

const c = (rank: string, suit: string) => ({ rank, suit }) as unknown as Card;
const A = { user_id: 'a', cards: [c('A', 's'), c('A', 'h')] };
const K = { user_id: 'k', cards: [c('K', 's'), c('K', 'h')] };
const flop = [c('2', 'd'), c('7', 'c'), c('9', 'h')];

describe('a Lightning runout carries its equity', () => {
  it('prices a heads-up runout into fractions keyed by player, on the board street', async () => {
    const price = vi.fn<RunoutPricer>(async () => [0.82, 0.18]);
    const eq = await priceLightningRunout(
      { players: [A, K], boards: [flop], variant: 'nlh' },
      price
    );
    expect(eq?.street).toBe('flop');
    expect(eq?.byUser.get('a')).toBeCloseTo(0.82);
    expect(eq?.byUser.get('k')).toBeCloseTo(0.18);
    expect(price).toHaveBeenCalledTimes(1);
    expect(price.mock.calls[0][4]).toMatchObject({
      exact: true,
      omaha: false,
      hiLo: false,
      shortDeck: false,
    });
  });

  it('averages every live board as an equal share, pricing each against the others as dead', async () => {
    const board2 = [c('3', 'd'), c('8', 'c'), c('T', 'h')];
    const price = vi.fn<RunoutPricer>(async (_h, b) => (b === flop ? [1, 0] : [0, 1]));
    const eq = await priceLightningRunout(
      { players: [A, K], boards: [flop, board2], variant: 'nlh' },
      price
    );
    expect(eq?.byUser.get('a')).toBeCloseTo(0.5);
    expect(price.mock.calls[0][2]).toEqual(board2);
    expect(price.mock.calls[1][2]).toEqual(flop);
  });

  it('maps live pots to eligible player indexes', async () => {
    const price = vi.fn<RunoutPricer>(async () => [0.5, 0.5]);
    await priceLightningRunout(
      {
        players: [A, K],
        boards: [flop],
        variant: 'plo4',
        pots: [
          { amount: 10, eligiblePlayers: ['k', 'a'] },
          { amount: 0, eligiblePlayers: ['a'] },
        ],
      },
      price
    );
    expect(price.mock.calls[0][4]).toMatchObject({
      omaha: true,
      pots: [{ amount: 10, eligible: [1, 0] }],
    });
  });

  it('gives no number for a hand nobody may hold, a missing opponent, a river runout or a failed price', async () => {
    const ok: RunoutPricer = async () => [0.5, 0.5];
    const three = { user_id: 'a', cards: [c('A', 's'), c('A', 'h'), c('2', 'c')] };
    expect(
      await priceLightningRunout(
        { players: [three, K], boards: [[]], variant: 'crazy_pineapple' },
        ok
      )
    ).toBeNull();
    expect(
      await priceLightningRunout(
        { players: [A, { user_id: 'k', cards: [] }], boards: [flop], variant: 'nlh' },
        ok
      )
    ).toBeNull();
    expect(
      await priceLightningRunout({ players: [A], boards: [flop], variant: 'nlh' }, ok)
    ).toBeNull();
    const river = [...flop, c('4', 's'), c('5', 's')];
    expect(
      await priceLightningRunout({ players: [A, K], boards: [river], variant: 'nlh' }, ok)
    ).toBeNull();
    expect(
      await priceLightningRunout({ players: [A, K], boards: [flop], variant: 'nlh' }, async () => {
        throw new Error('pool down');
      })
    ).toBeNull();
    expect(
      await priceLightningRunout({ players: [A, K], boards: [flop], variant: 'nlh' }, async () => [
        0.5,
      ])
    ).toBeNull();
    expect(
      await priceLightningRunout({ players: [A, K], boards: [flop], variant: 'nlh' }, async () => [
        Number.NaN,
        1,
      ])
    ).toBeNull();
  });

  it('names the street of the board it priced', () => {
    expect(streetOfBoard(0)).toBe('preflop');
    expect(streetOfBoard(3)).toBe('flop');
    expect(streetOfBoard(4)).toBe('turn');
  });

  it('the Lightning facts input carries the host price into the facts writer', () => {
    const allInEquity = { byUser: new Map([['a', 0.82]]), street: 'flop' };
    const input = lightningHandFactsInput({
      handId: 'h',
      hostTableId: 't',
      rules: { club_id: 'c', big_blind: 1, game_variant: 'nlh' },
      handNumber: 1,
      playedAtIso: new Date(0).toISOString(),
      buttonSeat: 1,
      rake: 0,
      board: flop,
      holeCards: new Map([
        ['a', { seat: 1, cards: A.cards }],
        ['k', { seat: 2, cards: K.cards }],
      ]),
      players: [
        { user_id: 'a', totalInvested: 10 },
        { user_id: 'k', totalInvested: 10 },
      ],
      stacksBefore: new Map([
        ['a', 10],
        ['k', 10],
      ]),
      allInRunoutWitness: null,
      allInEquity,
      winners: [],
      actions: [],
      participants: [
        { playerId: 'a', isHorse: false },
        { playerId: 'k', isHorse: true },
      ],
    });
    expect(input?.allInEquity).toBe(allInEquity);
  });
});
