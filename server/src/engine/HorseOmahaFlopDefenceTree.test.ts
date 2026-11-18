/**
 * omahaFlopDefenceIsPriced (WooWoo audit FLOP-DEFENCE, 2026-11-18, default
 * OFF): the heads-up first-bet flop call priced as a two-street tree
 * (HorseOmahaFlopDefenceTree.ts) inside the flop verdict; alone it answers
 * only that spot.
 *
 * Recorded spots: the anonymised recorded flop decisions already in the repo
 * (HorseOmahaFlopFacingBetEv.test-support.ts: public actions, board, stacks
 * and the Horse's own cards only; no other player's cards, no ids beyond the
 * hand number already there).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { withoutMeasurements } from './HorseDeclaredWork.test-support.js';
import { seedFastRandom } from './HorseEval.js';
import { replayProfiles, stateAt } from './HorseComplaintReplay.js';
import {
  OMAHA_FLOP_DEFENCE_RIVER_BLUFF_ODDS,
  OMAHA_FLOP_DEFENCE_RIVER_STEP_ODDS,
  OMAHA_FLOP_DEFENCE_TURN_BLUFF_ODDS,
  omahaFlopDefenceCheckingShare,
  omahaFlopDefenceShiftedShare,
  omahaFlopDefenceTreeEv,
  omahaFlopDefenceTreeInputs,
  type OmahaFlopDefenceTreeInputs,
} from './HorseOmahaFlopDefenceTree.js';
import {
  omahaFlopFacingBetEvAnswer,
  omahaFlopFacingBetEvRule,
} from './HorseOmahaFlopFacingBetEvRule.js';
import {
  RECORDED_FLOP_FACING_BETS,
  expandFlop,
  type FlopEdit,
  type RecordedFlopFacingBet,
} from './HorseOmahaFlopFacingBetEv.test-support.js';
import { emptyStreetRead } from './HorseOmahaStreetRead.js';

const LIVE = replayProfiles('cash').find((p) => p.live)!;
const at = (r: RecordedFlopFacingBet, edit: FlopEdit = {}) => {
  const { fx, node } = expandFlop(r, edit);
  return stateAt(fx, node);
};
const BASE = {
  mind: false,
  telemetry: false,
  rake: 0,
  inPosition: false,
  bareOverpairContinuation: false,
};
const PERSON: OmahaFlopDefenceTreeInputs = omahaFlopDefenceTreeInputs('person', null);

/** rows of `n` runouts over `turns` turn cards, each runout [vw, vn, ow, on] */
function rowsOf(n: number, turns: number, f: (k: number) => [number, number, number, number]) {
  const rows = new Float64Array(n * 4);
  const turnOf = new Int16Array(n);
  for (let k = 0; k < n; k++) {
    rows.set(f(k), k * 4);
    turnOf[k] = k % turns;
  }
  return { rows, turnOf };
}
const SPOT = { paid: 30, winnable: 70, left: 300, rake: 0, bluffShare: 0.45 };

afterEach(() => vi.restoreAllMocks());

