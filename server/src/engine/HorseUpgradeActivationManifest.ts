import { createHash } from 'node:crypto';
import { resolveReleaseIdentity } from '../releaseIdentity.js';
import { admitHorseFeatureReleaseAuthority } from './HorseFeatureAuthority.js';
import { admitHorseTournamentFlagReleaseAuthority } from './HorseTournamentFlagAuthority.js';
import { admitHorsePhase8GuardAuthority } from './HorseTournamentCatastropheGuardAuthority.js';
import {
  admitHorsePhase8LiveAuthority,
  canonical,
  type HorseAuthorityAdmission,
} from './HorseQualifiedAuthority.js';
import { admitHorsePhase10LiveAuthority } from './HorsePhase10Authority.js';
import { HORSE_PHASE11_VARIANTS, admitHorsePhase11LiveAuthority } from './HorsePhase11Authority.js';
import { HORSE_PHASE12_VARIANTS, admitHorsePhase12LiveAuthority } from './HorsePhase12Authority.js';
import { HORSE_PHASE13_VARIANTS, admitHorsePhase13LiveAuthority } from './HorsePhase13Authority.js';
import {
  CORRECTIVE_DOMAIN_KEYS,
  correctiveDomainKey,
} from '../services/horseCorrectiveReview/domain.js';
import { qualifiedReplayAdmissions } from './horseDecision/replay/qualifiedAuthority.js';
import { isHorseOwnerForcedAuthority } from './HorseOwnerForcedActivation.js';

export const HORSE_UPGRADE_MANIFEST_SCHEMA = 'horse-upgrade-activation-manifest-v1' as const;
export const HORSE_UPGRADE_MANIFEST_VERSION = '2026-11-11.v1' as const;

export interface HorseAuthorityAdmissionSummary {
  status: 'admitted' | 'refused';
  ownerForced: boolean;
  reason: string | null;
}

export interface HorseUpgradeCapabilityEntry {
  id: string;
  title: string;
  enabled: boolean;
  status: 'active' | 'qualified_gate_unselected';
  variants: readonly string[];
  modes: readonly ('cash' | 'tournament')[];
  runtimeSurface: string;
}

export interface HorseUpgradeActivationManifest {
  schema: typeof HORSE_UPGRADE_MANIFEST_SCHEMA;
  version: typeof HORSE_UPGRADE_MANIFEST_VERSION;
  sourceRevision: string | null;
  engineVersion: string;
  manifestDigest: string;
  generatedAt: string;
  authorities: {
    features: HorseAuthorityAdmissionSummary;
    tournamentFlags: {
      status: 'admitted' | 'refused';
      cards: readonly string[];
      reason: string | null;
    };
    phase8Guard: HorseAuthorityAdmissionSummary;
    phase8: HorseAuthorityAdmissionSummary;
    phase10: HorseAuthorityAdmissionSummary;
    phase11: Record<string, HorseAuthorityAdmissionSummary>;
    phase12: Record<string, HorseAuthorityAdmissionSummary>;
    phase13: Record<string, HorseAuthorityAdmissionSummary>;
    phase14: Record<string, { status: string; mode: string }>;
  };
  upgrades: readonly HorseUpgradeCapabilityEntry[];
}

const ALL_VARIANTS = [
  'nlh',
  'plo4',
  'plo5',
  'plo6',
  'plo8',
  'flo8',
  'flh',
  'short_deck',
  'pineapple',
] as const;

const PRIMARY_VARIANTS = ['nlh', 'plo4', 'plo5', 'plo6'] as const;
const BOTH_MODES = ['cash', 'tournament'] as const;

/**
 * LIVE EVIDENCE FOR EVERY ENABLED UPGRADE (2026-11-12).
 *
 * An entry below says "enabled"; this says where the running engine counts it.
 * Each needle is the source text of a counter emitted on the upgrade's own
 * path (a brain fire, flushed to horse_brain_flush_receipts with the release
 * that produced it, or a /metrics watchcounter). A needle that opens with a
 * backtick is the fixed prefix of a templated counter name.
 * HorseUpgradeLiveEvidence.law.test.ts fails the build
 * when an enabled upgrade has no needle, or a needle no longer appears in any
 * non-test engine source, so "declared but unprovable" cannot return.
 *
 * This is not part of the manifest digest and gates nothing at runtime. A
 * counter proves a path executed for the fleet; it carries no Horse identity
 * and is not evidence that any particular Horse exercised the upgrade.
 */
