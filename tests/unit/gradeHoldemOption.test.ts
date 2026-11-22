// tests/unit/gradeHoldemOption.test.ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ONE_SIGMA_TAIL_ALPHA,
  compareVerdictsForRecompute,
  computeZFam,
  evaluateHoldemGrade,
  evaluateSystemGate,
  normalCdf,
  normalQuantile,
  parseHorseLeagueOutput,
  parseResultsJsonl,
  poolEqualWeight,
  poolInverseVariance,
  renderVerdictMarkdown,
  serializeResultsJsonl,
  sha256Hex,
  validateCriteriaManifest,
  verifyCriteriaContent,
} from '../../scripts/ops/grade-holdem-option-lib.mjs';
import {
  CONTROL_RUNNER_SOURCE,
  EXIT_OK,
  EXIT_REFUSED,
  runGradeCli,
} from '../../scripts/ops/grade-holdem-option.mjs';
import { resolveLeagueCard } from '../../server/src/benchmark/HorseLeagueCard.js';

const CRITERIA_TEXT = '# Pre-Run Criteria: v80TopPairStrongKicker\nFrozen before grade.\n';
const CRITERIA_SHA = sha256Hex(CRITERIA_TEXT);
const GIT_HEAD = 'f90aa478ae358011100a7787a93c69d39c982668';
const GIT_TREE = '11223344556677889900aabbccddeeff00112233';

function makeV80Manifest(overrides: Record<string, unknown> = {}) {
  return {
    option: 'v80TopPairStrongKicker',
    description: 'v80 blanket-off grade (4 primary seeds + 4 HU inertGuard seeds + control)',
    criteriaPath: 'CRITERIA.md',
    criteriaSha256: CRITERIA_SHA,
    bars: {
      direction: 'higher_is_better',
      zFamMethod: 'sidak',
      primaryMinZ: -1.0,
      requirePositiveGain: false,
      requireControl: true,
      enforceRevisionMatch: true,
      maxLoad1m: 35,
    },
    cells: [
      {
        id: 'cash6_v80',
        card: 'cash6_v80_top_pair_strong_kicker_off',
        role: 'PRIMARY',
        group: 'cash6_v80',
        inertGuard: false,
        seeds: [20261122, 20261123, 20261124, 20261125],
        pairs: 6000,
      },
      {
        id: 'hu_v80',
        card: 'hu_v80_top_pair_strong_kicker_off',
        role: 'GUARD',
        group: 'hu_v80',
        inertGuard: true,
        seeds: [20261122, 20261123, 20261124, 20261125],
        pairs: 6000,
      },
      {
        id: 'ctrl_v80',
        card: 'cash6_v80_top_pair_strong_kicker_off',
        role: 'CONTROL',
        group: 'ctrl_v80',
        inertGuard: false,
        seeds: [20261122],
        pairs: 6000,
      },
    ],
    ...overrides,
  };
}

function makePassingV80Records() {
  return [
    {
      cellId: 'cash6_v80',
      seed: 20261122,
      hands: 12000,
      bb100: 1.4,
      stderr: 1.8,
      divergentPairs: 42,
      partedHands: 42,
      inert: false,
      illegalActions: 0,
      truncatedStreets: 0,
      brainExceptionFallbacks: 0,
      exitCode: 0,
      engineRevision: GIT_HEAD,
    },
    {
      cellId: 'cash6_v80',
      seed: 20261123,
      hands: 12000,
      bb100: 0.9,
      stderr: 1.6,
      divergentPairs: 39,
      partedHands: 39,
      inert: false,
      illegalActions: 0,
      truncatedStreets: 0,
      brainExceptionFallbacks: 0,
      exitCode: 0,
      engineRevision: GIT_HEAD,
    },
    {
      cellId: 'cash6_v80',
      seed: 20261124,
      hands: 12000,
      bb100: -0.4,
      stderr: 1.9,
      divergentPairs: 44,
      partedHands: 44,
      inert: false,
      illegalActions: 0,
      truncatedStreets: 0,
      brainExceptionFallbacks: 0,
      exitCode: 0,
      engineRevision: GIT_HEAD,
    },
    {
      cellId: 'cash6_v80',
      seed: 20261125,
      hands: 12000,
      bb100: 1.1,
      stderr: 1.7,
      divergentPairs: 38,
      partedHands: 38,
      inert: false,
      illegalActions: 0,
      truncatedStreets: 0,
      brainExceptionFallbacks: 0,
      exitCode: 0,
      engineRevision: GIT_HEAD,
    },
    ...[20261122, 20261123, 20261124, 20261125].map((seed) => ({
      cellId: 'hu_v80',
      seed,
      hands: 12000,
      bb100: 0,
      stderr: 0,
      divergentPairs: 0,
      partedHands: 0,
      inert: true,
      illegalActions: 0,
      truncatedStreets: 0,
      brainExceptionFallbacks: 0,
      exitCode: 0,
      engineRevision: GIT_HEAD,
    })),
    {
      cellId: 'ctrl_v80',
      seed: 20261122,
      hands: 12000,
      bb100: 0,
      stderr: 0,
      divergentPairs: 0,
      partedHands: 0,
      inert: true,
      illegalActions: 0,
      truncatedStreets: 0,
      brainExceptionFallbacks: 0,
      exitCode: 0,
      engineRevision: GIT_HEAD,
    },
  ];
}

function makeCleanGateInput(overrides: Record<string, unknown> = {}) {
  return {
    shepherdLockExists: false,
    laneLock: { exists: false, owner: null, path: null },
    expectedLaneOwner: 'hs-enh2-151f9a34',
    load1m: 12.4,
    maxLoad1m: 35,
    coreGateExitCode: 1,
    coreGateOutput: 'core gate clear',
    gitHead: GIT_HEAD,
    gitTree: GIT_TREE,
    gitPorcelain: '',
    criteriaVerification: verifyCriteriaContent({
      criteriaPath: '/work/CRITERIA.md',
      criteriaBytes: CRITERIA_TEXT,
      expectedSha256: CRITERIA_SHA,
    }),
    checkedAtUtc: '2026-11-22T02:45:00.000Z',
    ...overrides,
  };
}

