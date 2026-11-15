/**
 * OMAHA STRONG HAND VALUE (option omahaStrongHandValue, default OFF; owner
 * 2026-11-15 12:16: the earlier all-hands playbook's PLO4 / PLO5 cash
 * entries).
 *
 * The nodes are river decisions the study flagged, a Horse holding a full
 * house (HorseOmahaStrongHandValue.test-support.ts; no identities, no
 * person's cards), by the study's pattern: P1 checked to and checked, P2
 * facing a bet and raised, P3 facing a bet and only called, P4 checked with
 * players behind, P5 checked back, P6 folded. Each test states what today's
 * brain does at the node with the option unset and what it does with it on,
 * with the numbers of the comparison.
 *
 * The decisions run with the opponent memory off (every opponent is the
 * population prior) unless a test supplies a measured read.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { replayProfiles, stateAt } from './HorseComplaintReplay.js';
import { horseDecisionReceiptRefusal } from './horseDecision/responseValidation.js';
import {
  omahaCardImpact,
  omahaCardImpactAmounts,
  omahaCardImpactLine,
  omahaCardImpactRead,
} from './HorseOmahaCardImpact.js';
import type { OmahaReadConditional } from './HorseOmahaReadConditional.js';
import {
  omahaStrongHandCheckScope,
  omahaStrongHandCheckedTo,
  omahaStrongHandNow,
  omahaStrongHandRaiseVerdict,
} from './HorseOmahaStrongHandValue.js';
import {
  RECORDED_STRONG_HANDS,
  expandStrongHand,
  type RecordedStrongHand,
} from './HorseOmahaStrongHandValue.test-support.js';

const LIVE = replayProfiles('cash').find((p) => p.live)!;
const SEEDS = [1, 2, 3, 4, 5, 6];
const ON: HorseDecideOpts = { omahaStrongHandValue: true };
const BET = 'omaha_strong_hand_value_bet';
const RAISE = 'omaha_strong_hand_value_raise';
const INDUCE = 'omaha_strong_hand_induce_check';

const rec = (p: RecordedStrongHand['p'], h: string, seat?: number): RecordedStrongHand =>
  RECORDED_STRONG_HANDS.find(
    (r) => r.p === p && r.h === h && (seat === undefined || r.seat === seat)
  )!;
function at(r: RecordedStrongHand, change?: (r: RecordedStrongHand) => void) {
  const copy = JSON.parse(JSON.stringify(r)) as RecordedStrongHand;
  change?.(copy);
  const { fx, node } = expandStrongHand(copy);
  return stateAt(fx, node);
}
const decisionBytes = (d: unknown): string =>
  JSON.stringify(d, (k, v) => (k === 'latencyMs' || k === 'elapsedMs' ? undefined : v));

interface Outcome {
  bytes: string[];
  /** the action, with its amount when it has one: "bet:68", "check", "all_in" */
  plays: string[];
  fires: string[][];
}
function play(
  r: RecordedStrongHand,
  opts: HorseDecideOpts,
  change?: (r: RecordedStrongHand) => void,
  more: Record<string, unknown> = { mind: false }
): Outcome {
  enableBrainTelemetry();
  const out: Outcome = { bytes: [], plays: [], fires: [] };
  for (const seed of SEEDS) {
    HorseMind.reset();
    drainFires();
    seedFastRandom(seed);
    const st = at(r, change);
    const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
      telemetry: true,
      ...more,
      ...opts,
    } as never);
    out.bytes.push(decisionBytes(d));
    out.plays.push(d.amount === undefined ? d.action : `${d.action}:${d.amount}`);
    out.fires.push(drainFires().map((f) => f.feature));
  }
  return out;
}
const every = (o: Outcome, p: string) => o.plays.every((x) => x === p);
const fired = (o: Outcome, f: string) => o.fires.filter((x) => x.includes(f)).length;
const mine = (o: Outcome) =>
  o.fires.flat().filter((f) => f.startsWith('omaha_strong_hand_')).length;
function checkOf(r: RecordedStrongHand, reads?: Map<number, OmahaReadConditional | null>) {
  const st = at(r);
  const scope = omahaStrongHandCheckScope(st.hero, st.gs as never)!;
  return omahaStrongHandCheckedTo(st.hero, st.gs as never, scope, reads)!;
}
const raiseOf = (r: RecordedStrongHand) => {
  const st = at(r);
  return omahaStrongHandRaiseVerdict(st.hero, st.gs as never, {});
};

