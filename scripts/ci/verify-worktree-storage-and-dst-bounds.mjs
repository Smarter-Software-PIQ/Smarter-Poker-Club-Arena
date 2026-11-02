#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

/**
 * Evaluates whether a candidate worktree or scratch path complies with the
 * Owner Storage Policy (`/Users/smarter.poker/Documents/MAC-STORAGE.md`):
 * when `/Volumes/SmarterWork` is mounted, worktrees and scratch directories
 * must reside on `/Volumes/SmarterWork/agent-work` (or `/Volumes/SmarterArchives/agent-evidence`)
 * and never on the internal boot disk (`~/Documents/.agent-trees`, `~/claude-work`, `/tmp`, etc.).
 */
export function evaluateWorktreeStorageCompliance({
  worktreePath,
  ssdMounted = true,
  homeDir = '/Users/smarter.poker',
}) {
  if (typeof worktreePath !== 'string' || worktreePath.trim().length === 0) {
    return { compliant: false, reason: 'missing_worktree_path' };
  }
  const normalized = worktreePath.replace(/\/+$/, '');
  const forbiddenPrefixes = [
    `${homeDir}/Documents/.agent-trees`,
    `${homeDir}/Documents/agent-work`,
    `${homeDir}/claude-work`,
    `${homeDir}/agent-work-overflow`,
    `${homeDir}/tmp-claude`,
    '/tmp',
    '/private/tmp',
  ];

  for (const prefix of forbiddenPrefixes) {
    if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
      return {
        compliant: false,
        reason: 'forbidden_internal_drive_path',
        matchedPrefix: prefix,
      };
    }
  }

  if (ssdMounted) {
    const allowedPrefixes = [
      '/Volumes/SmarterWork/agent-work',
      '/Volumes/SmarterArchives/agent-evidence',
      `${homeDir}/mnt/SmarterWork`,
      `${homeDir}/mnt/SmarterArchives`,
    ];
    const onAllowedVolume = allowedPrefixes.some(
      (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`)
    );
    if (!onAllowedVolume) {
      return {
        compliant: false,
        reason: 'not_on_mounted_external_ssd',
      };
    }
  }

  return {
    compliant: true,
    reason: 'ok',
  };
}

/**
 * Computes the Monday 00:00 America/Los_Angeles union week start epoch (ms)
 * for any UTC timestamp, handling both PDT (`UTC-7`, `07:00 UTC`) and PST
 * (`UTC-8`, `08:00 UTC`) transitions deterministically without drifting into
 * the prior week during the first 10 minutes after Monday 00:00 LA time.
 */
export function computeUnionWeekStartLaEpochMs(nowEpochMs) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(new Date(nowEpochMs)).map((p) => [p.type, p.value])
  );
  const weekdayMap = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  const daysSinceMonday = weekdayMap[parts.weekday] ?? 0;

  // Target calendar Monday in America/Los_Angeles
  const utcMidnightApprox = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day) - daysSinceMonday,
    12,
    0,
    0
  );
  const mondayParts = Object.fromEntries(
    dtf.formatToParts(new Date(utcMidnightApprox)).map((p) => [p.type, p.value])
  );
  const y = Number(mondayParts.year);
  const m = Number(mondayParts.month);
  const d = Number(mondayParts.day);

  // Probe 07:00 UTC (PDT) and 08:00 UTC (PST) to find exact 00:00:00 America/Los_Angeles
  for (const utcHour of [7, 8]) {
    const candidateMs = Date.UTC(y, m - 1, d, utcHour, 0, 0, 0);
    const check = Object.fromEntries(
      dtf.formatToParts(new Date(candidateMs)).map((p) => [p.type, p.value])
    );
    if (
      Number(check.year) === y &&
      Number(check.month) === m &&
      Number(check.day) === d &&
      (check.hour === '00' || check.hour === '24') &&
      check.minute === '00'
    ) {
      return candidateMs;
    }
  }
  return Date.UTC(y, m - 1, d, 8, 0, 0, 0);
}

/**
 * Clamps a synthetic incident offset (e.g. `now - 10 minutes`) so it never
 * crosses backward across the current `America/Los_Angeles` union week boundary.
 */
export function clampSyntheticIncidentTimestampMs(nowEpochMs, offsetMs = -10 * 60 * 1000) {
  const weekStartMs = computeUnionWeekStartLaEpochMs(nowEpochMs);
  return Math.max(weekStartMs, nowEpochMs + offsetMs);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const targetPath = process.argv[2] || process.cwd();
  const res = evaluateWorktreeStorageCompliance({ worktreePath: targetPath });
  console.log(JSON.stringify(res, null, 2));
  process.exit(res.compliant ? 0 : 1);
}
