import { describe, expect, it } from 'vitest';
import { necessaryReferenceRouteGates } from './HorsePhase6Attribution.js';
import { NASH_V2_CALL_MAX_BB } from './HorseNashPushFoldV2.js';

/*
 * A NASH CALL VS JAM IS A chart_bb_defend REFERENCE ROUTE (2026-11-09).
 *
 * #10010 made every hold'em seat facing a lone open-jam at NASH_V2_CALL_MAX_BB
 * or less call or fold from the Nash table's caller side and stamped the
 * decision on the chart_bb_defend route. The route gate still admitted only
 * the sb_push chart's big blind against a small-blind jam with one opponent,
 * so every other seat's receipt was refused as route_gate and the fallback
 * folded the horse: release bff6eed3, 19:36 to 19:51Z on 2026-11-09, 3,843
 * fallback folds in 730 of 1,788 tournament hands, none on the release before.
 * These cases fail on that gate and pass on the widened one.
 */

const JAMMER = 1;
const HERO = 4;

function snapshot(opts: {
  heroStackBB?: number;
  jamBB?: number;
  jamAllIn?: boolean;
  callerBehind?: boolean;
  heroActed?: boolean;
  opponents?: number;
  variant?: string;
  nashCallVsJam?: boolean;
}): any {
  const bb = 2;
  const heroStack = (opts.heroStackBB ?? 15) * bb;
  const jam = (opts.jamBB ?? 12) * bb;
  const jamAllIn = opts.jamAllIn ?? true;
  const players: any[] = [
    {
      seat: JAMMER,
      user_id: 'j',
      bet: jam,
      stack: jamAllIn ? 0 : 40 * bb,
      is_folded: false,
      is_sitting_out: false,
      is_all_in: jamAllIn,
    },
  ];
  // Seats between the jammer and hero: folded, or one cold caller.
  players.push({
    seat: 2,
    user_id: 'x',
    bet: opts.callerBehind ? jam : 0,
    stack: 30 * bb,
    is_folded: !opts.callerBehind,
    is_sitting_out: false,
    is_all_in: false,
  });
  players.push({
    seat: 3,
    user_id: 'y',
    bet: 0,
    stack: 30 * bb,
    is_folded: true,
    is_sitting_out: false,
    is_all_in: false,
  });
  players.push({
    seat: HERO,
    user_id: 'h',
    bet: 0,
    stack: heroStack,
    is_folded: false,
    is_sitting_out: false,
    is_all_in: false,
    cards: ['Ah', 'Qs'],
  });
  // Players still to act behind hero (the open jam is not heads-up).
  for (let i = 0; i < (opts.opponents ?? 3); i++) {
    players.push({
      seat: 5 + i,
      user_id: `o${i}`,
      bet: i === 0 && opts.opponents !== 0 ? 0 : 0,
      stack: 30 * bb,
      is_folded: false,
      is_sitting_out: false,
      is_all_in: false,
    });
  }
  const actionHistory: any[] = [
    { stage: 'preflop', action: jamAllIn ? 'all_in' : 'raise', seat: JAMMER, isFullRaise: true },
  ];
  if (opts.callerBehind) actionHistory.push({ stage: 'preflop', action: 'call', seat: 2 });
  if (opts.heroActed) actionHistory.unshift({ stage: 'preflop', action: 'call', seat: HERO });
  return {
    gameState: {
      gameVariant: opts.variant ?? 'nlh',
      gameMode: 'tournament',
      bigBlind: bb,
      currentBet: jam,
      dealerSeat: 2,
      players,
      actionHistory,
      straddleActive: false,
      allInOrFold: false,
    },
    player: players.find((p) => p.seat === HERO),
    opts: opts.nashCallVsJam === undefined ? {} : { nashCallVsJam: opts.nashCallVsJam },
  };
}

describe('the chart_bb_defend reference route admits the Nash call vs a lone jam', () => {
  it('admits a middle seat facing a lone open-jam with players still behind', () => {
    expect(necessaryReferenceRouteGates('chart_bb_defend', snapshot({}))).toBe(true);
  });

  it('admits the shove at exactly the solved depth', () => {
    expect(
      necessaryReferenceRouteGates(
        'chart_bb_defend',
        snapshot({ heroStackBB: NASH_V2_CALL_MAX_BB, jamBB: NASH_V2_CALL_MAX_BB })
      )
    ).toBe(true);
  });

  it('refuses a jam deeper than the solved table', () => {
    expect(
      necessaryReferenceRouteGates(
        'chart_bb_defend',
        snapshot({ heroStackBB: NASH_V2_CALL_MAX_BB + 5, jamBB: NASH_V2_CALL_MAX_BB + 5 })
      )
    ).toBe(false);
  });

  it('refuses once somebody has already called the jam', () => {
    expect(necessaryReferenceRouteGates('chart_bb_defend', snapshot({ callerBehind: true }))).toBe(
      false
    );
  });

  it('refuses a raise that is not all in', () => {
    expect(necessaryReferenceRouteGates('chart_bb_defend', snapshot({ jamAllIn: false }))).toBe(
      false
    );
  });

  it('refuses a hero who has already acted in the hand', () => {
    expect(necessaryReferenceRouteGates('chart_bb_defend', snapshot({ heroActed: true }))).toBe(
      false
    );
  });

  it('refuses the Nash shape when the feature is switched off', () => {
    expect(
      necessaryReferenceRouteGates('chart_bb_defend', snapshot({ nashCallVsJam: false }))
    ).toBe(false);
  });

  it("keeps Omaha out of the hold'em table", () => {
    expect(necessaryReferenceRouteGates('chart_bb_defend', snapshot({ variant: 'plo4' }))).toBe(
      false
    );
  });
});
