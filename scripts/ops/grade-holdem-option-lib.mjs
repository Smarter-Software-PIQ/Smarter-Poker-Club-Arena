// scripts/ops/grade-holdem-option-lib.mjs
// Pure, deterministic core module for the Unified Hold'em Grade Harness.
// Zero filesystem/process/network I/O: all inputs are passed explicitly so every
// bar, gate check, statistical formula, and VERIFIER-10 recomputation is 100%
// reproducible and unit-testable.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HARNESS_SCHEMA_VERSION = 'holdem-grade-harness/v1';

export const SHA256_RE = /^[0-9a-f]{64}$/;
export const GIT_SHA_RE = /^[0-9a-f]{40}$/;
export const OPTION_NAME_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,119}$/;
export const CELL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/;

export const CELL_ROLES = Object.freeze(['PRIMARY', 'GUARD', 'CONTROL']);
export const VERDICTS = Object.freeze(['PASS', 'FAIL', 'NO-GAIN', 'INERT', 'VOID']);
export const DIRECTIONS = Object.freeze(['higher_is_better', 'lower_is_better']);
export const ZFAM_METHODS = Object.freeze(['sidak', 'bonferroni']);
export const PRIMARY_POOLING_METHODS = Object.freeze(['inverse_variance', 'equal_weight']);

export const DEFAULT_MAX_LOAD_1M = 35;
export const LOCK_DIR_CANDIDATES = Object.freeze([
  '/Volumes/SmarterWork/agent-work/shared-capacity/hs-locks-01UxDLnM4',
  '/Volumes/SmarterWork 1/agent-work/shared-capacity/hs-locks-01UxDLnM4',
]);

/**
 * Resolves the shared lock directory portably:
 * 1. Explicit `HS_LOCK_DIR` env override (trimmed, trailing slashes stripped)
 * 2. First existing candidate among canonical and suffixed SSD1 mountpoints
 * 3. First candidate fallback when running on a host without those mounts
 */
export function resolveLockDir({
  env = process.env,
  pathExists = existsSync,
  candidates = LOCK_DIR_CANDIDATES,
} = {}) {
  const fromEnv = typeof env?.HS_LOCK_DIR === 'string' ? env.HS_LOCK_DIR.trim() : '';
  if (fromEnv) {
    return fromEnv.replace(/\/+$/, '') || fromEnv;
  }
  if (typeof pathExists === 'function') {
    for (const candidate of candidates) {
      if (pathExists(candidate)) {
        return candidate;
      }
    }
  }
  return candidates[0];
}

/**
 * The repository copy of core-gate-running.py (2026-11-26). It used to be read from the SSD1 lock folder, so
 * with SSD1 gone the script was simply missing; it now ships with every checkout. It still reads the SSD2
 * inbox, and anything but exit 1 (clear) stays fail-closed below.
 */
export const REPO_CORE_GATE_SCRIPT = (() => {
  const url = new URL('./core-gate-running.py', import.meta.url);
  // A test environment that serves modules over http keeps the repository-relative path.
  return url.protocol === 'file:'
    ? fileURLToPath(url)
    : resolve(process.cwd(), decodeURIComponent(url.pathname).replace(/^\/+/, ''));
})();

export function resolveDefaultLockPaths(options = {}) {
  const lockDir = resolveLockDir(options);
  return {
    lockDir,
    shepherdLock: `${lockDir}/shepherd.lock`,
    coreGateScript: REPO_CORE_GATE_SCRIPT,
  };
}

export const DEFAULT_LOCK_DIR = resolveLockDir();
export const DEFAULT_SHEPHERD_LOCK = `${DEFAULT_LOCK_DIR}/shepherd.lock`;
export const DEFAULT_CORE_GATE_SCRIPT = REPO_CORE_GATE_SCRIPT;

export const LEAGUE_CARD_MAX_SEED = 0xffffffff;
export const LEAGUE_CARD_MAX_PAIRS = 65536;

/**
 * Standard normal CDF at z = 1.0: Phi(1) = 0.8413447460685429.
 * LEAD-3-RULING-1 fixes the one-sided family error rate at alpha_1 = 1 - Phi(1).
 */
export const PHI_1 = 0.8413447460685429;
export const ONE_SIGMA_TAIL_ALPHA = 1 - PHI_1;

export const DEFAULT_BARS = Object.freeze({
  direction: 'higher_is_better',
  zFamMethod: 'sidak',
  alphaFamily: ONE_SIGMA_TAIL_ALPHA,
  primaryPoolingMethod: 'inverse_variance',
  primaryMinZ: -1.0,
  enforcePerPrimaryCell: false,
  requirePerPrimaryCellNonInferiority: false,
  requirePositiveGain: false,
  primaryGainZ: 2.0,
  guardPooledZOverride: null,
  guardCellZOverride: null,
  includePrimarySeedsInCellGuard: null, // null => auto (true when P === 0, false when P > 0)
  requireControl: true,
  enforceRevisionMatch: true,
  maxLoad1m: DEFAULT_MAX_LOAD_1M,
});

// --- Hashing & Normal Distribution Math --------------------------------------------------------

export function sha256Hex(input) {
  return createHash('sha256').update(input).digest('hex');
}

export function normalizeSha256(value, label = 'sha256') {
  if (typeof value !== 'string') {
    throw new Error(`Invalid ${label}: expected 64-hex sha256 string`);
  }
  const normalized = value.trim().toLowerCase();
  if (!SHA256_RE.test(normalized)) {
    throw new Error(`Invalid ${label} "${value}": must be 64 lowercase hex characters`);
  }
  return normalized;
}

/**
 * High-accuracy error function erf(x) using Abramowitz & Stegun 7.1.26
 * (max absolute error < 1.5e-7).
 */
