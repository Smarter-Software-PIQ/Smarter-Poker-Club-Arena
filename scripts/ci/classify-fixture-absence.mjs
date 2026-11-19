#!/usr/bin/env node
/**
 * classify-fixture-absence.mjs - "production had no such table" is a
 * NON-VERDICT, and only that is.
 *
 * A production spec that needs a table of a kind production is not running
 * (a dealing nine-seat cash table, a running SPIN, a second seat-move
 * destination) throws `PRODUCTION_LACKS_FIXTURE <kind>: ...`, and it throws
 * that only after an independent read of the tables catalogue confirmed the
 * absence (tests/e2e/support/productionFixture.ts). A selector that missed a
 * table which exists throws `SELECTOR_MISSED_FIXTURE`; an absence that could
 * not be proved throws `FIXTURE_ABSENCE_UNPROVEN`. Both stay red.
 *
 * This reads the Playwright JSON report of ONE single-attempt invocation and
 * answers:
 *
 *   exit 0  pass         nothing failed.
 *   exit 3  non-verdict  at least one test failed, and EVERY failed test failed
 *                        only on a proved PRODUCTION_LACKS_FIXTURE: each of its
 *                        errors names it, none names a selector miss or an
 *                        unproven absence, it ran exactly once and it failed
 *                        (not timed out, not interrupted).
 *   exit 1  fail         anything else, including an unreadable report.
 *
 * The same vocabulary as production-e2e-provenance.mjs: `::warning::UNKNOWN`,
 * a `NON-VERDICT:` line in the job summary, exit 3. A caller that maps exit 3
 * to a green step MUST also record that the step certified nothing (a step
 * output the release window and record-post-deploy-verdict.mjs read), so a
 * non-verdict can never be reported as a pass or close an episode.
 *
 * Usage: node scripts/ci/classify-fixture-absence.mjs <report.json>
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const LACKS = 'PRODUCTION_LACKS_FIXTURE';
export const DISQUALIFIERS = ['SELECTOR_MISSED_FIXTURE', 'FIXTURE_ABSENCE_UNPROVEN'];

function errorMessages(result) {
  const messages = [];
  for (const error of Array.isArray(result?.errors) ? result.errors : []) {
    if (typeof error?.message === 'string') messages.push(error.message);
    else if (typeof error?.value === 'string') messages.push(error.value);
    else messages.push('');
  }
  if (messages.length === 0 && result?.error) messages.push(String(result.error.message ?? ''));
  return messages;
}

/** Pure decision, exported for the regression test. */
export function classifyFixtureAbsence(report) {
  const fail = (reason, failures = []) => ({ verdict: 'fail', reason, kinds: [], failures });
  if (!report || typeof report !== 'object' || !Array.isArray(report.suites))
    return fail('report is missing or unreadable');
  if (report.notRunReason) return fail(`report did not run: ${report.notRunReason}`);
  if (Array.isArray(report.errors) && report.errors.length > 0)
    return fail('report carries run-level errors');
  const specs = [];
  const visit = (suite) => {
    if (!suite || typeof suite !== 'object') throw new Error('unreadable suite');
    for (const spec of Array.isArray(suite.specs) ? suite.specs : []) specs.push(spec);
    for (const child of Array.isArray(suite.suites) ? suite.suites : []) visit(child);
  };
  try {
    visit(report);
  } catch {
    return fail('report suites are unreadable');
  }
  const failures = [];
  for (const spec of specs) {
    for (const test of Array.isArray(spec?.tests) ? spec.tests : []) {
      if (test?.status === 'expected' || test?.status === 'skipped') continue;
      failures.push({ title: String(spec?.title ?? ''), test });
    }
  }
  if (failures.length === 0)
    return { verdict: 'pass', reason: 'nothing failed', kinds: [], failures: [] };
  const kinds = new Set();
  for (const { title, test } of failures) {
    const results = Array.isArray(test.results) ? test.results : [];
    if (test.status !== 'unexpected' || results.length !== 1 || results[0]?.status !== 'failed')
      return fail(`${title} did not fail exactly once on an error`, [title]);
    const messages = errorMessages(results[0]);
    if (messages.length === 0) return fail(`${title} failed without a readable error`, [title]);
    for (const message of messages) {
      if (DISQUALIFIERS.some((marker) => message.includes(marker)))
        return fail(`${title} failed on a selector miss or an unproven absence`, [title]);
      const match = message.match(/PRODUCTION_LACKS_FIXTURE (\S+?):?\s/);
      if (!match)
        return fail(`${title} failed on something other than a proved missing fixture`, [title]);
      kinds.add(match[1]);
    }
  }
  return {
    verdict: 'non-verdict',
    reason: `production lacks the fixture this proof needs (${[...kinds].join(', ')})`,
    kinds: [...kinds],
    failures: failures.map(({ title }) => title),
  };
}

function main() {
  let result;
  try {
    result = classifyFixtureAbsence(JSON.parse(readFileSync(process.argv[2], 'utf8')));
  } catch {
    result = {
      verdict: 'fail',
      reason: 'report is missing or unreadable',
      kinds: [],
      failures: [],
    };
  }
  console.log(JSON.stringify(result));
  if (result.verdict === 'non-verdict') {
    const line = `NON-VERDICT: ${result.reason}; ${result.failures.join('; ')} could not be tested. This certifies nothing and condemns nothing.`;
    console.log(`::warning::UNKNOWN: ${line}`);
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`);
    process.exit(3);
  }
  process.exit(result.verdict === 'pass' ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
