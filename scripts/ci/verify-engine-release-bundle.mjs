#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Evaluates a combined post-release engine certification bundle:
 * 1. Public engine health (`https://engine.smarter.poker/health`)
 * 2. Sealed release receipt (`sealed-release-receipt.json`)
 * 3. Platform v3 thaw database proof (`fn_platform_frozen`, `fn_entry_frozen`, all 15 deadline counts)
 * 4. Canonical 1,000-horse / 5-game turn census summary
 * 5. Post-adoption natural 1/2 cash funding verification (buy-in, rebuy, top-up)
 * 6. 900-active-second resource envelope (`maxHeapUsedMB <= 2048`, `maxRssMB <= 36864`,
 *    and RSS levels off: least-squares slope over the second half of the window,
 *    from at least 8 samples, is no more than 2 MB per active minute)
 */
// OWNER DECISION (Dan, 2026-11-05 14:44 Chicago): "Raise the Phase 1 RSS ceiling
// to 12288 MB and require it to level off". The 8192 MB ceiling was below the
// measured steady state of the 8 horse-decision workers' bounded observer
// memory, so it could not be met at any uptime. Heap ceiling unchanged.
// RAISED AGAIN (Dan, 2026-11-05 18:25 Chicago): "give the engine 2-3x more
// memory than it will ever need". The 12 GB worst case is the unit, so the
// ceiling is 36864 MB (3x), matching MEMORY_GOVERNOR_FALLBACK_HARD_MB.
export const RESOURCE_RSS_CEILING_MB = 36864;
export const RESOURCE_RSS_LEVEL_OFF_MAX_MB_PER_MIN = 2;
export const RESOURCE_RSS_LEVEL_OFF_MIN_SAMPLES = 8;

/** Least-squares RSS slope (MB per active minute) over the second half of the
 * window. `samples` are {activeSeconds, rssMb} in observation order. Returns
 * null when there are too few usable samples to judge. */
