/**
 * THE COMPLAINT REPLAY SEES THE TABLE THE BRAIN SAW (2026-11-05).
 *
 * Found while size-matching the Hybrid cash fold-to-3-bet: replaying the
 * post-switch 3-bet nodes through HorseComplaintReplay.stateAt reproduced the
 * live action 82% of the time, and every miss ran the same way. Two inputs
 * the live engine publishes on every turn were missing from the rebuilt
 * state:
 *
 *  1. the dealt census (`dealtSeatIds`). Without it the brain reads position
 *     from who is still live (the V13 ring compression), so an under-the-gun
 *     opener whose six neighbours had folded was replayed as a cutoff: it
 *     answered the 3-bet from a 28% open instead of an 11% one and called
 *     with AQo where the live horse folded;
 *  2. the persisted hand carries the forced blind posts (`origin: 'forced'`)
 *     and the uncalled-bet return (`historyEvent`), which HandController
 *     never puts in `actionHistory`. Counted as the hero's own acts, a blind
 *     opener looked like it had acted twice, so the V73 continue read never
 *     fired for a small-blind opener and it folded 88 to a 3.7x 3-bet the
 *     live horse called.
 *
 * With both in place the same 207 nodes reproduce 95% (the rest are
 * borderline hands shaded by the live opponent reads, which the replay turns
 * off on purpose). The law: the rebuilt state carries the census and only
 * the decisions, and the two complained-about shapes replay as the live
 * fleet plays them. Pinned clock (V9 hourly mood).
 */
import { describe, expect, it } from 'vitest';
import {
  COMPLAINT_SEEDS,
  isDecisionRecord,
  replayAt,
  replayProfiles,
  stateAt,
  type ComplaintAction,
  type ExtractedHand,
} from './HorseComplaintReplay.js';
import type { Card } from '../types.js';

const CLOCK = Date.UTC(2026, 10, 5, 18, 0, 0);
const OPTS = { decisionTimeMs: CLOCK };
const BB = 2;
const STACK = 200 * BB;

/**
 * Nine-handed cash, 200bb. `opener` raises to `openTo`, everyone else folds
 * to the big blind, who 3-bets to `threeTo`; the opener is to act. The
 * persisted shape: forced posts first, every decision after, the snapshot on
 * the opener's answer only (as the engine records it).
 */
function hand(
  opener: number,
  openTo: number,
  threeTo: number,
  hole: Card[],
  recorded: string
): ExtractedHand {
  const order = [3, 4, 5, 6, 7, 8, 9, 1, 2];
  const seats = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const bet = (s: number) => (s === opener ? openTo : s === 2 ? threeTo : s === 1 ? 1 : 0);
  const status = (s: number) => (s === opener || s === 2 ? 0 : 1);
  const actions: ComplaintAction[] = [
    { ord: 1, seat: 1, stage: 'preflop', action: 'sb', amount: 1, origin: 'forced', dead: false },
    { ord: 2, seat: 2, stage: 'preflop', action: 'bb', amount: 2, origin: 'forced', dead: false },
  ];
  let ord = 3;
  for (const s of order) {
    if (s === opener)
      actions.push({
        ord: ord++,
        seat: s,
        stage: 'preflop',
        action: 'raise',
        amount: openTo,
        origin: 'horse_policy',
        isFullRaise: true,
      });
    else if (s === 2)
      actions.push({
        ord: ord++,
        seat: s,
        stage: 'preflop',
        action: 'raise',
        amount: threeTo,
        origin: 'horse_policy',
        isFullRaise: true,
      });
    else if (s === 1 && opener === 1) continue;
    else
      actions.push({
        ord: ord++,
        seat: s,
        stage: 'preflop',
        action: 'fold',
        amount: 0,
        origin: 'horse_policy',
      });
  }
  const pot = seats.reduce((t, s) => t + bet(s), 0);
  actions.push({
    ord: ord++,
    seat: opener,
    stage: 'preflop',
    action: recorded,
    amount: recorded === 'call' ? threeTo - openTo : 0,
    origin: 'horse_policy',
    publicNode: {
      pot,
      ante: 0,
      anteType: 'per_player',
      mode: 'cash',
      seats: seats.map((s) => [s, STACK - bet(s), bet(s), bet(s), 0, 0, status(s)]),
      boards: [''],
      street: 'preflop',
      toCall: threeTo - openTo,
      currentBet: threeTo,
      minRaiseTo: 2 * threeTo - openTo,
      maxRaiseTo: STACK,
      legalActions: ['fold', 'call', 'raise', 'all_in'],
      dealerSeat: 9,
      chipUnit: 0.01,
      bigBlind: BB,
      smallBlind: 1,
      variant: 'nlh',
      structure: 'no_limit',
      actorSeat: opener,
      bombPot: false,
      tournamentStage: { status: 'not_applicable', version: 1 },
    },
  });
  return {
    handId: `law-${opener}`,
    variant: 'nlh',
    bigBlind: BB,
    smallBlind: 1,
    buttonSeat: 9,
    players: seats.map((seat) => ({ seat, userId: `u${seat}`, isHorse: true })),
    horseHoleCards: { [`u${opener}`]: hole },
    actions,
  };
}

