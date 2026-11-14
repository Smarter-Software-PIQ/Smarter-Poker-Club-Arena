/**
 * LAW: EVERY HORSE STYLE, IN EVERY VARIANT AND BOTH MODES, REACHES THE
 * APPROVED UPGRADES THROUGH THE PRODUCTION DECISION PATH (2026-11-13).
 *
 * What was unproven. The per-decision upgrade counters (01 range posteriors,
 * 02 card removal, 06 public timing) were asserted for one cell only: the
 * brain called directly with 'grinder', hold'em, cash
 * (HorseUpgradeEvidenceCounters.test.ts). The worker + HandController matrix
 * (HorseActionSpaceFreedom.law.test.ts) covers a Hybrid row in eight primary
 * cells and the five remaining variants in cash only, and asserts no upgrade
 * counter. Nothing ran a stored legacy style, or a remaining variant in a
 * tournament, through the worker and checked what the decision used.
 *
 * What this drives. For each stored style x variant x mode:
 *   1. a real HandController deals the hand and is walked passively to the
 *      flop, so the state is the engine's own (menu, pots, rules, history);
 *   2. the stored `horse_profile.style` is resolved by
 *      resolveHorseHybridProfile, the call ServerTableEngineTurns and
 *      LightningHorse make;
 *   3. the request goes through HorseDecisionWorkerRuntime DECIDE_FAST, the
 *      only production caller of HorseLogic.decide, with the production
 *      telemetry wiring (noteFeature = noteFire);
 *   4. the answer must be a FAST_RESULT with a valid receipt, no brain
 *      fallback, an action on the controller's menu that the controller then
 *      accepts, and every per-decision counter the manifest declares for that
 *      variant and mode: 01, 02 and 06 everywhere they are declared, 07 (the
 *      tournament utility) in tournaments only, and 12 (the remaining-variant
 *      pack) where the pack owns the game.
 *
 * The one combination the engine does not support is asserted by its own
 * reason, not skipped: the Phase 12 pack refuses Pineapple tournaments as
 * `pineapple_tournament_unapproved` (RemainingVariantLivePolicy). The manifest
 * declares exactly that as upgrade 12's one exception (2026-11-14; before, it
 * listed Pineapple in both modes and said nothing). The reference brain still
 * decides there, legally, with 01, 02, 06 and 07.
 *
 * 2026-11-14: this law found two places where the manifest and the brain
 * disagreed (upgrade 02 left FLH and FLO8 out although the scorer runs there;
 * upgrade 12 left FLH out although the pack decides it) and pinned them as
 * facts. The manifest now states what runs, the pins assert the corrected
 * declaration, and HorseUpgradeManifestRuntimeParity.law.test.ts holds the two
 * sides equal in both directions. The harness lives in
 * HorseStyleVariantModeMatrix.test-support.ts, shared with that law.
 *
 * The second block passes each of the six style names to the brain as its
 * style argument. Production never does that for anything but the two mode
 * profiles; it is here to prove no style branch in the brain skips a
 * per-decision upgrade, and that the Hybrid evidence counter stays silent for
 * a decision that did not run the mode's profile.
 *
 * Not asserted here, on purpose: upgrades whose counters depend on what the
 * table offers (03 bomb pots, 04 reservoir build, 05 prewarm, 08 side games,
 * 09 pre-action purge, 10 fast window, 11 indifference pool, 12's PLO8 low
 * read). Their producers have their own tests; a single flop decision is not
 * owed one. They are only checked for mode leakage (a cash-only counter in a
 * tournament decision, and the reverse).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  HORSE_HYBRID_PROFILES,
  horseHybridDecisionMatches,
  resolveHorseHybridProfile,
  type HorseHybridMode,
} from './HorseHybridProfile.js';
import {
  decideThroughWorker,
  MODES,
  startMatrixWorker,
  stopMatrixWorker,
  VARIANTS,
  type CellResult,
  type Variant,
} from './HorseStyleVariantModeMatrix.test-support.js';
import {
  computeHorseUpgradeActivationManifest,
  HORSE_UPGRADE_LIVE_EVIDENCE,
  type HorseUpgradeCapabilityEntry,
} from './HorseUpgradeActivationManifest.js';
import { horseDecisionReceiptIsValid } from './horseDecision/responseValidation.js';
import { HORSE_ASSIGNED_STYLE, RETIRED_HORSE_STYLES, type HorseStyle } from '../types.js';

/** Keyed by the type, so a seventh style cannot be added without a row here. */
const STYLE_ROWS: Record<HorseStyle, true> = {
  hybrid: true,
  tag: true,
  lag: true,
  balanced: true,
  tricky: true,
  grinder: true,
};
const STYLES = Object.keys(STYLE_ROWS) as HorseStyle[];

