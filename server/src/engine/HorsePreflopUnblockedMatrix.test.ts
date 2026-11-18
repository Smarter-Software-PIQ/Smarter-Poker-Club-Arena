import { describe, expect, it } from 'vitest';
import type { Card, SeatPlayer } from '../types.js';
import { handClassRead, omahaHandClass, omahaSuitAndCoreQuality } from './HorseHandClasses.js';
import { premiumPreflopAnchors } from './HorseContinuation.js';
import { decidePreflopV7, type PreflopCtx } from './HorsePreflop.js';
import { analyzePreflopOrbit, analyzeV38CommittedPopulation } from './HorsePreflopOrbitState.js';
import {
  computeSevenDeuceOverlay,
  computeSideGamePotOverlay,
  holdsSevenDeuceHand,
  normalizeKillPotState,
} from './HorseSideGameOverlay.js';
import { defenceTargets } from './HorseGtoDefenceRanges.js';
import { continueShare, type Vs3BetSpot } from './HorseGtoVs3BetRanges.js';
import { omahaTournamentCoordinateShifts } from './HorseTournamentPreflop.js';
import {
  asymmetricCoverPressure,
  bountyChipEquivalence,
  pairwiseBubbleFactor,
} from './IcmModel.js';
import {
  evaluateTournamentUtilityDetailed,
  type TournamentUtilityInput,
} from './HorseTournamentUtility.js';
import { variantPreflopShift } from './HorseVariantProfile.js';

const SUIT_MAP: Record<string, Card['suit']> = {
  s: 'spades',
  h: 'hearts',
  d: 'diamonds',
  c: 'clubs',
};

function c(spec: string): Card {
  return {
    rank: spec.slice(0, -1) as Card['rank'],
    suit: SUIT_MAP[spec.slice(-1)]!,
  };
}

function cc(...specs: string[]): Card[] {
  return specs.map(c);
}

function mkPlayer(seat: number, over: Partial<SeatPlayer> = {}): SeatPlayer {
  return {
    seat,
    user_id: `p-${seat}`,
    username: `P${seat}`,
    stack: 200,
    bet: 0,
    totalInvested: 0,
    cards: [],
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
    is_horse: true,
    ...over,
  } as SeatPlayer;
}

function baseCtx(over: Partial<PreflopCtx> = {}): PreflopCtx {
  return {
    strength: 0.78,
    position: 'late',
    isButton: true,
    raiserPosition: 'middle',
    raises: 0,
    limpers: 0,
    callers: 0,
    oppsLeft: 3,
    toCall: 2,
    currentBet: 2,
    pot: 3,
    bigBlind: 2,
    stack: 200,
    stackBB: 100,
    effectiveStackBB: 100,
    tightness: 1,
    bluffFreq: 0.17,
    aggression: 1,
    slowplayFreq: 0.08,
    sizingMultiplier: 1,
    isOmaha: false,
    isPotLimit: false,
    riskAdd: 0,
    mode: 'cash',
    format: 'cash',
    rand: () => 0.25,
    ...over,
  };
}

