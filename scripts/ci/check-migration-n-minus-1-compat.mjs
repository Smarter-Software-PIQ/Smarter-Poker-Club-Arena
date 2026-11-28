#!/usr/bin/env node
/**
 * N-1 SERVING-ENGINE & WINDOW-MIGRATION BACKWARD-COMPATIBILITY GUARD
 *
 * Analyzes new/modified SQL migrations (both ordinary and
 * "-- @install-window: daily-maintenance") for breaking destructive DDL that
 * breaks the currently serving N-1 engine (during the up-to-2.5h gap after an
 * ordinary install OR during rollback after a 04:00 window install):
 *   - DROP TABLE
 *   - DROP COLUMN
 *   - ALTER COLUMN ... TYPE
 *   - DROP FUNCTION / PROCEDURE / ROUTINE (and ALTER FUNCTION ... RENAME TO)
 *   - RENAME COLUMN
 *   - RENAME TABLE
 *   - ADD COLUMN ... NOT NULL without DEFAULT (or GENERATED ALWAYS)
 * when the affected table/column/function is still referenced in server/src/
 * (or src/ for shared RPCs/tables).
 *
 * Safe expand-and-contract migrations pass cleanly:
 *   - ADD COLUMN ... (nullable)
 *   - ADD COLUMN ... NOT NULL DEFAULT ...
 *   - ADD COLUMN ... GENERATED ALWAYS AS (...) STORED NOT NULL
 *   - CREATE OR REPLACE FUNCTION preserving signature
 *   - Operations on unreferenced or pg_temp.* objects
 *   - Explicitly annotated "-- @n-minus-1-safe: <reason (>= 10 chars)>"
 *
 * Usage:
 *   node scripts/ci/check-migration-n-minus-1-compat.mjs \
 *     --mig-dir <dir> --changed <changed-files.txt> --repo <repo-root>
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

export const N_MINUS_1_SAFE_ANNOTATION = '-- @n-minus-1-safe:';
export const MIN_SAFE_REASON_LENGTH = 10;

const SAFE_COMMENT_RE = /^--[ \t]*@n-minus-1-safe:[ \t]*(.*)$/i;
const SUPERSEDED_RE = /^--[ \t]*SUPERSEDED\s+BY\s+\d{14}\b/im;
const NAME_RE = String.raw`((?:"?[A-Za-z_][A-Za-z0-9_$]*"?\.)?"?[A-Za-z_][A-Za-z0-9_$]*"?)`;
const IDENT_RE = String.raw`("?[A-Za-z_][A-Za-z0-9_$]*"?)`;

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const SKIP_DIR_NAMES = new Set(['node_modules', 'dist', '__tests__', 'fixtures', '.git']);

const unquote = (s) => String(s || '').replace(/"/g, '').trim().toLowerCase();

function splitSchemaName(raw) {
  const clean = unquote(raw);
  const dot = clean.indexOf('.');
  if (dot < 0) return { schema: 'public', name: clean };
  return { schema: clean.slice(0, dot), name: clean.slice(dot + 1) };
}

function matchDollarQuoteTag(s, i) {
  if (s[i] !== '$' || /[A-Za-z0-9_$]/.test(s[i - 1] ?? ' ')) return null;
  const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(s.slice(i, i + 80));
  return m ? m[0] : null;
}

function skipQuotedSpan(s, i, quote) {
  let j = i + 1;
  while (j < s.length) {
    const k = s.indexOf(quote, j);
    if (k < 0) return s.length;
    if (s[k + 1] === quote) {
      j = k + 2;
      continue;
    }
    return k + 1;
  }
  return s.length;
}

function skipBlockComment(s, i) {
  let depth = 1;
  let j = i + 2;
  while (j < s.length && depth > 0) {
    if (s[j] === '/' && s[j + 1] === '*') {
      depth++;
      j += 2;
    } else if (s[j] === '*' && s[j + 1] === '/') {
      depth--;
      j += 2;
    } else {
      j++;
    }
  }
  return j;
}

/**
 * True when the migration carries an explicit top-level `-- @n-minus-1-safe: <reason>`
 * line comment (outside single/double-quoted strings, dollar-quoted bodies, and
 * block comments) with at least MIN_SAFE_REASON_LENGTH non-whitespace characters.
 */
