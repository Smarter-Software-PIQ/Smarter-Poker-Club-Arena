/**
 * LAW: NO NEW BLANKET RULE CAN ENTER THE PLO4/PLO5 CASH DECISION PATH (owner
 * 2026-11-20 3:28 PM Chicago: "THERE SHOULD NEVER EVER EVER BY ANY BLANKET
 * RULES. MAKE SURE THEY ARE ALL REMOVED IF THEY SOMEHOW GOT ADDED BACK IN.";
 * 2026-11-17: "EVERY DECISION NEEDS TO BE 100% INDEPENDANT AND DATA AND MATH
 * DERRIVED AND BY RANGES, NEVER BLANKETS").
 *
 * The register of classes is HorseOmahaRuleSites.ts; the register of pricing
 * bases is HorseOmahaRuleBasis.ts. This law fails the build when:
 *  1. an option of OMAHA_OPTION_CLASSES, an option a registered rule site
 *     names, or an option omahaNoCategoricalRules switches off has no basis;
 *  2. a priced basis does not state its range, equity, realization and price,
 *     or a priced option of the register is declared from nothing;
 *  3. the register and the basis disagree (a categorical or open option
 *     declared priced; an option of the no-categorical list declared priced;
 *     a basis claiming omahaNoCategoricalRules removes a rule it does not);
 *  4. a blanket, partly-blanket or unreviewed declaration is ADDED: the three
 *     backlog lists below may only shrink;
 *  5. an omaha_* / plo_* receipt is fired by engine source with no
 *     declaration (a new rule site in the Omaha path fires a receipt).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ledgerReceiptFor } from './HorseDataLedger.js';
import { OMAHA_NO_CATEGORICAL_RULES_OFF } from './HorseOmahaNoCategoricalRules.js';
import {
  OMAHA_OPTION_BASIS,
  OMAHA_REFERENCE_RULE_BASIS,
  OMAHA_SHARED_OPTION_BASIS,
  type OmahaRuleBasis,
} from './HorseOmahaRuleBasis.js';
import { OMAHA_RECEIPTS_AT_GUARD } from './HorseOmahaRuleBasisReceipts.js';
import {
  OMAHA_CATEGORICAL_RULE_SITES,
  OMAHA_OPEN_RULE_SITES,
  OMAHA_OPTION_CLASSES,
} from './HorseOmahaRuleSites.js';

const ENGINE = fileURLToPath(new URL('.', import.meta.url));
const ALL: Readonly<Record<string, OmahaRuleBasis>> = {
  ...OMAHA_OPTION_BASIS,
  ...OMAHA_SHARED_OPTION_BASIS,
  ...OMAHA_REFERENCE_RULE_BASIS,
};
const optionBasis = (o: string): OmahaRuleBasis | undefined =>
  OMAHA_OPTION_BASIS[o] ?? OMAHA_SHARED_OPTION_BASIS[o];
const isPricedOrPricedInput = (b: OmahaRuleBasis | undefined): boolean =>
  b?.kind === 'priced' || (b?.kind === 'exempt' && b.exemption === 'input');
const namesOfKind = (kind: OmahaRuleBasis['kind']): string[] =>
  Object.entries(ALL)
    .filter(([, b]) => b.kind === kind)
    .map(([n]) => n)
    .sort();

describe('every Omaha decision rule declares its pricing basis (HorseOmahaRuleBasis.ts)', () => {
  it('every option of the register has a basis, and no basis names an option the register lost', () => {
    const missing = Object.keys(OMAHA_OPTION_CLASSES).filter((o) => !(o in OMAHA_OPTION_BASIS));
    expect(
      missing,
      'an Omaha option with no pricing basis: declare range, equity, realization and price, or the exemption'
    ).toEqual([]);
    const stale = Object.keys(OMAHA_OPTION_BASIS).filter((o) => !(o in OMAHA_OPTION_CLASSES));
    expect(stale, 'a basis for an option the register does not hold').toEqual([]);
  });

  it('every option a registered rule site names, and every option omahaNoCategoricalRules switches off, has a basis', () => {
    const named = new Set<string>([...OMAHA_NO_CATEGORICAL_RULES_OFF]);
    for (const s of OMAHA_CATEGORICAL_RULE_SITES) {
      for (const o of s.legacyOptions) named.add(o);
      named.add(s.pricedBy);
    }
    for (const s of OMAHA_OPEN_RULE_SITES) for (const o of s.legacyOptions) named.add(o);
    expect([...named].filter((o) => !optionBasis(o)).sort()).toEqual([]);
  });

  it('a priced basis states its range, equity, realization and price', () => {
    for (const [name, b] of Object.entries(ALL)) {
      if (b.kind === 'priced') {
        for (const f of ['range', 'equity', 'realization', 'price'] as const)
          expect(b[f].trim().length, `${name}: ${f} is stated`).toBeGreaterThan(20);
      } else if (b.kind === 'exempt') {
        expect(b.why.trim().length, `${name}: the exemption says why`).toBeGreaterThan(20);
      } else if (b.kind === 'blanket' || b.kind === 'partly') {
        expect(b.what.trim().length, `${name}: what decides by category`).toBeGreaterThan(20);
      }
    }
  });

  it('the register and the basis agree', () => {
    for (const [option, ruling] of Object.entries(OMAHA_OPTION_CLASSES)) {
      const b = OMAHA_OPTION_BASIS[option];
      if (ruling.cls === 'categorical' || ruling.cls === 'open')
        expect(b?.kind, `${option} is classed ${ruling.cls}: it is blanket`).toBe('blanket');
      if (ruling.cls === 'categorical')
        expect(optionBasis(ruling.note)?.kind, `${option} -> ${ruling.note} is priced`).toBe(
          'priced'
        );
    }
    for (const site of OMAHA_CATEGORICAL_RULE_SITES)
      expect(optionBasis(site.pricedBy)?.kind, `audit ${site.audit}: ${site.pricedBy}`).toBe(
        'priced'
      );
    for (const o of OMAHA_NO_CATEGORICAL_RULES_OFF)
      expect(
        optionBasis(o)?.kind,
        `${o} is switched off by omahaNoCategoricalRules: it is not priced`
      ).not.toBe('priced');
    const nocat = new Set<string>(OMAHA_NO_CATEGORICAL_RULES_OFF);
    const cells = new Set(['v81OmahaBigBetCalls', 'v84OmahaRiverReraiseCalls']);
    for (const [name, b] of Object.entries({
      ...OMAHA_OPTION_BASIS,
      ...OMAHA_SHARED_OPTION_BASIS,
    })) {
      if (
        (b.kind === 'blanket' || b.kind === 'partly') &&
        b.neutralisedBy.includes('omahaNoCategoricalRules')
      )
        expect(
          nocat.has(name) || cells.has(name),
          `${name}: omahaNoCategoricalRules does switch it off`
        ).toBe(true);
    }
    for (const [name, b] of Object.entries(ALL)) {
      if (b.kind !== 'blanket' && b.kind !== 'partly') continue;
      for (const o of b.neutralisedBy)
        expect(
          isPricedOrPricedInput(optionBasis(o)) || o === 'omahaNoCategoricalRules',
          `${name}: ${o} is a priced option, a priced input or the scoped switch`
        ).toBe(true);
    }
  });

  it('omahaNoCategoricalRules does not switch off the priced turn plans (lead ruling 2026-11-20: priced in form)', () => {
    for (const o of ['omahaStreetPlan', 'omahaStreetPlanThreeWay'])
      expect((OMAHA_NO_CATEGORICAL_RULES_OFF as readonly string[]).includes(o), o).toBe(false);
  });

  it('every reference rule site is a receipt the ledger holds', () => {
    for (const r of Object.keys(OMAHA_REFERENCE_RULE_BASIS))
      expect(ledgerReceiptFor(r)?.kind, `${r} is a ledger receipt`).toBe('receipt');
  });
});

describe('the blanket backlog only shrinks: a categorical rule cannot be registered for PLO4/PLO5 cash', () => {
  // To remove a rule: delete or price it, change its declaration, and delete its name here.
  // To add one: you cannot. Price the decision (range, equity, realization, price) instead.
  it('blanket declarations are exactly these', () => {
    expect(namesOfKind('blanket')).toEqual(
      [
        'omahaBareOverpairOopFlopCheck',
        'omahaBeatenMadeHandDefense',
        'omahaBigBetIsPotShare',
        'omahaBluffCatcherFoldVsValueLeader',
        'omahaBluffCatcherRaiseFold',
        'omahaCurrentNutsRaise',
        'omahaEliteContinuesVsMeasuredWideThreeBettor',
        'omahaMadeHandDefenseVsValueLeader',
        'omahaNoCallColdFourBetWithoutPremium',
        'omahaNoDrawRaiseOutOfPosition',
        'omahaNoRiverBluffIntoValueLeader',
        'omahaOnePairDiscipline',
        'omahaOopReraisedPotStrongRange',
        'omahaOopTurnCheckAfterFlopCall',
        'omahaOverpairNoOopBarrelVsValueLeader',
        // RULES-FIX-1 (AUDIT-B item 5): fixed price and stack thresholds where no facing-bet verdict answers
        'omahaPairedBoardFoldRespectsPrice',
        'omahaPairedRiverNoThinLeadVsValueLeader',
        'omahaPairedTurnNoBarrelWithoutBoatVsValueLeader',
        'omahaPressureNeedsPostflopAggression',
        'omahaReraiseRangeEarlyPosition',
        'omahaReraiseRangeOutOfPosition',
        'omahaReraisedFoldVsTight',
        'omahaReraisedPotDiscipline',
        'omahaReraisedPotFlopContinueNeedsEquityShape',
        'omahaReraisedPotStackOffFold',
        'omahaRiverNutBlockerBluffReachable',
        'omahaRiverNutRaiseOnly',
        'omahaStrongHandSlowplayMix',
        'omahaTightOpponent',
        'omahaTightOpponentSteal',
        'omahaTurnRiverRaiseNeedsNuts',
        'omahaTurnSetPound',
        'omahaUnderpairNoMultiwayFlopContinue',
        'omaha_big_bet_by_pot_share',
        'omaha_owner_approved_bet_kept',
        'omaha_owner_ruled_check_kept',
        'omaha_value_size_band_applied',
        'ploPairedBoardFold',
        'ploPairedBoardRiverCheck',
        'ploSuitedAcesFourBet',
        'plo_suited_aces_four_bet',
        'v15_raise_gate',
        'v40_no_third_barrel',
        'v40_small_ball',
        'v46Charts',
        'v46_class_fold',
        'v46_class_never_3bet',
        'v74OmahaSemiBluffNeedsDraw',
        'v74_omaha_semibluff_needs_draw',
        'v81OmahaBigBetCalls',
        'v81_omaha_big_bet_call_fold',
        'v84OmahaRiverReraiseCalls',
        'v84_omaha_river_reraise_call_fold',
        'v86PloOverhaul',
        'v86_plo_combo_draw_pump',
        'v86_plo_elite_three_bet',
        'v86_plo_multiway_dominated_fold',
        'v86_plo_underboat_fold',
        'v9Mood',
        'v16SizeCond',
        'omahaTurnBetNeedsRiverPlan',
      ].sort()
    );
  });
  it('partly-blanket declarations (an EV with a categorical gate or input) are exactly these', () => {
    expect(namesOfKind('partly')).toEqual(
      [
        'horse_continuation_budget_fold',
        'maniac_pressure_preflop',
        'omaha_implied_credit_withheld',
        'opponent_exploit_calldown',
        'plo_opponent_presumed_aggressive',
        'v15',
        'v15_boat_dominated',
        'v15_eq_capped',
        'v38_ev_fold',
        'v38_river_fold',
        'v40Omaha',
        'v40_omaha_pressure_cap',
        'omahaStreetPlan',
        'omahaStreetPlanFlop',
        'omahaStreetPlanThreeWay',
        'omahaOpenNeedsMeasuredStrength',
        'omahaColdCallOutsideBigBlindIsMeasured',
        'omahaAcesReraiseIsMeasured',
        'omahaReraiseRangeIsMeasured',
        'omahaRundownReraiseRangeIsMeasured',
        'omahaRundownReraiseRangeTrial',
        'omahaValueSizeIsUnreadable',
      ].sort()
    );
  });
  it('declarations not yet reviewed at the line level are exactly these (each moves to priced, exempt or blanket)', () => {
    expect(namesOfKind('review')).toEqual(
      [
        'omahaBetSizeByPublicState',
        'omahaBigDrawAggression',
        'omahaCommitZoneThreeBetPriceRelief',
        'omahaMultiwayRiverCallNeedsStrength',
        'omahaMultiwayWeakHandNoBet',
        'omahaNutClassValueSize',
        'omahaPreflopCallWithActionBehind',
        'omahaPreflopReraiseDefencePricedInPosition',
        'omahaPreflopStackPlan',
        'omahaPricedMix',
        'omahaReraisedPotStackOffRealistic',
        'omahaSmallBlindSteal',
      ].sort()
    );
  });
});

function engineSources(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      if (f !== 'node_modules' && f !== '__snapshots__') engineSources(p, out);
    } else if (f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.includes('test-support'))
      out.push(p);
  }
  return out;
}

describe('a new Omaha rule site cannot fire a receipt without a declaration', () => {
  it('every omaha_* / plo_* receipt fired by a literal noteFire in engine source is declared or was there at the guard', () => {
    const declared = new Set<string>([
      ...OMAHA_RECEIPTS_AT_GUARD,
      ...Object.keys(OMAHA_REFERENCE_RULE_BASIS),
    ]);
    for (const s of [...OMAHA_CATEGORICAL_RULE_SITES, ...OMAHA_OPEN_RULE_SITES])
      for (const r of s.legacyReceipts) declared.add(r);
    const fired = new Set<string>();
    for (const f of engineSources(ENGINE))
      for (const m of readFileSync(f, 'utf8').matchAll(
        /noteFire\(\s*'((?:omaha|plo)_[a-z0-9_]+)'/g
      ))
        fired.add(m[1]);
    expect(fired.size).toBeGreaterThan(150);
    const undeclared = [...fired].filter(
      (r) =>
        !declared.has(r) &&
        ![...declared].some((d) => d.endsWith('*') && r.startsWith(d.slice(0, -1)))
    );
    expect(
      undeclared.sort(),
      'a new Omaha receipt: declare its rule in OMAHA_REFERENCE_RULE_BASIS (priced: range, equity, realization, price) or in the register'
    ).toEqual([]);
  });
});
