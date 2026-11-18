import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  horseDecisionReceiptRefusal,
  type HorseDecisionReceiptContext,
} from './responseValidation.js';
import { HorseQualifiedAuthorityHolder } from '../HorseQualifiedAuthority.js';
import { admitHorsePhase11LiveAuthority } from '../HorsePhase11Authority.js';
import { OMAHA_VARIANT_PACKS } from '../omaha/OmahaVariantPolicyPack.js';
import {
  evaluateOmahaVariantPolicy,
  omahaVariantReceiptBindingIsValid,
} from '../omaha/OmahaVariantLivePolicy.js';
import { omahaVariantSpot } from '../../benchmark/OmahaVariantPolicyEvidence.js';
import { restoreFastRandom, saveFastRandom, seedFastRandom } from '../HorseEval.js';
import { HorseLogic } from '../HorseLogic.js';
import type { HorseDecision } from '../../types.js';

// The complete validator on the captured PLO6 river receipt (to call 123,
// stack 142), carrying a Phase 11 selection that the final rule superseded.
const captured = JSON.parse(
  readFileSync(new URL('./fixtures/plo6-river-call-receipt.json', import.meta.url), 'utf8')
) as { context: HorseDecisionReceiptContext; decision: HorseDecision };
type Act = { action: string; amount: number | null };
const act = (action: string, amount: number | null = null): Act => ({ action, amount });

// A receipt the live Omaha policy really produced on a fired PLO6 flop node:
// it carries the bound decision inputs (eligible, inputs non-null).
function boundReceipt(): Record<string, unknown> {
  const spot = omahaVariantSpot('plo6', 'flop', 2);
  const saved = saveFastRandom();
  restoreFastRandom(0x5f3759df);
  try {
    const { receipt } = evaluateOmahaVariantPolicy(
      spot.hero,
      spot.state,
      spot.baseline,
      null,
      'shadow',
      () => 0
    );
    return structuredClone(receipt) as unknown as Record<string, unknown>;
  } finally {
    restoreFastRandom(saved);
  }
}
const TWO_STEP = {
  baselineAction: 'call',
  baselineAmount: 123,
  proposalAction: 'all_in',
  proposalAmount: null,
  finalAction: 'call',
  finalAmount: 123,
};
type Shape = 'legacy unbound' | 'bound input';
const SHAPES: Shape[] = ['legacy unbound', 'bound input'];

function refusal(
  outputs: Record<string, Act>,
  proposalAmount: number | null = 123,
  shape: Shape = 'legacy unbound',
  selection: Record<string, unknown> = {},
  graphVersion: 'v3' | 'v2' = 'v3'
) {
  const { context, decision } = structuredClone(captured);
  if (graphVersion === 'v2') {
    // The retained order before the corrective rule existed: wager_rules is the final rule.
    const graph = decision.policyGraph as unknown as {
      version: string;
      transitions: Array<{ node: string }>;
    };
    graph.version = 'horse-policy-order-v2';
    graph.transitions = graph.transitions.filter((t) => t.node !== 'corrective_policy');
  }
  let prev: Act | null = null;
  for (const t of decision.policyGraph!.transitions as unknown as Array<Record<string, unknown>>) {
    const after: Act = outputs[t.node as string] ?? prev ?? (t.after as Act);
    t.before = prev;
    t.after = after;
    t.changed = prev !== null && (prev.action !== after.action || prev.amount !== after.amount);
    prev = after;
  }
  const d = decision as unknown as Record<string, unknown>;
  (decision.policyGraph as unknown as Record<string, unknown>).finalAction = prev;
  d.action = prev!.action;
  if (prev!.amount === null) delete d.amount;
  else d.amount = prev!.amount;
  const holder = new HorseQualifiedAuthorityHolder(
    '11111111-2222-4222-8222-222222222222',
    OMAHA_VARIANT_PACKS.plo6.version
  );
  holder.apply(admitHorsePhase11LiveAuthority('plo6'));
  const base =
    shape === 'bound input'
      ? boundReceipt()
      : {
          variant: 'plo6',
          version: OMAHA_VARIANT_PACKS.plo6.version,
          inputs: null,
          eligible: false,
        };
  d.omahaVariantPolicy = {
    ...base,
    mode: 'candidate',
    authority: holder.receipt(),
    utilityOwner: 'cash',
    applied: true,
    changed: true,
    selection: 'shadow_change',
    baselineAction: 'all_in',
    baselineAmount: null,
    proposalAction: 'call',
    proposalAmount,
    finalAction: 'all_in',
    finalAmount: null,
    ...selection,
  };
  return horseDecisionReceiptRefusal(decision, 'plo6', context);
}