describe('the tree, unit', () => {
  it('the range by street keeps the measured odds and his checking range completes his range', () => {
    expect(OMAHA_FLOP_DEFENCE_TURN_BLUFF_ODDS).toBeCloseTo(0.885, 3);
    expect(OMAHA_FLOP_DEFENCE_RIVER_BLUFF_ODDS).toBeCloseTo(0.602, 3);
    // the measured composition itself: 45% non-value on the flop -> 42% turn, 33% river
    expect(omahaFlopDefenceShiftedShare(0.45, OMAHA_FLOP_DEFENCE_TURN_BLUFF_ODDS)).toBeCloseTo(0.42, 6);
    expect(omahaFlopDefenceShiftedShare(0.45, OMAHA_FLOP_DEFENCE_RIVER_BLUFF_ODDS)).toBeCloseTo(0.33, 6);
    // street by street: the river step applied to his turn betting range lands on the measured river share
    expect(OMAHA_FLOP_DEFENCE_RIVER_STEP_ODDS).toBeCloseTo(0.68, 2);
    expect(
      omahaFlopDefenceShiftedShare(
        omahaFlopDefenceShiftedShare(0.45, OMAHA_FLOP_DEFENCE_TURN_BLUFF_ODDS),
        OMAHA_FLOP_DEFENCE_RIVER_STEP_ODDS
      )
    ).toBeCloseTo(0.33, 6);
    for (const q of [0.1, 0.3, 0.45, 0.7])
      for (const b of [0.2, 0.343, 0.58, 0.9]) {
        const qb = omahaFlopDefenceShiftedShare(q, OMAHA_FLOP_DEFENCE_TURN_BLUFF_ODDS);
        const qc = omahaFlopDefenceCheckingShare(q, b, qb);
        expect(b * qb + (1 - b) * qc).toBeCloseTo(q, 9);
        expect(qc).toBeGreaterThanOrEqual(q); // the checking range is the weaker part
      }
  });

  it('later-street rates are his kind measured rates, moved continuously by his own per-street cells', () => {
    expect(PERSON.turnBet).toBeCloseTo(0.343, 9);
    expect(PERSON.riverBet).toBeCloseTo(0.319, 9);
    const horse = omahaFlopDefenceTreeInputs('horse', null);
    expect(horse.turnBet).toBeCloseTo(0.403, 9);
    const row = emptyStreetRead();
    row.bet.turn = { hit: 1e-9, opp: 1e-9 };
    expect(omahaFlopDefenceTreeInputs('person', row).turnBet).toBeCloseTo(0.343, 6); // no step at zero
    row.bet.turn = { hit: 58, opp: 100 };
    const deep = omahaFlopDefenceTreeInputs('person', row).turnBet;
    expect(deep).toBeGreaterThan(0.55);
    expect(deep).toBeLessThan(0.58);
  });

  it('the nuts calls and calls every barrel; a hand that never wins is worth exactly minus the call', () => {
    const nuts = rowsOf(40, 10, () => [2, 2, 1, 1]);
    const t = omahaFlopDefenceTreeEv(nuts.rows, nuts.turnOf, SPOT, PERSON)!;
    expect(t.turnCallShare).toBe(1);
    expect(t.ev).toBeGreaterThan(70); // more than the pot as it stands: later streets pay
    const air = rowsOf(40, 10, () => [0, 2, 0, 1]);
    expect(omahaFlopDefenceTreeEv(air.rows, air.turnOf, SPOT, PERSON)!.ev).toBeCloseTo(-30, 9);
  });

  it('with nothing behind the tree is the showdown share of the pot less the call', () => {
    const r = rowsOf(40, 10, (k) => [k % 2, 1, 1, 1]);
    const t = omahaFlopDefenceTreeEv(r.rows, r.turnOf, { ...SPOT, left: 0 }, PERSON)!;
    // share = 0.55 x 0.5 + 0.45 x 1 = 0.725 of a pot of 100
    expect(t.ev).toBeCloseTo(0.725 * 100 - 30, 6);
  });

  it('a hand that beats his air but not his value loses value as his barrel rate rises: the turn is priced in, not a factor', () => {
    const r = rowsOf(60, 12, (k) => [k % 5 === 0 ? 1 : 0, 1, k % 2, 1]);
    const evs = [0.2, 0.343, 0.58, 0.8].map(
      (b) => omahaFlopDefenceTreeEv(r.rows, r.turnOf, SPOT, { ...PERSON, turnBet: b })!.ev
    );
    for (let i = 1; i < evs.length; i++) expect(evs[i]).toBeLessThan(evs[i - 1]);
  });

  it('the pot raise is measured beside the call: worth more the more he folds to a raise, and it never moves the call', () => {
    const r = rowsOf(60, 12, (k) => [k % 3 === 0 ? 1 : 0, 1, k % 2, 1]);
    const base = omahaFlopDefenceTreeEv(r.rows, r.turnOf, SPOT, PERSON)!;
    expect(PERSON.foldToRaise).toBeCloseTo(0.15, 9);
    expect(omahaFlopDefenceTreeInputs('horse', null).foldToRaise).toBeCloseTo(0.61, 9);
    let last = -Infinity;
    for (const f of [0.05, 0.15, 0.4, 0.61, 0.9]) {
      const t = omahaFlopDefenceTreeEv(r.rows, r.turnOf, SPOT, { ...PERSON, foldToRaise: f })!;
      expect(t.ev).toBe(base.ev);
      expect(t.raiseEv!).toBeGreaterThan(last);
      last = t.raiseEv!;
      // the folded share leaves his range from the non-value side
      expect(t.raiseContinueBluff).toBeCloseTo(Math.max(0, (0.45 - f) / (1 - f)), 9);
    }
    // he always folds: the raise wins the pot as it stands
    expect(omahaFlopDefenceTreeEv(r.rows, r.turnOf, SPOT, { ...PERSON, foldToRaise: 1 })!.raiseEv).toBeCloseTo(70, 9);
    // nothing behind: no raise to measure
    expect(omahaFlopDefenceTreeEv(r.rows, r.turnOf, { ...SPOT, left: 0 }, PERSON)!.raiseEv).toBeNull();
  });

  it('refuses rows it cannot read', () => {
    expect(omahaFlopDefenceTreeEv(null, null, SPOT, PERSON)).toBeNull();
    const r = rowsOf(4, 2, () => [1, 1, 1, 1]);
    expect(omahaFlopDefenceTreeEv(r.rows, new Int16Array(3), SPOT, PERSON)).toBeNull();
    expect(omahaFlopDefenceTreeEv(r.rows, r.turnOf, { ...SPOT, paid: NaN }, PERSON)).toBeNull();
    const bad = rowsOf(4, 2, () => [1, -1, 1, 1]);
    expect(omahaFlopDefenceTreeEv(bad.rows, bad.turnOf, SPOT, PERSON)).toBeNull();
  });
});

