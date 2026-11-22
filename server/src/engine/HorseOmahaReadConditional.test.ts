/**
 * OMAHA READ-CONDITIONAL DEFENCE (2026-11-15; options omahaReraisedFoldVsTight
 * and omahaMadeHandDefenseVsValueLeader, default OFF): the read, and each
 * option in the decision.
 *
 *  - the read: a presumed or unknown player is never measured; a measured
 *    player who has not re-raised in 12+ decayed opportunities is a tight
 *    re-raiser, a wide re-raiser or maniac is not; a measured player whose
 *    POSTFLOP play is value-heavy is a value leader whatever his preflop width
 *    (the production PLO5 winner's rates), an over-bluffer, a postflop maniac
 *    and a station are not;
 *  - each option: unset and false decide byte-identically; on, an unknown or
 *    presumed read, and a measured wide / over-bluffing read, decide exactly
 *    as off; a measured tight re-raiser / value leader gets the rule, with
 *    its receipt; the rule draws nothing from the brain's random stream; the
 *    changed decision is admitted by the worker receipt validator.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withFrozenDecisionClock } from './testing/frozenDecisionClock.js';
import { withoutMeasurements } from './HorseDeclaredWork.test-support.js';
import { fastRandom, omahaNutStatus, seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind, readScopeOf } from './HorseMind.js';
import { freshExploitCounters, type ExploitCounters } from './HorseOpponentExploit.js';
import {
  OMAHA_TIGHT_RERAISE_MIN_OPPS,
  omahaReadConditional,
  type OmahaReadConditional,
} from './HorseOmahaReadConditional.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { omahaBeatenByBoard } from './HorseOmahaMadeHandDefense.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import { replayProfiles, stateAt, type ComplaintFixture } from './HorseComplaintReplay.js';
import { runMatchup } from '../benchmark/HorseLeague.js';
import type { ActionRecord, Card, CardRank, CardSuit, SeatPlayer } from '../types.js';
import TOP_TWO_JAMS from './horseComplaints/plo5-top-two-pair-jams-over-a-turn-bet-on-the-straight-card.fixture.json';
import SET_LEADS from './horseComplaints/plo5-set-leads-the-straight-card-out-of-position.fixture.json';

const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (spec: string): Card[] =>
  (spec.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUIT[x[1]] }));

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

// ─── the read ───────────────────────────────────────────────────────────────

interface Rates {
  hands: number;
  vpip: number;
  pfr: number;
  rfi?: [number, number];
  threeBet?: [number, number];
  bct?: [number, number];
  ftb?: [number, number];
  rc?: [number, number];
}
/** A decayed counter row at the given rates (opportunities, rate); no fast window. */
function row(r: Rates): ExploitCounters {
  const c = freshExploitCounters();
  c.hands = r.hands;
  c.vpip = r.vpip * r.hands;
  c.pfr = r.pfr * r.hands;
  const put = (
    pair: [number, number] | undefined,
    succ: keyof ExploitCounters,
    opp: keyof ExploitCounters
  ) => {
    if (!pair) return;
    c[opp] = pair[0];
    c[succ] = pair[0] * pair[1];
  };
  put(r.rfi, 'rfi', 'rfiOpp');
  put(r.threeBet, 'threeBet', 'threeBetOpp');
  put(r.bct, 'betCheckedTo', 'betCheckedToOpp');
  put(r.ftb, 'foldToBet', 'foldToBetOpp');
  put(r.rc, 'riverCall', 'riverCallOpp');
  return c;
}
const read = (r: Rates, scope = 'omaha:full', variant = 'plo5') => {
  const c = row(r);
  return omahaReadConditional(c, scope as never, variant, readOf(c, scope, variant));
};
// The high-side read the decision would hand in (opponentExploitRead on the same counters).
import { opponentExploitRead } from './HorseOpponentExploit.js';
const readOf = (c: ExploitCounters, scope: string, variant: string) =>
  opponentExploitRead(c, scope as never, variant);

/** Lane owner 2026-11-15: the production PLO5 winner against the Horses (decayed counters, full table). */
const WINNER: Rates = {
  hands: 40,
  vpip: 0.88,
  pfr: 0.55,
  rfi: [20, 0.82],
  threeBet: [15, 0.33],
  bct: [30, 0.34],
  ftb: [25, 0.47],
  rc: [8, 0.2],
};
const TIGHT_VALUE: Rates = {
  hands: 40,
  vpip: 0.15,
  pfr: 0.04,
  rfi: [15, 0.08],
  threeBet: [20, 0],
  bct: [20, 0.25],
  ftb: [20, 0.5],
  rc: [6, 0.2],
};

