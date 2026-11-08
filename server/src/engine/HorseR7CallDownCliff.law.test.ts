/**
 * LAW: AN AGGRESSIVE VALUE BETTOR IS NOT A BLUFFER, AND A CLOCK IS NOT A READ
 * (V31 R7 qualification, diagnosed 2026-11-06/07).
 *
 * R7 failed qualification at -5.54 bb/100 league cash. HorseMind's legacy
 * exploit read called any opponent with postflop aggression factor above 2.5
 * a maniac and multiplied call-down by 1.2, which switches off every one-pair
 * fold and shade layer at once. Horse-vs-horse play sits at AF ~2.43; R7's
 * aggressive-but-strong river betting lifted the opponent read to 2.66 in one
 * pass, so the horses called down one pair against bets that were value.
 *
 * Two fixes closed the cliff, and this law holds both closed through the real
 * observation path (HorseMind.observe and observeHandComplete, not imported
 * counters - HorseMindAggressionNeedsBluffs.test.ts pins the read on imported
 * counters and in HorseLogic.decide):
 *   1. V83 (#9771): an aggression read needs showdown evidence of bluffs. An
 *      opponent whose AF is past the line but whose big river bets show down
 *      strong keeps neutral respect; an opponent whose big bets show down as
 *      bluffs is still called down lighter.
 *   2. #9896: forced (automatic, clock) actions are not choices. A timed-out
 *      fold or check must not move the fold-to-pressure, aggression, c-bet or
 *      3-bet counters the reads are built from.
 *
 * A red law means the R7 cliff is open again. Fix the read, never the fixture.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HorseMind, V83_MIN_BIG_BET_SHOWDOWNS } from './HorseMind.js';
import type { AcceptedActionOrigin, ActionRecord, SeatPlayer } from '../types.js';

const BB = 2;
const HERO = 'hero';
const VILLAIN = 'villain';

const PLAYERS = [
  {
    seat: 1,
    user_id: HERO,
    stack: 10000,
    bet: 0,
    is_folded: false,
    is_sitting_out: false,
    cards: [],
  },
  {
    seat: 2,
    user_id: VILLAIN,
    stack: 10000,
    bet: 0,
    is_folded: false,
    is_sitting_out: false,
    cards: [],
  },
] as unknown as SeatPlayer[];

type Step = [
  user: string,
  stage: ActionRecord['stage'],
  action: string,
  amount: number,
  origin?: AcceptedActionOrigin,
];

let clock = 1_800_000_000_000;
let handNo = 0;

/** One heads-up hand into both observers, exactly as the engine feeds them. */
function play(
  steps: readonly Step[],
  showdown: Array<{ user_id: string; mucked: boolean; hand_name?: string }> | null = null
): void {
  handNo++;
  const history: ActionRecord[] = steps.map(([user, stage, action, amount, origin]) => ({
    seat: user === HERO ? 1 : 2,
    userId: user,
    action: action as ActionRecord['action'],
    amount,
    stage,
    timestamp: (clock += 1000),
    ...(action === 'bet' || action === 'raise' ? { isFullRaise: true } : {}),
    ...(origin ? { origin } : {}),
  }));
  HorseMind.observe(history, PLAYERS);
  HorseMind.observeHandComplete(`r7-law:${handNo}`, history, BB, showdown);
}

/** Villain raises, then bets flop, turn and a 30bb river into a hero who calls
 *  down: three postflop aggressions and one big river bet that reaches showdown. */
function valueBetHand(villainShows: { mucked: boolean; hand_name?: string }): void {
  play(
    [
      [VILLAIN, 'preflop', 'raise', 6],
      [HERO, 'preflop', 'call', 4],
      [HERO, 'flop', 'check', 0],
      [VILLAIN, 'flop', 'bet', 8],
      [HERO, 'flop', 'call', 8],
      [HERO, 'turn', 'check', 0],
      [VILLAIN, 'turn', 'bet', 20],
      [HERO, 'turn', 'call', 20],
      [HERO, 'river', 'check', 0],
      [VILLAIN, 'river', 'bet', 30 * BB],
      [HERO, 'river', 'call', 30 * BB],
    ],
    [
      { user_id: HERO, mucked: true },
      { user_id: VILLAIN, ...villainShows },
    ]
  );
}

/** Hero bets and villain calls flop, turn and a small river bet: three
 *  postflop passive actions for villain, no big bet. */
function calledDownHand(): void {
  play([
    [HERO, 'preflop', 'raise', 6],
    [VILLAIN, 'preflop', 'call', 4],
    [VILLAIN, 'flop', 'check', 0],
    [HERO, 'flop', 'bet', 8],
    [VILLAIN, 'flop', 'call', 8],
    [VILLAIN, 'turn', 'check', 0],
    [HERO, 'turn', 'bet', 20],
    [VILLAIN, 'turn', 'call', 20],
    [VILLAIN, 'river', 'check', 0],
    [HERO, 'river', 'bet', 10],
    [VILLAIN, 'river', 'call', 10],
  ]);
}