function erfApprox(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

/**
 * Standard normal cumulative distribution function Phi(z).
 */
export function normalCdf(z) {
  if (!Number.isFinite(z)) {
    if (z === Number.POSITIVE_INFINITY) return 1;
    if (z === Number.NEGATIVE_INFINITY) return 0;
    throw new Error(`normalCdf requires finite z, got ${String(z)}`);
  }
  return 0.5 * (1 + erfApprox(z / Math.SQRT2));
}

/**
 * Inverse standard normal CDF Phi^-1(p) via Peter J. Acklam's minimax rational
 * approximation (relative error < 1.15e-9 across all 0 < p < 1).
 */
export function normalQuantile(p) {
  if (typeof p !== 'number' || !Number.isFinite(p) || p <= 0 || p >= 1) {
    throw new Error(`normalQuantile requires 0 < p < 1, got ${String(p)}`);
  }
  const a1 = -3.969683028665376e1;
  const a2 = 2.209460984245205e2;
  const a3 = -2.759285104469687e2;
  const a4 = 1.38357751867269e2;
  const a5 = -3.066479806614716e1;
  const a6 = 2.506628277459239;

  const b1 = -5.447609879822406e1;
  const b2 = 1.615858368580409e2;
  const b3 = -1.556989798598866e2;
  const b4 = 6.680131188771972e1;
  const b5 = -1.328068155288572e1;

  const c1 = -7.784894002430293e-3;
  const c2 = -3.223964580411365e-1;
  const c3 = -2.400758277161838;
  const c4 = -2.549732539343734;
  const c5 = 4.374664141464968;
  const c6 = 2.938163982698783;

  const d1 = 7.784695709041462e-3;
  const d2 = 3.224671290700398e-1;
  const d3 = 2.445134137142996;
  const d4 = 3.754408661907416;

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) /
      ((((d1 * q + d2) * q + d3) * q + d4) * q + 1)
    );
  }
  if (p <= pHigh) {
    const q = p - 0.5;
    const r = q * q;
    return (
      ((((((a1 * r + a2) * r + a3) * r + a4) * r + a5) * r + a6) * q) /
      (((((b1 * r + b2) * r + b3) * r + b4) * r + b5) * r + 1)
    );
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(
    (((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) /
    ((((d1 * q + d2) * q + d3) * q + d4) * q + 1)
  );
}

/**
 * Family-wise one-sided guard Z-score threshold z_fam(m).
 *
 * Default (`method: 'sidak'`, `alphaFamily: 1 - Phi(1)`):
 *   Matches LEAD-3-RULING-1 / VERIFIER-10 exactly:
 *     1 - p_cell = (1 - alphaFamily)^(1/m) = Phi(1)^(1/m)
 *     z_fam(m)   = Phi^-1(Phi(1)^(1/m))
 *   Examples: z_fam(1)=1.000, z_fam(6)=1.905, z_fam(7)=1.971, z_fam(10)=2.117,
 *             z_fam(12)=2.189, z_fam(13)=2.220, z_fam(19)=2.363, z_fam(56)=2.739.
 *
 * `method: 'bonferroni'`:
 *     p_cell   = alphaFamily / m
 *     z_fam(m) = Phi^-1(1 - alphaFamily / m)
 */
export function computeZFam(m, options = {}) {
  if (!Number.isSafeInteger(m) || m < 1) {
    throw new Error(`computeZFam requires positive integer m >= 1, got ${String(m)}`);
  }
  const method = options.method ?? 'sidak';
  const alphaFamily = options.alphaFamily ?? ONE_SIGMA_TAIL_ALPHA;
  if (!ZFAM_METHODS.includes(method)) {
    throw new Error(`Unsupported zFam method "${String(method)}": use ${ZFAM_METHODS.join(', ')}`);
  }
  if (
    typeof alphaFamily !== 'number' ||
    !Number.isFinite(alphaFamily) ||
    alphaFamily <= 0 ||
    alphaFamily >= 0.5
  ) {
    throw new Error(`alphaFamily must be in (0, 0.5), got ${String(alphaFamily)}`);
  }
  if (method === 'bonferroni') {
    return normalQuantile(1 - alphaFamily / m);
  }
  const pPass = Math.exp(Math.log(1 - alphaFamily) / m);
  return normalQuantile(pPass);
}

/**
 * Inverse-variance pooling across independent observations { bb100, stderr }.
 * Weights w_i = 1 / stderr_i^2; mean = sum(w_i * x_i) / sum(w_i); se = 1 / sqrt(sum(w_i)).
 */
export function poolInverseVariance(observations) {
  if (!Array.isArray(observations) || observations.length === 0) {
    return null;
  }
  let weightSum = 0;
  let weightedMeanNum = 0;
  for (let i = 0; i < observations.length; i += 1) {
    const obs = observations[i];
    const bb100 = Number(obs?.bb100);
    const stderr = Number(obs?.stderr);
    if (!Number.isFinite(bb100) || !Number.isFinite(stderr)) {
      return {
        mean: null,
        stderr: null,
        z: null,
        weightSum: 0,
        count: observations.length,
        valid: false,
        invalidReason: `observation[${i}] has non-finite bb100 or stderr`,
      };
    }
    if (stderr <= 0) {
      return {
        mean: null,
        stderr: null,
        z: null,
        weightSum: 0,
        count: observations.length,
        valid: false,
        invalidReason: `observation[${i}] has non-positive stderr (${stderr}); cannot compute inverse-variance weight`,
      };
    }
    const w = 1 / (stderr * stderr);
    weightSum += w;
    weightedMeanNum += w * bb100;
  }
  const mean = weightedMeanNum / weightSum;
  const stderr = 1 / Math.sqrt(weightSum);
  const z = stderr > 0 ? mean / stderr : 0;
  return {
    mean,
    stderr,
    z,
    weightSum,
    count: observations.length,
    valid: true,
    invalidReason: null,
  };
}

/**
 * Equal-weight pooling cross-check matching `pooledLeagueCardSeeds` in HorseLeagueCard.ts:
 * mean = sum(x_i) / k; stderr = sqrt(sum(se_i^2)) / k.
 */
export function poolEqualWeight(observations) {
  if (!Array.isArray(observations) || observations.length === 0) {
    return null;
  }
  let meanSum = 0;
  let varSum = 0;
  for (let i = 0; i < observations.length; i += 1) {
    const obs = observations[i];
    const bb100 = Number(obs?.bb100);
    const stderr = Number(obs?.stderr);
    if (!Number.isFinite(bb100) || !Number.isFinite(stderr) || stderr < 0) {
      return {
        mean: null,
        stderr: null,
        z: null,
        count: observations.length,
        valid: false,
        invalidReason: `observation[${i}] has invalid bb100 or stderr`,
      };
    }
    meanSum += bb100;
    varSum += stderr * stderr;
  }
  const k = observations.length;
  const mean = meanSum / k;
  const stderr = Math.sqrt(varSum) / k;
  const z = stderr > 0 ? mean / stderr : 0;
  return {
    mean,
    stderr,
    z,
    count: k,
    valid: true,
    invalidReason: null,
  };
}

export function directionalGainZ(z, direction = 'higher_is_better') {
  return direction === 'lower_is_better' ? -z : z;
}

export function directionalAdverseZ(z, direction = 'higher_is_better') {
  return direction === 'lower_is_better' ? z : -z;
}

// --- Criteria File & Manifest Validation -------------------------------------------------------

export function verifyCriteriaContent({ criteriaPath, criteriaBytes, expectedSha256 }) {
  const failures = [];
  let normalizedExpected = null;

  if (typeof criteriaPath !== 'string' || criteriaPath.trim().length === 0) {
    failures.push({ code: 'CRITERIA_PATH_MISSING', reason: 'criteriaPath is required' });
  }
  try {
    normalizedExpected = normalizeSha256(expectedSha256, '--criteria-sha');
  } catch (err) {
    failures.push({ code: 'CRITERIA_SHA_INVALID', reason: err.message });
  }

  if (criteriaBytes == null) {
    failures.push({
      code: 'CRITERIA_FILE_MISSING',
      reason: `Criteria file missing or unreadable: ${criteriaPath || '<unset>'}`,
    });
    return {
      ok: false,
      criteriaPath: criteriaPath || null,
      expectedSha256: normalizedExpected,
      actualSha256: null,
      byteLength: 0,
      failures,
    };
  }

  const buf = Buffer.isBuffer(criteriaBytes)
    ? criteriaBytes
    : Buffer.from(String(criteriaBytes), 'utf8');
  if (buf.byteLength === 0) {
    failures.push({
      code: 'CRITERIA_FILE_EMPTY',
      reason: `Criteria file is empty: ${criteriaPath}`,
    });
  }

  const actualSha256 = sha256Hex(buf);
  if (normalizedExpected && actualSha256 !== normalizedExpected) {
    failures.push({
      code: 'CRITERIA_SHA_MISMATCH',
      reason: `Criteria SHA256 mismatch for ${criteriaPath}: expected ${normalizedExpected}, actual ${actualSha256}`,
    });
  }

  return {
    ok: failures.length === 0,
    criteriaPath: criteriaPath || null,
    expectedSha256: normalizedExpected,
    actualSha256,
    byteLength: buf.byteLength,
    failures,
  };
}

export function validateCriteriaManifest(rawManifest) {
  if (!rawManifest || typeof rawManifest !== 'object' || Array.isArray(rawManifest)) {
    throw new Error('Criteria manifest must be a JSON object');
  }

  const option = typeof rawManifest.option === 'string' ? rawManifest.option.trim() : '';
  if (!OPTION_NAME_RE.test(option)) {
    throw new Error(`Invalid manifest.option "${String(rawManifest.option)}"`);
  }

  const criteriaPath =
    typeof rawManifest.criteriaPath === 'string' ? rawManifest.criteriaPath.trim() : '';
  if (!criteriaPath) {
    throw new Error('manifest.criteriaPath is required');
  }
  const criteriaSha256 = normalizeSha256(rawManifest.criteriaSha256, 'manifest.criteriaSha256');

  if (!Array.isArray(rawManifest.cells) || rawManifest.cells.length === 0) {
    throw new Error('manifest.cells must be a non-empty array');
  }

  const rawBars = rawManifest.bars && typeof rawManifest.bars === 'object' ? rawManifest.bars : {};
  if (
    rawBars.enforcePerPrimaryCell !== undefined &&
    typeof rawBars.enforcePerPrimaryCell !== 'boolean'
  ) {
    throw new Error('bars.enforcePerPrimaryCell must be a boolean');
  }
  if (
    rawBars.requirePerPrimaryCellNonInferiority !== undefined &&
    typeof rawBars.requirePerPrimaryCellNonInferiority !== 'boolean'
  ) {
    throw new Error('bars.requirePerPrimaryCellNonInferiority must be a boolean');
  }
  const enforcePerPrimaryCell = Boolean(
    rawBars.enforcePerPrimaryCell === true || rawBars.requirePerPrimaryCellNonInferiority === true
  );
  const bars = {
    direction: rawBars.direction ?? DEFAULT_BARS.direction,
    zFamMethod: rawBars.zFamMethod ?? DEFAULT_BARS.zFamMethod,
    alphaFamily: rawBars.alphaFamily ?? DEFAULT_BARS.alphaFamily,
    primaryPoolingMethod: rawBars.primaryPoolingMethod ?? DEFAULT_BARS.primaryPoolingMethod,
    primaryMinZ: rawBars.primaryMinZ ?? DEFAULT_BARS.primaryMinZ,
    enforcePerPrimaryCell,
    requirePerPrimaryCellNonInferiority: enforcePerPrimaryCell,
    requirePositiveGain: Boolean(rawBars.requirePositiveGain ?? DEFAULT_BARS.requirePositiveGain),
    primaryGainZ: rawBars.primaryGainZ ?? DEFAULT_BARS.primaryGainZ,
    guardPooledZOverride: rawBars.guardPooledZOverride ?? DEFAULT_BARS.guardPooledZOverride,
    guardCellZOverride: rawBars.guardCellZOverride ?? DEFAULT_BARS.guardCellZOverride,
    includePrimarySeedsInCellGuard:
      rawBars.includePrimarySeedsInCellGuard ?? DEFAULT_BARS.includePrimarySeedsInCellGuard,
    requireControl: rawBars.requireControl ?? DEFAULT_BARS.requireControl,
    enforceRevisionMatch: rawBars.enforceRevisionMatch ?? DEFAULT_BARS.enforceRevisionMatch,
    maxLoad1m: rawBars.maxLoad1m ?? DEFAULT_BARS.maxLoad1m,
  };

  if (!DIRECTIONS.includes(bars.direction)) {
    throw new Error(`Invalid bars.direction "${String(bars.direction)}"`);
  }
  if (!ZFAM_METHODS.includes(bars.zFamMethod)) {
    throw new Error(`Invalid bars.zFamMethod "${String(bars.zFamMethod)}"`);
  }
  if (!PRIMARY_POOLING_METHODS.includes(bars.primaryPoolingMethod)) {
    throw new Error(
      `Invalid bars.primaryPoolingMethod "${String(bars.primaryPoolingMethod)}": use ${PRIMARY_POOLING_METHODS.join(', ')}`
    );
  }
  if (
    typeof bars.alphaFamily !== 'number' ||
    !Number.isFinite(bars.alphaFamily) ||
    bars.alphaFamily <= 0 ||
    bars.alphaFamily >= 0.5
  ) {
    throw new Error(`Invalid bars.alphaFamily: ${String(bars.alphaFamily)}`);
  }
  if (typeof bars.primaryMinZ !== 'number' || !Number.isFinite(bars.primaryMinZ)) {
    throw new Error(`Invalid bars.primaryMinZ: ${String(bars.primaryMinZ)}`);
  }
  if (
    typeof bars.primaryGainZ !== 'number' ||
    !Number.isFinite(bars.primaryGainZ) ||
    bars.primaryGainZ <= 0
  ) {
    throw new Error(`Invalid bars.primaryGainZ: ${String(bars.primaryGainZ)}`);
  }
  if (
    bars.guardPooledZOverride !== null &&
    (typeof bars.guardPooledZOverride !== 'number' ||
      !Number.isFinite(bars.guardPooledZOverride) ||
      bars.guardPooledZOverride <= 0)
  ) {
    throw new Error(`Invalid bars.guardPooledZOverride: ${String(bars.guardPooledZOverride)}`);
  }
  if (
    bars.guardCellZOverride !== null &&
    (typeof bars.guardCellZOverride !== 'number' ||
      !Number.isFinite(bars.guardCellZOverride) ||
      bars.guardCellZOverride <= 0)
  ) {
    throw new Error(`Invalid bars.guardCellZOverride: ${String(bars.guardCellZOverride)}`);
  }
  if (
    bars.includePrimarySeedsInCellGuard !== null &&
    typeof bars.includePrimarySeedsInCellGuard !== 'boolean'
  ) {
    throw new Error('bars.includePrimarySeedsInCellGuard must be boolean or null');
  }
  if (
    typeof bars.maxLoad1m !== 'number' ||
    !Number.isFinite(bars.maxLoad1m) ||
    bars.maxLoad1m <= 0
  ) {
    throw new Error(`Invalid bars.maxLoad1m: ${String(bars.maxLoad1m)}`);
  }

  const seenCellIds = new Set();
  const cells = rawManifest.cells.map((rawCell, idx) => {
    if (!rawCell || typeof rawCell !== 'object' || Array.isArray(rawCell)) {
      throw new Error(`manifest.cells[${idx}] must be an object`);
    }
    const id = typeof rawCell.id === 'string' ? rawCell.id.trim() : '';
    if (!CELL_ID_RE.test(id)) {
      throw new Error(`manifest.cells[${idx}].id invalid: "${String(rawCell.id)}"`);
    }
    if (seenCellIds.has(id)) {
      throw new Error(`Duplicate cell id "${id}" in manifest.cells`);
    }
    seenCellIds.add(id);

    const card = typeof rawCell.card === 'string' ? rawCell.card.trim() : '';
    if (!card) {
      throw new Error(`manifest.cells[${idx}] ("${id}") requires non-empty card name`);
    }

    const role = typeof rawCell.role === 'string' ? rawCell.role.trim().toUpperCase() : '';
    if (!CELL_ROLES.includes(role)) {
      throw new Error(
        `manifest.cells[${idx}] ("${id}") invalid role "${String(rawCell.role)}": must be ${CELL_ROLES.join(', ')}`
      );
    }

    const inertGuard = Boolean(rawCell.inertGuard ?? false);
    if (inertGuard && role !== 'GUARD') {
      throw new Error(
        `manifest.cells[${idx}] ("${id}") has inertGuard=true but role=${role}; inertGuard is only valid on GUARD cells`
      );
    }

    if (!Array.isArray(rawCell.seeds) || rawCell.seeds.length === 0) {
      throw new Error(`manifest.cells[${idx}] ("${id}") requires a non-empty seeds array`);
    }
    const seedSet = new Set();
    const seeds = rawCell.seeds.map((s) => {
      if (!Number.isSafeInteger(s) || s < 1 || s > LEAGUE_CARD_MAX_SEED) {
        throw new Error(
          `manifest.cells[${idx}] ("${id}") invalid seed ${String(s)}: must be integer in 1..${LEAGUE_CARD_MAX_SEED}`
        );
      }
      if (seedSet.has(s)) {
        throw new Error(`manifest.cells[${idx}] ("${id}") lists duplicate seed ${s}`);
      }
      seedSet.add(s);
      return s;
    });

    const pairs = rawCell.pairs;
    if (!Number.isSafeInteger(pairs) || pairs < 2 || pairs > LEAGUE_CARD_MAX_PAIRS) {
      throw new Error(
        `manifest.cells[${idx}] ("${id}") invalid pairs ${String(pairs)}: must be integer in 2..${LEAGUE_CARD_MAX_PAIRS}`
      );
    }

    const group =
      typeof rawCell.group === 'string' && rawCell.group.trim().length > 0
        ? rawCell.group.trim()
        : card;

    let minDecidedSpots = null;
    if (rawCell.minDecidedSpots !== undefined && rawCell.minDecidedSpots !== null) {
      if (!Number.isSafeInteger(rawCell.minDecidedSpots) || rawCell.minDecidedSpots < 0) {
        throw new Error(
          `manifest.cells[${idx}] ("${id}") invalid minDecidedSpots: ${String(rawCell.minDecidedSpots)}`
        );
      }
      minDecidedSpots = rawCell.minDecidedSpots;
    }

    return {
      id,
      card,
      role,
      group,
      inertGuard,
      seeds,
      pairs,
      minDecidedSpots,
    };
  });

  const primaryCount = cells.filter((c) => c.role === 'PRIMARY').length;
  const controlCount = cells.filter((c) => c.role === 'CONTROL').length;
  if (primaryCount === 0) {
    throw new Error('manifest.cells must declare at least one PRIMARY cell');
  }
  if (bars.requireControl && controlCount === 0) {
    throw new Error('manifest.cells must declare at least one CONTROL cell (requireControl=true)');
  }

  return {
    schemaVersion: HARNESS_SCHEMA_VERSION,
    option,
    description: typeof rawManifest.description === 'string' ? rawManifest.description.trim() : '',
    criteriaPath,
    criteriaSha256,
    hydrateSolverStores: Boolean(rawManifest.hydrateSolverStores ?? false),
    bars,
    cells,
  };
}

// --- System Gate Evaluator ---------------------------------------------------------------------

export function evaluateSystemGate(input) {
  const maxLoad1m = input.maxLoad1m ?? DEFAULT_MAX_LOAD_1M;
  const failures = [];
  const checks = {};

  // 1. Criteria SHA256 verification
  const critOk = Boolean(input.criteriaVerification?.ok);
  checks.criteriaSha256 = {
    ok: critOk,
    expected: input.criteriaVerification?.expectedSha256 ?? null,
    actual: input.criteriaVerification?.actualSha256 ?? null,
    path: input.criteriaVerification?.criteriaPath ?? null,
  };
  if (!critOk) {
    const critReasons = input.criteriaVerification?.failures ?? [
      { code: 'CRITERIA_UNVERIFIED', reason: 'Criteria file verification did not pass' },
    ];
    for (const f of critReasons) {
      failures.push(f);
    }
  }

  // 2. shepherd.lock absent, or (opt-in) present while the machine is lightly loaded.
  // A push holding shepherd.lock is one pre-push run; on a lightly loaded host a nice'd grade job
  // beside it changes neither result (grades are seeded and deterministic). The opt-in ceiling
  // must be strictly below the ordinary load ceiling; without it the lock always refuses.
  const shepherdAbsent = input.shepherdLockExists === false;
  const lockedCeiling = input.maxLoad1mWhilePushLocked;
  const lockedCeilingValid =
    typeof lockedCeiling === 'number' &&
    Number.isFinite(lockedCeiling) &&
    lockedCeiling > 0 &&
    lockedCeiling < maxLoad1m;
  const loadForLock = input.load1m;
  const allowedUnderLock =
    !shepherdAbsent &&
    lockedCeilingValid &&
    typeof loadForLock === 'number' &&
    Number.isFinite(loadForLock) &&
    loadForLock < lockedCeiling;
  checks.shepherdLock = {
    ok: shepherdAbsent || allowedUnderLock,
    exists: Boolean(input.shepherdLockExists),
    path: input.shepherdLockPath ?? DEFAULT_SHEPHERD_LOCK,
    allowedUnderLockBelowLoad: lockedCeilingValid ? lockedCeiling : null,
  };
  if (!shepherdAbsent && !allowedUnderLock) {
    failures.push({
      code: 'SHEPHERD_LOCK_PRESENT',
      reason: lockedCeilingValid
        ? `shepherd.lock is present at ${checks.shepherdLock.path} and 1-minute load (${String(loadForLock)}) is not below ${lockedCeiling}`
        : `shepherd.lock is present at ${checks.shepherdLock.path}; never run grades while shepherd.lock exists`,
    });
  }

  // 3. Owner-checked lane lock awareness (optional lock file; refuses if owned by another lane)
  const laneLock = input.laneLock ?? null;
  let laneLockOk = true;
  if (laneLock && laneLock.exists) {
    const expectedOwner = input.expectedLaneOwner ?? null;
    if (!expectedOwner || !laneLock.owner || laneLock.owner !== expectedOwner) {
      laneLockOk = false;
      failures.push({
        code: 'LANE_LOCK_FOREIGN_OWNER',
        reason: `Lane lock at ${laneLock.path || '<lock>'} is held by "${laneLock.owner || 'unknown'}" (expected "${expectedOwner || '<unset>'}"); refusing to overwrite or proceed`,
      });
    }
  }
  checks.laneLock = {
    ok: laneLockOk,
    exists: Boolean(laneLock?.exists),
    owner: laneLock?.owner ?? null,
    path: laneLock?.path ?? null,
  };

  // 4. 1-minute system load < maxLoad1m (default 35)
  const load1m = input.load1m;
  const loadOk = typeof load1m === 'number' && Number.isFinite(load1m) && load1m < maxLoad1m;
  checks.load1m = {
    ok: loadOk,
    value: Number.isFinite(load1m) ? load1m : null,
    threshold: maxLoad1m,
  };
  if (!loadOk) {
    failures.push({
      code: 'SYSTEM_LOAD_TOO_HIGH',
      reason: `1-minute load (${String(load1m)}) is not strictly below threshold (${maxLoad1m})`,
    });
  }

  // 5. core-gate-running.py clear (exit 1 = clear, exit 0 = RUNNING, exit 2/other = fail-closed)
  const coreExit = input.coreGateExitCode;
  const coreClear = coreExit === 1;
  checks.coreGate = {
    ok: coreClear,
    exitCode: coreExit ?? null,
    output: typeof input.coreGateOutput === 'string' ? input.coreGateOutput.trim() : '',
  };
  if (!coreClear) {
    if (coreExit === 0) {
      failures.push({
        code: 'CORE_GATE_RUNNING',
        reason: `PLO math-core gate is currently running (${checks.coreGate.output || 'exit 0'})`,
      });
    } else {
      failures.push({
        code: 'CORE_GATE_CHECK_FAILED',
        reason: `core-gate-running.py did not confirm clear (exit=${String(coreExit)}; fail-closed)`,
      });
    }
  }

  // 6. Clean git working tree + exact HEAD & tree SHA recorded
  const gitPorcelain = typeof input.gitPorcelain === 'string' ? input.gitPorcelain : null;
  const dirtyFiles =
    gitPorcelain === null
      ? []
      : gitPorcelain
          .split(/\r?\n/)
          .map((l) => l.trimEnd())
          .filter((l) => l.length > 0);
  const gitClean = gitPorcelain !== null && dirtyFiles.length === 0;
  checks.gitClean = {
    ok: gitClean,
    dirtyCount: dirtyFiles.length,
    dirtySample: dirtyFiles.slice(0, 10),
  };
  if (!gitClean) {
    failures.push({
      code: 'GIT_DIRTY_TREE',
      reason:
        gitPorcelain === null
          ? 'Could not determine git working tree status (fail-closed)'
          : `Git working tree is dirty (${dirtyFiles.length} path(s): ${dirtyFiles.slice(0, 5).join(', ')}); commit or clean before grading`,
    });
  }

  const gitHead = typeof input.gitHead === 'string' ? input.gitHead.trim().toLowerCase() : '';
  const gitTree = typeof input.gitTree === 'string' ? input.gitTree.trim().toLowerCase() : '';
  const gitShasOk = GIT_SHA_RE.test(gitHead) && GIT_SHA_RE.test(gitTree);
  checks.gitProvenance = {
    ok: gitShasOk,
    gitHead: GIT_SHA_RE.test(gitHead) ? gitHead : null,
    gitTree: GIT_SHA_RE.test(gitTree) ? gitTree : null,
  };
  if (!gitShasOk) {
    failures.push({
      code: 'GIT_PROVENANCE_INVALID',
      reason: `Exact 40-hex git HEAD ("${gitHead}") and tree ("${gitTree}") SHAs are required`,
    });
  }

  return {
    ok: failures.length === 0,
    checks,
    failures,
    provenance: {
      gitHead: checks.gitProvenance.gitHead,
      gitTree: checks.gitProvenance.gitTree,
      criteriaPath: checks.criteriaSha256.path,
      criteriaSha256: checks.criteriaSha256.actual,
      load1m: checks.load1m.value,
      checkedAtUtc: input.checkedAtUtc ?? new Date().toISOString(),
    },
  };
}

// --- Parsing Raw Output & results.jsonl --------------------------------------------------------

/**
 * Extracts RESULT_JSON lines (from horseLeagueCard.ts) and DEVRESULT lines
 * (from offline control/telemetry runs) from stdout text.
 */
export function parseHorseLeagueOutput(stdoutText) {
  if (typeof stdoutText !== 'string') {
    throw new Error('parseHorseLeagueOutput requires string input');
  }
  const parsed = [];
  const lines = stdoutText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith('RESULT_JSON ')) {
      const payload = JSON.parse(line.slice('RESULT_JSON '.length));
      const r = payload.result ?? payload;
      parsed.push({
        source: 'RESULT_JSON',
        seed: payload.seed,
        pairs: payload.pairs,
        engineRevision: payload.engineRevision ?? null,
        hands: r.hands,
        bb100: r.bb100,
        stderr: r.stderr,
        divergentPairs: r.divergentPairs ?? 0,
        partedHands: r.partedHands ?? r.divergentPairs ?? 0,
        inert: Boolean(r.inert),
        illegalActions: r.illegalActions ?? 0,
        truncatedStreets: r.truncatedStreets ?? 0,
        brainExceptionFallbacks: r.brainExceptionFallbacks ?? 0,
        candidateIllegalActions: r.candidateIllegalActions ?? null,
        candidateTruncatedHands: r.candidateTruncatedHands ?? null,
        candidateBrainFallbacks: r.candidateBrainFallbacks ?? null,
        durationMs: r.durationMs ?? null,
      });
    } else if (line.startsWith('DEVRESULT ')) {
      const payload = JSON.parse(line.slice('DEVRESULT '.length));
      parsed.push({
        source: 'DEVRESULT',
        seed: payload.seed,
        pairs: payload.pairs,
        engineRevision: payload.engineRevision ?? null,
        hands: payload.hands,
        bb100: payload.bb100,
        stderr: payload.stderr,
        divergentPairs: payload.divergentPairs ?? 0,
        partedHands: payload.partedHands ?? payload.divergentPairs ?? 0,
        inert: Boolean(payload.inert),
        illegalActions: payload.illegalActions ?? payload.illegal ?? 0,
        truncatedStreets: payload.truncatedStreets ?? payload.truncated ?? 0,
        brainExceptionFallbacks: payload.brainExceptionFallbacks ?? payload.fallbacks ?? 0,
        candidateIllegalActions: payload.candidateIllegalActions ?? null,
        candidateTruncatedHands: payload.candidateTruncatedHands ?? null,
        candidateBrainFallbacks: payload.candidateBrainFallbacks ?? null,
        decidedSpots: payload.decidedSpots ?? null,
        fires: payload.fires ?? null,
        durationMs:
          payload.durationMs ?? (typeof payload.sec === 'number' ? payload.sec * 1000 : null),
      });
    }
  }
  return parsed;
}