describe('Unified Holdem Grade Harness — criteria & manifest validation', () => {
  it('1. verifies exact criteria SHA256 and refuses missing, empty, or mismatched criteria', () => {
    const ok = verifyCriteriaContent({
      criteriaPath: '/work/CRITERIA.md',
      criteriaBytes: CRITERIA_TEXT,
      expectedSha256: CRITERIA_SHA,
    });
    expect(ok.ok).toBe(true);
    expect(ok.actualSha256).toBe(CRITERIA_SHA);

    const missing = verifyCriteriaContent({
      criteriaPath: '/work/CRITERIA.md',
      criteriaBytes: null,
      expectedSha256: CRITERIA_SHA,
    });
    expect(missing.ok).toBe(false);
    expect(missing.failures.map((f: { code: string }) => f.code)).toContain(
      'CRITERIA_FILE_MISSING'
    );

    const empty = verifyCriteriaContent({
      criteriaPath: '/work/CRITERIA.md',
      criteriaBytes: '',
      expectedSha256: CRITERIA_SHA,
    });
    expect(empty.ok).toBe(false);
    expect(empty.failures.map((f: { code: string }) => f.code)).toContain('CRITERIA_FILE_EMPTY');

    const mismatch = verifyCriteriaContent({
      criteriaPath: '/work/CRITERIA.md',
      criteriaBytes: `${CRITERIA_TEXT}tampered`,
      expectedSha256: CRITERIA_SHA,
    });
    expect(mismatch.ok).toBe(false);
    expect(mismatch.failures.map((f: { code: string }) => f.code)).toContain(
      'CRITERIA_SHA_MISMATCH'
    );
  });

  it('2. validates manifest schema and refuses invalid cell/role/seed definitions', () => {
    const valid = validateCriteriaManifest(makeV80Manifest());
    expect(valid.option).toBe('v80TopPairStrongKicker');
    expect(valid.cells).toHaveLength(3);

    // inertGuard on PRIMARY is refused
    expect(() =>
      validateCriteriaManifest(
        makeV80Manifest({
          cells: [
            {
              id: 'p1',
              card: 'cash6_v80_top_pair_strong_kicker_off',
              role: 'PRIMARY',
              inertGuard: true,
              seeds: [20261122],
              pairs: 6000,
            },
            {
              id: 'c1',
              card: 'cash6_v80_top_pair_strong_kicker_off',
              role: 'CONTROL',
              seeds: [20261122],
              pairs: 6000,
            },
          ],
        })
      )
    ).toThrow(/inertGuard is only valid on GUARD/);

    // Duplicate seeds refused
    expect(() =>
      validateCriteriaManifest(
        makeV80Manifest({
          cells: [
            {
              id: 'p1',
              card: 'cash6_v80_top_pair_strong_kicker_off',
              role: 'PRIMARY',
              seeds: [20261122, 20261122],
              pairs: 6000,
            },
            {
              id: 'c1',
              card: 'cash6_v80_top_pair_strong_kicker_off',
              role: 'CONTROL',
              seeds: [20261122],
              pairs: 6000,
            },
          ],
        })
      )
    ).toThrow(/duplicate seed/);

    // Missing CONTROL when requireControl=true refused
    expect(() =>
      validateCriteriaManifest(
        makeV80Manifest({
          cells: [
            {
              id: 'p1',
              card: 'cash6_v80_top_pair_strong_kicker_off',
              role: 'PRIMARY',
              seeds: [20261122],
              pairs: 6000,
            },
          ],
        })
      )
    ).toThrow(/CONTROL/);
  });
});

describe('Unified Holdem Grade Harness — system gate evaluator', () => {
  it('3. passes when all system gates are clear and records exact git HEAD + tree SHAs', () => {
    const gate = evaluateSystemGate(makeCleanGateInput());
    expect(gate.ok).toBe(true);
    expect(gate.failures).toEqual([]);
    expect(gate.provenance.gitHead).toBe(GIT_HEAD);
    expect(gate.provenance.gitTree).toBe(GIT_TREE);
    expect(gate.provenance.criteriaSha256).toBe(CRITERIA_SHA);
  });

  it('4. refuses dirty git working tree and missing/invalid git SHAs', () => {
    const dirty = evaluateSystemGate(makeCleanGateInput({ gitPorcelain: ' M server/src/a.ts\n' }));
    expect(dirty.ok).toBe(false);
    expect(dirty.failures.map((f: { code: string }) => f.code)).toContain('GIT_DIRTY_TREE');

    const badHead = evaluateSystemGate(makeCleanGateInput({ gitHead: 'not-a-sha' }));
    expect(badHead.ok).toBe(false);
    expect(badHead.failures.map((f: { code: string }) => f.code)).toContain(
      'GIT_PROVENANCE_INVALID'
    );
  });

  it('5. refuses shepherd.lock present, load1m >= 35, core-gate running/unreadable, and foreign lane lock', () => {
    const lock = evaluateSystemGate(makeCleanGateInput({ shepherdLockExists: true }));
    expect(lock.ok).toBe(false);
    expect(lock.failures.map((f: { code: string }) => f.code)).toContain('SHEPHERD_LOCK_PRESENT');

    const highLoad = evaluateSystemGate(makeCleanGateInput({ load1m: 35.0 }));
    expect(highLoad.ok).toBe(false);
    expect(highLoad.failures.map((f: { code: string }) => f.code)).toContain(
      'SYSTEM_LOAD_TOO_HIGH'
    );

    const coreRunning = evaluateSystemGate(makeCleanGateInput({ coreGateExitCode: 0 }));
    expect(coreRunning.ok).toBe(false);
    expect(coreRunning.failures.map((f: { code: string }) => f.code)).toContain(
      'CORE_GATE_RUNNING'
    );

    const coreErr = evaluateSystemGate(makeCleanGateInput({ coreGateExitCode: 2 }));
    expect(coreErr.ok).toBe(false);
    expect(coreErr.failures.map((f: { code: string }) => f.code)).toContain(
      'CORE_GATE_CHECK_FAILED'
    );

    const foreignLock = evaluateSystemGate(
      makeCleanGateInput({
        laneLock: { exists: true, owner: 'other-lane-999', path: '/locks/grade.lock' },
        expectedLaneOwner: 'hs-enh2-151f9a34',
      })
    );
    expect(foreignLock.ok).toBe(false);
    expect(foreignLock.failures.map((f: { code: string }) => f.code)).toContain(
      'LANE_LOCK_FOREIGN_OWNER'
    );
  });
});

describe('Unified Holdem Grade Harness — exact statistical math (VERIFIER-10 parity)', () => {
  it('6. normalCdf & normalQuantile are accurate inverses across tails and center', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.0)).toBeCloseTo(0.8413447, 6);
    expect(normalQuantile(0.5)).toBeCloseTo(0, 8);
    expect(normalQuantile(1 - ONE_SIGMA_TAIL_ALPHA)).toBeCloseTo(1.0, 7);
    expect(normalQuantile(0.975)).toBeCloseTo(1.95996398, 6);
    expect(normalQuantile(0.025)).toBeCloseTo(-1.95996398, 6);
  });

  it('7. computeZFam reproduces exact LEAD-3-RULING-1 / VERIFIER-10 thresholds', () => {
    expect(computeZFam(1)).toBeCloseTo(1.0, 3);
    expect(computeZFam(6)).toBeCloseTo(1.905, 3);
    expect(computeZFam(7)).toBeCloseTo(1.971, 3);
    expect(computeZFam(10)).toBeCloseTo(2.117, 3);
    expect(computeZFam(12)).toBeCloseTo(2.189, 3);
    expect(computeZFam(13)).toBeCloseTo(2.2203, 4);
    expect(computeZFam(19)).toBeCloseTo(2.3635, 4);
    expect(computeZFam(48)).toBeCloseTo(2.6881, 4);
    expect(computeZFam(56)).toBeCloseTo(2.7391, 4);
    expect(computeZFam(66)).toBeCloseTo(2.7926, 4);
  });

  it('8. computeZFam Bonferroni mode matches Phi^-1(1 - alpha/m) and is strictly >= Sidak for m > 1', () => {
    const zSidak = computeZFam(7, { method: 'sidak' });
    const zBonf = computeZFam(7, { method: 'bonferroni' });
    expect(zBonf).toBeCloseTo(2.0016, 3);
    expect(zBonf).toBeGreaterThan(zSidak);
    const zBonf05 = computeZFam(10, { method: 'bonferroni', alphaFamily: 0.05 });
    expect(zBonf05).toBeCloseTo(2.5758, 3);
  });

  it('9. poolInverseVariance and poolEqualWeight match exact textbook and VERIFIER-10 arithmetic', () => {
    // VERIFIER-10 example from inbox: (+12.64 +- 6.51, +5.18 +- 4.72) -> +7.75 +- 3.82, z +2.03
    const iv = poolInverseVariance([
      { bb100: 12.64, stderr: 6.51 },
      { bb100: 5.18, stderr: 4.72 },
    ]);
    expect(iv.valid).toBe(true);
    expect(iv.mean).toBeCloseTo(7.752, 2);
    expect(iv.stderr).toBeCloseTo(3.822, 2);
    expect(iv.z).toBeCloseTo(2.028, 2);

    // Equal-weight cross-check differs visibly when SEs are unequal
    const ew = poolEqualWeight([
      { bb100: 12.64, stderr: 6.51 },
      { bb100: 5.18, stderr: 4.72 },
    ]);
    expect(ew.valid).toBe(true);
    expect(ew.mean).toBeCloseTo((12.64 + 5.18) / 2, 6);
    expect(ew.stderr).toBeCloseTo(Math.sqrt(6.51 ** 2 + 4.72 ** 2) / 2, 6);
    expect(iv.stderr).toBeLessThan(ew.stderr);
  });
});

