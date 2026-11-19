#!/usr/bin/env node
/**
 * Reject a newly added migration when another file already owns its version.
 * Historical collisions remain visible history; this gate prevents adding to
 * that backlog without renaming deployed migrations or rewriting the ledger.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { classifyMigration } from './recording-only.mjs';

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
 * A NEW MIGRATION'S NAME IS NOT ANOTHER FILE'S NAME (2026-11-19).
 *
 * The production applier (scripts/ci/apply-recorded-migration.mjs) answers
 * ALREADY-APPLIED when schema_migrations holds this file's VERSION or its
 * NAME (or the name cut at 55). The name key is deliberate: it is how a change
 * applied through another door under another stamp is recognised. But it also
 * means that of two executable files sharing one name, the second is never
 * sent, and its run reports success.
 *
 * Measured 2026-11-19: #11433 added
 * 20261119180000_chicago_cash_windows_add_partial_days_instead_of_subtracting
 * and #11428, six minutes later, added 20261119183700 with the same name and a
 * different body. 180000 installed. The 183700 run (44617650995) logged
 * "ALREADY-APPLIED ... recorded as version=20261119180000" and changed
 * nothing; migration-install-watch paged MergedMigrationNotInstalled
 * (operational_alert_events 445897) an hour later. Unique versions did not
 * protect it, because the applier does not key on the version alone.
 *
 * So a NEW executable migration may not share its name, or the applier's
 * 55-character name prefix, with another executable file already on the base.
 * A verified recording carries the name production wrote and is exempt; an
 * inert tombstone can never be applied and neither collides nor is collided.
 */
export const APPLIER_NAME_PREFIX = 55;

export function migrationName(file) {
  const base = file.slice(file.lastIndexOf('/') + 1);
  const m = /^\d+[A-Za-z]*[_-](.*)\.sql$/.exec(base);
  return m ? m[1] : base.replace(/\.sql$/, '');
}

/** True when the applier would read a ledger row named for one file as the other. */
export function namesCollide(a, b) {
  const x = migrationName(a);
  const y = migrationName(b);
  return x === y || x.slice(0, APPLIER_NAME_PREFIX) === y || y.slice(0, APPLIER_NAME_PREFIX) === x;
}

/**
 * Other executable files whose name the applier would mistake for this one's.
 * `others` are base filenames; `inert(file)` says whether one has no SQL.
 */
export function nameOwners(file, others, inert = () => false) {
  const self = file.slice(file.lastIndexOf('/') + 1);
  return others
    .filter((other) => other !== self && !inert(other) && namesCollide(self, other))
    .sort();
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
    const nameClashes = [];

    for (const path of added) {
      if (isInert(path)) continue;
      const file = path.slice(path.lastIndexOf('/') + 1);
      const version = file.split('_', 1)[0];
      const owners = all.filter((candidate) => candidate.split('_', 1)[0] === version).sort();
      if (owners.length > 1) collisions.push({ version, owners });
      if (classifyMigration(path).state !== 'recorded') {
        const sharing = nameOwners(path, all, (other) => isInert(`${migrationDir}/${other}`));
        if (sharing.length > 0) nameClashes.push({ file, sharing });
      }
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
    if (nameClashes.length > 0) {
      console.error(
        '[migration-version-collisions] newly added migration shares its name with another migration:'
      );
      for (const { file, sharing } of nameClashes) {
        console.error(`  ${file}: ${sharing.join(', ')}`);
      }
      console.error(
        'The applier answers ALREADY-APPLIED by name, so this file would never be sent. ' +
          'Give it a distinct name (scripts/new-migration.mjs "<what it does>").'
      );
    }
    if (collisions.length > 0 || nameClashes.length > 0 || misnamed.length > 0) process.exit(1);

    console.log(
      `[migration-version-collisions] ${added.length} new migration(s) against ${base}; all versions and names are unique.`
    );
  } catch (error) {
    console.error('[migration-version-collisions] script error:', error?.message || error);
    process.exit(2);
  }
}

// Guarded so a test can import namingProblems without running the gate.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