/** The counter each per-decision upgrade emits on a postflop brain evaluation. */
const PER_DECISION_COUNTER = {
  upgrade_01_range_posteriors: 'upgrade01_action_line_posterior',
  upgrade_02_card_removal_blockers: 'upgrade02_card_removal_scored',
  upgrade_06_public_timing_pacing: 'upgrade06_public_timing_hint',
} as const;
type PerDecisionUpgrade = keyof typeof PER_DECISION_COUNTER;
const PER_DECISION_UPGRADES = Object.keys(PER_DECISION_COUNTER) as PerDecisionUpgrade[];

/** The upgrade 12 variants the Phase 12 remaining-variant pack decides. */
const PHASE12_PACK_VARIANTS: ReadonlySet<Variant> = new Set([
  'flo8',
  'flh',
  'short_deck',
  'pineapple',
]);

const HYBRID_EVIDENCE: Record<HorseHybridMode, string> = {
  cash: 'hybrid_v1_cash_grinder_decided',
  tournament: 'hybrid_v1_tournament_tricky_decided',
};

const MANIFEST = computeHorseUpgradeActivationManifest();
function upgrade(id: string): HorseUpgradeCapabilityEntry {
  const entry = MANIFEST.upgrades.find((u) => u.id === id);
  if (!entry) throw new Error(`manifest has no upgrade ${id}`);
  return entry;
}
const applies = (id: string, variant: Variant, mode: HorseHybridMode) => {
  const entry = upgrade(id);
  return entry.enabled && entry.variants.includes(variant) && entry.modes.includes(mode);
};

/**
 * A counter belongs to an upgrade when it equals a quoted needle or starts
 * with a templated one (HORSE_UPGRADE_LIVE_EVIDENCE's own two forms).
 */
function countersOf(id: string, counted: Record<string, number>): string[] {
  const needles = HORSE_UPGRADE_LIVE_EVIDENCE[id] ?? [];
  return Object.keys(counted).filter((key) =>
    needles.some((needle) =>
      needle.startsWith('`') ? key.startsWith(needle.slice(1)) : key === needle.slice(1, -1)
    )
  );
}

beforeAll(startMatrixWorker);
afterAll(stopMatrixWorker);

/** Everything a cell owes regardless of which style reached the brain. */
function expectProductionDecision(
  label: string,
  variant: Variant,
  mode: HorseHybridMode,
  { decision, counted, flop }: CellResult
) {
  const { spot, controller } = flop;

  // No fallback and no abandon: the brain answered, and the receipt is whole.
  expect(decision.policyFallback, label).toBeUndefined();
  expect(counted.phase15_brain_exception, label).toBeUndefined();
  expect(counted.phase15_policy_unregistered, label).toBeUndefined();
  expect(horseDecisionReceiptIsValid(decision, variant), label).toBe(true);

  // Core entry: the canonical-state worker path ran exactly this one decision
  // and it entered the postflop brain.
  expect(applies('core_action_freedom_and_turn_reliability', variant, mode), label).toBe(true);
  expect(counted.phase5_canonical_state, label).toBe(1);
  expect(counted.decide_postflop, label).toBe(1);

  // Legal on the controller's own menu, and accepted by the controller.
  const menu = spot.state.legalActions ?? [];
  expect(menu, label).toContain(decision.action);
  const wager =
    decision.action === 'call' || decision.amount === undefined
      ? undefined
      : Number(decision.amount);
  if (decision.action === 'bet' || decision.action === 'raise') {
    expect(wager, label).toBeGreaterThanOrEqual(spot.state.minRaiseTo!);
    expect(wager, label).toBeLessThanOrEqual(spot.state.maxRaiseTo!);
  }
  if (mode === 'tournament' && wager !== undefined)
    expect(Number.isInteger(wager), label).toBe(true);
  expect(
    controller.performAction(spot.hero.seat, decision.action, wager),
    `${label} ${JSON.stringify({ action: decision.action, amount: decision.amount, menu })}`
  ).toBe(true);

  // The per-decision upgrades the manifest declares for this variant and mode.
  for (const id of PER_DECISION_UPGRADES) {
    if (applies(id, variant, mode))
      expect(counted[PER_DECISION_COUNTER[id]], `${label} ${id}`).toBe(1);
  }

  // Upgrade 07: a tournament decision with a complete, reconciled context is
  // priced by the tournament utility, every time. No refusal is tolerated:
  // these are single-board spots, where no wall-clock budget applies
  // (independent review of c6e14f0d, finding 2).
  if (applies('upgrade_07_tournament_cover_and_bounty', variant, mode)) {
    const refusals = Object.keys(counted).filter((key) => key.startsWith('phase7_unavailable_'));
    expect(refusals, `${label} upgrade 07`).toEqual([]);
    expect(counted.phase7_tournament_utility, `${label} upgrade 07`).toBe(1);
  }

  // Upgrade 12, where the remaining-variant pack owns the game. (PLO8's
  // share of it is the low-outlook read, which a given flop may not offer.)
  if (PHASE12_PACK_VARIANTS.has(variant)) {
    expect(applies('upgrade_12_specialty_variants', variant, mode), label).toBe(true);
    expect(counted.phase12_seen, `${label} upgrade 12`).toBe(1);
    const receipt = decision.remainingVariantPolicy;
    expect(receipt, `${label} upgrade 12`).toBeDefined();
    if (variant === 'pineapple' && mode === 'tournament') {
      // Unsupported by the engine, for its documented reason, which is the
      // one exception the manifest declares for upgrade 12.
      expect(upgrade('upgrade_12_specialty_variants').exceptions, label).toEqual([
        {
          variant: 'pineapple',
          mode: 'tournament',
          surface: 'RemainingVariantLivePolicy',
          reason: 'pineapple_tournament_unapproved',
        },
      ]);
      expect(receipt?.reason, label).toBe('pineapple_tournament_unapproved');
      expect(receipt?.fired, label).toBe(false);
      expect(counted.phase12_fired, label).toBeUndefined();
      expect(counted.phase12_reason_pineapple_tournament_unapproved, label).toBe(1);
    } else {
      expect(receipt?.fired, `${label} upgrade 12 ${receipt?.reason}`).toBe(true);
      expect(counted.phase12_fired, `${label} upgrade 12`).toBe(1);
    }
  }

  // Mode fences: an upgrade the manifest declares for one mode only is never
  // owed, and never counted, in the other.
  for (const entry of MANIFEST.upgrades) {
    if (!entry.enabled || entry.modes.includes(mode)) continue;
    expect(countersOf(entry.id, counted), `${label} ${entry.id} is ${entry.modes} only`).toEqual(
      []
    );
  }
}