describe('Unified Holdem Grade Harness — Bars 1-4 & verdict matrix', () => {
  it('10. grades a clean v80 candidate (4 primary + 4 inertGuard HU + CONTROL) as PASS', () => {
    const res = evaluateHoldemGrade({
      manifest: makeV80Manifest(),
      records: makePassingV80Records(),
      provenance: { criteriaSha256: CRITERIA_SHA, gitHead: GIT_HEAD, gitTree: GIT_TREE },
    });
    expect(res.verdict).toBe('PASS');
    expect(res.bars.bar1.ok).toBe(true);
    expect(res.bars.bar1.primaryTotalDivergentPairs).toBe(42 + 39 + 44 + 38);
    expect(res.bars.bar1.inertGuardCount).toBe(4);
    expect(res.bars.bar1.inertGuardOk).toBe(true);
    expect(res.bars.bar2.ok).toBe(true);
    expect(res.bars.bar3.ok).toBe(true);
    expect(res.bars.bar4.ok).toBe(true);
    expect(res.bars.bar4.primary.inverseVariance.mean).toBeGreaterThan(0.7);
    expect(res.bars.bar4.primary.equalWeight.mean).toBeCloseTo(0.75, 6);
    expect(res.bars.bar4.guardCell.m).toBe(4); // auto-included primary seeds since P=0
    expect(res.bars.bar4.guardCell.zBar).toBeCloseTo(computeZFam(4), 6);
  });

  it('11. Bar 2 CONTROL non-zero marks verdict VOID (highest precedence over PASS)', () => {
    const records = makePassingV80Records();
    records[records.length - 1] = {
      ...records[records.length - 1],
      divergentPairs: 1,
      partedHands: 1,
      bb100: 0.04,
      stderr: 0.04,
      inert: false,
    };
    const res = evaluateHoldemGrade({
      manifest: makeV80Manifest(),
      records,
      provenance: { criteriaSha256: CRITERIA_SHA, gitHead: GIT_HEAD },
    });
    expect(res.verdict).toBe('VOID');
    expect(res.bars.bar2.ok).toBe(false);
    expect(res.reasons.void.map((r: { code: string }) => r.code)).toContain('CONTROL_NONZERO');
  });

  it('12. Bar 3 hard flag (illegalActions, brainExceptionFallbacks, truncatedStreets) marks FAIL', () => {
    for (const [field, value] of [
      ['candidateIllegalActions', 1],
      ['candidateBrainFallbacks', 2],
      ['candidateTruncatedHands', 1],
      ['illegalActions', 1],
      ['brainExceptionFallbacks', 1],
      ['truncatedStreets', 3],
    ] as const) {
      const records = makePassingV80Records();
      (records[0] as Record<string, unknown>)[field] = value;
      const res = evaluateHoldemGrade({
        manifest: makeV80Manifest(),
        records,
        provenance: { criteriaSha256: CRITERIA_SHA, gitHead: GIT_HEAD },
      });
      expect(res.verdict).toBe('FAIL');
      expect(res.bars.bar3.ok).toBe(false);
      expect(res.reasons.fail.map((r: { code: string }) => r.code)).toContain('HARD_FLAG_NONZERO');
    }
  });

  it('13. Bar 1 inertGuard cell unexpectedly flipping marks FAIL (scope-isolation breach)', () => {
    const records = makePassingV80Records();
    // Flip one of the hu_v80 inertGuard seeds
    records[5] = {
      ...records[5],
      divergentPairs: 2,
      partedHands: 2,
      bb100: 0.15,
      stderr: 0.11,
      inert: false,
    };
    const res = evaluateHoldemGrade({
      manifest: makeV80Manifest(),
      records,
      provenance: { criteriaSha256: CRITERIA_SHA, gitHead: GIT_HEAD },
    });
    expect(res.verdict).toBe('FAIL');
    expect(res.bars.bar1.inertGuardOk).toBe(false);
    expect(res.reasons.fail.map((r: { code: string }) => r.code)).toContain('INERT_GUARD_FLIPPED');
  });

  it('14. Bar 1 marks verdict INERT when all PRIMARY cells have 0 parted hands / divergent pairs', () => {
    const records = makePassingV80Records().map((r) =>
      r.cellId === 'cash6_v80'
        ? { ...r, bb100: 0, stderr: 0, divergentPairs: 0, partedHands: 0, inert: true }
        : r
    );
    const res = evaluateHoldemGrade({
      manifest: makeV80Manifest(),
      records,
      provenance: { criteriaSha256: CRITERIA_SHA, gitHead: GIT_HEAD },
    });
    expect(res.verdict).toBe('INERT');
    expect(res.bars.bar1.primaryInert).toBe(true);
    expect(res.reasons.inert.map((r: { code: string }) => r.code)).toContain('PRIMARY_INERT');
  });

  it('15. Bar 4 marks verdict NO-GAIN when requirePositiveGain=true and primary clears non-inferiority but not gain bar', () => {
    const manifest = makeV80Manifest({
      bars: {
        direction: 'higher_is_better',
        zFamMethod: 'sidak',
        primaryMinZ: -1.0,
        requirePositiveGain: true,
        primaryGainZ: 2.0,
        requireControl: true,
      },
    });
    const res = evaluateHoldemGrade({
      manifest,
      records: makePassingV80Records(), // pooled z ~ +0.92 < 2.0
      provenance: { criteriaSha256: CRITERIA_SHA, gitHead: GIT_HEAD },
    });
    expect(res.verdict).toBe('NO-GAIN');
    expect(res.bars.bar4.primary.nonInferiorityOk).toBe(true);
    expect(res.bars.bar4.primary.positiveGainOk).toBe(false);
    expect(res.reasons.noGain.map((r: { code: string }) => r.code)).toContain('PRIMARY_NO_GAIN');
  });

  it('16. Bar 4 marks FAIL on PRIMARY pooled regression below primaryMinZ', () => {
    const records = makePassingV80Records().map((r) =>
      r.cellId === 'cash6_v80' ? { ...r, bb100: -2.0, stderr: 1.5 } : r
    );
    const res = evaluateHoldemGrade({
      manifest: makeV80Manifest(),
      records,
      provenance: { criteriaSha256: CRITERIA_SHA, gitHead: GIT_HEAD },
    });
    expect(res.verdict).toBe('FAIL');
    expect(res.bars.bar4.primary.nonInferiorityOk).toBe(false);
    expect(res.reasons.fail.map((r: { code: string }) => r.code)).toContain('PRIMARY_REGRESSION');
  });

  it('17. Bar 4 enforces exact z_fam(P) pooled guard bar and z_fam(m) per-cell guard bar on multi-group guards', () => {
    const guardGroups = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7'];
    const manifest = {
      option: 'v68TurnAirDrawCalls',
      criteriaPath: 'CRITERIA.md',
      criteriaSha256: CRITERIA_SHA,
      bars: {
        direction: 'lower_is_better', // adversary bb/100: positive = adversary gains = adverse
        zFamMethod: 'sidak',
        primaryMinZ: -1.0,
        requireControl: true,
      },
      cells: [
        {
          id: 'primary_1',
          card: 'cash6_v68',
          role: 'PRIMARY',
          group: 'primary',
          seeds: [101, 102],
          pairs: 4000,
        },
        ...guardGroups.map((g) => ({
          id: `guard_${g}`,
          card: `card_${g}`,
          role: 'GUARD',
          group: g,
          seeds: [101, 102],
          pairs: 4000,
        })),
        {
          id: 'ctrl_1',
          card: 'cash6_v68',
          role: 'CONTROL',
          group: 'ctrl',
          seeds: [101],
          pairs: 4000,
        },
      ],
    };

    const baseRecords = [
      {
        cellId: 'primary_1',
        seed: 101,
        hands: 8000,
        bb100: -6.0,
        stderr: 3.0,
        divergentPairs: 120,
        partedHands: 120,
        exitCode: 0,
        engineRevision: GIT_HEAD,
      },
      {
        cellId: 'primary_1',
        seed: 102,
        hands: 8000,
        bb100: -5.0,
        stderr: 3.0,
        divergentPairs: 115,
        partedHands: 115,
        exitCode: 0,
        engineRevision: GIT_HEAD,
      },
      ...guardGroups.flatMap((g) => [
        {
          cellId: `guard_${g}`,
          seed: 101,
          hands: 8000,
          bb100: -1.0,
          stderr: 4.0,
          divergentPairs: 90,
          partedHands: 90,
          exitCode: 0,
          engineRevision: GIT_HEAD,
        },
        {
          cellId: `guard_${g}`,
          seed: 102,
          hands: 8000,
          bb100: -0.5,
          stderr: 4.0,
          divergentPairs: 85,
          partedHands: 85,
          exitCode: 0,
          engineRevision: GIT_HEAD,
        },
      ]),
      {
        cellId: 'ctrl_1',
        seed: 101,
        hands: 8000,
        bb100: 0,
        stderr: 0,
        divergentPairs: 0,
        partedHands: 0,
        exitCode: 0,
        engineRevision: GIT_HEAD,
      },
    ];

    // All clear: P=7 -> z_fam(7)=1.971, m=14 -> z_fam(14)=2.249
    const passRes = evaluateHoldemGrade({
      manifest,
      records: baseRecords,
      provenance: { criteriaSha256: CRITERIA_SHA, gitHead: GIT_HEAD },
    });
    expect(passRes.verdict).toBe('PASS');
    expect(passRes.bars.bar4.guardPooled.P).toBe(7);
    expect(passRes.bars.bar4.guardPooled.zBar).toBeCloseTo(1.971, 3);
    expect(passRes.bars.bar4.guardCell.m).toBe(14);
    expect(passRes.bars.bar4.guardCell.zBar).toBeCloseTo(computeZFam(14), 6);

    // Breach pooled z_fam(7)=1.971 WITHOUT breaching per-cell z_fam(14)=2.249:
    // Two seeds each at z = +1.50 -> pooled z = +1.50 * sqrt(2) = +2.121 > 1.971!
    const pooledBreachRecords = baseRecords.map((r) =>
      r.cellId === 'guard_g3' ? { ...r, bb100: 6.0, stderr: 4.0 } : r
    );
    const pooledFail = evaluateHoldemGrade({
      manifest,
      records: pooledBreachRecords,
      provenance: { criteriaSha256: CRITERIA_SHA, gitHead: GIT_HEAD },
    });
    expect(pooledFail.verdict).toBe('FAIL');
    expect(pooledFail.bars.bar4.guardPooled.ok).toBe(false);
    expect(pooledFail.bars.bar4.guardCell.ok).toBe(true);
    expect(pooledFail.reasons.fail.map((r: { code: string }) => r.code)).toContain(
      'GUARD_POOLED_BAR_BREACH'
    );

    // Breach per-cell z_fam(14)=2.249 while pooled stays below 1.971:
    // seed 101 z = +2.50 (+10 / 4), seed 102 z = -1.00 (-4 / 4) -> pooled z = +1.06 < 1.971
    const cellBreachRecords = baseRecords.map((r) => {
      if (r.cellId === 'guard_g5' && r.seed === 101) return { ...r, bb100: 10.0, stderr: 4.0 };
      if (r.cellId === 'guard_g5' && r.seed === 102) return { ...r, bb100: -4.0, stderr: 4.0 };
      return r;
    });
    const cellFail = evaluateHoldemGrade({
      manifest,
      records: cellBreachRecords,
      provenance: { criteriaSha256: CRITERIA_SHA, gitHead: GIT_HEAD },
    });
    expect(cellFail.verdict).toBe('FAIL');
    expect(cellFail.bars.bar4.guardPooled.ok).toBe(true);
    expect(cellFail.bars.bar4.guardCell.ok).toBe(false);
    expect(cellFail.reasons.fail.map((r: { code: string }) => r.code)).toContain(
      'GUARD_CELL_BAR_BREACH'
    );
  });

  it('18. marks VOID on missing cell-seed, non-zero cell exitCode, uncommitted engineRevision, or incomplete hands', () => {
    // Missing cell-seed
    const missing = evaluateHoldemGrade({
      manifest: makeV80Manifest(),
      records: makePassingV80Records().slice(1),
      provenance: { criteriaSha256: CRITERIA_SHA, gitHead: GIT_HEAD },
    });
    expect(missing.verdict).toBe('VOID');
    expect(missing.reasons.void.map((r: { code: string }) => r.code)).toContain('INCOMPLETE_CELLS');

    // Non-zero exit code
    const badExit = makePassingV80Records();
    badExit[0].exitCode = 137;
    const exitRes = evaluateHoldemGrade({
      manifest: makeV80Manifest(),
      records: badExit,
      provenance: { criteriaSha256: CRITERIA_SHA, gitHead: GIT_HEAD },
    });
    expect(exitRes.verdict).toBe('VOID');
    expect(exitRes.reasons.void.map((r: { code: string }) => r.code)).toContain(
      'NONZERO_CELL_EXIT'
    );

    // Dirty engineRevision
    const dirtyRev = makePassingV80Records();
    dirtyRev[0].engineRevision = `${GIT_HEAD} +uncommitted changes under server/src`;
    const revRes = evaluateHoldemGrade({
      manifest: makeV80Manifest(),
      records: dirtyRev,
      provenance: { criteriaSha256: CRITERIA_SHA, gitHead: GIT_HEAD },
    });
    expect(revRes.verdict).toBe('VOID');
    expect(revRes.reasons.void.map((r: { code: string }) => r.code)).toContain(
      'DIRTY_OR_MISMATCHED_REVISION'
    );

    // Incomplete hands
    const shortHands = makePassingV80Records();
    shortHands[0].hands = 11998;
    const handsRes = evaluateHoldemGrade({
      manifest: makeV80Manifest(),
      records: shortHands,
      provenance: { criteriaSha256: CRITERIA_SHA, gitHead: GIT_HEAD },
    });
    expect(handsRes.verdict).toBe('VOID');
    expect(handsRes.reasons.void.map((r: { code: string }) => r.code)).toContain(
      'INCOMPLETE_HAND_COUNT'
    );
  });
});

