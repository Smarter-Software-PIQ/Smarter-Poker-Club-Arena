/**
 * A HOLD'EM RIVER FULL HOUSE LEADS FOR VALUE (2026-11-15, option holdemRiverFullHouseValue, default OFF).
 *
 * Synthetic spots shaped like the audited river checks that still reproduce on main (review-v9 replay,
 * agy-holdem-elite-c2072436/RIVER-FULL-HOUSE-REPLAY-20261115.md): heads-up, the Horse in the big blind called a
 * raise, called the flop and turn bets, and acts first on a blank river. No recorded hand, card or identity is
 * copied here.
 */
import { describe, expect, it } from 'vitest';
import {
  replayAt,
  replayProfiles,
  stateAt,
  type ComplaintAction,
  type ExtractedHand,
} from './HorseComplaintReplay.js';
import { holdemRiverBoatLeadPrice, holdemRiverLeadBoat } from './HorseHoldemRiverFullHouseValue.js';
import { HorseLogic } from './HorseLogic.js';
import { HorseMind, readScopeOf } from './HorseMind.js';
import { freshExploitCounters, type ExploitCounters } from './HorseOpponentExploit.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { seedFastRandom } from './HorseEval.js';
import type { Card } from '../types.js';

const SUIT = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' } as const;
const cards = (text: string): Card[] =>
  (text.match(/.{2}/g) ?? []).map((t) => ({
    rank: (t[0] === 'T' ? '10' : t[0]) as Card['rank'],
    suit: SUIT[t[1] as keyof typeof SUIT],
  }));

/** Cash 1/2, 100 big blinds: button raises to 5, big blind calls; flop bet 6 called; turn bet 14 called. */
function spot(hole: string, board: string, variant = 'nlh'): ReturnType<typeof stateAt> {
  const actions: ComplaintAction[] = [
    { ord: 1, seat: 1, stage: 'preflop', action: 'sb', amount: 1 },
    { ord: 2, seat: 2, stage: 'preflop', action: 'bb', amount: 2 },
    { ord: 3, seat: 3, stage: 'preflop', action: 'raise', amount: 5, isFullRaise: true },
    { ord: 4, seat: 1, stage: 'preflop', action: 'fold', amount: 0 },
    { ord: 5, seat: 2, stage: 'preflop', action: 'call', amount: 3 },
    { ord: 6, seat: 2, stage: 'flop', action: 'check', amount: 0 },
    { ord: 7, seat: 3, stage: 'flop', action: 'bet', amount: 6, isFullRaise: true },
    { ord: 8, seat: 2, stage: 'flop', action: 'call', amount: 6 },
    { ord: 9, seat: 2, stage: 'turn', action: 'check', amount: 0 },
    { ord: 10, seat: 3, stage: 'turn', action: 'bet', amount: 14, isFullRaise: true },
    { ord: 11, seat: 2, stage: 'turn', action: 'call', amount: 14 },
  ];
  const node: ComplaintAction = {
    ord: 12,
    seat: 2,
    stage: 'river',
    action: 'check',
    amount: 0,
    origin: 'horse_policy',
    publicNode: {
      pot: 51,
      ante: 0,
      anteType: 'none',
      mode: 'cash',
      seats: [
        [1, 199, 0, 1, 0, 0, 1],
        [2, 175, 0, 25, 0, 0, 0],
        [3, 175, 0, 25, 0, 0, 0],
      ],
      boards: [board],
      street: 'river',
      toCall: 0,
      currentBet: 0,
      minRaiseTo: 2,
      maxRaiseTo: 175,
      legalActions: ['fold', 'check', 'bet', 'all_in'],
      dealerSeat: 3,
      chipUnit: 1,
      bigBlind: 2,
      smallBlind: 1,
      variant,
      structure: 'no_limit',
      actorSeat: 2,
      bombPot: false,
      allInOrFold: false,
      tournamentStage: null,
    },
  };
  const hand = {
    handId: 'river-full-house',
    variant,
    bigBlind: 2,
    smallBlind: 1,
    buttonSeat: 3,
    players: [1, 2, 3].map((seat) => ({ seat, userId: `p${seat}`, isHorse: true })),
    horseHoleCards: { p2: cards(hole) },
    actions: [...actions, node],
  } as unknown as ExtractedHand;
  return stateAt(hand, node);
}

