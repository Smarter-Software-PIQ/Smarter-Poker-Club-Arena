/**
 * A MIGRATION'S PINS ARE CHECKED AGAINST PRODUCTION BEFORE IT MERGES
 * (2026-11-18, incident 075013fd).
 *
 * #11256 passed every check and merged; production's applier then refused its
 * 20261118034950 with 55000 migration_left_a_stale_pin, because
 * smarter_private.original_erased_cash_base_discharge(bigint,text), an
 * installed function, pins the md5 of fn_ca_tally_balance_move's body
 * (b7911a24...), which the migration changes. The stale-pin guard
 * (migration-stale-pins.mjs) only ever ran INSIDE the applier, after merge;
 * the merge-time pinning test (aMigrationMovesThePinsOnWhatItChanges) runs the
 * guard on repo fixtures, never on production's installed functions. The
 * refusal surfaced at install, during an engine release window, and cost a
 * revert (#11260) and a re-land (#11270).
 *
 * This asks the applier's question before merge, two ways, on every migration
 * a pull request adds or modifies that the applier would guard
 * (isPinChecked: version >= PIN_CHECKED_FROM), that production has not
 * installed and that is not superseded:
 *
 *   EXACT. The window rehearsal's throwaway database restored from
 *   production's schema-only archive (restore-schema-for-rehearsal.sh) gets
 *   production's uninstalled ordinary migrations, then each such file wrapped
 *   by the applier's OWN stalePinGuardSQL (same snapshot, same check, same
 *   @stale-pin-ok allowance; nothing forked). A 55000
 *   migration_left_a_stale_pin there is the applier's refusal, before merge.
 *   The database computes "which functions changed", so DO blocks, dynamic
 *   EXECUTE and every substitution helper are covered.
 *
 *   STATIC, when the exact install cannot run (a row-dependent assertion on
 *   an empty schema, a dependency on another unmerged branch). The file is
 *   parsed for the functions it changes: CREATE [OR REPLACE] FUNCTION /
 *   PROCEDURE, ALTER (not OWNER TO), DROP, the signature passed as first
 *   argument to a pg_temp.* helper (ca_rake_subst, ca_patch, ...), and any
 *   md5 literal at statement level equal to an installed function's current
 *   md5 or paired with a signature as a helper's preimage. Their CURRENT md5s
 *   in both forms the guard takes come from production (read-only capture,
 *   migration-pins-capture.mjs), as does every hex run in every installed
 *   function's source. A pin is stale unless the pinning function is itself
 *   changed by the same file (assumed to move it) or the md5 is declared with
 *   -- @stale-pin-ok (allowedStalePins, the applier's own parser).
 *
 * Verdict per file: exact refusal -> FAIL; exact install -> PASS (the static
 * findings are printed as notes); not installable -> the static verdict.
 *
 * BLIND SPOTS. The exact half runs on production's schema as captured at the
 * pull-request event, with no rows: a migration that fails on an empty table
 * falls back to the static half. The static half cannot see a function
 * changed only inside a CREATE FUNCTION body or a signature built at run time
 * (pg_temp.pacific_cash_hook builds 'public.'||name||'()'; its md5 literal is
 * still caught), and it assumes a pinner the file also changes has had its pin
 * moved. Production can change between this check and the merge's install;
 * the applier's own guard stays the last word. Pins in schemas the archive
 * does not export (only the application schemas are restored) are seen by
 * the static half, which reads every pg_proc row, but not by the exact half.
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
  planRehearsal,
  readTree,
  rehearsalSQL,
  MIGRATION_FILE,
} from './window-queue-rehearsal.mjs';
import { CATALOG_SQL_CATALOG_PATH, CATALOG_SQL_PUBLIC_PATH } from './migration-pins-capture.mjs';

const MD5 = /^[0-9a-f]{32}$/;

// ── SQL scanning ────────────────────────────────────────────────────────────

/**
 * Statement-level text of a migration: comments removed, and the body of
 * every dollar-quoted string replaced by an empty one EXCEPT a DO block's,
 * which is scanned the same way (a DO block is statements the file runs; a
 * CREATE FUNCTION body is code it installs, whose md5 literals are pins, not
 * preimages). Single-quoted literals are kept.
 */