/**
 * The R7 shape: 8 value-bet hands to 3 called-down hands is AF 24/9 = 2.67,
 * the 2.66 the R7 league read. Three cycles give 24 big-bet showdowns, past
 * the V83 sample, and 33 hands, past full read confidence.
 */
function r7Opponent(strongShare: number): void {
  let shown = 0;
  let strong = 0;
  for (let cycle = 0; cycle < 3; cycle++) {
    for (let i = 0; i < 8; i++) {
      const isStrong = strong < Math.round(strongShare * (shown + 1));
      valueBetHand(isStrong ? { mucked: false, hand_name: 'Two Pair' } : { mucked: true });
      shown++;
      if (isStrong) strong++;
    }
    for (let i = 0; i < 3; i++) calledDownHand();
  }
}

const af = (id: string): number => {
  const s = HorseMind.getStats(id)!;
  return s.postAggr / Math.max(1, s.postPassive);
};

beforeEach(() => HorseMind.reset());
afterEach(() => HorseMind.reset());

describe('R7 law 1: aggression is not a bluff read without bluffs at showdown', () => {
  it('the fixture is the R7 opponent: past the AF line, with a full big-bet showdown sample', () => {
    r7Opponent(1);
    const s = HorseMind.getStats(VILLAIN)!;
    expect(af(VILLAIN)).toBeGreaterThan(2.5);
    expect(af(VILLAIN)).toBeLessThan(2.75);
    expect(s.hands).toBe(33);
    expect(s.bigBetSD).toBe(24);
    expect(s.bigBetSD).toBeGreaterThanOrEqual(V83_MIN_BIG_BET_SHOWDOWNS);
    expect(s.bigBetSDStrong).toBe(24);
    // No credible exploit read engages: this is the legacy ratio read alone.
    expect(HorseMind.opponentRead(VILLAIN)).toBeNull();
  });

  it('a value-backed aggressor keeps neutral call-down respect (the R7 cliff stays closed)', () => {
    r7Opponent(1);
    expect(HorseMind.exploit(VILLAIN).callDownMod).toBe(1);
    expect(HorseMind.exploit(VILLAIN, false).callDownMod).toBe(1);
    expect(HorseMind.tableExploit(1, PLAYERS).callDownMod).toBe(1);
  });

  it('R7 qualification share (85% strong) keeps neutral respect', () => {
    r7Opponent(0.85);
    const s = HorseMind.getStats(VILLAIN)!;
    expect(s.bigBetSDStrong / s.bigBetSD).toBeGreaterThanOrEqual(0.75);
    expect(s.bigBetSDStrong / s.bigBetSD).toBeLessThan(0.9);
    expect(HorseMind.exploit(VILLAIN).callDownMod).toBe(1);
  });

  it('the cliff is real on this fixture: the pre-V83 ratio-only read is the 1.2 call-down', () => {
    r7Opponent(1);
    expect(
      HorseMind.exploit(VILLAIN, true, { aggressionNeedsBluffs: false }).callDownMod
    ).toBeCloseTo(1.2, 10);
  });

  it('an aggressor whose big bets show down as bluffs is still called down lighter', () => {
    r7Opponent(0.5);
    const s = HorseMind.getStats(VILLAIN)!;
    expect(af(VILLAIN)).toBeGreaterThan(2.5);
    expect(s.bigBetSD).toBe(24);
    expect(s.bigBetSDStrong).toBe(12);
    expect(HorseMind.exploit(VILLAIN).callDownMod).toBeCloseTo(1.2, 10);
    expect(HorseMind.tableExploit(1, PLAYERS).callDownMod).toBeCloseTo(1.2, 10);
  });
});

