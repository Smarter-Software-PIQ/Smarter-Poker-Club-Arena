#!/usr/bin/env node
/**
 * Guardrail #2: CI ban on unbatched DELETEs in pg_cron jobs.
 *
 * Raw `DELETE FROM` statements scheduled directly inside `cron.schedule(...)`
 * or `cron.alter_job(...)` can hold long table/index locks and bloat WAL when
 * retention tables grow to millions of rows.
 *
 * Any NEW migration (timestamp >= 20261120000000) calling `cron.schedule(...)`,
 * `cron.schedule_in_database(...)`, or `cron.alter_job(...)` with a raw
 * `DELETE FROM` inside its scheduled SQL command FAILS unless:
 *   1. It calls a bounded pruner function (e.g. `SELECT smarter_private.fn_prune_x()`), OR
 *   2. The scheduled SQL carries BOTH an explicit `LIMIT` clause AND a
 *      `-- @bounded-cron-delete: <reason>` comment.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const CRON_DELETE_CHECKED_FROM = '20261120000000';

const BOUNDED_CRON_DELETE_ANNOTATION_RE = /--\s*@bounded-cron-delete:\s*\S+/i;
const MIGRATION_VERSION_RE = /(?:^|\/)(\d{14})_[^/]+\.sql$/;

export function migrationVersion(file) {
  const m = MIGRATION_VERSION_RE.exec(String(file).replace(/\\/g, '/'));
  return m ? m[1] : null;
}

export function isCronDeleteChecked(file) {
  const version = migrationVersion(file);
  return version !== null && version >= CRON_DELETE_CHECKED_FROM;
}

function lineNumberAt(text, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) {
    if (text[i] === '\n') line += 1;
  }
  return line;
}

function stripSqlComments(sql) {
  const src = String(sql);
  let out = '';
  let i = 0;
  while (i < src.length) {
    if (src[i] === '-' && src[i + 1] === '-') {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    if (src[i] === '/' && src[i + 1] === '*') {
      let depth = 1;
      i += 2;
      while (i < src.length && depth > 0) {
        if (src[i] === '/' && src[i + 1] === '*') {
          depth += 1;
          i += 2;
        } else if (src[i] === '*' && src[i + 1] === '/') {
          depth -= 1;
          i += 2;
        } else {
          i += 1;
        }
      }
      out += ' ';
      continue;
    }
    out += src[i];
    i += 1;
  }
  return out;
}

/**
 * Extract all string literals (dollar-quoted and single-quoted) inside a
 * balanced argument list starting right after `(`.
 * Returns { endIndex, strings: Array<{ value, offset }> }.
 */
