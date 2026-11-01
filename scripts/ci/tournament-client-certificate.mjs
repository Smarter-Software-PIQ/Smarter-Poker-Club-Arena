#!/usr/bin/env node
// A closed selection, not a full release or four-format certificate.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
export function admitTournamentOnly(payload) {
  if (!payload || payload.tournament_only !== true || Object.keys(payload).length !== 1)
    throw new Error('tournament_only requires literal true and no other dispatch inputs');
  return true;
}
export const browserCases = [
  [
    'tournament-buy-in-dialog.spec.ts',
    'opens exactly ONE dialog, and it is centred on the screen',
    'chromium',
  ],
  ['tournament-buy-in-dialog.spec.ts', 'there is a real gap after every colon', 'chromium'],
  ['tournament-buy-in-dialog.spec.ts', 'nothing in the app can paint over it', 'chromium'],
  ['tournament-buy-in-dialog.spec.ts', 'Cancel closes it and takes nothing', 'chromium'],
  [
    'tournament-buy-in-dialog.spec.ts',
    'Escape closes it, and does not break the page behind it',
    'chromium',
  ],
  [
    'tournament-watch.spec.ts',
    'Watch on a live card lands on a real felt, never a dead end',
    'chromium',
  ],
  [
    'tournament-watch.spec.ts',
    'a tournament felt shows the lobby button in the right corner',
    'chromium',
  ],
];
export const liveCases = ['MTT', 'SPIN', 'SNG'].map((format) => [
  'production-live-table-realtime.spec.ts',
  `an already-running ${format} table stays realtime and recovers one owner`,
  'webkit-live-table-realtime',
]);
export function assertTournamentReport(report, mode) {
  const expected = mode === 'browser' ? browserCases : mode === 'live' ? liveCases : null;
  if (
    !expected ||
    !Array.isArray(report?.suites) ||
    !Array.isArray(report.errors) ||
    report.errors.length ||
    report.notRunReason
  )
    throw new Error('Missing or unreadable tournament report');
  const actual = [];
  function visit(suite) {
    if (
      !suite ||
      typeof suite !== 'object' ||
      (suite.specs !== undefined && !Array.isArray(suite.specs)) ||
      (suite.suites !== undefined && !Array.isArray(suite.suites))
    )
      throw new Error('Unreadable suite');
    for (const spec of suite.specs ?? []) {
      if (!Array.isArray(spec.tests) || spec.tests.length !== 1)
        throw new Error('Expected exactly one project per case');
      const test = spec.tests[0];
      if (
        spec.ok !== true ||
        test.status !== 'expected' ||
        test.expectedStatus !== 'passed' ||
        test.results?.length !== 1 ||
        test.results[0].status !== 'passed' ||
        test.results[0].retry !== 0
      )
        throw new Error(
          'Every tournament case must pass once without skips or retries; absent subjects remain unproven'
        );
      actual.push([
        (spec.file ?? suite.file)?.replace(/^tests\/e2e\//, ''),
        spec.title,
        test.projectName,
      ]);
    }
    for (const child of suite.suites ?? []) visit(child);
  }
  visit(report);
  const keys = (rows) => rows.map((row) => JSON.stringify(row)).sort();
  if (JSON.stringify(keys(actual)) !== JSON.stringify(keys(expected)))
    throw new Error('Tournament case set differs from the closed selection');
  return true;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2];
  if (mode === 'admit')
    admitTournamentOnly(JSON.parse(process.env.CLIENT_NAVIGATION_PAYLOAD || 'null'));
  else if (['browser', 'live'].includes(mode) && process.argv.length === 4) {
    assertTournamentReport(JSON.parse(readFileSync(process.argv[3], 'utf8')), mode);
    console.log(
      `Scoped tournament ${mode} cases passed once; no satellite or patch-specific failure-path certification.`
    );
  } else
    throw new Error(
      'Usage: tournament-client-certificate.mjs admit | browser REPORT | live REPORT'
    );
}