const headsUpFirstBet = (r: RecordedFlopFacingBet): boolean => {
  const st = at(r);
  const a = omahaFlopFacingBetEvAnswer(st.hero, st.gs as never, BASE);
  return (
    !!a && !a.spot.final && !a.spot.isRaise && a.spot.callers === 0 && a.spot.allIns === 0 && a.spot.behind === 0
  );
};

const noTree = (v: object): string => {
  const { tree: _t, ...rest } = v as { tree?: unknown };
  return JSON.stringify(rest);
};
const answers = (r: RecordedFlopFacingBet) => {
  const st = at(r);
  return {
    off: omahaFlopFacingBetEvAnswer(st.hero, st.gs as never, BASE),
    on: omahaFlopFacingBetEvAnswer(st.hero, st.gs as never, { ...BASE, flopDefenceTree: true }),
  };
};
const rec = (n: number, seat: number): RecordedFlopFacingBet =>
  RECORDED_FLOP_FACING_BETS.find((r) => r.n === n && r.seat === seat)!;
const LIVE_SEEDS = [1, 2, 3];
function decide(r: RecordedFlopFacingBet, opts: HorseDecideOpts): string[] {
  const out: string[] = [];
  for (const seed of LIVE_SEEDS) {
    HorseMind.reset();
    seedFastRandom(seed);
    const st = at(r);
    const d = HorseLogic.decide(st.hero, st.gs, LIVE.style, LIVE.mods, {
      observeMind: false,
      ...opts,
    } as never);
    out.push(JSON.stringify(withoutMeasurements(d)));
  }
  return out;
}