export function isNMinus1SafeAnnotated(sql) {
  const s = String(sql);
  let i = 0;
  let atLineStart = true;
  while (i < s.length) {
    const c = s[i];
    const n = s[i + 1];
    if (c === '\n') {
      atLineStart = true;
      i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }
    if (c === '-' && n === '-') {
      const e = s.indexOf('\n', i);
      const end = e < 0 ? s.length : e;
      if (atLineStart) {
        const line = s.slice(i, end).replace(/\r$/, '');
        const m = SAFE_COMMENT_RE.exec(line);
        if (m && (m[1] ?? '').trim().length >= MIN_SAFE_REASON_LENGTH) return true;
      }
      i = end;
      atLineStart = false;
      continue;
    }
    if (c === '/' && n === '*') {
      i = skipBlockComment(s, i);
      atLineStart = false;
      continue;
    }
    if (c === "'" || c === '"') {
      i = skipQuotedSpan(s, i, c);
      atLineStart = false;
      continue;
    }
    const tag = matchDollarQuoteTag(s, i);
    if (tag) {
      const close = s.indexOf(tag, i + tag.length);
      i = close < 0 ? s.length : close + tag.length;
      atLineStart = false;
      continue;
    }
    atLineStart = false;
    i++;
  }
  return false;
}

/**
 * Iteratively strip leading PL/pgSQL block/control headers so DDL nested inside
 * DO blocks (DECLARE/BEGIN/IF/ELSIF/ELSE/FOR/LOOP/EXCEPTION/WHEN) is exposed.
 */
function stripPlpgsqlHeaders(rawStmt) {
  let stmt = String(rawStmt || '').trim();
  for (;;) {
    const next = stmt
      .replace(/^<<[A-Za-z_][A-Za-z0-9_]*>>\s*/i, '')
      .replace(/^DECLARE\b[^;]*;\s*/i, '')
      .replace(/^DECLARE\b\s+(?=BEGIN\b)/i, '')
      .replace(/^(?:BEGIN|ELSE|LOOP|EXCEPTION)\b\s*/i, '')
      .replace(/^(?:IF|ELSIF|WHEN)\b[\s\S]*?\bTHEN\b\s*/i, '')
      .replace(/^FOR\b[\s\S]*?\bLOOP\b\s*/i, '')
      .trim();
    if (next === stmt) break;
    stmt = next;
  }
  return stmt;
}

/**
 * Statement-level SQL text: removes -- and block comments, strips CREATE
 * FUNCTION/PROCEDURE bodies, expands DO blocks so DDL inside DO blocks is
 * inspected while function bodies are not mistaken for top-level DDL, and
 * preserves string/dollar-quoted literals inside EXECUTE statements so dynamic
 * DDL is also inspected.
 */
function ddlStatementText(sql) {
  const s = String(sql);
  let out = '';
  let i = 0;
  let stmtStart = 0;
  while (i < s.length) {
    const c = s[i];
    const n = s[i + 1];
    if (c === '-' && n === '-') {
      const e = s.indexOf('\n', i);
      i = e < 0 ? s.length : e;
      continue;
    }
    if (c === '/' && n === '*') {
      i = skipBlockComment(s, i);
      out += ' ';
      continue;
    }
    if (c === "'") {
      const j = skipQuotedSpan(s, i, "'");
      const curHeader = stripPlpgsqlHeaders(out.slice(stmtStart));
      out += /^EXECUTE\b/i.test(curHeader) ? s.slice(i, j) : "''";
      i = j;
      continue;
    }
    const tag = matchDollarQuoteTag(s, i);
    if (tag) {
      const close = s.indexOf(tag, i + tag.length);
      const end = close < 0 ? s.length : close + tag.length;
      const body = s.slice(i + tag.length, close < 0 ? s.length : close);
      const stmtHeader = stripPlpgsqlHeaders(out.slice(stmtStart));
      if (/^DO\b/i.test(stmtHeader)) {
        out = out.slice(0, stmtStart) + ' ' + ddlStatementText(body) + ';';
        stmtStart = out.length;
      } else if (/^CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\b/i.test(stmtHeader)) {
        out = out.slice(0, stmtStart);
      } else if (/^EXECUTE\b/i.test(stmtHeader)) {
        out += s.slice(i, end);
      } else {
        out += "''";
      }
      i = end;
      continue;
    }
    if (c === ';') stmtStart = out.length + 1;
    out += c;
    i++;
  }
  return out;
}

