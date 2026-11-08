/**
 * Forced-phase authority, 2026-11-07 (docs/changelog/2026-11-08-forced-phase-
 * authority-holds-its-domain.md).
 *
 * 1. An owner rule that replaces an authorised Phase 10-13 candidate after the
 *    receipts are finalized (the worker's corrective policy and wager rules,
 *    the table door's commit correction) is not a controller coercion: the
 *    receipt stops claiming the decision. Every case below is a real
 *    withdrawal trigger from the horse decision journal (releases 40bc2467 and
 *    391f7bc0): the controller executed exactly the final decision.
 * 2. A real coercion of a selected candidate withdraws only its own authority
 *    domain (`<variant>-<format>`), loudly, until the next boot.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import {
  horseAuthorityDomainOf,
  reconcileHorsePhaseReceipts,
  withdrawHorsePhaseForController,
  type HorseForcedPhase,
} from './HorsePhaseControllerWithdrawal.js';
import {
  HorsePhase8AuthorityGate,
  HorseQualifiedAuthorityHolder,
} from './HorseQualifiedAuthority.js';
import { qualifiedTestAdmission } from './HorseQualifiedAuthority.test-support.js';

const NOW = Date.parse('2026-10-01T01:00:00.000Z');

function fires(): Record<string, number> {
  return Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));
}
afterEach(() => {
  drainFires();
});

/** The pack's receipt as the worker finalized it, and the decision that left. */
interface JournalCase {
  readonly name: string;
  readonly phase: HorseForcedPhase;
  readonly candidate: { action: 'bet'; amount: number };
  readonly leaving: { action: 'check' | 'bet'; amount?: number };
}
const JOURNAL_CASES: readonly JournalCase[] = [
  // phase10 (plo4 cash), heads_up_position_stab pot-size river bet, wager rules checked.
  {
    name: '40bc2467 17:48:09Z plo4',
    phase: 'phase10',
    candidate: { action: 'bet', amount: 4.32 },
    leaving: { action: 'check' },
  },
  {
    name: '391f7bc0 00:57:09Z plo4',
    phase: 'phase10',
    candidate: { action: 'bet', amount: 8.28 },
    leaving: { action: 'check' },
  },
  // phase11 (plo5, plo6 cash), the same stab, checked.
  {
    name: '391f7bc0 21:57:59Z plo5',
    phase: 'phase11',
    candidate: { action: 'bet', amount: 5.41 },
    leaving: { action: 'check' },
  },
  {
    name: '391f7bc0 23:26:11Z plo6',
    phase: 'phase11',
    candidate: { action: 'bet', amount: 18 },
    leaving: { action: 'check' },
  },
  // phase13 (plo5, plo6 joint cash), a part-pot river bet the wager rules sized to the pot.
  {
    name: '40bc2467 16:47:40Z plo6',
    phase: 'phase13',
    candidate: { action: 'bet', amount: 3.5 },
    leaving: { action: 'bet', amount: 10.6 },
  },
  {
    name: '40bc2467 17:50:21Z plo5',
    phase: 'phase13',
    candidate: { action: 'bet', amount: 1.53 },
    leaving: { action: 'bet', amount: 4.65 },
  },
  {
    name: '391f7bc0 21:31:15Z plo6',
    phase: 'phase13',
    candidate: { action: 'bet', amount: 3.5 },
    leaving: { action: 'bet', amount: 7 },
  },
];

