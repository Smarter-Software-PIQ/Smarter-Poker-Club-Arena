import { anchorHorseDecisionHand } from './HorseDecisionHandBinding.js';
import {
  horseObserverReadContextFromRequest,
  horseObserverReadContextKey,
} from './HorseObserverReadContext.js';
import type { LiveHorseDecisionSnapshot } from './horseDecision/protocol.js';
export const HORSE_OBSERVER_READ_EVIDENCE_VERSION = 2;
/** Validates retained provenance only. It cannot establish runtime delivery,
 * full history coverage, poker strength or authority to activate a strategy. */
export function horseObserverReadsWereIndependent(
  value: unknown,
  request: LiveHorseDecisionSnapshot
): boolean {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const v = value as Record<string, unknown>;
    const keys = [
      'version',
      'disposition',
      'context',
      'cutoffMs',
      'learnedThroughMs',
      'history',
      ...(v.version === 2
        ? ['historyDigest', 'historyAvailableAtMs', 'historyHands', 'historyCapped']
        : []),
    ];
    const historyValid =
      v.version === 1
        ? v.history === 'volatile_only'
        : v.version === 2 &&
          v.history === 'own_public_window' &&
          typeof v.historyDigest === 'string' &&
          /^[a-f0-9]{64}$/.test(v.historyDigest) &&
          typeof v.historyAvailableAtMs === 'number' &&
          Number.isSafeInteger(v.historyAvailableAtMs) &&
          v.historyAvailableAtMs >= 0 &&
          typeof v.learnedThroughMs === 'number' &&
          v.historyAvailableAtMs <= v.learnedThroughMs &&
          Number.isSafeInteger(v.historyHands) &&
          (v.historyHands as number) >= 0 &&
          (v.historyHands as number) <= 64 &&
          typeof v.historyCapped === 'boolean';
    const expected = horseObserverReadContextFromRequest(request);
    return (
      Object.keys(v).length === keys.length &&
      keys.every((key) => Object.hasOwn(v, key)) &&
      historyValid &&
      v.disposition === 'independent' &&
      typeof v.cutoffMs === 'number' &&
      Number.isSafeInteger(v.cutoffMs) &&
      v.cutoffMs >= 0 &&
      v.cutoffMs === request.decisionTimeMs &&
      typeof v.learnedThroughMs === 'number' &&
      Number.isSafeInteger(v.learnedThroughMs) &&
      v.learnedThroughMs >= 0 &&
      v.learnedThroughMs <= v.cutoffMs &&
      expected !== null &&
      horseObserverReadContextKey(v.context) === horseObserverReadContextKey(expected) &&
      anchorHorseDecisionHand(request).status === 'anchored'
    );
  } catch {
    return false;
  }
}

/** Validates retained pooled-public provenance, never independent observation,
 * full history coverage, poker strength or live delivery. */
export function horseObserverReadsUsedPublicPool(
  value: unknown,
  request: LiveHorseDecisionSnapshot
): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const { individualVersion, pooledPublicProfiles, ...base } = v;
  if (
    v.version !== 3 ||
    v.disposition !== 'pooled_public' ||
    ![1, 2].includes(individualVersion as number) ||
    !pooledPublicProfiles ||
    typeof pooledPublicProfiles !== 'object' ||
    Array.isArray(pooledPublicProfiles)
  )
    return false;
  const p = pooledPublicProfiles as Record<string, unknown>;
  if (p.version === 3) {
    if (!Array.isArray(p.lineage) || !p.lineage.length || p.lineage.length > 18) return false;
    const scope = horseObserverReadContextFromRequest(request);
    if (scope?.version !== 2 || !Array.isArray(request.gameState?.players)) return false;
    const opponents = new Set(
      request.gameState.players
        .filter(
          (player) =>
            player &&
            player.user_id !== scope.observerId &&
            request.gameState.dealtSeatIds?.includes(player.seat)
        )
        .map((player) => player.user_id)
    );
    const size = scope.dealtCount <= 2 ? 'hu' : scope.dealtCount <= 5 ? 'short' : 'full';
    const seen = new Set<string>();
    const subjects = new Set<string>();
    for (const row of p.lineage) {
      if (
        !row ||
        typeof row !== 'object' ||
        Array.isArray(row) ||
        Object.keys(row).sort().join(',') !== 'handId,observedHands,size,userId' ||
        !opponents.has(row.userId) ||
        !['hu', 'short', 'full'].includes(row.size) ||
        (size === 'hu') !== (row.size === 'hu') ||
        !Number.isSafeInteger(row.observedHands) ||
        row.observedHands < 1 ||
        typeof row.handId !== 'string' ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(row.handId)
      )
        return false;
      const key = row.userId + ':' + row.size;
      if (seen.has(key)) return false;
      seen.add(key);
      subjects.add(row.userId);
    }
    if (subjects.size > Number(p.profiles)) return false;
  }
  if (
    Object.keys(p).length !== (p.version === 3 ? 6 : 5) ||
    // 1: digest of the exact rows; 2: digest of { rows, donors } (sibling
    // table-size donors, 2026-11-08).
    ![1, 2, 3].includes(p.version as number) ||
    !['accepted_hand_public_profiles', 'saved_and_accepted_public_profiles'].includes(
      p.source as string
    ) ||
    typeof p.digest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(p.digest) ||
    !Number.isSafeInteger(p.profiles) ||
    (p.profiles as number) < 1 ||
    (p.profiles as number) > 9 ||
    !Number.isSafeInteger(p.availableAtMs) ||
    (p.availableAtMs as number) < 0 ||
    (p.availableAtMs as number) > request.decisionTimeMs
  )
    return false;
  return horseObserverReadsWereIndependent(
    { ...base, version: individualVersion, disposition: 'independent' },
    request
  );
}
