import { describe, expect, it } from 'vitest';
import { HorseMind } from '../engine/HorseMind.js';
import { opponentMemoryKey } from '../engine/HorseOpponentMemory.js';
import { leagueLearnStreetRead } from './HorseLeagueStreetRead.js';

const card = (rank: string, suit: string) => ({ rank, suit }) as never;
const BOARD = [
  card('K', 'spades'),
  card('8', 'hearts'),
  card('3', 'clubs'),
  card('2', 'diamonds'),
  card('9', 'spades'),
];

describe('the league learns the street read the way HorseMind reads it', () => {
  it("a hand adds each acting seat to the sandbox under the key omahaStreetReadOf reads; folds count as the player's", () => {
    const sandbox = HorseMind.createSandbox();
    const history = [
      { userId: 'a', stage: 'preflop', action: 'raise', isFullRaise: true },
      { userId: 'b', stage: 'preflop', action: 'call' },
      { userId: 'a', stage: 'flop', action: 'bet', isFullRaise: true },
      { userId: 'b', stage: 'flop', action: 'fold' },
    ];
    leagueLearnStreetRead(sandbox, history, BOARD, 'plo5', 'omaha:full');
    const a = sandbox.pooledStreetRead!.get(opponentMemoryKey('a', 'plo5', 'cash', 'full'))!;
    const b = sandbox.pooledStreetRead!.get(opponentMemoryKey('b', 'plo5', 'cash', 'full'))!;
    expect(a.bet.flop).toEqual({ hit: 1, opp: 1 });
    expect(a.cbet.rainbow).toEqual({ hit: 1, opp: 1 });
    // the fold has no origin in league history; it is admitted as the player's own
    expect(b.foldToBet.flop).toEqual({ hit: 1, opp: 1 });
    // a second hand decays and adds; a hand with no postflop action adds nothing
    leagueLearnStreetRead(sandbox, history, BOARD, 'plo5', 'omaha:full');
    expect(
      sandbox.pooledStreetRead!.get(opponentMemoryKey('a', 'plo5', 'cash', 'full'))!.bet.flop.opp
    ).toBeGreaterThan(1.9);
    const size = sandbox.pooledStreetRead!.size;
    leagueLearnStreetRead(sandbox, history.slice(0, 2), BOARD, 'plo5', 'omaha:full');
    expect(sandbox.pooledStreetRead!.size).toBe(size);
  });
  it('a game without an Omaha memory variant or a scope without a size learns nothing', () => {
    const sandbox = HorseMind.createSandbox();
    leagueLearnStreetRead(
      sandbox,
      [{ userId: 'a', stage: 'flop', action: 'bet' }],
      BOARD,
      'nope',
      'omaha:full'
    );
    leagueLearnStreetRead(
      sandbox,
      [{ userId: 'a', stage: 'flop', action: 'bet' }],
      BOARD,
      'plo5',
      'omaha'
    );
    expect(sandbox.pooledStreetRead).toBeUndefined();
  });
});
