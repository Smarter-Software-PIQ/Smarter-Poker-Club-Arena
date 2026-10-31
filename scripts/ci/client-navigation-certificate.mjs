#!/usr/bin/env node
// Closed, explicit recovery certificate. Never accepts caller-selected files or code.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function admitClientNavigation(payload) {
  if (
    !payload ||
    payload.client_navigation !== true ||
    Object.keys(payload).some((key) => key !== 'client_navigation')
  ) {
    throw new Error('client_navigation requires literal true and no other dispatch inputs');
  }
  return true;
}

export function admitKeepGamePages(payload) {
  if (
    !payload ||
    payload.keep_game_pages !== true ||
    Object.keys(payload).some((key) => key !== 'keep_game_pages')
  ) {
    throw new Error('keep_game_pages requires literal true and no other dispatch inputs');
  }
  return true;
}

const keepGamePages = 'tournament Details stays inside the spectator table lobby tab';
export function assertKeepGamePagesReport(report) {
  return assertExactReports(
    [report],
    [
      ['production-mobile-lobby-chrome.spec.ts', keepGamePages, 'chromium'],
      ['production-mobile-lobby-chrome.spec.ts', keepGamePages, 'webkit-footer'],
    ]
  );
}

const table = 'no surface scrolls sideways on a phone';
const lobby = 'compact rows open details and filters stay at their original position';
export function assertClientNavigationReports(tableReport, lobbyReport) {
  const expected = [
    ['production-table-management.spec.ts', table, 'chromium'],
    ['production-mobile-lobby-chrome.spec.ts', lobby, 'chromium'],
    ['production-mobile-lobby-chrome.spec.ts', lobby, 'webkit-footer'],
  ];
  return assertExactReports([tableReport, lobbyReport], expected);
}

function assertExactReports(reports, expected) {
  const actual = [];
  function visit(suite) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        actual.push([spec.file ?? suite.file, spec.title, test.projectName]);
        if (
          spec.ok !== true ||
          test.status !== 'expected' ||
          test.expectedStatus !== 'passed' ||
          test.results?.length !== 1 ||
          test.results[0].status !== 'passed' ||
          test.results[0].retry !== 0
        ) {
          throw new Error('Every selected navigation case must pass once, without skip or retry');
        }
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  }
  for (const report of reports) {
    if (!report || report.errors?.length)
      throw new Error('Navigation report missing or contains errors');
    visit(report);
  }
  const keys = (rows) => rows.map((row) => JSON.stringify(row)).sort();
  if (JSON.stringify(keys(actual)) !== JSON.stringify(keys(expected))) {
    throw new Error('Navigation certificate requires exactly its fixed browser cases');
  }
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === 'admit') {
    const payload = JSON.parse(process.env.CLIENT_NAVIGATION_PAYLOAD || 'null');
    if (payload && Object.hasOwn(payload, 'keep_game_pages')) admitKeepGamePages(payload);
    else admitClientNavigation(payload);
  } else if (process.argv[2] === 'keep-game-pages-reports' && process.argv.length === 4) {
    assertKeepGamePagesReport(JSON.parse(readFileSync(process.argv[3], 'utf8')));
    console.log('Exactly two keep-game-pages browser cases passed once without skips or retries.');
  } else if (process.argv[2] === 'reports' && process.argv.length === 5) {
    assertClientNavigationReports(
      ...process.argv.slice(3).map((file) => JSON.parse(readFileSync(file, 'utf8')))
    );
    console.log('Exactly three navigation browser cases passed once without skips or retries.');
  } else {
    throw new Error(
      'Usage: client-navigation-certificate.mjs admit | reports TABLE_JSON LOBBY_JSON'
    );
  }
}
