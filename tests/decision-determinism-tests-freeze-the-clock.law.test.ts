/**
 * LAW: decision determinism tests that strip wall-clock fields must freeze `performance.now()`.
 * ===========================================================================================
 * Created 2026-11-21 (Hardening Item H1) after the D1 prequalification flake fixed in PR #11618
 * (commit 5ef8e6cb5a55).
 *
 * `HorseLogic.decide()` enforces 4 ms wall-clock `performance.now()` budgets in tournament mode
 * (Phase 7 joint-sample utility via `JOINT_SAMPLE_WORK_BUDGET_MS`, variant shadow utility, and
 * Phase 13 joint shadow/candidate utility). A test that strips `*Ms` fields (`withoutClocks`,
 * `withoutClock`, `WALL_CLOCK_FIELDS`, `/Ms$/` JSON replacers, or `strip()` on `elapsedMs` /
 * `latencyMs`) and compares two `decide()` receipts byte-for-byte still fails non-deterministically
 * on a loaded runner when one call finishes inside 4 ms (`phase7_evaluated`) and the paired call
 * exceeds 4 ms (`phase7_unavailable`, reason `operation_budget`).
 *
 * Therefore every test under `server/src/` matching those receipt-comparison patterns MUST freeze
 * `performance.now()` using `server/src/engine/testing/frozenDecisionClock.ts`
 * (`withFrozenDecisionClock` / `freezeDecisionClock`), `vi.spyOn(performance, 'now')`, or
 * `phase13EvidenceMode: true`.
 *
 * Registry: docs/laws.d/decision-determinism-tests-freeze-the-clock.md
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..');
const SERVER_SRC = join(ROOT, 'server', 'src');
const HELPER_REL = 'server/src/engine/testing/frozenDecisionClock.ts';

function serverTestFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...serverTestFiles(full));
    else if (entry.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

/**
 * Strip line and block comments so comment prose mentioning `withoutClocks` or
 * `vi.spyOn(performance, 'now')` cannot trigger a false positive or false pass.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}

export function requiresFrozenDecisionClock(rawSource: string): string[] {
  const source = stripComments(rawSource);
  const reasons: string[] = [];

  if (/\bwithoutClocks\b/.test(source)) {
    reasons.push('uses withoutClocks');
  }

  const callsHorseDecide = /\bHorseLogic\.decide\b/.test(source);
  if (callsHorseDecide) {
    if (/\bJSON\.stringify\b/.test(source) && /\/Ms\$\//.test(source)) {
      reasons.push('strips /Ms$/ in JSON.stringify of HorseLogic.decide');
    }
    if (/\bwithoutClock\s*\(/.test(source) || /\bWALL_CLOCK_FIELDS\b/.test(source)) {
      reasons.push('uses withoutClock / WALL_CLOCK_FIELDS on HorseLogic.decide');
    }
    if (/\bJSON\.stringify\s*\(\s*(?:HorseLogic\.)?decide\s*\(/.test(source)) {
      reasons.push('uses direct JSON.stringify(decide(...)) byte comparison');
    }
    if (
      /\bconst\s+strip\s*=|\bfunction\s+strip\s*\(/.test(source) &&
      /\b(elapsedMs|latencyMs)\b/.test(source) &&
      /\bexpect\s*\(\s*strip\s*\(/.test(source)
    ) {
      reasons.push('uses strip() omitting elapsedMs/latencyMs on HorseLogic.decide');
    }
  }

  return reasons;
}

export function freezesDecisionClock(rawSource: string): boolean {
  const source = stripComments(rawSource);
  const usesHelper =
    /frozenDecisionClock/.test(source) &&
    /\b(?:withFrozenDecisionClock|freezeDecisionClock)\s*\(/.test(source);
  const spiesOnPerformanceNow = /\bvi\.spyOn\s*\(\s*performance\s*,\s*['"]now['"]\s*\)/.test(
    source
  );
  const usesEvidenceMode = /\bphase13EvidenceMode\s*:\s*true\b/.test(source);
  return usesHelper || spiesOnPerformanceNow || usesEvidenceMode;
}

describe('decision determinism tests freeze performance.now()', () => {
  it('the shared frozenDecisionClock test helper exists and exports both primitives', () => {
    const helperPath = join(ROOT, HELPER_REL);
    expect(existsSync(helperPath), `${HELPER_REL} must exist`).toBe(true);
    const body = readFileSync(helperPath, 'utf8');
    expect(body).toContain('export function freezeDecisionClock');
    expect(body).toContain('export function withFrozenDecisionClock');
  });

  it('every clock-stripping decision comparison test in server/src freezes performance.now()', () => {
    const files = serverTestFiles(SERVER_SRC);
    expect(files.length).toBeGreaterThan(100);

    const matched: string[] = [];
    const violations: string[] = [];

    for (const full of files) {
      const rel = relative(ROOT, full).replace(/\\/g, '/');
      const source = readFileSync(full, 'utf8');
      const reasons = requiresFrozenDecisionClock(source);
      if (reasons.length === 0) continue;
      matched.push(rel);
      if (!freezesDecisionClock(source)) {
        violations.push(`${rel} (${reasons.join('; ')})`);
      }
    }

    // Sanity check: the law must actually see the known receipt-comparison tests.
    expect(matched).toContain('server/src/engine/AHoldemTournamentAllInCallIsPriced.law.test.ts');
    expect(matched).toContain('server/src/benchmark/OfflineOmahaPolicyInput.test.ts');

    expect(
      violations,
      'These decision-comparison tests strip wall-clock fields without freezing performance.now(). ' +
        'Wrap decide() calls with withFrozenDecisionClock() from server/src/engine/testing/frozenDecisionClock.ts ' +
        '(or spy on performance.now) so 4 ms wall-clock budgets cannot flake on loaded CI runners:\n' +
        violations.join('\n')
    ).toEqual([]);
  }, 120_000);

  it('classifier self-test: fails when the freeze is removed from AHoldemTournamentAllInCallIsPriced and ignores explicit clock-injection laws', () => {
    const d1Path = join(
      ROOT,
      'server',
      'src',
      'engine',
      'AHoldemTournamentAllInCallIsPriced.law.test.ts'
    );
    const d1Source = readFileSync(d1Path, 'utf8');
    expect(requiresFrozenDecisionClock(d1Source).length).toBeGreaterThan(0);
    expect(freezesDecisionClock(d1Source)).toBe(true);

    // Removing the freeze must make the law catch the file.
    const unfrozen = d1Source
      .replace(/frozenDecisionClock/g, 'removedHelper')
      .replace(/withFrozenDecisionClock/g, 'runUnfrozen')
      .replace(/freezeDecisionClock/g, 'noopClock')
      .replace(/vi\.spyOn\s*\(\s*performance\s*,\s*['"]now['"]\s*\)/g, 'noopSpy()');
    expect(requiresFrozenDecisionClock(unfrozen).length).toBeGreaterThan(0);
    expect(freezesDecisionClock(unfrozen)).toBe(false);

    // Explicit clock-injection laws (decideOmahaMathCore with { now }) are not falsely flagged.
    const omahaCorePath = join(
      ROOT,
      'server',
      'src',
      'engine',
      'omahaMathCore',
      'OmahaMathCoreDeterminism.law.test.ts'
    );
    const omahaCoreSource = readFileSync(omahaCorePath, 'utf8');
    expect(requiresFrozenDecisionClock(omahaCoreSource)).toEqual([]);
  });
});