describe('Unblocked Omaha Hand Classes & Multi-Card Structure (PLO4 / PLO5 / PLO6)', () => {
  it('retires NEVER_THREE_BET on double-suited broadways and rundowns while keeping dangler clamped', () => {
    const kqjtDs4 = handClassRead(cc('Ks', 'Qh', 'Js', 'Th'), true, false);
    expect(kqjtDs4.cls).toBe('broadway_ds');
    expect(kqjtDs4.neverThreeBet).toBe(false);

    const qqkjtDs5 = handClassRead(cc('Qs', 'Qh', 'Ks', 'Jh', 'Td'), true, false);
    expect(qqkjtDs5.cls).toBe('broadway_ds');
    expect(qqkjtDs5.neverThreeBet).toBe(false);
    expect(qqkjtDs5.shift.threeBet).toBeLessThan(0);

    const rundown6 = handClassRead(cc('Js', 'Th', '9s', '8h', '7d', '6d'), true, false);
    expect(rundown6.cls).toBe('rundown');
    expect(rundown6.neverThreeBet).toBe(false);

    const dangler4 = handClassRead(cc('As', 'Ks', 'Qh', '3c'), true, false);
    expect(dangler4.cls).toBe('dangler');
    expect(dangler4.neverThreeBet).toBe(true);
  });

  it('allows double-suited KQJT and QQKJTds to 3-bet IP and in squeezes across PLO4/PLO5/PLO6', () => {
    for (const [variant, cards] of [
      ['plo4', cc('Ks', 'Qh', 'Js', 'Th')],
      ['plo5', cc('Qs', 'Qh', 'Ks', 'Jh', 'Td')],
      ['plo6', cc('As', 'Ks', 'Qh', 'Jh', 'Td', '9d')],
    ] as const) {
      const read = handClassRead(cards, true, false);
      const q = omahaSuitAndCoreQuality(cards);
      const intent = decidePreflopV7(
        baseCtx({
          isOmaha: true,
          isPotLimit: true,
          raises: 1,
          raiserPosition: 'late',
          position: 'late',
          isButton: true,
          toCall: 7,
          currentBet: 7,
          pot: 10,
          strength: 0.91,
          omahaAA: false,
          omahaNutSuits: q.nutSuits,
          omahaTripleSuited: q.tripleSuited,
          variantShift: variantPreflopShift(variant),
          classShift: read.shift,
          classNeverThreeBet: read.neverThreeBet,
          classFoldAlways: read.foldAlways,
        })
      );
      expect(intent.a, `${variant} IP 3-bet`).toBe('raiseTo');
    }
  });

  it('rescues PLO5/PLO6 playable trips sub-cores (AAAKKds, AAAKQJds) while folding ragged AAAxxx', () => {
    const aaakk5 = handClassRead(cc('As', 'Ah', 'Ad', 'Ks', 'Kh'), true, false);
    expect(aaakk5.cls).toBe('trips');
    expect(aaakk5.foldAlways).toBe(false);

    const aaakqj6 = handClassRead(cc('As', 'Ah', 'Ad', 'Ks', 'Qs', 'Jh'), true, false);
    expect(aaakqj6.cls).toBe('trips');
    expect(aaakqj6.foldAlways).toBe(false);

    const ragged6 = handClassRead(cc('As', 'Ah', 'Ad', '8c', '4d', '2h'), true, false);
    expect(ragged6.cls).toBe('trips');
    expect(ragged6.foldAlways).toBe(true);

    const plo4Trips = handClassRead(cc('As', 'Ah', 'Ad', 'Ks'), true, false);
    expect(plo4Trips.foldAlways).toBe(true);
  });

  it('models Pigeonhole 3-of-a-suit waste, PLO6 2-2-2 triple-suitedness, and bare disconnected AA', () => {
    const triple6 = omahaSuitAndCoreQuality(cc('As', 'Ks', 'Qh', 'Jh', 'Td', '9d'));
    expect(triple6.tripleSuited).toBe(true);
    expect(triple6.cleanTwoCardSuits).toBe(3);
    expect(triple6.wastedSuitCards).toBe(0);
    expect(triple6.nutSuits).toBe(1);

    const overloaded6 = omahaSuitAndCoreQuality(cc('Qs', 'Js', '9s', '4s', '8h', '3d'));
    expect(overloaded6.overloadedSuits).toBe(1);
    expect(overloaded6.wastedSuitCards).toBe(2);

    const bareAA5 = omahaSuitAndCoreQuality(cc('Ad', 'Ac', '7d', '4s', '2h'));
    expect(bareAA5.bareDisconnectedAces).toBe(true);

    // Dan's PLO5 suited-aces complaint hand AdAcKd9d3h has Kd suited to Ad -> NOT bare!
    const noodleAA5 = omahaSuitAndCoreQuality(cc('Ad', 'Ac', 'Kd', '9d', '3h'));
    expect(noodleAA5.bareDisconnectedAces).toBe(false);
  });

  it('requires at least one King to be suited in HorseContinuation.premiumPreflopAnchors', () => {
    const fakePlo6Kings = premiumPreflopAnchors(cc('Kc', 'Kh', '7d', '2d', '8s', '3s'), {
      isOmaha: true,
      isShortDeck: false,
      isFixedLimit: false,
    });
    expect(fakePlo6Kings.suitedPremium).toBeUndefined();

    const realPlo6Kings = premiumPreflopAnchors(cc('Ks', 'Kh', 'Qs', 'Jh', '9d', '8c'), {
      isOmaha: true,
      isShortDeck: false,
      isFixedLimit: false,
    });
    expect(realPlo6Kings.suitedPremium).toBe('kings');
  });

  it('flats bare ragged AAxxxx >150bb facing a 3-bet while 4-betting connected/broadway suited AA', () => {
    const bareDeep = decidePreflopV7(
      baseCtx({
        isOmaha: true,
        isPotLimit: true,
        raises: 2,
        stack: 400,
        stackBB: 200,
        effectiveStackBB: 200,
        currentBet: 24,
        toCall: 17,
        pot: 34,
        strength: 0.72,
        omahaAA: true,
        omahaSuitedPremium: 'aces',
        omahaSuitedAcesFourBet: true,
        omahaBareAcesDeep: true,
        deepDiscipline: true,
      })
    );
    expect(bareDeep.a).toBe('call');

    const strongDeep = decidePreflopV7(
      baseCtx({
        isOmaha: true,
        isPotLimit: true,
        raises: 2,
        stack: 400,
        stackBB: 200,
        effectiveStackBB: 200,
        currentBet: 24,
        toCall: 17,
        pot: 34,
        strength: 0.72,
        omahaAA: true,
        omahaSuitedPremium: 'aces',
        omahaSuitedAcesFourBet: true,
        omahaBareAcesDeep: false,
        deepDiscipline: true,
      })
    );
    expect(strongDeep.a).toBe('raiseTo');
    expect(strongDeep.receipt).toBe('plo_suited_aces_four_bet');
  });
});

