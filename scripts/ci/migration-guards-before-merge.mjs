/**
 * A MIGRATION PASSES PRODUCTION'S DDL GUARDS BEFORE IT MERGES
 * (2026-11-18, incident 075013fd).
 *
 * Two merged pull requests passed every check and were refused at install by
 * guards that run only on production:
 *   #11256 20261118034950  55000 migration_left_a_stale_pin. The applier's
 *          in-transaction guard (migration-stale-pins.mjs): the installed
 *          smarter_private.original_erased_cash_base_discharge(bigint,text)
 *          pins b7911a24..., the fn_ca_tally_balance_move body the file
 *          rewrites. Revert #11260, re-land #11270.
 *   #11266 20261118071728  42501 from event trigger ab_ca_money_rpc_registered
 *          (fn_ca_money_rpc_registry_guard): fn_ca_bank_pending_hand_obligations
 *          writes balance columns and is not in ca_money_rpc_registry. #11288.
 * The window rehearsal restores production's schema with pg_dump -n, which
 * carries neither the event triggers (database-level objects) nor the rows
 * they read, and never ran the applier's guard: both refusals were invisible
 * before merge.
 *
 * For every migration a pull request adds or changes that production has not
 * installed and that is not superseded:
 *
 *   EXACT. A throwaway copy restored from production's schema-only archive
 *   gets production's guard rows back (ca_money_rpc_registry,
 *   function_body_lineage; COPY captured read-only), then production's own
 *   event triggers re-created from pg_event_trigger, then production's
 *   uninstalled ordinary migrations, then each file wrapped by the applier's
 *   OWN stalePinGuardSQL. Production's guard functions run their own logic on
 *   the copy; nothing is re-implemented. A refusal is a guard's when it is the
 *   stale-pin exception or psql's CONTEXT names an armed guard function (or
 *   the commit-time resolution trigger the queueing guard feeds).
 *
 *   STATIC, when the file cannot install on the copy (a row-dependent
 *   assertion on an empty schema, a dependency on another unmerged branch):
 *   - stale pins: the functions it changes (CREATE/ALTER/DROP, pg_temp.*
 *     substitution helpers, preimage and current-md5 literals at statement
 *     level) against production's captured md5s (both guard forms) and every
 *     hex run in every installed source; -- @stale-pin-ok read by the
 *     applier's own allowedStalePins; a pinner the file also changes counts
 *     as moved.
 *   - money-RPC registry: every function body the file creates is put to
 *     production's own classifier public.fn_ca_money_rpc_writes_balances on
 *     the copy, and the name must be in production's registry or registered
 *     by the file ABOVE its CREATE.
 *   - superseded bodies: smarter_private.fn_ca_body_fingerprint of each body
 *     against production's superseded lineage rows, unless the file sets
 *     ca.allow_function_rollback for it.
 *
 * NOT COVERED, and why: the break-window guard (refuses by wall clock and
 * session role, not by content; the applier and installer schedule around
 * it); the applier's admission and timing checks (live locks, the :50 UTC
 * cutoff, the daily window, wallet-cutover preflight: live state, not file
 * content); the offline install budget's held-lock re-check and the
 * accounting admission of named files (production row state). Static file
 * shape and cost checks already run at merge (aMergedMigrationIsInstallable,
 * aMigrationFitsTheInstallBudget). The static half cannot see a body
 * EXECUTEd from a string or a signature built at run time, and ignores the
 * registry's ordering inside DO blocks. Production can move between this
 * check and the install; the guards themselves stay the last word.
 */
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { allowedStalePins, isPinChecked, stalePinGuardSQL } from './migration-stale-pins.mjs';
import { migrationTransactionShape } from './migration-transaction-shape.mjs';
import { declaresMaintenanceWindow } from './maintenance-window-migrations.mjs';
import { supersededBy } from './check-migrations-are-live.mjs';
import {
  evidenceFromEnv,
  planRehearsal,
  readTree,
  rehearsalSQL,
  MIGRATION_FILE,
} from './window-queue-rehearsal.mjs';
import {
  CATALOG_SQL_CATALOG_PATH,
  CATALOG_SQL_PUBLIC_PATH,
  GUARD_TABLES,
  copyFile,
} from './migration-guards-capture.mjs';

const MD5 = /^[0-9a-f]{32}$/;

// ── SQL scanning ────────────────────────────────────────────────────────────

/**
 * Statement-level text of a migration: comments removed, and the body of
 * every dollar-quoted string replaced by an empty one EXCEPT a DO block's,
 * which is scanned the same way (a DO block is statements the file runs; a
 * CREATE FUNCTION body is code it installs, whose md5 literals are pins, not
 * preimages). Single-quoted literals are kept.
 */
export function statementText(sql, bodies = null, base = 0) {
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
      const e = s.indexOf('*/', i + 2);
      i = e < 0 ? s.length : e + 2;
      out += ' ';
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      for (;;) {
        const k = s.indexOf("'", j);
        if (k < 0) {
          j = s.length;
          break;
        }
        if (s[k + 1] === "'") {
          j = k + 2;
          continue;
        }
        j = k + 1;
        break;
      }
      out += s.slice(i, j);
      i = j;
      continue;
    }
    if (c === '$' && !/[A-Za-z0-9_$]/.test(s[i - 1] ?? ' ')) {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(s.slice(i, i + 80));
      if (m) {
        const tag = m[0];
        const close = s.indexOf(tag, i + tag.length);
        const body = s.slice(i + tag.length, close < 0 ? s.length : close);
        const statement = out.slice(stmtStart).trim();
        if (/^DO\b/i.test(statement))
          out += ` ${statementText(body, bodies, base + out.length + 1)} `;
        else {
          if (bodies) bodies.push({ statement, body, at: base + out.length });
          out += '$$';
        }
        i = close < 0 ? s.length : close + tag.length;
        continue;
      }
    }
    if (c === ';') stmtStart = out.length + 1;
    out += c;
    i++;
  }
  return out;
}

function balanced(text, open) {
  // text[open] === '('; returns [inner, indexAfterClose]
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "'") {
      const k = text.indexOf("'", i + 1);
      i = k < 0 ? text.length : k;
      continue;
    }
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return [text.slice(open + 1, i), i + 1];
  }
  return [text.slice(open + 1), text.length];
}

