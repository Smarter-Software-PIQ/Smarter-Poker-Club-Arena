#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A PULL REQUEST CANNOT MAKE MAIN UNSHIPPABLE (2026-11-07)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The release gate (scripts/ci/check-engine-doors-exist.mjs) asks production's
 * pg_proc whether every database function the engine calls exists, eight
 * minutes before the 04:00 America/Chicago break. It is correct and it is the
 * last word. But it is the ONLY word: it runs at release time, so a pull
 * request can merge, main can go un-releasable, and nobody learns until the
 * next release is refused.
 *
 * 2026-11-07 is the worked example. Engine Release run 42360536751 refused the
 * certified e6e26ab8 at 09:52Z because fn_cash_session_set_blind_off() and
 * fn_lightning_blind_off_players() did not exist in production. Both are
 * created by 20261106203853_hit_and_run_ten_hands_in_profit.sql (#9748), which
 * declares "-- @install-window: daily-maintenance" and so installs only inside
 * the freeze. That file is queued and the window run was refused with a 55P03
 * lock timeout, so main stayed un-releasable while the window kept failing.
 *
 * This gate asks the same question on the PR side, and splits the answer three
 * ways, because the three cases need three different human responses:
 *
 *   REFUSED  No migration anywhere in the merge result creates the function.
 *            You forgot the migration, or deleted it, or only a SUPERSEDED file
 *            ever created it. This is the PR's own defect, so the PR fails.
 *
 *   ALLOWED  A migration THIS PR ADDS creates it. A window-declared file
 *            installs inside the next 04:00 break; an ordinary file applies on
 *            merge (apply-merged-migration.yml). Either way the PR is carrying
 *            its own database half, so being absent from production right now
 *            is expected and is NOT a failure. Refusing this is precisely the
 *            deadlock a window migration could never escape.
 *
 *   WARNED   A migration ALREADY ON MAIN creates it and is not yet recorded in
 *            schema_migrations. Merging makes main un-releasable until that
 *            file installs - tonight's case exactly. It is NOT this PR's fault
 *            and this repository has already ruled that failing every PR for
 *            another branch's unapplied migration "would be an outage of its
 *            own" (.github/workflows/applied-migrations-recorded.yml). So this
 *            warns loudly and names the file and the release consequence,
 *            rather than blocking a queue it did not break.
 *
 * It answers when it does not know (CLAUDE.md 10.86): an unreadable production
 * or an unreadable base tree is a NAMED verdict, never a silent pass and never
 * a confident refusal. It changes no behaviour of the release gate; it imports
 * that gate's own extractor so the two can never disagree about what a door is.
 *
 * Usage:  node scripts/ci/check-pr-engine-doors.mjs
 * Exit:   0 proved / allowed / warned / unchecked;  1 refused
 * Output: verdict=proved|allowed|warned|refused|unchecked
 *         refused=<names>  allowed=<names>  warned=<names>  reason=<one line>
 */
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { engineDoors } from './check-engine-doors-exist.mjs';
import { MIGRATION_DIR, createdFunctions, isRecorded } from './window-migration-doors.mjs';
import { declaresMaintenanceWindow } from './maintenance-window-migrations.mjs';
import { supersededBy } from './check-migrations-are-live.mjs';

// The tree to judge. A trusted pull_request_target run points this at the
// pull request's merge-result files, extracted as data (never executed), and
// keeps the base git checkout separate in PR_DOORS_BASE_ROOT.
const ROOT = process.env.PR_DOORS_ROOT || process.cwd();
const BASE_ROOT = process.env.PR_DOORS_BASE_ROOT || ROOT;
const ALLOWLIST = join(ROOT, 'scripts', 'ci', 'engine-doors.allowlist.json');
const MIGRATION_FILE = /^\d{14}_[a-z0-9_]+\.sql$/;
const BASE_REF = process.env.PR_DOORS_BASE_REF || 'refs/remotes/origin/main';

function emit(key, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  try {
    appendFileSync(file, `${key}=${String(value).replace(/[\r\n]+/g, ' ').slice(0, 900)}\n`);
  } catch {
    /* the job log still names it */
  }
}

/**
 * Every migration in the merge result that creates a public function, with
 * whether it is window-gated. A SUPERSEDED file is skipped: it never installs,
 * so it can never supply a door (the release-side law pins the same rule).
 */
export function migrationCreators(root) {
  const dir = join(root, MIGRATION_DIR);
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir)
    .filter((f) => MIGRATION_FILE.test(f))
    .sort();
  const creators = [];
  for (const file of files) {
    const sql = readFileSync(join(dir, file), 'utf8');
    if (supersededBy(sql, files)) continue;
    const names = createdFunctions(sql);
    if (names.size === 0) continue;
    creators.push({ file, names, window: declaresMaintenanceWindow(sql) });
  }
  return creators;
}

/**
 * The migration filenames the BASE branch already has, or null when the base
 * tree cannot be read. Null is unknown, not empty: an unreadable base must not
 * be allowed to look like "every file here is new".
 */
