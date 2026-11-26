/**
 * LAW (PLO lead-6 2026-11-24): five real PLO5 cash decisions from the decision audit of every PLO4/PLO5 hand with a
 * person (Nov 20-24), each a Horse facing a 3-bet or more whose cards were shown at showdown (only those cards are in
 * the fixture; seats anonymised). Replayed from the recorded public snapshot with production's live decide options
 * of 2026-11-24 (fixture liveOpts) and no opponent memory:
 *  - four out-of-position multiway calls of a 3-bet (the audit's leak 1, "call where fold was best"): main calls them,
 *    and with omahaReraisedPotCallIsPriced on each is a fold (its priced EV against the whole field is negative);
 *  - one out-of-position multiway call of a 4-bet with suited aces: with the options on it is never folded.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { stateAt, actionKind } from './HorseComplaintReplay.js';
import { RR_ON, RR_PROFILE } from './HorseOmahaReraisedPotPriced.test-support.js';

interface FixtureHand {
  audit: string;
  ord: number;
  expect: 'fold' | 'continue';
  variant: string;
  bigBlind: number;
  smallBlind: number;
  buttonSeat: number;
  publicMemoryDomain: unknown;
  players: Array<{ seat: number; userId: string; isHorse: boolean }>;
  hole: Record<string, unknown[]>;
  actions: Array<Record<string, unknown> & { ord: number }>;
}
const FIXTURE = JSON.parse(
  readFileSync(
    new URL('./HorseOmahaReraisedPotPriced.realHands.fixture.json', import.meta.url),
    'utf8'
  )
) as { hands: FixtureHand[]; liveOpts: HorseDecideOpts };
const LIVE: HorseDecideOpts = { ...FIXTURE.liveOpts };

afterEach(() => HorseMind.reset());

function kindAt(h: FixtureHand, opts: HorseDecideOpts, seed: number): string {
  const node = h.actions.find((a) => a.ord === h.ord)!;
  const { hero, gs, pn } = stateAt(
    {
      ...h,
      version: 1,
      slug: h.audit,
      title: '',
      complaint: '',
      handId: h.audit,
      fmt: 'cash',
      forbidden: [],
      seeds: [],
    } as never,
    node as never
  );
  HorseMind.reset();
  seedFastRandom(seed);
  const d = HorseLogic.decide(
    hero,
    JSON.parse(JSON.stringify(gs)),
    RR_PROFILE.style,
    { ...RR_PROFILE.mods },
    { observeMind: false, ...opts } as never
  );
  return actionKind(d.action, d.amount, pn);
}

describe('real audit hands facing a 3-bet or more', () => {
  it('the fixture holds five hands and only the deciding Horse cards', () => {
    expect(FIXTURE.hands).toHaveLength(5);
    for (const h of FIXTURE.hands) expect(Object.keys(h.hole)).toHaveLength(1);
  });
  for (const h of FIXTURE.hands)
    it(`${h.audit} (ord ${h.ord}): ${h.expect === 'fold' ? 'main calls, priced it folds' : 'never folded'}`, () => {
      for (const seed of [1, 7, 42]) {
        const on = kindAt(h, { ...LIVE, ...RR_ON }, seed);
        if (h.expect === 'fold') {
          expect(kindAt(h, { ...LIVE }, seed), `main ${seed}`).toBe('call');
          expect(on, `on ${seed}`).toBe('fold');
        } else expect(on, `on ${seed}`).not.toBe('fold');
      }
    });
});