describe('a later owner that replaces an authorised candidate is not a coercion', () => {
  for (const c of JOURNAL_CASES)
    it(`${c.name}: the receipt follows the action that left and stops claiming it`, () => {
      enableBrainTelemetry();
      const receipt = {
        selection: 'selected',
        finalAction: c.candidate.action as string,
        finalAmount: c.candidate.amount as number | null,
      };
      reconcileHorsePhaseReceipts([[c.phase, receipt]], c.leaving, 'wager_rules');
      expect(receipt.selection).toBe('shadow_change');
      expect(receipt.finalAction).toBe(c.leaving.action);
      expect(receipt.finalAmount).toBe(c.leaving.amount ?? null);
      expect(fires()[`${c.phase}_selection_superseded_by_wager_rules`]).toBe(1);
      // The table's execution comparison (ServerTableEngineTurns) now matches
      // the controller's exact execution of that action: no withdrawal.
      const executed = { action: c.leaving.action, amount: c.leaving.amount ?? null };
      const matched =
        executed.action === receipt.finalAction &&
        (!['bet', 'raise'].includes(receipt.finalAction) ||
          executed.amount === receipt.finalAmount);
      expect(matched).toBe(true);
    });

  it('a candidate that leaves unchanged stays selected; a shadow receipt only follows', () => {
    enableBrainTelemetry();
    const owned = { selection: 'selected', finalAction: 'bet', finalAmount: 4.32 };
    const shadow = { selection: 'none', finalAction: 'bet', finalAmount: 3.5 };
    const call = { selection: 'selected', finalAction: 'call', finalAmount: null };
    reconcileHorsePhaseReceipts(
      [
        ['phase10', owned],
        ['phase13', undefined],
      ],
      { action: 'bet', amount: 4.32 },
      'wager_rules'
    );
    reconcileHorsePhaseReceipts(
      [['phase13', shadow]],
      { action: 'bet', amount: 7 },
      'commit_wager_rules'
    );
    reconcileHorsePhaseReceipts(
      [['phase11', call]],
      { action: 'call', amount: 2 },
      'corrective_policy'
    );
    expect(owned).toEqual({ selection: 'selected', finalAction: 'bet', finalAmount: 4.32 });
    expect(shadow).toEqual({ selection: 'none', finalAction: 'bet', finalAmount: 7 });
    expect(call.selection).toBe('selected');
    expect(Object.keys(fires()).filter((k) => k.includes('superseded'))).toEqual([]);
  });

  it('HorseLogic reconciles after the corrective policy and after the wager rules, before timing', () => {
    const src = readFileSync(new URL('./HorseLogic.ts', import.meta.url), 'utf8').replace(
      /\s+/g,
      ''
    );
    const at = (needle: string) => {
      const i = src.indexOf(needle.replace(/\s+/g, ''));
      expect(i, needle).toBeGreaterThan(-1);
      return i;
    };
    const corrective = at("decision = graph.run('corrective_policy'");
    const afterCorrective = at(
      "reconcileHorsePhaseReceipts(phaseReceiptsBeforeLaterOwners, decision, 'corrective_policy', tele)"
    );
    const wager = at("decision = graph.run('wager_rules'");
    const afterWager = at(
      "reconcileHorsePhaseReceipts(phaseReceiptsBeforeLaterOwners, decision, 'wager_rules', tele)"
    );
    const timing = at("decision = graph.run('timing'");
    expect(at('const phaseReceiptsBeforeLaterOwners')).toBeLessThan(corrective);
    expect(corrective).toBeLessThan(afterCorrective);
    expect(afterCorrective).toBeLessThan(wager);
    expect(wager).toBeLessThan(afterWager);
    expect(afterWager).toBeLessThan(timing);
  });

  it('the table door reconciles after its commit-side wager correction', () => {
    const src = readFileSync(new URL('./ServerTableEngineTurns.ts', import.meta.url), 'utf8');
    const correction = src.indexOf("noteFire('wager_rules_commit_correction');");
    const reconcile = src.indexOf('reconcileHorsePhaseReceipts(', correction);
    expect(correction).toBeGreaterThan(-1);
    expect(reconcile).toBeGreaterThan(correction);
    // Inside the correction block: before the action the door submits.
    const submitted = src.indexOf('let action = decision.action as string;', correction);
    expect(reconcile).toBeLessThan(submitted);
    // The call itself, up to its own close, names the commit owner.
    const call = src.slice(reconcile, src.indexOf(');', reconcile));
    expect(call).toContain("'commit_wager_rules'");
  });
});