describe('the read', () => {
  it('outside Omaha, without a row or below the evidence floor nothing is measured', () => {
    expect(omahaReadConditional(undefined, 'omaha:full', 'plo5', null)).toBeNull();
    expect(omahaReadConditional(row(TIGHT_VALUE), 'holdem:full', 'nlh', null)).toBeNull();
    const sparse = read({ ...TIGHT_VALUE, hands: 10 })!;
    expect([sparse.measured, sparse.tightReRaiser, sparse.valueLeader]).toEqual([
      false,
      false,
      false,
    ]);
  });

  it('a presumed (Horse-like, not disproved, not evidenced) player is never measured', () => {
    const presumed = read({ ...TIGHT_VALUE, vpip: 0.3, pfr: 0.17, rfi: [15, 0.3] })!;
    expect(presumed.measured).toBe(false);
    expect(presumed.tightReRaiser).toBe(false);
    expect(presumed.valueLeader).toBe(false);
  });

  it('a measured tight player who has not re-raised is a tight re-raiser and, value-heavy, a value leader', () => {
    const r = read(TIGHT_VALUE)!;
    expect(r.measured).toBe(true);
    expect(r.tightReRaiser).toBe(true);
    expect(r.valueLeader).toBe(true);
    // too few re-raise opportunities: not yet read
    expect(
      read({ ...TIGHT_VALUE, threeBet: [OMAHA_TIGHT_RERAISE_MIN_OPPS - 1, 0] })!.tightReRaiser
    ).toBe(false);
    // re-raising at the Horse rate is not "well below the Horses"
    expect(read({ ...TIGHT_VALUE, threeBet: [20, 0.05] })!.tightReRaiser).toBe(false);
  });

  it('the production PLO5 winner: wide re-raiser, never a tight one; value-heavy postflop, a value leader', () => {
    const r = read(WINNER)!;
    expect(r.measured).toBe(true);
    expect(r.tightReRaiser).toBe(false);
    expect(r.valueLeader).toBe(true);
    expect(read(WINNER, 'omaha:full', 'plo4')!.valueLeader).toBe(true);
  });

  it('an over-bluffer, a postflop maniac and a station are not value leaders', () => {
    expect(read({ ...WINNER, bct: [30, 0.62] })!.valueLeader).toBe(false);
    expect(read({ ...TIGHT_VALUE, bct: [20, 0.8] })!.valueLeader).toBe(false);
    expect(read({ ...WINNER, ftb: [25, 0.2] })!.valueLeader).toBe(false);
    expect(read({ ...WINNER, rc: [12, 0.7] })!.valueLeader).toBe(false);
    // too few postflop opportunities
    expect(read({ ...WINNER, bct: [5, 0.34] })!.valueLeader).toBe(false);
  });

  it('a light 4-bettor and a maniac opener are not tight re-raisers', () => {
    expect(read({ ...WINNER, threeBet: [20, 0.57] })!.tightReRaiser).toBe(false);
    // opens maniac-wide but has not re-raised: the maniac exception keeps today's play
    expect(read({ ...WINNER, threeBet: [20, 0] })!.tightReRaiser).toBe(false);
  });
});

// ─── omahaReraisedFoldVsTight in the decision ───────────────────────────────

const HERO = '86000000-0000-4000-8000-000000000007';
const OPENER = '40000000-0000-4000-8000-0000000000c3';
const FOUR_BETTOR = '40000000-0000-4000-8000-0000000000a1';
const SB = '40000000-0000-4000-8000-0000000000b2';
const seat = (n: number, id: string, hole: string, over: Partial<SeatPlayer> = {}): SeatPlayer =>
  ({
    seat: n,
    user_id: id,
    username: `P${n}`,
    stack: 400,
    bet: 0,
    totalInvested: 0,
    cards: hole ? cards(hole) : [],
    is_folded: false,
    is_all_in: false,
    is_sitting_out: false,
    is_horse: false,
    ...over,
  }) as SeatPlayer;