export function parseResultsJsonl(text) {
  if (typeof text !== 'string') {
    throw new Error('results.jsonl content must be a string');
  }
  const records = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        throw new Error('line must decode to a JSON object');
      }
      records.push(obj);
    } catch (err) {
      throw new Error(`Malformed results.jsonl at line ${i + 1}: ${err.message}`);
    }
  }
  return records;
}

export function serializeResultsJsonl(records) {
  return `${records.map((r) => JSON.stringify(r)).join('\n')}\n`;
}

// --- Statistical Grader (Bars 1-4 + ONE-LOOK + VERIFIER-10 Provenance) -------------------------

function extractHardFlags(record) {
  const illegal =
    record.candidateIllegalActions !== undefined && record.candidateIllegalActions !== null
      ? record.candidateIllegalActions
      : (record.illegalActions ?? record.illegal ?? 0);
  const fallbacks =
    record.candidateBrainFallbacks !== undefined && record.candidateBrainFallbacks !== null
      ? record.candidateBrainFallbacks
      : (record.brainExceptionFallbacks ?? record.fallbacks ?? 0);
  const truncated =
    record.candidateTruncatedHands !== undefined && record.candidateTruncatedHands !== null
      ? record.candidateTruncatedHands
      : (record.truncatedStreets ?? record.truncated ?? 0);
  const valid =
    Number.isSafeInteger(illegal) &&
    illegal >= 0 &&
    Number.isSafeInteger(fallbacks) &&
    fallbacks >= 0 &&
    Number.isSafeInteger(truncated) &&
    truncated >= 0;
  return {
    illegal,
    fallbacks,
    truncated,
    total: valid ? illegal + fallbacks + truncated : Number.NaN,
    ok: valid && illegal === 0 && fallbacks === 0 && truncated === 0,
  };
}

