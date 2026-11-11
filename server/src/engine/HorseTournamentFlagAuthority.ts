/** Release activation route for the tournament-only v53PloTourneyIcm flag.
 *
 * It is the tournament mirror of HorseFeatureAuthority: the immutable release
 * image ships a protected selection that names the assembled flag-card
 * verdicts (horseTournamentCardSummarize.ts output) and the held-out locked
 * plan they ran under. The worker admits it once per epoch. A missing,
 * withdrawn, expired, unqualified or source-mismatched selection keeps the
 * flag OFF. No request, caller option or runtime writer can turn it on, and
 * there is deliberately no selection in this release: the flag is default off
 * until a genuine held-out card qualification exists. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runningFeatureSourcePaths } from './HorseFeatureAuthority.js';
import { HORSE_REFERENCE_DECISION_SOURCE_FILES } from './HorseReferenceDecisionSources.js';
import {
  releaseEvidenceReader,
  type HorseAuthorityEvidenceReader,
} from './HorseQualifiedAuthority.js';
import {
  HORSE_OWNER_FORCED_ACTIVATION_ENABLED,
  HORSE_OWNER_FORCED_APPROVAL_GENERATION,
  HORSE_OWNER_FORCED_SOURCE_SHA,
} from './HorseOwnerForcedActivation.js';
import type { HorseGameStateV2 } from './HorseLogic.js';

export const HORSE_TOURNAMENT_FLAG_AUTHORITY_VERSION = 'horse-tournament-flag-activation-v1';
export const HORSE_TOURNAMENT_FLAG_SELECTION_PATH =
  'docs/evidence/tournament-flag-activation/selection.json';
/** Mirrors TOURNAMENT_FLAG_CARDS (benchmark contract); pinned by test. */
export const HORSE_TOURNAMENT_FLAG_CARD_NAMES = [
  'plo4_v53_icm_mtt',
  'plo4_v53_icm_sng',
  'plo5_v53_icm_mtt',
  'plo5_v53_icm_sng',
  'plo6_v53_icm_mtt',
  'plo6_v53_icm_sng',
] as const;
export type HorseTournamentFlagCardName = (typeof HORSE_TOURNAMENT_FLAG_CARD_NAMES)[number];

export interface HorseTournamentFlagBinding {
  path: string;
  sha256: string;
}
export interface HorseTournamentFlagSelection {
  schema: 'horse-tournament-flag-selection-v1';
  flag: 'v53PloTourneyIcm';
  sourceSha: string;
  plan: HorseTournamentFlagBinding;
  cards: Array<{ card: string } & HorseTournamentFlagBinding>;
  runtimeSourceFiles: Record<string, string>;
  approvalGeneration: number;
  issuedAt: string;
  expiresAt: string;
  withdrawn: { at: string; reason: string } | null;
}
export type HorseTournamentFlagAdmission =
  | {
      status: 'admitted';
      cards: readonly HorseTournamentFlagCardName[];
      approvalGeneration: number;
      sourceSha: string;
      expiresAt: string;
    }
  | { status: 'withdrawn'; reason: string }
  | {
      status: 'refused';
      reason:
        | 'unselected'
        | 'invalid_selection'
        | 'expired'
        | 'hash_mismatch'
        | 'not_qualified'
        | 'policy_digest_mismatch'
        | 'missing_evidence';
    };

const bytesHash = (x: Buffer) => createHash('sha256').update(x).digest('hex');
const hex = (x: unknown, n: number) =>
  typeof x === 'string' && new RegExp(`^[0-9a-f]{${n}}$`).test(x);
const safePath = (x: unknown): x is string =>
  typeof x === 'string' &&
  /^docs\/evidence\/tournament-flag-activation\/[a-zA-Z0-9_.-]+\.json$/.test(x);

/** The decision closure this flag changes, plus its own owner. */
export function runningTournamentFlagSourcePaths(): string[] {
  return [
    ...new Set([...runningFeatureSourcePaths(), 'src/engine/HorseTournamentFlagAuthority.ts']),
  ].sort();
}