/**
 * Four-handed pot-limit Omaha, 400 deep: UTG opens to 7, the button (hero)
 * re-raises to 24, the small blind folds, the big blind 4-bets to 76, UTG
 * folds; hero faces 52 more with 376 behind.
 */
function fourBetGs(variant: string, hole: string): { hero: SeatPlayer; gs: HorseGameStateV2 } {
  const hero = seat(4, HERO, hole, { bet: 24, totalInvested: 24, stack: 376, is_horse: true });
  const gs = {
    players: [
      seat(1, SB, '', { bet: 1, totalInvested: 1, stack: 399, is_folded: true }),
      seat(2, FOUR_BETTOR, '', { bet: 76, totalInvested: 76, stack: 324 }),
      seat(3, OPENER, '', { bet: 7, totalInvested: 7, stack: 393, is_folded: true }),
      hero,
    ],
    communityCards: [],
    pot: 108,
    currentBet: 76,
    toCall: 52,
    minRaise: 52,
    minRaiseTo: 128,
    maxRaiseTo: 236,
    legalActions: ['fold', 'call', 'raise', 'all_in'],
    stage: 'preflop',
    gameVariant: variant,
    bettingStructure: 'pot_limit',
    bigBlind: 2,
    dealerSeat: 4,
    gameMode: 'cash',
    actionHistory: [
      { stage: 'preflop', seat: 1, userId: SB, action: 'sb', amount: 1, timestamp: 1 },
      { stage: 'preflop', seat: 2, userId: FOUR_BETTOR, action: 'bb', amount: 2, timestamp: 2 },
      {
        stage: 'preflop',
        seat: 3,
        userId: OPENER,
        action: 'raise',
        amount: 7,
        isFullRaise: true,
        timestamp: 3,
      },
      {
        stage: 'preflop',
        seat: 4,
        userId: HERO,
        action: 'raise',
        amount: 24,
        isFullRaise: true,
        timestamp: 4,
      },
      { stage: 'preflop', seat: 1, userId: SB, action: 'fold', amount: 0, timestamp: 5 },
      {
        stage: 'preflop',
        seat: 2,
        userId: FOUR_BETTOR,
        action: 'raise',
        amount: 76,
        isFullRaise: true,
        timestamp: 6,
      },
      { stage: 'preflop', seat: 3, userId: OPENER, action: 'fold', amount: 0, timestamp: 7 },
    ],
  } as unknown as HorseGameStateV2;
  return { hero, gs };
}

const SEEDS = Array.from({ length: 16 }, (_, i) => 3000 + i);
const decisionBytes = (d: unknown): string => JSON.stringify(withoutMeasurements(d));
interface Outcome {
  bytes: string[];
  actions: string[];
  fires: string[][];
  next: number[];
}
function playMany(
  build: () => { hero: SeatPlayer; gs: HorseGameStateV2 },
  opts: HorseDecideOpts,
  reads?: (userId: string) => OmahaReadConditional | null,
  before?: () => void
): Outcome {
  enableBrainTelemetry();
  const out: Outcome = { bytes: [], actions: [], fires: [], next: [] };
  for (const s of SEEDS) {
    HorseMind.reset();
    before?.();
    if (reads) vi.spyOn(HorseMind, 'omahaReadConditionalOf').mockImplementation(reads as never);
    drainFires();
    seedFastRandom(s);
    const { hero, gs } = build();
    const d = HorseLogic.decide(hero, gs, 'balanced', {}, { telemetry: true, ...opts });
    out.next.push(fastRandom());
    out.bytes.push(decisionBytes(d));
    out.actions.push(d.action);
    out.fires.push(drainFires().map((f) => f.feature));
    vi.restoreAllMocks();
  }
  return out;
}
const tightRead = {
  measured: true,
  tightReRaiser: true,
  valueLeader: false,
} as OmahaReadConditional;
const wideRead = {
  measured: true,
  tightReRaiser: false,
  valueLeader: true,
} as OmahaReadConditional;
const hasFire = (o: Outcome, f: string) => o.fires.filter((x) => x.includes(f)).length;
const continues = (o: Outcome) =>
  o.actions.filter((a) => a === 'call' || a === 'raise' || a === 'all_in').length;

/**
 * A hand without aces or a premium structure that today continues against the
 * 4-bet: deep (the call leaves a pot behind, so the cell folds it outright),
 * and short (the call commits the stack, so the cell prices it against aces).
 */