function recordKey(cellId, seed) {
  return `${cellId}::${seed}`;
}

/**
 * Evaluates all four grading bars deterministically from a validated manifest,
 * raw per-(cellId, seed) records, and provenance metadata.
 */
export function evaluateHoldemGrade({ manifest: rawManifest, records, provenance = {} }) {
  const manifest = validateCriteriaManifest(rawManifest);
  const { bars } = manifest;
  const direction = bars.direction;

  if (!Array.isArray(records)) {
    throw new Error('evaluateHoldemGrade requires records array');
  }

  const voidReasons = [];
  const failReasons = [];
  const inertReasons = [];
  const noGainReasons = [];

  // Provenance criteria verification check if supplied
  if (
    provenance.criteriaSha256 &&
    provenance.criteriaSha256.toLowerCase() !== manifest.criteriaSha256
  ) {
    voidReasons.push({
      code: 'CRITERIA_SHA_MISMATCH',
      reason: `Provenance criteriaSha256 (${provenance.criteriaSha256}) != manifest.criteriaSha256 (${manifest.criteriaSha256})`,
    });
  }

  // Index records by (cellId, seed) and detect duplicates or unexpected records
  const byKey = new Map();
  const duplicateKeys = [];
  for (const rec of records) {
    const key = recordKey(rec?.cellId, rec?.seed);
    if (byKey.has(key)) {
      duplicateKeys.push(key);
    } else {
      byKey.set(key, rec);
    }
  }
  if (duplicateKeys.length > 0) {
    voidReasons.push({
      code: 'DUPLICATE_CELL_SEED',
      reason: `Duplicate (cellId, seed) entries in results.jsonl: ${duplicateKeys.join(', ')}`,
    });
  }

  // Build expected job list and validate completeness & ONE-LOOK exit codes
  const cellExitCodes = {};
  const missingJobs = [];
  const failedExitJobs = [];
  const revisionViolations = [];
  const handCountViolations = [];

  const rows = [];
  for (const cell of manifest.cells) {
    for (const seed of cell.seeds) {
      const key = recordKey(cell.id, seed);
      const rec = byKey.get(key);
      if (!rec) {
        missingJobs.push(key);
        cellExitCodes[key] = null;
        continue;
      }

      const exitCode = rec.exitCode ?? 0;
      cellExitCodes[key] = exitCode;
      if (exitCode !== 0) {
        failedExitJobs.push(`${key}(exit=${exitCode})`);
      }

      const engineRevision =
        typeof rec.engineRevision === 'string' ? rec.engineRevision.trim() : '';
      if (engineRevision.toLowerCase().includes('uncommitted')) {
        revisionViolations.push(`${key}: "${engineRevision}"`);
      } else if (
        bars.enforceRevisionMatch &&
        provenance.gitHead &&
        GIT_SHA_RE.test(provenance.gitHead) &&
        engineRevision &&
        engineRevision.toLowerCase() !== provenance.gitHead.toLowerCase()
      ) {
        revisionViolations.push(
          `${key}: revision "${engineRevision}" != provenance gitHead "${provenance.gitHead}"`
        );
      }

      const expectedHands = cell.pairs * 2;
      const hands = Number(rec.hands);
      if (!Number.isSafeInteger(hands) || hands !== expectedHands) {
        handCountViolations.push(
          `${key}: played hands=${String(rec.hands)}, expected ${expectedHands}`
        );
      }

      const bb100 = Number(rec.bb100);
      const stderr = Number(rec.stderr);
      const divergentPairs = Number(rec.divergentPairs ?? 0);
      const partedHands = Number(rec.partedHands ?? rec.divergentPairs ?? 0);
      if (
        !Number.isFinite(bb100) ||
        !Number.isFinite(stderr) ||
        stderr < 0 ||
        !Number.isSafeInteger(divergentPairs) ||
        divergentPairs < 0 ||
        !Number.isSafeInteger(partedHands) ||
        partedHands < 0
      ) {
        voidReasons.push({
          code: 'INVALID_NUMERIC_RECORD',
          reason: `${key} has invalid numeric fields (bb100=${String(rec.bb100)}, stderr=${String(rec.stderr)}, divergentPairs=${String(rec.divergentPairs)}, partedHands=${String(rec.partedHands)})`,
        });
      }

      const z = stderr > 0 ? bb100 / stderr : 0;
      const flags = extractHardFlags(rec);
      const decidedSpots =
        rec.decidedSpots !== undefined && rec.decidedSpots !== null
          ? Number(rec.decidedSpots)
          : null;

      rows.push({
        key,
        cellId: cell.id,
        card: cell.card,
        role: cell.role,
        group: cell.group,
        inertGuard: cell.inertGuard,
        seed,
        pairs: cell.pairs,
        hands,
        bb100,
        stderr,
        z,
        gainZ: directionalGainZ(z, direction),
        adverseZ: directionalAdverseZ(z, direction),
        divergentPairs,
        partedHands,
        inert: Boolean(rec.inert) || (divergentPairs === 0 && partedHands === 0),
        hardFlags: flags,
        decidedSpots,
        exitCode,
        engineRevision: engineRevision || null,
        durationMs: rec.durationMs ?? null,
      });
    }
  }

  if (missingJobs.length > 0) {
    voidReasons.push({
      code: 'INCOMPLETE_CELLS',
      reason: `Missing ${missingJobs.length} declared cell-seed result(s) (ONE-LOOK requires 100% completion): ${missingJobs.join(', ')}`,
    });
  }
  if (failedExitJobs.length > 0) {
    voidReasons.push({
      code: 'NONZERO_CELL_EXIT',
      reason: `Non-zero exit code on ${failedExitJobs.length} cell-seed run(s): ${failedExitJobs.join(', ')}`,
    });
  }
  if (revisionViolations.length > 0) {
    voidReasons.push({
      code: 'DIRTY_OR_MISMATCHED_REVISION',
      reason: `Engine revision violation(s): ${revisionViolations.join('; ')}`,
    });
  }
  if (handCountViolations.length > 0) {
    voidReasons.push({
      code: 'INCOMPLETE_HAND_COUNT',
      reason: `Played hand count mismatch: ${handCountViolations.join('; ')}`,
    });
  }

  // --- Bar 1: Flips-first & Non-Inert ----------------------------------------------------------
  const primaryRows = rows.filter((r) => r.role === 'PRIMARY');
  const inertGuardRows = rows.filter((r) => r.role === 'GUARD' && r.inertGuard);
  const activeGuardRows = rows.filter((r) => r.role === 'GUARD' && !r.inertGuard);
  const controlRows = rows.filter((r) => r.role === 'CONTROL');

  const primaryTotalDivergentPairs = primaryRows.reduce((s, r) => s + r.divergentPairs, 0);
  const primaryTotalPartedHands = primaryRows.reduce((s, r) => s + r.partedHands, 0);
  const primaryIsInert =
    primaryRows.length > 0 && primaryTotalDivergentPairs === 0 && primaryTotalPartedHands === 0;

  if (primaryIsInert) {
    inertReasons.push({
      code: 'PRIMARY_INERT',
      reason: `All ${primaryRows.length} PRIMARY cell-seed runs recorded 0 divergent pairs and 0 parted hands`,
    });
  }

  const inertGuardBreaches = [];
  for (const r of inertGuardRows) {
    const flipped =
      r.divergentPairs !== 0 ||
      r.partedHands !== 0 ||
      Math.abs(r.bb100) > 1e-12 ||
      Math.abs(r.stderr) > 1e-12;
    if (flipped) {
      inertGuardBreaches.push({
        key: r.key,
        divergentPairs: r.divergentPairs,
        partedHands: r.partedHands,
        bb100: r.bb100,
        stderr: r.stderr,
      });
      failReasons.push({
        code: 'INERT_GUARD_FLIPPED',
        reason: `inertGuard cell ${r.key} unexpectedly diverged (divergentPairs=${r.divergentPairs}, partedHands=${r.partedHands}, bb100=${r.bb100.toFixed(4)})`,
      });
    }
  }

  // Optional decided-spots floor check per cell
  const decidedSpotsChecks = [];
  for (const cell of manifest.cells) {
    if (cell.minDecidedSpots === null) continue;
    const cellRows = rows.filter((r) => r.cellId === cell.id);
    const hasAll =
      cellRows.length === cell.seeds.length && cellRows.every((r) => r.decidedSpots !== null);
    const totalSpots = hasAll ? cellRows.reduce((s, r) => s + r.decidedSpots, 0) : null;
    const ok = hasAll && totalSpots >= cell.minDecidedSpots;
    decidedSpotsChecks.push({
      cellId: cell.id,
      minRequired: cell.minDecidedSpots,
      observed: totalSpots,
      ok,
    });
    if (!ok) {
      noGainReasons.push({
        code: 'INSUFFICIENT_DECIDED_SPOTS',
        reason: `Cell ${cell.id} decidedSpots=${String(totalSpots)} is below declared floor ${cell.minDecidedSpots}`,
      });
    }
  }

  const bar1 = {
    name: 'BAR_1_FLIPS_AND_NON_INERT',
    ok: !primaryIsInert && inertGuardBreaches.length === 0,
    primaryInert: primaryIsInert,
    primaryTotalDivergentPairs,
    primaryTotalPartedHands,
    inertGuardCount: inertGuardRows.length,
    inertGuardOk: inertGuardBreaches.length === 0,
    inertGuardBreaches,
    decidedSpotsChecks,
    perCellFlips: rows.map((r) => ({
      key: r.key,
      cellId: r.cellId,
      role: r.role,
      inertGuard: r.inertGuard,
      seed: r.seed,
      hands: r.hands,
      divergentPairs: r.divergentPairs,
      partedHands: r.partedHands,
      inert: r.inert,
    })),
  };

  // --- Bar 2: CONTROL / OFF-vs-OFF -------------------------------------------------------------
  const controlFailures = [];
  if (bars.requireControl && controlRows.length === 0) {
    controlFailures.push({
      key: '<missing>',
      reason: 'No CONTROL (OFF-vs-OFF) rows present while requireControl=true',
    });
    voidReasons.push({
      code: 'CONTROL_MISSING',
      reason: 'CONTROL (OFF-vs-OFF) check is required but missing',
    });
  }
  let maxAbsControlBb100 = 0;
  let maxAbsControlStderr = 0;
  let totalControlPartedHands = 0;
  let totalControlDivergentPairs = 0;
  for (const r of controlRows) {
    maxAbsControlBb100 = Math.max(maxAbsControlBb100, Math.abs(r.bb100));
    maxAbsControlStderr = Math.max(maxAbsControlStderr, Math.abs(r.stderr));
    totalControlPartedHands += r.partedHands;
    totalControlDivergentPairs += r.divergentPairs;
    const isExactZero =
      r.divergentPairs === 0 &&
      r.partedHands === 0 &&
      Math.abs(r.bb100) === 0 &&
      Math.abs(r.stderr) === 0 &&
      r.hardFlags.ok;
    if (!isExactZero) {
      controlFailures.push({
        key: r.key,
        divergentPairs: r.divergentPairs,
        partedHands: r.partedHands,
        bb100: r.bb100,
        stderr: r.stderr,
        hardFlags: r.hardFlags,
      });
      voidReasons.push({
        code: 'CONTROL_NONZERO',
        reason: `CONTROL row ${r.key} is non-zero (divergentPairs=${r.divergentPairs}, partedHands=${r.partedHands}, bb100=${r.bb100}, stderr=${r.stderr}, hardFlags=${r.hardFlags.total})`,
      });
    }
  }
  const bar2 = {
    name: 'BAR_2_CONTROL_OFF_VS_OFF',
    ok: controlFailures.length === 0,
    required: bars.requireControl,
    controlRowCount: controlRows.length,
    totalControlDivergentPairs,
    totalControlPartedHands,
    maxAbsControlBb100,
    maxAbsControlStderr,
    failures: controlFailures,
  };

  // --- Bar 3: Hard Flags (Candidate Horse-Seat Illegal / Fallbacks / Truncated) ----------------
  const hardFlagFailures = [];
  let totalIllegal = 0;
  let totalFallbacks = 0;
  let totalTruncated = 0;
  for (const r of rows) {
    if (Number.isFinite(r.hardFlags.illegal)) totalIllegal += r.hardFlags.illegal;
    if (Number.isFinite(r.hardFlags.fallbacks)) totalFallbacks += r.hardFlags.fallbacks;
    if (Number.isFinite(r.hardFlags.truncated)) totalTruncated += r.hardFlags.truncated;
    if (!r.hardFlags.ok) {
      hardFlagFailures.push({
        key: r.key,
        role: r.role,
        illegal: r.hardFlags.illegal,
        fallbacks: r.hardFlags.fallbacks,
        truncated: r.hardFlags.truncated,
      });
      failReasons.push({
        code: 'HARD_FLAG_NONZERO',
        reason: `Hard flag non-zero on ${r.key} (${r.role}): illegal=${r.hardFlags.illegal}, brainFallbacks=${r.hardFlags.fallbacks}, truncated=${r.hardFlags.truncated}`,
      });
    }
  }
  const bar3 = {
    name: 'BAR_3_HARD_FLAGS',
    ok: hardFlagFailures.length === 0,
    totalIllegal,
    totalFallbacks,
    totalTruncated,
    failures: hardFlagFailures,
  };

  // --- Bar 4: IV-Pooled, Equal-Weight Cross-Check, z_fam(P) & z_fam(m) -------------------------
  const poolingMethod = bars.primaryPoolingMethod;
  const poolLabel = poolingMethod === 'equal_weight' ? 'EW' : 'IV';
  const selectPrimaryPool = (iv, ew) => {
    if (poolingMethod === 'equal_weight') {
      return ew && ew.valid ? { pool: ew, methodUsed: 'equal_weight', label: 'EW' } : null;
    }
    if (iv && iv.valid) {
      return { pool: iv, methodUsed: 'inverse_variance', label: 'IV' };
    }
    if (ew && ew.valid) {
      return { pool: ew, methodUsed: 'equal_weight', label: 'EW' };
    }
    return null;
  };

  const primaryIv = poolInverseVariance(primaryRows);
  const primaryEw = poolEqualWeight(primaryRows);

  // Per-cellId summary across seeds for PRIMARY (+ optional per-cell non-inferiority check)
  const primaryByCellId = {};
  const primaryPerCellBreaches = [];
  let primaryPerCellNonInferiorityOk = true;
  for (const cell of manifest.cells.filter((c) => c.role === 'PRIMARY')) {
    const cRows = primaryRows.filter((r) => r.cellId === cell.id);
    const iv = poolInverseVariance(cRows);
    const ew = poolEqualWeight(cRows);
    const cellAllInert =
      cRows.length > 0 &&
      cRows.every((r) => r.divergentPairs === 0 && r.partedHands === 0 && r.stderr === 0);

    let cellGainZ = null;
    let cellAdverseZ = null;
    let cellPoolValid = true;
    let cellNonInferiorityOk = true;
    let cellSelected = null;

    if (cRows.length > 0 && !primaryIsInert) {
      if (cellAllInert) {
        cellGainZ = 0;
        cellAdverseZ = 0;
        cellNonInferiorityOk = cellGainZ >= bars.primaryMinZ;
      } else {
        cellSelected = selectPrimaryPool(iv, ew);
        if (!cellSelected || !Number.isFinite(cellSelected.pool.z)) {
          cellPoolValid = false;
          cellNonInferiorityOk = false;
        } else {
          cellGainZ = directionalGainZ(cellSelected.pool.z, direction);
          cellAdverseZ = directionalAdverseZ(cellSelected.pool.z, direction);
          cellNonInferiorityOk = cellGainZ >= bars.primaryMinZ;
        }
      }

      if (bars.enforcePerPrimaryCell) {
        if (!cellPoolValid) {
          primaryPerCellNonInferiorityOk = false;
          primaryPerCellBreaches.push({
            cellId: cell.id,
            card: cell.card,
            group: cell.group,
            poolingMethod,
            mean: null,
            stderr: null,
            z: null,
            gainZ: null,
            primaryMinZ: bars.primaryMinZ,
            reason: 'invalid_pool',
          });
          failReasons.push({
            code: 'PRIMARY_CELL_POOL_INVALID',
            reason: `PRIMARY cell "${cell.id}" (group="${cell.group}") pool (${poolingMethod}) invalid: ${
              (poolingMethod === 'equal_weight' ? ew?.invalidReason : iv?.invalidReason) ??
              'unknown'
            }`,
          });
        } else if (!cellNonInferiorityOk) {
          primaryPerCellNonInferiorityOk = false;
          primaryPerCellBreaches.push({
            cellId: cell.id,
            card: cell.card,
            group: cell.group,
            poolingMethod: cellSelected?.methodUsed ?? poolingMethod,
            mean: cellSelected?.pool.mean ?? 0,
            stderr: cellSelected?.pool.stderr ?? 0,
            z: cellSelected?.pool.z ?? 0,
            gainZ: cellGainZ,
            primaryMinZ: bars.primaryMinZ,
          });
          failReasons.push({
            code: 'PRIMARY_CELL_REGRESSION',
            reason: `PRIMARY cell "${cell.id}" (group="${cell.group}") ${cellSelected?.label ?? poolLabel} gain z=${cellGainZ.toFixed(3)} is below primaryMinZ=${bars.primaryMinZ.toFixed(3)} (${cellSelected?.label ?? poolLabel} bb100=${(cellSelected?.pool.mean ?? 0).toFixed(2)} +/- ${(cellSelected?.pool.stderr ?? 0).toFixed(2)})`,
          });
        }
      }
    }

    primaryByCellId[cell.id] = {
      cellId: cell.id,
      card: cell.card,
      group: cell.group,
      poolingMethod,
      inverseVariance: iv,
      equalWeight: ew,
      gainZ: cellGainZ,
      adverseZ: cellAdverseZ,
      primaryMinZ: bars.primaryMinZ,
      enforced: bars.enforcePerPrimaryCell,
      nonInferiorityOk: cellNonInferiorityOk,
      passed: cellNonInferiorityOk,
      allInert: cellAllInert,
      seeds: cRows.length,
    };
  }

  // Group active (non-inertGuard) guard rows by group name
  const guardGroupOrder = [];
  const guardGroupMap = new Map();
  for (const r of activeGuardRows) {
    if (!guardGroupMap.has(r.group)) {
      guardGroupMap.set(r.group, []);
      guardGroupOrder.push(r.group);
    }
    guardGroupMap.get(r.group).push(r);
  }

  const P = guardGroupOrder.length;
  const guardPooledZBar =
    P > 0
      ? (bars.guardPooledZOverride ??
        computeZFam(P, { method: bars.zFamMethod, alphaFamily: bars.alphaFamily }))
      : null;

  const guardPooledGroups = [];
  const guardPooledBreaches = [];
  for (const group of guardGroupOrder) {
    const gRows = guardGroupMap.get(group);
    const iv = poolInverseVariance(gRows);
    const ew = poolEqualWeight(gRows);
    const allInert = gRows.every(
      (r) => r.divergentPairs === 0 && r.partedHands === 0 && r.stderr === 0
    );
    let adverseZ = 0;
    let passed = true;
    if (allInert) {
      adverseZ = 0;
      passed = true;
    } else if (!iv || !iv.valid) {
      adverseZ = Number.NaN;
      passed = false;
      failReasons.push({
        code: 'GUARD_GROUP_INVALID_SE',
        reason: `Guard group "${group}" cannot be IV-pooled: ${iv?.invalidReason ?? 'no observations'}`,
      });
    } else {
      adverseZ = directionalAdverseZ(iv.z, direction);
      passed = adverseZ <= guardPooledZBar;
      if (!passed) {
        guardPooledBreaches.push({
          group,
          ivMean: iv.mean,
          ivStderr: iv.stderr,
          ivZ: iv.z,
          adverseZ,
          threshold: guardPooledZBar,
        });
        failReasons.push({
          code: 'GUARD_POOLED_BAR_BREACH',
          reason: `Guard group "${group}" IV-pooled adverse z=${adverseZ.toFixed(3)} exceeds z_fam(${P})=${guardPooledZBar.toFixed(3)} (bb100=${iv.mean.toFixed(2)} +/- ${iv.stderr.toFixed(2)})`,
        });
      }
    }
    guardPooledGroups.push({
      group,
      count: gRows.length,
      allInert,
      inverseVariance: iv,
      equalWeight: ew,
      adverseZ,
      threshold: guardPooledZBar,
      passed,
    });
  }

  // Per-cell guard bar: active guard cells + optionally primary cells
  const includePrimaryInCellGuard =
    bars.includePrimarySeedsInCellGuard !== null ? bars.includePrimarySeedsInCellGuard : P === 0;
  const guardedCellRows = includePrimaryInCellGuard
    ? [...activeGuardRows, ...primaryRows]
    : [...activeGuardRows];
  const m = guardedCellRows.length;
  const guardCellZBar =
    m > 0
      ? (bars.guardCellZOverride ??
        computeZFam(m, { method: bars.zFamMethod, alphaFamily: bars.alphaFamily }))
      : null;

  const guardCellBreaches = [];
  let worstCell = null;
  for (const r of guardedCellRows) {
    if (!worstCell || r.adverseZ > worstCell.adverseZ) {
      worstCell = {
        key: r.key,
        role: r.role,
        group: r.group,
        bb100: r.bb100,
        stderr: r.stderr,
        z: r.z,
        adverseZ: r.adverseZ,
      };
    }
    if (r.stderr > 0 && r.adverseZ > guardCellZBar) {
      guardCellBreaches.push({
        key: r.key,
        role: r.role,
        group: r.group,
        bb100: r.bb100,
        stderr: r.stderr,
        z: r.z,
        adverseZ: r.adverseZ,
        threshold: guardCellZBar,
      });
      failReasons.push({
        code: 'GUARD_CELL_BAR_BREACH',
        reason: `Cell ${r.key} (${r.role}) adverse z=${r.adverseZ.toFixed(3)} exceeds z_fam(${m})=${guardCellZBar.toFixed(3)} (bb100=${r.bb100.toFixed(2)} +/- ${r.stderr.toFixed(2)})`,
      });
    }
  }

  // Primary pooled bar check (only if primary is non-inert and valid selected pool)
  let primaryOverallNonInferiorityOk = true;
  let primaryPositiveGainOk = !bars.requirePositiveGain;
  let primaryGainZ = null;
  let primaryAdverseZ = null;
  if (!primaryIsInert && primaryRows.length > 0) {
    const selected = selectPrimaryPool(primaryIv, primaryEw);
    if (!selected || !Number.isFinite(selected.pool.z)) {
      primaryOverallNonInferiorityOk = false;
      failReasons.push({
        code: 'PRIMARY_POOL_INVALID',
        reason: `Primary pool (${poolingMethod}) invalid: ${
          (poolingMethod === 'equal_weight'
            ? primaryEw?.invalidReason
            : primaryIv?.invalidReason) ?? 'unknown'
        }`,
      });
    } else {
      primaryGainZ = directionalGainZ(selected.pool.z, direction);
      primaryAdverseZ = directionalAdverseZ(selected.pool.z, direction);
      if (primaryGainZ < bars.primaryMinZ) {
        primaryOverallNonInferiorityOk = false;
        failReasons.push({
          code: 'PRIMARY_REGRESSION',
          reason: `PRIMARY pooled (${selected.methodUsed}) gain z=${primaryGainZ.toFixed(3)} is below primaryMinZ=${bars.primaryMinZ.toFixed(3)} (${selected.label} bb100=${selected.pool.mean.toFixed(2)} +/- ${selected.pool.stderr.toFixed(2)})`,
        });
      } else if (bars.requirePositiveGain && primaryGainZ < bars.primaryGainZ) {
        primaryPositiveGainOk = false;
        noGainReasons.push({
          code: 'PRIMARY_NO_GAIN',
          reason: `PRIMARY pooled (${selected.methodUsed}) gain z=${primaryGainZ.toFixed(3)} cleared non-inferiority (>= ${bars.primaryMinZ.toFixed(3)}) but did not clear primaryGainZ=${bars.primaryGainZ.toFixed(3)}`,
        });
      }
    }
  }

  const primaryNonInferiorityOk = primaryOverallNonInferiorityOk && primaryPerCellNonInferiorityOk;

  const bar4 = {
    name: 'BAR_4_STATISTICAL_POOLED_AND_FAMILY_GUARDS',
    ok:
      primaryNonInferiorityOk &&
      guardPooledBreaches.length === 0 &&
      guardCellBreaches.length === 0 &&
      guardPooledGroups.every((g) => g.passed),
    direction,
    zFamMethod: bars.zFamMethod,
    alphaFamily: bars.alphaFamily,
    primary: {
      poolingMethod,
      inverseVariance: primaryIv,
      equalWeight: primaryEw,
      gainZ: primaryGainZ,
      adverseZ: primaryAdverseZ,
      primaryMinZ: bars.primaryMinZ,
      requirePositiveGain: bars.requirePositiveGain,
      primaryGainZ: bars.primaryGainZ,
      nonInferiorityOk: primaryNonInferiorityOk,
      overallNonInferiorityOk: primaryOverallNonInferiorityOk,
      enforcePerPrimaryCell: bars.enforcePerPrimaryCell,
      requirePerPrimaryCellNonInferiority: bars.requirePerPrimaryCellNonInferiority,
      perCellNonInferiorityOk: primaryPerCellNonInferiorityOk,
      perCellBreaches: primaryPerCellBreaches,
      positiveGainOk: primaryPositiveGainOk,
      byCellId: primaryByCellId,
    },
    guardPooled: {
      P,
      zBar: guardPooledZBar,
      override: bars.guardPooledZOverride,
      groups: guardPooledGroups,
      breaches: guardPooledBreaches,
      ok: guardPooledBreaches.length === 0 && guardPooledGroups.every((g) => g.passed),
    },
    guardCell: {
      m,
      includePrimarySeeds: includePrimaryInCellGuard,
      zBar: guardCellZBar,
      override: bars.guardCellZOverride,
      worstCell,
      breaches: guardCellBreaches,
      ok: guardCellBreaches.length === 0,
    },
  };

  // --- Final Verdict Precedence: VOID > FAIL > INERT > NO-GAIN > PASS --------------------------
  let verdict = 'PASS';
  if (voidReasons.length > 0) {
    verdict = 'VOID';
  } else if (failReasons.length > 0) {
    verdict = 'FAIL';
  } else if (inertReasons.length > 0) {
    verdict = 'INERT';
  } else if (noGainReasons.length > 0) {
    verdict = 'NO-GAIN';
  }

  return {
    schemaVersion: HARNESS_SCHEMA_VERSION,
    option: manifest.option,
    description: manifest.description,
    verdict,
    provenance: {
      criteriaPath: manifest.criteriaPath,
      criteriaSha256: manifest.criteriaSha256,
      manifestSha256: provenance.manifestSha256 ?? sha256Hex(JSON.stringify(manifest)),
      gitHead: provenance.gitHead ?? null,
      gitTree: provenance.gitTree ?? null,
      runnerSha256: provenance.runnerSha256 ?? null,
      libSha256: provenance.libSha256 ?? null,
      resultsJsonlPath: provenance.resultsJsonlPath ?? null,
      resultsJsonlSha256: provenance.resultsJsonlSha256 ?? null,
      cellExitCodes,
    },
    bars: {
      bar1,
      bar2,
      bar3,
      bar4,
    },
    reasons: {
      void: voidReasons,
      fail: failReasons,
      inert: inertReasons,
      noGain: noGainReasons,
    },
    cells: rows,
  };
}