function splitTopLevel(text, delimiter) {
  const parts = [];
  let depth = 0;
  let cur = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "'" || ch === '"') {
      const end = skipQuotedSpan(text, i, ch);
      cur += text.slice(i, end);
      i = end;
      continue;
    }
    const tag = matchDollarQuoteTag(text, i);
    if (tag) {
      const close = text.indexOf(tag, i + tag.length);
      const end = close < 0 ? text.length : close + tag.length;
      cur += text.slice(i, end);
      i = end;
      continue;
    }
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (ch === delimiter && depth === 0) {
      if (cur.trim()) parts.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
    i++;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function balancedAfterOpenParen(text, openIdx) {
  let depth = 0;
  let i = openIdx;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "'" || ch === '"') {
      i = skipQuotedSpan(text, i, ch);
      continue;
    }
    const tag = matchDollarQuoteTag(text, i);
    if (tag) {
      const close = text.indexOf(tag, i + tag.length);
      i = close < 0 ? text.length : close + tag.length;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return i + 1;
    i++;
  }
  return text.length;
}

function parseSqlStringLiteral(expr) {
  const s = String(expr || '').trim();
  if (!s) return null;
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) {
    // Ensure single literal (no unescaped closing quote before the end).
    if (skipQuotedSpan(s, 0, "'") === s.length) {
      return s.slice(1, -1).replace(/''/g, "'");
    }
  }
  const tag = matchDollarQuoteTag(s, 0);
  if (tag) {
    const close = s.indexOf(tag, tag.length);
    if (close >= 0 && close + tag.length === s.length) {
      return s.slice(tag.length, close);
    }
  }
  return null;
}

