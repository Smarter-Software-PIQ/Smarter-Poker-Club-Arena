/**
 * LAW: A SUPERSEDED POST-DEPLOY FAILURE IS A NON-VERDICT, NEVER A FALSE INCIDENT
 * (incident 838c2142 / PostDeployVerificationIncomplete, 2026-11-28).
 *
 * Client browser verification takes ~90-110 minutes against $LIVE_SHA's specs.
 * When a newer protected-main commit publishes mid-run (e.g. run 46108674387:
 * b94db48e specs running against e11255d7 production), older specs fail against
 * the newer DOM, turning a superseded release window into a false job failure
 * that fired PostDeployVerificationIncomplete even though release_window proved
 * production had moved forward on origin/main.
 *
 * In the same run, leaderboard-console.spec.ts failed My Clubs Tournament Stats
 * at 1440px with color-contrast (1) because leaderboardMotion.ts waited only on
 * .podium-section and .leaderboard-entry and omitted .tournament-stats-entry
 * (which LeaderboardPage.tsx animates with animate-fade-in-up stagger-1..10).
 *
 * Pinned here:
 *   1. classifySupersededFailure returns exit 3 ONLY when live build-info proves
 *      a strict forward descendant on trusted history; same-release failures,
 *      rollbacks, off-lineage SHAs, and unreadable documents stay exit 1.
 *   2. post-deploy-e2e.yml classifies superseded suite failures as non-verdicts
 *      (never firing a false defect and never setting certified=true).
 *   3. leaderboardMotion.ts awaits .tournament-stats-entry alongside rankings.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { classifySupersededFailure } from '../scripts/ci/classify-superseded-failure.mjs';
import { UNKNOWN_EXIT_CODE } from '../scripts/ci/production-e2e-provenance.mjs';
import { LEADERBOARD_MOTION_SELECTOR } from './e2e/support/leaderboardMotion';

const ROOT = resolve(__dirname, '..');
const WORKFLOW = readFileSync(join(ROOT, '.github/workflows/post-deploy-e2e.yml'), 'utf8');
const LEADERBOARD_PAGE = readFileSync(join(ROOT, 'src/pages/LeaderboardPage.tsx'), 'utf8');

const OLD = 'b94db48e8a2ce262aeadb65d7d2d777c69c65d5e';
const NEW = 'e11255d73484ae4045cce71af515c19ef6b5d19c';
const OTHER = 'c6ec86b518fde0762acfc908c35336e003e89db8';

function linearEvidence(order: string[]) {
  return {
    commitExists: (sha: string) => order.includes(sha),
    isAncestor: (ancestor: string, descendant: string) => {
      const a = order.indexOf(ancestor);
      const b = order.indexOf(descendant);
      return a >= 0 && b >= 0 && a <= b;
    },
  };
}

function workflowStep(name: string): string {
  const at = WORKFLOW.indexOf(`- name: ${name}`);
  if (at < 0) throw new Error(`step not found: ${name}`);
  const lineStart = WORKFLOW.lastIndexOf('\n', at) + 1;
  const indent = WORKFLOW.slice(lineStart, at);
  const next = WORKFLOW.indexOf(`\n${indent}- name: `, at + 1);
  return next < 0 ? WORKFLOW.slice(at) : WORKFLOW.slice(at, next);
}

describe('a superseded post-deploy failure is classified as a non-verdict, never a defect or a pass', () => {
  it('returns UNKNOWN_EXIT_CODE (3) ONLY when production proved a forward supersede on trusted history', () => {
    const out = classifySupersededFailure(
      JSON.stringify({ ca_sha: NEW }),
      OLD,
      linearEvidence([OLD, NEW])
    );
    expect(out.exitCode).toBe(UNKNOWN_EXIT_CODE);
    expect(out.verdict).toBe('superseded');
    expect(out.actual).toBe(NEW);
  });

  it('keeps exitCode 1 when production is still serving the tested SHA (real defect)', () => {
    const out = classifySupersededFailure(
      JSON.stringify({ ca_sha: OLD }),
      OLD,
      linearEvidence([OLD, NEW])
    );
    expect(out.exitCode).toBe(1);
    expect(out.verdict).toBe('same');
  });

  it.each([
    [
      'rollback to an older commit',
      JSON.stringify({ ca_sha: OLD }),
      NEW,
      linearEvidence([OLD, NEW]),
    ],
    [
      'foreign commit outside lineage',
      JSON.stringify({ ca_sha: OTHER }),
      OLD,
      linearEvidence([OLD, NEW]),
    ],
    ['empty build-info body', '', OLD, linearEvidence([OLD, NEW])],
    ['malformed build-info JSON', '{not-json', OLD, linearEvidence([OLD, NEW])],
    ['missing ca_sha', JSON.stringify({ ok: true }), OLD, linearEvidence([OLD, NEW])],
  ])('keeps exitCode 1 on %s', (_label, body, expected, evidence) => {
    const out = classifySupersededFailure(body, expected, evidence);
    expect(out.exitCode).toBe(1);
    expect(out.verdict).not.toBe('superseded');
  });

  it('wires classify-superseded-failure.mjs into production-e2e and keeps certified=false on superseded non-verdicts', () => {
    for (const name of [
      'Certify the authenticated Lightning operator cold loads',
      'Certify the authenticated production Cashier',
      'Certify the authenticated production Cashier Statements',
      'Certify the authenticated Club Data workspace',
      'Run the specs that need a deployed page',
    ]) {
      const block = workflowStep(name);
      expect(block, name).toContain('scripts/ci/classify-superseded-failure.mjs');
      expect(block, name).toContain('e2e-report/superseded-non-verdicts.txt');
    }

    // Lightning operator deliberately still does not pass LIVE_SHA to the spec.
    expect(workflowStep('Certify the authenticated Lightning operator cold loads')).not.toContain(
      'LIVE_SHA'
    );

    const releaseWindow = workflowStep('Classify the release window this certificate covers');
    expect(releaseWindow).toContain('echo \'superseded=false\' >> "$GITHUB_OUTPUT"');
    expect(releaseWindow).toContain('echo \'superseded=true\' >> "$GITHUB_OUTPUT"');
    expect(releaseWindow).toContain('e2e-report/superseded-non-verdicts.txt');
  });

  it('awaits .tournament-stats-entry entrance motion alongside .podium-section and .leaderboard-entry', () => {
    expect(LEADERBOARD_PAGE).toContain('tournament-stats-entry');
    expect(LEADERBOARD_PAGE).toContain('animate-fade-in-up');
    expect(LEADERBOARD_MOTION_SELECTOR).toContain('.podium-section');
    expect(LEADERBOARD_MOTION_SELECTOR).toContain('.leaderboard-entry');
    expect(LEADERBOARD_MOTION_SELECTOR).toContain('.tournament-stats-entry');
  });
});
