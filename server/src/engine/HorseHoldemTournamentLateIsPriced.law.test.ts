/**
 * LAW: THE HOLD'EM TOURNAMENT BLUFF AFTER THE FLOP IS PRICED (holdemTournamentRiverBluffIsPriced,
 * holdemTournamentTurnBluffIsPriced; both default OFF, read `=== true`; plo-lead7 tourney-postflop 2026-11-26;
 * docs/horse-option-authority.d/holdemTournamentRiverBluffIsPriced.md and holdemTournamentTurnBluffIsPriced.md).
 *
 *  - with no pay jump live the price is the cash opening side's chip EV exactly (bubble factor 1);
 *  - the payout risk weights only the chips the bluff can lose: a larger bubble factor never raises a bet's EV, never
 *    moves the check, and moves the best size down or keeps it;
 *  - the payout price reads the trusted tournament context: chip EV far from the money, heads-up and winner-take-all;
 *    a bubble factor above one on a priced bubble; 'unknown' (the option stands down) where a pay jump is live and
 *    the context cannot price it (no stacks or identity, no trusted context, a satellite, a PKO, a mystery bounty);
 *  - real audited tournament nodes (the deciding Horse's own cards only, HorseHoldemTournamentLateIsPriced.fixture.json):
 *    on every seed where the option-off brain checks, the option for that street alone bets with its receipt (one
 *    size where every seed checked); the other street's option does not; a truthy non-boolean is off; a cash copy of the node is never touched; a copy on
 *    a live bubble whose context carries no stacks, or a live pay jump of a field past the ICM compute bound
 *    (HOLDEM_TOURNAMENT_BLUFF_ICM_FIELD_MAX), stands down.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Card } from '../types.js';
import { holdemOpeningPrice } from './HorseHoldemOpeningIsPriced.js';
import {
  holdemTournamentBestBluff,
  holdemTournamentRiskWeightedEv,
  holdemTournamentWagerParts,
} from './HorseHoldemTournamentLateIsPriced.js';
import { holdemFillEquities, holdemLineRange } from './HorseHoldemValueAndCallsArePriced.js';
import {
  HOLDEM_TOURNAMENT_BLUFF_ICM_FIELD_MAX,
  postflopWagerPayoutPrice,
  type HorseGameStateV2,
} from './HorseLogic.js';
import {
  replayAt,
  replayProfiles,
  stateAt,
  type ComplaintAction,
  type ExtractedHand,
} from './HorseComplaintReplay.js';
import { restoreFastRandom, saveFastRandom } from './HorseEval.js';

const c = (s: string): Card => ({
  rank: (s[0] === 'T' ? '10' : s[0]) as Card['rank'],
  suit: ({ c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' } as const)[
    s[1] as 'c' | 'd' | 'h' | 's'
  ],
});
const board = ['Kh', '9d', '4c', '2s', '7h'].map(c);

function priced(hero: Card[], heroStack: number) {
  const range = holdemLineRange(hero, board, null, []);
  const base = holdemLineRange([], board, null, []);
  holdemFillEquities(range, hero, board, 7);
  const spot = { pot: 100, heroIn: 0, villainIn: 0, heroStack, villainStack: 1000, r: 1 };
  const targets = [33, 50, 75, 100, heroStack].filter((t) => t <= heroStack);
  const p = holdemOpeningPrice({ ...spot, foldRef: 0.5 }, range, base, targets);
  return { spot, p };
}

describe('the tournament bluff is priced: the math', () => {
  it('with no pay jump (bubble factor 1) the EV is the cash opening side chip EV exactly', () => {
    const { spot, p } = priced([c('Kd'), c('3c')], 1000);
    for (const b of p.bets) expect(holdemTournamentRiskWeightedEv(spot, b, 1)).toBeCloseTo(b.ev, 9);
    // a factor at or below one, or not a number, is chip EV
    for (const b of p.bets)
      for (const bf of [0.5, Number.NaN])
        expect(holdemTournamentRiskWeightedEv(spot, b, bf)).toBeCloseTo(b.ev, 9);
  });

  it('a larger bubble factor never raises a bet, never moves the check, and never grows the best size', () => {
    const { spot, p } = priced([c('Kd'), c('3c')], 1000);
    for (const b of p.bets) {
      let prev = Infinity;
      for (const bf of [1, 1.2, 1.5, 2, 3]) {
        const ev = holdemTournamentRiskWeightedEv(spot, b, bf);
        expect(ev).toBeLessThanOrEqual(prev + 1e-9);
        prev = ev;
      }
    }
    let size = Infinity;
    for (const bf of [1, 1.3, 2, 4]) {
      const best = holdemTournamentBestBluff(spot, p.bets, () => bf);
      if (!best) break;
      expect(best.bet.to).toBeLessThanOrEqual(size);
      size = best.bet.to;
    }
  });

  it('a short effective stack caps what the bluff risks: sizes past the stack are the shove', () => {
    const spot = { pot: 100, heroIn: 0, villainIn: 0, heroStack: 60, villainStack: 1000, r: 1 };
    expect(holdemTournamentWagerParts(spot, 100)).toEqual({ matched: 60, his: 100 });
    const short = { ...spot, heroStack: 1000, villainStack: 40 };
    expect(holdemTournamentWagerParts(short, 100).matched).toBe(40);
  });

  it('a value hand is never a bluff candidate', () => {
    const { spot, p } = priced([c('Kd'), c('Kc')], 1000);
    const best = holdemTournamentBestBluff(spot, p.bets, () => 1);
    for (const b of p.bets.filter((x) => x.value)) expect(best?.bet.to).not.toBe(b.to);
  });
});

const BB = 200;
function gsWith(t: Record<string, unknown> | undefined, mode = 'tournament'): HorseGameStateV2 {
  return {
    gameMode: mode,
    bigBlind: BB,
    ...(t ? { tournament: t } : {}),
  } as unknown as HorseGameStateV2;
}
const ctx = (over: Record<string, unknown>) => ({
  schemaVersion: 1,
  contextStatus: 'complete',
  contextIssues: [],
  playersLeft: 3,
  spotsPaid: 2,
  payoutPct: [65, 35],
  nearBubble: true,
  inMoney: false,
  stacks: [4000, 4000, 4000],
  stackByUser: { hero: 4000, a: 4000, b: 4000 },
  ...over,
});

describe('the tournament bluff is priced: the payout price', () => {
  it('chip EV where no pay jump is live, heads-up, winner-take-all, or at a cash table', () => {
    expect(
      postflopWagerPayoutPrice(
        gsWith(
          ctx({
            playersLeft: 180,
            spotsPaid: 30,
            nearBubble: false,
            stacks: undefined,
            stackByUser: undefined,
          })
        ),
        20,
        'hero'
      )
    ).toBe('chips');
    expect(
      postflopWagerPayoutPrice(gsWith(ctx({ playersLeft: 2, spotsPaid: 1 })), 20, 'hero')
    ).toBe('chips');
    expect(
      postflopWagerPayoutPrice(
        gsWith(ctx({ playersLeft: 3, spotsPaid: 1, payoutPct: [100], nearBubble: false })),
        20,
        'hero'
      )
    ).toBe('chips');
    expect(postflopWagerPayoutPrice(gsWith(undefined, 'cash'), 20, 'hero')).toBe('chips');
  });

  it('on a priced bubble the bluff risk carries a bubble factor above one', () => {
    const p = postflopWagerPayoutPrice(gsWith(ctx({})), 20, 'hero');
    expect(typeof p).toBe('function');
    const f = p as (risk: number) => number;
    expect(f(2000)).toBeGreaterThan(1);
    expect(f(4000)).toBeGreaterThanOrEqual(1);
  });

  it('a live pay jump the context cannot price stands the option down', () => {
    for (const over of [
      { stacks: undefined, stackByUser: undefined },
      { stackByUser: { other: 4000 } },
      { satellite: true },
      { isPko: true },
      { isMysteryBounty: true },
      { contextStatus: 'partial' },
    ])
      expect(postflopWagerPayoutPrice(gsWith(ctx(over)), 20, 'hero')).toBe('unknown');
    expect(postflopWagerPayoutPrice(gsWith(undefined), 20, 'hero')).toBe('unknown');
  });
});

interface FixNode {
  hand: ExtractedHand;
  ord: number;
  street: 'turn' | 'river';
  option: string;
  expect: string;
}
const FIX = JSON.parse(
  readFileSync(new URL('./HorseHoldemTournamentLateIsPriced.fixture.json', import.meta.url), 'utf8')
) as { nodes: FixNode[]; productionOpts: Record<string, unknown> };
const PROD = FIX.productionOpts;
const prof = replayProfiles('tournament')[0];
const SEEDS = [1, 7, 42];
const OTHER: Record<string, string> = {
  holdemTournamentRiverBluffIsPriced: 'holdemTournamentTurnBluffIsPriced',
  holdemTournamentTurnBluffIsPriced: 'holdemTournamentRiverBluffIsPriced',
};

describe('the tournament bluff is priced: real audited tournament nodes', () => {
  it('the fixture carries real nodes of both streets', () => {
    expect(FIX.nodes.some((n) => n.street === 'river')).toBe(true);
    expect(FIX.nodes.length).toBeGreaterThanOrEqual(3);
  });
  for (const n of FIX.nodes) {
    it(`${n.hand.handId} ${n.street}: off checks, ${n.option} bets with its receipt`, () => {
      const rng = saveFastRandom();
      try {
        const node = n.hand.actions.find((a) => a.ord === n.ord) as ComplaintAction;
        const st = stateAt(n.hand, node);
        // the brain's own line may draw a bet on some seeds; the option acts on every seed where it checked
        const off = replayAt(st, prof, SEEDS, PROD);
        const checks = off.kinds.check ?? 0;
        expect(checks).toBeGreaterThanOrEqual(1);
        for (const v of [false, 1, 'true'])
          expect(replayAt(st, prof, SEEDS, { ...PROD, [n.option]: v }).kinds).toEqual(off.kinds);
        const on = replayAt(st, prof, SEEDS, { ...PROD, [n.option]: true });
        expect(on.kinds.check ?? 0).toBe(0);
        expect((on.kinds.raise ?? 0) + (on.kinds.jam ?? 0)).toBe(SEEDS.length);
        expect(on.receipts[n.expect]).toBe(checks);
        // where every seed checked, the priced size is one size (no draw decides it)
        if (checks === SEEDS.length) expect(new Set(on.sizesBb).size).toBe(1);
        const other = replayAt(st, prof, SEEDS, { ...PROD, [OTHER[n.option]]: true });
        expect(other.kinds).toEqual(off.kinds);
        // a cash copy of the node is out of scope
        const cash = stateAt(n.hand, node);
        (cash.gs as unknown as { gameMode: string }).gameMode = 'cash';
        delete (cash.gs as unknown as { tournament?: unknown }).tournament;
        const cOn = replayAt(cash, prof, SEEDS, { ...PROD, [n.option]: true });
        expect(cOn.receipts[n.expect] ?? 0).toBe(0);
        // a copy on a live bubble whose context carries no stacks stands down
        const bub = stateAt(n.hand, node);
        (bub.gs as unknown as { tournament: Record<string, unknown> }).tournament = {
          schemaVersion: 1,
          contextStatus: 'complete',
          contextIssues: [],
          playersLeft: 10,
          spotsPaid: 9,
          payoutPct: [30, 20, 14, 10, 8, 6, 5, 4, 3],
          nearBubble: true,
          inMoney: false,
        };
        // a live pay jump on a field past the ICM compute bound stands down too
        const big = stateAt(n.hand, node);
        const bigStacks = Array.from(
          { length: HOLDEM_TOURNAMENT_BLUFF_ICM_FIELD_MAX + 1 },
          () => 5000
        );
        (big.gs as unknown as { tournament: Record<string, unknown> }).tournament = {
          schemaVersion: 1,
          contextStatus: 'complete',
          contextIssues: [],
          playersLeft: bigStacks.length,
          spotsPaid: bigStacks.length - 1,
          payoutPct: bigStacks.slice(1).map((_, i) => 20 / (i + 1)),
          nearBubble: true,
          inMoney: false,
          stacks: bigStacks,
          stackByUser: Object.fromEntries(
            (big.gs as unknown as { players: { user_id: string }[] }).players.map((p) => [
              p.user_id,
              5000,
            ])
          ),
        };
        const gOn = replayAt(big, prof, SEEDS, { ...PROD, [n.option]: true });
        expect(gOn.receipts[n.expect] ?? 0).toBe(0);
        const bOff = replayAt(bub, prof, SEEDS, PROD);
        const bOn = replayAt(bub, prof, SEEDS, { ...PROD, [n.option]: true });
        expect(bOn.kinds).toEqual(bOff.kinds);
        expect(bOn.receipts[n.expect] ?? 0).toBe(0);
        expect(bOn.receipts.holdem_tourney_bluff_payout_unpriced ?? 0).toBe(bOff.kinds.check ?? 0);
      } finally {
        restoreFastRandom(rng);
      }
    });
  }
});