describe('Unified Holdem Grade Harness — parsing, markdown & VERIFIER-10 recompute', () => {
  it('19. parses horseLeagueCard.ts RESULT_JSON and offline CONTROL DEVRESULT lines', () => {
    const stdout = [
      '=== LEAGUE CARD ===',
      `RESULT_JSON ${JSON.stringify({
        seed: 20261122,
        pairs: 6000,
        engineRevision: GIT_HEAD,
        result: {
          hands: 12000,
          bb100: 1.25,
          stderr: 1.5,
          divergentPairs: 40,
          inert: false,
          illegalActions: 0,
          truncatedStreets: 0,
          brainExceptionFallbacks: 0,
          durationMs: 12345,
        },
      })}`,
      `DEVRESULT ${JSON.stringify({
        seed: 20261122,
        pairs: 6000,
        engineRevision: GIT_HEAD,
        hands: 12000,
        bb100: 0,
        stderr: 0,
        divergentPairs: 0,
        inert: true,
        illegal: 0,
        truncated: 0,
        fallbacks: 0,
        sec: 11.2,
      })}`,
    ].join('\n');
    const parsed = parseHorseLeagueOutput(stdout);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].source).toBe('RESULT_JSON');
    expect(parsed[0].bb100).toBe(1.25);
    expect(parsed[0].partedHands).toBe(40);
    expect(parsed[1].source).toBe('DEVRESULT');
    expect(parsed[1].divergentPairs).toBe(0);
    expect(parsed[1].durationMs).toBeCloseTo(11200, 3);
  });

  it('20. renders VERDICT.md with Provenance and Bar 1 Flips-First strictly BEFORE Bar 4 chip figures', () => {
    const result = evaluateHoldemGrade({
      manifest: makeV80Manifest(),
      records: makePassingV80Records(),
      provenance: {
        criteriaSha256: CRITERIA_SHA,
        gitHead: GIT_HEAD,
        gitTree: GIT_TREE,
        runnerSha256: 'a'.repeat(64),
        libSha256: 'b'.repeat(64),
        resultsJsonlPath: '/out/results.jsonl',
        resultsJsonlSha256: 'c'.repeat(64),
      },
    });
    const md = renderVerdictMarkdown(result);
    const bar1Idx = md.indexOf('## Bar 1');
    const bar2Idx = md.indexOf('## Bar 2');
    const bar3Idx = md.indexOf('## Bar 3');
    const bar4Idx = md.indexOf('## Bar 4');
    expect(bar1Idx).toBeGreaterThan(0);
    expect(bar1Idx).toBeLessThan(bar2Idx);
    expect(bar2Idx).toBeLessThan(bar3Idx);
    expect(bar3Idx).toBeLessThan(bar4Idx);
    expect(md).toContain(CRITERIA_SHA);
    expect(md).toContain(GIT_HEAD);
    expect(md).toContain(GIT_TREE);
    expect(md).toContain('grade-holdem-option.mjs recompute');
  });

  it('21. round-trips results.jsonl and verifies exact VERIFIER-10 recompute parity + tamper detection', () => {
    const manifest = makeV80Manifest();
    const records = makePassingV80Records();
    const rawJsonl = serializeResultsJsonl(records);
    const rawSha = sha256Hex(rawJsonl);

    const original = evaluateHoldemGrade({
      manifest,
      records,
      provenance: {
        criteriaSha256: CRITERIA_SHA,
        gitHead: GIT_HEAD,
        gitTree: GIT_TREE,
        resultsJsonlSha256: rawSha,
      },
    });
    const reparsed = parseResultsJsonl(rawJsonl);
    const recomputed = evaluateHoldemGrade({
      manifest,
      records: reparsed,
      provenance: {
        criteriaSha256: CRITERIA_SHA,
        gitHead: GIT_HEAD,
        gitTree: GIT_TREE,
        resultsJsonlSha256: sha256Hex(rawJsonl),
      },
    });

    const parity = compareVerdictsForRecompute(original, recomputed);
    expect(parity.ok).toBe(true);
    expect(parity.diffs).toEqual([]);

    // Tampering with pooled mean breaks parity
    const tampered = JSON.parse(JSON.stringify(original));
    tampered.bars.bar4.primary.inverseVariance.mean += 0.05;
    const drift = compareVerdictsForRecompute(tampered, recomputed);
    expect(drift.ok).toBe(false);
    expect(drift.diffs.some((d: string) => d.includes('bar4.primary.iv.mean'))).toBe(true);
  });
});

