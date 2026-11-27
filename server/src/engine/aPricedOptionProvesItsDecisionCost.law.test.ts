/**
 * LAW: A PRICED OR DEFAULT-OFF OPTION PROVES ITS DECISION COST (2026-11-26, PLO-OWNER lead-7, lane HARDENING;
 * HorseOptionCostProof.optionCostProofGaps).
 *
 * omahaOopReraiseRangeHoldsVsReraise reached live shadow with a 33-94 ms re-decision nobody had measured, and the
 * shadow stage's breaker switched it off. So every registered option that can change a live decision and is priced
 * by name or off by release default names its relative-cost law (a *.law.test.ts that names it and measures it with
 * src/testing/relativeCost.ts, e.g. anOopReraiseRangePriceIsFast.law.test.ts), or carries a reasoned exemption, or is
 * one of the options registered before this gate (a frozen set that only shrinks). A new priced option with none of
 * them fails the build here.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  OPTION_COST_GRANDFATHERED,
  OPTION_COST_EXEMPT,
  OPTION_COST_LAWS,
  optionCostKey,
  optionCostProofGaps,
} from './HorseOptionCostProof.js';
import { OPTION_SWITCH_REGISTRY } from './HorseOptionSwitch.js';

const SRC = new URL('../', import.meta.url);
const readLaw = (path: string): string | null => {
  const url = new URL(path, SRC);
  return existsSync(url) ? readFileSync(url, 'utf8') : null;
};
const FAKE_LAW = `import { measureRelativeCost } from '../testing/relativeCost.js';
// holdemSomethingNewIsPriced on against off
measureRelativeCost(() => 0, () => 0);`;

describe('LAW: a priced or default-off option proves its decision cost', () => {
  it('holds for every option the registry holds today', () => {
    expect(optionCostProofGaps(OPTION_SWITCH_REGISTRY, readLaw)).toEqual([]);
  });

  it('a new priced option with no cost law and no exemption fails the build', () => {
    const registry = [
      ...OPTION_SWITCH_REGISTRY,
      { name: 'holdemSomethingNewIsPriced', releaseDefault: 'off' },
    ];
    expect(optionCostProofGaps(registry, readLaw)).toEqual([
      'holdemSomethingNewIsPriced: a priced or default-off option names its relative-cost law (OPTION_COST_LAWS) or a reasoned exemption (OPTION_COST_EXEMPT)',
    ]);
    // a cost law that names it and measures relative cost makes it pass
    const laws = { ...OPTION_COST_LAWS, holdemSomethingNewIsPriced: 'engine/x.law.test.ts' };
    const read = (p: string) => (p === 'engine/x.law.test.ts' ? FAKE_LAW : readLaw(p));
    expect(optionCostProofGaps(registry, read, laws)).toEqual([]);
    // or a reasoned exemption
    expect(
      optionCostProofGaps(registry, readLaw, OPTION_COST_LAWS, {
        ...OPTION_COST_EXEMPT,
        holdemSomethingNewIsPriced:
          'a pure threshold on a number the decision already computed: no sampling',
      })
    ).toEqual([]);
  });

  it('a default-off option is held too, priced name or not; an off-only or default-on unpriced one is not', () => {
    const gaps = optionCostProofGaps(
      [
        { name: 'aNewRule', releaseDefault: 'off' },
        { name: 'aNewRuleOn', releaseDefault: 'on' },
        { name: 'aHeldIsPriced', releaseDefault: 'off', offOnly: { status: 'hold' } },
      ],
      readLaw,
      {},
      {},
      new Set()
    );
    expect(gaps).toEqual([
      'aNewRule: a priced or default-off option names its relative-cost law (OPTION_COST_LAWS) or a reasoned exemption (OPTION_COST_EXEMPT)',
    ]);
  });

  it('refuses a missing law file, a law that does not name the option or does not measure relative cost, a bare exemption, both, and stale names', () => {
    const registry = [
      { name: 'aIsPriced', releaseDefault: 'off' },
      { name: 'bIsPriced', releaseDefault: 'off' },
      { name: 'cIsPriced', releaseDefault: 'off' },
      { name: 'dIsPriced', releaseDefault: 'off' },
      { name: 'eIsPriced', releaseDefault: 'off' },
      { name: 'onRule', releaseDefault: 'on' },
    ];
    const texts: Record<string, string> = {
      'b.law.test.ts': 'measureRelativeCost( from "../testing/relativeCost.js"',
      'c.law.test.ts': "// cIsPriced\nexpect(ms).toBeLessThan(25) // '../testing/relativeCost.js'",
      'e.law.test.ts': FAKE_LAW.replace('holdemSomethingNewIsPriced', 'eIsPriced'),
    };
    const gaps = optionCostProofGaps(
      registry,
      (p) => texts[p] ?? null,
      {
        aIsPriced: 'a.law.test.ts',
        bIsPriced: 'b.law.test.ts',
        cIsPriced: 'c.law.test.ts',
        eIsPriced: 'e.law.test.ts',
        gone: 'e.law.test.ts',
      },
      {
        dIsPriced: 'fast',
        eIsPriced: 'a pure threshold, nothing sampled at all',
        onRule: 'a pure threshold, nothing sampled at all',
      },
      new Set([optionCostKey('nothingByThisName')])
    );
    expect(gaps).toEqual([
      'aIsPriced: its cost law file does not exist (a.law.test.ts)',
      'bIsPriced: its cost law does not name the option (b.law.test.ts)',
      'cIsPriced: its cost law does not measure with src/testing/relativeCost.ts (measureRelativeCost) (c.law.test.ts)',
      'dIsPriced: the exemption reason is not a reason (under 24 characters)',
      'eIsPriced: both a cost law and an exemption',
      'gone: has a cost law but is not registered',
      'onRule: has an exemption but is neither priced nor default-off (or is off-only)',
      `grandfather key ${optionCostKey('nothingByThisName')}: matches no registered priced or default-off option (remove it)`,
    ]);
  });

  it('the grandfathered set is frozen: it never grows past the options registered before the gate', () => {
    // 94 options were registered before 2026-11-26 without a cost proof. Lower this when a hash is removed; never raise it.
    expect(OPTION_COST_GRANDFATHERED.size).toBeLessThanOrEqual(94);
    for (const key of OPTION_COST_GRANDFATHERED) expect(key).toMatch(/^[0-9a-f]{12}$/);
  });

  it('the option that tripped the breaker on 2026-11-26 names its law, not the grandfather set', () => {
    expect(OPTION_COST_LAWS.omahaOopReraiseRangeHoldsVsReraise).toBe(
      'engine/anOopReraiseRangePriceIsFast.law.test.ts'
    );
    expect(OPTION_COST_GRANDFATHERED.has(optionCostKey('omahaOopReraiseRangeHoldsVsReraise'))).toBe(
      false
    );
  });
});
