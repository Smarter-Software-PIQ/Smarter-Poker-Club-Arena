/**
 * LAW: THE CALL ON A GIVE-UP-PRICED TURN BET IS MADE AT INDIFFERENCE (lead-9 lane HU2 2026-11-27,
 * omahaGiveUpPricedTurnCallIsAtIndifference, default OFF, read `=== true`).
 *
 * omahaHiddenBetsArePricedAsGiveUps prices a heads-up turn bet exactly against a people-measured range with the
 * give-up share apart. The verdict then still calls only when the expected value exceeds a safety margin (2% of the
 * final pot): every hand between zero and the margin folds, and those are the hands a bluffer's price makes
 * indifferent. With this option the call is made at EV >= 0 there, and nowhere else.
 *
 * The laws: off (or without the give-up price) nothing changes; it acts only on a heads-up turn first bet the
 * give-up price priced, never in a re-raised pot; it only ever turns a fold into a call, and only a call whose EV
 * lies between zero and the margin; the verdict's EV, margin and price are unchanged; no identity input.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { enableBrainTelemetry, withDecisionFireScope } from './BrainTelemetry.js';
import {
  OMAHA_EV_UNKNOWN_READ,
  omahaFacingBetEvSpot,
  omahaFacingBetEvVerdict,
} from './HorseOmahaFacingBetEv.js';
import { omahaPeoplePriorFlopPotOf } from './HorseOmahaPeoplePriorHidden.js';
import {
  decideTurnLine,
  loadTurnLineStates,
} from './HorseOmahaTurnLinePeoplePrior.test-support.js';

const GU = {
  omahaFacingBetPriorIsPeopleMeasured: true,
  omahaPeoplePriorCountsHiddenBets: true,
  omahaHiddenBetsArePricedAsGiveUps: true,
};
const ON = { ...GU, omahaGiveUpPricedTurnCallIsAtIndifference: true };
const PRICED = 'omaha_give_up_indifference_priced';
const CALLED = 'omaha_give_up_indifference_call';
const MIN_PRICED = 20;

describe('LAW: the call on a give-up-priced turn bet is made at indifference', () => {
  enableBrainTelemetry();
  const states = loadTurnLineStates();
  const runs = states.map((s) => ({
    s,
    off: withDecisionFireScope(() => decideTurnLine(s.player, s.gs, false, true, GU)),
    on: withDecisionFireScope(() => decideTurnLine(s.player, s.gs, false, true, ON)),
  }));
  const priced = runs.filter((r) => r.on.fired.has(PRICED));

  it('acts on real heads-up turn first bets the give-up price priced, never in a re-raised pot', () => {
    expect(priced.length).toBeGreaterThanOrEqual(MIN_PRICED);
    for (const r of priced) {
      expect(r.s.tag).toMatch(/^turn\.hu\./);
      expect(r.on.fired.has('omaha_hidden_give_up_priced')).toBe(true);
      expect(omahaPeoplePriorFlopPotOf(r.s.gs.actionHistory)).not.toBe('reraised');
    }
    // a re-raised pot the give-up price prices (flop checked through) keeps the margin
    for (const r of runs)
      if (
        r.on.fired.has('omaha_hidden_give_up_priced') &&
        omahaPeoplePriorFlopPotOf(r.s.gs.actionHistory) === 'reraised'
      )
        expect(r.on.fired.has(PRICED)).toBe(false);
  });

  it('only ever turns a fold into a call, and every such call is one the margin alone folded', () => {
    let changed = 0;
    for (const r of runs) {
      const a = r.off.value.action;
      const b = r.on.value.action;
      if (a === b) continue;
      changed++;
      expect(r.on.fired.has(PRICED)).toBe(true);
      expect(r.on.fired.has(CALLED)).toBe(true);
      expect(a).toBe('fold');
      expect(['call', 'all_in']).toContain(b);
    }
    expect(changed).toBeGreaterThan(0);
    // and the receipt of the margin call never fires on a decision that did not change
    for (const r of runs)
      if (r.on.fired.has(CALLED)) expect(r.off.value.action).not.toBe(r.on.value.action);
  });

  it('without the give-up price the option decides nothing', () => {
    const lone = {
      omahaFacingBetPriorIsPeopleMeasured: true,
      omahaPeoplePriorCountsHiddenBets: true,
    };
    for (const r of runs.filter((_, i) => i % 7 === 0)) {
      const a = decideTurnLine(r.s.player, r.s.gs, false, false, lone);
      const b = withDecisionFireScope(() =>
        decideTurnLine(r.s.player, r.s.gs, false, true, {
          ...lone,
          omahaGiveUpPricedTurnCallIsAtIndifference: true,
        })
      );
      expect(b.fired.has(PRICED)).toBe(false);
      expect([b.value.action, b.value.amount]).toEqual([a.action, a.amount]);
    }
  });

  it('the verdict: same EV, margin and price; the call moves only between zero and the margin, only with the give-up share', () => {
    let moved = 0;
    let counted = 0;
    for (const r of priced.slice(0, 24)) {
      const spot = omahaFacingBetEvSpot(r.s.player, r.s.gs);
      if (!spot) continue;
      const hole = r.s.player.cards;
      const board = r.s.gs.communityCards ?? [];
      for (const share of [0.3, 0.45, 0.6, 0.75, 0.9]) {
        const read = { ...OMAHA_EV_UNKNOWN_READ, pricedShare: share, pricedGiveUp: share / 2 };
        const ctx = { realization: 0.85, rake: 0.05 };
        const a = omahaFacingBetEvVerdict(spot, hole, board, [], read, ctx);
        const b = omahaFacingBetEvVerdict(
          spot,
          hole,
          board,
          [],
          { ...read, pricedIndifference: true },
          ctx
        );
        if (!a || !b) continue;
        counted++;
        expect(a.giveUp).toBeGreaterThan(0);
        expect(a.indifference).toBeUndefined();
        expect(b.indifference).toBe(true);
        expect(b.ev).toBe(a.ev);
        expect(b.margin).toBe(a.margin);
        expect(b.pWin).toBe(a.pWin);
        expect(a.call).toBe(a.ev > a.margin);
        expect(b.call).toBe(b.ev >= 0);
        if (a.call !== b.call) {
          moved++;
          expect(b.call).toBe(true);
          expect(a.ev).toBeGreaterThanOrEqual(0);
          expect(a.ev).toBeLessThanOrEqual(a.margin);
        }
        // without a priced give-up share the flag does nothing
        const n = omahaFacingBetEvVerdict(
          spot,
          hole,
          board,
          [],
          { ...OMAHA_EV_UNKNOWN_READ, pricedShare: share, pricedIndifference: true },
          ctx
        )!;
        expect(n.indifference).toBeUndefined();
        expect(n.call).toBe(n.ev > n.margin);
      }
    }
    expect(counted).toBeGreaterThanOrEqual(50);
    expect(moved).toBeGreaterThanOrEqual(0);
  });

  it('source law: the indifference call reads no identity', () => {
    const src = readFileSync(join(__dirname, 'HorseOmahaFacingBetEv.ts'), 'utf8');
    const i = src.indexOf('const atIndifference =');
    expect(i).toBeGreaterThan(0);
    expect(src.slice(i, i + 400)).not.toMatch(
      /is_human|isHuman|is_bot|isBot|is_horse|user_id|username/
    );
  });
});
