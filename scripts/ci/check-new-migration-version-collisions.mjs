#!/usr/bin/env node
/**
 * Reject a newly added migration when another file already owns its version.
 * Historical collisions remain visible history; this gate prevents adding to
 * that backlog without renaming deployed migrations or rewriting the ledger.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { classifyMigration } from './recording-only.mjs';
import { replacesMd5Pins } from './migration-stale-pins.mjs';

const migrationDir = 'supabase/migrations';

/**
 * A NEW MIGRATION'S NAME MUST SURVIVE THE LEDGER (2026-09-28).
 *
 * `check-applied-migrations-are-recorded.mjs` ties an applied migration to its
 * file by the 14-digit version OR by the name. Two naming habits break both
 * keys at once, and together they were a large share of the 211 applied
 * migrations with no file measured on 2026-09-28:
 *
 *   1. A NAME LONGER THAN 60 CHARACTERS. One apply path stores the name cut
 *      at 60 (174 production rows are exactly 60 long, several of them
 *      visibly mid-word, e.g. `..._released_with_an_exac`), so a longer file
 *      name and its ledger row stop matching the moment it is applied under a
 *      different stamp. `scripts/new-migration.mjs` already cuts its slug at
 *      60; this is the same limit enforced where every file arrives.
 *   2. A LETTER-SUFFIXED STAMP (`20260724b_...`). Supabase keys the ledger
 *      on the digits, so it records such a file under a fresh apply-time
 *      version and the file's own stamp matches nothing.
 *
 * Scoped to NEW work. A verified recording (scripts/ci/recording-only.mjs)
 * carries the version and the name production already wrote, whatever their
 * length, and renaming it would un-record it. An inert tombstone cannot be
 * applied at all.
 */
export const MAX_MIGRATION_NAME = 60;

export function namingProblems(file) {
  const base = file.slice(file.lastIndexOf('/') + 1);
  const problems = [];
  const stamp = /^(\d+)([A-Za-z]+)[_-]/.exec(base);
  if (stamp) {
    problems.push(
      `stamp ${stamp[1]}${stamp[2]} carries a letter suffix; Supabase records only digits, ` +
        'so the ledger will hold this file under a different version. Use scripts/new-migration.mjs.'
    );
  }
  // Match the production applier's existing filename contract. A longer
  // numeric stamp can be unique yet still be impossible to install.
  if (!stamp && !/^\d{14}_[a-z0-9_]+\.sql$/.test(base)) {
    problems.push(
      'a new executable migration must use 14 digits, underscore, lower-case slug, and .sql; ' +
        'otherwise the production applier refuses the file. Use scripts/new-migration.mjs.'
    );
  }
  const m = /^\d+[A-Za-z]*[_-](.*)\.sql$/.exec(base);
  const name = m ? m[1] : base.replace(/\.sql$/, '');
  if (name.length > MAX_MIGRATION_NAME) {
    problems.push(
      `name is ${name.length} characters; production may store it cut at ${MAX_MIGRATION_NAME}, ` +
        'and then neither the version nor the name ties the ledger row to this file.'
    );
  }
  return problems;
}

/**
 * A FILE WITH NO EXECUTABLE SQL CANNOT ADD TO THE BACKLOG (2026-09-23).
 *
 * The gate above says it plainly: historical collisions remain visible history,
 * and this exists to stop anyone ADDING to that backlog. A retired migration -
 * every line of it a comment, its DDL preserved inert for the record - cannot
 * be added to anything, because Supabase can never apply it. It is
 * documentation that happens to live under this directory.
 *
 * `20260312002_bulk_update_position_stats.sql` is the case that forced this.
 * It is a tombstone: it shares its version with
 * `20260312002_tournament_flights.sql`, and the whole POINT of the file is to
 * say so, because Supabase keys schema_migrations on the version and silently
 * never applies the second of a pair. Refusing it would mean the only way to
 * keep that warning in the tree is to give it a UNIQUE version - which is to
 * say, to make a file that must never run look exactly like one that should.
 *
 * This is not an allowlist and it names no file. The moment executable SQL
 * reappears in a tombstone it collides again, which is the same regression
 * `tests/a-position-stat-has-a-live-writer.law.test.ts` independently pins.
 */
/**
 * A NEWER DEFINITION IS NEVER OVERWRITTEN BY AN OLDER VERSION (incident
 * 316ed735, 2026-11-19). Migrations install in MERGE order, not version
 * order. 20261119183127 redefined public.fn_ca_alarm_drill (the drill records
 * its completed run, which the cron watch reads as proof); 20261119180800,
 * lower-versioned but merged after it, redefined the same function from an
 * older body and installed second, so production silently lost the run record
 * while every reader of "the newest definition by version" still saw it.
 *
 * So a NEW migration may not create, replace or rewrite (pg_get_functiondef
 * anchored edit) a function that a migration with a HIGHER version already on
 * the base defines: give it a version above that one. Returns one line per
 * offending function.
 */