const PREFLOP = [
  { variant: 'plo4', hole: 'KsKdQhJh', stack: 376 },
  { variant: 'plo5', hole: 'KsQsJhTd9c', stack: 70 },
  { variant: 'plo5', hole: 'QsQdJhJcTh', stack: 70 },
];

describe('omahaReraisedFoldVsTight outside PLO4/PLO5 high (conflict sweep 2026-11-15, N3)', () => {
  it.each([
    { variant: 'nlh', hole: 'KsKd' },
    { variant: 'plo8', hole: 'KsKdQhJh' },
    { variant: 'flo8', hole: 'KsKdQhJh' },
    { variant: 'plo6', hole: 'KsKdQhJhTc9c' },
  ])('$variant: the option is silent, its withheld receipt too', (p) => {
    const build = () => fourBetGs(p.variant, p.hole);
    const ON: HorseDecideOpts = { omahaReraisedFoldVsTight: true };
    const off = playMany(build, {});
    for (const reads of [() => null, () => tightRead]) {
      const on = playMany(build, ON, reads as never);
      expect(on.bytes).toEqual(off.bytes);
      expect(hasFire(on, 'omaha_reraised_fold_vs_tight_withheld')).toBe(0);
      expect(hasFire(on, 'omaha_reraised_fold_vs_tight')).toBe(0);
    }
  });
});

describe('omahaReraisedFoldVsTight in PLO6 with omahaStrategyInPlo6 on (PLO6 lane 2026-11-16, SPEC-B 3.27: skipped)', () => {
  it('the same 4-bet spot the PLO4/PLO5 rows below change: silent for six cards, tight read or none', () => {
    const build = () => fourBetGs('plo6', 'KsKdQhJhTc9c');
    const GATE: HorseDecideOpts = { omahaStrategyInPlo6: true };
    for (const reads of [() => null, () => tightRead]) {
      const off = playMany(build, GATE, reads as never);
      const on = playMany(build, { ...GATE, omahaReraisedFoldVsTight: true }, reads as never);
      expect(on.bytes).toEqual(off.bytes);
      expect(hasFire(on, 'omaha_reraised_fold_vs_tight_withheld')).toBe(0);
      expect(hasFire(on, 'omaha_reraised_fold_vs_tight')).toBe(0);
    }
  });
});

describe.each(PREFLOP)(
  'omahaReraisedFoldVsTight, $variant $hole ($stack behind) facing a 4-bet',
  (p) => {
    const build = () => {
      const x = fourBetGs(p.variant, p.hole);
      x.hero.stack = p.stack;
      return x;
    };
    const ON: HorseDecideOpts = { omahaReraisedFoldVsTight: true };

    it('today continues (the spot is live)', () => {
      expect(continues(playMany(build, {}))).toBeGreaterThan(0);
    });

    it('off: unset, false and a truthy non-boolean decide byte-identically', () => {
      const unset = playMany(build, {}, () => tightRead);
      for (const opts of [
        { omahaReraisedFoldVsTight: false },
        { omahaReraisedFoldVsTight: 1 as unknown as boolean },
      ])
        expect(playMany(build, opts, () => tightRead).bytes).toEqual(unset.bytes);
    });

    it('on: an unknown or presumed 4-bettor and a measured wide one get today’s play', () => {
      const off = playMany(build, {});
      for (const reads of [
        () => null,
        () => ({ ...tightRead, tightReRaiser: false }),
        () => wideRead,
      ]) {
        const on = playMany(build, ON, reads as never);
        expect(on.bytes).toEqual(off.bytes);
        expect(on.next).toEqual(off.next);
      }
      expect(
        hasFire(
          playMany(build, ON, () => null),
          'omaha_reraised_fold_vs_tight_withheld'
        )
      ).toBe(continues(off));
    });

    it('on: against a measured tight re-raiser the preflop cell decides each continue, with its receipt', () => {
      const off = playMany(build, {});
      const on = playMany(build, ON, () => tightRead);
      on.actions.forEach((a, i) => {
        const folded = on.fires[i].includes('omaha_reraised_fold_vs_tight');
        if (folded)
          expect([off.actions[i], a]).toEqual([expect.stringMatching(/call|raise|all_in/), 'fold']);
        else expect(on.bytes[i]).toEqual(off.bytes[i]);
      });
      expect(
        hasFire(on, 'omaha_reraised_fold_vs_tight') +
          hasFire(on, 'omaha_reraised_fold_vs_tight_priced_in')
      ).toBe(continues(off));
      // deep, the call does not commit the stack: every continue folds
      if (p.stack > 200) expect(hasFire(on, 'omaha_reraised_fold_vs_tight')).toBe(continues(off));
      // the rule draws nothing from the brain's random stream
      expect(on.next).toEqual(off.next);
      // the mind off: no read, today's play
      expect(playMany(build, { ...ON, mind: false }, () => tightRead).bytes).toEqual(
        playMany(build, { mind: false }).bytes
      );
    });

    it('with the unconditional discipline on it changes nothing', () => {
      const both = playMany(build, { ...ON, omahaReraisedPotDiscipline: true }, () => tightRead);
      const discipline = playMany(build, { omahaReraisedPotDiscipline: true }, () => tightRead);
      expect(both.bytes).toEqual(discipline.bytes);
    });

    it('the fold is admitted by the worker receipt validator', () => {
      vi.spyOn(HorseMind, 'omahaReadConditionalOf').mockImplementation((() => tightRead) as never);
      for (const s of SEEDS) {
        HorseMind.reset();
        seedFastRandom(s);
        const { hero, gs } = build();
        const d = structuredClone(HorseLogic.decide(hero, gs, 'balanced', {}, ON));
        if (d.action !== 'fold') continue;
        expect(
          horseDecisionReceiptRefusal(structuredClone(d), p.variant, {
            player: hero,
            gameState: gs,
          })
        ).toBeNull();
      }
    });
  }
);

