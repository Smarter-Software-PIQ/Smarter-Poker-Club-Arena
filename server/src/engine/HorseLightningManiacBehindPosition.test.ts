/**
 * Regression test: on a Lightning early look at the deal (raises === 0, earlier
 * seats unacted), maniacBehindWidth and observedExtremeManiac must inspect ONLY
 * seats that act BEHIND Hero in preflop action order, never seats sitting in
 * front of Hero (e.g. UTG/HJ/CO when Hero is BTN or SB).
 *
 * Without the pBehindM < heroBehindM guard, an unacted maniac at UTG triggers
 * maniacBehindWidth -> maniacOpenBar on a BTN/CO/SB early look at the deal,
 * causing medium-strong opens to fast-fold for a villain sitting in front of
 * Hero.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
type SeatPlayer = Parameters<typeof HorseLogic.decide>[0];
import { HorseMind } from './HorseMind.js';
import type { OpponentExploitRead } from './HorseOpponentExploit.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { restoreFastRandom, saveFastRandom, seedFastRandom } from './HorseEval.js';

const id = (seat: number) => `00000000-0000-4000-8000-00000000000${seat}`;

function maniacRead(): OpponentExploitRead {
  const base = { engaged: null, mean: 0.2, excess: 0, lower: 0, upper: 1 };
  const stats = Object.fromEntries(
    ['vpip', 'pfr', 'rfi', 'threeBet', 'foldTo3Bet', 'betCheckedTo', 'foldToBet', 'riverCall'].map(
      (k) => [
        k,
        k === 'pfr'
          ? { ...base, engaged: 'high', mean: 0.85, lower: 0.72, upper: 0.95 }
          : k === 'threeBet'
            ? { ...base, engaged: 'high', mean: 0.45, lower: 0.32, upper: 0.6 }
            : base,
      ]
    )
  );
  return {
    presumed: false,
    stats,
  } as unknown as OpponentExploitRead;
}

/** Six seats (1 SB, 2 BB, 3 UTG, 4 HJ, 5 CO, 6 BTN), Lightning early look at deal. */
function dealState(opts: {
  heroSeat: number;
  heroCards: Array<{ rank: string; suit: string }>;
  variant?: 'nlh' | 'plo5';
  straddleActive?: boolean;
}): { player: SeatPlayer; gs: HorseGameStateV2 } {
  const isStraddle = opts.straddleActive === true;
  const players = [1, 2, 3, 4, 5, 6].map((seat) => ({
    seat,
    user_id: id(seat),
    stack: 200,
    bet: seat === 3 && isStraddle ? 4 : seat === 2 ? 2 : seat === 1 ? 1 : 0,
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
    cards: seat === opts.heroSeat ? opts.heroCards : [],
  }));
  const hero = players.find((p) => p.seat === opts.heroSeat)! as unknown as SeatPlayer;
  const history: object[] = [
    {
      seat: 1,
      userId: id(1),
      action: 'small_blind',
      amount: 1,
      timestamp: 0,
      stage: 'preflop',
      origin: 'forced',
    },
    {
      seat: 2,
      userId: id(2),
      action: 'big_blind',
      amount: 2,
      timestamp: 0,
      stage: 'preflop',
      origin: 'forced',
    },
  ];
  if (isStraddle) {
    history.push({
      seat: 3,
      userId: id(3),
      action: 'straddle',
      amount: 4,
      timestamp: 0,
      stage: 'preflop',
      origin: 'forced',
    });
  }
  const pot = isStraddle ? 7 : 3;
  const currentBet = isStraddle ? 4 : 2;
  const gs = {
    heroSeat: opts.heroSeat,
    currentPlayerSeat: opts.heroSeat,
    stage: 'preflop',
    gameVariant: opts.variant ?? 'nlh',
    smallBlind: 1,
    bigBlind: 2,
    toCall: currentBet - hero.bet,
    currentBet,
    minRaise: currentBet * 2,
    pot,
    legalActions: ['fold', 'call', 'raise'],
    players,
    dealtSeatIds: [1, 2, 3, 4, 5, 6],
    pots: [{ amount: pot, eligiblePlayers: players.map((p) => p.user_id) }],
    actionHistory: history,
    blindSeats: { smallBlind: 1, bigBlind: 2 },
    dealerSeat: 6,
    straddleActive: isStraddle,
    gameMode: 'cash',
    publicMemoryDomain: { speed: 'lightning' },
    communityCards: [],
  } as unknown as HorseGameStateV2;
  return { player: hero, gs };
}