export function statementText(sql) {
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
        out += /^DO\b/i.test(statement) ? ` ${statementText(body)} ` : '$$';
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
export function loadCatalog(catalogTsv, publicTsv, pinsTsv) {
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
  const pins = rows(pinsTsv).map(([pinner, run]) => ({ pinner, run }));
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

// ── the exact half ──────────────────────────────────────────────────────────

/**
 * The SQL the exact half sends for one file: its CONCURRENTLY preamble (as the
 * applier sends it, statement by statement), then its transaction wrapped by
 * the applier's own guard. A window file carries the installer's prelude too.
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

/** One exact outcome from psql's exit status and output. */
export function classifyExact(status, output) {
  if (status === 0) return { outcome: 'installed' };
  const m = /migration_left_a_stale_pin:\s*([^\n]*)/.exec(output);
  if (m) return { outcome: 'stale-pin', detail: m[1].trim() };
  const e = /ERROR:\s*([^\n]*)/.exec(output);
  return {
    outcome: 'not-installable',
    detail: (e ? e[1] : (output.trim().split('\n').pop() ?? '')).slice(0, 300),
  };
}

/**
 * Which files are checked and which install first.
 * @param {{name: string, sql: string}[]} files
 * @param {Set<string>} installed  14-digit versions production holds
 * @param {Set<string>} changed    file names the pull request adds or modifies
 */
export function planPinCheck(files, installed, changed) {
  const names = files.map((f) => f.name);
  const checked = [];
  const skipped = [];
  for (const { name, sql } of [...files].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!changed.has(name)) continue;
    const m = MIGRATION_FILE.exec(name);
    if (!m) skipped.push({ name, why: 'not a migration file name' });
    else if (!isPinChecked(name))
      skipped.push({ name, why: 'older than PIN_CHECKED_FROM; the applier does not guard it' });
    else if (installed.has(m[1]))
      skipped.push({
        name,
        why: 'production already holds this version; the applier answers ALREADY-APPLIED and runs nothing',
      });
    else if (supersededBy(sql, names))
      skipped.push({ name, why: `superseded by ${supersededBy(sql, names)}` });
    else checked.push(name);
  }
  const prerequisites = planRehearsal(files, installed, changed).ordinary.filter(
    (n) => !changed.has(n)
  );
  return { checked, skipped, prerequisites };
}

/** Final verdict of one file. */
export function verdict(exact, stat) {
  if (exact.outcome === 'stale-pin') return { fail: true, by: 'exact', reason: exact.detail };
  if (exact.outcome === 'installed') return { fail: false, by: 'exact' };
  if (stat.stale.length)
    return { fail: true, by: 'static', reason: stat.stale.map(describe).join('; ') };
  return { fail: false, by: 'static' };
}

export const describe = (f) =>
  `${f.signature} (old md5 ${f.md5}, ${f.how}) is still pinned by ${f.pinner}`;

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
  const { REHEARSAL_PSQL, MIG_DIR, INSTALLED, CHANGED, CAPTURE_DIR, EVIDENCE } = process.env;
  for (const [k, v] of Object.entries({
    REHEARSAL_PSQL,
    MIG_DIR,
    INSTALLED,
    CHANGED,
    CAPTURE_DIR,
    EVIDENCE,
  }))
    if (!v) {
      console.error(`[pins] ${k} is required`);
      process.exit(2);
    }
  mkdirSync(EVIDENCE, { recursive: true });
  const summary = join(EVIDENCE, 'summary.md');
  writeFileSync(summary, '');
  const say = (s = '') => {
    console.error(s);
    appendFileSync(summary, s + '\n');
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, s + '\n');
  };
  const files = readTree(MIG_DIR);
  const installed = new Set(lines(INSTALLED).filter((v) => /^\d{14}$/.test(v)));
  const changed = new Set(lines(CHANGED));
  const plan = planPinCheck(files, installed, changed);
  say("### Migration pins move before merge (production's installed functions)");
  say('');
  for (const s of plan.skipped) say(`- skipped \`${s.name}\`: ${s.why}`);
  if (!plan.checked.length) {
    say(
      '- no migration this pull request adds or changes is guarded by the applier and still to install; nothing to check.'
    );
    return 0;
  }
  const read = (n) => {
    const p = join(CAPTURE_DIR, n);
    if (!existsSync(p)) throw new Error(`capture ${n} is missing`);
    return readFileSync(p, 'utf8');
  };
  let prod;
  try {
    prod = loadCatalog(read('pins-catalog.tsv'), read('pins-public.tsv'), read('pins-hex.tsv'));
    if (prod.functions.length < 100)
      throw new Error(`only ${prod.functions.length} functions captured`);
  } catch (e) {
    say(
      `- **UNKNOWN**: production's catalog capture is unreadable (${e.message}); this is not a pass.`
    );
    return 2;
  }
  say(
    `- production: ${prod.functions.length} functions in public and smarter_private, ${prod.pins.length} hex runs in installed sources.`
  );

  const psql = psqlRunner(REHEARSAL_PSQL);
  const tsv = ['-A', '-t', '-F', '\t'];
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

  for (const f of plan.prerequisites) {
    const r = psql(readFileSync(join(MIG_DIR, f), 'utf8'));
    writeFileSync(join(EVIDENCE, `${f}.prerequisite.log`), r.out);
    say(
      `- prerequisite \`${f}\`: ${r.status === 0 ? 'installed' : 'did not install here; continuing'}`
    );
  }

  let failed = false;
  for (const name of plan.checked) {
    const sql = readFileSync(join(MIG_DIR, name), 'utf8');
    const stat = staticPinFindings(sql, prod);
    let exact;
    try {
      const r = psql(pinRehearsalSQL(name, sql));
      writeFileSync(join(EVIDENCE, `${name}.log`), r.out);
      exact = classifyExact(r.status, r.out);
    } catch (e) {
      exact = { outcome: 'not-installable', detail: e.message };
    }
    const v = verdict(exact, stat);
    failed ||= v.fail;
    say('');
    say(`#### \`${name}\`: ${v.fail ? '**FAIL**' : 'ok'} (decided by the ${v.by} half)`);
    say(
      `- exact install on production's schema with the applier's guard: ${exact.outcome}${exact.detail ? ` - ${exact.detail}` : ''}`
    );
    say(
      `- changes (static): ${stat.changed.map((c) => `\`${c.signature}\` [${c.how.join('; ')}]`).join(', ') || 'no installed function'}`
    );
    for (const f of stat.findings) say(`  - pin: ${describe(f)} -> ${f.verdict}`);
    for (const n of stat.notes) say(`  - note: ${n}`);
    if (fidelity) {
      const drift = stat.changed.filter((c) => fidelity.includes(c.signature));
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
      "A migration this pull request adds or changes would leave an installed function pinned to a body it changes, and production's applier would refuse it after merge with 55000 migration_left_a_stale_pin. Move the pin to the new body in the same migration, or declare `-- @stale-pin-ok: <md5> <why>` before BEGIN if the pin is meant to keep naming the old body."
    );
    return 1;
  }
  say('OK: no migration this pull request adds or changes leaves a stale pin on production.');
  return 0;
}

// node scripts/ci/migration-pins-before-merge.mjs rehearse            (environment as in the workflow)
// node scripts/ci/migration-pins-before-merge.mjs static <file.sql> <catalog.tsv> <public.tsv> <pins.tsv>
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
      'usage: migration-pins-before-merge.mjs rehearse | static <file> <catalog.tsv> <public.tsv> <pins.tsv>'
    );
    process.exit(2);
  }
}