function splitTop(list) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of list) {
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

const TYPE_ALIASES = {
  int: 'integer',
  int4: 'integer',
  int8: 'bigint',
  int2: 'smallint',
  bool: 'boolean',
  float8: 'double precision',
  float4: 'real',
  float: 'double precision',
  varchar: 'character varying',
  char: 'character',
  bpchar: 'character',
  decimal: 'numeric',
  timestamptz: 'timestamp with time zone',
  timestamp: 'timestamp without time zone',
  timetz: 'time with time zone',
  time: 'time without time zone',
};
const MULTIWORD_START = /^(timestamp|time|character|double|bit|interval|national)\b/;
const unquote = (x) => x.replace(/"/g, '');

/** A type as format_type prints it, without schema qualification. */
export function normalizeType(raw) {
  let t = unquote(String(raw).trim().toLowerCase()).replace(/\s+/g, ' ');
  let arr = '';
  const am = /((?:\s*\[\s*\d*\s*\])+)$/.exec(t);
  if (am) {
    arr = '[]'.repeat((am[1].match(/\[/g) || []).length);
    t = t.slice(0, am.index).trim();
  }
  t = t.replace(/\s*\([^)]*\)/g, '').trim(); // typmods
  t = t.replace(/^[a-z_][a-z0-9_]*\.(?=[a-z_])/, ''); // schema
  if (t === 'timestamp with time zone' || t === 'time with time zone') return t + arr;
  if (t === 'timestamp without time zone' || t === 'time without time zone') return t + arr;
  if (t === 'character varying' || t === 'double precision') return t + arr;
  return (TYPE_ALIASES[t] ?? t) + arr;
}

/** Identity argument types of one argument list (names, modes, defaults stripped; OUT dropped). */
export function identityArgs(list) {
  const types = [];
  for (let a of splitTop(list)) {
    a = a.replace(/\s+(DEFAULT\b|=)[\s\S]*$/i, '').trim();
    let words = a.split(/\s+/);
    const mode = words[0].toUpperCase();
    if (mode === 'OUT') continue;
    if (['IN', 'INOUT', 'VARIADIC'].includes(mode)) words = words.slice(1);
    if (words.length > 1 && !MULTIWORD_START.test(words[0].toLowerCase())) words = words.slice(1);
    types.push(normalizeType(words.join(' ')));
  }
  return types;
}

function qualify(name) {
  const n = unquote(name.trim().toLowerCase());
  return n.includes('.') ? n : `public.${n}`;
}

/** The comparison key of a function: schema.name(type,type). */
export function signatureKey(name, argList) {
  return `${qualify(name)}(${identityArgs(argList ?? '').join(',')})`;
}

/** Key of a printed regprocedure such as public.f(text,timestamp with time zone). */
export function regprocedureKey(text) {
  const t = String(text).trim();
  const open = t.indexOf('(');
  if (open < 0) return null;
  return signatureKey(t.slice(0, open), t.slice(open + 1, t.lastIndexOf(')')));
}

const NAME = String.raw`((?:"?[A-Za-z_][A-Za-z0-9_$]*"?\.)?"?[A-Za-z_][A-Za-z0-9_$]*"?)`;

/**
 * What a migration changes, read from its statement-level text.
 * @returns {{ definite: {key: string, name: string, how: string}[],
 *             preimages: {key: string|null, md5: string, how: string}[],
 *             md5Literals: string[], maybe: {key: string, how: string}[] }}
 */
export function scanMigration(sql) {
  const text = statementText(sql);
  const definite = [];
  const preimages = [];
  const maybe = [];
  const add = (name, args, how, list = definite) => {
    const q = qualify(name);
    if (q.startsWith('pg_temp.')) return;
    list.push({ key: args == null ? `${q}(*)` : signatureKey(name, args), name: q, how });
  };

  for (const m of text.matchAll(
    new RegExp(String.raw`\bCREATE\s+(?:OR\s+REPLACE\s+)?(FUNCTION|PROCEDURE)\s+${NAME}\s*\(`, 'gi')
  )) {
    const [args] = balanced(text, m.index + m[0].length - 1);
    add(m[2], args, m[0].match(/OR\s+REPLACE/i) ? 'CREATE OR REPLACE' : 'CREATE');
  }
  for (const m of text.matchAll(
    new RegExp(String.raw`\bALTER\s+(?:FUNCTION|PROCEDURE|ROUTINE)\s+${NAME}\s*(\()?`, 'gi')
  )) {
    let args = null;
    let after = m.index + m[0].length;
    if (m[2]) [args, after] = balanced(text, after - 1);
    if (/^\s*OWNER\s+TO\b/i.test(text.slice(after))) continue;
    add(m[1], args, 'ALTER');
  }
  for (const m of text.matchAll(
    /\bDROP\s+(?:FUNCTION|PROCEDURE|ROUTINE)\s+(?:IF\s+EXISTS\s+)?/gi
  )) {
    let i = m.index + m[0].length;
    for (;;) {
      const nm = new RegExp(String.raw`^\s*${NAME}\s*(\()?`).exec(text.slice(i));
      if (!nm) break;
      i += nm[0].length;
      let args = null;
      if (nm[2]) [args, i] = balanced(text, i - 1);
      add(nm[1], args, 'DROP');
      const comma = /^\s*,/.exec(text.slice(i));
      if (!comma) break;
      i += comma[0].length;
    }
  }
  // A substitution helper: pg_temp.<x>('schema.fn(args)'[::regprocedure], '<md5>', ...)
  for (const m of text.matchAll(
    /\bpg_temp\.([a-z0-9_]+)\s*\(\s*'([^']+)'(?:\s*::\s*regprocedure)?\s*(?:,\s*'([0-9a-f]{32})')?/gi
  )) {
    const lit = m[2].trim();
    const sm = /^([A-Za-z0-9_."]+)\s*\(([\s\S]*)\)$/.exec(lit);
    if (!sm) continue;
    add(sm[1], sm[2], `pg_temp.${m[1]}`);
    if (m[3])
      preimages.push({
        key: signatureKey(sm[1], sm[2]),
        md5: m[3],
        how: `pg_temp.${m[1]} preimage`,
      });
  }
  // Read through pg_get_functiondef with an EXECUTE in the file: possibly rewritten.
  if (/\bEXECUTE\b/i.test(text))
    for (const m of text.matchAll(/pg_get_functiondef\s*\(\s*'([^']+)'\s*::\s*regprocedure/gi)) {
      const sm = /^([A-Za-z0-9_."]+)\s*\(([\s\S]*)\)$/.exec(m[1].trim());
      if (sm) add(sm[1], sm[2], 'pg_get_functiondef + EXECUTE', maybe);
    }
  const md5Literals = [...new Set([...text.matchAll(/'([0-9a-f]{32})'/g)].map((x) => x[1]))];
  return { definite, preimages, md5Literals, maybe };
}

// ── production's catalog ────────────────────────────────────────────────────

const rows = (tsv) =>
  String(tsv)
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => l.split('\t'));

/**
 * @param {string} catalogTsv  oid, regprocedure, md5 (search_path pg_catalog)
 * @param {string} publicTsv   oid, md5 (search_path public)
 * @param {string} pinsTsv     pinner regprocedure, hex run
 */
export function loadCatalog(catalogTsv, publicTsv, pinsTsv, pinsPublicTsv = '') {
  const pub = new Map(rows(publicTsv).map(([oid, md5]) => [oid, md5]));
  const byKey = new Map();
  const byName = new Map();
  const byMd5 = new Map();
  const functions = [];
  for (const [oid, signature, catalogMd5] of rows(catalogTsv)) {
    if (!MD5.test(catalogMd5 ?? '')) throw new Error(`malformed catalog row for ${signature}`);
    const fn = {
      oid,
      signature,
      key: regprocedureKey(signature),
      catalogMd5,
      publicMd5: pub.get(oid) ?? null,
    };
    functions.push(fn);
    const push = (m, k) => (m.get(k) ?? m.set(k, []).get(k)).push(fn);
    push(byKey, fn.key);
    push(byName, fn.key.slice(0, fn.key.indexOf('(')));
    push(byMd5, catalogMd5);
    if (fn.publicMd5) push(byMd5, fn.publicMd5);
  }
  const signatureOf = new Map(functions.map((f) => [f.oid, f.signature]));
  // The public-path pins name their pinner by oid (see migration-guards-capture.mjs).
  const pins = [
    ...rows(pinsTsv).map(([pinner, run]) => ({ pinner, run })),
    ...rows(pinsPublicTsv).map(([pinner, run]) => ({
      pinner: signatureOf.get(String(pinner).replace(/^oid:/, '')) ?? pinner,
      run,
    })),
  ];
  return {
    functions,
    byKey,
    byName,
    byMd5,
    pins,
    pinnersOf: (md5) => [...new Set(pins.filter((p) => p.run.includes(md5)).map((p) => p.pinner))],
  };
}

/**
 * The static verdict for one migration against production's catalog.
 * @returns {{ changed: object[], findings: object[], stale: object[], notes: string[] }}
 */
export function staticPinFindings(sql, catalog) {
  const scan = scanMigration(sql);
  const allowed = allowedStalePins(sql);
  const notes = [];
  const changed = new Map(); // signature -> {fn, how}
  const candidates = []; // {signature, md5, how}
  const addChanged = (fn, how) => {
    if (!changed.has(fn.signature)) changed.set(fn.signature, { fn, how: new Set() });
    changed.get(fn.signature).how.add(how);
  };
  for (const d of scan.definite) {
    if (d.key.endsWith('(*)')) {
      for (const fn of catalog.byName.get(d.name) ?? [])
        addChanged(fn, `${d.how} (every overload)`);
      continue;
    }
    const exact = catalog.byKey.get(d.key);
    if (exact) for (const fn of exact) addChanged(fn, d.how);
    else if (catalog.byName.has(d.name) && d.how !== 'CREATE')
      notes.push(
        `${d.how} ${d.key}: no installed function has exactly these argument types (installed overloads: ${catalog.byName
          .get(d.name)
          .map((f) => f.signature)
          .join(', ')}); a new overload changes no installed body`
      );
  }
  for (const md5 of scan.md5Literals)
    for (const fn of catalog.byMd5.get(md5) ?? []) addChanged(fn, `names its current md5 ${md5}`);
  for (const m of scan.maybe)
    for (const fn of catalog.byKey.get(m.key) ?? [])
      if (!changed.has(fn.signature))
        notes.push(
          `${fn.signature} is read through pg_get_functiondef and the file EXECUTEs: it may be rewritten; only the exact install can tell`
        );
  for (const { fn, how } of changed.values())
    for (const md5 of new Set([fn.catalogMd5, fn.publicMd5].filter(Boolean)))
      candidates.push({ signature: fn.signature, md5, how: [...how].join('; ') });
  for (const p of scan.preimages) {
    const fns = catalog.byKey.get(p.key) ?? [];
    const sig = fns[0]?.signature ?? p.key;
    if (!candidates.some((c) => c.md5 === p.md5))
      candidates.push({ signature: sig, md5: p.md5, how: p.how });
  }
  const changedSigs = new Set(changed.keys());
  const findings = [];
  for (const c of candidates)
    for (const pinner of catalog.pinnersOf(c.md5)) {
      const verdict = changedSigs.has(pinner)
        ? 'moved'
        : allowed.includes(c.md5)
          ? 'allowed'
          : 'stale';
      findings.push({ ...c, pinner, verdict });
    }
  return {
    changed: [...changed.values()].map(({ fn, how }) => ({
      signature: fn.signature,
      how: [...how],
    })),
    findings,
    stale: findings.filter((f) => f.verdict === 'stale'),
    notes,
  };
}

// ── production's other DDL guards, read statically ─────────────────────────

/**
 * The functions a file creates, with the exact text that becomes prosrc (the
 * dollar-quoted body after AS), in statement order. A body EXECUTEd from a
 * string is not seen (a substitution helper's rewrite); the exact half is.
 */
export function functionBodies(sql) {
  const bodies = [];
  statementText(sql, bodies);
  const out = [];
  for (const b of bodies) {
    const m = new RegExp(
      String.raw`^CREATE\s+(?:OR\s+REPLACE\s+)?(FUNCTION|PROCEDURE)\s+${NAME}\s*\(`,
      'i'
    ).exec(b.statement);
    if (!m || !/\bAS\s*$/i.test(b.statement)) continue;
    const [args] = balanced(b.statement, m[0].length - 1);
    const name = qualify(m[2]);
    if (name.startsWith('pg_temp.')) continue;
    out.push({
      kind: m[1].toUpperCase(),
      name,
      key: signatureKey(m[2], args),
      body: b.body,
      at: b.at,
    });
  }
  return out;
}

/** Function names a file registers in public.ca_money_rpc_registry, with where. */
export function registryInserts(sql) {
  const text = statementText(sql);
  const found = [];
  for (const m of text.matchAll(
    /\bINSERT\s+INTO\s+(?:public\.)?ca_money_rpc_registry\b[^;]*?\bVALUES\b([\s\S]*?)(?:\bON\s+CONFLICT\b|;)/gi
  ))
    for (const t of m[1].matchAll(/\(\s*'([^']+)'/g)) found.push({ proname: t[1], at: m.index });
  return found;
}

/** Keys a file lets set back to a superseded body (ca.allow_function_rollback). */
export function rollbackAllowance(sql) {
  const text = statementText(sql);
  const keys = [];
  for (const m of text.matchAll(/ca\.allow_function_rollback'?\s*(?:=|TO|,)\s*'([^']*)'/gi))
    keys.push(...m[1].replace(/\s/g, '').split(',').filter(Boolean));
  return keys;
}

const dollar = (text) => {
  let tag = 'ca_guard_body';
  while (text.includes(`$${tag}$`)) tag += '_x';
  return `$${tag}$${text}$${tag}$`;
};

/**
 * One read-only query, sent to the copy that holds production's guard
 * functions and the rows they read, asking production's OWN classifiers about
 * every function body the file creates:
 *   money     public.fn_ca_money_rpc_writes_balances(body) (the classifier
 *             fn_ca_money_rpc_registry_guard calls), and whether
 *             ca_money_rpc_registry already holds the name;
 *   superseded the body's smarter_private.fn_ca_body_fingerprint is a
 *             superseded row of smarter_private.function_body_lineage (what
 *             fn_ca_function_lineage_on_create refuses).
 * A classifier the copy lacks answers NULL (reported as not checked).
 */
export function staticGuardSQL(fns) {
  if (!fns.length) return null;
  const rowsSql = fns
    .map(
      (f, i) =>
        `(${i}, ${dollar(f.body)}::text, '${f.name.replaceAll("'", "''")}'::text, '${f.name.split('.')[1].replaceAll("'", "''")}'::text)`
    )
    .join(',\n');
  return `
CREATE TEMP TABLE ca_guard_bodies(i int, body text, fn_key text, proname text);
INSERT INTO pg_temp.ca_guard_bodies VALUES
${rowsSql};
CREATE OR REPLACE FUNCTION pg_temp.ca_guard_answer() RETURNS SETOF text LANGUAGE plpgsql AS $ca_guard_fn$
DECLARE r record; v_money boolean; v_reg boolean; v_sup boolean;
BEGIN
  FOR r IN SELECT * FROM pg_temp.ca_guard_bodies ORDER BY i LOOP
    v_money := NULL; v_reg := NULL; v_sup := NULL;
    IF to_regprocedure('public.fn_ca_money_rpc_writes_balances(text)') IS NOT NULL THEN
      EXECUTE 'SELECT public.fn_ca_money_rpc_writes_balances($1)' INTO v_money USING r.body;
    END IF;
    IF to_regclass('public.ca_money_rpc_registry') IS NOT NULL THEN
      EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.ca_money_rpc_registry WHERE proname = $1)' INTO v_reg USING r.proname;
    END IF;
    IF to_regclass('smarter_private.function_body_lineage') IS NOT NULL
       AND to_regprocedure('smarter_private.fn_ca_body_fingerprint(text)') IS NOT NULL THEN
      EXECUTE 'SELECT EXISTS (SELECT 1 FROM smarter_private.function_body_lineage
                               WHERE fn_key = $1 AND state = ''superseded''
                                 AND body_fp = smarter_private.fn_ca_body_fingerprint($2))'
        INTO v_sup USING r.fn_key, r.body;
    END IF;
    RETURN NEXT r.i || E'\\t' || COALESCE(v_money::text, '') || E'\\t' || COALESCE(v_reg::text, '') || E'\\t' || COALESCE(v_sup::text, '');
  END LOOP;
END $ca_guard_fn$;
SELECT * FROM pg_temp.ca_guard_answer();`;
}

/**
 * The static verdict of production's money-RPC registry guard and body-lineage
 * guard, from the classifiers' answers (staticGuardSQL output).
 */
export function staticGuardFindings(sql, fns, answerTsv) {
  const answers = new Map(
    rows(answerTsv).map(([i, money, reg, sup]) => [Number(i), { money, reg, sup }])
  );
  const inserts = registryInserts(sql);
  const allowRollback = rollbackAllowance(sql);
  const findings = [];
  const notes = [];
  fns.forEach((f, i) => {
    const a = answers.get(i);
    if (!a) return notes.push(`${f.key}: no classifier answer`);
    if (f.name.startsWith('public.') && f.kind === 'FUNCTION') {
      if (a.money === '')
        notes.push(`${f.key}: the money-RPC classifier is not on the copy; not checked`);
      else if (a.money === 'true') {
        const proname = f.name.split('.')[1];
        const before = inserts.some((x) => x.proname === proname && x.at < f.at);
        if (a.reg !== 'true' && !before)
          findings.push({
            guard: 'fn_ca_money_rpc_registry_guard (event trigger ab_ca_money_rpc_registered)',
            fn: f.key,
            reason: `${proname} writes balance columns and is not in ca_money_rpc_registry${inserts.some((x) => x.proname === proname) ? ' (the file registers it only AFTER its CREATE FUNCTION)' : ''}`,
          });
      }
    }
    if (a.sup === 'true' && !allowRollback.includes(f.name))
      findings.push({
        guard:
          'smarter_private.fn_ca_function_lineage_on_create (event trigger ca_superseded_function_body_is_refused)',
        fn: f.key,
        reason: `${f.name} is being set back to a body production recorded as superseded`,
      });
  });
  return { findings, notes };
}

// ── the exact half ──────────────────────────────────────────────────────────

/**
 * Event triggers that are NOT re-created on the copy, and why. Every other
 * enabled production event trigger whose function lives in public or
 * smarter_private is.
 */
export const NOT_REHEARSED = {
  ca_break_window_refuses_ddl:
    'refuses by wall clock (:50-:03 UTC) and session role, not by what the file does; the applier and installer schedule around it, and on the copy it would turn a pull request red by the time of day',
  ca_break_window_refuses_drops: 'the same wall-clock guard on sql_drop',
  ca_live_tables_refuse_manual_ddl:
    'refuses live-table DDL from any session that is not the claimed migration applier; the rehearsal sends files as plain psql, so on the copy it would refuse every window file for who sent it, not for what it does (native proof: scripts/ci/test-manual-ddl-guard-postgres.py)',
  ca_live_tables_refuse_manual_ddl_held: 'the same session guard on ddl_command_end',
};
const REHEARSED_SCHEMAS = new Set(['public', 'smarter_private']);

/**
 * SQL for the copy: loadSql (as a superuser) puts back the rows production's
 * guards read; triggerSql (as postgres, their owner on production)
 * re-creates production's event triggers.
 * @param {string} eventTriggersTsv  name, event, function, schema, tags (|-joined)
 * @param {Record<string, string>} copies  table -> COPY text
 */
export function armSQL(eventTriggersTsv, copies) {
  const armed = [];
  const skipped = [];
  let loadSql = 'SET session_replication_role = replica;\n';
  for (const [table, data] of Object.entries(copies)) {
    if (!/^[a-z_]+\.[a-z_]+$/.test(table)) throw new Error(`bad table ${table}`);
    loadSql += `TRUNCATE ${table};\nCOPY ${table} FROM STDIN;\n${data.endsWith('\n') || !data ? data : data + '\n'}\\.\n`;
  }
  loadSql += 'SET session_replication_role = origin;\n';
  let triggerSql = '';
  for (const [name, event, fn, schema, tags] of rows(eventTriggersTsv)) {
    if (
      !/^[a-z_][a-z0-9_]*$/.test(name) ||
      !/^(ddl_command_start|ddl_command_end|sql_drop|table_rewrite)$/.test(event) ||
      !/^[a-z_]+\.[a-z0-9_]+\(\)$/.test(fn)
    )
      throw new Error(`malformed event trigger row ${name}`);
    if (NOT_REHEARSED[name]) {
      skipped.push({ name, fn, why: NOT_REHEARSED[name] });
      continue;
    }
    if (!REHEARSED_SCHEMAS.has(schema)) {
      skipped.push({
        name,
        fn,
        why: 'Supabase platform trigger (extensions schema); none refuses a migration, and the supabase/postgres image carries its own',
      });
      continue;
    }
    const tagList = (tags ?? '').split('|').filter(Boolean);
    if (tagList.some((t) => !/^[A-Z ]+$/.test(t))) throw new Error(`malformed tags on ${name}`);
    const when = tagList.length ? ` WHEN TAG IN (${tagList.map((t) => `'${t}'`).join(', ')})` : '';
    triggerSql += `DROP EVENT TRIGGER IF EXISTS ${name};\nCREATE EVENT TRIGGER ${name} ON ${event}${when} EXECUTE FUNCTION ${fn.replace('()', '')}();\n`;
    armed.push({ name, fn });
  }
  return { loadSql, triggerSql, armed, skipped };
}

/** A table trigger fed by an event trigger that refuses at COMMIT. */
/**
 * The guards that REFUSE, read from production's sources on 2026-11-18. Every
 * other armed event trigger only logs, rewrites or records (ca_log_ddl_event,
 * ca_log_ddl_drop, fn_rls_on_new_public_table, fn_new_view_respects_the_caller,
 * fn_strip_client_writes_from_new_views, fn_autorevoke_privileged_anon,
 * fn_ca_queue_function_for_resolution, fn_ca_function_lineage_on_drop), and
 * an error raised from one of those is not a guard's verdict on the file.
 * fn_ca_function_calls_must_resolve is the commit-time trigger that
 * fn_ca_queue_function_for_resolution feeds (42883).
 */
export const REFUSING_GUARDS = [
  'fn_ca_money_rpc_registry_guard',
  'fn_ca_function_lineage_on_create',
  'fn_reject_retired_solver_option_rpc_ddl',
  'xp_ban_guard_fn',
  'fn_ca_release_freeze_refuses_mgmt_api_ddl',
  'fn_ca_function_calls_must_resolve',
];
export const COMMIT_TIME_GUARDS = ['fn_ca_function_calls_must_resolve'];

/**
 * Minimal, idempotent production-like control rows seeded on the restored
 * schema copy before rehearsing changed migrations (2026-11-20, Wave 2
 * hardening).
 *
 * Migrations 20261119175941 and 20261119181500 passed an empty schema copy yet
 * failed their first live production install because production has active
 * control rows (ca_promo_play_through_settings.enforced_from IS NOT NULL;
 * profiles rows for Daily Missions lock checks in $probe$ blocks). Seeding
 * these minimal control rows idempotently (only when the target table exists)
 * forces $probe$ blocks to exercise real production enforcement branches
 * before merge.
 */
export const PRODUCTION_CONTROL_FIXTURES = [
  'public.ca_promo_play_through_settings',
  'public.ca_mtt_admission_contract',
  'public.profiles',
];

export const REHEARSAL_PROBE_USER_ID = '00000000-0000-4000-8000-000000000001';

export function seedProductionFixturesSQL() {
  return `
SET session_replication_role = replica;
DO $seed_rehearsal_controls$
DECLARE
  v_uid constant uuid := '${REHEARSAL_PROBE_USER_ID}'::uuid;
  v_seeded text[] := ARRAY[]::text[];
  v_has_profile boolean := false;
BEGIN
  IF to_regclass('public.ca_promo_play_through_settings') IS NOT NULL THEN
    EXECUTE $s$
      INSERT INTO public.ca_promo_play_through_settings (id, multiplier, expiry_days, enforced_from, updated_at)
      VALUES (true, 4, 30, '2026-11-16 00:00:00+00'::timestamptz, '2026-11-16 00:00:00+00'::timestamptz)
      ON CONFLICT (id) DO UPDATE
        SET enforced_from = COALESCE(public.ca_promo_play_through_settings.enforced_from, EXCLUDED.enforced_from),
            updated_at = COALESCE(public.ca_promo_play_through_settings.updated_at, EXCLUDED.updated_at)
    $s$;
    v_seeded := array_append(v_seeded, 'public.ca_promo_play_through_settings');
  END IF;

  IF to_regclass('public.ca_mtt_admission_contract') IS NOT NULL THEN
    EXECUTE $s$
      INSERT INTO public.ca_mtt_admission_contract (singleton, abi)
      VALUES (true, 'unlimited-mtt-v2')
      ON CONFLICT (singleton) DO NOTHING
    $s$;
    v_seeded := array_append(v_seeded, 'public.ca_mtt_admission_contract');
  END IF;

  IF to_regclass('public.profiles') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.profiles LIMIT 1)' INTO v_has_profile;
    IF NOT v_has_profile THEN
      IF to_regclass('auth.users') IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM pg_attribute
            WHERE attrelid = to_regclass('auth.users') AND attname = 'id' AND NOT attisdropped
         ) THEN
        BEGIN
          EXECUTE 'INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT DO NOTHING' USING v_uid;
        EXCEPTION WHEN others THEN
          NULL;
        END;
      END IF;
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_attribute
           WHERE attrelid = to_regclass('public.profiles') AND attname = 'username' AND NOT attisdropped
        ) AND EXISTS (
          SELECT 1 FROM pg_attribute
           WHERE attrelid = to_regclass('public.profiles') AND attname = 'display_name' AND NOT attisdropped
        ) THEN
          EXECUTE 'INSERT INTO public.profiles (id, username, display_name) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING'
            USING v_uid, 'rehearsal_probe_user', 'Rehearsal Probe User';
        ELSE
          EXECUTE 'INSERT INTO public.profiles (id) VALUES ($1) ON CONFLICT (id) DO NOTHING'
            USING v_uid;
        END IF;
        v_seeded := array_append(v_seeded, 'public.profiles');
      EXCEPTION WHEN others THEN
        RAISE NOTICE 'rehearsal fixture seed skipped public.profiles: %', SQLERRM;
      END;
    END IF;
  END IF;

  RAISE NOTICE 'CA_REHEARSAL_SEEDED=%', array_to_string(v_seeded, ',');
END
$seed_rehearsal_controls$;
SET session_replication_role = origin;
`.trim();
}

/**
 * Bracket each `-- @probe-for: <target>` DO block with enter/exit NOTICE
 * markers so classifyExact can tell a failing $probe$ block apart from an
 * unrelated row-dependent preimage failure on an empty schema copy.
 */
export function instrumentProbesSQL(sql) {
  const s = String(sql);
  const re = /^[ \t]*--[ \t]*@probe-for:[ \t]*([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)[ \t]*$/gim;
  let out = '';
  let cursor = 0;
  let m;
  while ((m = re.exec(s))) {
    const target = m[1].toLowerCase();
    const afterMarker = m.index + m[0].length;
    const rest = s.slice(afterMarker);
    const doMatch = /^\s*DO\s+(\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$)/i.exec(rest);
    if (!doMatch) continue;
    const tag = doMatch[1];
    const bodyStart = afterMarker + doMatch[0].length;
    const closeIdx = s.indexOf(tag, bodyStart);
    if (closeIdx < 0) continue;
    const afterClose = s.slice(closeIdx + tag.length);
    const semiMatch = /^\s*;/.exec(afterClose);
    if (!semiMatch) continue;
    const blockEnd = closeIdx + tag.length + semiMatch[0].length;
    out += s.slice(cursor, m.index);
    out += `DO $ca_probe_mark$ BEGIN RAISE NOTICE 'CA_REHEARSAL_PROBE_ENTER:${target}'; END $ca_probe_mark$;\n`;
    out += s.slice(m.index, blockEnd);
    out += `\nDO $ca_probe_mark$ BEGIN RAISE NOTICE 'CA_REHEARSAL_PROBE_EXIT:${target}'; END $ca_probe_mark$;`;
    cursor = blockEnd;
    re.lastIndex = blockEnd;
  }
  return cursor === 0 ? s : out + s.slice(cursor);
}

/**
 * The SQL the exact half sends for one file: its CONCURRENTLY preamble (as the
 * applier sends it, statement by statement), then its transaction wrapped by
 * the applier's own stale-pin guard. A window file carries the installer's
 * prelude too.
 */
export function pinRehearsalSQL(file, sql) {
  const shape = migrationTransactionShape(file, sql);
  if (!shape.ok) throw new Error(shape.reason);
  let body = shape.body;
  if (declaresMaintenanceWindow(sql)) body = rehearsalSQL(file, body);
  const guarded = stalePinGuardSQL(file, sql, body);
  return (
    shape.indexes.map((i) => i.statement).join('\n') + (shape.indexes.length ? '\n' : '') + guarded
  );
}

/**
 * One exact outcome from psql's exit status and output. A refusal is a guard's
 * only when it is the applier's stale-pin exception, or the error's own
 * CONTEXT (its first line: the function that raised) is a RAISE in a refusing
 * guard (REFUSING_GUARDS) that is armed on the copy or fed by an armed one.
 * A failure inside an instrumented `-- @probe-for:` block (entered without a
 * matching exit) is reported as `probe-failed` so broken probes on seeded
 * production-like control rows fail before merge instead of falling back to
 * static. Anything else, including an error inside a logging trigger, is
 * not-installable: the static half decides, and the summary says why.
 */
export function classifyExact(status, output, guardFunctions = []) {
  if (status === 0) return { outcome: 'installed' };
  const err = (
    /ERROR:\s*([^\n]*)/.exec(output)?.[1] ??
    output.trim().split('\n').pop() ??
    ''
  ).slice(0, 400);
  const m = /migration_left_a_stale_pin:\s*([^\n]*)/.exec(output);
  if (m)
    return {
      outcome: 'guard-refused',
      guard: 'applier stale-pin guard (migration-stale-pins.mjs)',
      detail: m[1].trim(),
    };
  const pm = /migration_preimage_mismatch:\s*([^\n]*)/.exec(output);
  if (pm)
    return {
      outcome: 'guard-refused',
      guard: 'applier preimage-md5 guard (migration-stale-pins.mjs)',
      detail: pm[1].trim(),
    };
  const armed = new Set([
    ...guardFunctions.map((f) => f.replace(/^.*\./, '').replace(/\(.*$/, '')),
    ...COMMIT_TIME_GUARDS,
  ]);
  const raised =
    /CONTEXT:\s+PL\/pgSQL function (?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)\([^)]*\) line \d+ at RAISE/.exec(
      output
    );
  if (raised && armed.has(raised[1]) && REFUSING_GUARDS.includes(raised[1]))
    return { outcome: 'guard-refused', guard: raised[1], detail: err };
  const probeMarks = [
    ...String(output).matchAll(/CA_REHEARSAL_PROBE_(ENTER|EXIT):([a-z0-9_.]+)/g),
  ];
  if (probeMarks.length && probeMarks[probeMarks.length - 1][1] === 'ENTER') {
    const target = probeMarks[probeMarks.length - 1][2];
    return {
      outcome: 'probe-failed',
      guard: 'migration function probe ($probe$)',
      probe: target,
      detail: err,
    };
  }
  return { outcome: 'not-installable', detail: err };
}

/**
 * Which files are checked and which install first: every migration the branch
 * adds or changes that production has not installed and that is not
 * superseded (production's event triggers fire on every one; the applier's
 * stale-pin guard only from PIN_CHECKED_FROM, as stalePinGuardSQL decides).
 */
export function planGuardCheck(files, installed, changed, evidence = {}) {
  const names = files.map((f) => f.name);
  const checked = [];
  const skipped = [];
  for (const { name, sql } of [...files].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!changed.has(name)) continue;
    const m = MIGRATION_FILE.exec(name);
    if (!m) skipped.push({ name, why: 'not a migration file name' });
    else if (installed.has(m[1]))
      skipped.push({
        name,
        why: 'production already holds this version; the applier answers ALREADY-APPLIED and runs nothing',
      });
    else if (supersededBy(sql, names))
      skipped.push({ name, why: `superseded by ${supersededBy(sql, names)}` });
    else checked.push(name);
  }
  const prerequisites = planRehearsal(files, installed, changed, evidence).ordinary.filter(
    (n) => !changed.has(n)
  );
  return { checked, skipped, prerequisites };
}

/** Final verdict of one file: the exact half governs; the static half decides when it cannot install. */
export function verdict(exact, pins, guards = { findings: [] }) {
  if (exact.outcome === 'guard-refused')
    return { fail: true, by: 'exact', reason: `${exact.guard}: ${exact.detail}` };
  if (exact.outcome === 'probe-failed')
    return {
      fail: true,
      by: 'exact',
      reason: `${exact.guard}${exact.probe ? ` (${exact.probe})` : ''}: ${exact.detail}`,
    };
  if (exact.outcome === 'installed') return { fail: false, by: 'exact' };
  const reasons = [
    ...pins.stale.map(describe),
    ...guards.findings.map((g) => `${g.guard}: ${g.reason}`),
  ];
  if (reasons.length) return { fail: true, by: 'static', reason: reasons.join('; ') };
  return { fail: false, by: 'static' };
}

export const describe = (f) =>
  `applier stale-pin guard: ${f.signature} (old md5 ${f.md5}, ${f.how}) is still pinned by ${f.pinner}`;

// ── CLI ─────────────────────────────────────────────────────────────────────

function psqlRunner(prefix) {
  const argv = prefix.trim().split(/\s+/);
  return (sql, extra = []) => {
    const r = spawnSync(
      argv[0],
      [...argv.slice(1), '-X', '-q', '-v', 'ON_ERROR_STOP=1', ...extra],
      {
        input: sql,
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
      }
    );
    return {
      status: r.status ?? 1,
      out: (r.stdout ?? '') + (r.stderr ?? ''),
      stdout: r.stdout ?? '',
    };
  };
}

const lines = (p) =>
  readFileSync(p, 'utf8')
    .split('\n')
    .map((s) => s.trim().replace(/^supabase\/migrations\//, ''))
    .filter(Boolean);

function rehearse() {
  const env = process.env;
  const { REHEARSAL_PSQL, MIG_DIR, INSTALLED, CHANGED, CAPTURE_DIR, EVIDENCE } = env;
  for (const [k, v] of Object.entries({
    REHEARSAL_PSQL,
    MIG_DIR,
    INSTALLED,
    CHANGED,
    CAPTURE_DIR,
    EVIDENCE,
  }))
    if (!v) {
      console.error(`[guards] ${k} is required`);
      process.exit(2);
    }
  mkdirSync(EVIDENCE, { recursive: true });
  const summary = join(EVIDENCE, 'summary.md');
  writeFileSync(summary, '');
  const say = (s = '') => {
    console.error(s);
    appendFileSync(summary, s + '\n');
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, s + '\n');
  };
  const files = readTree(MIG_DIR);
  const installed = new Set(lines(INSTALLED).filter((v) => /^\d{14}$/.test(v)));
  const changed = new Set(lines(CHANGED));
  const plan = planGuardCheck(files, installed, changed, evidenceFromEnv(env));
  say("### Production's DDL guards pass before merge");
  say('');
  for (const s of plan.skipped) say(`- skipped \`${s.name}\`: ${s.why}`);
  if (!plan.checked.length) {
    say('- no migration this pull request adds or changes is still to install; nothing to check.');
    return 0;
  }
  const read = (n) => {
    const p = join(CAPTURE_DIR, n);
    if (!existsSync(p)) throw new Error(`capture ${n} is missing`);
    return readFileSync(p, 'utf8');
  };
  let prod, copies, eventTriggers;
  try {
    prod = loadCatalog(
      read('guards-catalog.tsv'),
      read('guards-public.tsv'),
      read('guards-hex.tsv'),
      read('guards-hex-public.tsv')
    );
    const floor = Number(env.MIN_CAPTURED_FUNCTIONS ?? 100);
    if (prod.functions.length < floor)
      throw new Error(`only ${prod.functions.length} functions captured`);
    eventTriggers = read('guards-event-triggers.tsv');
    if (!rows(eventTriggers).length) throw new Error('no event trigger captured');
    copies = Object.fromEntries(GUARD_TABLES.map((t) => [t, read(copyFile(t))]));
  } catch (e) {
    say(`- **UNKNOWN**: production's capture is unreadable (${e.message}); this is not a pass.`);
    return 2;
  }
  say(
    `- production: ${prod.functions.length} functions in public and smarter_private, ${prod.pins.length} hex runs in installed sources, ${rows(eventTriggers).length} enabled event triggers.`
  );

  const psql = psqlRunner(REHEARSAL_PSQL);
  const admin = psqlRunner(env.REHEARSAL_ADMIN_PSQL || REHEARSAL_PSQL);
  const tsv = ['-A', '-t', '-F', '\t'];
  let arm;
  try {
    arm = armSQL(eventTriggers, copies);
  } catch (e) {
    say(`- **UNKNOWN**: ${e.message}; this is not a pass.`);
    return 2;
  }
  const loaded = admin(arm.loadSql);
  if (loaded.status !== 0) {
    say(
      `- **UNKNOWN**: the guards' rows could not be loaded into the copy (${loaded.out.trim().split('\n').pop()}); this is not a pass.`
    );
    return 2;
  }
  say(`- the copy holds production's ${GUARD_TABLES.join(', ')} rows.`);

  const restoredCatalog = psql(CATALOG_SQL_CATALOG_PATH, tsv);
  const restoredPublic = psql(CATALOG_SQL_PUBLIC_PATH, tsv);
  let fidelity = null;
  if (restoredCatalog.status === 0 && restoredPublic.status === 0) {
    const restored = loadCatalog(restoredCatalog.stdout, restoredPublic.stdout, '');
    const md5Of = new Map(restored.functions.map((f) => [f.signature, f.catalogMd5]));
    fidelity = prod.functions
      .filter((f) => md5Of.get(f.signature) !== f.catalogMd5)
      .map((f) => f.signature);
    say(
      `- restored copy: ${restored.functions.length} functions; ${fidelity.length} differ from production by md5 or are missing.`
    );
  } else
    say(
      '- restored copy: its catalog could not be read; exact results are reported but compared to nothing.'
    );

  // Static answers first, before any file or event trigger touches the copy.
  const statics = new Map();
  for (const name of plan.checked) {
    const sql = readFileSync(join(MIG_DIR, name), 'utf8');
    const pins = isPinChecked(name)
      ? staticPinFindings(sql, prod)
      : {
          changed: [],
          findings: [],
          stale: [],
          notes: [
            'older than PIN_CHECKED_FROM: the applier does not run the stale-pin guard on it',
          ],
        };
    const fns = functionBodies(sql);
    let guards = { findings: [], notes: [] };
    const q = staticGuardSQL(fns);
    if (q) {
      const r = psql(q, tsv);
      guards =
        r.status === 0
          ? staticGuardFindings(sql, fns, r.stdout)
          : {
              findings: [],
              notes: [`the classifiers could not be asked (${r.out.trim().split('\n').pop()})`],
            };
    }
    statics.set(name, { sql, pins, guards, fns });
  }

  // As postgres, the role production's event triggers belong to: Supabase
  // refuses a superuser running an event trigger whose function a
  // non-superuser owns, and production's are owned by postgres.
  const triggered = psql(arm.triggerSql);
  if (triggered.status !== 0) {
    say(
      `- **UNKNOWN**: production's event triggers could not be re-created on the copy (${triggered.out.trim().split('\n').pop()}); this is not a pass.`
    );
    return 2;
  }
  say(
    `- re-created ${arm.armed.length} of production's event triggers: ${arm.armed.map((a) => a.name).join(', ')}.`
  );
  for (const s of arm.skipped) say(`  - not re-created \`${s.name}\` (${s.fn}): ${s.why}`);

  // Seed minimal, idempotent production-like control rows (promo enforcement
  // dial, terminal MTT admission contract, minimal profile row for Daily
  // Missions lock probes) so $probe$ blocks exercise live enforcement branches
  // before merge rather than short-circuiting on an empty schema copy.
  const seeded = admin(seedProductionFixturesSQL());
  if (seeded.status !== 0) {
    say(
      `- **UNKNOWN**: production-like control fixtures could not be seeded on the copy (${seeded.out.trim().split('\n').pop()}); this is not a pass.`
    );
    return 2;
  }
  const seededMatch = /CA_REHEARSAL_SEEDED=([^\n]*)/.exec(seeded.out);
  const seededList = seededMatch?.[1]?.trim();
  say(
    `- seeded production-like control fixtures: ${seededList || 'none present on this schema'}.`
  );

  for (const f of plan.prerequisites) {
    const r = psql(readFileSync(join(MIG_DIR, f), 'utf8'));
    writeFileSync(join(EVIDENCE, `${f}.prerequisite.log`), r.out);
    say(
      `- prerequisite \`${f}\`: ${r.status === 0 ? 'installed' : 'did not install here; continuing'}`
    );
  }

  const guardFns = arm.armed.map((a) => a.fn);
  let failed = false;
  for (const name of plan.checked) {
    const { sql, pins, guards, fns } = statics.get(name);
    let exact;
    try {
      const r = psql(instrumentProbesSQL(pinRehearsalSQL(name, sql)));
      writeFileSync(join(EVIDENCE, `${name}.log`), r.out);
      exact = classifyExact(r.status, r.out, guardFns);
    } catch (e) {
      exact = { outcome: 'not-installable', detail: e.message };
    }
    const v = verdict(exact, pins, guards);
    failed ||= v.fail;
    say('');
    say(`#### \`${name}\`: ${v.fail ? '**FAIL**' : 'ok'} (decided by the ${v.by} half)`);
    say(
      `- exact install on production's schema with production's event triggers and the applier's stale-pin guard: ${exact.outcome}${exact.guard ? ` by ${exact.guard}` : ''}${exact.detail ? ` - ${exact.detail}` : ''}`
    );
    say(
      `- changes (static): ${pins.changed.map((c) => `\`${c.signature}\` [${c.how.join('; ')}]`).join(', ') || 'no installed function'}; creates ${fns.length} function bod${fns.length === 1 ? 'y' : 'ies'}`
    );
    for (const f of pins.findings) say(`  - pin: ${describe(f)} -> ${f.verdict}`);
    for (const g of guards.findings) say(`  - guard: ${g.guard}: ${g.reason}`);
    for (const n of [...pins.notes, ...guards.notes]) say(`  - note: ${n}`);
    if (fidelity) {
      const drift = pins.changed.filter((c) => fidelity.includes(c.signature));
      if (drift.length)
        say(
          `  - note: the restored copy differs from production for ${drift.map((c) => c.signature).join(', ')}; the static half used production's md5s`
        );
    }
    if (v.fail) say(`- refusal: ${v.reason}`);
  }
  say('');
  if (failed) {
    say(
      "A migration this pull request adds or changes would be refused by one of production's DDL guards after merge. Fix the file as the refusal says (move a pin or declare `-- @stale-pin-ok`; register a money RPC in ca_money_rpc_registry ABOVE its CREATE FUNCTION; never set a function back to a superseded body), then push again."
    );
    return 1;
  }
  say("OK: every migration this pull request adds or changes passes production's DDL guards.");
  return 0;
}

// node scripts/ci/migration-guards-before-merge.mjs rehearse            (environment as in the workflow)
// node scripts/ci/migration-guards-before-merge.mjs static <file.sql> <catalog.tsv> <public.tsv> <pins.tsv>
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, ...a] = process.argv.slice(2);
  if (cmd === 'rehearse') process.exit(rehearse());
  else if (cmd === 'static') {
    const cat = loadCatalog(
      readFileSync(a[1], 'utf8'),
      readFileSync(a[2], 'utf8'),
      readFileSync(a[3], 'utf8')
    );
    const r = staticPinFindings(readFileSync(a[0], 'utf8'), cat);
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
    process.exit(r.stale.length ? 1 : 0);
  } else {
    console.error(
      'usage: migration-guards-before-merge.mjs rehearse | static <file> <catalog.tsv> <public.tsv> <pins.tsv>'
    );
    process.exit(2);
  }
}