function extractExecuteDynamicSql(stmt) {
  const m = /^EXECUTE\b\s*([\s\S]+)$/i.exec(stmt);
  if (!m) return [];
  const expr = m[1].trim();
  // Case 1: EXECUTE [pg_catalog.]format('...', arg1, arg2, ...)
  const fmtMatch = /^(?:pg_catalog\s*\.\s*)?format\s*\(/i.exec(expr);
  if (fmtMatch) {
    const openIdx = fmtMatch[0].length - 1;
    const closeIdx = balancedAfterOpenParen(expr, openIdx);
    const argsText = expr.slice(openIdx + 1, closeIdx - 1);
    const args = splitTopLevel(argsText, ',');
    if (args.length === 0) return [];
    const template = parseSqlStringLiteral(args[0]);
    if (template === null) return [];
    const literalArgs = args.slice(1).map((a) => parseSqlStringLiteral(a));
    let nextArg = 0;
    const expanded = template.replace(/%(?:%|(\d+)\$([IsL])|([IsL]))/g, (full, posIdx, posType, seqType) => {
      if (full === '%%') return '%';
      const idx = posIdx ? Number.parseInt(posIdx, 10) - 1 : nextArg++;
      const kind = posType || seqType;
      const val = idx >= 0 && idx < literalArgs.length ? literalArgs[idx] : null;
      if (val === null || val === undefined) return full;
      if (kind === 'L') return `'${val.replace(/'/g, "''")}'`;
      return val;
    });
    return [expanded];
  }

  // Case 2: EXECUTE '...' or EXECUTE $tag$...$tag$ or literal concatenation ('...' || '...')
  const pieces = [];
  let i = 0;
  let depth = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (ch === "'" ) {
      const end = skipQuotedSpan(expr, i, "'");
      if (depth === 0) pieces.push(expr.slice(i + 1, end - 1).replace(/''/g, "'"));
      i = end;
      continue;
    }
    const tag = matchDollarQuoteTag(expr, i);
    if (tag) {
      const close = expr.indexOf(tag, i + tag.length);
      const end = close < 0 ? expr.length : close + tag.length;
      if (depth === 0) pieces.push(expr.slice(i + tag.length, close < 0 ? expr.length : close));
      i = end;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    // Stop before INTO / USING clause at top level.
    if (depth === 0 && /^(?:INTO|USING)\b/i.test(expr.slice(i)) && !/[A-Za-z0-9_$]/.test(expr[i - 1] ?? ' ')) {
      break;
    }
    i++;
  }
  if (pieces.length === 0) return [];
  return [pieces.join('')];
}

/**
 * Extract potentially N-1 breaking DDL operations from a migration file.
 */
export function extractBreakingDdlOps(sql, depth = 0) {
  const text = ddlStatementText(sql);
  const statements = splitTopLevel(text, ';');
  const ops = [];

  for (const rawStmt of statements) {
    const stmt = stripPlpgsqlHeaders(rawStmt);
    if (!stmt) continue;

    // 0. Dynamic SQL via EXECUTE '...' / EXECUTE format('...', ...)
    if (/^EXECUTE\b/i.test(stmt) && depth < 4) {
      for (const dynSql of extractExecuteDynamicSql(stmt)) {
        ops.push(...extractBreakingDdlOps(dynSql, depth + 1));
      }
      continue;
    }

    // 1. DROP TABLE [IF EXISTS] t1 [, t2 ...]
    const dropTbl = /^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\s\S]+)$/i.exec(stmt);
    if (dropTbl) {
      const listPart = dropTbl[1].replace(/\s+(?:CASCADE|RESTRICT)\s*$/i, '').trim();
      for (const item of splitTopLevel(listPart, ',')) {
        const nm = new RegExp(`^${NAME_RE}$`).exec(item.trim());
        if (!nm) continue;
        const { schema, name } = splitSchemaName(nm[1]);
        if (schema === 'pg_temp') continue;
        ops.push({
          kind: 'DROP_TABLE',
          schema,
          table: name,
          target: `${schema}.${name}`,
        });
      }
      continue;
    }

    // 2. DROP FUNCTION|PROCEDURE|ROUTINE [IF EXISTS] fn1(...) [, fn2(...)]
    const dropFn = /^DROP\s+(?:FUNCTION|PROCEDURE|ROUTINE)\s+(?:IF\s+EXISTS\s+)?/i.exec(stmt);
    if (dropFn) {
      let pos = dropFn[0].length;
      while (pos < stmt.length) {
        const nm = new RegExp(`^\\s*${NAME_RE}\\s*(\\()?`).exec(stmt.slice(pos));
        if (!nm) break;
        pos += nm[0].length;
        if (nm[2]) pos = balancedAfterOpenParen(stmt, pos - 1);
        const { schema, name } = splitSchemaName(nm[1]);
        if (schema !== 'pg_temp') {
          ops.push({
            kind: 'DROP_FUNCTION',
            schema,
            name,
            target: `${schema}.${name}`,
          });
        }
        const comma = /^\s*,/.exec(stmt.slice(pos));
        if (!comma) break;
        pos += comma[0].length;
      }
      continue;
    }

    // 3. ALTER FUNCTION|PROCEDURE|ROUTINE <name>(...) RENAME TO <new>
    const renameFn = new RegExp(
      `^ALTER\\s+(?:FUNCTION|PROCEDURE|ROUTINE)\\s+${NAME_RE}\\s*(?:\\([\\s\\S]*?\\))?\\s+RENAME\\s+TO\\s+${IDENT_RE}`,
      'i'
    ).exec(stmt);
    if (renameFn) {
      const { schema, name } = splitSchemaName(renameFn[1]);
      if (schema !== 'pg_temp') {
        ops.push({
          kind: 'RENAME_FUNCTION',
          schema,
          name,
          target: `${schema}.${name}`,
        });
      }
      continue;
    }

    // 4. ALTER TABLE [IF EXISTS] [ONLY] <name> <actions>
    const alterTbl = new RegExp(
      `^ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?${NAME_RE}\\s+([\\s\\S]+)$`,
      'i'
    ).exec(stmt);
    if (alterTbl) {
      const { schema, name: table } = splitSchemaName(alterTbl[1]);
      if (schema === 'pg_temp') continue;
      const clauses = splitTopLevel(alterTbl[2], ',');
      for (const clause of clauses) {
        // RENAME TO <new_table>
        const renameTbl = new RegExp(`^RENAME\\s+TO\\s+${IDENT_RE}\\b`, 'i').exec(clause);
        if (renameTbl) {
          ops.push({
            kind: 'RENAME_TABLE',
            schema,
            table,
            newName: unquote(renameTbl[1]),
            target: `${schema}.${table}`,
          });
          continue;
        }

        // RENAME [COLUMN] <old_col> TO <new_col>
        const renameCol = new RegExp(
          `^RENAME\\s+(?:COLUMN\\s+)?${IDENT_RE}\\s+TO\\s+${IDENT_RE}\\b`,
          'i'
        ).exec(clause);
        if (renameCol && !/^CONSTRAINT$/i.test(unquote(renameCol[1]))) {
          const column = unquote(renameCol[1]);
          ops.push({
            kind: 'RENAME_COLUMN',
            schema,
            table,
            column,
            newName: unquote(renameCol[2]),
            target: `${schema}.${table}.${column}`,
          });
          continue;
        }

        // DROP [COLUMN] [IF EXISTS] <col>
        const dropCol = new RegExp(
          `^DROP\\s+(?:COLUMN\\s+)?(?:IF\\s+EXISTS\\s+)?${IDENT_RE}(?:\\s+(?:CASCADE|RESTRICT))?\\s*$`,
          'i'
        ).exec(clause);
        if (dropCol) {
          const maybeKw = unquote(dropCol[1]);
          if (
            !/^(constraint|default|expression|identity|not|rule|policy|trigger|statistics)$/i.test(
              maybeKw
            )
          ) {
            ops.push({
              kind: 'DROP_COLUMN',
              schema,
              table,
              column: maybeKw,
              target: `${schema}.${table}.${maybeKw}`,
            });
          }
          continue;
        }

        // ALTER [COLUMN] <col> [SET DATA] TYPE <new_type>
        const alterType = new RegExp(
          `^ALTER\\s+(?:COLUMN\\s+)?${IDENT_RE}\\s+(?:SET\\s+DATA\\s+)?TYPE\\b`,
          'i'
        ).exec(clause);
        if (alterType) {
          const column = unquote(alterType[1]);
          ops.push({
            kind: 'ALTER_COLUMN_TYPE',
            schema,
            table,
            column,
            target: `${schema}.${table}.${column}`,
          });
          continue;
        }

        // ADD [COLUMN] [IF NOT EXISTS] <col> <type> ... NOT NULL (without DEFAULT or GENERATED)
        const addCol = new RegExp(
          `^ADD\\s+(?:COLUMN\\s+)?(?:IF\\s+NOT\\s+EXISTS\\s+)?${IDENT_RE}\\s+([\\s\\S]+)$`,
          'i'
        ).exec(clause);
        if (addCol) {
          const col = unquote(addCol[1]);
          if (/^(constraint|primary|unique|check|foreign|exclude|like)$/i.test(col)) continue;
          const def = addCol[2];
          const hasNotNull = /\bNOT\s+NULL\b/i.test(def);
          const hasDefault = /\bDEFAULT\b/i.test(def);
          const hasGenerated = /\bGENERATED\s+(?:ALWAYS|BY\s+DEFAULT)\b/i.test(def);
          if (hasNotNull && !hasDefault && !hasGenerated) {
            ops.push({
              kind: 'ADD_COLUMN_NOT_NULL_NO_DEFAULT',
              schema,
              table,
              column: col,
              target: `${schema}.${table}.${col}`,
            });
          }
        }
      }
    }
  }

  return ops;
}

