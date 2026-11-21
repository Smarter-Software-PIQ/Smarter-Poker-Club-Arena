#!/usr/bin/env node
/**
 * Guardrail #1: No unannotated FOR UPDATE / FOR SHARE row locks on public.tournaments.
 *
 * Hand commits take FOR KEY SHARE on public.tournaments and shared-lane writers
 * (rebuys, add-ons, moves, breaks, busts, sweeps) take FOR NO KEY UPDATE so that
 * tables in the same tournament never serialize or deadlock on the event row.
 *
 * Any NEW migration (timestamp >= 20261120000000) that acquires FOR UPDATE or
 * FOR SHARE on public.tournaments (or unqualified tournaments) MUST carry an
 * explicit justification comment on the lock line or immediately preceding
 * comment block:
 *
 *   -- @lifecycle-exclusive-lock: <reason>
 *
 * Clean FOR KEY SHARE and FOR NO KEY UPDATE locks always pass.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const HOT_ROW_LOCK_CHECKED_FROM = '20261120000000';

const LIFECYCLE_LOCK_ANNOTATION_RE = /--\s*@lifecycle-exclusive-lock:\s*\S+/i;
const MIGRATION_VERSION_RE = /(?:^|\/)(\d{14})_[^/]+\.sql$/;
const NOT_AN_ALIAS_RE =
  /^(where|set|on|using|for|join|left|right|inner|outer|cross|natural|full|group|order|limit|offset|having|returning|as|and|or|values|into|union|except|intersect|fetch|window)$/i;
const OF_STOP_WORD_RE = /^(nowait|skip|locked|where|order|limit|returning)$/i;

export function migrationVersion(file) {
  const m = MIGRATION_VERSION_RE.exec(String(file).replace(/\\/g, '/'));
  return m ? m[1] : null;
}

export function isHotRowLockChecked(file) {
  const version = migrationVersion(file);
  return version !== null && version >= HOT_ROW_LOCK_CHECKED_FROM;
}

/**
 * Replace SQL comments, single-quoted string literals, and typed JSON dollar
 * literals with spaces while preserving every newline so character offsets map
 * 1:1 to 1-based line numbers in the original SQL.
 */