afterEach(() => {
  vi.restoreAllMocks();
  HorseMind.setDecisionScope(null);
  HorseMind.reset();
});

describe('a full house first to act on the river (P4: checked with players behind)', () => {
  // Today's brain checks all three (the no-lead rule). The value bet of
  // highest expected value is worth more than the check.
  it.each([
    // queens full on 7-7-5-Q-K, heads-up, 68 in the pot: three two-card holdings beat it
    ['0be91f45', 'bet:68', 1],
    // tens full of fives on 5-K-5-2-T, heads-up, 297 in the pot: half the pot is the best size
    ['b4a28cc7', 'bet:149', 1],
    // sixes full of threes on 6-3-4-T-3, two opponents, 80 in the pot
    ['389f2a50', 'bet:80', 2],
  ] as const)('study hand %s: the check becomes %s', (h, bet, opponents) => {
    const r = rec('P4', h);
    expect(every(play(r, {}), 'check')).toBe(true);
    const on = play(r, ON);
    expect(every(on, bet)).toBe(true);
    expect(fired(on, BET)).toBe(SEEDS.length);
    const v = checkOf(r);
    expect(v.opponents).toBe(opponents);
    expect(v.heroCloses).toBe(false);
    expect(v.changed).toBe('value_bet');
    // the hands that call and lose outweigh those that call or raise and win
    expect(v.best!.worse).toBeGreaterThan(v.best!.better);
    expect(v.best!.ev).toBeGreaterThanOrEqual(v.evCheck);
  });

  it('the numbers of one: queens full heads-up, the pot bet is worth 97.01 against 81.60 for the check', () => {
    const v = checkOf(rec('P4', '0be91f45'));
    expect(v.evCheck).toBe(81.6);
    expect(v.best).toMatchObject({ amount: 68, ev: 97.01, worse: 0.46, better: 0.04 });
    // every size is a value bet, and the expected value rises with the size
    expect(v.rows.map((x) => x.value)).toEqual([true, true, true, true, true]);
    expect(v.rows.map((x) => x.ev)).toEqual([81.9, 87.41, 91.22, 93.03, 97.01]);
  });

  it('heads-up the numbers are the card-impact module`s own', () => {
    const st = at(rec('P4', '0be91f45'));
    const scope = omahaStrongHandCheckScope(st.hero, st.gs as never)!;
    const opp = scope.opponents[0];
    const impact = omahaCardImpact({
      hole: st.hero.cards,
      board: st.gs.communityCards,
      dead: [],
      pot: st.gs.pot,
      heroStack: st.hero.stack,
      oppStack: opp.stack,
      heroCloses: false,
      line: omahaCardImpactLine(st.hero, opp, st.gs as never),
      read: omahaCardImpactRead(null),
      amounts: omahaCardImpactAmounts(st.hero, opp, st.gs as never),
      seedSalt: opp.seat * 16 + st.hero.seat,
    })!;
    const v = omahaStrongHandCheckedTo(st.hero, st.gs as never, scope)!;
    expect(v.evCheck).toBe(impact.options[0].ev);
    expect(v.rows.map((x) => [x.amount, x.ev, x.value])).toEqual(
      impact.options.slice(1).map((o) => [o.amount, o.ev, o.value])
    );
  });

  it('three opponents behind, queens full of sixes: the check is worth more than every value bet and is kept as the induce', () => {
    const r = rec('P4', '1ffaa1e3');
    const on = play(r, ON);
    expect(every(on, 'check')).toBe(true);
    expect(fired(on, INDUCE)).toBe(SEEDS.length);
    expect(fired(on, BET)).toBe(0);
    const v = checkOf(r);
    expect(v.opponents).toBe(3);
    expect(v.changed).toBe('induce_check');
    expect(v.best!.value).toBe(true);
    expect(v.evCheck).toBeGreaterThan(v.best!.ev);
  });

  it('a bottom full house (threes full of queens on Q-3-9-3-8): at every size the better hands that call outweigh the worse ones, so it stays a check', () => {
    const r = rec('P4', '56d66080');
    const on = play(r, ON);
    expect(every(on, 'check')).toBe(true);
    expect(mine(on)).toBe(0);
    const v = checkOf(r);
    expect(v.best).toBeNull();
    expect(v.changed).toBeNull();
    for (const row of v.rows) expect(row.better).toBeGreaterThan(row.worse);
  });

  it('the induce depends on the player: against a measured bettor who bets when checked to and folds to a bet, the heads-up check is worth more', () => {
    const r = rec('P4', '0be91f45');
    const st = at(r);
    const opp = omahaStrongHandCheckScope(st.hero, st.gs as never)!.opponents[0];
    const stat = (mean: number, engaged: 'high' | 'low' | null) => ({ mean, n: 60, engaged });
    const read = {
      hands: 300,
      measured: true,
      tightReRaiser: false,
      valueLeader: false,
      threeBet: stat(0.08, null),
      betCheckedTo: stat(0.9, 'high'),
      foldToBet: stat(0.9, 'high'),
      riverCall: stat(0.1, 'low'),
    } as unknown as OmahaReadConditional;
    const unknown = checkOf(r);
    const measured = checkOf(r, new Map([[opp.seat, read]]));
    expect(unknown.changed).toBe('value_bet');
    expect(measured.changed).toBe('induce_check');
    expect(measured.evCheck).toBeGreaterThan(measured.best!.ev);
    expect(measured.evCheck).toBeGreaterThan(unknown.evCheck);
    // and through the brain, with the memory on and that read
    vi.spyOn(HorseMind, 'omahaReadConditionalOf').mockImplementation(() => read);
    const on = play(r, ON, undefined, { observeMind: false });
    expect(every(on, 'check')).toBe(true);
    expect(fired(on, INDUCE)).toBe(SEEDS.length);
  });
});

