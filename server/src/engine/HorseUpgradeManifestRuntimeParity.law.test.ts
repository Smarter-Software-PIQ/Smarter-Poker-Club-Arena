/**
 * LAW: THE UPGRADE ACTIVATION MANIFEST DECLARES EXACTLY WHAT A DECISION RUNS
 * (2026-11-14).
 *
 * The manifest (HorseUpgradeActivationManifest) is published on the engine's
 * /health and compared between host and decision workers. It says, per
 * upgrade, in which variants and modes the upgrade runs. On 2026-11-13 the
 * style matrix law found it wrong in both directions and could only pin the
 * errors: upgrade 02 left FLH and FLO8 out although the card-removal scorer
 * ran on every postflop decision there; upgrade 12 listed Pineapple
 * tournaments although the remaining-variant pack refuses them, and left FLH
 * out although the pack decides it. That law checks one direction only (a
 * declared counter must fire), so an undeclared execution passes it.
 *
 * What this drives. One real flop decision per variant and mode, eighteen
 * cells, through the production path (HandController state, the production
 * style resolver, HorseDecisionWorkerRuntime DECIDE_FAST, production telemetry
 * wiring; the harness of HorseStyleVariantModeMatrix.test-support.ts). For
 * every upgrade whose evidence counter fires once per postflop decision, the
 * table "the counter fired" must EQUAL the table "the manifest declares the
 * cell":
 *   01 range posteriors, 02 card removal, 06 public timing, 07 tournament
 *   utility, and 12 for the four games the remaining-variant pack decides
 *   (consulted = declared; decided = declared and not a declared exception).
 * Widening or narrowing either side, the brain or the declaration, fails here.
 *
 * Not held to parity here, on purpose, and pinned so a new upgrade cannot
 * join silently: upgrades whose counters depend on what the table offers
 * (03, 04, 05, 08, 09, 10, 11, 13 and 12's PLO8 low-outlook read), and the
 * core entry, which the style matrix law asserts in every cell.
 *
 * Limits. A counter proves the upgrade's code path executed for the decision,
 * not that it changed the action. One heads-up flop spot per cell: a variant
 * condition that only bites on later streets or multiway is not seen.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveHorseHybridProfile, type HorseHybridMode } from './HorseHybridProfile.js';
import { HORSE_PHASE12_VARIANTS } from './HorsePhase12Authority.js';
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
import { HORSE_ASSIGNED_STYLE } from '../types.js';

/** The counter each of these upgrades emits once on every postflop decision it runs for. */
const PER_DECISION_COUNTER = {
  upgrade_01_range_posteriors: 'upgrade01_action_line_posterior',
  upgrade_02_card_removal_blockers: 'upgrade02_card_removal_scored',
  upgrade_06_public_timing_pacing: 'upgrade06_public_timing_hint',
  upgrade_07_tournament_cover_and_bounty: 'phase7_tournament_utility',
} as const;
const UPGRADE_12 = 'upgrade_12_specialty_variants';
const PACK_SURFACE = 'RemainingVariantLivePolicy';

/** Enabled entries this law does not hold to parity, each with its reason. */
const NOT_PER_DECISION: Record<string, string> = {
  core_action_freedom_and_turn_reliability: 'asserted in every cell by the style matrix law',
  upgrade_03_shared_deck_multiboard: 'needs a multi-board bomb pot',
  upgrade_04_plo5_plo6_reservoir: 'counts a reservoir build, once per process and shape',
  upgrade_05_street_prewarming: 'counts an idle prewarm, not a decision',
  upgrade_08_side_games_integration: 'needs a side game on offer',
  upgrade_09_preaction_purge: 'needs a stale pre-action',
  upgrade_10_fast_recency_gear_shift: 'needs an observed opponent window',
  upgrade_11_persona_indifference_mixing: 'needs a near-indifferent candidate pool',
  upgrade_13_law_gate_and_watchcounters: 'a /metrics watchcounter, not a brain fire',
};

const MANIFEST = computeHorseUpgradeActivationManifest();
function upgrade(id: string): HorseUpgradeCapabilityEntry {
  const entry = MANIFEST.upgrades.find((u) => u.id === id);
  if (!entry) throw new Error(`manifest has no upgrade ${id}`);
  return entry;
}