describe('Unified Holdem Grade Harness — end-to-end CLI (preflight, run, score, recompute)', () => {
  function makeVirtualFs(initialFiles: Record<string, string>) {
    const files = new Map<string, string>(
      Object.entries(initialFiles).map(([k, v]) => [resolve(k), v])
    );
    const logs: string[] = [];
    const errs: string[] = [];
    return {
      files,
      logs,
      errs,
      deps: {
        exists: (p: string) => files.has(resolve(p)),
        readFileUtf8: (p: string) => {
          const v = files.get(resolve(p));
          if (v === undefined) throw new Error(`ENOENT: ${p}`);
          return v;
        },
        readFileBuffer: (p: string) => {
          const v = files.get(resolve(p));
          if (v === undefined) throw new Error(`ENOENT: ${p}`);
          return Buffer.from(v, 'utf8');
        },
        writeFileUtf8: (p: string, c: string) => {
          files.set(resolve(p), c);
        },
        appendFileUtf8: (p: string, c: string) => {
          const k = resolve(p);
          files.set(k, (files.get(k) ?? '') + c);
        },
        getLoad1m: () => 8.5,
        runCoreGate: () => ({ exitCode: 1, output: 'core gate clear' }),
        readGitState: () => ({ gitHead: GIT_HEAD, gitTree: GIT_TREE, gitPorcelain: '' }),
        readLaneLock: () => ({ exists: false, owner: null, path: null, pid: null }),
        acquireLaneLock: () => ({ acquired: true }),
        releaseLaneLock: () => {},
        now: () => new Date('2026-11-22T02:50:00Z'),
        stdout: (m: string) => logs.push(m),
        stderr: (m: string) => errs.push(m),
      },
    };
  }

  it('22. preflight refuses on criteria SHA mismatch or dirty git tree', async () => {
    const vfs = makeVirtualFs({
      '/grade/manifest.json': JSON.stringify(makeV80Manifest()),
      '/grade/CRITERIA.md': CRITERIA_TEXT,
    });

    const badSha = await runGradeCli(
      [
        'preflight',
        '--manifest=/grade/manifest.json',
        `--criteria-sha=${'0'.repeat(64)}`,
        '--workdir=/repo',
        '--json',
      ],
      vfs.deps
    );
    expect(badSha.exitCode).toBe(EXIT_REFUSED);
    expect(badSha.data.ok).toBe(false);

    const dirtyTree = await runGradeCli(
      [
        'preflight',
        '--manifest=/grade/manifest.json',
        `--criteria-sha=${CRITERIA_SHA}`,
        '--workdir=/repo',
        '--json',
      ],
      {
        ...vfs.deps,
        readGitState: () => ({ gitHead: GIT_HEAD, gitTree: GIT_TREE, gitPorcelain: ' M foo.ts\n' }),
      }
    );
    expect(dirtyTree.exitCode).toBe(EXIT_REFUSED);
    expect(dirtyTree.data.failures.map((f: { code: string }) => f.code)).toContain(
      'GIT_DIRTY_TREE'
    );
  });

  it('23. run enforces strict ONE-LOOK: refuses to write verdict.json if any cell exits non-zero', async () => {
    const vfs = makeVirtualFs({
      '/grade/manifest.json': JSON.stringify(makeV80Manifest()),
      '/grade/CRITERIA.md': CRITERIA_TEXT,
    });
    const recordMap = new Map(makePassingV80Records().map((r) => [`${r.cellId}::${r.seed}`, r]));

    const res = await runGradeCli(
      [
        'run',
        '--manifest=/grade/manifest.json',
        `--criteria-sha=${CRITERIA_SHA}`,
        '--out=/grade/out',
        '--workdir=/repo',
        '--json',
      ],
      {
        ...vfs.deps,
        runCellCommand: ({ cell, seed }: { cell: { id: string; role: string }; seed: number }) => {
          // Simulate seed 20261124 crashing with exit code 137
          if (cell.id === 'cash6_v80' && seed === 20261124) {
            return { exitCode: 137, stdout: '', stderr: 'Killed', command: 'nice ...' };
          }
          const rec = recordMap.get(`${cell.id}::${seed}`)!;
          if (cell.role === 'CONTROL') {
            return {
              exitCode: 0,
              stdout: `DEVRESULT ${JSON.stringify(rec)}\n`,
              stderr: '',
              command: 'nice ...',
            };
          }
          return {
            exitCode: 0,
            stdout: `RESULT_JSON ${JSON.stringify({ seed, pairs: 6000, engineRevision: GIT_HEAD, result: rec })}\n`,
            stderr: '',
            command: 'nice ...',
          };
        },
      }
    );

    expect(res.exitCode).toBe(EXIT_REFUSED);
    expect(res.data.status).toBe('ONE_LOOK_REFUSED_NONZERO_EXIT');
    expect(res.data.cellExitCodes['cash6_v80::20261124']).toBe(137);
    // Crucially: NO verdict.json or VERDICT.md written on partial/failed run!
    expect(vfs.files.has(resolve('/grade/out/verdict.json'))).toBe(false);
    expect(vfs.files.has(resolve('/grade/out/VERDICT.md'))).toBe(false);
    expect(vfs.files.has(resolve('/grade/out/run-status.json'))).toBe(true);
  });

  it('24. run -> recompute --compare achieves exact VERIFIER-10 parity end-to-end', async () => {
    const vfs = makeVirtualFs({
      '/grade/manifest.json': JSON.stringify(makeV80Manifest()),
      '/grade/CRITERIA.md': CRITERIA_TEXT,
    });
    const recordMap = new Map(makePassingV80Records().map((r) => [`${r.cellId}::${r.seed}`, r]));

    const runRes = await runGradeCli(
      [
        'run',
        '--manifest=/grade/manifest.json',
        `--criteria-sha=${CRITERIA_SHA}`,
        '--out=/grade/out',
        '--workdir=/repo',
        '--json',
      ],
      {
        ...vfs.deps,
        runCellCommand: ({ cell, seed }: { cell: { id: string; role: string }; seed: number }) => {
          const rec = recordMap.get(`${cell.id}::${seed}`)!;
          if (cell.role === 'CONTROL') {
            return {
              exitCode: 0,
              stdout: `DEVRESULT ${JSON.stringify(rec)}\n`,
              stderr: '',
              command: 'nice -n 10 npx tsx -e ...',
            };
          }
          return {
            exitCode: 0,
            stdout: `RESULT_JSON ${JSON.stringify({ seed, pairs: 6000, engineRevision: GIT_HEAD, result: rec })}\n`,
            stderr: '',
            command: 'nice -n 10 npx tsx src/scripts/horseLeagueCard.ts ...',
          };
        },
      }
    );

    expect(runRes.exitCode).toBe(EXIT_OK);
    expect(runRes.data.verdict).toBe('PASS');
    expect(vfs.files.has(resolve('/grade/out/results.jsonl'))).toBe(true);
    expect(vfs.files.has(resolve('/grade/out/verdict.json'))).toBe(true);
    expect(vfs.files.has(resolve('/grade/out/VERDICT.md'))).toBe(true);

    // Now run VERIFIER-10 recompute --compare from raw results.jsonl
    const recomputeRes = await runGradeCli(
      [
        'recompute',
        '--manifest=/grade/manifest.json',
        `--criteria-sha=${CRITERIA_SHA}`,
        '--results=/grade/out/results.jsonl',
        '--compare=/grade/out/verdict.json',
        '--json',
      ],
      vfs.deps
    );
    expect(recomputeRes.exitCode).toBe(EXIT_OK);
    expect(recomputeRes.data.ok).toBe(true);
    expect(recomputeRes.data.comparison.diffs).toEqual([]);
    expect(recomputeRes.data.verdict).toBe('PASS');
  });

  it('25. source security invariant: harness never reads .env, secrets, or mutates Supabase/switch tables', () => {
    const libSrc = readFileSync(
      resolve(__dirname, '../../scripts/ops/grade-holdem-option-lib.mjs'),
      'utf8'
    );
    const cliSrc = readFileSync(
      resolve(__dirname, '../../scripts/ops/grade-holdem-option.mjs'),
      'utf8'
    );
    for (const src of [libSrc, cliSrc]) {
      expect(src).not.toMatch(/(?:^|['"`/\\])\.env\b/);
      expect(src).not.toMatch(/dotenv/i);
      expect(src).not.toMatch(/ca_horse_style_switch/);
      expect(src).not.toMatch(/supabase\s+db\s+query/i);
      expect(src).not.toMatch(/git\s+push/i);
    }
    // Must wrap horseLeagueCard.ts with nice -n 10
    expect(cliSrc).toContain("'nice'");
    expect(cliSrc).toContain("'-n'");
    expect(cliSrc).toContain("'10'");
    expect(cliSrc).toContain('src/scripts/horseLeagueCard.ts');
  });

  it('26. CONTROL_RUNNER_SOURCE resolves DEVELOPMENT_LEAGUE_CARDS and falls back cleanly when undefined', async () => {
    expect(CONTROL_RUNNER_SOURCE).toContain("await import('./src/benchmark/HorseLeague.js')");
    expect(CONTROL_RUNNER_SOURCE).toContain('HL.DEVELOPMENT_LEAGUE_CARDS ?? []');

    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
      ...args: string[]
    ) => (...args: unknown[]) => Promise<void>;

    // Run the actual CONTROL_RUNNER_SOURCE code in-memory with mocked dynamic imports
    async function runControlSource(
      hlModule: Record<string, unknown>,
      argvArgs: [string, string, string, string]
    ) {
      const capturedLogs: string[] = [];
      let exitCode: number | null = null;
      const rewritten = CONTROL_RUNNER_SOURCE.replace(
        /await import\((['"][^'"]+['"])\)/g,
        'await __import($1)'
      );
      const fn = new AsyncFunction('__import', 'process', 'console', rewritten);
      const fakeProcess = {
        env: {} as Record<string, string>,
        argv: ['node', ...argvArgs],
        exit: (code: number) => {
          exitCode = code;
        },
      };
      const fakeConsole = {
        log: (msg: string) => capturedLogs.push(String(msg)),
      };
      await fn(
        async (spec: string) => {
          if (spec === './src/benchmark/HorseLeague.js') return hlModule;
          if (spec === './src/benchmark/HorseLeagueCard.js') return { resolveLeagueCard };
          if (spec === './src/engine/HorseTournamentFutureHand.js') {
            return { prepareTournamentFutureHandFacts: () => {} };
          }
          throw new Error(`Unexpected import: ${spec}`);
        },
        fakeProcess,
        fakeConsole
      );
      return { capturedLogs, exitCode, env: fakeProcess.env };
    }

    const baseCard = { name: 'nlh_hu_baseline', a: { optA: true }, b: { optA: false } };
    const devCard = {
      name: 'cash6_v80_top_pair_strong_kicker_off',
      a: { v80TopPairStrongKicker: true },
      b: { v80TopPairStrongKicker: false },
    };

    // Case A: branch exports DEVELOPMENT_LEAGUE_CARDS -> resolves devCard for OFF-vs-OFF control
    const observedMatchups: Array<Record<string, unknown>> = [];
    const withDev = await runControlSource(
      {
        LEAGUE_MATCHUPS: [baseCard],
        DEVELOPMENT_LEAGUE_CARDS: [devCard],
        UNMEASURABLE_MATCHUPS: [],
        runMatchup: async (ctrl: Record<string, unknown>, pairs: number) => {
          observedMatchups.push(ctrl);
          return {
            hands: pairs * 2,
            bb100: 0,
            stderr: 0,
            divergentPairs: 0,
            inert: true,
            illegalActions: 0,
            truncatedStreets: 0,
            brainExceptionFallbacks: 0,
            durationMs: 42,
          };
        },
      },
      ['cash6_v80_top_pair_strong_kicker_off', '20261122', '6000', GIT_HEAD]
    );
    expect(withDev.exitCode).toBe(0);
    expect(withDev.env.EQUITY_GOVERNOR).toBe('off');
    expect(observedMatchups).toHaveLength(1);
    expect(observedMatchups[0].name).toBe('cash6_v80_top_pair_strong_kicker_off_control');
    expect(observedMatchups[0].a).toEqual({ v80TopPairStrongKicker: false });
    expect(observedMatchups[0].b).toEqual({ v80TopPairStrongKicker: false });
    const devParsed = parseHorseLeagueOutput(withDev.capturedLogs.join('\n'));
    expect(devParsed).toHaveLength(1);
    expect(devParsed[0].divergentPairs).toBe(0);
    expect(devParsed[0].hands).toBe(12000);

    // Case B: older branch does NOT export DEVELOPMENT_LEAGUE_CARDS (undefined) -> graceful fallback
    const legacyObserved: Array<Record<string, unknown>> = [];
    const withoutDev = await runControlSource(
      {
        LEAGUE_MATCHUPS: [baseCard],
        UNMEASURABLE_MATCHUPS: [],
        runMatchup: async (ctrl: Record<string, unknown>, pairs: number) => {
          legacyObserved.push(ctrl);
          return {
            hands: pairs * 2,
            bb100: 0,
            stderr: 0,
            divergentPairs: 0,
            inert: true,
            illegalActions: 0,
            truncatedStreets: 0,
            brainExceptionFallbacks: 0,
            durationMs: 19,
          };
        },
      },
      ['nlh_hu_baseline', '20261122', '6000', GIT_HEAD]
    );
    expect(withoutDev.exitCode).toBe(0);
    expect(legacyObserved).toHaveLength(1);
    expect(legacyObserved[0].name).toBe('nlh_hu_baseline_control');
    expect(legacyObserved[0].a).toEqual({ optA: false });
    expect(legacyObserved[0].b).toEqual({ optA: false });
  });

  it('27. enforcePerPrimaryCell / requirePerPrimaryCellNonInferiority fails if any PRIMARY cell < primaryMinZ even when combined pool passes', () => {
    const baseMultiPrimaryManifest = {
      option: 'hsRiverMultiPrimary',
      description: 'Multi-option manifest (v64 + v51) testing per-PRIMARY-cell non-inferiority',
      criteriaPath: 'CRITERIA.md',
      criteriaSha256: CRITERIA_SHA,
      bars: {
        direction: 'higher_is_better',
        zFamMethod: 'sidak',
        primaryMinZ: -1.0,
        includePrimarySeedsInCellGuard: false,
        requireControl: true,
      },
      cells: [
        {
          id: 'primary_v64',
          card: 'cash6_v64_river_card',
          role: 'PRIMARY',
          group: 'v64',
          seeds: [101, 102],
          pairs: 4000,
        },
        {
          id: 'primary_v51',
          card: 'cash6_v51_river_card',
          role: 'PRIMARY',
          group: 'v51',
          seeds: [101, 102],
          pairs: 4000,
        },
        {
          id: 'ctrl_v64',
          card: 'cash6_v64_river_card',
          role: 'CONTROL',
          group: 'ctrl',
          seeds: [101],
          pairs: 4000,
        },
      ],
    };

    // primary_v64 is strongly positive (+4.0 +- 1.5 each -> pooled z ~ +3.77)
    // primary_v51 is negative (-2.0 +- 1.5 each -> pooled z ~ -1.89 < -1.0)
    // Combined pool across all 4 seeds: mean = +1.0, se = 0.75 -> overall z = +1.33 >= -1.0!
    const records = [
      {
        cellId: 'primary_v64',
        seed: 101,
        hands: 8000,
        bb100: 4.0,
        stderr: 1.5,
        divergentPairs: 60,
        partedHands: 60,
        exitCode: 0,
        engineRevision: GIT_HEAD,
      },
      {
        cellId: 'primary_v64',
        seed: 102,
        hands: 8000,
        bb100: 4.0,
        stderr: 1.5,
        divergentPairs: 58,
        partedHands: 58,
        exitCode: 0,
        engineRevision: GIT_HEAD,
      },
      {
        cellId: 'primary_v51',
        seed: 101,
        hands: 8000,
        bb100: -2.0,
        stderr: 1.5,
        divergentPairs: 45,
        partedHands: 45,
        exitCode: 0,
        engineRevision: GIT_HEAD,
      },
      {
        cellId: 'primary_v51',
        seed: 102,
        hands: 8000,
        bb100: -2.0,
        stderr: 1.5,
        divergentPairs: 47,
        partedHands: 47,
        exitCode: 0,
        engineRevision: GIT_HEAD,
      },
      {
        cellId: 'ctrl_v64',
        seed: 101,
        hands: 8000,
        bb100: 0,
        stderr: 0,
        divergentPairs: 0,
        partedHands: 0,
        exitCode: 0,
        engineRevision: GIT_HEAD,
      },
    ];

    // Default (enforcePerPrimaryCell=false): backward-compatible PASS on combined pool
    const defaultRes = evaluateHoldemGrade({
      manifest: baseMultiPrimaryManifest,
      records,
      provenance: { criteriaSha256: CRITERIA_SHA, gitHead: GIT_HEAD },
    });
    expect(defaultRes.verdict).toBe('PASS');
    expect(defaultRes.bars.bar4.primary.overallNonInferiorityOk).toBe(true);
    expect(defaultRes.bars.bar4.primary.enforcePerPrimaryCell).toBe(false);
    expect(defaultRes.bars.bar4.primary.byCellId.primary_v64.passed).toBe(true);
    expect(defaultRes.bars.bar4.primary.byCellId.primary_v51.passed).toBe(false);

    // enforcePerPrimaryCell: true -> FAILS because primary_v51 pooled z (-1.886) < -1.0
    const enforcedRes = evaluateHoldemGrade({
      manifest: {
        ...baseMultiPrimaryManifest,
        bars: { ...baseMultiPrimaryManifest.bars, enforcePerPrimaryCell: true },
      },
      records,
      provenance: { criteriaSha256: CRITERIA_SHA, gitHead: GIT_HEAD },
    });
    expect(enforcedRes.verdict).toBe('FAIL');
    expect(enforcedRes.bars.bar4.ok).toBe(false);
    expect(enforcedRes.bars.bar4.primary.overallNonInferiorityOk).toBe(true);
    expect(enforcedRes.bars.bar4.primary.perCellNonInferiorityOk).toBe(false);
    expect(enforcedRes.bars.bar4.primary.nonInferiorityOk).toBe(false);
    expect(enforcedRes.bars.bar4.primary.perCellBreaches).toHaveLength(1);
    expect(enforcedRes.bars.bar4.primary.perCellBreaches[0].cellId).toBe('primary_v51');
    expect(enforcedRes.reasons.fail.map((r: { code: string }) => r.code)).toContain(
      'PRIMARY_CELL_REGRESSION'
    );

    const md = renderVerdictMarkdown(enforcedRes);
    expect(md).toContain('### Primary Cells (Per-Cell Pooling & Non-Inferiority)');
    expect(md).toContain('`primary_v64`');
    expect(md).toContain('`primary_v51`');
    expect(md).toContain('enforcePerPrimaryCell=true');

    // Alias requirePerPrimaryCellNonInferiority: true behaves identically
    const aliasRes = evaluateHoldemGrade({
      manifest: {
        ...baseMultiPrimaryManifest,
        bars: {
          ...baseMultiPrimaryManifest.bars,
          requirePerPrimaryCellNonInferiority: true,
        },
      },
      records,
      provenance: { criteriaSha256: CRITERIA_SHA, gitHead: GIT_HEAD },
    });
    expect(aliasRes.verdict).toBe('FAIL');
    expect(aliasRes.bars.bar4.primary.perCellNonInferiorityOk).toBe(false);
    expect(aliasRes.reasons.fail.map((r: { code: string }) => r.code)).toContain(
      'PRIMARY_CELL_REGRESSION'
    );
  });

  it('28. primaryPoolingMethod="equal_weight" gates on equal-weight mean/SE (pooledLeagueCardSeeds)', () => {
    const manifestBase = {
      option: 'v79EqualWeightCheck',
      criteriaPath: 'CRITERIA.md',
      criteriaSha256: CRITERIA_SHA,
      bars: {
        direction: 'higher_is_better',
        zFamMethod: 'sidak',
        primaryMinZ: -1.0,
        requireControl: true,
      },
      cells: [
        {
          id: 'cash6_v79',
          card: 'cash6_v79_card',
          role: 'PRIMARY',
          group: 'cash6_v79',
          seeds: [201, 202],
          pairs: 4000,
        },
        {
          id: 'ctrl_v79',
          card: 'cash6_v79_card',
          role: 'CONTROL',
          group: 'ctrl_v79',
          seeds: [201],
          pairs: 4000,
        },
      ],
    };

    // Seed 201: +0.8 +- 1.0 (z = +0.80, high precision)
    // Seed 202: -6.5 +- 5.0 (z = -1.30, low precision; adverseZ=1.30 < z_fam(2)=1.385)
    // IV pool: mean = +0.5192, se = 0.9806 -> z = +0.5295 >= -1.0 (PASS)
    // EW pool: mean = -2.8500, se = 2.5495 -> z = -1.1179 < -1.0 (FAIL)
    const records = [
      {
        cellId: 'cash6_v79',
        seed: 201,
        hands: 8000,
        bb100: 0.8,
        stderr: 1.0,
        divergentPairs: 50,
        partedHands: 50,
        exitCode: 0,
        engineRevision: GIT_HEAD,
      },
      {
        cellId: 'cash6_v79',
        seed: 202,
        hands: 8000,
        bb100: -6.5,
        stderr: 5.0,
        divergentPairs: 48,
        partedHands: 48,
        exitCode: 0,
        engineRevision: GIT_HEAD,
      },
      {
        cellId: 'ctrl_v79',
        seed: 201,
        hands: 8000,
        bb100: 0,
        stderr: 0,
        divergentPairs: 0,
        partedHands: 0,
        exitCode: 0,
        engineRevision: GIT_HEAD,
      },
    ];

    const ivRes = evaluateHoldemGrade({
      manifest: manifestBase,
      records,
      provenance: { criteriaSha256: CRITERIA_SHA, gitHead: GIT_HEAD },
    });
    expect(ivRes.verdict).toBe('PASS');
    expect(ivRes.bars.bar4.primary.poolingMethod).toBe('inverse_variance');
    expect(ivRes.bars.bar4.primary.gainZ).toBeCloseTo(
      ivRes.bars.bar4.primary.inverseVariance.z,
      10
    );

    const ewRes = evaluateHoldemGrade({
      manifest: {
        ...manifestBase,
        bars: { ...manifestBase.bars, primaryPoolingMethod: 'equal_weight' },
      },
      records,
      provenance: { criteriaSha256: CRITERIA_SHA, gitHead: GIT_HEAD },
    });
    const expectedEwMean = (0.8 - 6.5) / 2;
    const expectedEwSe = Math.sqrt(1.0 ** 2 + 5.0 ** 2) / 2;
    const expectedEwZ = expectedEwMean / expectedEwSe;
    expect(ewRes.verdict).toBe('FAIL');
    expect(ewRes.bars.bar4.primary.poolingMethod).toBe('equal_weight');
    expect(ewRes.bars.bar4.primary.gainZ).toBeCloseTo(expectedEwZ, 10);
    expect(ewRes.bars.bar4.primary.nonInferiorityOk).toBe(false);
    expect(ewRes.reasons.fail.map((r: { code: string }) => r.code)).toContain('PRIMARY_REGRESSION');

    // Invalid primaryPoolingMethod is refused by manifest validation
    expect(() =>
      validateCriteriaManifest({
        ...manifestBase,
        bars: { ...manifestBase.bars, primaryPoolingMethod: 'median' },
      })
    ).toThrow(/primaryPoolingMethod/);
  });
});