describe('the matrix is the declared one', () => {
  it('covers every style of the type: the assigned style and each retired one', () => {
    expect([...STYLES].sort()).toEqual([HORSE_ASSIGNED_STYLE, ...RETIRED_HORSE_STYLES].sort());
    expect(STYLES).toHaveLength(6);
  });

  it('covers every variant and mode the manifest declares for the core and upgrades 01, 02 and 06', () => {
    for (const id of [
      'core_action_freedom_and_turn_reliability',
      'upgrade_01_range_posteriors',
      'upgrade_02_card_removal_blockers',
      'upgrade_06_public_timing_pacing',
    ]) {
      expect([...upgrade(id).variants].sort(), id).toEqual([...VARIANTS].sort());
      expect([...upgrade(id).modes].sort(), id).toEqual([...MODES].sort());
    }
  });

  it('upgrade 02 is declared for all nine variants: FLH and FLO8 included, so the counter is owed there', () => {
    // Until 2026-11-14 the manifest left FLH and FLO8 out while the scorer ran
    // for them on every postflop decision.
    const declared = upgrade('upgrade_02_card_removal_blockers');
    expect([...declared.variants].sort()).toEqual([...VARIANTS].sort());
    expect([...declared.modes].sort()).toEqual([...MODES].sort());
    expect(declared.exceptions).toBeUndefined();
    for (const mode of MODES) {
      expect(applies('upgrade_02_card_removal_blockers', 'flh', mode)).toBe(true);
      expect(applies('upgrade_02_card_removal_blockers', 'flo8', mode)).toBe(true);
    }
  });

  it('upgrade 12 is declared for PLO8, FLO8, FLH, Short Deck and Pineapple in both modes, with the Pineapple tournament pack refusal as its one exception', () => {
    const declared = upgrade('upgrade_12_specialty_variants');
    expect([...declared.variants].sort()).toEqual([
      'flh',
      'flo8',
      'pineapple',
      'plo8',
      'short_deck',
    ]);
    expect([...declared.modes].sort()).toEqual([...MODES].sort());
    expect(declared.exceptions).toEqual([
      {
        variant: 'pineapple',
        mode: 'tournament',
        surface: 'RemainingVariantLivePolicy',
        reason: 'pineapple_tournament_unapproved',
      },
    ]);
    expect(declared.runtimeSurface.split(',')).toContain('RemainingVariantLivePolicy');
  });

  it('the single-mode upgrades are the ones the mode fences below rely on', () => {
    const singleMode = MANIFEST.upgrades
      .filter((u) => u.enabled && u.modes.length === 1)
      .map((u) => `${u.id}:${u.modes[0]}`)
      .sort();
    expect(singleMode).toEqual([
      'upgrade_03_shared_deck_multiboard:cash',
      'upgrade_07_tournament_cover_and_bounty:tournament',
      'upgrade_08_side_games_integration:cash',
    ]);
    // Each has evidence needles, or its fence would compare against nothing.
    for (const entry of singleMode)
      expect(HORSE_UPGRADE_LIVE_EVIDENCE[entry.split(':')[0]]?.length ?? 0).toBeGreaterThan(0);
  });
});