/**
 * Strip JS/TS // and block comments while preserving string literals so
 * comments mentioning removed tables/columns do not cause false positives.
 */
function stripJsTsComments(src) {
  const s = String(src);
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    const n = s[i + 1];
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < s.length) {
        const ch = s[i];
        out += ch;
        if (ch === '\\' && i + 1 < s.length) {
          out += s[i + 1];
          i += 2;
          continue;
        }
        i++;
        if (ch === quote) break;
      }
      continue;
    }
    if (c === '/' && n === '/') {
      const e = s.indexOf('\n', i);
      i = e < 0 ? s.length : e;
      continue;
    }
    if (c === '/' && n === '*') {
      const e = s.indexOf('*/', i + 2);
      i = e < 0 ? s.length : e + 2;
      out += ' ';
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function collectRuntimeSourceFiles(repoRoot) {
  const files = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      if (SKIP_DIR_NAMES.has(entry)) continue;
      const full = join(dir, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full);
        continue;
      }
      if (!st.isFile()) continue;
      if (/\.(?:test|spec)\.[^.]+$/i.test(entry) || entry.endsWith('.d.ts')) continue;
      const dot = entry.lastIndexOf('.');
      if (dot < 0 || !SOURCE_EXTENSIONS.has(entry.slice(dot).toLowerCase())) continue;
      const rel = relative(repoRoot, full).replace(/\\/g, '/');
      files.push({ path: rel, content: readFileSync(full, 'utf8') });
    }
  };
  walk(join(repoRoot, 'server/src'));
  walk(join(repoRoot, 'src'));
  return files;
}