describe('8-Cell Action-Space Completeness Matrix ({NLH, PLO4, PLO5, PLO6} x {Cash, Tournament})', () => {
  const variants = ['nlh', 'plo4', 'plo5', 'plo6'] as const;
  const modes = ['cash', 'tournament'] as const;

  it.each(variants.flatMap((v) => modes.map((m) => [v, m] as const)))(
    'cell %s x %s supports open, iso, 3-bet, squeeze, 4-bet, 5-bet/call, straddle, and short-stack commitment',
    (variant, mode) => {
      const isOmaha = variant !== 'nlh';
      const isTourney = mode === 'tournament';
      const vShift = variantPreflopShift(variant);

      // 1. RFI Open
      const open = decidePreflopV7(
        baseCtx({
          mode,
          format: isTourney ? 'mtt' : 'cash',
          isOmaha,
          isPotLimit: isOmaha,
          anteInPlay: isTourney,
          anteOrbitBB: isTourney ? 1 : 0,
          ploTourney: isOmaha && isTourney,
          ploPriceDefense: isOmaha,
          variantShift: vShift,
          raises: 0,
          toCall: 2,
          currentBet: 2,
          pot: isTourney ? 5 : 3,
          strength: 0.82,
        })
      );
      expect(['raiseTo', 'jam']).toContain(open.a);

      // 2. Iso-raise vs 2 limpers
      const iso = decidePreflopV7(
        baseCtx({
          mode,
          format: isTourney ? 'mtt' : 'cash',
          isOmaha,
          isPotLimit: isOmaha,
          anteInPlay: isTourney,
          ploTourney: isOmaha && isTourney,
          variantShift: vShift,
          raises: 0,
          limpers: 2,
          isoWiden: 0.05,
          toCall: 2,
          currentBet: 2,
          pot: 7,
          strength: 0.84,
        })
      );
      expect(['raiseTo', 'jam']).toContain(iso.a);

      // 3. Multiway Squeeze (open + caller)
      const squeeze = decidePreflopV7(
        baseCtx({
          mode,
          format: isTourney ? 'mtt' : 'cash',
          isOmaha,
          isPotLimit: isOmaha,
          anteInPlay: isTourney,
          ploTourney: isOmaha && isTourney,
          variantShift: vShift,
          raises: 1,
          callers: 1,
          toCall: 6,
          currentBet: 6,
          pot: 15,
          strength: 0.91,
          holdsAce: true,
          omahaNutSuits: isOmaha ? 1 : undefined,
        })
      );
      expect(['raiseTo', 'jam']).toContain(squeeze.a);

      // 4. Facing 3-bet -> 4-bet
      const fourBet = decidePreflopV7(
        baseCtx({
          mode,
          format: isTourney ? 'mtt' : 'cash',
          isOmaha,
          isPotLimit: isOmaha,
          anteInPlay: isTourney,
          ploTourney: isOmaha && isTourney,
          variantShift: vShift,
          raises: 2,
          toCall: 14,
          currentBet: 20,
          pot: 29,
          strength: 0.97,
          holdemPremiumPair: !isOmaha,
          omahaSuitedAcesFourBet: isOmaha,
        })
      );
      expect(['raiseTo', 'jam']).toContain(fourBet.a);

      // 5. Facing Closed Short-Stack All-In 3-Bet at 24bb -> Call / Jam (not capped out)
      const closedCall = decidePreflopV7(
        baseCtx({
          mode,
          format: isTourney ? 'mtt' : 'cash',
          isOmaha,
          isPotLimit: isOmaha,
          anteInPlay: isTourney,
          ploTourney: isOmaha && isTourney,
          ploPriceDefense: isOmaha,
          variantShift: vShift,
          raises: 2,
          stack: 36,
          stackBB: 18,
          effectiveStackBB: 24,
          toCall: 24,
          currentBet: 36,
          pot: 51,
          facingClosedAllIn: true,
          strength: 0.82,
        })
      );
      expect(['call', 'jam', 'raiseTo']).toContain(closedCall.a);

      // 6. Straddled / Kill-Pot Unopened Transition (4x straddle)
      const straddleOpen = decidePreflopV7(
        baseCtx({
          mode,
          format: isTourney ? 'mtt' : 'cash',
          isOmaha,
          isPotLimit: isOmaha,
          straddled: true,
          raises: 0,
          toCall: 8,
          currentBet: 8,
          pot: 11,
          bigBlind: 2,
          stack: 400,
          stackBB: 200,
          variantShift: vShift,
          strength: 0.88,
        })
      );
      expect(straddleOpen.a).toBe('raiseTo');
      expect(straddleOpen.to!).toBeGreaterThan(8);
    }
  );
});

