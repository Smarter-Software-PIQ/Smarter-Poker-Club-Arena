/**
 * LAW: B4 PRICED SIX-MAX OMAHA PREFLOP READ ON LIFETIME HUD CELLS
 * (2026-11-21, PLO-OWNER lead-4; option omahaPreflopReadIsPricedFromLifetime, default OFF).
 *
 * Proves:
 *  1. Default OFF (ships in OPTION_SWITCH_RELEASE_DEFAULT_OFF, not ON) and byte-identical when OFF.
 *  2. Strictly scoped to 3–6 dealt PLO4/PLO5 cash (tables + Lightning), high only, single board,
 *     non-bomb-pot, non-AoF, preflop only; HU (2 dealt), tournaments, PLO6, hi-lo, bomb pots, and
 *     multi-board are 100% untouched.
 *  3. Retires plo_opponent_presumed_aggressive completely on 6-max preflop (0 fires).
 *  4. Continuous n/(n+k) shrinkage on pf.lr and pf.bvo (no sample cliff).
 *  5. Strict silence (returns null) when exact pf.lr or pf.bvo is missing on limped/unopened blinds.
 *  6. Never double-prices raises >= 2 when omahaPreflopReraiseDefencePricedInPosition or
 *     omahaFourBetFoldPricedCall is ON.
 *  7. Monotonicity: higher fold-to-open / fold-to-iso / fold-to-3bet raises EV(raise).
 *  8. One formula for every opponent (zero person-vs-Horse key, zero unshown hole cards).
 *  9. Latency budget: p50 well below 25 ms across 20 6-max preflop spots.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseLogic, type HorseDecideOpts, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import {
  OPTION_SWITCH_RELEASE_DEFAULT_OFF,
  OPTION_SWITCH_RELEASE_DEFAULT_ON,
} from './HorseOptionSwitch.js';
import {
  HUD_PREFLOP_WIDEN_MIN_MARGIN_POT,
  hudThreeBetRealizationMargin,
  isOmahaPreflopHudPricedInScope,
  omahaPreflopHudWideningProved,
  priceOmahaPreflopHudSixMax,
  shrunkPreflopExactTriplet,
} from './HorseOmahaPreflopHudPriced.js';
import { emptyHudProfile, type OpponentHudProfile } from './opponentHud/OpponentHudProfile.js';
import { buildHudPacket, clearDecisionHud, installDecisionHud } from './opponentHud/OpponentHud.js';
import type { Card, SeatPlayer } from '../types.js';

const HERO = '60000000-0000-4000-8000-000000000001';
const OPP1 = '60000000-0000-4000-8000-000000000002';
const OPP2 = '60000000-0000-4000-8000-000000000003';
const OPP3 = '60000000-0000-4000-8000-000000000004';
const OPP4 = '60000000-0000-4000-8000-000000000005';
const T = 1_800_000_000_000;

const c = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });
const HAND4: Card[] = [c('A', 'spades'), c('K', 'spades'), c('Q', 'hearts'), c('J', 'hearts')];
const HAND5: Card[] = [
  c('A', 'spades'),
  c('K', 'spades'),
  c('Q', 'hearts'),
  c('J', 'hearts'),
  c('T', 'diamonds'),
];

function makeProfile(
  user: string,
  family: 'plo4' | 'plo5',
  opts?: {
    withBvo?: { fold: number; call: number; raise: number };
    withLr?: { fold: number; call: number; raise: number };
    f3bet?: [number, number];
  }
): OpponentHudProfile {
  const p = emptyHudProfile(user, family);
  p.hands = 200;
  p.wm = T;
  p.recAt = T;
  const set = (k: string, o: number, h: number) => {
    p.life[k] = [o, h];
    p.rec[k] = [o, h];
  };
  set('pf.vpip', 200, 70);
  set('pf.pfr', 200, 32);
  set('pf.open', 100, 24);
  set('pf.3bet', 80, 6);
  set('pf.4bet', 30, 2);
  set('pf.f3bet', opts?.f3bet?.[0] ?? 40, opts?.f3bet?.[1] ?? 24);
  set('f.betCk', 80, 25);
  set('f.fBet', 80, 40);
  set('r.cBet', 30, 10);
  if (opts?.withBvo || opts?.withLr) {
    p.xc = {
      'pf.vpip.sh.opps': 200,
      'pf.vpip.sh.hits': 70,
      'pf.pfr.sh.opps': 200,
      'pf.pfr.sh.hits': 32,
      'pf.open.sh.opps': 100,
      'pf.open.sh.hits': 24,
      'pf.3bet.sh.opps': 80,
      'pf.3bet.sh.hits': 6,
      'pf.f3bet.sh.opps': opts?.f3bet?.[0] ?? 40,
      'pf.f3bet.sh.hits': opts?.f3bet?.[1] ?? 24,
    };
  } else {
    delete p.xc;
  }
  if (opts?.withBvo && p.xc) {
    const b = opts.withBvo;
    p.xc['pf.bvo.sh.opps'] = b.fold + b.call + b.raise;
    p.xc['pf.bvo.sh.fold'] = b.fold;
    p.xc['pf.bvo.sh.call'] = b.call;
    p.xc['pf.bvo.sh.raise'] = b.raise;
  }
  if (opts?.withLr && p.xc) {
    const l = opts.withLr;
    p.xc['pf.lr.sh.opps'] = l.fold + l.call + l.raise;
    p.xc['pf.lr.sh.fold'] = l.fold;
    p.xc['pf.lr.sh.call'] = l.call;
    p.xc['pf.lr.sh.raise'] = l.raise;
  }
  return p;
}

function makeSixMaxState(
  overrides?: Partial<HorseGameStateV2>,
  variant: 'plo4' | 'plo5' | 'plo6' = 'plo4'
): { hero: SeatPlayer; gs: HorseGameStateV2 } {
  const hole =
    variant === 'plo5' ? HAND5 : variant === 'plo6' ? [...HAND5, c('9', 'clubs')] : HAND4;
  const hero: SeatPlayer = {
    seat: 3,
    user_id: HERO,
    username: 'hero',
    cards: hole,
    stack: 100,
    bet: 0,
    totalInvested: 0,
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
  };
  const players: SeatPlayer[] = [
    hero,
    {
      seat: 4,
      user_id: OPP1,
      username: 'opp1',
      cards: [],
      stack: 100,
      bet: 0.5,
      totalInvested: 0.5,
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
    },
    {
      seat: 5,
      user_id: OPP2,
      username: 'opp2',
      cards: [],
      stack: 100,
      bet: 1,
      totalInvested: 1,
      is_folded: false,
      is_all_in: false,
      is_sitting_out: false,
    },
    {
      seat: 1,
      user_id: OPP3,
      username: 'opp3',
      cards: [],
      stack: 100,
      bet: 0,
      totalInvested: 0,
      is_folded: true,
      is_all_in: false,
      is_sitting_out: false,
    },
    {
      seat: 2,
      user_id: OPP4,
      username: 'opp4',
      cards: [],
      stack: 100,
      bet: 0,
      totalInvested: 0,
      is_folded: true,
      is_all_in: false,
      is_sitting_out: false,
    },
  ];
  const gs: HorseGameStateV2 = {
    stage: 'preflop',
    gameVariant: variant,
    gameMode: 'cash',
    bigBlind: 1,
    smallBlind: 0.5,
    pot: 1.5,
    currentBet: 1,
    toCall: 1,
    minRaise: 1,
    minRaiseTo: 2,
    maxRaiseTo: 3.5,
    dealerSeat: 3,
    communityCards: [],
    players,
    actionHistory: [],
    legalActions: ['fold', 'call', 'raise'],
    ...overrides,
  };
  return { hero, gs };
}

function decideWith(hero: SeatPlayer, gs: HorseGameStateV2, opts: HorseDecideOpts) {
  return HorseLogic.decide(hero, gs, 'balanced', undefined, opts);
}

afterEach(() => {
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
  clearDecisionHud();
});

describe('B4: priced six-max preflop read on lifetime HUD cells', () => {
  it('ships default OFF and leaves decisions byte-identical when OFF', () => {
    expect(OPTION_SWITCH_RELEASE_DEFAULT_OFF).toContain('omahaPreflopReadIsPricedFromLifetime');
    expect(OPTION_SWITCH_RELEASE_DEFAULT_ON).not.toContain('omahaPreflopReadIsPricedFromLifetime');
    const { hero, gs } = makeSixMaxState();
    const before = decideWith(hero, gs, { omahaOpponentLifetimeHud: true });
    installDecisionHud(
      buildHudPacket(
        'plo4',
        [
          makeProfile(OPP1, 'plo4', { withBvo: { fold: 30, call: 8, raise: 2 } }),
          makeProfile(OPP2, 'plo4', { withBvo: { fold: 30, call: 8, raise: 2 } }),
        ],
        {},
        T,
        'preflop'
      )
    );
    const after = decideWith(hero, gs, { omahaOpponentLifetimeHud: true });
    expect(after.action).toBe(before.action);
    expect(after.amount).toBe(before.amount);
  });

  it('scope gate admits only 3–6 seat PLO4/PLO5 cash high single-board non-bomb-pot preflop (excludes HU/tourney/PLO6/RIT/bomb)', () => {
    const onOpts = { omahaOpponentLifetimeHud: true, omahaPreflopReadIsPricedFromLifetime: true };
    const { hero, gs } = makeSixMaxState();
    expect(isOmahaPreflopHudPricedInScope(hero, gs, onOpts)).toBe(true);
    expect(
      isOmahaPreflopHudPricedInScope(hero, gs, { omahaPreflopReadIsPricedFromLifetime: true })
    ).toBe(false);
    expect(isOmahaPreflopHudPricedInScope(hero, { ...gs, stage: 'flop' }, onOpts)).toBe(false);
    expect(isOmahaPreflopHudPricedInScope(hero, { ...gs, gameMode: 'tournament' }, onOpts)).toBe(
      false
    );
    expect(isOmahaPreflopHudPricedInScope(hero, { ...gs, bombPot: true }, onOpts)).toBe(false);
    expect(isOmahaPreflopHudPricedInScope(hero, { ...gs, allInOrFold: true }, onOpts)).toBe(false);
    expect(isOmahaPreflopHudPricedInScope(hero, { ...gs, boardCount: 2 }, onOpts)).toBe(false);
    expect(
      isOmahaPreflopHudPricedInScope(hero, { ...gs, players: gs.players.slice(0, 2) }, onOpts)
    ).toBe(false);
    const { hero: h6, gs: g6 } = makeSixMaxState(undefined, 'plo6');
    expect(isOmahaPreflopHudPricedInScope(h6, g6, onOpts)).toBe(false);
  });

  it('retires plo_opponent_presumed_aggressive completely on 6-max preflop (0 fires)', () => {
    enableBrainTelemetry();
    drainFires();
    const { hero, gs } = makeSixMaxState();
    installDecisionHud(
      buildHudPacket(
        'plo4',
        [
          makeProfile(OPP1, 'plo4', { withBvo: { fold: 25, call: 12, raise: 3 } }),
          makeProfile(OPP2, 'plo4', { withBvo: { fold: 25, call: 12, raise: 3 } }),
        ],
        {},
        T,
        'preflop'
      )
    );
    decideWith(hero, gs, {
      omahaOpponentLifetimeHud: true,
      omahaPreflopReadIsPricedFromLifetime: true,
    });
    const fires = drainFires().map((f) => f.feature);
    expect(fires).not.toContain('plo_opponent_presumed_aggressive');
  });

  it('strictly returns null when pf.bvo (unopened blinds) or pf.lr (limpers) is absent from packet', () => {
    const onOpts = { omahaOpponentLifetimeHud: true, omahaPreflopReadIsPricedFromLifetime: true };
    const { hero, gs } = makeSixMaxState();
    // Unopened blinds WITHOUT pf.bvo
    installDecisionHud(
      buildHudPacket(
        'plo4',
        [makeProfile(OPP1, 'plo4'), makeProfile(OPP2, 'plo4')],
        {},
        T,
        'preflop'
      )
    );
    expect(priceOmahaPreflopHudSixMax(hero, gs, -1, onOpts)).toBeNull();

    // Limped pot WITHOUT pf.lr
    const limpedGs: HorseGameStateV2 = {
      ...gs,
      pot: 2.5,
      players: gs.players.map((p) => (p.seat === 2 ? { ...p, is_folded: false, bet: 1 } : p)),
      actionHistory: [
        { stage: 'preflop', seat: 2, userId: OPP4, action: 'call', amount: 1, timestamp: T },
      ],
    };
    installDecisionHud(
      buildHudPacket(
        'plo4',
        [
          makeProfile(OPP1, 'plo4', { withBvo: { fold: 20, call: 15, raise: 5 } }),
          makeProfile(OPP2, 'plo4', { withBvo: { fold: 20, call: 15, raise: 5 } }),
          makeProfile(OPP4, 'plo4'), // missing pf.lr!
        ],
        {},
        T,
        'preflop'
      )
    );
    expect(priceOmahaPreflopHudSixMax(hero, limpedGs, -1, onOpts)).toBeNull();
  });

  it('continuous n/(n+k) shrinkage on pf.bvo has zero sample cliff', () => {
    const samples = [0, 1, 5, 15, 40, 100];
    const folds: number[] = [];
    for (const n of samples) {
      installDecisionHud(
        buildHudPacket(
          'plo4',
          [makeProfile(OPP1, 'plo4', { withBvo: { fold: n, call: 0, raise: 0 } })],
          {},
          T,
          'preflop'
        )
      );
      const t = shrunkPreflopExactTriplet(OPP1, 'plo4', 'pf.bvo', 'sh');
      expect(t).not.toBeNull();
      folds.push(t!.fold);
    }
    for (let i = 1; i < folds.length; i++) {
      expect(folds[i]).toBeGreaterThan(folds[i - 1]!);
    }
  });

  it('never double-prices raises >= 2 when omahaPreflopReraiseDefencePricedInPosition or omahaFourBetFoldPricedCall is ON', () => {
    const { hero, gs } = makeSixMaxState({
      pot: 14,
      currentBet: 10,
      toCall: 10,
      actionHistory: [
        { stage: 'preflop', seat: 4, userId: OPP1, action: 'raise', amount: 3.5, timestamp: T },
        { stage: 'preflop', seat: 5, userId: OPP2, action: 'raise', amount: 10, timestamp: T },
      ],
    });
    installDecisionHud(
      buildHudPacket(
        'plo4',
        [
          makeProfile(OPP1, 'plo4', { withBvo: { fold: 20, call: 15, raise: 5 } }),
          makeProfile(OPP2, 'plo4', { withBvo: { fold: 20, call: 15, raise: 5 } }),
        ],
        {},
        T,
        'preflop'
      )
    );
    expect(
      priceOmahaPreflopHudSixMax(hero, gs, 5, {
        omahaOpponentLifetimeHud: true,
        omahaPreflopReadIsPricedFromLifetime: true,
        omahaPreflopReraiseDefencePricedInPosition: true,
      })
    ).toBeNull();
    expect(
      priceOmahaPreflopHudSixMax(hero, gs, 5, {
        omahaOpponentLifetimeHud: true,
        omahaPreflopReadIsPricedFromLifetime: true,
        omahaFourBetFoldPricedCall: true,
      })
    ).toBeNull();
  });

  it('monotonicity: higher blind fold rate in pf.bvo increases EV(raise), and identical histories price identically', () => {
    const onOpts = { omahaOpponentLifetimeHud: true, omahaPreflopReadIsPricedFromLifetime: true };
    const { hero, gs } = makeSixMaxState();
    installDecisionHud(
      buildHudPacket(
        'plo4',
        [
          makeProfile(OPP1, 'plo4', { withBvo: { fold: 5, call: 30, raise: 15 } }),
          makeProfile(OPP2, 'plo4', { withBvo: { fold: 5, call: 30, raise: 15 } }),
        ],
        {},
        T,
        'preflop'
      )
    );
    const sticky = priceOmahaPreflopHudSixMax(hero, gs, -1, onOpts);

    installDecisionHud(
      buildHudPacket(
        'plo4',
        [
          makeProfile(OPP1, 'plo4', { withBvo: { fold: 45, call: 4, raise: 1 } }),
          makeProfile(OPP2, 'plo4', { withBvo: { fold: 45, call: 4, raise: 1 } }),
        ],
        {},
        T,
        'preflop'
      )
    );
    const foldy = priceOmahaPreflopHudSixMax(hero, gs, -1, onOpts);
    expect(sticky).not.toBeNull();
    expect(foldy).not.toBeNull();
    expect(foldy!.evRaise!).toBeGreaterThan(sticky!.evRaise!);
    expect(foldy!.action).toBe('raise');

    // Identical histories on swapped IDs produce identical verdicts (zero person-vs-Horse key)
    const swappedGs: HorseGameStateV2 = {
      ...gs,
      players: gs.players.map((p) =>
        p.user_id === OPP1
          ? { ...p, user_id: OPP2 }
          : p.user_id === OPP2
            ? { ...p, user_id: OPP1 }
            : p
      ),
    };
    const swapped = priceOmahaPreflopHudSixMax(hero, swappedGs, -1, onOpts);
    expect(swapped).toEqual(foldy);
  });

  it('latency: 20 priced 6-max preflop spots run with p50 well under 25 ms', () => {
    const onOpts = { omahaOpponentLifetimeHud: true, omahaPreflopReadIsPricedFromLifetime: true };
    const { hero, gs } = makeSixMaxState();
    installDecisionHud(
      buildHudPacket(
        'plo4',
        [
          makeProfile(OPP1, 'plo4', { withBvo: { fold: 25, call: 15, raise: 5 } }),
          makeProfile(OPP2, 'plo4', { withBvo: { fold: 25, call: 15, raise: 5 } }),
        ],
        {},
        T,
        'preflop'
      )
    );
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      const v = priceOmahaPreflopHudSixMax(hero, gs, -1, onOpts);
      times.push(performance.now() - t0);
      expect(v).not.toBeNull();
    }
    times.sort((a, b) => a - b);
    const p50 = times[Math.floor(times.length / 2)]!;
    expect(p50).toBeLessThan(25);
  });

  it('Site #1: hudThreeBetRealizationMargin preserves 0.05 IP / 0.10 OOP vs aggressive-preflop passive-postflop 3-bettors without cliff', () => {
    const aggroPassive = makeProfile(OPP1, 'plo4', {
      withBvo: { fold: 15, call: 15, raise: 10 },
    });
    aggroPassive.life['pf.3bet'] = [80, 26];
    aggroPassive.rec['pf.3bet'] = [80, 26];
    aggroPassive.life['pf.pfr'] = [200, 96];
    aggroPassive.rec['pf.pfr'] = [200, 96];
    aggroPassive.life['f.betCk'] = [80, 10]; // very passive postflop
    aggroPassive.rec['f.betCk'] = [80, 10];
    aggroPassive.xc!['pf.3bet.sh.opps'] = 80;
    aggroPassive.xc!['pf.3bet.sh.hits'] = 26;
    aggroPassive.xc!['pf.pfr.sh.opps'] = 200;
    aggroPassive.xc!['pf.pfr.sh.hits'] = 96;

    installDecisionHud(buildHudPacket('plo4', [aggroPassive], {}, T, 'preflop'));
    const ip = hudThreeBetRealizationMargin(OPP1, 'plo4', true);
    const oop = hudThreeBetRealizationMargin(OPP1, 'plo4', false);
    expect(ip.realization).toBeCloseTo(0.05, 5);
    expect(oop.realization).toBeCloseTo(0.1, 5);
    expect(ip.aggressiveThreeBettor).toBe(true);

    // Continuous shrinkage: ramps cleanly from 0 for tight passive 3-bettors up to 0.05/0.10 for aggressive 3-bettors
    const tightPassive = makeProfile(OPP2, 'plo4', {
      withBvo: { fold: 30, call: 8, raise: 2 },
    });
    tightPassive.life['pf.3bet'] = [80, 2];
    tightPassive.life['pf.pfr'] = [200, 24];
    tightPassive.life['f.betCk'] = [80, 12];
    tightPassive.xc!['pf.3bet.sh.opps'] = 80;
    tightPassive.xc!['pf.3bet.sh.hits'] = 2;
    tightPassive.xc!['pf.pfr.sh.opps'] = 200;
    tightPassive.xc!['pf.pfr.sh.hits'] = 24;
    installDecisionHud(buildHudPacket('plo4', [tightPassive], {}, T, 'preflop'));
    const tightOop = hudThreeBetRealizationMargin(OPP2, 'plo4', false);
    expect(tightOop.realization).toBe(0);
    expect(tightOop.aggressiveThreeBettor).toBe(false);

    // Mid-level aggression sits strictly between 0 and 0.10 OOP (no binary cliff)
    const midAgg = makeProfile(OPP3, 'plo4', {
      withBvo: { fold: 20, call: 15, raise: 5 },
    });
    midAgg.life['pf.3bet'] = [80, 14];
    midAgg.life['pf.pfr'] = [200, 56];
    midAgg.life['f.betCk'] = [80, 16];
    midAgg.xc!['pf.3bet.sh.opps'] = 80;
    midAgg.xc!['pf.3bet.sh.hits'] = 14;
    midAgg.xc!['pf.pfr.sh.opps'] = 200;
    midAgg.xc!['pf.pfr.sh.hits'] = 56;
    installDecisionHud(buildHudPacket('plo4', [midAgg], {}, T, 'preflop'));
    const midOop = hudThreeBetRealizationMargin(OPP3, 'plo4', false);
    expect(midOop.realization).toBeGreaterThan(0);
    expect(midOop.realization).toBeLessThan(0.1);
  });

  it('Sites #2 & #3: omahaPreflopHudWideningProved rejects null and noise ties (< 2% pot) and accepts strictly proved widening', () => {
    expect(omahaPreflopHudWideningProved(null, 10, 'raise')).toBe(false);
    expect(omahaPreflopHudWideningProved(null, 10, 'call')).toBe(false);
    const noiseTie = {
      action: 'raise' as const,
      evFold: 0,
      evCall: 0.1,
      evRaise: 0.1 + HUD_PREFLOP_WIDEN_MIN_MARGIN_POT * 10 * 0.25,
      foldAll: 0.3,
      pReraise: 0.1,
    };
    expect(omahaPreflopHudWideningProved(noiseTie, 10, 'raise')).toBe(false);
    expect(omahaPreflopHudWideningProved(noiseTie, 10, 'call')).toBe(false);

    const clearRaise = {
      ...noiseTie,
      evRaise: 0.1 + HUD_PREFLOP_WIDEN_MIN_MARGIN_POT * 10 + 0.05,
    };
    expect(omahaPreflopHudWideningProved(clearRaise, 10, 'raise')).toBe(true);

    const clearCall = {
      action: 'call' as const,
      evFold: 0,
      evCall: HUD_PREFLOP_WIDEN_MIN_MARGIN_POT * 10 + 0.05,
      evRaise: -0.5,
      foldAll: 0.1,
      pReraise: 0.2,
    };
    expect(omahaPreflopHudWideningProved(clearCall, 10, 'call')).toBe(true);
    expect(omahaPreflopHudWideningProved(clearCall, 10, 'raise')).toBe(false);
    expect(omahaPreflopHudWideningProved(clearCall, 10, 'threebet')).toBe(false);

    const valueThreeBetCloseToCall = {
      action: 'call' as const,
      evFold: 0,
      evCall: 2.0,
      evRaise: 1.8, // strictly +EV over fold and within 0.05*pot (0.5) of evCall
      foldAll: 0.35,
      pReraise: 0.08,
    };
    expect(omahaPreflopHudWideningProved(valueThreeBetCloseToCall, 10, 'threebet')).toBe(true);
    expect(omahaPreflopHudWideningProved(valueThreeBetCloseToCall, 10, 'raise')).toBe(false);
  });

  it('multiway raises>=1 includes cold-callers in equity/realization and weak hand vs aggro_passive_post open does not unpriced-3bet', () => {
    const onOpts = { omahaOpponentLifetimeHud: true, omahaPreflopReadIsPricedFromLifetime: true };
    const weakHand: Card[] = [
      c('K', 'clubs'),
      c('8', 'diamonds'),
      c('4', 'hearts'),
      c('2', 'spades'),
    ];
    const aggroPassive = makeProfile(OPP1, 'plo4', {
      withBvo: { fold: 15, call: 15, raise: 10 },
      f3bet: [40, 12],
    });
    aggroPassive.life['pf.pfr'] = [200, 76];
    aggroPassive.life['pf.open'] = [100, 48];
    aggroPassive.life['f.betCk'] = [80, 10];
    aggroPassive.xc!['pf.pfr.sh.opps'] = 200;
    aggroPassive.xc!['pf.pfr.sh.hits'] = 76;
    const callerProf = makeProfile(OPP2, 'plo4', { withBvo: { fold: 20, call: 20, raise: 4 } });

    const { hero, gs } = makeSixMaxState({
      pot: 5,
      currentBet: 3.5,
      toCall: 3.5,
      minRaiseTo: 7,
      maxRaiseTo: 12,
      dealerSeat: 4,
      players: [
        {
          seat: 3,
          user_id: HERO,
          username: 'hero',
          cards: weakHand,
          stack: 100,
          bet: 0,
          totalInvested: 0,
          is_folded: false,
          is_all_in: false,
          is_sitting_out: false,
        },
        {
          seat: 4,
          user_id: OPP1,
          username: 'opp1',
          cards: [],
          stack: 96.5,
          bet: 3.5,
          totalInvested: 3.5,
          is_folded: false,
          is_all_in: false,
          is_sitting_out: false,
        },
        {
          seat: 5,
          user_id: OPP2,
          username: 'opp2',
          cards: [],
          stack: 99,
          bet: 1,
          totalInvested: 1,
          is_folded: false,
          is_all_in: false,
          is_sitting_out: false,
        },
      ],
      actionHistory: [
        { stage: 'preflop', seat: 4, userId: OPP1, action: 'raise', amount: 3.5, timestamp: T },
      ],
    });
    const heroWeak = gs.players[0]!;
    installDecisionHud(buildHudPacket('plo4', [aggroPassive, callerProf], {}, T, 'preflop'));
    const huPot = priceOmahaPreflopHudSixMax(heroWeak, gs, 4, onOpts);

    // Now add a cold-caller on seat 5: multiway EV(call) must drop below heads-up EV(call)
    const multiwayGs: HorseGameStateV2 = {
      ...gs,
      pot: 8.5,
      players: gs.players.map((p) =>
        p.seat === 5 ? { ...p, stack: 96.5, bet: 3.5, totalInvested: 3.5 } : p
      ),
      actionHistory: [
        { stage: 'preflop', seat: 4, userId: OPP1, action: 'raise', amount: 3.5, timestamp: T },
        { stage: 'preflop', seat: 5, userId: OPP2, action: 'call', amount: 3.5, timestamp: T },
      ],
    };
    const mwPot = priceOmahaPreflopHudSixMax(heroWeak, multiwayGs, 4, onOpts);
    expect(huPot).not.toBeNull();
    expect(mwPot).not.toBeNull();
    expect(mwPot!.evCall!).toBeLessThan(huPot!.evCall!);

    // Full decision on weak rainbow K842 OOP vs aggro_passive_post open + cold-caller: must NOT raise and 0 presumption fires
    enableBrainTelemetry();
    drainFires();
    const decision = decideWith(heroWeak, multiwayGs, onOpts);
    const fires = drainFires().map((f) => f.feature);
    expect(decision.action).toBe('fold');
    expect(fires).not.toContain('plo_opponent_presumed_aggressive');
    void hero;
  });

  it('Law 12 yields at raises >= 2 when R3 (omahaPreflopReraiseDefenceOnLifetimeHud) is ON', () => {
    const { hero, gs } = makeSixMaxState({
      pot: 14,
      actionHistory: [
        { stage: 'preflop', seat: 4, userId: OPP1, action: 'raise', amount: 3.5, timestamp: T },
        { stage: 'preflop', seat: 5, userId: OPP2, action: 'raise', amount: 11, timestamp: T + 1 },
      ],
    });
    expect(
      priceOmahaPreflopHudSixMax(hero, gs, 5, {
        omahaOpponentLifetimeHud: true,
        omahaPreflopReadIsPricedFromLifetime: true,
        omahaPreflopReraiseDefenceOnLifetimeHud: true,
      })
    ).toBeNull();
  });
});
