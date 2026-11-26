#!/usr/bin/env node
/**
 * ONE TIMETABLE FOR THE THREE-HOUR CUTOVER (2026-11-24, Cutover reliability
 * programme item 5; Lane: release-custody).
 *
 * docs/ops/engine-cutover-timetable.json holds every number; this module
 * renders the tables of docs/ops/engine-cutover-timetable.md from it (between
 * the GENERATED markers), and
 * tests/the-cutover-timetable-matches-the-gates.law.test.ts pins each number
 * to the gate script or workflow that enforces it and the document to this
 * rendering. A changed window is a one-line edit of the JSON plus the gate,
 * then:
 *
 *   node scripts/ops/engine-cutover-timetable.mjs --write   (rewrite the tables)
 *   node scripts/ops/engine-cutover-timetable.mjs --check   (exit 1 if stale)
 *
 * It reads and writes only these two files. No network, no clock.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const TIMETABLE_JSON = join(ROOT, 'docs', 'ops', 'engine-cutover-timetable.json');
export const TIMETABLE_MD = join(ROOT, 'docs', 'ops', 'engine-cutover-timetable.md');
export const BEGIN =
  '<!-- GENERATED:engine-cutover-timetable BEGIN (node scripts/ops/engine-cutover-timetable.mjs --write) -->';
export const END = '<!-- GENERATED:engine-cutover-timetable END -->';

const DAY = 24 * 60;
const mod = (m) => ((m % DAY) + DAY) % DAY;
const hhmm = (m) =>
  `${String(Math.floor(mod(m) / 60)).padStart(2, '0')}:${String(mod(m) % 60).padStart(2, '0')}`;
const parse = (s) => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
};
const inRange = (m, [from, until]) => {
  const a = parse(from);
  const b = parse(until);
  const x = mod(m);
  return a > b ? x >= a || x < b : x >= a && x < b;
};

/** Chicago minute-of-day intervals in which Club Arena's dispatcher holds an ordinary migration. */
function migrationHeld(t, minute) {
  const c = t.cycle;
  if (inRange(minute, t.daily.releaseSchemaFreezeChicago)) return true;
  if (inRange(minute, t.daily.dailyMigrationGuardChicago)) return true;
  for (const s of t.slots) {
    if (s === t.anchorSlot) continue; // the anchor is covered by the release schema freeze
    const start = s * 60 - c.migrationDeferMinutesBeforeSlot;
    const end = s * 60 + c.migrationClearMinutesAfterSlot;
    const x = mod(minute);
    const a = mod(start);
    const b = mod(end);
    if (a > b ? x >= a || x < b : x >= a && x < b) return true;
  }
  return false;
}

/** The contiguous held span around slot `s` (Chicago minutes; start may be negative = previous day). */
function heldSpan(t, s) {
  const slot = s * 60;
  let from = slot;
  while (migrationHeld(t, from - 1) && slot - from < DAY) from -= 1;
  let until = slot;
  while (migrationHeld(t, until) && until - slot < DAY) until += 1;
  return [from, until];
}