describe('a superseded selection reaches the final rule exactly as proposed', () => {
  it('the bound-input shape is a real policy receipt with bound inputs', () => {
    const receipt = boundReceipt();
    expect(receipt.eligible).toBe(true);
    expect(receipt.inputs).not.toBeNull();
    expect(omahaVariantReceiptBindingIsValid(receipt)).toBe(true);
  });

  it.each(SHAPES)('admits legitimate replacement chains (%s receipt)', (shape) => {
    const call = act('call', 123);
    expect(refusal({ variant_policy: call, wager_rules: act('all_in') }, 123, shape)).toBeNull();
    expect(
      refusal({ variant_policy: call, corrective_policy: act('all_in') }, 123, shape)
    ).toBeNull();
    // Two steps: the corrective rule turns the proposed all-in into a raise
    // and the wager rule then caps it to the priced call.
    expect(
      refusal(
        {
          reference: call,
          variant_policy: act('all_in'),
          corrective_policy: act('raise', 140),
          wager_rules: call,
        },
        null,
        shape,
        TWO_STEP
      )
    ).toBeNull();
  });

  it.each(SHAPES)('refuses a rewritten call price on a %s receipt', (shape) => {
    for (const node of ['variant_utility_guard', 'joint_policy'])
      for (const amount of [60, null])
        expect(
          refusal(
            {
              variant_policy: act('call', 123),
              [node]: act('call', amount),
              wager_rules: act('all_in'),
            },
            123,
            shape
          )
        ).toBe('phase11_selection');
  });

  it.each([
    'tournament_utility',
    'tournament_continuation',
    'variant_utility_guard',
    'joint_policy',
  ])('refuses a call whose recorded price %s rewrote before the final rule', (node) => {
    for (const amount of [60, null]) {
      expect(
        refusal({
          variant_policy: act('call', 123),
          [node]: act('call', amount),
          wager_rules: act('all_in'),
        })
      ).toBe('phase11_selection');
    }
  });

  // A proposed all-in carries no amount. The final rule may cap it to the
  // priced call (the captured receipt's own shape); an intermediate stage may
  // not give it an amount on the way.
  it.each(SHAPES)('keeps the all-in convention on a %s receipt', (shape) => {
    const allIn = {
      baselineAction: 'call',
      baselineAmount: 123,
      proposalAction: 'all_in',
      proposalAmount: null,
      finalAction: 'call',
      finalAmount: 123,
    };
    const proposed = { reference: act('call', 123), variant_policy: act('all_in') };
    expect(refusal({ ...proposed, wager_rules: act('call', 123) }, null, shape, allIn)).toBeNull();
    expect(
      refusal(
        { ...proposed, joint_policy: act('all_in', 100), wager_rules: act('call', 123) },
        null,
        shape,
        allIn
      )
    ).toBe('phase11_selection');
  });

  it.each(SHAPES)(
    'applies the same rule where wager_rules is the final rule (v2 order, %s)',
    (shape) => {
      const call = act('call', 123);
      expect(
        refusal({ variant_policy: call, wager_rules: act('all_in') }, 123, shape, {}, 'v2')
      ).toBeNull();
      expect(
        refusal(
          { variant_policy: call, joint_policy: act('call', 60), wager_rules: act('all_in') },
          123,
          shape,
          {},
          'v2'
        )
      ).toBe('phase11_selection');
    }
  );

  it('still refuses a receipt whose proposal amount differs from the graph', () => {
    expect(refusal({ variant_policy: act('call', 123), wager_rules: act('all_in') }, 60)).toBe(
      'phase11_selection'
    );
  });
});

// One decision end to end: the maintained producer makes the receipt for a
// PLO6 river request, and the complete validator judges that receipt against
// that same request. Only the graph steps and the selection outcome are
// rewritten; the bound inputs stay the producer's own.
describe('a receipt judged against the request that produced it', () => {
  function judge(outputs: Record<string, Act>) {
    const input = omahaVariantSpot('plo6', 'river', 2, 'cash');
    const saved = saveFastRandom();
    seedFastRandom(100101);
    let decision: HorseDecision;
    try {
      decision = HorseLogic.decide(input.hero, input.state, 'balanced', {}, {
        telemetry: false,
        mind: false,
        decisionTimeMs: 0,
        phase11Omaha: 'candidate',
        phase11EvidenceMode: true,
      } as never);
    } finally {
      restoreFastRandom(saved);
    }
    const produced = decision.omahaVariantPolicy as unknown as Record<string, unknown>;
    expect(produced.eligible).toBe(true);
    expect(produced.inputs).not.toBeNull();
    expect(omahaVariantReceiptBindingIsValid(produced)).toBe(true);
    const d = structuredClone(decision) as unknown as Record<string, unknown>;
    const graph = d.policyGraph as {
      transitions: Array<Record<string, unknown>>;
      finalAction: Act;
    };
    let prev: Act | null = null;
    for (const t of graph.transitions) {
      const after: Act = outputs[t.node as string] ?? prev ?? (t.after as Act);
      t.before = prev;
      t.after = after;
      t.changed = prev !== null && (prev.action !== after.action || prev.amount !== after.amount);
      prev = after;
    }
    graph.finalAction = prev!;
    d.action = prev!.action;
    if (prev!.amount === null) delete d.amount;
    else d.amount = prev!.amount;
    const holder = new HorseQualifiedAuthorityHolder(
      '11111111-2222-4222-8222-222222222222',
      OMAHA_VARIANT_PACKS.plo6.version
    );
    holder.apply(admitHorsePhase11LiveAuthority('plo6'));
    d.omahaVariantPolicy = {
      ...structuredClone(produced),
      mode: 'candidate',
      authority: holder.receipt(),
      utilityOwner: 'cash',
      applied: true,
      changed: true,
      selection: 'shadow_change',
      selectionRefusal: null,
      baselineAction: 'fold',
      baselineAmount: null,
      proposalAction: 'call',
      proposalAmount: 20,
      finalAction: prev!.action,
      finalAmount: prev!.amount,
    };
    return horseDecisionReceiptRefusal(d as never, 'plo6', {
      player: input.hero,
      gameState: input.state,
    } as never);
  }
  const proposed = { reference: act('fold'), variant_policy: act('call', 20) };

  it('admits the proposed call replaced by the wager rule or the corrective rule', () => {
    expect(judge({ ...proposed, wager_rules: act('all_in') })).toBeNull();
    expect(judge({ ...proposed, corrective_policy: act('all_in') })).toBeNull();
  });

  it.each(['variant_utility_guard', 'joint_policy'])(
    'refuses the proposed call once %s rewrites or removes its price',
    (node) => {
      for (const amount of [7, null])
        expect(
          judge({ ...proposed, [node]: act('call', amount), wager_rules: act('all_in') })
        ).toBe('phase11_selection');
    }
  );
});