// Owner rulings 2026-11-14 (hand 59401453) and 2026-11-15 12:52/12:53 (hand
// 59534208): facing a bet, a raise only with the nuts. Clause (b) applies only
// to a hand that is nut class right now (omahaNutClassNow).
const NUT_KINGS_FULL = (x: RecordedStrongHand) => {
  // kings full of sevens on 7-7-5-Q-K: no bigger full house, no quads, no
  // straight flush is possible
  x.hole = 'KdKs7hQd2c';
};

describe('a full house facing a river bet (P2 raised, P3 only called): a raise only with the nuts', () => {
  it.each([
    // queens full on 7-7-5-Q-K facing 34 into 68: kings full beats it
    ['P3', '0be91f45'],
    // kings full of sixes on 2-K-6-J-6: sixes full of kings and quads beat it
    ['P3', '941f1dbf'],
    // jacks full of queens on J-4-8-J-Q: queens full beats it
    ['P3', '8e51c875'],
    ['P3', '09948c66'],
    ['P3', 'b428e415'],
    ['P2', '0a77c620'],
    ['P2', '6686469e'],
    ['P2', 'e37723f1'],
    ['P2', '19fcf4d3'],
    ['P2', '48ac6c89'],
  ] as const)(
    'GUARD %s study hand %s: a full house a bigger one beats keeps today`s answer',
    (p, h) => {
      const r = rec(p, h);
      const st = at(r);
      expect(omahaStrongHandNow(st.hero, st.gs as never)).toBe(true);
      expect(omahaStrongHandRaiseVerdict(st.hero, st.gs as never, {})).toBeNull();
      const off = play(r, {});
      expect(off.plays.every((x) => x.startsWith('call:'))).toBe(true);
      const on = play(r, ON);
      expect(on.bytes).toEqual(off.bytes);
      expect(fired(on, RAISE)).toBe(0);
    }
  );

  it('GUARD: sevens full of kings on 7-7-K-8-5 (kings and eights make bigger full houses) facing a raise of nearly twice the pot does not raise', () => {
    const r = rec('P2', '7c7c4ace');
    const on = play(r, ON);
    expect(on.plays.every((p) => p === 'call:173')).toBe(true);
    expect(mine(on)).toBe(0);
    expect(on.bytes).toEqual(play(r, {}).bytes);
    expect(raiseOf(r)).toBeNull();
  });

  it('a nut full house (kings full of sevens on 7-7-5-Q-K) facing 34 into 68 is priced at every raise size and raises at the best one', () => {
    const r = rec('P3', '0be91f45');
    const st = at(r, NUT_KINGS_FULL);
    const v = omahaStrongHandRaiseVerdict(st.hero, st.gs as never, {})!;
    expect(v).not.toBeNull();
    expect(v.beaten).toBe(0);
    expect(v.raise).toBe(true);
    // against the holdings that continue it never loses
    for (const row of v.rows) expect(row.lose).toBe(0);
    expect(v.best!.ev).toBe(Math.max(...v.rows.map((x) => x.ev)));
    expect(v.best!.ev - v.evCall).toBeGreaterThan(v.margin);
    const on = play(r, ON, NUT_KINGS_FULL);
    expect(on.plays.every((p) => p.startsWith('raise:') || p === 'all_in')).toBe(true);
  });
});

