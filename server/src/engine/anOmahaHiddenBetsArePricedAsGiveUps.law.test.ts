/**
 * LAW: A HIDDEN BET IS PRICED AS A GIVE-UP (lead-9 lane HUOOP 2026-11-27, omahaHiddenBetsArePricedAsGiveUps,
 * default OFF, read `=== true`).
 *
 * omahaPeoplePriorCountsHiddenBets counts the bets people never showed although they did not win them uncontested
 * (he checked and folded later in the hand, or mucked at the showdown) into the turn bettor's non-value share, but
 * the turn verdict then prices them like any non-value holding at the turn realization. A hidden bet is by
 * construction his weakest class and a bet that did not fire the river. With this option the hidden part of the
 * share is priced as his weakest OMAHA_EV_BLUFF_POOL of holdings; the rest as before. The give-up class takes the
 * verdict's own realization, never a second one: that factor already averages over every river line of the bettor,
 * his check-downs and give-ups included (lead-10 lane EFIX 2026-11-28: realization 1 on top of it over-called the
 * bettor who also bet the flop, fold 6-7% against a 34% break-even).
 *
 * The laws: off (or without the hidden-bets prior) nothing changes; it never acts on a raise, multiway or the river;
 * the give-up share is people's hidden fraction, never more than the non-value share, shrinks with a value-heavy
 * record; it only ever turns a fold into a call (never a raise); a re-raised pot is priced only when its flop
 * checked through; no identity input.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { enableBrainTelemetry, withDecisionFireScope } from './BrainTelemetry.js';
import { omahaPeoplePriorShare } from './HorseOmahaFacingBetPeoplePrior.js';
import {
  OMAHA_EV_UNKNOWN_READ,
  OMAHA_EV_VALUE_SHARE,
  OMAHA_EV_LINE_AGGRESSOR,
  omahaBetSizeBucket,
  omahaEvHandCounts,
  omahaFacingBetEvVerdict,
} from './HorseOmahaFacingBetEv.js';
import type { Card } from '../types.js';
import {
  omahaPeoplePriorHiddenFraction,
  omahaPeoplePriorHiddenReraisedCheckedKeyOf,
} from './HorseOmahaPeoplePriorHidden.js';
import {
  decideTurnLine,
  loadTurnLineStates,
} from './HorseOmahaTurnLinePeoplePrior.test-support.js';

const BASE = { omahaFacingBetPriorIsPeopleMeasured: true, omahaPeoplePriorCountsHiddenBets: true };
const ON = { ...BASE, omahaHiddenBetsArePricedAsGiveUps: true };
const POT_BET = { street: 'turn' as const, potFrac: 1, paid: 10, winnable: 20, rake: 0 };
const KEY = { game: 'plo5' as const, split: 'x' as const };
const MIN_PRICED = 20;

describe('LAW: a hidden bet is priced as a give-up', () => {
  enableBrainTelemetry();
  const states = loadTurnLineStates();
  const runs = states.map((s) => ({
    s,
    off: decideTurnLine(s.player, s.gs, false, false, BASE),
    on: withDecisionFireScope(() => decideTurnLine(s.player, s.gs, false, true, ON)),
  }));
  const priced = runs.filter((r) => r.on.fired.has('omaha_hidden_give_up_priced'));

  it('prices real heads-up turn bets, and only heads-up turn first bets', () => {
    expect(priced.length).toBeGreaterThanOrEqual(MIN_PRICED);
    for (const r of priced) expect(r.s.tag).toMatch(/^turn\.hu\./);
  });

  it('only ever turns a fold into a call: never a raise, never a call into a fold', () => {
    let changed = 0;
    for (const r of runs) {
      const a = r.off.action;
      const b = r.on.value.action;
      if (a === b) continue;
      changed++;
      expect(r.on.fired.has('omaha_hidden_give_up_priced')).toBe(true);
      expect(a).toBe('fold');
      expect(['call', 'all_in']).toContain(b);
    }
    expect(changed).toBeGreaterThan(0);
  });

  it('without the hidden-bets prior the option decides nothing', () => {
    const lone = { omahaFacingBetPriorIsPeopleMeasured: true };
    for (const r of runs.filter((_, i) => i % 7 === 0)) {
      const a = decideTurnLine(r.s.player, r.s.gs, false, false, lone);
      const b = decideTurnLine(r.s.player, r.s.gs, false, false, {
        ...lone,
        omahaHiddenBetsArePricedAsGiveUps: true,
      });
      expect([b.action, b.amount]).toEqual([a.action, a.amount]);
    }
  });

  it("the give-up share is people's hidden fraction behind the one-street balanced share, inside the share", () => {
    const base = { ...POT_BET, isRaise: false, multiway: false, twoStreet: true, record: null };
    const without = omahaPeoplePriorShare({ ...base, hidden: KEY });
    const withG = omahaPeoplePriorShare({ ...base, hidden: KEY, giveUps: true });
    expect(without?.giveUp).toBeUndefined();
    expect(withG?.share).toBe(without?.share);
    const hf = omahaPeoplePriorHiddenFraction('turn', false, 'big', KEY);
    expect(hf && hf.n > 0 && hf.hidden > 0 && hf.hidden < 1).toBe(true);
    expect(withG!.giveUp!).toBeGreaterThan(0);
    expect(withG!.giveUp!).toBeLessThanOrEqual(withG!.share);
    // one-street balanced share of a pot-size bet is 1/3: the blend lies between people's fraction and it
    const lo = Math.min(hf!.hidden, 1 / 3);
    const hi = Math.max(hf!.hidden, 1 / 3);
    const g0 = (withG!.giveUp! / withG!.share) * withG!.prior;
    expect(g0).toBeGreaterThanOrEqual(lo - 1e-9);
    expect(g0).toBeLessThanOrEqual(hi + 1e-9);
  });

  it('his own value-heavy record shrinks the give-up share with the rest of the share', () => {
    const base = { ...POT_BET, isRaise: false, multiway: false, twoStreet: true, hidden: KEY };
    const none = omahaPeoplePriorShare({ ...base, giveUps: true, record: null })!;
    const value = omahaPeoplePriorShare({
      ...base,
      giveUps: true,
      record: { shown: 40, value: 39 },
    })!;
    expect(value.giveUp!).toBeLessThan(none.giveUp! / 2);
  });

  it('a raise, the river and a missing hidden key get no give-up share', () => {
    const base = { ...POT_BET, multiway: false, twoStreet: true, record: null, giveUps: true };
    expect(omahaPeoplePriorShare({ ...base, isRaise: true, hidden: KEY })?.giveUp).toBeUndefined();
    expect(
      omahaPeoplePriorShare({ ...base, isRaise: false, hidden: null })?.giveUp
    ).toBeUndefined();
    expect(
      omahaPeoplePriorShare({
        ...base,
        street: 'river',
        isRaise: false,
        twoStreet: false,
        hidden: KEY,
      })?.giveUp
    ).toBeUndefined();
  });

  it('a re-raised pot is keyed only when its flop checked through', () => {
    const pre = [
      { stage: 'preflop', seat: 1, action: 'raise', amount: 6 },
      { stage: 'preflop', seat: 2, action: 'raise', amount: 20 },
      { stage: 'preflop', seat: 1, action: 'call', amount: 14 },
    ];
    const checked = [
      ...pre,
      { stage: 'flop', seat: 1, action: 'check', amount: 0 },
      { stage: 'flop', seat: 2, action: 'check', amount: 0 },
    ];
    const bet = [
      ...pre,
      { stage: 'flop', seat: 1, action: 'check', amount: 0 },
      { stage: 'flop', seat: 2, action: 'bet', amount: 20 },
      { stage: 'flop', seat: 1, action: 'call', amount: 20 },
    ];
    expect(omahaPeoplePriorHiddenReraisedCheckedKeyOf('plo5', checked, 2)).toEqual(KEY);
    expect(omahaPeoplePriorHiddenReraisedCheckedKeyOf('plo4', checked, 2)).toEqual({
      game: 'plo4',
      split: 'x',
    });
    expect(omahaPeoplePriorHiddenReraisedCheckedKeyOf('plo5', bet, 2)).toBeNull();
    expect(omahaPeoplePriorHiddenReraisedCheckedKeyOf('plo5', bet, 1)).toBeNull();
    expect(omahaPeoplePriorHiddenReraisedCheckedKeyOf('plo6', checked, 2)).toBeNull();
    // a single-raised pot is not this function's: the hidden-bets prior keys it itself
    expect(omahaPeoplePriorHiddenReraisedCheckedKeyOf('plo5', checked.slice(0, 1), 1)).toBeNull();
  });

  it('the give-up class takes the verdict realization, never a second one (bettor who also bet the flop)', () => {
    // A real node the full-realization price turned from a fold into a call: PLO4, heads-up single-raised pot, he bet
    // the flop and bets 0.55 pot on a paired turn; the Horse holds jacks up with no full-house out (realization 0.42).
    const SU: Record<string, string> = { h: 'hearts', s: 'spades', d: 'diamonds', c: 'clubs' };
    const cards = (x: string): Card[] =>
      (x.match(/../g) ?? []).map((c) => ({ rank: c[0], suit: SU[c[1]] }) as Card);
    const hole = cards('TcAhJh9d');
    const board = cards('6sKcJdKh');
    const paid = 7.6;
    const winnable = 21.4;
    const potFrac = paid / (winnable - paid);
    const bucket = omahaBetSizeBucket(potFrac);
    const key = { game: 'plo4' as const, split: 'b' as const };
    const s = omahaPeoplePriorShare({
      street: 'turn',
      potFrac,
      isRaise: false,
      multiway: false,
      paid,
      winnable,
      rake: 0.05,
      twoStreet: true,
      record: null,
      hidden: key,
      giveUps: true,
    })!;
    expect(s.giveUp!).toBeGreaterThan(0);
    const valueShare = OMAHA_EV_VALUE_SHARE.turn[bucket as 'mid'] * OMAHA_EV_LINE_AGGRESSOR;
    const spot = {
      street: 'turn' as const,
      bettorSeat: 1,
      potFrac,
      bucket,
      isRaise: false,
      aggressorStreets: 1,
      callerStreets: 0,
      callers: 0,
      allIns: 0,
      behind: 0,
      callerSeats: [],
      paid,
      winnable,
      allIn: false,
      final: false,
      bettorCanBarrelRiver: true,
      valueShare,
      priorBluff: 0.22,
    };
    const read = { ...OMAHA_EV_UNKNOWN_READ, pricedShare: s.share };
    const ctx = { rake: 0.05, realization: 0.85 };
    const off = omahaFacingBetEvVerdict(spot, hole, board, [], read, ctx)!;
    const on = omahaFacingBetEvVerdict(
      spot,
      hole,
      board,
      [],
      { ...read, pricedGiveUp: s.giveUp },
      ctx
    )!;
    const h = omahaEvHandCounts(hole, board, [], valueShare)!;
    const bottom = h.bottomOf!();
    expect(on.realization).toBeLessThan(0.5);
    expect(on.giveUp).toBeCloseTo(s.giveUp!, 12);
    // exactly the equity moved from the non-value region to his weakest pool, at the same realization
    expect(on.pWin - off.pWin).toBeCloseTo(
      s.giveUp! * (bottom.win - h.other.win) * on.realization,
      12
    );
    expect(on.pTie - off.pTie).toBeCloseTo(
      s.giveUp! * (bottom.tie - h.other.tie) * on.realization,
      12
    );
    // a hand that does as well against his weakest pool as against his other holdings gains (almost) nothing
    expect(Math.abs(on.pWin - off.pWin)).toBeLessThan(0.01);
    expect(off.call).toBe(false);
    expect(on.call).toBe(false);
  });

  it('source law: the give-up code reads no identity', () => {
    for (const f of ['HorseOmahaPeoplePriorHidden.ts', 'HorseOmahaFacingBetPeoplePrior.ts']) {
      const src = readFileSync(join(__dirname, f), 'utf8');
      expect(src).not.toMatch(/is_human|isHuman|is_bot|isBot|user_id|username|omahaOpponentKindOf/);
    }
  });
});
