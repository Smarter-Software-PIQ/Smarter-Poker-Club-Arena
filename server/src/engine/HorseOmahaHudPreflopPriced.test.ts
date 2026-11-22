/** The priced preflop comparison at the maniac-pressure site (lane OPPONENT-HUD 2026-11-21). */
import { describe, expect, it } from 'vitest';
import type { Card } from '../types.js';
import { omahaHudPreflopPriced, type HudPreflopOpponent } from './HorseOmahaHudPreflopPriced.js';

const c = (s: string): Card =>
  ({
    rank: s[0],
    suit: ({ h: 'hearts', d: 'diamonds', c: 'clubs', s: 'spades' } as any)[s[1]],
  }) as Card;
const ACES = ['Ah', 'Ad', 'Ks', 'Kc', 'Qh'].map(c);
const TRASH = ['7h', '2d', '9s', '3c', '4h'].map(c);
const opp = (o: Partial<HudPreflopOpponent> = {}): HudPreflopOpponent => ({
  stack: 200,
  bet: 2,
  vpip: 0.4,
  pfr: 0.2,
  f3bet: 0.5,
  raised: false,
  ...o,
});
const spot = (hole: Card[], o: HudPreflopOpponent) => ({
  hole,
  dead: [],
  pot: 3,
  toCall: 1,
  heroBet: 1,
  stack: 199,
  raiseTo: 6,
  inPosition: true,
  canCall: true,
  canRaise: true,
  opponents: [o],
});

describe('omahaHudPreflopPriced', () => {
  it('a premium hand raises; a weak hand against a wide continuing range does not', () => {
    expect(omahaHudPreflopPriced(spot(ACES, opp()))!.action).toBe('raise');
    expect(omahaHudPreflopPriced(spot(TRASH, opp({ vpip: 0.9 })))!.action).not.toBe('raise');
  });
  it('the price reads only the measured inputs: an unknown extra field of the opponent changes nothing', () => {
    const calm = omahaHudPreflopPriced(spot(TRASH, opp({ vpip: 0.6 })))!;
    const other = omahaHudPreflopPriced(
      spot(TRASH, { ...opp({ vpip: 0.6 }), stab: 0.8 } as ReturnType<typeof opp>)
    )!;
    expect(other.evRaise).toBe(calm.evRaise);
    expect(other.evCall).toBe(calm.evCall);
  });
  it('facing no bet there is no fold: the check is the alternative', () => {
    const v = omahaHudPreflopPriced({ ...spot(TRASH, opp()), toCall: 0, heroBet: 2, pot: 4 })!;
    expect(v.action === 'fold').toBe(false);
  });
});