describe('a full house checked to on the river (P1, P5)', () => {
  // Today's brain bets half the pot with every one of these (the checked-to
  // rule for a full house with a lower one under it). The option prices it.
  it('queens full of jacks on a three-jack board, five opponents: the half-pot bet becomes the size of highest expected value', () => {
    const r = rec('P1', '538a541c', 4);
    expect(every(play(r, {}), 'bet:31')).toBe(true);
    const on = play(r, ON);
    expect(every(on, 'bet:41')).toBe(true);
    expect(fired(on, BET)).toBe(SEEDS.length);
    const v = checkOf(r);
    expect(v.opponents).toBe(5);
    expect(v.best).toMatchObject({ amount: 41, ev: 68.42 });
    expect(v.evCheck).toBe(62.86);
  });

  it('tens full of jacks on the same board in the same hand, five opponents: twice the better hands, and the check is worth more', () => {
    const r = rec('P1', '538a541c', 3);
    expect(every(play(r, {}), 'bet:31')).toBe(true);
    const on = play(r, ON);
    expect(every(on, 'check')).toBe(true);
    expect(fired(on, INDUCE)).toBe(SEEDS.length);
    const v = checkOf(r);
    expect(v.evCheck).toBeGreaterThan(v.best!.ev);
    expect(v.best!.better).toBeGreaterThan(checkOf(rec('P1', '538a541c', 4)).best!.better);
  });

  it('sevens full on a three-eight board with four opponents: the check is worth more than the one thin value bet', () => {
    const r = rec('P1', 'dd81da86');
    expect(every(play(r, {}), 'bet:34')).toBe(true);
    const on = play(r, ON);
    expect(every(on, 'check')).toBe(true);
    const v = checkOf(r);
    expect(v.rows.filter((x) => x.value)).toHaveLength(1);
    expect(v.evCheck).toBeGreaterThan(v.best!.ev);
  });

  it('fives full on a three-queen board, two opponents (one bet the flop and the turn): no size is a value bet, and the half-pot bet of 117 into 234 is not made', () => {
    const r = rec('P1', '076f7dff');
    expect(every(play(r, {}), 'bet:117')).toBe(true);
    const on = play(r, ON);
    expect(every(on, 'check')).toBe(true);
    expect(mine(on)).toBe(0);
    const v = checkOf(r);
    expect(v.best).toBeNull();
    for (const row of v.rows) expect(row.better).toBeGreaterThan(row.worse);
  });

  it('last to act, checked back in the study (P5): a value bet where the count gives one, a check where it does not', () => {
    const value = rec('P5', 'f9f7dcfe');
    const on = play(value, ON);
    expect(every(on, 'bet:6')).toBe(true);
    expect(fired(on, BET)).toBe(SEEDS.length);
    expect(checkOf(value).heroCloses).toBe(true);
    // sixes full on a three-queen board and fours full on aces over nines: heads-up,
    // nearly half the range that calls beats the hand at every size
    for (const h of ['e4758eb7', 'f2a83e1d']) {
      const r = rec('P5', h);
      expect(play(r, {}).plays.every((p) => p.startsWith('bet:'))).toBe(true);
      const checked = play(r, ON);
      expect(every(checked, 'check')).toBe(true);
      expect(mine(checked)).toBe(0);
      expect(checkOf(r).best).toBeNull();
    }
  });

  it('a bet today`s brain already makes is not re-priced', () => {
    const r = rec('P5', 'b14ef9f6');
    const off = play(r, {});
    expect(off.plays.every((p) => p.startsWith('bet:'))).toBe(true);
    expect(play(r, ON).bytes).toEqual(off.bytes);
  });
});

describe('a full house folded to a river bet in the study (P6)', () => {
  it('both call today, and the option does not change the call', () => {
    for (const h of ['1ad68cbf', 'c9b18923']) {
      const r = rec('P6', h);
      const off = play(r, {});
      expect(off.plays.every((p) => p.startsWith('call:'))).toBe(true);
      const on = play(r, ON);
      expect(on.bytes).toEqual(off.bytes);
      expect(mine(on)).toBe(0);
    }
    // not nut class: no raise is priced
    expect(raiseOf(rec('P6', 'c9b18923'))).toBeNull();
  });
});