describe('R7 law 2: a forced action is not an opponent read', () => {
  /** Villain's real hands: called down, 48 faced-aggression decisions and no folds. */
  const realHands = (): void => {
    for (let i = 0; i < 12; i++) calledDownHand();
  };
  /** Hero bets the flop and villain folds to it, with the given origin. */
  const foldToFlopBet = (origin: AcceptedActionOrigin): void =>
    play([
      [HERO, 'preflop', 'raise', 6],
      [VILLAIN, 'preflop', 'call', 4],
      [VILLAIN, 'flop', 'check', 0],
      [HERO, 'flop', 'bet', 8],
      [VILLAIN, 'flop', 'fold', 0, origin],
    ]);
  /** Villain's river check on the clock after a called flop. */
  const clockCheck = (): void =>
    play([
      [VILLAIN, 'preflop', 'raise', 6],
      [HERO, 'preflop', 'call', 4],
      [HERO, 'flop', 'check', 0],
      [VILLAIN, 'flop', 'bet', 8],
      [HERO, 'flop', 'call', 8],
      [HERO, 'turn', 'check', 0],
      [VILLAIN, 'turn', 'check', 0, 'forced'],
      [HERO, 'river', 'check', 0],
      [VILLAIN, 'river', 'check', 0, 'forced'],
    ]);
  const counters = () => {
    const s = HorseMind.getStats(VILLAIN)!;
    return {
      folds: s.folds,
      facedAggr: s.facedAggr,
      rFolds: s.rFolds,
      rFacedAggr: s.rFacedAggr,
      checks: s.checks,
      rChecks: s.rChecks,
      postAggr: s.postAggr,
      postPassive: s.postPassive,
      cbetOpps: s.cbetOpps,
      cbetFolds: s.cbetFolds,
      f3bOpps: s.f3bOpps,
      f3bFolds: s.f3bFolds,
    };
  };

  it('timed-out folds to pressure move no fold-to-pressure or c-bet counter', () => {
    realHands();
    const before = counters();
    for (let i = 0; i < 20; i++) foldToFlopBet('forced');
    const after = counters();
    // The preflop call and flop check in those hands were real choices; the
    // fold was the clock. Only the fold-side counters are pinned.
    expect(after.folds).toBe(before.folds);
    expect(after.rFolds).toBe(before.rFolds);
    expect(after.cbetFolds).toBe(before.cbetFolds);
    expect(after.cbetOpps).toBe(before.cbetOpps);
    expect(after.facedAggr).toBe(before.facedAggr + 20); // the 20 preflop calls to a raise
  });

  it('control: the same folds made by the player are a fold-to-pressure read', () => {
    realHands();
    const before = counters();
    for (let i = 0; i < 20; i++) foldToFlopBet('player');
    const after = counters();
    expect(after.folds).toBe(before.folds + 20);
    expect(after.cbetFolds).toBe(before.cbetFolds + 20);
    expect(after.cbetOpps).toBe(before.cbetOpps + 20);
  });

  it('timed-out folds do not turn a station into a folder the horses bluff', () => {
    /** Villain opens and folds to hero's flop lead: the fold is the only
     *  faced-aggression decision in the hand. */
    const foldToLead = (origin: AcceptedActionOrigin): void =>
      play([
        [VILLAIN, 'preflop', 'raise', 6],
        [HERO, 'preflop', 'call', 4],
        [HERO, 'flop', 'bet', 8],
        [VILLAIN, 'flop', 'fold', 0, origin],
      ]);
    for (let i = 0; i < 6; i++) calledDownHand();
    for (let i = 0; i < 20; i++) foldToLead('forced');
    const forced = HorseMind.exploit(VILLAIN);
    expect(HorseMind.getStats(VILLAIN)!.folds).toBe(0);
    HorseMind.reset();
    for (let i = 0; i < 6; i++) calledDownHand();
    for (let i = 0; i < 20; i++) foldToLead('player');
    const chosen = HorseMind.exploit(VILLAIN);
    expect(HorseMind.getStats(VILLAIN)!.folds).toBe(20);
    // On the clock the villain is still the 0-fold station the horses value
    // bet and do not bluff; 20 chosen folds over 44 faced decisions are not.
    expect(forced.bluffMod).toBeLessThan(1);
    expect(chosen.bluffMod).toBeGreaterThan(forced.bluffMod);
  });

  it('clock checks move no check or aggression counter', () => {
    realHands();
    const before = counters();
    for (let i = 0; i < 10; i++) clockCheck();
    const after = counters();
    expect(after.checks).toBe(before.checks);
    expect(after.rChecks).toBe(before.rChecks);
    // Villain's preflop raise and flop bet were chosen and still count.
    expect(after.postAggr).toBe(before.postAggr + 10);
    expect(after.postPassive).toBe(before.postPassive);
  });

  it('a timed-out fold to a 3-bet is not a fold-to-3-bet read; a chosen one is', () => {
    const threeBet = (origin: AcceptedActionOrigin) =>
      play([
        [VILLAIN, 'preflop', 'raise', 6],
        [HERO, 'preflop', 'raise', 18],
        [VILLAIN, 'preflop', 'fold', 0, origin],
      ]);
    for (let i = 0; i < 10; i++) threeBet('forced');
    expect(counters().f3bOpps).toBe(0);
    expect(counters().f3bFolds).toBe(0);
    for (let i = 0; i < 10; i++) threeBet('player');
    expect(counters().f3bOpps).toBe(10);
    expect(counters().f3bFolds).toBe(10);
  });
});
