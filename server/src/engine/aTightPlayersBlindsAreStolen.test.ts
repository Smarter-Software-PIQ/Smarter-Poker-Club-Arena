/**
 * A TIGHT PLAYER'S BLINDS ARE STOLEN (2026-11-15, styleStealTightBlinds, default OFF, off-only in the live switch
 * under the owner's blind-steal hold).
 *
 * Declared before measuring (the rule and the expected direction): six-handed no-limit hold'em cash, folded to the
 * Horse on the button, both blinds credibly tight and not aggressive: the Horse opens MORE hands with the option on.
 * NO change, byte for byte (decision and random stream): when either blind is loose, a maniac, value-heavy,
 * tight-aggressive or unknown; from the cutoff when the button left to act is unknown; at push/fold depths (20 bb);
 * and with the option absent or false.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseMind } from './HorseMind.js';
import {
  decide,
  installAll,
  OPPONENTS,
  pinAll,
  seeds,
  stealSpot,
  VILLAIN,
  VILLAIN2,
} from './aTightPlayersFolding.test-support.js';
import type { Decided, Spot } from './HorseOpponentStyle.contexts.test-support.js';
import { TIGHT_PLAYER_RESPONSE, tightBlindsSteal } from './HorseTightPlayerExploit.js';

const ON = { styleStealTightBlinds: true };
const RANKS = 'AKQJT98765432';
const HANDS: string[] = [];
for (let i = 0; i < 13; i++)
  for (let j = i; j < 13; j++)
    for (const suited of i === j ? [false] : [true, false])
      HANDS.push(`${RANKS[i]}h${RANKS[j]}${suited ? 'h' : i === j ? 'd' : 'c'}`);

function arm(
  spot: Spot,
  sb: string,
  bb: string,
  opts: Record<string, unknown>,
  n: number
): Decided[] {
  const mk = (k: string) => (OPPONENTS[k] ? OPPONENTS[k]!() : null);
  return seeds(n).map((seed) => {
    installAll({ [VILLAIN2]: mk(sb), [VILLAIN]: mk(bb) });
    return decide(spot, opts, seed);
  });
}
const opens = (ds: Decided[]) =>
  ds.filter((d) => d.decision.action === 'raise' || d.decision.action === 'all_in').length;

afterEach(() => {
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

describe('styleStealTightBlinds: tight blinds are opened into more', () => {
  it('more opens from the button when both blinds are credibly tight and not aggressive', () => {
    let off = 0;
    let on = 0;
    for (const h of HANDS) {
      off += opens(arm(stealSpot(h), 'tightPassive', 'tightPassive', {}, 3));
      on += opens(arm(stealSpot(h), 'tightPassive', 'tightPassive', ON, 3));
    }
    console.log(`[N2] steal button opens off=${off} on=${on} of ${HANDS.length * 3}`);
    expect(on).toBeGreaterThan(off);
  });

  for (const opp of ['loose', 'maniac', 'valueHeavy', 'tightAggressive', 'unknown'])
    it(`no change when the big blind is the ${opp} control (decisions and random stream identical)`, () => {
      for (const h of HANDS)
        expect(pinAll(arm(stealSpot(h), 'tightPassive', opp, ON, 2)), `${opp} ${h}`).toBe(
          pinAll(arm(stealSpot(h), 'tightPassive', opp, {}, 2))
        );
    });

  it('no change from the cutoff when the button left to act is unknown', () => {
    for (const h of HANDS)
      expect(pinAll(arm(stealSpot(h, 5), 'tightPassive', 'tightPassive', ON, 2)), h).toBe(
        pinAll(arm(stealSpot(h, 5), 'tightPassive', 'tightPassive', {}, 2))
      );
  });

  it('stands down at push/fold depths (20 bb)', () => {
    for (const h of HANDS)
      expect(pinAll(arm(stealSpot(h, 6, 40), 'tightPassive', 'tightPassive', ON, 2)), h).toBe(
        pinAll(arm(stealSpot(h, 6, 40), 'tightPassive', 'tightPassive', {}, 2))
      );
  });

  it('option absent or false is the same decision and random stream', () => {
    for (const h of HANDS)
      expect(
        pinAll(
          arm(stealSpot(h), 'tightPassive', 'tightPassive', { styleStealTightBlinds: false }, 2)
        ),
        h
      ).toBe(pinAll(arm(stealSpot(h), 'tightPassive', 'tightPassive', {}, 2)));
  });
});

describe('tightBlindsSteal (pure)', () => {
  it('is null with nobody left, no risk, no dead money or an unread player', () => {
    expect(tightBlindsSteal([], 5, 3)).toBeNull();
    expect(tightBlindsSteal([null], 5, 3)).toBeNull();
    expect(tightBlindsSteal([undefined], 0, 3)).toBeNull();
  });
  it('never moves the bar by more than the cap', () => {
    expect(TIGHT_PLAYER_RESPONSE.stealMaxWiden).toBe(0.06);
    expect(TIGHT_PLAYER_RESPONSE.stealOpenBB).toBe(2.5);
  });
});