/**
 * Build an identifier reference index over serving runtime code (`server/src/`
 * and `src/`), or over an explicit array of `{ path, content }` entries.
 */
export function buildServingReferenceIndex(sourceOrRoot) {
  const entries =
    typeof sourceOrRoot === 'string'
      ? collectRuntimeSourceFiles(sourceOrRoot)
      : Array.isArray(sourceOrRoot)
        ? sourceOrRoot
        : [];
  const tokenToFiles = new Map();
  for (const { path, content } of entries) {
    const cleaned = stripJsTsComments(content);
    const seenInFile = new Set();
    for (const m of cleaned.matchAll(/[a-z_][a-z0-9_]*/gi)) {
      const tok = m[0].toLowerCase();
      if (seenInFile.has(tok)) continue;
      seenInFile.add(tok);
      let set = tokenToFiles.get(tok);
      if (!set) {
        set = new Set();
        tokenToFiles.set(tok, set);
      }
      set.add(path);
    }
  }
  return {
    fileCount: entries.length,
    filesReferencing(identifier) {
      const set = tokenToFiles.get(String(identifier || '').toLowerCase());
      return set ? [...set].sort() : [];
    },
  };
}

/**
 * Evaluate one migration file against the N-1 serving reference index.
 */
export function checkMigrationNMinus1Compat(file, sql, index) {
  if (SUPERSEDED_RE.test(sql)) {
    return { ok: true, file, skippedSuperseded: true, annotatedSafe: false, violations: [] };
  }
  if (isNMinus1SafeAnnotated(sql)) {
    return { ok: true, file, skippedSuperseded: false, annotatedSafe: true, violations: [] };
  }

  const ops = extractBreakingDdlOps(sql);
  const violations = [];

  for (const op of ops) {
    if (op.kind === 'DROP_TABLE' || op.kind === 'RENAME_TABLE') {
      const refs = index.filesReferencing(op.table);
      if (refs.length > 0) {
        violations.push({
          ...op,
          reason: `${op.kind} on ${op.target} breaks N-1 serving code still referencing "${op.table}"`,
          references: refs.slice(0, 5),
        });
      }
    } else if (op.kind === 'ADD_COLUMN_NOT_NULL_NO_DEFAULT') {
      const refs = index.filesReferencing(op.table);
      if (refs.length > 0) {
        violations.push({
          ...op,
          reason: `ADD COLUMN ${op.column} NOT NULL without DEFAULT on ${op.schema}.${op.table} breaks N-1 INSERTs (23502) from code referencing "${op.table}"`,
          references: refs.slice(0, 5),
        });
      }
    } else if (op.kind === 'DROP_FUNCTION' || op.kind === 'RENAME_FUNCTION') {
      const refs = index.filesReferencing(op.name);
      if (refs.length > 0) {
        violations.push({
          ...op,
          reason: `${op.kind} on ${op.target} breaks N-1 serving/client callers referencing "${op.name}"`,
          references: refs.slice(0, 5),
        });
      }
    } else if (
      op.kind === 'DROP_COLUMN' ||
      op.kind === 'ALTER_COLUMN_TYPE' ||
      op.kind === 'RENAME_COLUMN'
    ) {
      const tableRefs = index.filesReferencing(op.table);
      if (tableRefs.length === 0) continue;
      const colRefs = index.filesReferencing(op.column);
      if (colRefs.length === 0) continue;
      const colSet = new Set(colRefs);
      const both = tableRefs.filter((p) => colSet.has(p));
      const matched = both.length > 0 ? both : [...new Set([...tableRefs.slice(0, 3), ...colRefs.slice(0, 3)])];
      violations.push({
        ...op,
        reason: `${op.kind} on ${op.target} breaks N-1 serving code referencing "${op.table}" and "${op.column}"`,
        references: matched.slice(0, 5),
      });
    }
  }

  return {
    ok: violations.length === 0,
    file,
    skippedSuperseded: false,
    annotatedSafe: false,
    violations,
  };
}

