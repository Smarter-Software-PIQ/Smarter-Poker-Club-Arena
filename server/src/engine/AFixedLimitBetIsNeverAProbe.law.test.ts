/**
 * LAW: A FIXED-LIMIT BET IS NEVER A PROBE (2026-11-14, Fixed-Limit lane).
 *
 * The probe rule (PROBE BETS ARE NOT AGGRESSION, HorseOpponentExploit
 * probeBetIndexes) reads a first postflop bet of at most one big blind or a
 * fifth of the pot as a probe and takes the probe share back out of the
 * aggressor read (betCheckedTo). In fixed limit every flop bet is one big
 * blind and a turn or river bet is under a fifth of the pot once the pot
 * passes ten big blinds, so a fixed-limit maniac's bets were mostly "probes"
 * (75 to 100 percent measured) and no maniac or aggressor class ever engaged
 * in flh or flo8. With HorseMind.setFixedLimitBetsAreNeverProbes on, a hand
 * whose betting structure is fixed limit adds no probe tally at all, so its
 * bets count whole. A no-limit probe bet is still a probe. The switch is
 * process-level; its SOURCE DEFAULT is ON since 2026-11-15
 * (FIXED_LIMIT_BETS_ARE_NEVER_PROBES_DEFAULT, a defect repair with its
 * evidence in docs/horse-default-on.d/fixedLimitBetsAreNeverProbes.md).
 * Switched off it reproduces the counting of main before this law exactly.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  FIXED_LIMIT_BETS_ARE_NEVER_PROBES_DEFAULT,
  HorseMind,
  type ReadScope,
} from './HorseMind.js';
import { isAggressor, isPostflopManiac } from './HorseOpponentExploit.js';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { learnCompletedHandInPersistedMemory } from './horseDecision/workerRuntime.js';
import type { ObserveCompletedHandRequest } from './horseDecision/protocol.js';
import type { BettingStructure } from './BettingStructure.js';
import type { ActionRecord, SeatPlayer } from '../types.js';

const BB = 2;
const HERO = '10000000-0000-4000-8000-000000000001';
const OPP = '10000000-0000-4000-8000-000000000002';
const TABLE = '20000000-0000-4000-8000-000000000003';
let ts = 2_000_000;

/** Heads-up fixed limit (blinds 1/2, small bet 2, big bet 4). OPP raises
 *  preflop, HERO calls and checks every street, OPP bets one fixed bet into
 *  every street; HERO calls the flop and turn and the river every other hand. */
function fixedLimitManiacHand(h: number): ActionRecord[] {
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
  push(OPP, 'raise', 4, 'preflop');
  push(HERO, 'call', 2, 'preflop');
  for (const [stage, bet] of [
    ['flop', 2],
    ['turn', 4],
    ['river', 4],
  ] as const) {
    push(HERO, 'check', 0, stage);
    push(OPP, 'bet', bet, stage);
    if (stage === 'river' && h % 2 === 1)
      out.push({
        seat: 1,
        userId: HERO,
        action: 'fold',
        amount: 0,
        timestamp: ts++,
        stage,
        origin: 'player',
      } as ActionRecord);
    else push(HERO, 'call', bet, stage);
  }
  return out;
}

/** The same no-limit line with one-big-blind probes on every street. */
function noLimitMinBetHand(): ActionRecord[] {
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
  for (const stage of ['flop', 'turn', 'river']) {
    push(HERO, 'check', 0, stage);
    push(OPP, 'bet', BB, stage);
    push(HERO, 'call', BB, stage);
  }
  return out;
}

function feed(
  hands: number,
  make: (h: number) => ActionRecord[],
  scope: ReadScope,
  variant: string,
  structure: BettingStructure
): void {
  for (let h = 0; h < hands; h++) {
    const history = make(h);
    HorseMind.setDecisionScope(scope, variant, 'cash');
    HorseMind.observe(history, [], undefined, undefined, BB, structure);
    HorseMind.setDecisionScope(null);
    HorseMind.observeHandComplete(`flprobe:${h}:${ts}`, history, BB, null, scope);
  }
}

function readOf(scope: ReadScope, variant: string) {
  HorseMind.setDecisionScope(scope, variant, 'cash');
  try {
    return HorseMind.opponentRead(OPP);
  } finally {
    HorseMind.setDecisionScope(null);
  }
}

afterEach(() => {
  HorseMind.setFixedLimitBetsAreNeverProbes(FIXED_LIMIT_BETS_ARE_NEVER_PROBES_DEFAULT);
  HorseMind.reset();
});