describe('omahaReraisedFoldVsTight on the real opponent memory', () => {
  /** One preflop hand: the opener raises, the player answers it. */
  function remember(userId: string, variant: string, hands: number, answer: (h: number) => string) {
    const scope = readScopeOf(variant, 4);
    for (let h = 0; h < hands; h++) {
      const a = answer(h);
      const acts = [
        {
          stage: 'preflop',
          seat: 3,
          userId: OPENER,
          action: 'raise',
          amount: 7,
          isFullRaise: true,
          origin: 'player',
          timestamp: h * 10 + 1,
        },
        {
          stage: 'preflop',
          seat: 2,
          userId,
          action: a,
          amount: a === 'raise' ? 24 : a === 'call' ? 7 : 0,
          ...(a === 'raise' ? { isFullRaise: true } : {}),
          origin: 'player',
          timestamp: h * 10 + 2,
        },
      ] as unknown as ActionRecord[];
      HorseMind.observeHandComplete(`${userId}:${variant}:${h}`, acts, 2, null, scope);
    }
  }
  const ON: HorseDecideOpts = { omahaReraisedFoldVsTight: true };
  const build = () => fourBetGs('plo4', 'KsKdQhJh');

  it('a player who never re-raises is read tight and his 4-bet is respected; a wide re-raiser, a Horse-like and a sparse player are not', () => {
    const off = playMany(build, {});
    const tight = playMany(build, ON, undefined, () =>
      remember(FOUR_BETTOR, 'plo4', 120, (h) => (h % 6 === 0 ? 'call' : 'fold'))
    );
    expect(hasFire(tight, 'omaha_reraised_fold_vs_tight')).toBe(continues(off));
    for (const answer of [
      (h: number) => (h % 3 === 0 ? 'raise' : 'fold'),
      (h: number) => (h % 20 === 0 ? 'raise' : h % 4 === 0 ? 'call' : 'fold'),
    ]) {
      const on = playMany(build, ON, undefined, () => remember(FOUR_BETTOR, 'plo4', 120, answer));
      const base = playMany(build, {}, undefined, () => remember(FOUR_BETTOR, 'plo4', 120, answer));
      expect(on.bytes).toEqual(base.bytes);
    }
    const sparse = playMany(build, ON, undefined, () =>
      remember(FOUR_BETTOR, 'plo4', 8, () => 'fold')
    );
    const sparseOff = playMany(build, {}, undefined, () =>
      remember(FOUR_BETTOR, 'plo4', 8, () => 'fold')
    );
    expect(sparse.bytes).toEqual(sparseOff.bytes);
  });
});

// ─── omahaMadeHandDefenseVsValueLeader in the decision ──────────────────────