// --- VERDICT.md Renderer -----------------------------------------------------------------------

function fmt(n, digits = 2) {
  return typeof n === 'number' && Number.isFinite(n) ? n.toFixed(digits) : 'n/a';
}

export function renderVerdictMarkdown(result) {
  const { provenance: prov, bars, reasons } = result;
  const { bar1, bar2, bar3, bar4 } = bars;
  const lines = [];

  lines.push(`# Hold'em Option Grade Verdict: \`${result.option}\``);
  lines.push('');
  lines.push(`## Verdict: **${result.verdict}**`);
  if (result.description) {
    lines.push('');
    lines.push(result.description);
  }
  lines.push('');

  // Provenance block (VERIFIER-10 reproducible)
  lines.push('## Provenance (VERIFIER-10)');
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('|---|---|');
  lines.push(`| Schema | \`${result.schemaVersion}\` |`);
  lines.push(`| Criteria file | \`${prov.criteriaPath}\` |`);
  lines.push(`| Criteria sha256 | \`${prov.criteriaSha256}\` |`);
  lines.push(`| Manifest sha256 | \`${prov.manifestSha256 ?? 'n/a'}\` |`);
  lines.push(`| Git HEAD | \`${prov.gitHead ?? 'n/a'}\` |`);
  lines.push(`| Git tree | \`${prov.gitTree ?? 'n/a'}\` |`);
  lines.push(`| Runner sha256 | \`${prov.runnerSha256 ?? 'n/a'}\` |`);
  lines.push(`| Library sha256 | \`${prov.libSha256 ?? 'n/a'}\` |`);
  lines.push(`| Raw results.jsonl | \`${prov.resultsJsonlPath ?? 'n/a'}\` |`);
  lines.push(`| results.jsonl sha256 | \`${prov.resultsJsonlSha256 ?? 'n/a'}\` |`);
  const exitEntries = Object.entries(prov.cellExitCodes ?? {});
  const allZeroExits = exitEntries.length > 0 && exitEntries.every(([, code]) => code === 0);
  lines.push(
    `| Cell exit codes | ${exitEntries.length} total (${allZeroExits ? 'all 0' : exitEntries.map(([k, v]) => `${k}=${v}`).join(', ')}) |`
  );
  lines.push('');

  // Bar 1: FLIPS FIRST (always before any chip figure!)
  lines.push(
    `## Bar 1 — Flips-First & Non-Inert (${bar1.ok ? 'PASS' : bar1.primaryInert ? 'INERT' : 'FAIL'})`
  );
  lines.push('');
  lines.push(
    `- Primary total: **${bar1.primaryTotalPartedHands}** parted hands / **${bar1.primaryTotalDivergentPairs}** divergent pairs (${bar1.primaryInert ? 'INERT' : 'NON-INERT'}).`
  );
  lines.push(
    `- Inert guards (\`inertGuard: true\`): **${bar1.inertGuardCount}** checked, **${bar1.inertGuardBreaches.length}** breach(es).`
  );
  lines.push('');
  lines.push(
    '| Cell | Role | Inert Guard | Seed | Hands | Parted Hands | Divergent Pairs | Inert |'
  );
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const row of bar1.perCellFlips) {
    lines.push(
      `| \`${row.cellId}\` | ${row.role} | ${row.inertGuard ? 'yes' : 'no'} | ${row.seed} | ${row.hands} | ${row.partedHands} | ${row.divergentPairs} | ${row.inert ? 'yes' : 'no'} |`
    );
  }
  lines.push('');

  // Bar 2: CONTROL / OFF-vs-OFF
  lines.push(`## Bar 2 — CONTROL / OFF-vs-OFF (${bar2.ok ? 'PASS' : 'VOID'})`);
  lines.push('');
  lines.push(
    `- Control rows: **${bar2.controlRowCount}**, total parted hands: **${bar2.totalControlPartedHands}**, total divergent pairs: **${bar2.totalControlDivergentPairs}**, max |bb/100|: **${fmt(bar2.maxAbsControlBb100, 4)}**, max |SE|: **${fmt(bar2.maxAbsControlStderr, 4)}**.`
  );
  lines.push('');

  // Bar 3: Hard Flags
  lines.push(`## Bar 3 — Hard Flags (${bar3.ok ? 'PASS' : 'FAIL'})`);
  lines.push('');
  lines.push(
    `- Candidate Horse-seat totals: illegal=**${bar3.totalIllegal}**, brainFallbacks=**${bar3.totalFallbacks}**, truncated=**${bar3.totalTruncated}**.`
  );
  lines.push('');

  // Bar 4: IV-Pooled, Equal-Weight Cross-Check, z_fam(P), z_fam(m)
  lines.push(`## Bar 4 — Statistical Pooling & Family Guard Bars (${bar4.ok ? 'PASS' : 'FAIL'})`);
  lines.push('');
  const pIv = bar4.primary.inverseVariance;
  const pEw = bar4.primary.equalWeight;
  const pMethod = bar4.primary.poolingMethod ?? 'inverse_variance';
  lines.push(
    `- Direction: \`${bar4.direction}\` | Primary pooling: \`${pMethod}\` | Family method: \`${bar4.zFamMethod}\` (\`alpha_fam = ${fmt(bar4.alphaFamily, 6)}\`)`
  );
  lines.push(
    `- PRIMARY Inverse-Variance Pooled: **${pIv?.valid ? `${fmt(pIv.mean, 3)} ± ${fmt(pIv.stderr, 3)} bb/100 (z = ${fmt(pIv.z, 3)})` : 'n/a'}**`
  );
  lines.push(
    `- PRIMARY Equal-Weight Cross-Check: **${pEw?.valid ? `${fmt(pEw.mean, 3)} ± ${fmt(pEw.stderr, 3)} bb/100 (z = ${fmt(pEw.z, 3)})` : 'n/a'}**`
  );
  lines.push(
    `- PRIMARY Bar (\`${pMethod}\`): gainZ = **${fmt(bar4.primary.gainZ, 3)}** vs primaryMinZ = **${fmt(bar4.primary.primaryMinZ, 3)}** (${bar4.primary.overallNonInferiorityOk !== false ? 'PASS' : 'FAIL'})` +
      (bar4.primary.requirePositiveGain
        ? ` (requirePositiveGain: primaryGainZ = **${fmt(bar4.primary.primaryGainZ, 3)}**)`
        : '')
  );
  if (bar4.primary.enforcePerPrimaryCell) {
    lines.push(
      `- PRIMARY Per-Cell Non-Inferiority (\`enforcePerPrimaryCell=true\`): **${bar4.primary.perCellNonInferiorityOk ? 'PASS' : 'FAIL'}** (breaches=${bar4.primary.perCellBreaches?.length ?? 0}, primaryMinZ = **${fmt(bar4.primary.primaryMinZ, 3)}**)`
    );
  }
  lines.push(
    `- Guard Pooled Bar (\`P = ${bar4.guardPooled.P}\`): \`z_fam(${bar4.guardPooled.P})\` = **${fmt(bar4.guardPooled.zBar, 3)}** (${bar4.guardPooled.ok ? 'PASS' : 'FAIL'}, breaches=${bar4.guardPooled.breaches.length})`
  );
  lines.push(
    `- Guard Per-Cell Bar (\`m = ${bar4.guardCell.m}\`, includePrimary=${bar4.guardCell.includePrimarySeeds}): \`z_fam(${bar4.guardCell.m})\` = **${fmt(bar4.guardCell.zBar, 3)}** (${bar4.guardCell.ok ? 'PASS' : 'FAIL'}, breaches=${bar4.guardCell.breaches.length})`
  );
  if (bar4.guardCell.worstCell) {
    const wc = bar4.guardCell.worstCell;
    lines.push(
      `- Worst guarded cell: \`${wc.key}\` (${wc.role}) bb/100 = **${fmt(wc.bb100, 3)} ± ${fmt(wc.stderr, 3)}**, z = **${fmt(wc.z, 3)}**, adverseZ = **${fmt(wc.adverseZ, 3)}**`
    );
  }
  lines.push('');

  const primaryCellEntries = Object.entries(bar4.primary.byCellId ?? {});
  if (primaryCellEntries.length > 1 || bar4.primary.enforcePerPrimaryCell) {
    lines.push('### Primary Cells (Per-Cell Pooling & Non-Inferiority)');
    lines.push('');
    lines.push(
      '| Cell | Group | Seeds | IV bb/100 ± SE | IV z | EW bb/100 ± SE | EW z | gainZ | primaryMinZ | Enforced | Pass |'
    );
    lines.push('|---|---|---|---|---|---|---|---|---|---|---|');
    for (const [cellId, c] of primaryCellEntries) {
      const ivStr = c.inverseVariance?.valid
        ? `${fmt(c.inverseVariance.mean, 3)} ± ${fmt(c.inverseVariance.stderr, 3)}`
        : c.allInert
          ? 'inert'
          : 'n/a';
      const ewStr = c.equalWeight?.valid
        ? `${fmt(c.equalWeight.mean, 3)} ± ${fmt(c.equalWeight.stderr, 3)}`
        : 'n/a';
      lines.push(
        `| \`${cellId}\` | \`${c.group}\` | ${c.seeds} | ${ivStr} | ${fmt(c.inverseVariance?.z, 3)} | ${ewStr} | ${fmt(c.equalWeight?.z, 3)} | ${fmt(c.gainZ, 3)} | ${fmt(c.primaryMinZ, 3)} | ${c.enforced ? 'yes' : 'no'} | ${c.passed ? 'yes' : 'NO'} |`
      );
    }
    lines.push('');
  }

  if (bar4.guardPooled.groups.length > 0) {
    lines.push('### Guard Groups (IV-Pooled + Equal-Weight Cross-Check)');
    lines.push('');
    lines.push(
      '| Group | Cells | IV bb/100 ± SE | IV z | EW bb/100 ± SE | adverseZ | z_fam(P) | Pass |'
    );
    lines.push('|---|---|---|---|---|---|---|---|');
    for (const g of bar4.guardPooled.groups) {
      const ivStr = g.inverseVariance?.valid
        ? `${fmt(g.inverseVariance.mean, 3)} ± ${fmt(g.inverseVariance.stderr, 3)}`
        : 'inert/n/a';
      const ewStr = g.equalWeight?.valid
        ? `${fmt(g.equalWeight.mean, 3)} ± ${fmt(g.equalWeight.stderr, 3)}`
        : 'n/a';
      lines.push(
        `| \`${g.group}\` | ${g.count} | ${ivStr} | ${fmt(g.inverseVariance?.z, 3)} | ${ewStr} | ${fmt(g.adverseZ, 3)} | ${fmt(g.threshold, 3)} | ${g.passed ? 'yes' : 'NO'} |`
      );
    }
    lines.push('');
  }

  lines.push('### Per-Cell Statistical Results');
  lines.push('');
  lines.push('| Cell | Role | Seed | bb/100 | SE | z | adverseZ | illegal/fb/trunc | exit |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const r of result.cells) {
    lines.push(
      `| \`${r.cellId}\` | ${r.role}${r.inertGuard ? ' (inert)' : ''} | ${r.seed} | ${fmt(r.bb100, 3)} | ${fmt(r.stderr, 3)} | ${fmt(r.z, 3)} | ${fmt(r.adverseZ, 3)} | ${r.hardFlags.illegal}/${r.hardFlags.fallbacks}/${r.hardFlags.truncated} | ${r.exitCode} |`
    );
  }
  lines.push('');

  // Reasons section
  const allReasons = [
    ...reasons.void.map((r) => `VOID [${r.code}]: ${r.reason}`),
    ...reasons.fail.map((r) => `FAIL [${r.code}]: ${r.reason}`),
    ...reasons.inert.map((r) => `INERT [${r.code}]: ${r.reason}`),
    ...reasons.noGain.map((r) => `NO-GAIN [${r.code}]: ${r.reason}`),
  ];
  if (allReasons.length > 0) {
    lines.push('## Findings / Reasons');
    lines.push('');
    for (const line of allReasons) {
      lines.push(`- ${line}`);
    }
    lines.push('');
  }

  lines.push('## Independent VERIFIER-10 Recomputation');
  lines.push('');
  lines.push('```bash');
  lines.push(
    `node scripts/ops/grade-holdem-option.mjs recompute --manifest=<manifest.json> --criteria-sha=${prov.criteriaSha256} --results=<results.jsonl> --compare=<verdict.json>`
  );
  lines.push('```');
  lines.push('');

  return `${lines.join('\n')}`;
}