function parseCallArguments(src, openParenIndex) {
  const strings = [];
  let i = openParenIndex + 1;
  let depth = 1;

  while (i < src.length && depth > 0) {
    // Line comment
    if (src[i] === '-' && src[i + 1] === '-') {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }

    // Block comment
    if (src[i] === '/' && src[i + 1] === '*') {
      let cdepth = 1;
      i += 2;
      while (i < src.length && cdepth > 0) {
        if (src[i] === '/' && src[i + 1] === '*') {
          cdepth += 1;
          i += 2;
        } else if (src[i] === '*' && src[i + 1] === '/') {
          cdepth -= 1;
          i += 2;
        } else {
          i += 1;
        }
      }
      continue;
    }

    // Single-quoted string literal
    if (src[i] === "'") {
      const startOffset = i;
      let val = '';
      i += 1;
      while (i < src.length) {
        if (src[i] === "'") {
          if (src[i + 1] === "'") {
            val += "'";
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        val += src[i];
        i += 1;
      }
      strings.push({ value: val, offset: startOffset });
      continue;
    }

    // Dollar-quoted string literal ($tag$...$tag$)
    if (src[i] === '$') {
      const tagMatch = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(src.slice(i));
      if (tagMatch) {
        const tag = tagMatch[0];
        const contentStart = i + tag.length;
        const end = src.indexOf(tag, contentStart);
        if (end >= 0) {
          strings.push({ value: src.slice(contentStart, end), offset: i });
          i = end + tag.length;
          continue;
        }
      }
    }

    if (src[i] === '(') {
      depth += 1;
    } else if (src[i] === ')') {
      depth -= 1;
      if (depth === 0) {
        return { endIndex: i + 1, strings };
      }
    }
    i += 1;
  }

  return { endIndex: i, strings };
}

function hasBoundedAnnotation(lines, callLine, literalLine, rawCommand) {
  if (BOUNDED_CRON_DELETE_ANNOTATION_RE.test(rawCommand)) return true;
  if (BOUNDED_CRON_DELETE_ANNOTATION_RE.test(lines[callLine - 1] ?? '')) return true;
  if (BOUNDED_CRON_DELETE_ANNOTATION_RE.test(lines[literalLine - 1] ?? '')) return true;

  for (const anchorLine of [literalLine, callLine]) {
    for (let idx = anchorLine - 2; idx >= 0; idx -= 1) {
      const trimmed = lines[idx].trim();
      if (trimmed === '') continue;
      if (trimmed.startsWith('--')) {
        if (BOUNDED_CRON_DELETE_ANNOTATION_RE.test(trimmed)) return true;
        continue;
      }
      break;
    }
  }
  return false;
}

/**
 * Scan a SQL migration string for unbatched DELETE FROM statements inside
 * `cron.schedule(...)`, `cron.schedule_in_database(...)`, or `cron.alter_job(...)`.
 *
 * Returns an array of violations:
 *   { file, line, callName, reason, snippet }
 */
export function findUnboundedCronDeleteViolations(sql, file = '<inline>') {
  const src = String(sql);
  const lines = src.split('\n');
  const violations = [];

  let i = 0;
  while (i < src.length) {
    // Skip line comments
    if (src[i] === '-' && src[i + 1] === '-') {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }

    // Skip block comments
    if (src[i] === '/' && src[i + 1] === '*') {
      let cdepth = 1;
      i += 2;
      while (i < src.length && cdepth > 0) {
        if (src[i] === '/' && src[i + 1] === '*') {
          cdepth += 1;
          i += 2;
        } else if (src[i] === '*' && src[i + 1] === '/') {
          cdepth -= 1;
          i += 2;
        } else {
          i += 1;
        }
      }
      continue;
    }

    // Skip single-quoted strings outside cron calls
    if (src[i] === "'") {
      i += 1;
      while (i < src.length) {
        if (src[i] === "'") {
          if (src[i + 1] === "'") {
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    // Check for cron.schedule / cron.schedule_in_database / cron.alter_job
    if ((src[i] === 'c' || src[i] === 'C') && (i === 0 || !/[A-Za-z0-9_"]/.test(src[i - 1]))) {
      const callMatch = /^cron\s*\.\s*(schedule_in_database|schedule|alter_job)\s*\(/i.exec(
        src.slice(i)
      );
      if (callMatch) {
        const callName = `cron.${callMatch[1].toLowerCase()}`;
        const callLine = lineNumberAt(src, i);
        const openParenIndex = i + callMatch[0].length - 1;
        const { endIndex, strings } = parseCallArguments(src, openParenIndex);

        for (const str of strings) {
          const cleaned = stripSqlComments(str.value);
          if (!/\bdelete\s+from\b/i.test(cleaned)) continue;

          const literalLine = lineNumberAt(src, str.offset);
          const hasLimit = /\blimit\b/i.test(cleaned);
          const hasAnnotation = hasBoundedAnnotation(lines, callLine, literalLine, str.value);

          if (hasLimit && hasAnnotation) continue;

          const missing = [];
          if (!hasLimit) missing.push('explicit LIMIT');
          if (!hasAnnotation) missing.push('-- @bounded-cron-delete: <reason>');

          violations.push({
            file,
            line: literalLine,
            callName,
            reason: `raw DELETE FROM inside ${callName}(...) missing ${missing.join(' and ')}`,
            snippet: str.value.replace(/\s+/g, ' ').trim().slice(0, 140),
          });
        }

        i = endIndex;
        continue;
      }
    }

    i += 1;
  }

  return violations;
}

/**
 * Scan all migrations with timestamp >= CRON_DELETE_CHECKED_FROM in a directory.
 */
export function checkMigrationsDir(migrationsDir) {
  if (!existsSync(migrationsDir)) return { checkedCount: 0, violations: [] };
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  const violations = [];
  let checkedCount = 0;
  for (const name of files) {
    if (!isCronDeleteChecked(name)) continue;
    checkedCount += 1;
    const fullPath = join(migrationsDir, name);
    const sql = readFileSync(fullPath, 'utf8');
    violations.push(...findUnboundedCronDeleteViolations(sql, `supabase/migrations/${name}`));
  }
  return { checkedCount, violations };
}

function main() {
  const dirArg = process.argv[2] || join(process.cwd(), 'supabase', 'migrations');
  const { checkedCount, violations } = checkMigrationsDir(dirArg);

  if (violations.length > 0) {
    console.error(
      `[check-cron-deletes-are-bounded] FAIL: ${violations.length} unbatched pg_cron DELETE(s) found:`
    );
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line} [${v.callName}] ${v.reason}`);
      console.error(`    SQL: ${v.snippet}`);
    }
    console.error(
      '\nCall a bounded batch pruner function (e.g. SELECT smarter_private.fn_prune_x()), ' +
        'or add an explicit LIMIT + `-- @bounded-cron-delete: <reason>` comment.'
    );
    process.exit(1);
  }

  console.log(
    `[check-cron-deletes-are-bounded] OK: ${checkedCount} migration(s) >= ${CRON_DELETE_CHECKED_FROM} checked (${basename(dirArg)}).`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