const LIVE = replayProfiles('cash').find((p) => p.live)!;
const FB5 = TOP_TWO_JAMS as unknown as ComplaintFixture;
const FB4 = SET_LEADS as unknown as ComplaintFixture;
const node = (fx: ComplaintFixture, ord: number) => {
  const f = JSON.parse(JSON.stringify(fx)) as ComplaintFixture;
  return stateAt(f, f.actions.find((a) => a.ord === ord)!);
};
function playNode(
  fx: ComplaintFixture,
  ord: number,
  opts: HorseDecideOpts,
  reads?: (userId: string) => OmahaReadConditional | null
): Outcome {
  enableBrainTelemetry();
  const out: Outcome = { bytes: [], actions: [], fires: [], next: [] };
  for (const s of SEEDS) {
    HorseMind.reset();
    if (reads) vi.spyOn(HorseMind, 'omahaReadConditionalOf').mockImplementation(reads as never);
    drainFires();
    seedFastRandom(s);
    const st = node(fx, ord);
    // mind on: the read is consulted only with the opponent memory present
    const d = withFrozenDecisionClock(() =>
      HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
        telemetry: true,
        ...opts,
      } as never)
    );
    out.next.push(fastRandom());
    out.bytes.push(decisionBytes(d));
    out.actions.push(d.action);
    out.fires.push(drainFires().map((f) => f.feature));
    vi.restoreAllMocks();
  }
  return out;
}
const leader = { measured: true, tightReRaiser: false, valueLeader: true } as OmahaReadConditional;
const notLeader = {
  measured: true,
  tightReRaiser: false,
  valueLeader: false,
} as OmahaReadConditional;
const VL: HorseDecideOpts = { omahaMadeHandDefenseVsValueLeader: true };

describe('omahaMadeHandDefenseVsValueLeader', () => {
  const raisesOver = (o: Outcome, toCall: number, stack: number) =>
    o.actions.filter((a) => a === 'raise' || (a === 'all_in' && stack > toCall)).length;

  it('off: unset, false and a truthy non-boolean decide byte-identically', () => {
    for (const [fx, ord] of [
      [FB5, 19],
      [FB4, 18],
    ] as const) {
      const unset = playNode(fx, ord, {}, () => leader);
      for (const opts of [
        { omahaMadeHandDefenseVsValueLeader: false },
        { omahaMadeHandDefenseVsValueLeader: 1 as unknown as boolean },
      ])
        expect(playNode(fx, ord, opts, () => leader).bytes).toEqual(unset.bytes);
    }
  });

  it('turn, facing the bet on the straight card: today raises; against a value leader it calls', () => {
    const st = node(FB5, 19);
    const off = playNode(FB5, 19, {});
    expect(raisesOver(off, st.gs.toCall ?? 0, st.hero.stack)).toBeGreaterThan(0);
    const on = playNode(FB5, 19, VL, () => leader);
    expect(raisesOver(on, st.gs.toCall ?? 0, st.hero.stack)).toBe(0);
    expect(hasFire(on, 'omaha_value_leader_defense_applied')).toBeGreaterThan(0);
    expect(hasFire(on, 'omaha_turn_beaten_raise_flatted')).toBe(
      raisesOver(off, st.gs.toCall ?? 0, st.hero.stack)
    );
    expect(on.next).toEqual(off.next);
  });

  it('out of position on the straight card: today bets; against a value leader it checks', () => {
    const off = playNode(FB4, 18, {});
    expect(off.actions.filter((a) => a === 'bet').length).toBeGreaterThan(0);
    const on = playNode(FB4, 18, VL, () => leader);
    expect(on.actions.filter((a) => a === 'bet' || a === 'raise' || a === 'all_in')).toEqual([]);
    expect(hasFire(on, 'omaha_beaten_fresh_card_check')).toBe(
      off.actions.filter((a) => a === 'bet').length
    );
  });

  it('an unknown or presumed opponent, an over-bluffer, a station or a maniac: today’s play', () => {
    for (const [fx, ord] of [
      [FB5, 19],
      [FB4, 18],
    ] as const) {
      const off = playNode(fx, ord, {});
      for (const reads of [() => null, () => notLeader]) {
        const on = playNode(fx, ord, VL, reads as never);
        expect(on.bytes).toEqual(off.bytes);
        expect(hasFire(on, 'omaha_value_leader_defense_withheld')).toBeGreaterThan(0);
      }
      // the mind off: no read is consulted, today's play
      expect(playNode(fx, ord, { ...VL, mind: false }, () => leader).bytes).toEqual(
        playNode(fx, ord, { mind: false }).bytes
      );
    }
  });

  it('with the unconditional defence on it changes nothing', () => {
    const both = playNode(FB5, 19, { ...VL, omahaBeatenMadeHandDefense: true }, () => notLeader);
    const defense = playNode(FB5, 19, { omahaBeatenMadeHandDefense: true }, () => notLeader);
    expect(both.bytes).toEqual(defense.bytes);
  });

  it('the call and the check it makes are admitted by the worker receipt validator', () => {
    vi.spyOn(HorseMind, 'omahaReadConditionalOf').mockImplementation((() => leader) as never);
    for (const [fx, ord] of [
      [FB5, 19],
      [FB4, 18],
    ] as const) {
      seedFastRandom(7);
      HorseMind.reset();
      const st = node(fx, ord);
      const d = structuredClone(HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, VL));
      expect(['call', 'check']).toContain(d.action);
      expect(
        horseDecisionReceiptRefusal(structuredClone(d), 'plo5', {
          player: st.hero,
          gameState: st.gs,
        })
      ).toBeNull();
    }
  });
});