export const HORSE_UPGRADE_LIVE_EVIDENCE: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    core_action_freedom_and_turn_reliability: ["'phase5_canonical_state'", "'commit_evaluated'"],
    upgrade_01_range_posteriors: ["'upgrade01_action_line_posterior'"],
    upgrade_02_card_removal_blockers: ["'upgrade02_card_removal_scored'"],
    upgrade_03_shared_deck_multiboard: ["'v36_bomb_multiboard'"],
    upgrade_04_plo5_plo6_reservoir: ['`upgrade04_omaha_reservoir_built_'],
    upgrade_05_street_prewarming: ["'poker_horse_street_prewarm_total'"],
    upgrade_06_public_timing_pacing: ["'upgrade06_public_timing_hint'"],
    upgrade_07_tournament_cover_and_bounty: [
      "'phase7_tournament_utility'",
      "'phase7_bounty_utility'",
    ],
    upgrade_08_side_games_integration: [
      '`upgrade08_rit_chooser_',
      '`upgrade08_rit_answer_',
      "'upgrade08_insurance_decline'",
      "'upgrade08_insurance_accept'",
      "'upgrade08_insurance_cashout'",
      "'upgrade08_kill_pot_decision'",
      "'upgrade08_seven_deuce_decision'",
    ],
    upgrade_09_preaction_purge: [
      "'upgrade09_preaction_purged_table'",
      "'upgrade09_preaction_purged_lightning'",
    ],
    upgrade_10_fast_recency_gear_shift: [
      "'upgrade10_fast_window_engaged'",
      "'upgrade10_gear_shift_engaged'",
    ],
    upgrade_11_persona_indifference_mixing: [
      "'upgrade11_indifference_pool'",
      "'upgrade11_indifference_mixed_pick'",
      "'upgrade11_indifference_call_band'",
    ],
    upgrade_12_specialty_variants: ['`phase12_', "'plo8_low_outlook_read'"],
    upgrade_13_law_gate_and_watchcounters: ["'poker_horse_telemetry_opportunities_total'"],
  });

/** The ids of the manifest's enabled upgrades (the ones that owe live evidence). */
export function enabledHorseUpgradeIds(): readonly string[] {
  return UPGRADE_ENTRIES.filter((entry) => entry.enabled).map((entry) => entry.id);
}

function summarizeAdmission(admission: HorseAuthorityAdmission): HorseAuthorityAdmissionSummary {
  if (admission.status === 'admitted') {
    return {
      status: 'admitted',
      ownerForced: isHorseOwnerForcedAuthority(admission.authority),
      reason: null,
    };
  }
  return {
    status: 'refused',
    ownerForced: false,
    reason: admission.reason,
  };
}

function sha256Canonical(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}