type CellKey = `${Variant} ${HorseHybridMode}`;
const CELLS = VARIANTS.flatMap((variant) => MODES.map((mode) => ({ variant, mode })));
const keyOf = (variant: Variant, mode: HorseHybridMode): CellKey => `${variant} ${mode}`;
type Table = Record<string, boolean>;
const table = (cellValue: (variant: Variant, mode: HorseHybridMode) => boolean): Table =>
  Object.fromEntries(
    CELLS.map(({ variant, mode }) => [keyOf(variant, mode), cellValue(variant, mode)])
  );

/** The manifest's own statement: the entry is on and lists the variant and the mode. */
const declares = (id: string, variant: Variant, mode: HorseHybridMode): boolean => {
  const entry = upgrade(id);
  return entry.enabled && entry.variants.includes(variant) && entry.modes.includes(mode);
};
const excepted = (id: string, variant: Variant, mode: HorseHybridMode, surface: string): boolean =>
  (upgrade(id).exceptions ?? []).some(
    (e) => e.variant === variant && e.mode === mode && e.surface === surface
  );

const PACK_VARIANTS: ReadonlySet<string> = new Set(HORSE_PHASE12_VARIANTS);

const measured = new Map<CellKey, CellResult>();
const cellOf = (variant: Variant, mode: HorseHybridMode): CellResult => {
  const result = measured.get(keyOf(variant, mode));
  if (!result) throw new Error(`${variant} ${mode}: no decision was measured`);
  return result;
};
const fired = (counter: string) =>
  table((variant, mode) => (cellOf(variant, mode).counted[counter] ?? 0) > 0);

beforeAll(async () => {
  await startMatrixWorker();
  let cell = 3000;
  for (const { variant, mode } of CELLS) {
    // A Hybrid row through the resolver ServerTableEngineTurns and
    // LightningHorse call: what every one of the 1,000 Horses runs.
    const result = await decideThroughWorker(variant, mode, cell++, (horseId) =>
      resolveHorseHybridProfile({ style: HORSE_ASSIGNED_STYLE }, horseId, mode)
    );
    measured.set(keyOf(variant, mode), result);
  }
}, 240_000);

afterAll(stopMatrixWorker);

describe('the measurement is a real decision in every cell', () => {
  it('measures all nine variants in both modes: eighteen cells', () => {
    expect(measured.size).toBe(18);
    expect([...measured.keys()].sort()).toEqual(CELLS.map((c) => keyOf(c.variant, c.mode)).sort());
  });

  it.each(CELLS)('$variant $mode: the brain answered once, postflop, with no fallback', (c) => {
    const { decision, counted } = cellOf(c.variant, c.mode);
    expect(decision.policyFallback).toBeUndefined();
    expect(counted.phase15_brain_exception).toBeUndefined();
    expect(counted.phase5_canonical_state).toBe(1);
    expect(counted.decide_postflop).toBe(1);
  });
});

describe('every enabled upgrade is either held to parity here or named as table-dependent', () => {
  it('classifies each enabled manifest entry exactly once', () => {
    const enabled = MANIFEST.upgrades.filter((u) => u.enabled).map((u) => u.id);
    const classified = [
      ...Object.keys(PER_DECISION_COUNTER),
      UPGRADE_12,
      ...Object.keys(NOT_PER_DECISION),
    ];
    expect(new Set(classified).size).toBe(classified.length);
    expect([...classified].sort()).toEqual([...enabled].sort());
  });

  it('measures each upgrade by a counter the manifest itself names as its live evidence', () => {
    const needles = (id: string) => HORSE_UPGRADE_LIVE_EVIDENCE[id] ?? [];
    for (const [id, counter] of Object.entries(PER_DECISION_COUNTER))
      expect(needles(id), id).toContain(`'${counter}'`);
    expect(needles(UPGRADE_12)).toEqual(
      expect.arrayContaining(["'phase12_seen'", "'phase12_fired'"])
    );
  });
});