describe('a fixed-limit bet is never a probe', () => {
  it('is a process switch whose source default is on, so production counts fixed-limit bets whole', () => {
    expect(FIXED_LIMIT_BETS_ARE_NEVER_PROBES_DEFAULT).toBe(true);
    expect(HorseMind.fixedLimitBetsAreNeverProbesOn()).toBe(true);
    // A fresh process, with nothing set: the default alone stops the tally.
    feed(10, fixedLimitManiacHand, 'holdem:hu', 'flh', 'fixed_limit');
    const s = HorseMind.getStats(OPP)!;
    expect(s.ctBets ?? 0).toBe(0);
    expect(s.ctProbes ?? 0).toBe(0);
  });

  for (const [variant, scope] of [
    ['flh', 'holdem:hu'],
    ['flo8', 'omaha:hu'],
  ] as const) {
    it(`${variant} heads-up: a maniac's fixed bets count whole and he reads as a postflop maniac within 100 hands`, () => {
      HorseMind.setFixedLimitBetsAreNeverProbes(true);
      feed(100, fixedLimitManiacHand, scope, variant, 'fixed_limit');
      const s = HorseMind.getStats(OPP)!;
      // No probe tally at all for a fixed-limit hand.
      expect(s.ctBets ?? 0).toBe(0);
      expect(s.ctProbes ?? 0).toBe(0);
      const read = readOf(scope, variant);
      expect(read).not.toBeNull();
      expect(read!.stats.betCheckedTo.mean).toBeGreaterThanOrEqual(0.9);
      expect(isPostflopManiac(read)).toBe(true);
      expect(isAggressor(read)).toBe(true);
    });

    it(`${variant} heads-up, switch off (main before this law): two of every three fixed bets are probes and no maniac class engages`, () => {
      HorseMind.setFixedLimitBetsAreNeverProbes(false);
      feed(100, fixedLimitManiacHand, scope, variant, 'fixed_limit');
      const s = HorseMind.getStats(OPP)!;
      expect(s.ctBets).toBe(300);
      expect(s.ctProbes).toBe(200);
      const read = readOf(scope, variant);
      expect(isPostflopManiac(read)).toBe(false);
    });
  }

  it('a no-limit probe bet is still a probe with the switch on', () => {
    HorseMind.setFixedLimitBetsAreNeverProbes(true);
    feed(40, noLimitMinBetHand, 'holdem:hu', 'nlh', 'no_limit');
    const s = HorseMind.getStats(OPP)!;
    expect(s.ctBets).toBe(120);
    expect(s.ctProbes).toBe(120);
    const read = readOf('holdem:hu', 'nlh');
    expect(read?.stats.betCheckedTo.engaged ?? null).toBeNull();
    expect(isPostflopManiac(read)).toBe(false);
  });

  it('no-limit counting is identical with the switch on or off, and with no structure given', () => {
    const tallies = (on: boolean, structure: BettingStructure | undefined) => {
      HorseMind.reset();
      HorseMind.setFixedLimitBetsAreNeverProbes(on);
      for (let h = 0; h < 12; h++) {
        const history = h % 2 ? noLimitMinBetHand() : fixedLimitManiacHand(h);
        HorseMind.observe(history, [], undefined, undefined, BB, structure as BettingStructure);
      }
      const s = HorseMind.getStats(OPP)!;
      return [s.ctBets, s.ctProbes, s.postAggr, s.aggr];
    };
    const base = tallies(false, undefined);
    expect(tallies(true, undefined)).toEqual(base);
    expect(tallies(true, 'no_limit')).toEqual(base);
    expect(tallies(true, 'pot_limit')).toEqual(base);
    expect(tallies(false, 'fixed_limit')).toEqual(base);
  });

  it('the production completed-hand learner hands the variant to the counter', () => {
    const request = (n: number, variant: string): ObserveCompletedHandRequest => ({
      type: 'OBSERVE_COMPLETED_HAND',
      requestId: n,
      generation: n,
      fence: `${TABLE}:${n}:9:observe`,
      handKey: `${TABLE}:${n}`,
      committedHandId: `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      bigBlind: BB,
      actions: fixedLimitManiacHand(0),
      showdown: null,
      riverCallContext: { variant, boardCount: 1 },
      scope: 'holdem:hu',
    });
    HorseMind.setFixedLimitBetsAreNeverProbes(true);
    // Hand numbers below a million carry no hand identity (HorseMindHandIdentity).
    learnCompletedHandInPersistedMemory(request(1_000_001, 'flh'), true);
    const fl = HorseMind.getStats(OPP)!;
    expect(fl.postAggr).toBe(3);
    expect(fl.ctBets ?? 0).toBe(0);
    learnCompletedHandInPersistedMemory(request(1_000_002, 'nlh'), true);
    expect(HorseMind.getStats(OPP)!.ctBets).toBe(3);
  });

  it('the in-decision observation hands the variant to the counter', () => {
    HorseMind.setFixedLimitBetsAreNeverProbes(true);
    const players = [
      { seat: 1, user_id: HERO },
      { seat: 2, user_id: OPP },
    ] as SeatPlayer[];
    const decide = (
      gameVariant: string,
      bettingStructure?: HorseGameStateV2['bettingStructure']
    ) => {
      HorseLogic.prepareOriginalReads(players[0]!, {
        gameVariant,
        ...(bettingStructure ? { bettingStructure } : {}),
        players,
        actionHistory: fixedLimitManiacHand(0),
        bigBlind: BB,
      } as unknown as HorseGameStateV2);
      HorseMind.setDecisionScope(null);
    };
    decide('flh');
    expect(HorseMind.getStats(OPP)!.postAggr).toBe(3);
    expect(HorseMind.getStats(OPP)!.ctBets ?? 0).toBe(0);
    decide('flo8', 'fixed_limit');
    expect(HorseMind.getStats(OPP)!.ctBets ?? 0).toBe(0);
    decide('nlh');
    expect(HorseMind.getStats(OPP)!.ctBets).toBe(3);
  });
});