export function renderTimetable(t) {
  const c = t.cycle;
  const lines = [];
  const utc = (m, off) => hhmm(m - off * 60);
  lines.push('### 1. Every slot, America/Chicago wall clock');
  lines.push('');
  lines.push(
    `Slots ${t.slots.map((s) => hhmm(s * 60)).join(', ')} (${t.timeZone}); the ${hhmm(t.anchorSlot * 60)} slot is the daily anchor. UTC = Chicago + ${-t.utcOffsetHours.CST} h in CST (UTC${t.utcOffsetHours.CST}), + ${-t.utcOffsetHours.CDT} h in CDT (UTC${t.utcOffsetHours.CDT}); every row moves with the slot.`
  );
  lines.push('');
  lines.push(
    '| Slot | Slot UTC (CST / CDT) | Stage reservation opens | Ordinary migrations held (Club Arena dispatcher) | Backup obsolete push runs yield from | Selection: protected main bound | Preparation window ends | Receiver admission closes | Last-hand drain | Break | Migrations install again |'
  );
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const s of t.slots) {
    const S = s * 60;
    const sel = S - c.selectionMinutesBeforeSlot;
    const [hFrom, hUntil] = heldSpan(t, s);
    lines.push(
      `| ${hhmm(S)} | ${utc(S, t.utcOffsetHours.CST)} / ${utc(S, t.utcOffsetHours.CDT)} | ${hhmm(sel - c.stageReservationLookbackMinutes)} | ${hhmm(hFrom)}-${hhmm(hUntil)} | ${hhmm(sel - c.backupYieldSecondsBeforeSelection / 60)} | ${hhmm(sel)} | ${hhmm(sel + c.preparationWindowMinutes)} | ${hhmm(S - c.receiverAdmissionLeadSeconds / 60)} | ${hhmm(S - c.lastHandLeadMinutes)} | ${hhmm(S)}-${hhmm(S + c.breakMinutes)} | ${hhmm(hUntil)} |`
    );
  }
  lines.push('');
  lines.push('### 2. The same cycle as offsets from the slot S');
  lines.push('');
  lines.push('| Offset | Event | Enforced by |');
  lines.push('| --- | --- | --- |');
  const sel = c.selectionMinutesBeforeSlot;
  const rows = [
    [
      -(sel + c.stageReservationLookbackMinutes),
      'Stage reservation opens (three-hourly policy; the daily policy reserves up to ' +
        t.daily.stageReservationLookbackHours +
        ' h before 03:30)',
      '`.github/workflows/stage-engine-release.yml` `LOOKBACK`',
    ],
    [
      -(sel + c.backupYieldSecondsBeforeSelection / 60),
      'A Backup push run that is already obsolete may yield its soak (newer push waiting and its candidate or migrations diverged)',
      '`.github/workflows/backup-engine.yml` `secs_to_cutoff -ge ' +
        c.backupYieldSecondsBeforeSelection +
        '`',
    ],
    [
      -c.migrationDeferMinutesBeforeSlot,
      'Club Arena dispatcher holds ordinary migrations (non-anchor slots; the anchor is inside the nightly freeze)',
      '`scripts/ci/merged-migration-dispatch.mjs` `THREE_HOURLY_PRE_CUTOFF_DEFER_MINUTES`',
    ],
    [
      -sel,
      'Selection: Stage binds protected main at the cutoff and selects the newest Backup-certified candidate',
      '`.github/workflows/stage-engine-release.yml` `cycle - ' + sel * 60 + '`',
    ],
    [
      -sel + c.preparationWindowMinutes,
      'Preparation window ends (a run that missed it does nothing)',
      '`.github/workflows/stage-engine-release.yml` `WINDOW_MINUTES`',
    ],
    [
      -c.receiverAdmissionLeadSeconds / 60,
      'Receiver refuses to admit a routine cycle with less lead than this',
      '`server/scripts/engine-release-seal.py` `ROUTINE_CYCLE_ADMISSION_LEAD_SECONDS`',
    ],
    [
      -c.lastHandLeadMinutes,
      'Announcement: last hand, tables drain',
      '`server/src/maintenance/MaintenanceBreak.ts` `LAST_HAND_LEAD_MS`',
    ],
    [
      0,
      'Break starts; the release transaction swaps, proves, seals or rolls back',
      '`server/src/maintenance/MaintenanceBreak.ts` `BREAK_START_MINUTE`',
    ],
    [
      c.breakMinutes,
      'Scheduled break length ends (thaw follows the seal)',
      '`server/src/maintenance/MaintenanceBreak.ts` `BREAK_DURATION_MS`',
    ],
    [
      c.migrationClearMinutesAfterSlot,
      'Ordinary migrations install again (outside the nightly freeze)',
      '`scripts/ci/merged-migration-dispatch.mjs` `THREE_HOURLY_POST_SEAL_CLEAR_MINUTE`',
    ],
    [
      3 * 60 - c.migrationDeferMinutesBeforeSlot,
      `Ordinary migrations held again for the next slot: the install window is ${3 * 60 - c.migrationDeferMinutesBeforeSlot - c.migrationClearMinutesAfterSlot} minutes, and a copy certified after it stays current until the next slot`,
      '`scripts/ci/merged-migration-dispatch.mjs` `THREE_HOURLY_PRE_CUTOFF_DEFER_MINUTES` (next slot)',
    ],
  ];
  rows.sort((a, b) => a[0] - b[0]);
  for (const [off, what, src] of rows) {
    lines.push(`| S${off < 0 ? '' : '+'}${off} min | ${what} | ${src} |`);
  }
  lines.push('');
  lines.push('### 3. Every hour (UTC minute of the hour)');
  lines.push('');
  const h = t.hourlyUtc;
  lines.push('| Window | Minutes | Enforced by |');
  lines.push('| --- | --- | --- |');
  lines.push(
    `| Database refuses migration DDL (also while an announced engine break or its thaw is active) | :${String(h.ddlRefusedFromMinute).padStart(2, '0')}:00-:${String(h.ddlAdmittedFromMinute - 1).padStart(2, '0')}:59 (admits from :${String(h.ddlAdmittedFromMinute).padStart(2, '0')}) | \`fn_ca_break_window_refuses_migrations\` \`c_window_opens_minute\` / \`c_window_closes_minute\` |`
  );
  lines.push(
    `| Applier refuses to send | :${h.applierRefusedFromMinute}-:${String(h.applierRefusedThroughMinute).padStart(2, '0')} inclusive (sends :${String(h.applierRefusedThroughMinute + 1).padStart(2, '0')}-:${h.applierRefusedFromMinute - 1}) | \`scripts/ci/apply-recorded-migration.mjs\` \`minute >= ${h.applierRefusedFromMinute} \\|\\| minute <= ${h.applierRefusedThroughMinute}\` |`
  );
  lines.push(
    `| Horse switch and settings writes allowed | :${String(h.switchWritesFromMinute).padStart(2, '0')}-:${h.switchWritesThroughMinute} inclusive (refused :${h.switchWritesThroughMinute + 1}-:${String(h.switchWritesFromMinute - 1).padStart(2, '0')}) | \`scripts/ops/horse-option-switch-lib.mjs\` \`WINDOW_MINUTE_MIN\` / \`WINDOW_MINUTE_MAX\` |`
  );
  lines.push(
    `| Switch write spacing | ${t.switchSpacing.crossLaneMinutes} min after any lane's write; ${t.switchSpacing.selfLaneMinutes} min after the same lane's (rollback exempt) | \`CROSS_LANE_SPACING_MINUTES\` / \`SELF_LANE_SPACING_MINUTES\` |`
  );
  lines.push('');
  lines.push('### 4. Every day');
  lines.push('');
  const d = t.daily;
  lines.push('| Window | When | Enforced by |');
  lines.push('| --- | --- | --- |');
  lines.push(
    `| Nightly release schema freeze (no ordinary migration, any repo) | ${d.releaseSchemaFreezeChicago[0]}-${d.releaseSchemaFreezeChicago[1]} Chicago | \`RELEASE_SCHEMA_FREEZE_CHICAGO\` (dispatcher, applier) and \`smarter_private.fn_ca_release_freeze_refuses_migrations\` (database, every repo) |`
  );
  lines.push(
    `| Daily engine guard around the anchor | ${d.dailyMigrationGuardChicago[0]}-${d.dailyMigrationGuardChicago[1]} Chicago | \`DAILY_GUARD_CHICAGO\` |`
  );
  lines.push(
    `| Horse switch daily blackout | ${d.switchBlackoutUtc[0]}Z-${d.switchBlackoutUtc[1]}Z (= ${hhmm(parse(d.switchBlackoutUtc[0]) + t.utcOffsetHours.CST * 60)}-${hhmm(parse(d.switchBlackoutUtc[1]) + t.utcOffsetHours.CST * 60)} CST, ${hhmm(parse(d.switchBlackoutUtc[0]) + t.utcOffsetHours.CDT * 60)}-${hhmm(parse(d.switchBlackoutUtc[1]) + t.utcOffsetHours.CDT * 60)} CDT) | \`DAILY_BLACKOUT_START_UTC_MINUTES\` / \`DAILY_BLACKOUT_END_UTC_MINUTES\` |`
  );
  const nightly = d.backupNightlyRefreshMinutes
    .map((m) => `00:${String(m).padStart(2, '0')}`)
    .join(', ');
  lines.push(
    `| Backup nightly copy refresh | ${nightly} Chicago (cron ${d.backupNightlyRefreshMinutes.join(',')} past ${d.backupNightlyRefreshUtcHours.map((x) => String(x).padStart(2, '0')).join(' and ')} UTC; once per Chicago date) | \`.github/workflows/backup-engine.yml\` \`schedule\` |`
  );
  lines.push('');
  lines.push('### 5. Rules lanes keep that no code enforces yet (each is a gap to encode)');
  lines.push('');
  lines.push('| Rule | Source | Enforcement today | Gap to encode |');
  lines.push('| --- | --- | --- | --- |');
  for (const v of t.conventions) {
    lines.push(`| ${v.rule} | ${v.source} | ${v.enforcement} | ${v.gap} |`);
  }
  lines.push('');
  lines.push('### 6. Announced changes (edit the JSON and the gate together when they land)');
  lines.push('');
  for (const p of t.pendingChanges) lines.push(`- ${p}`);
  return lines.join('\n') + '\n';
}

