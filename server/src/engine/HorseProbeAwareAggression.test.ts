/**
 * PROBE BETS ARE NOT AGGRESSION (2026-11-08, ExploiterLeague).
 *
 * A player who min-bets every postflop spot was read as a postflop maniac
 * (betCheckedTo past every horse), and every aggressor consequence then
 * landed on that player's REAL bets: the horses called down a value-heavy
 * range. The read now takes the share of a player's checked-to bets that were
 * probes (a big blind, or a fifth of the pot or less) back out of
 * betCheckedTo. A player who bets real sizes into every checked street is
 * still the aggressor it always was, and HorseDecideOpts.probeAwareAggression
 * false restores the old read exactly.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseMind } from './HorseMind.js';
import {
  bigBlindFromForcedPosts,
  PROBE_SHARE_MIN_BETS,
  probeAdjustedCounters,
  probeBetIndexes,
  type ExploitHandAction,
} from './HorseOpponentExploit.js';
import { decodeHorseDecisionReads, encodeHorseDecisionReads } from './HorseDecisionReadFrame.js';
import type { ActionRecord, SeatPlayer } from '../types.js';

const BB = 2;
const HERO = 'probe-hero';
const OPP = 'probe-opp';
let ts = 1_000_000;

/** Heads-up: OPP opens to 2.5bb, HERO calls, HERO checks every street and
 *  OPP bets `bet` chips into it; HERO calls flop and turn, folds the river. */
function hand(bet: (pot: number) => number): ActionRecord[] {
  const out: ActionRecord[] = [];
  const push = (userId: string, action: string, amount: number, stage: string) =>
    out.push({
      seat: userId === HERO ? 1 : 2,
      userId,
      action,
      amount,
      timestamp: ts++,
      stage,
    } as ActionRecord);
  push(OPP, 'raise', 5, 'preflop');
  push(HERO, 'call', 3, 'preflop');
  let pot = 10;
  for (const stage of ['flop', 'turn', 'river']) {
    push(HERO, 'check', 0, stage);
    const b = bet(pot);
    push(OPP, 'bet', b, stage);
    if (stage === 'river') {
      out.push({
        seat: 1,
        userId: HERO,
        action: 'fold',
        amount: 0,
        timestamp: ts++,
        stage,
        origin: 'player',
      } as ActionRecord);
    } else {
      push(HERO, 'call', b, stage);
      pot += 2 * b;
    }
  }
  return out;
}

function play(bet: (pot: number) => number, hands: number): void {
  for (let h = 0; h < hands; h++) {
    const history = hand(bet);
    HorseMind.setDecisionScope('holdem:hu', 'nlh', 'cash');
    HorseMind.observe(history, [], undefined, undefined, BB);
    HorseMind.observeHandComplete(`probe:${h}:${ts}`, history, BB, null, 'holdem:hu');
  }
}

function aggressor(probeAware: boolean): 'high' | 'low' | null {
  HorseMind.setProbeAwareAggression(probeAware);
  try {
    HorseMind.setDecisionScope('holdem:hu', 'nlh', 'cash');
    return HorseMind.opponentRead(OPP)?.stats.betCheckedTo.engaged ?? null;
  } finally {
    HorseMind.setProbeAwareAggression(true);
    HorseMind.setDecisionScope(null);
  }
}

afterEach(() => HorseMind.reset());