const c = (rank: string, suit: Card['suit']) => ({ rank, suit }) as Card;
const live = replayProfiles('cash')[0];

/** The state as it was rebuilt before this law: no census, the posts in the history. */
function asBefore(st: ReturnType<typeof stateAt>, h: ExtractedHand, node: ComplaintAction) {
  const gs = st.gs as unknown as Record<string, unknown>;
  delete gs.dealtSeatIds;
  gs.actionHistory = h.actions
    .filter((a) => a.ord < node.ord)
    .map((a) => ({
      stage: a.stage,
      seat: a.seat,
      userId: `p${a.seat}`,
      action: a.action,
      amount: a.amount,
      isFullRaise: a.isFullRaise === true,
    }));
  return st;
}

describe('the complaint replay sees the table the brain saw', () => {
  const utg = hand(3, 7, 28, [c('A', 'spades'), c('Q', 'hearts')], 'fold');
  const utgNode = utg.actions.at(-1)!;
  const sb = hand(1, 7, 26, [c('8', 'spades'), c('8', 'hearts')], 'call');
  const sbNode = sb.actions.at(-1)!;

  it('the rebuilt state carries the dealt census and only the decisions', () => {
    const st = stateAt(utg, utgNode);
    expect((st.gs as unknown as { dealtSeatIds: number[] }).dealtSeatIds).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    const acts = st.gs.actionHistory!.map((a) => a.action);
    expect(acts).not.toContain('sb');
    expect(acts).not.toContain('bb');
    expect(acts.filter((a) => a === 'raise')).toHaveLength(2);
    expect(isDecisionRecord({ origin: 'forced' })).toBe(false);
    expect(isDecisionRecord({ historyEvent: 'uncalled_bet_returned' })).toBe(false);
    expect(isDecisionRecord({ origin: 'horse_policy' })).toBe(true);
    expect(isDecisionRecord({})).toBe(true);
  });

  it('an under-the-gun opener answers a 4x 3-bet from its own seat (AQo folds), not from the cutoff', () => {
    const now = replayAt(stateAt(utg, utgNode), live, COMPLAINT_SEEDS, OPTS, 'fold');
    expect(now.receipts.v73_vs3bet_defence).toBeGreaterThan(0);
    expect(now.reproduced).toBe(COMPLAINT_SEEDS.length);
    // Non-vacuity: the pre-law state (no census) promoted the opener and called.
    const before = replayAt(
      asBefore(stateAt(utg, utgNode), utg, utgNode),
      live,
      COMPLAINT_SEEDS,
      OPTS,
      'fold'
    );
    expect(before.reproduced).toBe(0);
  });

  it('a small-blind opener still gets the V73 continue read (88 calls a 3.7x 3-bet)', () => {
    const now = replayAt(stateAt(sb, sbNode), live, COMPLAINT_SEEDS, OPTS, 'call');
    expect(now.receipts.v73_vs3bet_defence).toBeGreaterThan(0);
    expect(now.reproduced).toBe(COMPLAINT_SEEDS.length);
    // Non-vacuity: with the forced post counted as the hero's act, V73 never fired and 88 folded.
    const before = replayAt(
      asBefore(stateAt(sb, sbNode), sb, sbNode),
      live,
      COMPLAINT_SEEDS,
      OPTS,
      'call'
    );
    expect(before.receipts.v73_vs3bet_defence ?? 0).toBe(0);
    expect(before.reproduced).toBe(0);
  });
});