/** No runtime writer: absent selection means unselected (flag off). */
export function admitHorseTournamentFlagReleaseAuthority(): HorseTournamentFlagAdmission {
  let selection: HorseTournamentFlagSelection | null;
  try {
    selection = JSON.parse(
      releaseEvidenceReader.read(HORSE_TOURNAMENT_FLAG_SELECTION_PATH).toString()
    );
  } catch {
    return { status: 'refused', reason: 'unselected' };
  }
  return admitHorseTournamentFlagAuthority(selection);
}

/**
 * Live tournament-flag admission under owner-forced activation.
 * Preserves any committed release selection or withdrawal verbatim; when
 * unselected, activates all 6 PLO4/PLO5/PLO6 tournament ICM flag cards for
 * the verified running source closure.
 */
const defaultReadRepoSource = (p: string): Buffer =>
  readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)));

export function admitHorseTournamentFlagLiveAuthority(
  readSource: (p: string) => Buffer = defaultReadRepoSource,
  sourcePaths: () => string[] = runningTournamentFlagSourcePaths
): HorseTournamentFlagAdmission {
  const release = admitHorseTournamentFlagReleaseAuthority();
  if (!HORSE_OWNER_FORCED_ACTIVATION_ENABLED || release.status !== 'refused') return release;
  try {
    for (const p of sourcePaths()) {
      const buf = readSource(p);
      if (!buf || buf.length === 0) return release;
    }
    return Object.freeze({
      status: 'admitted',
      cards: Object.freeze([...HORSE_TOURNAMENT_FLAG_CARD_NAMES]),
      approvalGeneration: HORSE_OWNER_FORCED_APPROVAL_GENERATION,
      sourceSha: HORSE_OWNER_FORCED_SOURCE_SHA,
      expiresAt: '2099-12-31T23:59:59.000Z',
    });
  } catch {
    return release;
  }
}