describe('fired equals declared, both directions, in all eighteen cells', () => {
  it.each(Object.entries(PER_DECISION_COUNTER))(
    '%s: %s fires exactly where the manifest declares the upgrade',
    (id, counter) => {
      // A cell on the left only is an execution the manifest does not
      // declare; a cell on the right only is a declaration nothing runs.
      expect(fired(counter)).toEqual(table((variant, mode) => declares(id, variant, mode)));
      for (const { variant, mode } of CELLS)
        expect([undefined, 1], `${variant} ${mode}`).toContain(
          cellOf(variant, mode).counted[counter]
        );
    }
  );

  it('upgrade 07 is the tournament utility: declared and fired in every tournament cell, in no cash cell', () => {
    // Fixes the meaning of the table above, so two equal empty tables
    // cannot pass it.
    expect(fired(PER_DECISION_COUNTER.upgrade_07_tournament_cover_and_bounty)).toEqual(
      table((_variant, mode) => mode === 'tournament')
    );
  });

  it('upgrades 01, 02 and 06 fire in every one of the eighteen cells', () => {
    for (const id of [
      'upgrade_01_range_posteriors',
      'upgrade_02_card_removal_blockers',
      'upgrade_06_public_timing_pacing',
    ] as const)
      expect(fired(PER_DECISION_COUNTER[id]), id).toEqual(table(() => true));
  });
});

describe('upgrade 12: the remaining-variant pack runs exactly where the manifest says', () => {
  it('the pack is consulted (phase12_seen) in exactly the declared cells of the games it decides', () => {
    expect(fired('phase12_seen')).toEqual(
      table((variant, mode) => PACK_VARIANTS.has(variant) && declares(UPGRADE_12, variant, mode))
    );
  });

  it('the pack decides (phase12_fired) in exactly the declared cells that carry no declared pack exception', () => {
    expect(fired('phase12_fired')).toEqual(
      table(
        (variant, mode) =>
          PACK_VARIANTS.has(variant) &&
          declares(UPGRADE_12, variant, mode) &&
          !excepted(UPGRADE_12, variant, mode, PACK_SURFACE)
      )
    );
  });

  it('every game the pack decides is declared, and the only declared game outside the pack is PLO8', () => {
    const declared = upgrade(UPGRADE_12).variants;
    expect([...PACK_VARIANTS].filter((v) => !declared.includes(v))).toEqual([]);
    expect(declared.filter((v) => !PACK_VARIANTS.has(v))).toEqual(['plo8']);
    // PLO8's share is the low-outlook read, which a given flop may not offer.
    expect(HORSE_UPGRADE_LIVE_EVIDENCE[UPGRADE_12]).toContain("'plo8_low_outlook_read'");
  });

  it('each declared exception is the refusal the pack records for that cell, by name', () => {
    const exceptions = upgrade(UPGRADE_12).exceptions ?? [];
    expect(exceptions).toEqual([
      {
        variant: 'pineapple',
        mode: 'tournament',
        surface: PACK_SURFACE,
        reason: 'pineapple_tournament_unapproved',
      },
    ]);
    for (const e of exceptions) {
      const { decision, counted } = cellOf(e.variant as Variant, e.mode);
      expect(decision.remainingVariantPolicy?.reason).toBe(e.reason);
      expect(decision.remainingVariantPolicy?.fired).toBe(false);
      expect(counted[`phase12_reason_${e.reason}`]).toBe(1);
    }
  });

  it('a pack refusal by cell is never undeclared: every consulted cell that did not decide is an exception', () => {
    for (const { variant, mode } of CELLS) {
      const { counted, decision } = cellOf(variant, mode);
      if (!counted.phase12_seen || counted.phase12_fired) continue;
      expect(
        excepted(UPGRADE_12, variant, mode, PACK_SURFACE),
        `${variant} ${mode}: ${decision.remainingVariantPolicy?.reason}`
      ).toBe(true);
    }
  });
});

describe('a declared exception is well formed, and only upgrade 12 carries one', () => {
  it('lies inside its entry, names a member of the runtime surface and a reason', () => {
    for (const entry of MANIFEST.upgrades) {
      if (entry.exceptions === undefined) continue;
      expect(entry.exceptions.length, entry.id).toBeGreaterThan(0);
      for (const e of entry.exceptions) {
        expect(entry.variants, entry.id).toContain(e.variant);
        expect(entry.modes, entry.id).toContain(e.mode);
        expect(entry.runtimeSurface.split(','), entry.id).toContain(e.surface);
        expect(e.reason, entry.id).toMatch(/^[a-z0-9_]+$/);
      }
    }
  });

  it('no other upgrade declares one: an exception this law cannot measure is not accepted', () => {
    expect(MANIFEST.upgrades.filter((u) => u.exceptions !== undefined).map((u) => u.id)).toEqual([
      UPGRADE_12,
    ]);
  });
});