function decideWithManiacAt(params: {
  heroSeat: number;
  maniacSeat: number;
  heroCards: Array<{ rank: string; suit: string }>;
  variant?: 'nlh' | 'plo5';
  straddleActive?: boolean;
}) {
  const rng = saveFastRandom();
  seedFastRandom(20261121);
  vi.spyOn(HorseMind, 'opponentRead').mockImplementation((uid: string) =>
    uid === id(params.maniacSeat) ? maniacRead() : null
  );
  vi.spyOn(HorseMind, 'isLagBully').mockReturnValue(false);
  enableBrainTelemetry();
  drainFires();
  try {
    const { player, gs } = dealState({
      heroSeat: params.heroSeat,
      heroCards: params.heroCards,
      variant: params.variant,
      straddleActive: params.straddleActive,
    });
    const decision = HorseLogic.decide(
      player,
      gs,
      'balanced',
      {},
      { mind: true, observeMind: false, telemetry: true }
    );
    const fires = Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));
    return { decision, fires };
  } finally {
    restoreFastRandom(rng);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('maniacBehindWidth and observedExtremeManiac only count seats acting behind Hero', () => {
  // K9o on the button: clear BTN open (~0.56 strength), folded when maniacBehindWidth=0.85
  // raises maniacOpenBar to strengthBarForTopShare(0.425) (~0.625).
  const BTN_MEDIUM_OPEN = [
    { rank: 'K', suit: 'c' },
    { rank: '9', suit: 'd' },
  ];

  it('BTN early look at deal: maniac at UTG (in front of BTN) does NOT trigger maniacBehindWidth or fold a BTN open', () => {
    const utgManiac = decideWithManiacAt({
      heroSeat: 6,
      maniacSeat: 3,
      heroCards: BTN_MEDIUM_OPEN,
    });
    expect(utgManiac.fires.maniac_pressure_preflop ?? 0).toBe(0);
    expect(utgManiac.decision.action).toBe('raise');
  });

  it('BTN early look at deal: maniac at BB (behind BTN) DOES trigger maniacBehindWidth and tightens the open', () => {
    const bbManiac = decideWithManiacAt({
      heroSeat: 6,
      maniacSeat: 2,
      heroCards: BTN_MEDIUM_OPEN,
    });
    expect(bbManiac.fires.maniac_pressure_preflop ?? 0).toBe(1);
    expect(bbManiac.decision.action).toBe('fold');
  });

  it('SB early look at deal: maniac at CO/BTN (in front of SB) does NOT trigger; maniac at BB (behind SB) DOES trigger', () => {
    const btnManiac = decideWithManiacAt({
      heroSeat: 1,
      maniacSeat: 6,
      heroCards: BTN_MEDIUM_OPEN,
    });
    expect(btnManiac.fires.maniac_pressure_preflop ?? 0).toBe(0);

    const bbManiac = decideWithManiacAt({
      heroSeat: 1,
      maniacSeat: 2,
      heroCards: BTN_MEDIUM_OPEN,
    });
    expect(bbManiac.fires.maniac_pressure_preflop ?? 0).toBe(1);
  });

  it('PLO5 BTN early look at deal: extreme maniac at UTG does NOT trigger maniacBehindWidth; maniac at BB DOES', () => {
    const plo5Hand = [
      { rank: 'K', suit: 's' },
      { rank: 'Q', suit: 'h' },
      { rank: 'J', suit: 'c' },
      { rank: '9', suit: 's' },
      { rank: '7', suit: 'd' },
    ];
    const utgManiac = decideWithManiacAt({
      heroSeat: 6,
      maniacSeat: 3,
      heroCards: plo5Hand,
      variant: 'plo5',
    });
    expect(utgManiac.fires.maniac_pressure_preflop ?? 0).toBe(0);

    const bbManiac = decideWithManiacAt({
      heroSeat: 6,
      maniacSeat: 2,
      heroCards: plo5Hand,
      variant: 'plo5',
    });
    expect(bbManiac.fires.maniac_pressure_preflop ?? 0).toBe(1);
  });

  it('live UTG straddle: UTG acts BEHIND BTN (triggers), while HJ acts IN FRONT of BTN (does not trigger)', () => {
    const hjManiac = decideWithManiacAt({
      heroSeat: 6,
      maniacSeat: 4,
      heroCards: BTN_MEDIUM_OPEN,
      straddleActive: true,
    });
    expect(hjManiac.fires.maniac_pressure_preflop ?? 0).toBe(0);

    const utgStraddlerManiac = decideWithManiacAt({
      heroSeat: 6,
      maniacSeat: 3,
      heroCards: BTN_MEDIUM_OPEN,
      straddleActive: true,
    });
    expect(utgStraddlerManiac.fires.maniac_pressure_preflop ?? 0).toBe(1);
  });
});