// CLI:
//   node scripts/ci/check-migration-n-minus-1-compat.mjs --mig-dir <dir> --changed <changed.txt> [--repo <root>]
//   node scripts/ci/check-migration-n-minus-1-compat.mjs --file <migration.sql> [--repo <root>]
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const argVal = (flag) => {
    const idx = argv.indexOf(flag);
    return idx === -1 ? null : argv[idx + 1] || null;
  };
  const repoRoot = argVal('--repo') || process.cwd();
  const migDir = argVal('--mig-dir');
  const changedPath = argVal('--changed');
  const singleFile = argVal('--file');

  const targets = [];
  if (singleFile) {
    targets.push({ name: singleFile.split('/').pop(), path: singleFile });
  } else if (migDir && changedPath) {
    const names = readFileSync(changedPath, 'utf8')
      .split('\n')
      .map((l) => l.trim().replace(/^supabase\/migrations\//, ''))
      .filter((n) => /^\d{14}_[a-z0-9_]+\.sql$/.test(n));
    for (const name of names) {
      const full = join(migDir, name);
      if (existsSync(full)) targets.push({ name, path: full });
    }
  } else {
    console.error(
      'usage: check-migration-n-minus-1-compat.mjs --mig-dir <dir> --changed <changed.txt> [--repo <root>] | --file <sql> [--repo <root>]'
    );
    process.exit(2);
  }

  const index = buildServingReferenceIndex(repoRoot);
  const failures = [];
  for (const { name, path } of targets) {
    const sql = readFileSync(path, 'utf8');
    const res = checkMigrationNMinus1Compat(name, sql, index);
    if (!res.ok) failures.push(res);
  }

  if (failures.length > 0) {
    for (const f of failures) {
      for (const v of f.violations) {
        console.error(
          `[n-minus-1-compat] REFUSED ${f.file}: ${v.reason} (refs: ${v.references.join(', ')})`
        );
      }
    }
    console.error(
      '[n-minus-1-compat] Use expand-and-contract DDL (nullable column / DEFAULT / CREATE OR REPLACE) or add "-- @n-minus-1-safe: <reason>" after verifying zero serving N-1 callers.'
    );
    process.exit(1);
  }
  console.log(
    `[n-minus-1-compat] OK: ${targets.length} migration(s) checked against ${index.fileCount} serving source files; 0 breaking N-1 DDL violations.`
  );
}
