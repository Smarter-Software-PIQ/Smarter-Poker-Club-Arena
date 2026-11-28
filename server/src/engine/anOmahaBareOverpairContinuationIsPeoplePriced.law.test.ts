/**
 * LAW: THE BARE-OVERPAIR FLOP CONTINUATION IS PRICED ON PEOPLE'S MEASURED FLOP RANGE (lead-9 lane HU2 2026-11-27,
 * omahaBareOverpairContinuationIsPeoplePriced, default OFF, read `=== true`).
 *
 * Heads-up on the PLO4/PLO5 cash flop, a Horse that checked a bare big pair out of position and faces one bet is
 * answered by the continuation of omahaBareOverpairOopFlopCheck: a call when the expected value of the call clears
 * its margin, else a fold. That expected value was priced on the sampler's aggressor tiers, while the flop pressure
 * cap (omahaFlopPressureCapIsPriced) prices the very same bet on PEOPLE's measured flop bets: two prices for one bet,
 * and the older one decided (real-node replay: of 44 folds in the PLO4 single-raised out-of-position cell facing a
 * 0.7-1.1 pot bet, 11 were the continuation and in 10 the people-measured price had called). With this option the
 * continuation's equity is the Horse's equity against the people-measured flop range.
 *
 * The laws: off nothing changes; it prices only the continuation's own spot, never a re-raised pot; a decision it
 * does not price is identical; it never produces a raise; the verdict takes the people equity as given (no tier, no
 * lean), a higher equity never turns a call into a fold, and an unusable number is ignored; no identity input.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { flopCapDecide, loadFlopCapNodes } from './HorseOmahaFlopPressureCap.test-support.js';
import {
  omahaBareOverpairFlopFacingBetSpot,
  omahaBareOverpairFlopFacingBetVerdict,
} from './HorseOmahaOopChecks.js';
import { omahaPeoplePriorFlopPotOf } from './HorseOmahaPeoplePriorHidden.js';

const OPTION = 'omahaBareOverpairContinuationIsPeoplePriced';
const BASE = {
  omahaBareOverpairOopFlopCheck: true,
  omahaFlopPressureCapIsPriced: true,
  omahaPeoplePriorCountsHiddenBets: true,
};
const PRICED = 'omaha_bare_overpair_people_priced';
const MIN_PRICED = 20;

describe("LAW: the bare-overpair flop continuation is priced on people's measured flop range", () => {
  const nodes = loadFlopCapNodes();
  const runs = nodes.map((n) => ({
    n,
    off: flopCapDecide(n.player, n.gs, { ...n.opts, ...BASE }),
    on: flopCapDecide(n.player, n.gs, { ...n.opts, ...BASE, [OPTION]: true }),
  }));
  const priced = runs.filter((r) => r.on.fired.has(PRICED));

  it("prices real decisions, only in the continuation's own spot and never in a re-raised pot", () => {
    expect(priced.length).toBeGreaterThanOrEqual(MIN_PRICED);
    for (const r of priced) {
      expect(omahaBareOverpairFlopFacingBetSpot(r.n.player, r.n.gs)).not.toBeNull();
      expect(omahaPeoplePriorFlopPotOf(r.n.gs.actionHistory)).not.toBe('reraised');
    }
    // every re-raised pot in the continuation's spot keeps today's price
    const reraised = runs.filter(
      (r) =>
        omahaBareOverpairFlopFacingBetSpot(r.n.player, r.n.gs) !== null &&
        omahaPeoplePriorFlopPotOf(r.n.gs.actionHistory) === 'reraised'
    );
    expect(reraised.length).toBeGreaterThan(0);
    for (const r of reraised) {
      expect(r.on.fired.has(PRICED)).toBe(false);
      expect([r.on.decision.action, r.on.decision.amount]).toEqual([
        r.off.decision.action,
        r.off.decision.amount,
      ]);
    }
  });

  it('a decision it does not price is identical, and it never produces a raise', () => {
    let changed = 0;
    for (const r of runs) {
      const a = r.off.decision;
      const b = r.on.decision;
      if (!r.on.fired.has(PRICED)) {
        expect([b.action, b.amount]).toEqual([a.action, a.amount]);
        continue;
      }
      expect(['fold', 'call']).toContain(b.action);
      if (a.action !== b.action) changed++;
    }
    expect(changed).toBeGreaterThan(0);
  });

  it('off, or without the bare-overpair check itself, the option decides nothing', () => {
    for (const r of runs.filter((_, i) => i % 5 === 0)) {
      const lone = { ...r.n.opts, ...BASE, omahaBareOverpairOopFlopCheck: false };
      const a = flopCapDecide(r.n.player, r.n.gs, lone);
      const b = flopCapDecide(r.n.player, r.n.gs, { ...lone, [OPTION]: true });
      expect(b.fired.has(PRICED)).toBe(false);
      expect([b.decision.action, b.decision.amount]).toEqual([
        a.decision.action,
        a.decision.amount,
      ]);
      const c = flopCapDecide(r.n.player, r.n.gs, { ...r.n.opts, ...BASE, [OPTION]: false });
      expect(c.fired.has(PRICED)).toBe(false);
      expect([c.decision.action, c.decision.amount]).toEqual([
        r.off.decision.action,
        r.off.decision.amount,
      ]);
    }
  });

  it('the verdict takes the people equity as given: no tier, no lean; more equity never folds a call', () => {
    const r = priced[0];
    const spot = omahaBareOverpairFlopFacingBetSpot(r.n.player, r.n.gs)!;
    const ctx = { rake: 0.05, realization: 0.75 };
    const tier = omahaBareOverpairFlopFacingBetVerdict(spot, r.n.player, r.n.gs, null, ctx)!;
    expect(tier.peoplePriced).toBeUndefined();
    let last = false;
    for (const e of [0.2, 0.35, 0.5, 0.65, 0.8]) {
      const v = omahaBareOverpairFlopFacingBetVerdict(spot, r.n.player, r.n.gs, null, {
        ...ctx,
        peopleEquity: e,
      })!;
      expect(v.peoplePriced).toBe(true);
      expect(v.equity).toBe(e);
      expect(v.lean).toBe(0);
      expect(v.realization).toBe(tier.realization);
      expect(v.margin).toBe(tier.margin);
      if (last) expect(v.call).toBe(true);
      last = v.call;
    }
    expect(last).toBe(true);
    // a read that would lean the tier price does not move the people price
    const leaning = {
      measured: true,
      valueLeader: true,
      postflopAggressor: false,
      betCheckedToRatio: 0.2,
    };
    const a = omahaBareOverpairFlopFacingBetVerdict(spot, r.n.player, r.n.gs, leaning as never, {
      ...ctx,
      peopleEquity: 0.5,
    })!;
    expect(a.equity).toBe(0.5);
    // an unusable number is ignored: today's tier price stands
    for (const bad of [Number.NaN, -0.1, 1.2, null]) {
      const v = omahaBareOverpairFlopFacingBetVerdict(spot, r.n.player, r.n.gs, null, {
        ...ctx,
        peopleEquity: bad,
      })!;
      expect(v.peoplePriced).toBeUndefined();
      expect(v.equity).toBe(tier.equity);
      expect(v.call).toBe(tier.call);
    }
  });

  it('source law: the price reads no identity', () => {
    const logic = readFileSync(join(__dirname, 'HorseLogic.ts'), 'utf8');
    const i = logic.indexOf('function omahaBareOverpairPeopleEquity(');
    expect(i).toBeGreaterThan(0);
    const body = logic.slice(i, logic.indexOf('\n}\n', i));
    expect(body).not.toMatch(
      /is_human|isHuman|is_bot|isBot|is_horse|isHorse|username|omahaOpponentKindOf/
    );
    const priced = readFileSync(join(__dirname, 'HorseOmahaFlopPressureCapPriced.ts'), 'utf8');
    expect(priced).not.toMatch(
      /is_human|isHuman|is_bot|isBot|user_id|username|omahaOpponentKindOf/
    );
  });
});