// --- VERIFIER-10 Recompute Parity Comparator ---------------------------------------------------

function approxEqual(a, b, tol) {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) && Number.isNaN(b)) return true;
    return Math.abs(a - b) <= tol;
  }
  return false;
}

export function compareVerdictsForRecompute(expected, recomputed, tolerance = 1e-9) {
  const diffs = [];

  if (expected?.verdict !== recomputed?.verdict) {
    diffs.push(
      `verdict mismatch: expected ${expected?.verdict}, recomputed ${recomputed?.verdict}`
    );
  }
  if (expected?.option !== recomputed?.option) {
    diffs.push(`option mismatch: expected ${expected?.option}, recomputed ${recomputed?.option}`);
  }
  if (expected?.provenance?.criteriaSha256 !== recomputed?.provenance?.criteriaSha256) {
    diffs.push(
      `criteriaSha256 mismatch: expected ${expected?.provenance?.criteriaSha256}, recomputed ${recomputed?.provenance?.criteriaSha256}`
    );
  }
  if (
    expected?.provenance?.resultsJsonlSha256 &&
    recomputed?.provenance?.resultsJsonlSha256 &&
    expected.provenance.resultsJsonlSha256 !== recomputed.provenance.resultsJsonlSha256
  ) {
    diffs.push(
      `resultsJsonlSha256 mismatch: expected ${expected.provenance.resultsJsonlSha256}, recomputed ${recomputed.provenance.resultsJsonlSha256}`
    );
  }

  // Compare bar booleans
  for (const barKey of ['bar1', 'bar2', 'bar3', 'bar4']) {
    if (expected?.bars?.[barKey]?.ok !== recomputed?.bars?.[barKey]?.ok) {
      diffs.push(
        `${barKey}.ok mismatch: expected ${String(expected?.bars?.[barKey]?.ok)}, recomputed ${String(recomputed?.bars?.[barKey]?.ok)}`
      );
    }
  }
  if (
    expected?.bars?.bar4?.primary?.poolingMethod !== undefined &&
    expected.bars.bar4.primary.poolingMethod !== recomputed?.bars?.bar4?.primary?.poolingMethod
  ) {
    diffs.push(
      `bar4.primary.poolingMethod mismatch: expected ${String(expected.bars.bar4.primary.poolingMethod)}, recomputed ${String(recomputed?.bars?.bar4?.primary?.poolingMethod)}`
    );
  }
  if (
    expected?.bars?.bar4?.primary?.perCellNonInferiorityOk !== undefined &&
    expected.bars.bar4.primary.perCellNonInferiorityOk !==
      recomputed?.bars?.bar4?.primary?.perCellNonInferiorityOk
  ) {
    diffs.push(
      `bar4.primary.perCellNonInferiorityOk mismatch: expected ${String(expected.bars.bar4.primary.perCellNonInferiorityOk)}, recomputed ${String(recomputed?.bars?.bar4?.primary?.perCellNonInferiorityOk)}`
    );
  }

  // Compare primary IV and EW pooled statistics
  const checks = [
    [
      'bar4.primary.iv.mean',
      expected?.bars?.bar4?.primary?.inverseVariance?.mean,
      recomputed?.bars?.bar4?.primary?.inverseVariance?.mean,
    ],
    [
      'bar4.primary.iv.stderr',
      expected?.bars?.bar4?.primary?.inverseVariance?.stderr,
      recomputed?.bars?.bar4?.primary?.inverseVariance?.stderr,
    ],
    [
      'bar4.primary.iv.z',
      expected?.bars?.bar4?.primary?.inverseVariance?.z,
      recomputed?.bars?.bar4?.primary?.inverseVariance?.z,
    ],
    [
      'bar4.primary.ew.mean',
      expected?.bars?.bar4?.primary?.equalWeight?.mean,
      recomputed?.bars?.bar4?.primary?.equalWeight?.mean,
    ],
    [
      'bar4.primary.ew.stderr',
      expected?.bars?.bar4?.primary?.equalWeight?.stderr,
      recomputed?.bars?.bar4?.primary?.equalWeight?.stderr,
    ],
    [
      'bar4.primary.ew.z',
      expected?.bars?.bar4?.primary?.equalWeight?.z,
      recomputed?.bars?.bar4?.primary?.equalWeight?.z,
    ],
    [
      'bar4.primary.gainZ',
      expected?.bars?.bar4?.primary?.gainZ,
      recomputed?.bars?.bar4?.primary?.gainZ,
    ],
    [
      'bar4.guardPooled.zBar',
      expected?.bars?.bar4?.guardPooled?.zBar,
      recomputed?.bars?.bar4?.guardPooled?.zBar,
    ],
    [
      'bar4.guardCell.zBar',
      expected?.bars?.bar4?.guardCell?.zBar,
      recomputed?.bars?.bar4?.guardCell?.zBar,
    ],
  ];
  for (const [label, a, b] of checks) {
    if (!approxEqual(a, b, tolerance)) {
      diffs.push(`${label} mismatch: expected ${String(a)}, recomputed ${String(b)}`);
    }
  }

  // Compare cell count and per-cell key/bb100/stderr/partedHands/divergentPairs
  const expCells = expected?.cells ?? [];
  const recCells = recomputed?.cells ?? [];
  if (expCells.length !== recCells.length) {
    diffs.push(`cells.length mismatch: expected ${expCells.length}, recomputed ${recCells.length}`);
  } else {
    for (let i = 0; i < expCells.length; i += 1) {
      const e = expCells[i];
      const r = recCells[i];
      if (e.key !== r.key) {
        diffs.push(`cells[${i}].key mismatch: expected ${e.key}, recomputed ${r.key}`);
        continue;
      }
      for (const field of ['bb100', 'stderr', 'z', 'divergentPairs', 'partedHands', 'exitCode']) {
        if (!approxEqual(e[field], r[field], tolerance)) {
          diffs.push(
            `cells[${e.key}].${field} mismatch: expected ${e[field]}, recomputed ${r[field]}`
          );
        }
      }
    }
  }

  return {
    ok: diffs.length === 0,
    diffs,
  };
}

