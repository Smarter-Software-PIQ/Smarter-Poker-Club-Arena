#!/usr/bin/env node
/**
 * classify-superseded-failure.mjs — tell a mid-run forward publish apart from
 * a defect on the release this post-deploy job checked out.
 *
 * WHY THIS EXISTS (incident 838c2142 / PostDeployVerificationIncomplete)
 *
 * Client browser verification (`production-e2e`) takes ~90-110 minutes while
 * merges publish to production every 10-30 minutes. It checks out the specs of
 * `$LIVE_SHA` at job start. When another protected-main commit publishes mid-run
 * and changes a UI contract alongside its own updated spec (e.g. run 46108674387:
 * b94db48e specs running against e11255d7 production), those older specs fail
 * against the newer site, and the job ended `failure` even though its own
 * closing `release_window` step proved production had already advanced to a
 * forward descendant on `origin/main`. `post-deploy-verdict` then fired
 * `PostDeployVerificationIncomplete` for version skew on a superseded run.
 *
 * THE RULE (CLAUDE.md 10.86 rule 1 — unknown / superseded is never a defect
 * and never a pass):
 *
 *   Exit 3 (UNKNOWN_EXIT_CODE) ONLY when BOTH hold:
 *     1. `origin/main` history and live `build-info.json` were read cleanly; AND
 *     2. `classifyReleaseWindow(body, expectedSha, evidence)` proves live is a
 *        strict forward descendant of `expectedSha` on trusted history (`superseded`).
 *   Exit 1 in EVERY other case:
 *     - live is still `expectedSha` (`certified`) -> real defect on `expectedSha`;
 *     - live is a rollback or off-lineage commit -> real anomaly;
 *     - live `build-info.json` or `origin/main` fetch failed -> unknown stays red.
 *
 * When this returns 3, the workflow records the suite in
 * `e2e-report/superseded-non-verdicts.txt` and `release_window` keeps
 * `certified=false` (`CLIENT_NON_VERDICT=true`), so `record-post-deploy-verdict.mjs`
 * neither fires a false defect nor closes an open episode.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  UNKNOWN_EXIT_CODE,
  classifyReleaseWindow,
  classifyRepositoryReleaseWindow,
} from './production-e2e-provenance.mjs';

export const DEFAULT_BUILD_INFO_URL = 'https://smarter.poker/hub/club-arena/build-info.json';

/**
 * Pure classifier exported for unit and law tests.
 * Returns { exitCode: 3, verdict: 'superseded', expected, actual } ONLY when
 * live build-info proves a forward supersede on trusted history; returns
 * { exitCode: 1, ... } for same-release failures, rollbacks, off-lineage SHAs,
 * or unreadable inputs.
 */
export function classifySupersededFailure(rawBuildInfo, expectedSha, evidence) {
  if (typeof rawBuildInfo !== 'string' || !rawBuildInfo.trim()) {
    return {
      exitCode: 1,
      verdict: 'unreadable',
      expected: expectedSha ?? null,
      actual: null,
      reason: 'live build-info.json was empty or unreadable; keeping failure',
    };
  }
  try {
    const result = evidence
      ? classifyReleaseWindow(rawBuildInfo, expectedSha, evidence)
      : classifyRepositoryReleaseWindow(rawBuildInfo, expectedSha);
    if (result.verdict === 'superseded') {
      return {
        exitCode: UNKNOWN_EXIT_CODE,
        verdict: 'superseded',
        expected: expectedSha,
        actual: result.sha,
        reason: `production advanced from ${expectedSha} to forward commit ${result.sha} mid-run`,
      };
    }
    return {
      exitCode: 1,
      verdict: 'same',
      expected: expectedSha,
      actual: result.sha,
      reason: `production is still serving ${expectedSha}; failure belongs to this release`,
    };
  } catch (error) {
    return {
      exitCode: 1,
      verdict: 'anomaly',
      expected: expectedSha ?? null,
      actual: null,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function readLiveBuildInfo(source) {
  if (source && !/^https?:\/\//.test(source)) {
    return readFileSync(source, 'utf8');
  }
  const base = source || DEFAULT_BUILD_INFO_URL;
  const separator = base.includes('?') ? '&' : '?';
  const url = `${base}${separator}superseded=${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const response = await fetch(url, {
    headers: { 'Cache-Control': 'no-cache' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} reading ${base}`);
  }
  return await response.text();
}

async function main() {
  const [expectedSha, source] = process.argv.slice(2);
  if (!expectedSha || !/^[0-9a-f]{40}$/.test(expectedSha)) {
    console.log(
      JSON.stringify({
        verdict: 'invalid',
        reason: 'expected 40-char lowercase SHA',
      })
    );
    process.exit(1);
  }
  try {
    execFileSync('git', ['fetch', '--no-tags', 'origin', 'main'], {
      stdio: 'ignore',
      timeout: 30_000,
    });
  } catch {
    console.log(
      JSON.stringify({
        verdict: 'unreadable',
        expected: expectedSha,
        reason: 'could not refresh origin/main history; keeping failure',
      })
    );
    process.exit(1);
  }
  let raw = '';
  try {
    raw = await readLiveBuildInfo(source);
  } catch (error) {
    console.log(
      JSON.stringify({
        verdict: 'unreadable',
        expected: expectedSha,
        reason: error instanceof Error ? error.message : String(error),
      })
    );
    process.exit(1);
  }
  const result = classifySupersededFailure(raw, expectedSha);
  console.log(JSON.stringify(result));
  process.exit(result.exitCode);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.log(
      JSON.stringify({
        verdict: 'error',
        reason: error instanceof Error ? error.message : String(error),
      })
    );
    process.exit(1);
  });
}