const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);
const LIVE = replayProfiles('cash')[0];
const run = (st: ReturnType<typeof stateAt>, on: boolean | undefined) =>
  replayAt(st, LIVE, SEEDS, on === undefined ? {} : { holdemRiverFullHouseValue: on });
const bets = (r: ReturnType<typeof run>) => (r.kinds.raise ?? 0) + (r.kinds.jam ?? 0);

describe('the hand test', () => {
  it('admits a full house or quads that uses a hole card and that no single board card beats', () => {
    expect(holdemRiverLeadBoat(cards('7c6d'), cards('Kd7h6hTc7s'))).toBe(true); // sevens full, top boat
    expect(holdemRiverLeadBoat(cards('9sAh'), cards('9cAdKh9d4c'))).toBe(true); // nines full of aces
    expect(holdemRiverLeadBoat(cards('8h8c'), cards('8d8s3c9hKd'))).toBe(true); // quads with both cards
  });
  it('refuses an under-full, a trips-board boat, the board playing and anything below a full house', () => {
    expect(holdemRiverLeadBoat(cards('5s4d'), cards('8dTh5c5h8s'))).toBe(false); // fives full under eights
    expect(holdemRiverLeadBoat(cards('3h3c'), cards('5h2d9d2c2h'))).toBe(false); // trips board
    expect(holdemRiverLeadBoat(cards('5s8s'), cards('2c2s2hJcJh'))).toBe(false); // the board plays
    expect(holdemRiverLeadBoat(cards('AsKs'), cards('QsJsTs2d3c'))).toBe(false); // not a full house
    expect(holdemRiverLeadBoat(cards('7c6d'), cards('Kd7h6hTc'))).toBe(false); // not a river
  });
});

describe("a hold'em river full house leads for value", () => {
  it('off, the top boat checks to the turn bettor every time, and unset equals false', () => {
    const st = spot('7c6d', 'Kd7h6hTc7s');
    const unset = run(st, undefined);
    const off = run(st, false);
    expect(unset.kinds).toEqual({ check: 200 });
    expect(off).toEqual(unset);
    expect(unset.receipts.holdem_river_full_house_lead_seen ?? 0).toBe(0);
  });
  it('on, the same hand leads about 70% of the time and keeps a checking range', () => {
    const on = run(spot('7c6d', 'Kd7h6hTc7s'), true);
    expect(bets(on)).toBeGreaterThanOrEqual(120);
    expect(bets(on)).toBeLessThanOrEqual(160);
    expect(on.kinds.check ?? 0).toBeGreaterThanOrEqual(40);
    expect(on.receipts.holdem_river_full_house_lead_seen).toBe(bets(on));
  });
  it('on, an under-full, a trips-board boat and a board that plays keep exactly the off decision', () => {
    for (const [hole, board] of [
      ['5s4d', '8dTh5c5h8s'],
      ['3h3c', '5h2d9d2c2h'],
      ['5s8s', '2c2s2hJcJh'],
    ] as const) {
      const st = spot(hole, board);
      expect(run(st, true), `${hole} ${board}`).toEqual(run(st, undefined));
    }
  });
  it('on, a hand below a full house keeps exactly the off decision', () => {
    for (const [hole, board] of [
      ['AsKd', 'Kh7h6hTc2s'],
      ['Jc9c', 'Kd7h6hTc8s'],
    ] as const) {
      const st = spot(hole, board);
      expect(run(st, true), `${hole} ${board}`).toEqual(run(st, undefined));
    }
  });
});

