/**
 * LAW: THE HEADS-UP SINGLE-RAISED FLOP CALL-OR-FOLD READS THE PEOPLE-PRICED EQUITY (PLO-OWNER lead-10 2026-11-28,
 * omahaFlopFacingBetEquityIsPeoplePriced, default OFF, read `=== true`).
 *
 * Heads-up on the PLO4/PLO5 cash flop, facing one bet, where the priced flop pressure cap (omahaFlopPressureCapIsPriced)
 * prices the call, the check read min(sampler equity, people-priced equity): the people-measured flop price could only
 * LOWER the equity, so the sampler's preflop range band (from opponent memory) overrode people's measured flop bets of
 * this size downward only. Real-node replay with memory on: PLO4 single-raised c-bet 0.7-1.1 pot fold 65% vs
 * break-even 48%, PLO5 57% vs 47%. With this option, in a SINGLE-RAISED pot and a bet MADE heads-up, the check reads
 * the people-priced equity itself (his record -> people's measured cell -> equilibrium anchor).
 *
 * The laws: off nothing changes; without the priced flop cap it decides nothing; it lifts only single-raised pots with
 * the bet made heads-up (never limped, re-raised, multiway, a raise, the turn or river, PLO6 or a tournament); a
 * decision it does not lift is identical; every change is a fold that becomes a call; the check equity is the people
 * price in scope and min(sampler, price) out of scope; no identity input.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  flopCapDecide,
  flopCapKey,
  loadFlopCapNodes,
} from './HorseOmahaFlopPressureCap.test-support.js';
import {
  omahaFlopBetWasMadeHeadsUp,
  omahaFlopFacingBetCheckEquity,
  omahaFlopFacingBetEquityIsPeoplePricedInScope,
} from './HorseOmahaFlopFacingBetPeopleEquity.js';
import { omahaPeoplePriorFlopPotOf } from './HorseOmahaPeoplePriorHidden.js';

const OPTION = 'omahaFlopFacingBetEquityIsPeoplePriced';
const BASE = { omahaFlopPressureCapIsPriced: true, omahaPeoplePriorCountsHiddenBets: true };
const LIFT = 'omaha_flop_people_priced_equity';
const LIFT_CALL = 'omaha_flop_people_priced_equity_call';
const MIN_LIFTED = 10;

describe('LAW: the heads-up single-raised flop call-or-fold reads the people-priced equity', () => {
  const nodes = loadFlopCapNodes();
  const runs = nodes.map((n) => ({
    n,
    pot: omahaPeoplePriorFlopPotOf(n.gs.actionHistory),
    off: flopCapDecide(n.player, n.gs, { ...n.opts, ...BASE }),
    on: flopCapDecide(n.player, n.gs, { ...n.opts, ...BASE, [OPTION]: true }),
  }));
  const lifted = runs.filter((r) => r.on.fired.has(LIFT));

  it('lifts real audited decisions, only in single-raised pots with the bet made heads-up', () => {
    expect(lifted.length).toBeGreaterThanOrEqual(MIN_LIFTED);
    for (const r of lifted) {
      expect(r.pot).toBe('single');
      expect(omahaFlopBetWasMadeHeadsUp(r.n.gs.actionHistory)).toBe(true);
      expect(r.off.fired.has('omaha_flop_pressure_cap_priced')).toBe(true);
    }
    // limped and re-raised pots read the min as before: nothing lifts, nothing changes
    const other = runs.filter((r) => r.pot !== 'single');
    expect(other.length).toBeGreaterThan(0);
    for (const r of other) {
      expect(r.on.fired.has(LIFT)).toBe(false);
      expect(flopCapKey(r.on.decision)).toBe(flopCapKey(r.off.decision));
    }
  });

  it('a decision it does not lift is identical; every change is a fold that becomes a call, never a raise', () => {
    let changed = 0;
    for (const r of runs) {
      if (!r.on.fired.has(LIFT)) {
        expect(flopCapKey(r.on.decision)).toBe(flopCapKey(r.off.decision));
        continue;
      }
      if (flopCapKey(r.on.decision) === flopCapKey(r.off.decision)) continue;
      changed++;
      expect(r.off.decision.action).toBe('fold');
      expect(r.on.decision.action).toBe('call');
      expect(r.on.fired.has(LIFT_CALL)).toBe(true);
    }
    expect(changed).toBeGreaterThan(0);
  });

  it('off, explicitly false, or without the priced flop cap, the option decides nothing', () => {
    for (const r of runs.filter((_, i) => i % 3 === 0)) {
      const f = flopCapDecide(r.n.player, r.n.gs, { ...r.n.opts, ...BASE, [OPTION]: false });
      expect(f.fired.has(LIFT)).toBe(false);
      expect(flopCapKey(f.decision)).toBe(flopCapKey(r.off.decision));
      const lone = { ...r.n.opts, ...BASE, omahaFlopPressureCapIsPriced: false };
      const a = flopCapDecide(r.n.player, r.n.gs, lone);
      const b = flopCapDecide(r.n.player, r.n.gs, { ...lone, [OPTION]: true });
      expect(b.fired.has(LIFT)).toBe(false);
      expect(flopCapKey(b.decision)).toBe(flopCapKey(a.decision));
    }
  });

  it('the scope: PLO4/PLO5 cash, heads-up, single-raised, the bet made heads-up; nothing else', () => {
    const bet = { stage: 'flop', seat: 1, action: 'bet', amount: 10 };
    const made = [{ stage: 'preflop', seat: 1, action: 'raise', amount: 3 }, bet];
    const ok = {
      enabled: true,
      tournament: false,
      holeCount: 4,
      potType: 'single' as const,
      oppCount: 1,
      history: made,
    };
    expect(omahaFlopFacingBetEquityIsPeoplePricedInScope(ok)).toBe(true);
    expect(omahaFlopFacingBetEquityIsPeoplePricedInScope({ ...ok, holeCount: 5 })).toBe(true);
    expect(omahaFlopFacingBetEquityIsPeoplePricedInScope({ ...ok, enabled: false })).toBe(false);
    expect(omahaFlopFacingBetEquityIsPeoplePricedInScope({ ...ok, tournament: true })).toBe(false);
    for (const holeCount of [2, 3, 6])
      expect(omahaFlopFacingBetEquityIsPeoplePricedInScope({ ...ok, holeCount })).toBe(false);
    for (const potType of ['limped', 'reraised'] as const)
      expect(omahaFlopFacingBetEquityIsPeoplePricedInScope({ ...ok, potType })).toBe(false);
    expect(omahaFlopFacingBetEquityIsPeoplePricedInScope({ ...ok, oppCount: 2 })).toBe(false);
    // a bet made into three players, the third folding after it: priced in people's multiway cell, not this one
    const mw = [...made, { stage: 'flop', seat: 3, action: 'fold', amount: 0 }];
    expect(omahaFlopBetWasMadeHeadsUp(mw)).toBe(false);
    expect(omahaFlopFacingBetEquityIsPeoplePricedInScope({ ...ok, history: mw })).toBe(false);
    // a fold before the bet does not matter; no bet on the flop is not in scope
    expect(
      omahaFlopBetWasMadeHeadsUp([{ stage: 'flop', seat: 3, action: 'fold', amount: 0 }, bet])
    ).toBe(true);
    expect(
      omahaFlopBetWasMadeHeadsUp([{ stage: 'flop', seat: 1, action: 'check', amount: 0 }])
    ).toBe(false);
    expect(omahaFlopBetWasMadeHeadsUp(null)).toBe(false);
  });

  it('the check equity: the people price in scope, the lower of the two otherwise', () => {
    for (const [s, p] of [
      [0.3, 0.5],
      [0.5, 0.3],
      [0.42, 0.42],
    ]) {
      expect(omahaFlopFacingBetCheckEquity(s!, p!, true)).toBe(p);
      expect(omahaFlopFacingBetCheckEquity(s!, p!, false)).toBe(Math.min(s!, p!));
    }
  });

  it('source law: the scope and the call site read no identity', () => {
    const mod = readFileSync(join(__dirname, 'HorseOmahaFlopFacingBetPeopleEquity.ts'), 'utf8');
    expect(mod).not.toMatch(
      /is_human|isHuman|is_bot|isBot|is_horse|isHorse|user_id|username|omahaOpponentKindOf/
    );
    const logic = readFileSync(join(__dirname, 'HorseLogic.ts'), 'utf8');
    const i = logic.indexOf('opts.omahaFlopFacingBetEquityIsPeoplePriced === true &&');
    expect(i).toBeGreaterThan(0);
    const site = logic.slice(i, logic.indexOf('pricedCap38 = omahaFlopFacingBetCheckEquity(', i));
    expect(site).not.toMatch(/is_human|isHuman|is_bot|isBot|is_horse|isHorse|user_id|username/);
  });
});
