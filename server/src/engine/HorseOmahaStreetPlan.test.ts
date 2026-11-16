/**
 * OMAHA STREET PLAN, first layer (owner 2026-11-15 11:43; option
 * omahaStreetPlan, default OFF): the heads-up PLO4/PLO5 cash turn bet priced
 * against the check with the river planned, and the river that follows the
 * plan. Recorded hands, anonymised to seat numbers:
 *
 *  - 59521326: nut straight, the turn pairs the board, 373 into 669 leaves
 *    0.37 of the pot behind; the Horse then folded the river. The plan
 *    prices the check above the bet and checks; were the bet made, the plan
 *    it was made under calls the river that came, and the river follows it.
 *  - 59517323: aces in a 4-bet pot out of position; the plan prices the turn
 *    bet above the check and keeps the engine's decision. The flop is not
 *    built: identical.
 *  - 59518335: queens re-raise, call a cold 4-bet, call a multiway flop bet:
 *    preflop, multiway and facing a bet are outside the first layer:
 *    identical.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fastRandom, seedFastRandom } from './HorseEval.js';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import {
  omahaPlanCardBucket,
  omahaPlanHeroInPosition,
  omahaPlanLineUncommitted,
  omahaPlanOppLine,
  omahaPlanRiverVerdict,
  omahaPlanTurnStateFromRiver,
  omahaStreetPlan,
  omahaStreetPlanDomain,
  omahaStreetPlanTurnSpot,
  type OmahaPlanInput,
  omahaStreetPlanAdmitsCheck,
} from './HorseOmahaStreetPlan.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { omahaOopCheckSpot } from './HorseOmahaOopChecks.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import { replayProfiles, stateAt, type ComplaintFixture } from './HorseComplaintReplay.js';
import type { Card, CardRank, CardSuit } from '../types.js';
import STRAIGHT from './horseComplaints/plo5-straight-barrels-the-board-pairing-turn-then-folds-the-river.fixture.json';
import ACES from './horseComplaints/plo5-aces-up-leads-the-board-pairing-river-into-a-two-street-caller.fixture.json';
import QUEENS from './HorseOmahaUnderpair.fixture.json';

const FX = {
  straight: STRAIGHT as unknown as ComplaintFixture,
  aces: ACES as unknown as ComplaintFixture,
  queens: QUEENS as unknown as ComplaintFixture,
};
const SUIT: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
const cards = (spec: string): Card[] =>
  (spec.match(/../g) ?? []).map((x) => ({ rank: x[0] as CardRank, suit: SUIT[x[1]] }));
const LIVE = replayProfiles('cash').find((p) => p.live)!;
const SEEDS = [1, 7, 42, 99, 2026, 3, 11, 17, 23, 31, 101, 102, 103, 104, 105, 106];
const ON: HorseDecideOpts = { omahaStreetPlan: true };

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

type Node = ReturnType<typeof stateAt>;
const nodeAt = (
  fx: ComplaintFixture,
  ord: number,
  mutate?: (f: ComplaintFixture) => void
): Node => {
  const f = JSON.parse(JSON.stringify(fx)) as ComplaintFixture;
  mutate?.(f);
  return stateAt(f, f.actions.find((a) => a.ord === ord)!);
};
const decisionBytes = (d: unknown): string =>
  JSON.stringify(d, (k, v) => (k === 'latencyMs' || k === 'elapsedMs' ? undefined : v));
interface Outcome {
  bytes: string[];
  wagers: string[];
  actions: string[];
  fires: string[][];
  next: number[];
  plans: unknown[];
  ms: number;
}
function play(build: () => Node, opts: HorseDecideOpts): Outcome {
  enableBrainTelemetry();
  const out: Outcome = {
    bytes: [],
    wagers: [],
    actions: [],
    fires: [],
    next: [],
    plans: [],
    ms: 0,
  };
  for (const s of SEEDS) {
    HorseMind.reset();
    drainFires();
    seedFastRandom(s);
    const st = build();
    const t0 = performance.now();
    const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
      telemetry: true,
      ...opts,
    } as never);
    out.ms += performance.now() - t0;
    out.next.push(fastRandom());
    out.bytes.push(decisionBytes(d));
    out.wagers.push(`${d.action}:${d.amount ?? ''}`);
    out.actions.push(d.action);
    out.plans.push(d.streetPlan);
    out.fires.push(drainFires().map((f) => f.feature));
  }
  out.ms /= SEEDS.length;
  return out;
}
const hasFire = (o: Outcome, f: string) => o.fires.filter((x) => x.includes(f)).length;
const only = (o: Outcome) => [...new Set(o.actions)].sort();
const planInput = (st: Node, bets: number[]): OmahaPlanInput => {
  const opp = omahaStreetPlanDomain(st.hero, st.gs)!;
  return {
    hole: st.hero.cards,
    board: st.gs.communityCards,
    pot: st.gs.pot,
    heroStack: st.hero.stack,
    oppStack: opp.stack,
    heroInvested: st.hero.totalInvested ?? 0,
    heroInPosition: omahaPlanHeroInPosition(opp, st.gs, 'turn'),
    bets,
    oppLine: omahaPlanOppLine(st.hero, opp, st.gs, 'flop'),
  };
};

const TURN = 16;
const RIVER = 20;

describe('omahaStreetPlan: the planner (pure)', () => {
  it('59521326 turn: the check line is worth more than the recorded bet, which commits 57% of the stack with a plan for under 65% of rivers', () => {
    const st = nodeAt(FX.straight, TURN);
    expect(omahaStreetPlanTurnSpot(st.hero, st.gs)).toBe(true);
    const input = planInput(st, [373]);
    expect(input.heroInPosition).toBe(false);
    expect(input.oppLine).toBe('called_raise');
    const plan = omahaStreetPlan(input)!;
    const [check, bet] = plan.lines;
    expect(plan.cards.length).toBe(43);
    expect(bet.commitShare).toBeCloseTo(0.572, 2);
    expect(bet.continueShare).toBeLessThan(0.65);
    expect(omahaPlanLineUncommitted(bet)).toBe(true);
    expect(plan.best).toBe(0);
    expect(check.ev).toBeGreaterThan(bet.ev + 0.02 * 669);
    // the numbers this first layer reports (chips from the decision on)
    expect(Math.round(check.ev)).toBe(84);
    expect(Math.round(bet.ev)).toBe(14);
    // the opponent's response shares to the bet are a partition
    expect(bet.oppFold + bet.oppCall + bet.oppRaise).toBeCloseTo(1, 9);
    // the bet's river plan: it folds every flush river and calls most bricks
    const byTexture = Object.fromEntries(bet.buckets.map((b) => [b.texture, b]));
    expect(byTexture.flush.facingBet).toBe('fold');
    expect(byTexture.brick.facingBet).toBe('call');
  });

  it('bucket probabilities are exact counts of the unseen cards and sum to one', () => {
    const st = nodeAt(FX.straight, TURN);
    const plan = omahaStreetPlan(planInput(st, [373]))!;
    for (const line of plan.lines) {
      expect(line.buckets.reduce((n, b) => n + b.cards, 0)).toBe(plan.cards.length);
      expect(line.buckets.reduce((n, b) => n + b.share, 0)).toBeCloseTo(1, 9);
      for (const b of line.buckets) {
        expect(b.cards).toBe(
          plan.cards.filter((c) => omahaPlanCardBucket(st.gs.communityCards, c) === b.texture)
            .length
        );
        expect(b.impact.good + b.impact.neutral + b.impact.bad).toBe(b.cards);
      }
    }
  });

  it('is deterministic and neither reads nor advances the engine random stream', () => {
    const st = nodeAt(FX.straight, TURN);
    seedFastRandom(5);
    const a = omahaStreetPlan(planInput(st, [373, 221]));
    seedFastRandom(977);
    const b = omahaStreetPlan(planInput(st, [373, 221]));
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    seedFastRandom(42);
    const expected = fastRandom();
    seedFastRandom(42);
    omahaStreetPlan(planInput(st, [373]));
    expect(fastRandom()).toBe(expected);
  });

  it('a measured tendency moves the shares: a player who folds more to bets makes the bet worth more', () => {
    const st = nodeAt(FX.straight, TURN);
    const base = omahaStreetPlan(planInput(st, [373]))!.lines[1];
    const folder = omahaStreetPlan({
      ...planInput(st, [373]),
      tendency: { foldToBet: 1.5, aggression: 1, riverCall: 1, valueLeader: false },
    })!.lines[1];
    expect(folder.oppFold).toBeGreaterThan(base.oppFold);
    expect(folder.ev).toBeGreaterThan(base.ev);
  });

  it('the facing-bet seam is honoured: a veto on every river makes the bet line worth bet-then-fold', () => {
    const st = nodeAt(FX.straight, TURN);
    const free = omahaStreetPlan(planInput(st, [373]))!.lines[1];
    const vetoed = omahaStreetPlan({ ...planInput(st, [373]), callVeto: () => true })!.lines[1];
    expect(vetoed.cardPlan.every((c) => (c & 2) === 0)).toBe(true);
    expect(vetoed.ev).toBeLessThanOrEqual(free.ev);
  });

  it('59517323 turn: aces and the nut flush draw out of position; the recorded bet of 233 is worth more than the check', () => {
    const st = nodeAt(FX.aces, TURN);
    const input = planInput(st, [233]);
    expect(input.heroInPosition).toBe(false);
    expect(input.oppLine).toBe('called_bet');
    const plan = omahaStreetPlan(input)!;
    const [check, bet] = plan.lines;
    expect(Math.round(check.ev)).toBe(191);
    expect(Math.round(bet.ev)).toBe(232);
    expect(plan.best).toBe(1);
    expect(bet.vsAggression).toBe('call');
    expect(bet.commitShare).toBeCloseTo(0.365, 2);
  });

  it('outside the first layer there is no plan: multiway, a tournament, hi-lo, a bet to call', () => {
    const st = nodeAt(FX.straight, TURN);
    expect(omahaStreetPlanTurnSpot(st.hero, { ...st.gs, gameMode: 'tournament' })).toBe(false);
    expect(omahaStreetPlanTurnSpot(st.hero, { ...st.gs, gameVariant: 'plo8' })).toBe(false);
    expect(omahaStreetPlanTurnSpot(st.hero, { ...st.gs, gameVariant: 'plo6' })).toBe(false);
    expect(omahaStreetPlanTurnSpot(st.hero, { ...st.gs, toCall: 50, currentBet: 50 })).toBe(false);
    const third = {
      ...st.gs,
      players: st.gs.players.map((p, i) =>
        p.is_folded && i === st.gs.players.findIndex((q) => q.is_folded)
          ? { ...p, is_folded: false, cards: cards('2c3c4c5c6c') }
          : p
      ),
    };
    expect(omahaStreetPlanTurnSpot(st.hero, third)).toBe(false);
    const flop = nodeAt(FX.aces, 14);
    expect(omahaStreetPlanTurnSpot(flop.hero, flop.gs)).toBe(false);
  });
});

describe('omahaStreetPlan: the turn decision', () => {
  it('59521326 off: the Horse bets the board-pairing turn at every seed; unset, false and a truthy non-boolean decide byte-identically', () => {
    const unset = play(() => nodeAt(FX.straight, TURN), {});
    expect(only(unset)).toEqual(['bet']);
    for (const v of [false, 1 as unknown as boolean, 'true' as unknown as boolean])
      expect(play(() => nodeAt(FX.straight, TURN), { omahaStreetPlan: v }).bytes).toEqual(
        unset.bytes
      );
  });

  it('59521326 on: the bet becomes a check at every seed, with the receipt and the plan on the decision, and the random stream is untouched', () => {
    const off = play(() => nodeAt(FX.straight, TURN), {});
    const on = play(() => nodeAt(FX.straight, TURN), ON);
    expect(only(on)).toEqual(['check']);
    expect(
      hasFire(on, 'omaha_street_plan_commit_avoided') +
        hasFire(on, 'omaha_street_plan_line_changed')
    ).toBe(SEEDS.length);
    expect(hasFire(on, 'omaha_street_plan_commit_avoided')).toBeGreaterThan(0);
    expect(on.next).toEqual(off.next);
    for (const p of on.plans as { chosen: string; ev: { check: number; bet: number } }[]) {
      expect(p.chosen).toBe('check');
      expect(p.ev.check).toBeGreaterThan(p.ev.bet);
    }
    // the mind off changes nothing here: no measured read exists in a replay
    expect(play(() => nodeAt(FX.straight, TURN), { ...ON, mind: false }).actions).toEqual(
      on.actions
    );
    // the per-decision cost is recorded in STATUS.md; this is only a ceiling
    expect(on.ms).toBeLessThan(1500);
  });

  it('59521326 on: the check is admitted by the worker receipt validator', () => {
    for (const s of SEEDS.slice(0, 6)) {
      HorseMind.reset();
      seedFastRandom(s);
      const st = nodeAt(FX.straight, TURN);
      const d = structuredClone(HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, ON));
      expect(d.action).toBe('check');
      expect(
        horseDecisionReceiptRefusal(structuredClone(d), 'plo5', {
          player: st.hero,
          gameState: st.gs,
        })
      ).toBeNull();
      // Against a request in which the plan prices the bet higher (the aces
      // hand's turn) the street plan's own admission refuses it. In the
      // integrated 2026-11-15 head both requests are also owner-ruled check
      // spots (omahaOopCheckSpot: the turn after the called flop bet, the
      // pairing turn), whose admission admits a check there; the refusal is
      // asserted only where no other admission covers the request.
      const other = nodeAt(FX.aces, TURN);
      expect(omahaStreetPlanAdmitsCheck(other.hero, other.gs, undefined, d.streetPlan)).toBe(false);
      if (!omahaOopCheckSpot(other.hero, other.gs))
        expect(
          horseDecisionReceiptRefusal(structuredClone(d), 'plo5', {
            player: other.hero,
            gameState: other.gs,
          })
        ).toBe('policy_graph');
      // and with a forged tendency record
      const forged = structuredClone(d);
      forged.streetPlan!.tendency = [9, 1, 1, 0];
      if (!omahaOopCheckSpot(st.hero, st.gs))
        expect(
          horseDecisionReceiptRefusal(forged, 'plo5', { player: st.hero, gameState: st.gs })
        ).toBe('policy_graph');
    }
  });

  it('59517323 on: the turn wager is the one the engine chose at every seed (the plan prices the bet above the check) and a bet carries its plan', () => {
    const off = play(() => nodeAt(FX.aces, TURN), {});
    const on = play(() => nodeAt(FX.aces, TURN), ON);
    expect(on.wagers).toEqual(off.wagers);
    expect(on.next).toEqual(off.next);
    expect(hasFire(on, 'omaha_street_plan_line_changed')).toBe(0);
    expect(hasFire(on, 'omaha_street_plan_commit_avoided')).toBe(0);
    on.actions.forEach((a, i) => {
      if (a === 'bet') expect((on.plans[i] as { chosen: string }).chosen).toBe('bet');
      else expect(on.plans[i]).toBeUndefined();
    });
  });

  it('59517323 flop and river, 59518335 preflop and multiway flop: outside the first layer, on decides byte-identically to off', () => {
    for (const [fx, ord] of [
      [FX.aces, 14],
      [FX.aces, 18],
      [FX.aces, 20],
      [FX.queens, 7],
      [FX.queens, 13],
      [FX.queens, 16],
    ] as const) {
      const off = play(() => nodeAt(fx, ord), {});
      const on = play(() => nodeAt(fx, ord), ON);
      expect(on.bytes).toEqual(off.bytes);
    }
  });
});

describe('omahaStreetPlan: the river follows the turn plan', () => {
  it('59521326: the turn state is rebuilt from the public history and the recomputed plan calls the river that came', () => {
    const river = nodeAt(FX.straight, RIVER);
    const back = omahaPlanTurnStateFromRiver(river.hero, river.gs)!;
    const turn = nodeAt(FX.straight, TURN);
    expect(back.input.pot).toBeCloseTo(669, 6);
    expect(back.input.heroStack).toBeCloseTo(turn.hero.stack, 6);
    expect(back.input.oppStack).toBeCloseTo(1477.3, 6);
    expect(back.input.heroInvested).toBeCloseTo(327, 6);
    expect(back.input.oppLine).toBe('called_raise');
    expect(back.input.heroInPosition).toBe(false);
    expect(back.faced).toBeCloseTo(524.02, 6);
    const plan = omahaStreetPlan(back.input)!;
    // the same plan the turn would have computed for that bet (no veto, no read)
    expect(JSON.stringify(plan)).toBe(JSON.stringify(omahaStreetPlan(planInput(turn, [373]))));
    expect(omahaPlanRiverVerdict(plan, back.river, back.faced)).toBe('call');
    // new information: a bet larger than the plan priced is not the planned spot
    expect(omahaPlanRiverVerdict(plan, back.river, back.faced * 1.5)).toBe('unplanned');
  });

  it('59521326 off: the paired-board fold folds the straight; on: the fold stands aside and the reference decision (all in for the call) stands, admitted by the validator', () => {
    const off = play(() => nodeAt(FX.straight, RIVER), {});
    expect(only(off)).toEqual(['fold']);
    expect(hasFire(off, 'plo_paired_board_fold')).toBe(SEEDS.length);
    const on = play(() => nodeAt(FX.straight, RIVER), ON);
    expect(on.actions.filter((a) => a === 'fold')).toEqual([]);
    expect(hasFire(on, 'omaha_street_plan_followed')).toBe(SEEDS.length);
    expect(hasFire(on, 'plo_paired_board_fold')).toBe(0);
    expect(on.actions).toEqual(
      play(() => nodeAt(FX.straight, RIVER), { ploPairedBoardFold: false }).actions
    );
    expect(on.next).toEqual(off.next);
    HorseMind.reset();
    seedFastRandom(1);
    const st = nodeAt(FX.straight, RIVER);
    const d = structuredClone(HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, ON));
    expect(
      horseDecisionReceiptRefusal(structuredClone(d), 'plo5', { player: st.hero, gameState: st.gs })
    ).toBeNull();
  });

  it('the league game state carries no toCall field: the river still follows the plan', () => {
    const build = () => {
      const st = nodeAt(FX.straight, RIVER);
      delete (st.gs as { toCall?: number }).toCall;
      return st;
    };
    const st = build();
    expect(omahaPlanTurnStateFromRiver(st.hero, st.gs)!.faced).toBeCloseTo(524.02, 6);
    const on = play(build, ON);
    expect(hasFire(on, 'omaha_street_plan_followed')).toBe(SEEDS.length);
    expect(on.actions.filter((a) => a === 'fold')).toEqual([]);
  });

  it('a river the plan folds keeps the paired-board fold: two pair that paired the board on the river', () => {
    // the same line with a hand the plan does not call the river with
    const build = () =>
      nodeAt(FX.straight, RIVER, (f) => {
        f.hole['5'] = cards('KhKdQc9c8d');
      });
    const st = build();
    const back = omahaPlanTurnStateFromRiver(st.hero, st.gs);
    if (back) {
      const plan = omahaStreetPlan(back.input)!;
      expect(omahaPlanRiverVerdict(plan, back.river, back.faced)).not.toBe('call');
    }
    const off = play(build, {});
    const on = play(build, ON);
    expect(on.bytes).toEqual(off.bytes);
    expect(hasFire(on, 'omaha_street_plan_followed')).toBe(0);
  });
});