/**
 * The generated block as content: Prettier (lint-staged) pads markdown table
 * cells to the column width, so the law and --check compare cells, not
 * padding. Every other line compares exactly (trailing space aside).
 */
export function normalizeTimetable(text) {
  return text
    .split('\n')
    .map((line) => {
      if (!line.startsWith('|')) return line.trimEnd();
      return line
        .split(/(?<!\\)\|/)
        .map((cell) => cell.trim())
        .map((cell) => (/^:?-+:?$/.test(cell) ? '---' : cell))
        .join('|');
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The generated block of `md`, between the markers. */
export function generatedBlock(md) {
  const a = md.indexOf(BEGIN);
  const b = md.indexOf(END);
  if (a < 0 || b < a) throw new Error('engine-cutover-timetable.md lost its GENERATED markers');
  return md.slice(a + BEGIN.length, b);
}

/** True when the document's generated block says what the JSON says. */
export function documentIsCurrent(md, t) {
  return normalizeTimetable(generatedBlock(md)) === normalizeTimetable(renderTimetable(t));
}

export function renderDocument(md, t) {
  const a = md.indexOf(BEGIN);
  const b = md.indexOf(END);
  if (a < 0 || b < a) throw new Error('engine-cutover-timetable.md lost its GENERATED markers');
  return md.slice(0, a + BEGIN.length) + '\n\n' + renderTimetable(t) + '\n' + md.slice(b);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const mode = process.argv[2];
  const t = JSON.parse(readFileSync(TIMETABLE_JSON, 'utf8'));
  if (mode === '--write' || mode === '--check') {
    const md = readFileSync(TIMETABLE_MD, 'utf8');
    const next = renderDocument(md, t);
    if (mode === '--write') writeFileSync(TIMETABLE_MD, next);
    else if (!documentIsCurrent(md, t)) {
      console.error(
        'docs/ops/engine-cutover-timetable.md is stale: run node scripts/ops/engine-cutover-timetable.mjs --write'
      );
      process.exit(1);
    }
  } else {
    process.stdout.write(renderTimetable(t));
  }
}