describe('recorded spots (the flop verdict with and without the tree)', () => {
  it('outside the heads-up first-bet spot (multiway, a raise) the verdict is unchanged; inside it the tree prices the call', () => {
    let inside = 0;
    for (const r of RECORDED_FLOP_FACING_BETS) {
      const { off, on } = answers(r);
      expect(!!off).toBe(!!on);
      if (!off || !on) continue;
      expect(off.verdict.tree).toBeUndefined(); // the option off adds nothing to the verdict
      if (headsUpFirstBet(r)) {
        inside++;
        expect(on.verdict.tree).not.toBeNull();
        expect(on.verdict.ev).toBeCloseTo(on.verdict.tree!.ev, 9);
      } else {
        expect(on.verdict.tree ?? null).toBeNull();
        expect(noTree(on.verdict)).toBe(noTree(off.verdict));
      }
    }
    expect(inside).toBeGreaterThanOrEqual(10);
  });

  it('recorded heads-up spots: the folds the audit judged wrong become priced calls; the calls it judged right stay or become calls', () => {
    // 59848622 seat 3: a pair with a weak draw at a good price, folded (audit: over-fold); the flop verdict alone kept the fold
    const kept = answers(rec(59848622, 3));
    expect(kept.off!.verdict.call).toBe(false);
    expect(kept.on!.verdict.call).toBe(true);
    // 59868806 / 59870825 seat 6: calls the audit judged right; the flop verdict alone folded them
    for (const n of [59868806, 59870825]) {
      const a = answers(rec(n, 6));
      expect(a.off!.verdict.call).toBe(false);
      expect(a.on!.verdict.call).toBe(true);
    }
    // every audited-wrong heads-up fold the flop verdict already calls stays a call
    for (const r of RECORDED_FLOP_FACING_BETS.filter((x) => x.group === 'wrongFold' && headsUpFirstBet(x)))
      expect(answers(r).on!.verdict.call).toBe(true);
    // reported, not judged: 59833693 (paired flop, two-pair class) stays a priced fold at EV -1.6 under the tree,
    // and 59831538 (a call that lost 65 bb) stays a fold within the margin
    expect(answers(rec(59833693, 6)).on!.verdict.call).toBe(false);
    expect(answers(rec(59831538, 4)).on!.verdict.call).toBe(false);
  });

  it('decide: the option off (unset or false) is byte-identical; outside its spot it changes nothing, alone or with the flop verdict', () => {
    const r = rec(59848622, 3);
    const flop = decide(r, { omahaFlopFacingBetEv: true });
    expect(decide(r, { omahaFlopFacingBetEv: true, omahaFlopDefenceIsPriced: false })).toEqual(flop);
    expect(decide(r, { omahaFlopDefenceIsPriced: false })).toEqual(decide(r, {}));
    // every recorded spot outside the heads-up first bet (multiway, a raise faced): alone it is the decision with nothing on
    let outside = 0;
    for (const x of RECORDED_FLOP_FACING_BETS) {
      if (headsUpFirstBet(x)) continue;
      outside++;
      expect(decide(x, { omahaFlopDefenceIsPriced: true })).toEqual(decide(x, {}));
    }
    expect(outside).toBeGreaterThanOrEqual(5);
    const multi = rec(59727433, 6);
    expect(decide(multi, { omahaFlopFacingBetEv: true, omahaFlopDefenceIsPriced: true })).toEqual(
      decide(multi, { omahaFlopFacingBetEv: true })
    );
  });

  it('decide: alone (flop verdict off) every recorded heads-up first bet gets the same answer as with both on, and a recorded fold becomes a call of the exact chips to call', () => {
    let witnessed = 0;
    for (const r of RECORDED_FLOP_FACING_BETS.filter(headsUpFirstBet)) {
      const alone = decide(r, { omahaFlopDefenceIsPriced: true });
      expect(alone).toEqual(decide(r, { omahaFlopFacingBetEv: true, omahaFlopDefenceIsPriced: true }));
      const base = decide(r, {}).map((b) => JSON.parse(b).action);
      if (!base.every((a) => a === 'fold')) continue;
      const st = at(r);
      const toCall = (st.gs as { currentBet: number }).currentBet - (st.hero.bet ?? 0);
      const acts = alone.map((b) => JSON.parse(b));
      if (!acts.every((d) => d.action === 'call')) continue;
      for (const d of acts) expect(d.amount).toBeCloseTo(toCall, 6);
      witnessed++;
    }
    expect(witnessed).toBeGreaterThanOrEqual(1);
  });

  it('the rule alone answers nothing outside the tree spot and fires only its own receipts', () => {
    const multi = at(rec(59727433, 6));
    const given = { action: 'fold' } as never;
    const only = { ...BASE, flopDefenceTree: true, flopDefenceOnly: true };
    expect(omahaFlopFacingBetEvRule(given, multi.hero, multi.gs as never, only)).toBe(given);
    const hu = at(rec(59848622, 3));
    const out = omahaFlopFacingBetEvRule(given, hu.hero, hu.gs as never, only);
    expect(out.action).toBe('call');
  });

  it('Lightning and fixed limit are outside the tree', () => {
    const st = at(rec(59848622, 3));
    for (const edit of [{ publicMemoryDomain: { speed: 'lightning' } }, { bettingStructure: 'fixed_limit' }]) {
      const gs = { ...(st.gs as object), ...edit } as never;
      const a = omahaFlopFacingBetEvAnswer(st.hero, gs, { ...BASE, flopDefenceTree: true });
      expect(a?.verdict.tree ?? null).toBeNull();
    }
  });

  it('decide: with both on, the recorded over-fold is a call of the exact chips to call', () => {
    const r = rec(59848622, 3);
    for (const b of decide(r, { omahaFlopFacingBetEv: true, omahaFlopDefenceIsPriced: true })) {
      const d = JSON.parse(b);
      expect(d.action).toBe('call');
    }
    for (const b of decide(r, { omahaFlopFacingBetEv: true })) expect(JSON.parse(b).action).toBe('fold');
  });
});