// --- CLI Argument Parser -----------------------------------------------------------------------

export function parseGradeCliArgs(argv, lockResolutionOptions = {}) {
  if (!Array.isArray(argv) || argv.length === 0) {
    return { command: 'help', flags: {} };
  }
  const command = argv[0];
  if (command === '-h' || command === '--help' || command === 'help') {
    return { command: 'help', flags: {} };
  }
  const defaultLockPaths = resolveDefaultLockPaths(lockResolutionOptions);
  const flags = {
    manifest: null,
    criteriaSha: null,
    criteriaPath: null,
    outDir: null,
    results: null,
    compare: null,
    workdir: null,
    shepherdLock: defaultLockPaths.shepherdLock,
    coreGateScript: defaultLockPaths.coreGateScript,
    laneLock: null,
    laneOwner: null,
    maxLoad1m: null,
    maxLoad1mWhilePushLocked: null,
    json: false,
    resume: false,
  };

  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      flags.json = true;
      continue;
    }
    if (arg === '--resume') {
      flags.resume = true;
      continue;
    }
    const eqIdx = arg.indexOf('=');
    let key;
    let val;
    if (arg.startsWith('--') && eqIdx > 2) {
      key = arg.slice(2, eqIdx);
      val = arg.slice(eqIdx + 1);
    } else if (arg.startsWith('--') && i + 1 < argv.length) {
      key = arg.slice(2);
      val = argv[i + 1];
      i += 1;
    } else {
      throw new Error(`Unknown or malformed CLI argument: "${arg}"`);
    }

    switch (key) {
      case 'manifest':
        flags.manifest = val;
        break;
      case 'criteria-sha':
        flags.criteriaSha = val;
        break;
      case 'criteria':
      case 'criteria-path':
        flags.criteriaPath = val;
        break;
      case 'out':
      case 'out-dir':
        flags.outDir = val;
        break;
      case 'results':
        flags.results = val;
        break;
      case 'compare':
        flags.compare = val;
        break;
      case 'workdir':
        flags.workdir = val;
        break;
      case 'shepherd-lock':
        flags.shepherdLock = val;
        break;
      case 'core-gate-script':
        flags.coreGateScript = val;
        break;
      case 'lane-lock':
        flags.laneLock = val;
        break;
      case 'lane-owner':
        flags.laneOwner = val;
        break;
      case 'max-load':
        flags.maxLoad1m = Number(val);
        break;
      case 'max-load-while-push-locked':
        flags.maxLoad1mWhilePushLocked = Number(val);
        break;
      default:
        throw new Error(`Unknown CLI flag: "--${key}"`);
    }
  }

  return { command, flags };
}