export function maskSqlPreservingLines(sql) {
  const src = String(sql);
  const chars = new Array(src.length);
  let i = 0;

  while (i < src.length) {
    // Line comment: -- ... \n
    if (src[i] === '-' && src[i + 1] === '-') {
      while (i < src.length && src[i] !== '\n') {
        chars[i] = ' ';
        i += 1;
      }
      if (i < src.length) {
        chars[i] = '\n';
        i += 1;
      }
      continue;
    }

    // Block comment (PostgreSQL allows nesting): /* ... */
    if (src[i] === '/' && src[i + 1] === '*') {
      let depth = 1;
      chars[i] = ' ';
      chars[i + 1] = ' ';
      i += 2;
      while (i < src.length && depth > 0) {
        if (src[i] === '/' && src[i + 1] === '*') {
          depth += 1;
          chars[i] = ' ';
          chars[i + 1] = ' ';
          i += 2;
        } else if (src[i] === '*' && src[i + 1] === '/') {
          depth -= 1;
          chars[i] = ' ';
          chars[i + 1] = ' ';
          i += 2;
        } else {
          chars[i] = src[i] === '\n' ? '\n' : ' ';
          i += 1;
        }
      }
      continue;
    }

    // Single-quoted string literal: '...' with '' escape
    if (src[i] === "'") {
      chars[i] = ' ';
      i += 1;
      while (i < src.length) {
        if (src[i] === "'") {
          chars[i] = ' ';
          i += 1;
          if (src[i] === "'") {
            chars[i] = ' ';
            i += 1;
            continue;
          }
          break;
        }
        chars[i] = src[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      continue;
    }

    // Typed JSON dollar-quoted literal ($tag$...$tag$::jsonb?) — mask interior
    if (src[i] === '$') {
      const tagMatch = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(src.slice(i));
      if (tagMatch) {
        const tag = tagMatch[0];
        const end = src.indexOf(tag, i + tag.length);
        if (end >= 0) {
          const after = end + tag.length;
          if (/^\s*::\s*(?:pg_catalog\s*\.\s*)?jsonb?\b/i.test(src.slice(after))) {
            while (i < after) {
              chars[i] = src[i] === '\n' ? '\n' : ' ';
              i += 1;
            }
            continue;
          }
        }
      }
    }

    chars[i] = src[i];
    i += 1;
  }

  return chars.join('');
}

function lineNumberAt(text, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) {
    if (text[i] === '\n') line += 1;
  }
  return line;
}

function hasAnnotationAboveOrInline(lines, lockLine, stmtStartLine) {
  // 1. Inline comment on the lock line itself.
  const lockLineText = lines[lockLine - 1] ?? '';
  if (LIFECYCLE_LOCK_ANNOTATION_RE.test(lockLineText)) return true;

  // 2. Immediately preceding comment lines directly above the lock line.
  for (let idx = lockLine - 2; idx >= 0; idx -= 1) {
    const trimmed = lines[idx].trim();
    if (trimmed === '') continue;
    if (trimmed.startsWith('--')) {
      if (LIFECYCLE_LOCK_ANNOTATION_RE.test(trimmed)) return true;
      continue;
    }
    break;
  }

  // 3. Immediately preceding comment lines directly above the statement start.
  for (let idx = stmtStartLine - 2; idx >= 0; idx -= 1) {
    const trimmed = lines[idx].trim();
    if (trimmed === '') continue;
    if (trimmed.startsWith('--')) {
      if (LIFECYCLE_LOCK_ANNOTATION_RE.test(trimmed)) return true;
      continue;
    }
    break;
  }

  return false;
}

function parseOfTargets(ofClause) {
  if (!ofClause) return null;
  const raw = ofClause
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const targets = [];
  for (const token of raw) {
    const firstWord = token.split(/\s+/)[0] ?? '';
    const cleaned = firstWord
      .replace(/"/g, '')
      .toLowerCase()
      .replace(/^public\./, '');
    if (!cleaned || OF_STOP_WORD_RE.test(cleaned)) break;
    targets.push(cleaned);
  }
  return targets.length > 0 ? targets : null;
}

/**
 * Scan a SQL migration string for unannotated FOR UPDATE / FOR SHARE locks
 * targeting public.tournaments (or unqualified tournaments).
 *
 * Returns an array of violations:
 *   { file, line, lockMode, snippet }
 */
export function findTournamentHotRowLockViolations(sql, file = '<inline>') {
  const src = String(sql);
  const lines = src.split('\n');
  const masked = maskSqlPreservingLines(src);
  const violations = [];

  let stmtStart = 0;
  for (let pos = 0; pos <= masked.length; pos += 1) {
    if (pos < masked.length && masked[pos] !== ';') continue;

    const stmt = masked.slice(stmtStart, pos);
    const currentStmtStart = stmtStart;
    stmtStart = pos + 1;

    if (!/\bfor\s+(?:update|share)\b/i.test(stmt)) continue;

    // Find all FROM / JOIN references to public.tournaments or tournaments.
    const relRe =
      /\b(?:from|join)\s+(?:only\s+)?(?:"?public"?\s*\.\s*)?"?tournaments"?(?:\s+(?:as\s+)?([a-z_][a-z0-9_]*))?/gi;
    const refs = [];
    let relMatch;
    while ((relMatch = relRe.exec(stmt)) !== null) {
      const maybeAlias = relMatch[1] ? relMatch[1].toLowerCase() : null;
      const alias = maybeAlias && !NOT_AN_ALIAS_RE.test(maybeAlias) ? maybeAlias : null;
      refs.push({ alias });
    }
    if (refs.length === 0) continue;

    const firstNonWs = stmt.search(/\S/);
    const stmtStartLine = lineNumberAt(src, currentStmtStart + (firstNonWs >= 0 ? firstNonWs : 0));

    // Match FOR UPDATE or FOR SHARE (never FOR KEY SHARE or FOR NO KEY UPDATE).
    const lockRe = /\bfor\s+(update|share)\b(?:\s+of\s+([a-z0-9_."]+(?:\s*,\s*[a-z0-9_."]+)*))?/gi;
    let lockMatch;
    while ((lockMatch = lockRe.exec(stmt)) !== null) {
      const lockMode = `FOR ${lockMatch[1].toUpperCase()}`;
      const ofTargets = parseOfTargets(lockMatch[2]);

      if (ofTargets !== null) {
        const targetsTournaments = refs.some(
          (ref) =>
            ofTargets.includes('tournaments') ||
            (ref.alias !== null && ofTargets.includes(ref.alias))
        );
        if (!targetsTournaments) continue;
      }

      const lockOffset = currentStmtStart + lockMatch.index;
      const lockLine = lineNumberAt(src, lockOffset);

      if (hasAnnotationAboveOrInline(lines, lockLine, stmtStartLine)) continue;

      violations.push({
        file,
        line: lockLine,
        lockMode,
        snippet: (lines[lockLine - 1] ?? '').trim(),
      });
    }
  }

  return violations;
}

/**
 * Scan all migrations with timestamp >= HOT_ROW_LOCK_CHECKED_FROM in a directory.
 */
export function checkMigrationsDir(migrationsDir) {
  if (!existsSync(migrationsDir)) return { checkedCount: 0, violations: [] };
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  const violations = [];
  let checkedCount = 0;
  for (const name of files) {
    if (!isHotRowLockChecked(name)) continue;
    checkedCount += 1;
    const fullPath = join(migrationsDir, name);
    const sql = readFileSync(fullPath, 'utf8');
    violations.push(...findTournamentHotRowLockViolations(sql, `supabase/migrations/${name}`));
  }
  return { checkedCount, violations };
}

function main() {
  const dirArg = process.argv[2] || join(process.cwd(), 'supabase', 'migrations');
  const { checkedCount, violations } = checkMigrationsDir(dirArg);

  if (violations.length > 0) {
    console.error(
      `[check-migration-hot-row-locks] FAIL: ${violations.length} unannotated hot-row lock(s) on public.tournaments:`
    );
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line} [${v.lockMode}] ${v.snippet}`);
    }
    console.error(
      '\nUse FOR KEY SHARE (readers/hand commits) or FOR NO KEY UPDATE (shared-lane writers), ' +
        'or add `-- @lifecycle-exclusive-lock: <reason>` on the lock line or immediately preceding comment.'
    );
    process.exit(1);
  }

  console.log(
    `[check-migration-hot-row-locks] OK: ${checkedCount} migration(s) >= ${HOT_ROW_LOCK_CHECKED_FROM} checked (${basename(dirArg)}).`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