describe('Mid-Orbit Re-Entry, Incomplete All-Ins, V38 Isolation Guard & Side Games', () => {
  it('treats a sub-min short-stack all-in as incomplete so deep players face effectiveRaises=1', () => {
    const hero = mkPlayer(5, { stack: 200, bet: 0 });
    const orbit = analyzePreflopOrbit({
      heroSeat: hero.seat,
      heroStack: hero.stack,
      heroBet: hero.bet,
      bigBlind: 2,
      currentBet: 7.5,
      dealerSeat: 5,
      players: [
        mkPlayer(1, { stack: 199, bet: 1 }),
        mkPlayer(2, { stack: 198, bet: 2 }),
        mkPlayer(3, { stack: 194, bet: 6 }),
        mkPlayer(4, { stack: 0, bet: 7.5, is_all_in: true }),
        hero,
      ],
      history: [
        {
          seat: 3,
          userId: 'p-3',
          action: 'raise',
          amount: 6,
          stage: 'preflop',
          isFullRaise: true,
          timestamp: 1,
        },
        {
          seat: 4,
          userId: 'p-4',
          action: 'all_in',
          amount: 7.5,
          stage: 'preflop',
          isFullRaise: false,
          timestamp: 2,
        },
      ],
    });
    expect(orbit.raises).toBe(2);
    expect(orbit.fullRaises).toBe(1);
    expect(orbit.incompleteAllIns).toBe(1);
    expect(orbit.effectiveRaises).toBe(1);

    // Regression (#50 §2): when table has straddle_enabled (straddleActive: true)
    // but nobody posted a straddle on this deal (currentBet === bb, UTG.bet === 0),
    // UTG must NOT be mislabeled as post_straddle_or_kill or straddleAdjustedBehind=0.
    const utgHero = mkPlayer(3, { stack: 200, bet: 0 });
    const unstraddledDeal = analyzePreflopOrbit({
      heroSeat: utgHero.seat,
      heroStack: utgHero.stack,
      heroBet: utgHero.bet,
      bigBlind: 2,
      currentBet: 2,
      dealerSeat: 6,
      straddleActive: true,
      players: [
        mkPlayer(1, { stack: 199, bet: 1 }), // SB
        mkPlayer(2, { stack: 198, bet: 2 }), // BB
        utgHero, // UTG (did NOT post straddle)
        mkPlayer(4, { stack: 200, bet: 0 }),
        mkPlayer(5, { stack: 200, bet: 0 }),
        mkPlayer(6, { stack: 200, bet: 0 }),
      ],
      history: [],
    });
    expect(unstraddledDeal.straddleSeat).toBeNull();
    expect(unstraddledDeal.straddleUnopened).toBe(false);
    expect(unstraddledDeal.heroPriorAction).toBe('none');
    expect(unstraddledDeal.straddleAdjustedBehind).toBeUndefined();

    // Explicit straddleSeat (from HandController.getLastStraddleSeat) is honored directly
    const explicitReStraddle = analyzePreflopOrbit({
      heroSeat: 4,
      heroStack: 192,
      heroBet: 8,
      bigBlind: 2,
      currentBet: 8,
      dealerSeat: 6,
      straddleActive: true,
      straddleSeat: 4,
      players: [
        mkPlayer(1, { stack: 199, bet: 1 }),
        mkPlayer(2, { stack: 198, bet: 2 }),
        mkPlayer(3, { stack: 196, bet: 4 }),
        mkPlayer(4, { stack: 192, bet: 8 }),
        mkPlayer(5, { stack: 200, bet: 0 }),
        mkPlayer(6, { stack: 200, bet: 0 }),
      ],
      history: [],
    });
    expect(explicitReStraddle.straddleSeat).toBe(4);
    expect(explicitReStraddle.heroPriorAction).toBe('post_straddle_or_kill');
    expect(explicitReStraddle.isOptionCheckAvailable).toBe(true);
    expect(explicitReStraddle.straddleAdjustedBehind).toBe(0);
  });

  it('distinguishes squeezed opener from cold-called 3-bet multiway pot', () => {
    const hero = mkPlayer(3, { stack: 194, bet: 6 });
    const coldCalled3Bet = analyzePreflopOrbit({
      heroSeat: hero.seat,
      heroStack: hero.stack,
      heroBet: hero.bet,
      bigBlind: 2,
      currentBet: 20,
      dealerSeat: 6,
      players: [
        mkPlayer(1, { stack: 199, bet: 1, is_folded: true }),
        mkPlayer(2, { stack: 180, bet: 20 }),
        hero,
        mkPlayer(4, { stack: 180, bet: 20 }),
      ],
      history: [
        {
          seat: 3,
          userId: 'p-3',
          action: 'raise',
          amount: 6,
          stage: 'preflop',
          isFullRaise: true,
          timestamp: 1,
        },
        {
          seat: 4,
          userId: 'p-4',
          action: 'raise',
          amount: 20,
          stage: 'preflop',
          isFullRaise: true,
          timestamp: 2,
        },
        {
          seat: 2,
          userId: 'p-2',
          action: 'call',
          amount: 20,
          stage: 'preflop',
          timestamp: 3,
        },
      ],
    });
    expect(coldCalled3Bet.heroWasInitialRaiser).toBe(true);
    expect(coldCalled3Bet.squeezed).toBe(false);
    expect(coldCalled3Bet.facingColdCalledThreeBet).toBe(true);

    // Cold-called 3-bet narrows V73 continueShare relative to heads-up 3-bet
    const baseSpot: Vs3BetSpot = {
      openerBehind: 3,
      ip: false,
      ante: false,
      dealt: 6,
      threeBetX: 3.3,
      potBeforeBB: 4,
      reRaiseRiskBB: 9,
      effectiveBB: 100,
      deepDiscipline: true,
    };
    expect(continueShare({ ...baseSpot, coldCallersOfThreeBet: 1 })).toBeLessThan(
      continueShare(baseSpot)
    );
  });

  it('blocks V38 100bb isolation re-jam punts when an uncapped deep stack acts behind a short all-in', () => {
    const hero = mkPlayer(4, { stack: 200, bet: 0 });
    const v38 = analyzeV38CommittedPopulation({
      players: [
        mkPlayer(1, { stack: 220, bet: 6 }), // UTG opener uncapped 113bb behind!
        mkPlayer(2, { stack: 0, bet: 18, is_all_in: true }), // 9bb short-stack jam
        hero,
      ],
      heroSeat: hero.seat,
      heroBet: hero.bet,
      heroStack: hero.stack,
      effCall: 18,
      currentBet: 18,
      bigBlind: 2,
      firstRaiserSeat: 1,
      lastRaiserSeat: 2,
      raiserAllIn: true,
    });
    expect(v38.committedOpponents).toHaveLength(1);
    expect(v38.otherLiveResponder).toBe(true);
    expect(v38.uncappedCoveringOpponentsBehind).toBe(1);
    expect(v38.uncappedBehindMargin).toBeGreaterThan(0);
    expect(v38.allowIsolationJam).toBe(false);
  });

  it('models 7-2 bounty overlays (only when flop seen / sweepable) and full Kill Pot effective blinds', () => {
    expect(holdsSevenDeuceHand(cc('7s', '2d'))).toBe(true);
    expect(holdsSevenDeuceHand(cc('7s', '7d'))).toBe(false);

    const sixDealt = [1, 2, 3, 4, 5, 6].map((s) => mkPlayer(s, { stack: 200 }));
    // Preflop walk does NOT win 7-2 bounty; preflop overlay is discounted by flop-seen realization
    const pre72 = computeSevenDeuceOverlay({
      gameVariant: 'nlh',
      isTournament: false,
      stage: 'preflop',
      bigBlind: 2,
      pot: 3,
      currentBet: 2,
      heroSeat: 1,
      heroStack: 200,
      heroCards: cc('7s', '2h'),
      players: sixDealt,
      sevenDeuceEnabled: true,
      sevenDeuceBountyBB: 3,
    });
    expect(pre72.heroHoldsSevenDeuce).toBe(true);
    expect(pre72.collectibleBountyChips).toBe(30);
    expect(pre72.preflopStrengthBonus).toBe(0.15);
    expect(pre72.effectivePotOverlayChips).toBeLessThan(30);

    const flop72 = computeSevenDeuceOverlay({
      gameVariant: 'nlh',
      isTournament: false,
      stage: 'flop',
      bigBlind: 2,
      pot: 12,
      currentBet: 0,
      heroSeat: 1,
      heroStack: 194,
      heroCards: cc('7s', '2h'),
      players: sixDealt,
      sevenDeuceEnabled: true,
      sevenDeuceBountyBB: 3,
    });
    // 5 non-hero dealt players * 6 chips = 30 chips full postflop sweep bonus!
    expect(flop72.effectivePotOverlayChips).toBe(30);

    const kill = normalizeKillPotState(
      {
        bigBlind: 2,
        pot: 7,
        currentBet: 4,
        heroSeat: 5,
        heroStack: 200,
        killPot: {
          ruleVersion: 'kill-v1',
          mode: 'full',
          multiplier: { num: 2, den: 1 },
          baseBigBlind: 2,
          smallBet: 4,
          bigBet: 8,
          killBlind: 4,
          killerSeat: 5,
          killerUserId: 'p-5',
          killerBlindSlot: 'none',
          triggerHandId: 'hand-0',
          triggerHandNumber: 1,
          chained: false,
          thresholdBb: 10,
        },
      },
      0
    );
    expect(kill.active).toBe(true);
    expect(kill.effectiveBigBlind).toBe(4);
    expect(kill.isHeroKillerOption).toBe(true);

    const side = computeSideGamePotOverlay({
      bigBlind: 2,
      pot: 12,
      currentBet: 4,
      heroSeat: 1,
      heroStack: 200,
      heroCards: cc('7s', '2c'),
      stage: 'flop',
      isTournament: false,
      gameVariant: 'nlh',
      sevenDeuceEnabled: true,
      sevenDeuceBountyBB: 2,
      players: [mkPlayer(1), mkPlayer(2), mkPlayer(3)],
    });
    expect(side.postflopPotOverlayChips).toBe(8);

    // Non-killer seat opening a Full Kill pot (currentBet = 4, bb = 2, effectiveRaises = 0,
    // killPotUnopened = true, straddled = false) enters the unopened branch sized off openUnit=4
    // (never falling through into the 3-bet/4-bet else branch!).
    const killOpen = decidePreflopV7(
      baseCtx({
        raises: 0,
        effectiveRaises: 0,
        killPotUnopened: true,
        straddled: false,
        bigBlind: 2,
        currentBet: 4,
        toCall: 4,
        pot: 7,
        stack: 200,
        stackBB: 100,
        strength: 0.82,
        heroPriorAction: 'none',
      })
    );
    expect(killOpen.a).toBe('raiseTo');
    expect(killOpen.receipt).toBe('v74_nlh_open_size');
    expect(killOpen.to!).toBeGreaterThanOrEqual(8);

    // Medium hand (0.52) folds cleanly first-in on an unopened Kill Pot (does NOT price-in call or 4-bet)
    const killFold = decidePreflopV7(
      baseCtx({
        position: 'early',
        isButton: false,
        raises: 0,
        effectiveRaises: 0,
        killPotUnopened: true,
        straddled: false,
        bigBlind: 2,
        currentBet: 4,
        toCall: 4,
        pot: 11,
        stack: 200,
        stackBB: 100,
        strength: 0.42,
        heroPriorAction: 'none',
      })
    );
    expect(killFold.a).toBe('fold');

    // Type-check & behavior check for iso_raise and post_straddle_or_kill on PreflopCtx
    const postedKillDefend = decidePreflopV7(
      baseCtx({
        position: 'middle',
        isButton: false,
        raises: 1,
        effectiveRaises: 1,
        bigBlind: 2,
        currentBet: 12,
        toCall: 8,
        pot: 19,
        stack: 196,
        stackBB: 98,
        strength: 0.62,
        heroPriorAction: 'post_straddle_or_kill',
      })
    );
    expect(['call', 'raiseTo']).toContain(postedKillDefend.a);
  });

  it('widens multiway tournament BB defense while linearizing squeezes in HorseGtoDefenceRanges & Omaha coordinate shifts', () => {
    const single = defenceTargets({
      dealt: 6,
      defender: 'bb',
      openerBehind: 2,
      defenderBehind: 0,
      ante: true,
      openToBB: 2.2,
      callers: 0,
    });
    const multi = defenceTargets({
      dealt: 6,
      defender: 'bb',
      openerBehind: 2,
      defenderBehind: 0,
      ante: true,
      openToBB: 2.2,
      callers: 1,
    });
    expect(multi.cont).toBeGreaterThan(single.cont);

    const omahaTourney = omahaTournamentCoordinateShifts({
      variant: 'plo5',
      tableSize: 6,
      heroPosition: 'BB',
      raiserPosition: 'BTN',
      anteType: 'big_blind',
      branch: 'bb_defense',
      stackBB: 22,
    });
    expect(omahaTourney.call).toBeLessThan(0);
  });
});

