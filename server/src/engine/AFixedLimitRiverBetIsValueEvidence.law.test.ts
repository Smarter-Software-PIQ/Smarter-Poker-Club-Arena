/**
 * LAW: A FIXED-LIMIT RIVER BET THAT REACHES SHOWDOWN IS VALUE EVIDENCE
 * (2026-11-14, Fixed-Limit lane, T2).
 *
 * V83 (aggressionShownAsValue) keeps neutral respect for a bettor whose big
 * river bets that reached showdown were at least 75 percent strong, after 20
 * of them. It counted only river bets of at least 20 big blinds, which cannot
 * exist in fixed limit (one big bet is two big blinds), so a tight-value
 * fixed-limit bettor was read as a maniac (callDownMod 1.2) on his
 * aggression factor alone (O-TIGHT-FL-DIAGNOSIS). With the process switch
 * HorseMind.setFixedLimitRiverBetsAreValueEvidence on (SOURCE DEFAULT OFF),
 * every river bet or raise that reaches showdown in a fixed-limit hand is
 * counted. No-limit and pot-limit keep the 20-big-blind bar.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  FIXED_LIMIT_RIVER_BETS_ARE_VALUE_EVIDENCE_DEFAULT,
  HorseMind,
  V83_MIN_BIG_BET_SHOWDOWNS,
  aggressionShownAsValue,
} from './HorseMind.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';

const BB = 2;
const HERO = '60000000-0000-4000-8000-000000000001';
const VILLAIN = '60000000-0000-4000-8000-000000000002';
let hand = 0;
let ts = 5_000_000;

/** VILLAIN bets the river (amount chips), HERO calls, both show down. */
function showdownHands(
  n: number,
  variant: string | null,
  amount: number,
  villainHand: string
): void {
  for (let i = 0; i < n; i++) {
    const actions = [
      { userId: HERO, action: 'check', amount: 0, stage: 'river', timestamp: ts++ },
      { userId: VILLAIN, action: 'bet', amount, stage: 'river', timestamp: (ts += 3000) },
      { userId: HERO, action: 'call', amount, stage: 'river', timestamp: (ts += 3000) },
    ];
    HorseMind.observeHandComplete(
      `t2-${hand++}`,
      actions,
      BB,
      [
        { user_id: VILLAIN, mucked: false, hand_name: villainHand },
        { user_id: HERO, mucked: false, hand_name: 'pair' },
      ],
      null,
      false,
      variant ? { variant, boardCount: 1 } : undefined
    );
  }
}

const sd = () => HorseMind.getStats(VILLAIN)?.bigBetSD ?? 0;

afterEach(() => {
  HorseMind.setFixedLimitRiverBetsAreValueEvidence(
    FIXED_LIMIT_RIVER_BETS_ARE_VALUE_EVIDENCE_DEFAULT
  );
  HorseMind.reset();
});

describe('a fixed-limit river bet that reaches showdown is value evidence (switch on)', () => {
  it('the source default is off', () => {
    expect(FIXED_LIMIT_RIVER_BETS_ARE_VALUE_EVIDENCE_DEFAULT).toBe(false);
    expect(HorseMind.fixedLimitRiverBetsAreValueEvidenceOn()).toBe(false);
  });

  it('off (main): one-big-bet flh and flo8 river bets never reach the V83 tally', () => {
    for (const variant of ['flh', 'flo8']) {
      HorseMind.reset();
      showdownHands(V83_MIN_BIG_BET_SHOWDOWNS, variant, 2 * BB, 'two pair');
      expect(sd(), variant).toBe(0);
      expect(aggressionShownAsValue(HorseMind.getStats(VILLAIN)), variant).toBe(false);
    }
  });

  it('on: a tight-value fixed-limit bettor is shown as value after 20 showdowns', () => {
    enableBrainTelemetry();
    drainFires();
    HorseMind.setFixedLimitRiverBetsAreValueEvidence(true);
    for (const variant of ['flh', 'flo8']) {
      HorseMind.reset();
      showdownHands(V83_MIN_BIG_BET_SHOWDOWNS, variant, 2 * BB, 'two pair');
      expect(sd(), variant).toBe(V83_MIN_BIG_BET_SHOWDOWNS);
      expect(aggressionShownAsValue(HorseMind.getStats(VILLAIN)), variant).toBe(true);
    }
    expect(drainFires().some((f) => f.feature === 'fixed_limit_river_bet_showdown_counted')).toBe(
      true
    );
  });

  it('on: a fixed-limit bettor who shows weak hands is counted but not shown as value', () => {
    HorseMind.setFixedLimitRiverBetsAreValueEvidence(true);
    showdownHands(V83_MIN_BIG_BET_SHOWDOWNS, 'flh', 2 * BB, 'pair');
    expect(sd()).toBe(V83_MIN_BIG_BET_SHOWDOWNS);
    expect(aggressionShownAsValue(HorseMind.getStats(VILLAIN))).toBe(false);
  });

  it('on: no-limit, pot-limit and an unnamed variant keep the 20-big-blind bar', () => {
    HorseMind.setFixedLimitRiverBetsAreValueEvidence(true);
    for (const variant of ['nlh', 'plo4', 'plo8', null]) {
      HorseMind.reset();
      showdownHands(5, variant, 2 * BB, 'two pair');
      expect(sd(), String(variant)).toBe(0);
      showdownHands(5, variant, 20 * BB, 'two pair');
      expect(sd(), String(variant)).toBe(5);
    }
  });
});