describe('scope and guards', () => {
  it('GUARD: out of position without a full house or a nut-class hand, nothing changes (the owner`s ruling stays with its own rules)', () => {
    // trip sevens first to act on 7-7-5-Q-K; a queen-high flush first to act
    // on a paired three-club board; trip sevens facing the bet
    const cases: Array<[RecordedStrongHand, string]> = [
      [rec('P4', '0be91f45'), '7h8c9cJd2s'],
      [rec('P4', 'b4a28cc7'), 'Qc9c8d7h3s'],
      [rec('P3', '0be91f45'), '7h8c9cJd2s'],
    ];
    for (const [r, hole] of cases) {
      const swap = (x: RecordedStrongHand) => {
        x.hole = hole;
      };
      const st = at(r, swap);
      expect(omahaStrongHandNow(st.hero, st.gs as never)).toBe(false);
      expect(omahaStrongHandCheckScope(st.hero, st.gs as never)).toBeNull();
      expect(omahaStrongHandRaiseVerdict(st.hero, st.gs as never, {})).toBeNull();
      const on = play(r, ON, swap);
      expect(on.bytes).toEqual(play(r, {}, swap).bytes);
      expect(mine(on)).toBe(0);
      expect(on.plays.some((p) => p.startsWith('raise') || p === 'all_in')).toBe(false);
    }
  });

  it('cash only, the river only, one board, high only', () => {
    const st = at(rec('P4', '0be91f45'));
    expect(omahaStrongHandCheckScope(st.hero, st.gs as never)).not.toBeNull();
    const not = (change: Record<string, unknown>) =>
      omahaStrongHandCheckScope(st.hero, { ...st.gs, ...change } as never);
    expect(not({ gameMode: 'tournament' })).toBeNull();
    expect(not({ stage: 'turn' })).toBeNull();
    expect(not({ gameVariant: 'plo6' })).toBeNull();
    expect(not({ bombPot: true })).toBeNull();
    expect(not({ boardCount: 2 })).toBeNull();
    expect(not({ variantRules: { splitLow8OrBetter: true } })).toBeNull();
    const facing = at(rec('P3', '0be91f45'), NUT_KINGS_FULL);
    expect(omahaStrongHandRaiseVerdict(facing.hero, facing.gs as never, {})).not.toBeNull();
    expect(
      omahaStrongHandRaiseVerdict(
        facing.hero,
        { ...facing.gs, gameMode: 'tournament' } as never,
        {}
      )
    ).toBeNull();
  });

  it('a raise needs a bettor who can match it and nobody else in the hand', () => {
    const st = at(rec('P3', '0be91f45'), NUT_KINGS_FULL);
    expect(omahaStrongHandRaiseVerdict(st.hero, st.gs as never, {})).not.toBeNull();
    const bettorSeat = 6;
    const allIn = {
      ...st.gs,
      players: st.gs.players.map((p) =>
        p.seat === bettorSeat ? { ...p, stack: 0, is_all_in: true } : p
      ),
    };
    expect(omahaStrongHandRaiseVerdict(st.hero, allIn as never, {})).toBeNull();
    const third = {
      ...st.gs,
      players: st.gs.players.map((p) => (p.seat === 3 ? { ...p, is_folded: false } : p)),
    };
    expect(omahaStrongHandRaiseVerdict(st.hero, third as never, {})).toBeNull();
  });

  it('unset, false and a truthy non-boolean are byte-identical to today on every node', () => {
    for (const r of RECORDED_STRONG_HANDS) {
      const off = play(r, {});
      expect(play(r, { omahaStrongHandValue: false }).bytes).toEqual(off.bytes);
      expect(play(r, { omahaStrongHandValue: 'yes' as never }).bytes).toEqual(off.bytes);
      expect(mine(off)).toBe(0);
    }
  });

  it('the worker receipt validator accepts every decision the option changes', () => {
    enableBrainTelemetry();
    let checked = 0;
    for (const r of RECORDED_STRONG_HANDS) {
      const st = at(r);
      HorseMind.reset();
      seedFastRandom(1);
      const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
        mind: false,
        ...ON,
      } as never);
      if (d.policyGraph === undefined) continue;
      checked++;
      expect(
        horseDecisionReceiptRefusal(structuredClone(d), r.variant, {
          player: st.hero,
          gameState: st.gs,
        })
      ).toBeNull();
    }
    expect(checked).toBeGreaterThan(0);
  });
});