const FN_DEF = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:"?([a-z_][a-z0-9_]*)"?\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi;
const FN_REWRITE = /pg_get_functiondef\(\s*'(?:([a-z_][a-z0-9_]*)\.)?([a-z_][a-z0-9_]*)\s*\(/gi;
const VIEW_DEF = /CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?([a-z_][a-z0-9_]*)"?\.)?"?([a-z_][a-z0-9_]*)"?\b/gi;
const TRIGGER_DEF = /CREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\s+"?([a-z_][a-z0-9_]*)"?\b[^;]{0,200}?\bON\s+(?:"?([a-z_][a-z0-9_]*)"?\.)?"?([a-z_][a-z0-9_]*)"?\b/gi;
const CRON_DEF = /\bcron\.schedule\(\s*'([^']+)'/gi;

function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

export function definedFunctions(sql) {
  if (!/function|pg_get_functiondef/i.test(sql)) return new Set();
  const code = stripSqlComments(sql);
  const out = new Set();
  for (const re of [FN_DEF, FN_REWRITE]) {
    re.lastIndex = 0;
    for (const m of code.matchAll(re)) out.add(`${(m[1] || 'public').toLowerCase()}.${m[2].toLowerCase()}`);
  }
  return out;
}

export function definedObjects(sql) {
  const out = definedFunctions(sql);
  if (!/view|trigger|cron\.schedule/i.test(sql)) return out;
  const code = stripSqlComments(sql);
  if (/view/i.test(code)) {
    VIEW_DEF.lastIndex = 0;
    for (const m of code.matchAll(VIEW_DEF)) {
      out.add(`view:${(m[1] || 'public').toLowerCase()}.${m[2].toLowerCase()}`);
    }
  }
  if (/trigger/i.test(code)) {
    TRIGGER_DEF.lastIndex = 0;
    for (const m of code.matchAll(TRIGGER_DEF)) {
      out.add(`trigger:${(m[2] || 'public').toLowerCase()}.${m[3].toLowerCase()}.${m[1].toLowerCase()}`);
    }
  }
  if (/cron\.schedule/i.test(code)) {
    CRON_DEF.lastIndex = 0;
    for (const m of code.matchAll(CRON_DEF)) {
      out.add(`cron:${m[1].toLowerCase()}`);
    }
  }
  return out;
}

export const WATCHED_PREIMAGE_FUNCTIONS = new Set([
  'public.fn_ca_alarm_drill',
  'public.fn_ca_cron_failure_watch',
  'public.fn_ca_cron_health',
]);

/**
 * Mandatory preimage pin for critical watched guard functions: any NEW
 * migration that runs CREATE [OR REPLACE] FUNCTION on an already-defined
 * watched guard must declare `-- @replaces-md5: <schema>.<fn>(...)=<md5>`
 * so concurrent PRs cannot silently overwrite each other regardless of
 * version order. Anchored pg_get_functiondef edits already validate their
 * live anchor at install time.
 */