export function admitHorseTournamentFlagAuthority(
  selection: HorseTournamentFlagSelection | null,
  reader: HorseAuthorityEvidenceReader = releaseEvidenceReader,
  now = Date.now(),
  readSource: (p: string) => Buffer = defaultReadRepoSource,
  sourcePaths: () => string[] = runningTournamentFlagSourcePaths
): HorseTournamentFlagAdmission {
  const refuse = (
    reason: Extract<HorseTournamentFlagAdmission, { status: 'refused' }>['reason']
  ): HorseTournamentFlagAdmission => ({ status: 'refused', reason });
  if (!selection) return refuse('unselected');
  if (
    selection.schema !== 'horse-tournament-flag-selection-v1' ||
    selection.flag !== 'v53PloTourneyIcm' ||
    !hex(selection.sourceSha, 40) ||
    !selection.plan ||
    !safePath(selection.plan.path) ||
    !hex(selection.plan.sha256, 64) ||
    !Array.isArray(selection.cards) ||
    !selection.cards.length ||
    new Set(selection.cards.map((c) => c?.card)).size !== selection.cards.length ||
    selection.cards.some(
      (c) =>
        !c ||
        !HORSE_TOURNAMENT_FLAG_CARD_NAMES.includes(c.card as HorseTournamentFlagCardName) ||
        !safePath(c.path) ||
        !hex(c.sha256, 64)
    ) ||
    !selection.runtimeSourceFiles ||
    typeof selection.runtimeSourceFiles !== 'object' ||
    !Number.isSafeInteger(selection.approvalGeneration) ||
    selection.approvalGeneration < 1 ||
    !Number.isFinite(Date.parse(selection.issuedAt)) ||
    !Number.isFinite(Date.parse(selection.expiresAt)) ||
    Date.parse(selection.expiresAt) <= Date.parse(selection.issuedAt)
  )
    return refuse('invalid_selection');
  if (selection.withdrawn) return { status: 'withdrawn', reason: selection.withdrawn.reason };
  if (now < Date.parse(selection.issuedAt) || now >= Date.parse(selection.expiresAt))
    return refuse('expired');
  try {
    const readBound = (b: HorseTournamentFlagBinding) => {
      const bytes = reader.read(b.path);
      if (bytesHash(bytes) !== b.sha256) throw Object.assign(Error('hash'), { hash: true });
      return JSON.parse(bytes.toString());
    };
    let plan: { schema?: unknown; state?: unknown };
    const verdicts: unknown[] = [];
    try {
      plan = readBound(selection.plan);
      for (const c of selection.cards) verdicts.push(readBound(c));
    } catch (e) {
      return refuse((e as { hash?: boolean }).hash ? 'hash_mismatch' : 'missing_evidence');
    }
    // Only a held-out locked plan; DEV and awaiting-lock plans never admit.
    if (plan.schema !== 'horse-tournament-flag-plan-v1' || plan.state !== 'heldout_locked')
      return refuse('not_qualified');
    // The assembled verdict (assembleTournamentFlag) must have measured and
    // won every gate. Its own activation field is always false by design.
    for (const v of verdicts as Array<Record<string, unknown>>) {
      if (
        !v ||
        v.measured !== true ||
        v.wins !== true ||
        v.activation !== false ||
        !Array.isArray(v.reasons) ||
        v.reasons.length !== 0
      )
        return refuse('not_qualified');
    }
    const files = selection.runtimeSourceFiles;
    if (
      !Object.keys(files).length ||
      !files['src/engine/HorseLogic.ts'] ||
      !files['src/engine/HorseTournamentFlagAuthority.ts'] ||
      !files['src/engine/horseDecision/workerRuntime.ts'] ||
      sourcePaths().some((p) => !Object.prototype.hasOwnProperty.call(files, p))
    )
      return refuse('policy_digest_mismatch');
    for (const [p, h] of Object.entries(files)) {
      if (
        (!/^src\/[A-Za-z0-9_./-]+\.(ts|json)$/.test(p) &&
          !HORSE_REFERENCE_DECISION_SOURCE_FILES.includes(p)) ||
        p.includes('..') ||
        !hex(h, 64) ||
        bytesHash(readSource(p)) !== h
      )
        return refuse('policy_digest_mismatch');
    }
    return Object.freeze({
      status: 'admitted' as const,
      cards: Object.freeze(
        selection.cards.map((c) => c.card as HorseTournamentFlagCardName)
      ) as readonly HorseTournamentFlagCardName[],
      approvalGeneration: selection.approvalGeneration,
      sourceSha: selection.sourceSha,
      expiresAt: selection.expiresAt,
    });
  } catch {
    return refuse('missing_evidence');
  }
}

/** The card a live decision belongs to, or null outside every card domain. */
export function tournamentFlagCardFor(gs: HorseGameStateV2): HorseTournamentFlagCardName | null {
  const variant = String(gs.gameVariant ?? '').toLowerCase();
  if (variant !== 'plo4' && variant !== 'plo5' && variant !== 'plo6') return null;
  if (gs.gameMode !== 'tournament') return null;
  const rawFormat = String(gs.format ?? '').toLowerCase();
  const objective =
    rawFormat === 'mtt' || rawFormat === ''
      ? 'mtt'
      : rawFormat === 'sng' || rawFormat === 'spin' || rawFormat === 'hu_sng'
        ? 'sng'
        : null;
  if (!objective) return null;
  return `${variant}_v53_icm_${objective}` as HorseTournamentFlagCardName;
}

/** Worker-owned: the flag is on only for a decision inside an admitted card,
 * while the admission is unexpired. Never read from the request. */
export function admittedTournamentFlag(
  admission: HorseTournamentFlagAdmission,
  gs: HorseGameStateV2,
  now = Date.now()
): boolean {
  if (admission.status !== 'admitted' || now >= Date.parse(admission.expiresAt)) return false;
  const card = tournamentFlagCardFor(gs);
  return card !== null && admission.cards.includes(card);
}
