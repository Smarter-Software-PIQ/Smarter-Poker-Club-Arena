// A MIGRATION PROVES ITS FUNCTIONS BEFORE IT COMMITS (2026-11-19).
//
// On 2026-11-18 migration 20261118164000 redefined
// public.fn_cash_capture_hand_manifest with a row source aliased `x`, the name
// of the function's own loop variable. CREATE FUNCTION checks only syntax, so
// the file installed cleanly; PL/pgSQL refused the ambiguous reference the
// first time the engine called it, and every hand manifest capture failed for
// 52 minutes (incident d2d79c4f; fixed by 20261118202500). Nothing between the
// author and production ever executed the new body.
//
// So a migration that creates or replaces a SECURITY DEFINER PL/pgSQL function
// in public or smarter_private now executes it before COMMIT, inside a
// subtransaction that is always undone:
//
//   -- @probe-for: public.fn_example
//   DO $probe$
//   BEGIN
//     PERFORM public.fn_example(<fixture arguments>);
//     RAISE EXCEPTION 'probe-unwind';
//   EXCEPTION WHEN raise_exception THEN
//     IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
//   END $probe$;
//
// The handler swallows only the sentinel: any other error (the function's own
// refusal included) re-raises and the whole migration rolls back, so a body
// that cannot run never reaches production. The subtransaction undoes every
// write the probe made, fixtures included.
//
// A function that cannot be called without an effect outside the transaction
// (dblink, an external call) names itself on a line of its own:
//   -- @probe-exempt: schema.function <why, at least 20 characters>
// Trigger and event-trigger functions are not called directly; the static
// plpgsql_check gate (scripts/ci/plpgsql-check-changed.sh) covers them and
// every path a probe does not reach.
//
// A function redefined by rewriting its live text (the anchored-edit pattern:
// EXECUTE replace(pg_get_functiondef('schema.fn(...)'::regprocedure), ...))
// is a redefinition too, and needs the same probe. Its attributes are not in
// the file, so every such rewrite of a public/smarter_private function is
// covered; a trigger function rewritten this way names itself with
// -- @probe-exempt (2026-11-19, PR #11352 escaped the first version).
//
// Binding on every migration file except the ones on main before the law
// existed (scripts/ci/probe-law-grandfathered-migrations.txt, frozen and
// already installed). A NEW file is bound whatever its version: on 2026-11-19
// 94 open PRs carried migrations versioned before the original cutoff, and a
// version-number cutoff would have let every one of them through.
// Pinned by tests/a-migration-proves-its-functions-before-commit.law.test.ts.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const PROBE_LAW_FROM = '20261119030000';
export const GRANDFATHERED = new Set(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'probe-law-grandfathered-migrations.txt'), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
);
export const PROBE_SENTINEL = 'probe-unwind';
const SCHEMAS = new Set(['public', 'smarter_private']);
const MIN_EXEMPT_REASON = 20;

function stripLineComments(sql) {
  // Keep offsets stable: blank out comment text, not the newline.
  return sql.replace(/--[^\n]*/g, (m) => ' '.repeat(m.length));
}

