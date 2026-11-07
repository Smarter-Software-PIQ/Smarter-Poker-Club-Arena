#!/usr/bin/env node
/**
 * Projects server/release/owner-maintenance-windows.json into the small list
 * the client reads for its advance maintenance notice
 * (src/utils/ownerMaintenanceNotices.json). Run it whenever a window is
 * booked; tests/a-booked-window-gives-players-notice.law.test.ts refuses a
 * projection that differs from this output.
 *
 *   node scripts/generate-owner-maintenance-notices.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SOURCE = 'server/release/owner-maintenance-windows.json';
export const TARGET = 'src/utils/ownerMaintenanceNotices.json';
/** Windows that end at or before this instant are past (or already spent on 2026-11-07), so they are not shipped. */
export const SHIP_FROM = '2026-11-08T00:00:00Z';

export function projectOwnerMaintenanceNotices(doc) {
  const rows = [];
  for (const [kind, list] of [
    ['engine', doc.windows ?? []],
    ['database', doc.databaseWindows ?? []],
  ]) {
    for (const w of list) {
      if (Date.parse(w.notAfter) <= Date.parse(SHIP_FROM)) continue;
      rows.push({
        id: w.id,
        kind,
        noticeAt: typeof w.playerNoticeAt === 'string' ? w.playerNoticeAt : null,
        notBefore: w.notBefore,
        notAfter: w.notAfter,
      });
    }
  }
  rows.sort((a, b) => a.notBefore.localeCompare(b.notBefore) || a.id.localeCompare(b.id));
  return { source: SOURCE, shipFrom: SHIP_FROM, notices: rows };
}

export function renderOwnerMaintenanceNotices(root = ROOT) {
  const doc = JSON.parse(readFileSync(join(root, SOURCE), 'utf8'));
  return JSON.stringify(projectOwnerMaintenanceNotices(doc), null, 2) + '\n';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(join(ROOT, TARGET), renderOwnerMaintenanceNotices());
  console.log(`wrote ${TARGET}`);
}