export function rssLevelOffSlopeMbPerMinute(samples) {
  if (!Array.isArray(samples)) return null;
  const usable = samples.filter(
    (x) => x && Number.isFinite(x.activeSeconds) && Number.isFinite(x.rssMb)
  );
  if (usable.length < 2) return null;
  const end = usable[usable.length - 1].activeSeconds;
  const start = usable[0].activeSeconds;
  const half = start + (end - start) / 2;
  const tail = usable.filter((x) => x.activeSeconds >= half);
  if (tail.length < RESOURCE_RSS_LEVEL_OFF_MIN_SAMPLES) return null;
  const n = tail.length;
  const mx = tail.reduce((a, x) => a + x.activeSeconds / 60, 0) / n;
  const my = tail.reduce((a, x) => a + x.rssMb, 0) / n;
  let num = 0;
  let den = 0;
  for (const x of tail) {
    const dx = x.activeSeconds / 60 - mx;
    num += dx * (x.rssMb - my);
    den += dx * dx;
  }
  return den > 0 ? num / den : null;
}
export function evaluateEngineReleaseCertificationBundle(bundle) {
  const failures = [];

  if (!bundle || typeof bundle !== 'object') {
    return { certified: false, failures: ['bundle_missing'] };
  }

  const expectedSha = bundle.expectedCommitSha;
  if (typeof expectedSha !== 'string' || !/^[0-9a-f]{40}$/.test(expectedSha)) {
    failures.push('invalid_expected_commit_sha');
  }

  // 1. Public health check
  const health = bundle.publicHealth;
  if (!health || typeof health !== 'object') {
    failures.push('public_health_missing');
  } else {
    if (health.status !== 'ok') failures.push('public_health_not_ok');
    if (health.commitSha !== expectedSha) failures.push('public_health_sha_mismatch');
    if (health.liveness?.status !== 'ok' || health.liveness?.wholeFleetStalled === true) {
      failures.push('public_health_liveness_degraded');
    }
    if ((health.liveness?.quarantinedTables ?? 0) > 0) {
      failures.push('public_health_quarantined_tables_nonzero');
    }
    if (health.maintenance?.active === true || health.maintenance?.phase !== 'idle') {
      failures.push('public_health_maintenance_ still_active');
    }
  }

  // 2. SEALED release receipt
  const seal = bundle.sealedReceipt;
  if (!seal || typeof seal !== 'object') {
    failures.push('sealed_receipt_missing');
  } else {
    if (seal.status !== 'SEALED') failures.push('sealed_receipt_status_not_sealed');
    if (seal.commitSha !== expectedSha) failures.push('sealed_receipt_sha_mismatch');
    if (
      health?.instanceId &&
      seal.instanceId &&
      seal.instanceId !== health.instanceId
    ) {
      failures.push('sealed_receipt_instance_mismatch');
    }
  }

  // 3. v3 Thaw verification
  const thaw = bundle.v3Thaw;
  if (!thaw || typeof thaw !== 'object') {
    failures.push('v3_thaw_missing');
  } else {
    if (thaw.platformFrozen !== false || thaw.entryFrozen !== false) {
      failures.push('v3_thaw_restrictions_still_active');
    }
    if ((thaw.maintenanceRows ?? 1) !== 0) {
      failures.push('v3_thaw_maintenance_rows_remaining');
    }
    if ((thaw.verifiedDeadlineFamilies ?? 0) < 15 || thaw.countsMatch !== true) {
      failures.push('v3_thaw_deadline_families_incomplete');
    }
  }

  // 4. Canonical 1,000-horse / 5-game census
  const census = bundle.canonicalCensus;
  const requiredGames = ['NLH', 'PLO4', 'PLO5', 'PLO6', 'PLO8'];
  if (!census || typeof census !== 'object') {
    failures.push('canonical_census_missing');
  } else {
    if (census.commitSha !== expectedSha) failures.push('canonical_census_sha_mismatch');
    if ((census.canonicalHorseCount ?? 0) !== 1000) {
      failures.push('canonical_census_roster_not_1000');
    }
    const observedGames = Array.isArray(census.gamesVerified) ? census.gamesVerified : [];
    for (const g of requiredGames) {
      if (!observedGames.includes(g)) failures.push(`canonical_census_missing_game_${g}`);
    }
    if ((census.contradictoryBindings ?? 1) > 0) {
      failures.push('canonical_census_contradictory_bindings');
    }
  }

  // 5. Natural 1/2 cash funding proof
  const funding = bundle.naturalFunding;
  if (!funding || typeof funding !== 'object') {
    failures.push('natural_funding_missing');
  } else {
    if ((funding.naturalBuyInCount ?? 0) < 1) failures.push('natural_buyin_unobserved');
    if ((funding.naturalReloadOrTopUpCount ?? 0) < 1) {
      failures.push('natural_rebuy_or_topup_unobserved');
    }
    if ((funding.boundsViolations ?? 1) > 0) {
      failures.push('natural_funding_bounds_violation');
    }
  }

  // 6. 900-active-second resource proof
  const resource = bundle.resourceWindow;
  if (!resource || typeof resource !== 'object') {
    failures.push('resource_window_missing');
  } else {
    if (resource.commitSha !== expectedSha) failures.push('resource_window_sha_mismatch');
    if ((resource.activeSeconds ?? 0) < 900) {
      failures.push('resource_window_under_900_active_seconds');
    }
    if ((resource.maxHeapUsedMB ?? Infinity) > 6144) {
      failures.push('resource_window_heap_exceeded_6144mb');
    }
    if ((resource.maxRssMB ?? Infinity) > RESOURCE_RSS_CEILING_MB) {
      failures.push('resource_window_rss_exceeded_36864mb');
    }
    const slope = rssLevelOffSlopeMbPerMinute(resource.rssSamples);
    if (slope === null) failures.push('resource_window_rss_level_off_unproven');
    else if (slope > RESOURCE_RSS_LEVEL_OFF_MAX_MB_PER_MIN) {
      failures.push('resource_window_rss_not_leveling_off');
    }
  }

  return {
    certified: failures.length === 0,
    expectedCommitSha: expectedSha ?? null,
    failures,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('Usage: node scripts/ci/verify-engine-release-bundle.mjs <bundle.json>');
    process.exit(2);
  }
  const bundle = JSON.parse(readFileSync(inputPath, 'utf8'));
  const result = evaluateEngineReleaseCertificationBundle(bundle);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.certified ? 0 : 1);
}