function stripSqlComments(sql) {
  // Strip SQL line comments (-- ...) and block comments (/* ... */, nested)
  // while leaving single-quoted string literals intact.
  let out = '';
  let i = 0;
  let blockDepth = 0;
  while (i < sql.length) {
    if (blockDepth > 0) {
      if (sql[i] === '/' && sql[i + 1] === '*') {
        blockDepth += 1;
        out += '  ';
        i += 2;
      } else if (sql[i] === '*' && sql[i + 1] === '/') {
        blockDepth -= 1;
        out += '  ';
        i += 2;
      } else {
        out += sql[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      continue;
    }
    if (sql[i] === "'") {
      out += sql[i];
      i += 1;
      while (i < sql.length) {
        out += sql[i];
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            out += sql[i + 1];
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
    if (sql[i] === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }
    if (sql[i] === '/' && sql[i + 1] === '*') {
      blockDepth = 1;
      out += '  ';
      i += 2;
      continue;
    }
    out += sql[i];
    i += 1;
  }
  return out;
}

function dollarBodyEnd(sql, from) {
  const open = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/g;
  open.lastIndex = from;
  const m = open.exec(sql);
  if (!m) return null;
  const tag = m[0];
  const close = sql.indexOf(tag, m.index + tag.length);
  if (close < 0) return null;
  return { bodyStart: m.index + tag.length, bodyEnd: close, after: close + tag.length };
}

/**
 * Every function a migration creates or replaces in public/smarter_private,
 * with whether it is SECURITY DEFINER, PL/pgSQL, and a trigger function.
 */
export function redefinedFunctions(sql) {
  const code = stripLineComments(sql);
  const re = /create\s+(?:or\s+replace\s+)?function\s+(?:("?)([a-z_][a-z0-9_]*)\1\s*\.\s*)?("?)([a-z_][a-z0-9_]*)\3\s*\(/gi;
  const out = [];
  let m;
  while ((m = re.exec(code))) {
    const schema = (m[2] || 'public').toLowerCase();
    const name = m[4].toLowerCase();
    const asAt = code.slice(m.index).search(/\bas\s+\$/i);
    if (asAt < 0) continue;
    const header = code.slice(m.index, m.index + asAt);
    const body = dollarBodyEnd(code, m.index + asAt);
    if (!body) continue;
    const semi = code.indexOf(';', body.after);
    const trailer = code.slice(body.after, semi < 0 ? code.length : semi);
    const attrs = `${header} ${trailer}`;
    out.push({
      schema,
      name,
      qualified: `${schema}.${name}`,
      definer: /\bsecurity\s+definer\b/i.test(attrs),
      plpgsql: /\blanguage\s+'?plpgsql'?/i.test(attrs),
      trigger: /\breturns\s+(?:event_)?trigger\b/i.test(header),
      definedAt: m.index,
      endsAt: semi < 0 ? code.length : semi,
    });
    re.lastIndex = semi < 0 ? code.length : semi;
  }
  return out;
}

// The names of the calls that enclose position `at` in its statement,
// innermost first: for md5(replace(pg_get_functiondef(...))) at the inner
// call, ['replace', 'md5'].
function enclosingCalls(code, at) {
  const names = [];
  let depth = 0;
  for (let i = at - 1; i >= 0; i -= 1) {
    const c = code[i];
    if (c === ';') break;
    if (c === ')') depth += 1;
    else if (c === '(') {
      if (depth === 0) {
        const m = /([a-z_][a-z0-9_]*)\s*$/i.exec(code.slice(Math.max(0, i - 64), i));
        names.push(m ? m[1].toLowerCase() : '');
      } else depth -= 1;
    }
  }
  return names;
}

// A definition read only to be compared - md5(...) of it, position(... IN it)
// - cannot be EXECUTEd: what leaves the call is a hash or an offset. Such reads
// are the md5 preconditions and post-image pins anchored-edit migrations carry
// for functions they do NOT redefine (2026-11-19: 20261119013430 and
// 20261119015312 were refused for their read-only pins, which turned Client
// Unit Tests red on main for every pull request).
const READ_ONLY_CALLS = new Set(['md5', 'position', 'strpos', 'length']);

/**
 * Functions a migration rewrites from their live text:
 * pg_get_functiondef('schema.fn(args)'::regprocedure | 'schema.fn'::regproc)
 * in a file that EXECUTEs dynamic SQL. Unqualified names resolve to public.
 */
export function rewrittenFunctions(sql) {
  const code = stripLineComments(sql);
  if (!/\bexecute\b/i.test(code)) return [];
  const re = /pg_get_functiondef\s*\(\s*'\s*(?:"?([a-z_][a-z0-9_]*)"?\s*\.\s*)?"?([a-z_][a-z0-9_]*)"?\s*(?:\([^']*\))?\s*'\s*::\s*regproc(?:edure)?\b/gi;
  const out = new Map();
  let m;
  while ((m = re.exec(code))) {
    if (enclosingCalls(code, m.index).some((n) => READ_ONLY_CALLS.has(n))) continue;
    const schema = (m[1] || 'public').toLowerCase();
    const name = m[2].toLowerCase();
    const qualified = `${schema}.${name}`;
    const prev = out.get(qualified);
    out.set(qualified, { schema, name, qualified, definedAt: prev ? prev.definedAt : m.index, endsAt: m.index });
  }
  return [...out.values()];
}

/** The functions this law requires a probe for. */
export function functionsNeedingProbe(sql) {
  const created = redefinedFunctions(sql).filter(
    (f) => SCHEMAS.has(f.schema) && f.definer && f.plpgsql && !f.trigger
  );
  const seen = new Set(created.map((f) => f.qualified));
  const rewritten = rewrittenFunctions(sql).filter((f) => SCHEMAS.has(f.schema) && !seen.has(f.qualified));
  return [...created, ...rewritten];
}

function probeBlocks(sql) {
  // Each "-- @probe-for: schema.fn" marker owns the DO block that follows it.
  const out = [];
  const re = /^[ \t]*--[ \t]*@probe-for:[ \t]*([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)[ \t]*$/gim;
  let m;
  while ((m = re.exec(sql))) {
    const rest = sql.slice(m.index + m[0].length);
    const doAt = rest.search(/^\s*do\s+\$/i);
    if (doAt !== 0 && rest.slice(0, Math.max(doAt, 0)).trim() !== '') {
      out.push({ target: m[1].toLowerCase(), at: m.index, body: null });
      continue;
    }
    const doIdx = m.index + m[0].length + rest.search(/do\s+\$/i);
    const b = dollarBodyEnd(sql, doIdx);
    out.push({ target: m[1].toLowerCase(), at: m.index, body: b ? sql.slice(b.bodyStart, b.bodyEnd) : null });
  }
  return out;
}

function exemptions(sql) {
  const out = new Map();
  const re = /^[ \t]*--[ \t]*@probe-exempt:[ \t]*([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)[ \t]+(.*)$/gim;
  let m;
  while ((m = re.exec(sql))) out.set(m[1].toLowerCase(), m[2].trim());
  return out;
}

/**
 * Functions the migration redefines without a valid probe (or exemption).
 * Each entry: { fn, reason }.
 */
export function missingProbes(sql) {
  const needs = functionsNeedingProbe(sql);
  const probes = probeBlocks(sql);
  const exempt = exemptions(sql);
  const problems = [];
  for (const f of needs) {
    if (exempt.has(f.qualified)) {
      if (exempt.get(f.qualified).length < MIN_EXEMPT_REASON) {
        problems.push({ fn: f.qualified, reason: `@probe-exempt reason shorter than ${MIN_EXEMPT_REASON} characters` });
      }
      continue;
    }
    const mine = probes.filter((p) => p.target === f.qualified);
    if (mine.length === 0) {
      problems.push({ fn: f.qualified, reason: 'no "-- @probe-for:" DO block executes it before COMMIT' });
      continue;
    }
    const call = new RegExp(`\\b${f.schema}\\.${f.name}\\s*\\(`, 'i');
    const valid = mine.find((p) => {
      if (p.at <= f.endsAt || !p.body) return false;
      const code = stripSqlComments(p.body);
      return call.test(code) && code.includes(`'${PROBE_SENTINEL}'`);
    });
    if (!valid) {
      problems.push({
        fn: f.qualified,
        reason: `its probe must follow the definition, call ${f.qualified}(...) and unwind with '${PROBE_SENTINEL}'`,
      });
    }
  }
  return problems;
}

/** True when the law binds this migration file name: every file not grandfathered. */
export function bound(file) {
  return /^\d{14}_.*\.sql$/.test(file) && !GRANDFATHERED.has(file);
}