// ─── the game scope of omahaMadeHandDefenseVsValueLeader ────────────────────
// PLO6 lane 2026-11-15T20:47:48Z: switched on, the option also acted in PLO6,
// in Omaha tournaments and in bomb pots (the module's own scope, which the
// unconditional 2026-11-14 rules keep). The read-conditional option is
// PLO4/PLO5 cash, one board, no bomb pot; a tournament only with
// omahaStrategyInTournaments, PLO6 only with the PLO6 lane's gate.

type NodeState = ReturnType<typeof node>;
/** A sixth hole card that leaves the hand the same beaten made hand. */
function asPlo6(st: NodeState): void {
  const board = st.gs.communityCards ?? [];
  const taken = new Set([...st.hero.cards, ...board].map((c) => `${c.rank}${c.suit}`));
  const before = omahaNutStatus(st.hero.cards, board).category;
  for (const rank of ['2', '3', '4', '5', '6', '7', '8', '9'] as CardRank[])
    for (const suit of Object.values(SUIT)) {
      if (taken.has(`${rank}${suit}`)) continue;
      const six = [...st.hero.cards, { rank, suit } as Card];
      if (!omahaBeatenByBoard(six, board) || omahaNutStatus(six, board).category !== before)
        continue;
      st.hero.cards = six;
      const me = st.gs.players.find((p) => p.seat === st.hero.seat);
      if (me) me.cards = six;
      st.gs.gameVariant = 'plo6';
      return;
    }
  throw new Error('no neutral sixth card');
}
const asTournament = (st: NodeState): void => {
  st.gs.gameMode = 'tournament';
};
const asBombPot = (st: NodeState): void => {
  st.gs.bombPot = true;
};
/** The decision without its clock readings (a tournament decision carries simulationMs, policyMs). */
const scopedBytes = (d: unknown): string =>
  JSON.stringify(d, (k, v) => (/Ms$/.test(k) ? undefined : v));
function playScoped(
  fx: ComplaintFixture,
  ord: number,
  shape: (st: NodeState) => void,
  opts: HorseDecideOpts,
  reads?: (userId: string) => OmahaReadConditional | null
): Outcome {
  enableBrainTelemetry();
  const out: Outcome = { bytes: [], actions: [], fires: [], next: [] };
  for (const s of SEEDS) {
    HorseMind.reset();
    if (reads) vi.spyOn(HorseMind, 'omahaReadConditionalOf').mockImplementation(reads as never);
    drainFires();
    seedFastRandom(s);
    const st = node(fx, ord);
    shape(st);
    const d = withFrozenDecisionClock(() =>
      HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
        telemetry: true,
        ...opts,
      } as never)
    );
    out.next.push(fastRandom());
    out.bytes.push(scopedBytes(d));
    out.actions.push(d.action);
    out.fires.push(drainFires().map((f) => f.feature));
    vi.restoreAllMocks();
  }
  return out;
}
const DEFENCE_FIRES = [
  'omaha_turn_beaten_raise_flatted',
  'omaha_turn_beaten_raise_fold_restored',
  'omaha_beaten_fresh_card_check',
  'omaha_beaten_river_no_value_bet',
];
const defenceFires = (o: Outcome) => DEFENCE_FIRES.reduce((n, f) => n + hasFire(o, f), 0);