const UPGRADE_ENTRIES: readonly HorseUpgradeCapabilityEntry[] = Object.freeze([
  {
    id: 'core_action_freedom_and_turn_reliability',
    title:
      'Core Action-Space Unblocking, Authoritative Legalizer, Receipt Supersession & Turn Recovery',
    enabled: true,
    status: 'active',
    variants: ALL_VARIANTS,
    modes: BOTH_MODES,
    runtimeSurface:
      'HorsePreflop,HorseHandClasses,HorseLogic,ServerTableEngineTurns,responseValidation,workerRuntime',
  },
  {
    id: 'upgrade_01_range_posteriors',
    title: 'Public-Action-Based Street-By-Street Opponent Range Posteriors',
    enabled: true,
    status: 'active',
    variants: ALL_VARIANTS,
    modes: BOTH_MODES,
    runtimeSurface: 'HorseActionLinePosterior,HorseEval,HorseLogic',
  },
  {
    id: 'upgrade_02_card_removal_blockers',
    title: 'Combinatorial Blocker & Unblocker Card-Removal Scoring',
    enabled: true,
    status: 'active',
    variants: ['nlh', 'plo4', 'plo5', 'plo6', 'plo8', 'short_deck', 'pineapple'],
    modes: BOTH_MODES,
    runtimeSurface: 'HorseCardRemovalScorer,HorseEvEngine,HorseLogic',
  },
  {
    id: 'upgrade_03_shared_deck_multiboard',
    title: 'Correlated Shared-Deck Multi-Board Bomb-Pot Scoop/Quarter Pricing',
    enabled: true,
    status: 'active',
    variants: ['nlh', 'plo4', 'plo5', 'plo6', 'plo8', 'pineapple'],
    modes: ['cash'],
    runtimeSurface: 'HorseEval.simulateCorrelatedMultiBoardEquity,HorseLogic',
  },
  {
    id: 'upgrade_04_plo5_plo6_reservoir',
    title: 'Compact Stratified Reservoir & Board-Triple Precomputation For PLO4/PLO5/PLO6/PLO8',
    enabled: true,
    status: 'active',
    variants: ['plo4', 'plo5', 'plo6', 'plo8', 'flo8'],
    modes: BOTH_MODES,
    runtimeSurface: 'HorseEval.getOmahaReservoir,HorseEval.precomputeBoardTriples',
  },
  {
    id: 'upgrade_05_street_prewarming',
    title: 'Idle-Only Worker Street Board/Texture/V31 Prewarming',
    enabled: true,
    status: 'active',
    variants: ALL_VARIANTS,
    modes: BOTH_MODES,
    runtimeSurface:
      'ServerTableEngineHandEvents,client.prewarmStreet,workerRuntime.executeStreetPrewarm,GtoPostflop',
  },
  {
    id: 'upgrade_06_public_timing_pacing',
    title: 'Public-Complexity-Coupled Anti-Timing-Tell Pacing',
    enabled: true,
    status: 'active',
    variants: ALL_VARIANTS,
    modes: BOTH_MODES,
    runtimeSurface: 'HorseLogic.publicSpotComplexity,ServerTableEngineTurns',
  },
  {
    id: 'upgrade_07_tournament_cover_and_bounty',
    title: 'Asymmetric Cover ICM Pressure, Bounty Chip-Equivalence & Satellite Cliff Pricing',
    enabled: true,
    status: 'active',
    variants: ALL_VARIANTS,
    modes: ['tournament'],
    runtimeSurface: 'IcmModel,HorseTournamentUtility,HorseLogic',
  },
  {
    id: 'upgrade_08_side_games_integration',
    title: 'Run It Twice, All-In Insurance EV Gate, Seven-Deuce Overlay & Kill-Pot Geometry',
    enabled: true,
    status: 'active',
    variants: ALL_VARIANTS,
    modes: ['cash'],
    runtimeSurface:
      'ServerTableEngineRunout,HorseSideGameOverlay,HorsePreflopOrbitState,HorseEvEngine,LightningHorse',
  },
  {
    id: 'upgrade_09_preaction_purge',
    title: 'Horse-Owned Pre-Action Purge Across Ring, Tournament & Lightning Hosts',
    enabled: true,
    status: 'active',
    variants: ALL_VARIANTS,
    modes: BOTH_MODES,
    runtimeSurface: 'ServerTableEngineTurns,LightningHandHost',
  },
  {
    id: 'upgrade_10_fast_recency_gear_shift',
    title: 'Intra-Session Exponential Recency Opponent Gear-Shift Adaptation',
    enabled: true,
    status: 'active',
    variants: ALL_VARIANTS,
    modes: BOTH_MODES,
    runtimeSurface: 'HorseOpponentExploit,HorseScopedOpponentModel',
  },
  {
    id: 'upgrade_11_persona_indifference_mixing',
    title: 'Context-Scaled EV-Bounded Persona Indifference Mixing Across 1,000 Horses',
    enabled: true,
    status: 'active',
    variants: ALL_VARIANTS,
    modes: BOTH_MODES,
    runtimeSurface: 'HorseHybridProfile,HorsePersona,HorseEvEngine,HorseLogic',
  },
  {
    id: 'upgrade_12_specialty_variants',
    title: 'PLO8/FLO8 Scoop-Freeroll, Short Deck Rank/Equity & Pineapple Discard Parity',
    enabled: true,
    status: 'active',
    variants: ['plo8', 'flo8', 'short_deck', 'pineapple'],
    modes: BOTH_MODES,
    runtimeSurface: 'HorseEval,HorseLogic,ServerTableEngineRunout',
  },
  {
    id: 'upgrade_13_law_gate_and_watchcounters',
    title: 'Permanent Action-Space Freedom CI Law Suite & Closed-Label Watchcounters',
    enabled: true,
    status: 'active',
    variants: ALL_VARIANTS,
    modes: BOTH_MODES,
    runtimeSurface: 'BrainTelemetry,engineInstruments,GameServer,HorseUpgradeActivationManifest',
  },
  {
    id: 'heldout_cash_feature_ablation_pack',
    title: 'Held-Out Cash Feature Ablation Pack (Remains Fail-Closed Until Qualified)',
    enabled: false,
    status: 'qualified_gate_unselected',
    variants: PRIMARY_VARIANTS,
    modes: ['cash'],
    runtimeSurface: 'HorseFeatureAuthority.admitHorseFeatureReleaseAuthority',
  },
  {
    id: 'heldout_plo_v53_tournament_flag_cards',
    title: 'Held-Out PLO V53 Tournament Flag Cards (Remains Fail-Closed Until Qualified)',
    enabled: false,
    status: 'qualified_gate_unselected',
    variants: ['plo4', 'plo5', 'plo6'],
    modes: ['tournament'],
    runtimeSurface: 'HorseTournamentFlagAuthority.admitHorseTournamentFlagReleaseAuthority',
  },
]);