describe('Asymmetric Cover ICM, Satellite Cliffs, Bounty Chip Equivalence & Phase 7 Preflop Utility', () => {
  it('computes asymmetric pairwise bubble factors and cover leverage on MTT & satellite bubbles', () => {
    // 4 players left, 3 paid (50 / 30 / 20): stacks [60, 22, 12, 6]
    const stacks = [60, 22, 12, 6];
    const payouts = [50, 30, 20];
    const bigCoverVsMed = asymmetricCoverPressure({
      stacks,
      payouts,
      heroIdx: 0,
      villainIdx: 1,
      riskChips: 22,
    });
    expect(bigCoverVsMed.villainBubbleFactor).toBeGreaterThan(bigCoverVsMed.heroBubbleFactor);
    expect(bigCoverVsMed.coverLeverage).toBeGreaterThan(0.2);

    // Satellite: 4 left for 3 seats — big stack [50] vs medium [25] with short [5] clinging on
    const sat = asymmetricCoverPressure({
      stacks: [50, 25, 20, 5],
      payouts: [33.33, 33.33, 33.34],
      heroIdx: 0,
      villainIdx: 1,
      riskChips: 25,
      satellite: true,
      satelliteSeats: 3,
    });
    expect(sat.villainBubbleFactor).toBeGreaterThan(2.5);
    expect(sat.coverLeverage).toBeGreaterThan(0.5);
    expect(pairwiseBubbleFactor([50, 25, 20, 5], [1, 1, 1], 1, 0, 25)).toBeGreaterThan(2.5);
  });

  it('converts PKO / KO / active Mystery bounties into exact chip & BB overlays', () => {
    // $100 PKO ($50 regular + $50 bounty), 10,000 starting stack, BB = 100
    // Collectible bounty = $25 = 50% of $50 regular buy-in = 5,000 chips (50 BB) at start!
    const pko = bountyChipEquivalence({
      headBountyCents: 5_000,
      isPko: true,
      buyInCents: 10_000,
      startingStackChips: 10_000,
      bigBlind: 100,
      heroCoversTarget: true,
    });
    expect(pko.collectibleCents).toBe(2_500);
    expect(pko.bountyOverlayChips).toBeCloseTo(5_000, 6);
    expect(pko.bountyOverlayBB).toBeCloseTo(50, 6);

    // Pending mystery bounty before ITM gives 0 overlay; active mystery bounty gives mean envelope
    expect(
      bountyChipEquivalence({
        headBountyCents: 0,
        isPko: false,
        isMysteryBounty: true,
        mysteryBountyActive: false,
        mysteryMeanCents: 10_000,
        buyInCents: 10_000,
        startingStackChips: 10_000,
        bigBlind: 200,
        heroCoversTarget: true,
      }).bountyOverlayChips
    ).toBe(0);
    expect(
      bountyChipEquivalence({
        headBountyCents: 0,
        isPko: false,
        isMysteryBounty: true,
        mysteryBountyActive: true,
        mysteryMeanCents: 10_000,
        buyInCents: 10_000,
        startingStackChips: 10_000,
        bigBlind: 200,
        heroCoversTarget: true,
      }).bountyOverlayBB
    ).toBeCloseTo(50, 6);
  });

  it('allows Phase 7 preflop utility to select a dominant non-terminal raise and models cover bubble fold elasticity', () => {
    const hero = mkPlayer(1, { user_id: 'hero', stack: 6_000, bet: 100, totalInvested: 100 });
    const villain = mkPlayer(2, { user_id: 'villain', stack: 2_200, bet: 200, totalInvested: 200 });
    const samples = Array.from({ length: 64 }, (_, idx) => ({
      boards: [
        {
          heroHigh: 900,
          opponentHigh: [300],
          opponentDecisionStrength: [0.35 + (idx % 4) * 0.1],
          heroLow: null,
          opponentLow: [null],
        },
      ],
    }));
    const utilInput: TournamentUtilityInput = {
      street: 'preflop',
      hero,
      players: [
        { ...hero, cards: [] },
        { ...villain, cards: [] },
      ],
      pots: [{ amount: 300, eligiblePlayers: ['hero', 'villain'] }],
      pot: 300,
      currentBet: 200,
      toCall: 100,
      legalActions: ['fold', 'raise'],
      minRaiseTo: 700,
      maxRaiseTo: 700,
      bettingStructure: 'pot_limit',
      baseline: { action: 'fold', thinkTime: 0 },
      heroEquity: 1,
      equitySampleSize: 64,
      equityStandardError: 0,
      opponents: [{ userId: 'villain', range: [0.2, 0.8], foldMul: 1, actsAfterHero: true }],
      sampledOpponentIds: ['villain'],
      showdownSamples: samples,
      context: {
        format: 'mtt',
        playersLeft: 4,
        spotsPaid: 3,
        satellite: false,
        satelliteSeats: 0,
        payoutPct: [50, 30, 20],
        fieldStacks: [6_100, 2_400, 1_200, 600],
        fieldStackByUser: { hero: 6_100, villain: 2_400 },
        isPko: false,
        isBounty: false,
        isMysteryBounty: false,
        mysteryBountyStage: 'none',
        bountyFactor: 0,
        bountyByUser: {},
        mysteryMeanCents: 0,
        meanBountyCents: 0,
        prizePoolCents: 100_000,
        bountyPoolCents: 0,
        reentryOpen: false,
        rebuyOpen: false,
        maxReentries: null,
        maxRebuys: null,
        addOnPeriodOpen: false,
        addOnCostCents: null,
        addOnChips: null,
        buyInCents: 10_000,
        startingStackChips: 10_000,
        rebuyCostCents: null,
        rebuyChips: null,
        rebuyPrizeContributionCents: null,
        rebuyBountyContributionCents: null,
        reloadsUsed: 0,
        addOnTaken: false,
        rebuyAffordable: null,
        addOnAffordable: null,
      },
    };
    const legacyClamped = evaluateTournamentUtilityDetailed({
      ...utilInput,
      v86AsymmetricIcmAndPreflop: false,
    });
    expect(legacyClamped.result!.ledger.baselineRetainedForContinuation).toBe(true);
    expect(legacyClamped.result!.decision.action).toBe('fold');

    const out = evaluateTournamentUtilityDetailed(utilInput);
    expect(out.unavailableReason).toBeNull();
    expect(out.result).not.toBeNull();
    expect(out.result!.ledger.baselineRetainedForContinuation).toBe(false);
    expect(out.result!.decision.action).toBe('raise');
    expect(out.result!.decision.amount).toBe(700);
  });
});