describe('stored style x variant x mode: the production resolver, then the production worker', () => {
  let cell = 0;
  for (const variant of VARIANTS) {
    for (const mode of MODES) {
      const cellBase = cell;
      cell += STYLES.length;
      it(`${variant} ${mode}: all six stored styles decide legally and count every declared per-decision upgrade`, async () => {
        for (const [offset, stored] of STYLES.entries()) {
          const label = `stored=${stored} ${variant} ${mode}`;
          const profile = { style: stored };

          // The call ServerTableEngineTurns and LightningHorse make.
          const result = await decideThroughWorker(variant, mode, cellBase + offset, (horseId) =>
            resolveHorseHybridProfile(profile, horseId, mode)
          );
          const resolved = { style: result.style, mods: result.mods };
          const expectedStyle = mode === 'cash' ? 'grinder' : 'tricky';
          expect(resolved.style, label).toBe(expectedStyle);
          expect(resolved.style, label).toBe(HORSE_HYBRID_PROFILES[mode].style);
          expect(resolved.mods, label).toMatchObject(HORSE_HYBRID_PROFILES[mode].mods);
          expect(horseHybridDecisionMatches(mode, resolved.style, resolved.mods), label).toBe(true);
          // The stored row is read, never rewritten.
          expect(profile, label).toEqual({ style: stored });

          expectProductionDecision(label, variant, mode, result);

          // Worker evidence: this decision ran the mode's Hybrid profile, and
          // only that mode's.
          const other = mode === 'cash' ? 'tournament' : 'cash';
          expect(result.counted[HYBRID_EVIDENCE[mode]], label).toBe(1);
          expect(result.counted[HYBRID_EVIDENCE[other]], label).toBeUndefined();
          // What the worker was handed is what a Hybrid row hands it: for
          // the same horse, the stored style changes nothing in the request.
          expect(resolved, label).toEqual(
            resolveHorseHybridProfile(
              { style: HORSE_ASSIGNED_STYLE },
              result.flop.spot.hero.user_id,
              mode
            )
          );
        }
      }, 60_000);
    }
  }
});

describe('brain style x variant x mode: no style branch skips a per-decision upgrade', () => {
  let cell = 1000;
  for (const variant of VARIANTS) {
    for (const mode of MODES) {
      const cellBase = cell;
      cell += STYLES.length;
      it(`${variant} ${mode}: each of the six style names, passed to the brain as its style, counts the same upgrades`, async () => {
        // The mode's production dials, so only the style argument varies.
        for (const [offset, style] of STYLES.entries()) {
          const label = `brain=${style} ${variant} ${mode}`;
          const result = await decideThroughWorker(variant, mode, cellBase + offset, (horseId) => ({
            style,
            mods: resolveHorseHybridProfile({ style }, horseId, mode).mods,
          }));
          expectProductionDecision(label, variant, mode, result);

          // The Hybrid evidence counter is honest: it counts only a decision
          // that ran the mode's own profile style.
          const isModeProfile = style === HORSE_HYBRID_PROFILES[mode].style;
          expect(result.counted[HYBRID_EVIDENCE[mode]], label).toBe(isModeProfile ? 1 : undefined);
          expect(
            result.counted[HYBRID_EVIDENCE[mode === 'cash' ? 'tournament' : 'cash']],
            label
          ).toBeUndefined();
        }
      }, 60_000);
    }
  }
});

describe('the upgrades this law requires per decision are switched on', () => {
  // The counter assertions above are conditional on the manifest. If one of
  // these were declared disabled they would go silent, so the declaration
  // itself is pinned (independent review of c6e14f0d, note 6).
  it.each([
    'core_action_freedom_and_turn_reliability',
    'upgrade_01_range_posteriors',
    'upgrade_02_card_removal_blockers',
    'upgrade_06_public_timing_pacing',
    'upgrade_07_tournament_cover_and_bounty',
    'upgrade_12_specialty_variants',
  ])('%s is enabled in the activation manifest', (id) => {
    expect(upgrade(id).enabled).toBe(true);
  });
});