export function missingPreimagePinProblems(addedSql, baseFiles) {
  const code = stripSqlComments(addedSql);
  const replaced = new Set();
  FN_DEF.lastIndex = 0;
  for (const m of code.matchAll(FN_DEF)) {
    const fn = `${(m[1] || 'public').toLowerCase()}.${m[2].toLowerCase()}`;
    if (WATCHED_PREIMAGE_FUNCTIONS.has(fn)) replaced.add(fn);
  }
  if (replaced.size === 0) return [];
  const pinned = new Set(
    replacesMd5Pins(addedSql).map((p) => p.signature.replace(/\(.*$/, '').toLowerCase())
  );
  const problems = [];
  for (const fn of [...replaced].sort()) {
    const existsOnBase = baseFiles.some((f) => (f.functions ?? f.objects).has(fn));
    if (existsOnBase && !pinned.has(fn)) {
      problems.push(
        `replaces watched guard ${fn} without -- @replaces-md5: ${fn}(...)=<32-hex-md5>; ` +
          'declare the live preimage md5 so concurrent PRs cannot silently overwrite each other.'
      );
    }
  }
  return problems;
}

export function redefinitionOrderProblems(addedFile, addedSql, baseFiles) {
  const version = addedFile.split('_', 1)[0];
  const mine = definedObjects(addedSql);
  const problems = [];
  if (mine.size === 0) return problems;
  for (const obj of [...mine].sort()) {
    const newer = baseFiles
      .filter((f) => f.name.split('_', 1)[0] > version && (f.objects ?? f.functions).has(obj))
      .map((f) => f.name)
      .sort();
    if (newer.length > 0) {
      problems.push(
        `redefines ${obj}, which newer-versioned ${newer[newer.length - 1]} already defines on the base; ` +
          'installed after it, this file would overwrite the newer body. Give it a version above that file.'
      );
    }
  }
  return problems;
}

function isInert(path) {
  try {
    return readFileSync(path, 'utf8')
      .split('\n')
      .every((line) => line.trim() === '' || line.trimStart().startsWith('--'));
  } catch {
    // Unreadable is not inert. Let the collision rule speak.
    return false;
  }
}

function git(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function resolveBase() {
  const explicit = process.argv[2];
  if (explicit) return explicit;
  const branch = process.env.GITHUB_BASE_REF;
  for (const candidate of branch ? [`origin/${branch}`, branch] : ['origin/main', 'main']) {
    try {
      git(['rev-parse', '--verify', candidate]);
      return candidate;
    } catch {
      // Try the next locally available base reference.
    }
  }
  return 'HEAD^';
}

function main() {
  try {
    const base = resolveBase();
    const committedOrStaged = git([
      'diff',
      '--name-only',
      '--diff-filter=A',
      base,
      '--',
      migrationDir,
    ]).split('\n');
    const untracked = git(['ls-files', '--others', '--exclude-standard', '--', migrationDir]).split(
      '\n'
    );
    const added = [...new Set([...committedOrStaged, ...untracked])].filter((file) =>
      file.endsWith('.sql')
    );
    const all = readdirSync(migrationDir).filter((file) => file.endsWith('.sql'));
    const collisions = [];
    const misnamed = [];

    for (const path of added) {
      if (isInert(path)) continue;
      const file = path.slice(path.lastIndexOf('/') + 1);
      const version = file.split('_', 1)[0];
      const owners = all.filter((candidate) => candidate.split('_', 1)[0] === version).sort();
      if (owners.length > 1) collisions.push({ version, owners });
      const problems = namingProblems(path);
      if (problems.length > 0 && classifyMigration(path).state !== 'recorded') {
        misnamed.push({ path, problems });
      }
    }

    if (misnamed.length > 0) {
      console.error(
        '[migration-version-collisions] newly added migration name cannot be tied to its ledger row:'
      );
      for (const { path, problems } of misnamed) {
        for (const p of problems) console.error(`  ${path}: ${p}`);
      }
      console.error(
        'Rename it before it is applied (scripts/new-migration.mjs keeps the name and version rules).'
      );
    }

    if (collisions.length > 0) {
      console.error('[migration-version-collisions] newly added migration version is not unique:');
      for (const { version, owners } of collisions) {
        console.error(`  ${version}: ${owners.join(', ')}`);
      }
      console.error('Assign a new, unique migration version before publishing.');
    }
    const addedNames = new Set(added.map((p) => p.slice(p.lastIndexOf('/') + 1)));
    const baseFiles = all
      .filter((name) => !addedNames.has(name))
      .map((name) => {
        let sql = '';
        try {
          sql = readFileSync(join(migrationDir, name), 'utf8');
        } catch {
          // Unreadable base file defines nothing this gate can name.
        }
        return { name, functions: definedFunctions(sql), objects: definedObjects(sql) };
      });
    const overwrites = [];
    for (const path of added) {
      if (isInert(path)) continue;
      const file = path.slice(path.lastIndexOf('/') + 1);
      const sql = readFileSync(path, 'utf8');
      const problems = [
        ...redefinitionOrderProblems(file, sql, baseFiles),
        ...missingPreimagePinProblems(sql, baseFiles),
      ];
      if (problems.length > 0) overwrites.push({ path, problems });
    }
    if (overwrites.length > 0) {
      console.error('[migration-version-collisions] newly added migration would overwrite a newer function body:');
      for (const { path, problems } of overwrites) {
        for (const p of problems) console.error(`  ${path}: ${p}`);
      }
    }
    if (collisions.length > 0 || misnamed.length > 0) process.exit(1);
    if (overwrites.length > 0) process.exit(1);

    console.log(
      `[migration-version-collisions] ${added.length} new migration(s) against ${base}; all versions are unique.`
    );
  } catch (error) {
    console.error('[migration-version-collisions] script error:', error?.message || error);
    process.exit(2);
  }
}

// Guarded so a test can import namingProblems without running the gate.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
