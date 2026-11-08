/**
 * Forced-phase authority, illegal-action disable (owner design change,
 * 2026-11-07).
 *
 * Before: one authorised Phase 10-13 candidate that the controller refused or
 * rewrote withdrew that phase's gate for the whole process until the next
 * boot. On 2026-11-07 that disabled Phase 10 fleet-wide from 17:48Z (release
 * 40bc2467) and again from 00:57Z (release 391f7bc0), and Phase 11 and 13
 * the same way.
 *
 * Now: the withdrawal is scoped to the authority domain that produced it,
 * `<variant>-<format>` (the Phase 14 domain key), on the same gate. It holds
 * until the next certified boot (a new gate): no timer, no re-admission, no
 * retry. Every receipt is kept. A candidate that reaches the controller as
 * `selected` is legal by construction (the worker legalizes it, and since
 * 2026-11-07 an owner wager rule that replaces it marks it `shadow_change`), so
 * a coercion here is a defect: it fires a distinct receipt and is reported.
 *
 * A decision whose domain cannot be named fails closed: the whole gate is
 * withdrawn exactly as before.
 */
import { noteFire } from './BrainTelemetry.js';
import type { HorsePhase8AuthorityGate } from './HorseQualifiedAuthority.js';
import {
  correctiveDecisionDomain,
  correctiveDomainKey,
} from '../services/horseCorrectiveReview/domain.js';

export type HorseForcedPhase = 'phase10' | 'phase11' | 'phase12' | 'phase13';

/** The authority domain key of a decision's game state, or null. */
export function horseAuthorityDomainOf(gameState: {
  gameVariant?: unknown;
  format?: unknown;
  gameMode?: unknown;
}): string | null {
  const domain = correctiveDecisionDomain(gameState);
  return domain ? correctiveDomainKey(domain) : null;
}

export interface HorseControllerWithdrawal {
  readonly phase: HorseForcedPhase;
  readonly gate: Pick<HorsePhase8AuthorityGate, 'withdraw' | 'withdrawDomain'>;
  readonly domain: string | null;
  readonly status: 'coerced' | 'fallback';
  /** The existing report path (reportError at the call site). */
  readonly report: (error: Error) => void;
}

/** The controller refused or rewrote an authorised candidate. */
export function withdrawHorsePhaseForController(input: HorseControllerWithdrawal): void {
  const { phase, gate, domain, status } = input;
  const reason = `controller_${status}_candidate`;
  // Loud: a selected candidate is legal by construction, so this is a defect.
  noteFire(`${phase}_selected_candidate_${status}`);
  input.report(
    new Error(
      `${phase} authorised candidate was ${status} by the controller in domain ${domain ?? 'unknown'}`
    )
  );
  if (domain === null) {
    gate.withdraw(reason);
    noteFire(`${phase}_authority_controller_withdrawn`);
    noteFire(`${phase}_authority_domain_unknown_gate_withdrawn`);
    return;
  }
  const first = gate.withdrawDomain(domain, reason);
  noteFire(`${phase}_authority_controller_withdrawn`);
  if (first) noteFire(`${phase}_authority_domain_withdrawn_${domain}`);
}

interface HorsePhaseLedger {
  selection?: string;
  finalAction: string;
  finalAmount: number | null;
}

/** The owner rule that replaced the decision after the phase receipts were finalized. */
export type HorseSupersedingOwner = 'corrective_policy' | 'wager_rules' | 'commit_wager_rules';

/**
 * Later owners run after the Phase 10-13 receipts are finalized: the Phase 14
 * corrective policy and the owner wager rules, in the worker (`wager_rules` graph node: river paired-board check, full-pot nut
 * wager, ...) and again at the table door (`wager_rules_commit_correction`).
 * When one replaces the decision, every Phase 10-13 receipt records the action
 * that now leaves for the controller, and a `selected` candidate it replaced
 * no longer owns the decision: it becomes `shadow_change` (the
 * variant_utility_guard vocabulary: applied, but not the action leaving).
 * Left `selected` with the pack's own wager, the table read the honest
 * execution of the owner rule as a controller coercion of the candidate and
 * withdrew the phase (every 2026-11-07 withdrawal on 40bc2467 and 391f7bc0).
 */
export function reconcileHorsePhaseReceipts(
  receipts: ReadonlyArray<readonly [HorseForcedPhase, HorsePhaseLedger | undefined]>,
  decision: { action: string; amount?: number },
  owner: HorseSupersedingOwner,
  telemetry = true
): void {
  const amount = decision.amount ?? null;
  for (const [phase, receipt] of receipts) {
    if (!receipt) continue;
    const owned =
      receipt.finalAction === decision.action &&
      (!['bet', 'raise'].includes(decision.action) || receipt.finalAmount === amount);
    if (owned) continue;
    if (receipt.selection === 'selected') {
      receipt.selection = 'shadow_change';
      if (telemetry) noteFire(`${phase}_selection_superseded_by_${owner}`);
    }
    receipt.finalAction = decision.action;
    receipt.finalAmount = amount;
  }
}