export function baseMigrationFiles(root, ref) {
  try {
    const stdout = execFileSync(
      'git',
      ['-C', root, 'ls-tree', '-r', '--name-only', ref, '--', MIGRATION_DIR],
      { stdio: ['ignore', 'pipe', 'ignore'], timeout: 20_000, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' }
    );
    return new Set(stdout.split('\n').filter(Boolean).map((p) => p.slice(p.lastIndexOf('/') + 1)));
  } catch {
    return null;
  }
}

/**
 * Split the missing doors into refused / allowed / warned.
 *
 * recorded is the schema_migrations rows for the creator files, or null when
 * that history could not be read. baseFiles is null when the base tree could
 * not be read, which blurs "new here" and "already on main" - that degrades to
 * warned, never to allowed and never to refused.
 */
export function classifyPrDoors({ missing, creators, baseFiles, recorded }) {
  const refused = [];
  const allowed = [];
  const warned = [];
  const detail = new Map();
  const kind = new Map();
  for (const name of missing) {
    const mine = creators.filter((c) => c.names.has(name));
    if (mine.length === 0) {
      refused.push(name);
      continue;
    }
    // A creator already recorded in schema_migrations cannot explain why the
    // function is absent, so prefer the files that are still pending.
    const pending = Array.isArray(recorded)
      ? mine.filter((c) => !isRecorded(c.file, recorded))
      : mine;
    // Every creator is already recorded, yet the function is absent. The
    // migration ran and the door is still not there: real drift, and not
    // something this pull request did. Name it as itself rather than calling
    // it queued, which would be a confident wrong answer (CLAUDE.md 10.86).
    if (Array.isArray(recorded) && pending.length === 0) {
      warned.push(name);
      detail.set(name, mine.map((c) => c.file));
      kind.set(name, 'recorded-but-missing');
      continue;
    }
    const candidates = pending.length ? pending : mine;
    if (baseFiles === null) {
      warned.push(name);
      detail.set(name, candidates.map((c) => c.file));
      kind.set(name, 'unknown-base');
      continue;
    }
    const added = candidates.filter((c) => !baseFiles.has(c.file));
    if (added.length) {
      allowed.push(name);
      detail.set(name, added.map((c) => c.file));
      kind.set(name, added.some((c) => c.window) ? 'window-in-pr' : 'ordinary-in-pr');
      continue;
    }
    warned.push(name);
    detail.set(name, candidates.map((c) => c.file));
    kind.set(name, candidates.some((c) => c.window) ? 'window-on-main' : 'ordinary-on-main');
  }
  return { refused, allowed, warned, detail, kind };
}

async function production(names, files) {
  const fixture = process.env.PR_DOORS_LIVE_FIXTURE;
  if (fixture) {
    const recordedFixture = process.env.PR_DOORS_RECORDED_FIXTURE;
    return {
      found: new Set(JSON.parse(readFileSync(fixture, 'utf8'))),
      recorded: recordedFixture ? JSON.parse(readFileSync(recordedFixture, 'utf8')) : null,
    };
  }
  const url = process.env.DATABASE_URL;
  // A pull request from a fork gets no secrets. That is an honest "unchecked",
  // not a pass and not a refusal.
  if (!url) return { unreadable: 'DATABASE_URL is not set' };
  let Client;
  try {
    ({ Client } = (await import('pg')).default ?? (await import('pg')));
  } catch {
    return { unreadable: 'the pg client is not installed' };
  }
  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: 15_000,
    statement_timeout: 15_000,
  });
  try {
    await client.connect();
    // Read-only. The same question the release gate asks, same witness.
    const { rows } = await client.query(
      `SELECT DISTINCT p.proname
         FROM pg_catalog.pg_proc p
         JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = ANY($1::text[])`,
      [names]
    );
    let recorded = [];
    if (files.length) {
      // The window installer's own definition of "queued": no row by version
      // or by name (or the 55-character truncated name).
      ({ rows: recorded } = await client.query(
        `SELECT version, name FROM supabase_migrations.schema_migrations
          WHERE version = ANY($1::text[]) OR name = ANY($2::text[]) OR name = ANY($3::text[])`,
        [
          files.map((f) => f.slice(0, 14)),
          files.map((f) => f.slice(15, -4)),
          files.map((f) => f.slice(15, -4).slice(0, 55)),
        ]
      ));
    }
    return { found: new Set(rows.map((r) => r.proname)), recorded };
  } catch (err) {
    return { unreadable: `production could not be asked: ${err?.message || err}` };
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  const doors = engineDoors(join(ROOT, 'server', 'src'));
  const names = [...doors.keys()].sort();
  const allow = existsSync(ALLOWLIST) ? JSON.parse(readFileSync(ALLOWLIST, 'utf8')) : {};
  const creators = migrationCreators(ROOT);
  const live = await production(names, creators.map((c) => c.file));

  if (live.unreadable) {
    console.log(
      `::warning title=PR DOORS UNCHECKED::${live.unreadable}. The ${names.length} database functions this pull request's build calls were not checked against production.`
    );
    console.log(`UNCHECKED - ${live.unreadable}.`);
    emit('verdict', 'unchecked');
    emit('reason', live.unreadable);
    return 0;
  }

  const missing = names.filter((n) => !live.found.has(n) && !allow[n]);
  if (missing.length === 0) {
    console.log(
      `OK - all ${names.length} database functions this pull request's build calls exist in production.`
    );
    emit('verdict', 'proved');
    return 0;
  }

  const baseFiles = baseMigrationFiles(BASE_ROOT, BASE_REF);
  if (baseFiles === null) {
    console.log(
      `::warning title=PR DOORS BASE UNREADABLE::${BASE_REF} could not be read, so a migration this pull request ADDS cannot be told apart from one already on main. No door is allowed on that basis.`
    );
  }
  const { refused, allowed, warned, detail, kind } = classifyPrDoors({
    missing,
    creators,
    baseFiles,
    recorded: live.recorded ?? null,
  });

  for (const name of refused) {
    console.log(
      `::error title=MISSING DATABASE DOOR::${name}() is called by ${doors.get(name).join(', ')}, does not exist in production, and no migration in this merge result creates it. Add the migration that creates it (a SUPERSEDED file does not count: it never installs).`
    );
  }
  for (const name of allowed) {
    const files = detail.get(name).join(', ');
    const how =
      kind.get(name) === 'window-in-pr'
        ? `created by ${files}, which this pull request adds and which declares the daily-maintenance window, so it installs inside the next 04:00 America/Chicago break`
        : `created by ${files}, which this pull request adds, so it applies on merge`;
    console.log(
      `::notice title=DOOR ARRIVES WITH THIS PR::${name}() does not exist in production yet. It is ${how}. Not a failure: this pull request carries its own database half.`
    );
  }
  for (const name of warned) {
    const files = detail.get(name).join(', ');
    if (kind.get(name) === 'recorded-but-missing') {
      console.log(
        `::warning title=A RECORDED MIGRATION DID NOT LEAVE ITS DOOR::${name}() is called by ${doors.get(name).join(', ')} and does not exist in production, yet its only creator ${files} is already recorded in schema_migrations. The migration ran and the function is still absent, so this is drift in production, not a gap in this pull request. The engine release will refuse main until it is repaired.`
      );
      continue;
    }
    if (kind.get(name) === 'unknown-base') {
      console.log(
        `::warning title=DOOR UNPROVED::${name}() does not exist in production and is created by ${files}, but the base tree could not be read, so whether this pull request adds that file is unknown.`
      );
      continue;
    }
    const why =
      kind.get(name) === 'window-on-main'
        ? `${files} is already on main, declares the daily-maintenance window, and is NOT yet recorded in schema_migrations, so it can only install inside the 04:00 America/Chicago break`
        : `${files} is already on main and is NOT yet recorded in schema_migrations`;
    console.log(
      `::warning title=MERGING THIS KEEPS MAIN UNSHIPPABLE::${name}() is called by ${doors.get(name).join(', ')} and does not exist in production. ${why}. The engine release will refuse main until that migration installs. Not this pull request's defect, so it does not block the merge - but do not expect a release to ship until ${files} is applied.`
    );
  }

  if (refused.length) {
    console.log(
      `REFUSED - ${refused.length} of ${names.length} database functions this pull request's build calls exist nowhere: not in production and in no migration here.`
    );
    emit('verdict', 'refused');
    emit('refused', refused.join(', '));
    if (allowed.length) emit('allowed', allowed.join(', '));
    if (warned.length) emit('warned', warned.join(', '));
    emit(
      'reason',
      `no migration creates ${refused.slice(0, 6).map((n) => `${n}()`).join(', ')}${refused.length > 6 ? ` +${refused.length - 6} more` : ''}`
    );
    return 1;
  }
  if (warned.length) {
    console.log(
      `WARNED - ${warned.length} of ${names.length} database functions this pull request's build calls are missing in production, and each one is named above with the migration it waits on. Merging is not blocked: this pull request did not cause any of them. Main stays unshippable until those migrations are installed.`
    );
    emit('verdict', 'warned');
    emit('warned', warned.join(', '));
    if (allowed.length) emit('allowed', allowed.join(', '));
    return 0;
  }
  console.log(
    `ALLOWED - ${allowed.length} of ${names.length} database functions this pull request's build calls are missing in production and every one of them is created by a migration this pull request adds.`
  );
  emit('verdict', 'allowed');
  emit('allowed', allowed.join(', '));
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      // This gate is a PR-side early warning, not the last word: the release
      // gate still refuses. A crash here must name itself, not invent a refusal.
      console.log(`::warning title=PR DOORS UNCHECKED::${err?.message || err}`);
      emit('verdict', 'unchecked');
      emit('reason', String(err?.message || err));
      process.exit(0);
    }
  );
}