export function computeHorseUpgradeActivationManifest(): HorseUpgradeActivationManifest {
  const identity = resolveReleaseIdentity();
  const tourneyFlags = admitHorseTournamentFlagReleaseAuthority();
  const authorities: HorseUpgradeActivationManifest['authorities'] = {
    features: summarizeAdmission(admitHorseFeatureReleaseAuthority()),
    tournamentFlags:
      tourneyFlags.status === 'admitted'
        ? { status: 'admitted', cards: [...tourneyFlags.cards], reason: null }
        : { status: 'refused', cards: [], reason: tourneyFlags.reason },
    phase8Guard: summarizeAdmission(admitHorsePhase8GuardAuthority()),
    phase8: summarizeAdmission(admitHorsePhase8LiveAuthority()),
    phase10: summarizeAdmission(admitHorsePhase10LiveAuthority()),
    phase11: Object.fromEntries(
      HORSE_PHASE11_VARIANTS.map((v) => [v, summarizeAdmission(admitHorsePhase11LiveAuthority(v))])
    ),
    phase12: Object.fromEntries(
      HORSE_PHASE12_VARIANTS.map((v) => [v, summarizeAdmission(admitHorsePhase12LiveAuthority(v))])
    ),
    phase13: Object.fromEntries(
      HORSE_PHASE13_VARIANTS.map((v) => [v, summarizeAdmission(admitHorsePhase13LiveAuthority(v))])
    ),
    phase14: Object.fromEntries(
      CORRECTIVE_DOMAIN_KEYS.map((domain) => {
        const attachment = qualifiedReplayAdmissions.admitPhase14Attachment(domain);
        // The domain key is variant-format (nlh-mtt), the key the worker's
        // own gate compares (horsePhase14CorrectiveMode). Built from the
        // catalog's mode instead it read nlh-tournament, which names no
        // domain, so every tournament domain reported off even where its
        // admitted catalog was the one the worker gate selects.
        const packDomain = attachment.catalog
          ? correctiveDomainKey(attachment.catalog.domain)
          : null;
        const activeCandidate =
          attachment.admission.status === 'admitted' &&
          attachment.catalog !== null &&
          packDomain === domain;
        return [
          domain,
          {
            status: attachment.admission.status,
            mode: activeCandidate ? 'candidate' : 'off',
          },
        ];
      })
    ),
  };

  const digestPayload = {
    schema: HORSE_UPGRADE_MANIFEST_SCHEMA,
    version: HORSE_UPGRADE_MANIFEST_VERSION,
    sourceRevision: identity.releaseSha,
    engineVersion: identity.version,
    authorities,
    upgrades: UPGRADE_ENTRIES,
  };

  return {
    ...digestPayload,
    manifestDigest: sha256Canonical(digestPayload),
    generatedAt: new Date().toISOString(),
  };
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

export function isValidHorseUpgradeActivationManifest(
  value: unknown
): value is HorseUpgradeActivationManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.schema === HORSE_UPGRADE_MANIFEST_SCHEMA &&
    typeof candidate.version === 'string' &&
    candidate.version.length > 0 &&
    (candidate.sourceRevision === null || typeof candidate.sourceRevision === 'string') &&
    typeof candidate.engineVersion === 'string' &&
    typeof candidate.manifestDigest === 'string' &&
    SHA256_HEX.test(candidate.manifestDigest) &&
    typeof candidate.generatedAt === 'string' &&
    Boolean(candidate.authorities && typeof candidate.authorities === 'object') &&
    Array.isArray(candidate.upgrades) &&
    candidate.upgrades.length >= 14
  );
}

export function verifyWorkerUpgradeManifestCompatibility(
  expected: HorseUpgradeActivationManifest,
  workerManifest: unknown
): { compatible: true } | { compatible: false; reason: string } {
  if (workerManifest == null) {
    return { compatible: false, reason: 'worker_manifest_missing' };
  }
  if (!isValidHorseUpgradeActivationManifest(workerManifest)) {
    return { compatible: false, reason: 'worker_manifest_invalid' };
  }
  if (workerManifest.version !== expected.version) {
    return { compatible: false, reason: 'worker_manifest_version_mismatch' };
  }
  if (workerManifest.manifestDigest !== expected.manifestDigest) {
    return { compatible: false, reason: 'worker_manifest_digest_mismatch' };
  }
  return { compatible: true };
}