describe('probe bets are not aggression', () => {
  it('classifies only a small first wager on a postflop street as a probe', () => {
    const a = (userId: string, action: string, amount: number, stage: string, origin?: string) =>
      ({ userId, action, amount, stage, ...(origin ? { origin } : {}) }) as ExploitHandAction;
    const actions = [
      a(OPP, 'raise', 5, 'preflop'),
      a(HERO, 'call', 3, 'preflop'),
      a(HERO, 'check', 0, 'flop'),
      a(OPP, 'bet', 2, 'flop'), // one big blind into 10: a probe
      a(HERO, 'raise', 8, 'flop'), // a raise is never a probe
      a(OPP, 'call', 6, 'flop'),
      a(HERO, 'bet', 13, 'turn'), // half the pot: a bet
      a(OPP, 'call', 13, 'turn'),
      a(HERO, 'bet', 10, 'river'), // a fifth of 52 rounds up past 10: a probe
    ];
    expect([...probeBetIndexes(actions, BB)]).toEqual([3, 8]);
    // Forced posts in the list replace the assumed blinds.
    const withPosts = [
      a(HERO, 'post', 1, 'preflop', 'forced'),
      a(OPP, 'post', 2, 'preflop', 'forced'),
      ...actions,
    ];
    expect([...probeBetIndexes(withPosts, BB)]).toEqual([5, 10]);
    expect(probeBetIndexes(actions, 0).size).toBe(0);
  });

  it('takes the probe share out of betCheckedTo, and nothing below the sample floor', () => {
    const c = { betCheckedTo: 10, betCheckedToOpp: 12, fBetCheckedTo: 4, fBetCheckedToOpp: 5 };
    const adj = probeAdjustedCounters(c, 10, 9);
    expect(adj.betCheckedTo).toBeCloseTo(1, 9);
    expect(adj.fBetCheckedTo).toBeCloseTo(0.4, 9);
    expect(adj.betCheckedToOpp).toBe(12);
    expect(probeAdjustedCounters(c, PROBE_SHARE_MIN_BETS - 1, PROBE_SHARE_MIN_BETS - 1)).toBe(c);
    expect(probeAdjustedCounters(c, 20, 0)).toBe(c);
  });

  it('a min-bettor is not read as the aggressor; the old read still is', () => {
    play(() => BB, 40);
    const s = HorseMind.getStats(OPP)!;
    expect(s.ctBets).toBe(120);
    expect(s.ctProbes).toBe(120);
    expect(aggressor(false)).toBe('high');
    expect(aggressor(true)).toBeNull();
  });

  it('a player who bets real sizes into every checked street stays the aggressor', () => {
    play((pot) => Math.round(pot * 0.75), 40);
    const s = HorseMind.getStats(OPP)!;
    expect(s.ctBets).toBe(120);
    expect(s.ctProbes).toBe(0);
    expect(aggressor(true)).toBe('high');
    expect(aggressor(false)).toBe('high');
  });

  it('reads the big blind of an accepted hand log from its forced posts', () => {
    expect(
      bigBlindFromForcedPosts([
        { origin: 'forced', stage: 'preflop', amount: 1 },
        { origin: 'forced', stage: 'preflop', amount: 2 },
        { origin: 'player', stage: 'preflop', amount: 6 },
      ])
    ).toBe(2);
    expect(bigBlindFromForcedPosts([{ stage: 'preflop', amount: 6 }])).toBeUndefined();
  });

  it('an observation without the big blind counts neither tally', () => {
    const history = hand(() => BB);
    HorseMind.setDecisionScope('holdem:hu', 'nlh', 'cash');
    HorseMind.observe(history, []);
    expect(HorseMind.getStats(OPP)?.ctBets).toBeUndefined();
  });

  it('carries probe and flop tallies through v13, and keeps historical bytes without either', () => {
    play(() => BB, 12);
    const players = [{ user_id: HERO }, { user_id: OPP }] as SeatPlayer[];
    const ctx = { variant: 'nlh', mode: 'cash', size: 'hu' } as const;
    const view = HorseMind.snapshotDecisionReads(players, null, ctx);
    const frame = encodeHorseDecisionReads(view, players, null);
    expect(view.flopStab?.size).toBeGreaterThan(0);
    expect(frame.version).toBe('horse-decision-reads-v13');
    const restored = decodeHorseDecisionReads(frame, players, null);
    expect(restored.stats.get(OPP)).toMatchObject({ ctBets: 36, ctProbes: 36 });
    expect(encodeHorseDecisionReads(restored, players, null)).toEqual(frame);

    for (const row of view.stats.values()) {
      delete row.ctBets;
      delete row.ctProbes;
    }
    delete view.flopStab;
    const older = encodeHorseDecisionReads(view, players, null);
    expect(older.version).not.toBe('horse-decision-reads-v11');
    expect(older.version).not.toBe('horse-decision-reads-v13');
    expect(older.json).not.toContain('probeTallies');
  });
});
