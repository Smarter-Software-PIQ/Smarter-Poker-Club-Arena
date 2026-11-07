/**
 * ===========================================================================
 *  A WINDOW MIGRATION'S DOOR IS ADMITTED ON CONDITION (2026-11-07)
 * ===========================================================================
 *
 * The deadlock this breaks. A migration that declares
 * "-- @install-window: daily-maintenance" can only install INSIDE the 04:00
 * America/Chicago freeze (install-window-migrations.mjs). The deploy's door
 * check (check-engine-doors-exist.mjs) runs about eight minutes BEFORE that
 * break and refused any build calling a function production did not have yet.
 * So a build that calls a function created by a queued window migration was
 * refused every day before its migration could ever install: on 2026-11-07
 * Engine Release run 42360536751 refused e6e26ab8 at 09:52Z for
 * fn_cash_session_set_blind_off() and fn_lightning_blind_off_players(), both
 * created by the queued 20261106203853_hit_and_run_ten_hands_in_profit.sql.
 *
 * The rule. A door missing from production is admitted CONDITIONALLY - a
 * named third outcome, never "ok" (CLAUDE.md 10.86) - only when a migration on
 * this exact target checkout creates it, declares the daily window, is not
 * superseded, is byte-identical to protected main, and is not in
 * schema_migrations. Every other missing door is refused exactly as before.
 * Inside the break, after the window install and before any cutover, the host
 * transaction re-reads pg_proc for the window-created doors
 * (server/scripts/engine-release-window-doors.py) and refuses with the named
 * reason if one is still missing, so the current engine keeps running.
 *
 * Pinned by tests/a-window-migration-door-is-admitted-only-on-condition.law.test.ts.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { declaresMaintenanceWindow } from './maintenance-window-migrations.mjs';
import { supersededBy } from './check-migrations-are-live.mjs';

export const MIGRATION_DIR = join('supabase', 'migrations');
const MIGRATION_FILE = /^\d{14}_[a-z0-9_]+\.sql$/;

/** SQL with -- line comments and block comments removed. */
export function stripSqlComments(sql) {
  return String(sql)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
}

const CREATE_FUNCTION =
  /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:("?)([A-Za-z_][A-Za-z0-9_]*)\1\s*\.\s*)?("?)([A-Za-z_][A-Za-z0-9_]*)\3\s*\(/gi;

/** The public-schema function names one migration's SQL creates. */
export function createdFunctions(sql) {
  const names = new Set();
  for (const m of stripSqlComments(sql).matchAll(CREATE_FUNCTION)) {
    const schema = m[2];
    if (schema && schema.toLowerCase() !== 'public') continue;
    names.add(m[4]);
  }
  return names;
}

/** Declared, not-superseded window migrations on this checkout: file -> created names. */
export function windowMigrationCreators(root) {
  const dir = join(root, MIGRATION_DIR);
  if (!existsSync(dir)) return new Map();
  const files = readdirSync(dir);
  const out = new Map();
  for (const file of files.filter((f) => MIGRATION_FILE.test(f)).sort()) {
    const sql = readFileSync(join(dir, file), 'utf8');
    if (!declaresMaintenanceWindow(sql)) continue;
    if (supersededBy(sql, files)) continue;
    out.set(file, createdFunctions(sql));
  }
  return out;
}

/** "Queued" exactly as the window installer reads it: no version or name row. */
export function isRecorded(file, recorded) {
  const version = file.slice(0, 14);
  const slug = file.slice(15, -4);
  return recorded.some(
    (row) => row.version === version || row.name === slug || row.name === slug.slice(0, 55)
  );
}

/** The bytes protected main holds for this file, or null when they cannot be read. */
export function protectedMainBytes(root, file, ref) {
  try {
    return execFileSync('git', ['-C', root, 'show', `${ref}:${MIGRATION_DIR}/${file}`], {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

/**
 * Split the missing doors into the conditional ones and the refused ones.
 *
 * recorded is the schema_migrations rows for the window files, or null when
 * that history could not be read: unknown history admits nothing.
 */
export function classifyMissingDoors({ root, missing, recorded, mainRef }) {
  const conditional = [];
  const refused = [];
  const creators = new Map();
  const reasons = new Map();
  const windows = windowMigrationCreators(root);
  for (const name of missing) {
    const files = [...windows].filter(([, names]) => names.has(name)).map(([file]) => file);
    if (files.length === 0) {
      refused.push(name);
      continue;
    }
    if (!Array.isArray(recorded)) {
      refused.push(name);
      reasons.set(
        name,
        'schema_migrations could not be read, so its window migration cannot be proved queued'
      );
      continue;
    }
    const admitted = files.filter((file) => {
      if (isRecorded(file, recorded)) return false;
      const main = protectedMainBytes(root, file, mainRef);
      return main !== null && main.equals(readFileSync(join(root, MIGRATION_DIR, file)));
    });
    if (admitted.length === 0) {
      refused.push(name);
      reasons.set(
        name,
        `its window migration ${files.join(', ')} is already recorded in schema_migrations or is not byte-identical to protected main`
      );
      continue;
    }
    conditional.push(name);
    creators.set(name, admitted);
  }
  return { conditional, refused, creators, reasons, windowFiles: [...windows.keys()] };
}