describe('an illegal-action disable withdraws only its own domain until the next boot', () => {
  function bootedGate() {
    const gate = new HorsePhase8AuthorityGate(() => qualifiedTestAdmission(1), 'main');
    gate.refresh();
    const worker = new HorseQualifiedAuthorityHolder('worker');
    worker.apply(qualifiedTestAdmission(1));
    gate.observeWorker(worker.receipt());
    return { gate, worker, receipt: () => gate.stamp(worker.receipt()) };
  }

  it('withdrawal in one domain leaves the other domains usable', () => {
    const { gate, receipt } = bootedGate();
    expect(gate.withdrawDomain('plo5-cash', 'controller_coerced_candidate')).toBe(true);
    expect(gate.check(receipt(), NOW, 'plo5-cash')).toBe('withdrawn');
    expect(gate.check(receipt(), NOW, 'plo5-mtt')).toBe('usable');
    expect(gate.check(receipt(), NOW, 'plo6-cash')).toBe('usable');
    expect(gate.mainState()).toBe('usable');
    expect(gate.domainWithdrawal('plo5-cash')).toBe('controller_coerced_candidate');
    expect(gate.domainWithdrawal('plo5-mtt')).toBeNull();
  });

  it('the withdrawn domain stays withdrawn through refreshes and worker restarts; only a new boot clears it', () => {
    const { gate, receipt } = bootedGate();
    gate.withdrawDomain('plo4-cash', 'controller_fallback_candidate');
    expect(gate.withdrawDomain('plo4-cash', 'controller_coerced_candidate')).toBe(false);
    gate.refresh();
    const replacement = new HorseQualifiedAuthorityHolder('worker-2');
    replacement.apply(qualifiedTestAdmission(2));
    gate.observeWorker(replacement.receipt());
    expect(gate.check(receipt(), NOW + 86_400_000, 'plo4-cash')).toBe('withdrawn');
    expect(gate.check(gate.stamp(replacement.receipt()), NOW + 86_400_000, 'plo4-cash')).toBe(
      'withdrawn'
    );
    expect(gate.domainWithdrawal('plo4-cash')).toBe('controller_fallback_candidate');
    // The next certified boot constructs a new gate: the domain is usable.
    const next = bootedGate();
    expect(next.gate.check(next.receipt(), NOW, 'plo4-cash')).toBe('usable');
  });

  it('a coercion of a selected candidate withdraws its domain loudly and keeps every receipt', () => {
    enableBrainTelemetry();
    const { gate, receipt } = bootedGate();
    const report = vi.fn();
    const domain = horseAuthorityDomainOf({
      gameVariant: 'plo6',
      format: 'cash',
      gameMode: 'cash',
    });
    expect(domain).toBe('plo6-cash');
    withdrawHorsePhaseForController({ phase: 'phase13', gate, domain, status: 'coerced', report });
    withdrawHorsePhaseForController({ phase: 'phase13', gate, domain, status: 'coerced', report });
    const f = fires();
    expect(f.phase13_selected_candidate_coerced).toBe(2);
    expect(f.phase13_authority_controller_withdrawn).toBe(2);
    expect(f['phase13_authority_domain_withdrawn_plo6-cash']).toBe(1);
    expect(report).toHaveBeenCalledTimes(2);
    expect(String(report.mock.calls[0][0].message)).toContain('plo6-cash');
    expect(gate.check(receipt(), NOW, 'plo6-cash')).toBe('withdrawn');
    expect(gate.check(receipt(), NOW, 'plo6-mtt')).toBe('usable');
    expect(gate.mainState()).toBe('usable');
  });

  it('a decision whose domain cannot be named fails closed: the whole gate withdraws', () => {
    enableBrainTelemetry();
    const { gate, receipt } = bootedGate();
    const domain = horseAuthorityDomainOf({
      gameVariant: 'plo4',
      format: undefined,
      gameMode: 'cash',
    });
    expect(domain).toBeNull();
    withdrawHorsePhaseForController({
      phase: 'phase10',
      gate,
      domain,
      status: 'fallback',
      report: () => {},
    });
    const f = fires();
    expect(f.phase10_selected_candidate_fallback).toBe(1);
    expect(f.phase10_authority_domain_unknown_gate_withdrawn).toBe(1);
    expect(gate.mainState()).toBe('withdrawn');
    expect(gate.check(receipt(), NOW, 'plo4-cash')).toBe('withdrawn');
    expect(gate.check(receipt(), NOW)).toBe('withdrawn');
  });
});