// ─── ROWFIX 2026-11-18: holdemRiverFullHouseValueIsPriced (default OFF) ───
describe('the priced lead (holdemRiverFullHouseValueIsPriced): EV(lead) against EV(check)', () => {
  it('closed form: with the nuts the lead wins exactly when he calls more often than he bets', () => {
    const p = holdemRiverBoatLeadPrice({
      pot: 51,
      lead: 40,
      equity: 1,
      callShare: 0.43,
      betShare: 0.31,
    })!;
    expect(p.evLead).toBeCloseTo(0.57 * 51 + 0.43 * 91, 9);
    expect(p.evCheck).toBeCloseTo(0.69 * 51 + 0.31 * 91, 9);
    expect(p.lead).toBe(true);
    expect(
      holdemRiverBoatLeadPrice({ pot: 51, lead: 40, equity: 1, callShare: 0.2, betShare: 0.6 })!
        .lead
    ).toBe(false);
    // equal rates: no edge, the check stands (strictly better is required)
    expect(
      holdemRiverBoatLeadPrice({ pot: 51, lead: 40, equity: 1, callShare: 0.4, betShare: 0.4 })!
        .lead
    ).toBe(false);
    expect(
      holdemRiverBoatLeadPrice({ pot: 0, lead: 40, equity: 1, callShare: 0.4, betShare: 0.3 })
    ).toBeNull();
    expect(
      holdemRiverBoatLeadPrice({ pot: 51, lead: NaN, equity: 1, callShare: 0.4, betShare: 0.3 })
    ).toBeNull();
  });
  const PRICED = { holdemRiverFullHouseValue: true, holdemRiverFullHouseValueIsPriced: true };
  it('off and unset are the 70% line exactly; the priced option alone does nothing', () => {
    const st = spot('7c6d', 'Kd7h6hTc7s');
    const on = run(st, true);
    for (const v of [false, undefined])
      expect(
        replayAt(st, LIVE, SEEDS, {
          holdemRiverFullHouseValue: true,
          holdemRiverFullHouseValueIsPriced: v,
        })
      ).toEqual(on);
    expect(replayAt(st, LIVE, SEEDS, { holdemRiverFullHouseValueIsPriced: true })).toEqual(
      run(st, undefined)
    );
  });
  it('on, with no read the population cell prices it: the top boat leads every time, no random draw', () => {
    const st = spot('7c6d', 'Kd7h6hTc7s');
    const priced = replayAt(st, LIVE, SEEDS, PRICED);
    expect(bets(priced)).toBe(SEEDS.length);
    expect(priced.receipts.holdem_river_full_house_lead_priced).toBe(SEEDS.length);
    expect(priced.receipts.holdem_river_full_house_lead_seen).toBe(SEEDS.length);
  });
  it('on, a measured aggressor who bets when checked to more than he calls a river bet gets the check', () => {
    const st = spot('7c6d', 'Kd7h6hTc7s');
    const scope = readScopeOf('nlh', 3);
    const decideWith = (c: ExploitCounters | null, opts: Record<string, unknown>) => {
      HorseMind.reset();
      if (c)
        (
          HorseMind as unknown as { exploitCounters: Map<string, ExploitCounters> }
        ).exploitCounters.set(`${scope}|p3`, c);
      enableBrainTelemetry();
      drainFires();
      seedFastRandom(11);
      const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
        telemetry: true,
        ...opts,
      } as never);
      return { action: d.action, fires: drainFires().map((f) => f.feature) };
    };
    const barreler = freshExploitCounters();
    barreler.betCheckedToOpp = 60;
    barreler.betCheckedTo = 48; // bets 80% when checked to
    barreler.riverCallOpp = 40;
    barreler.riverCall = 8; // calls 20% of river bets
    const checked = decideWith(barreler, PRICED);
    expect(checked.fires).toContain('holdem_river_full_house_check_priced');
    expect(checked.action).toBe('check');
    const station = freshExploitCounters();
    station.betCheckedToOpp = 60;
    station.betCheckedTo = 6;
    station.riverCallOpp = 40;
    station.riverCall = 34;
    const led = decideWith(station, PRICED);
    expect(led.fires).toContain('holdem_river_full_house_lead_priced');
    expect(['bet', 'raise', 'all_in']).toContain(led.action);
  });
  it('on, hands that do not qualify keep exactly the off decision', () => {
    for (const [hole, board] of [
      ['5s4d', '8dTh5c5h8s'],
      ['AsKd', 'Kh7h6hTc2s'],
    ] as const) {
      const st = spot(hole, board);
      expect(replayAt(st, LIVE, SEEDS, PRICED), `${hole} ${board}`).toEqual(run(st, undefined));
    }
  });
});