describe('omahaMadeHandDefenseVsValueLeader acts in PLO4/PLO5 cash only', () => {
  const SPOTS = [
    { name: 'the turn raise (PLO5)', fx: FB5, ord: 19 },
    { name: 'the fresh-card bet (PLO4)', fx: FB4, ord: 18 },
  ];
  const OUTSIDE = [
    { game: 'PLO6', shape: asPlo6 },
    { game: 'a tournament (the extension off)', shape: asTournament },
    { game: 'a bomb pot', shape: asBombPot },
  ];
  for (const spot of SPOTS)
    for (const g of OUTSIDE)
      it(`${spot.name} in ${g.game}: on changes nothing, no receipt; the 2026-11-14 rules still act`, () => {
        const off = playScoped(spot.fx, spot.ord, g.shape, {});
        for (const reads of [() => leader, () => notLeader, () => null]) {
          const on = playScoped(spot.fx, spot.ord, g.shape, VL, reads as never);
          expect(on.bytes).toEqual(off.bytes);
          expect(on.next).toEqual(off.next);
          expect(hasFire(on, 'omaha_value_leader_defense')).toBe(0);
        }
        // the spot is live there: the unconditional rules (not scoped here) change it
        const defence = playScoped(spot.fx, spot.ord, g.shape, {
          omahaBeatenMadeHandDefense: true,
        });
        expect(defenceFires(defence)).toBeGreaterThan(0);
        expect(defence.bytes).not.toEqual(off.bytes);
      });

  it('PLO4/PLO5 cash is unchanged by the scope: the option still acts', () => {
    for (const spot of SPOTS) {
      const on = playScoped(
        spot.fx,
        spot.ord,
        () => undefined,
        VL,
        () => leader
      );
      const same = playNode(spot.fx, spot.ord, VL, () => leader);
      expect(on.actions).toEqual(same.actions);
      expect(on.fires).toEqual(same.fires);
      expect(on.next).toEqual(same.next);
      expect(hasFire(on, 'omaha_value_leader_defense_applied')).toBeGreaterThan(0);
      expect(defenceFires(on)).toBeGreaterThan(0);
    }
  });

  it('a tournament with omahaStrategyInTournaments on, and PLO6 with the PLO6 gate on: it acts', () => {
    for (const spot of SPOTS) {
      const mtt = playScoped(
        spot.fx,
        spot.ord,
        asTournament,
        { ...VL, omahaStrategyInTournaments: true },
        () => leader
      );
      expect(hasFire(mtt, 'omaha_value_leader_defense_applied')).toBeGreaterThan(0);
      const six = playScoped(
        spot.fx,
        spot.ord,
        asPlo6,
        { ...VL, omahaStrategyInPlo6: true } as HorseDecideOpts,
        () => leader
      );
      expect(hasFire(six, 'omaha_value_leader_defense_applied')).toBeGreaterThan(0);
    }
  });
});

// ─── in the league (anonymised seats, memory learning on) ───────────────────

describe('in the league', () => {
  it('off by default: unset and false play the same poker', async () => {
    for (const variant of ['plo4', 'plo5']) {
      const r = await runMatchup(
        {
          name: `readcond_off_${variant}`,
          variant,
          pairs: 60,
          productionStyles: true,
          a: {},
          b: { omahaReraisedFoldVsTight: false, omahaMadeHandDefenseVsValueLeader: false },
        },
        60,
        4510001
      );
      expect(r.divergentPairs).toBe(0);
      expect(r.illegalActions).toBe(0);
    }
  }, 300_000);

  it('on, with the memory learning: no illegal action and no fallback', async () => {
    for (const variant of ['plo4', 'plo5']) {
      const r = await runMatchup(
        {
          name: `readcond_on_${variant}`,
          variant,
          pairs: 60,
          productionStyles: true,
          a: { omahaReraisedFoldVsTight: true, omahaMadeHandDefenseVsValueLeader: true },
          b: {},
        },
        60,
        4520001
      );
      expect(r.illegalActions).toBe(0);
      expect(r.brainExceptionFallbacks ?? 0).toBe(0);
    }
  }, 300_000);
});
