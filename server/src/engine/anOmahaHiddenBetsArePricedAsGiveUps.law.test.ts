/**
 * LAW: A HIDDEN BET IS PRICED AS A GIVE-UP (lead-9 lane HUOOP 2026-11-27, omahaHiddenBetsArePricedAsGiveUps,
 * default OFF, read `=== true`).
 *
 * omahaPeoplePriorCountsHiddenBets counts the bets people never showed although they did not win them uncontested
 * (he checked and folded later in the hand, or mucked at the showdown) into the turn bettor's non-value share, but
 * the turn verdict then prices them like any non-value holding at the turn realization. A hidden bet is by
 * construction his weakest class and a bet that did not fire the river. With this option the hidden part of the
 * share is priced as his weakest OMAHA_EV_BLUFF_POOL of holdings at full realization; the rest as before.
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

  it('source law: the give-up code reads no identity', () => {
    for (const f of ['HorseOmahaPeoplePriorHidden.ts', 'HorseOmahaFacingBetPeoplePrior.ts']) {
      const src = readFileSync(join(__dirname, f), 'utf8');
      expect(src).not.toMatch(/is_human|isHuman|is_bot|isBot|user_id|username|omahaOpponentKindOf/);
    }
  });
});
