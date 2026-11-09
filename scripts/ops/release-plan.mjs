#!/usr/bin/env node
/**
 * ===========================================================================
 *  THE EVENING PLAN: WHAT WOULD TOMORROW'S 04:00 AMERICA/CHICAGO DO?
 * ===========================================================================
 *
 * Owner request 2026-11-07. A read-only report that assembles, in one view,
 * exactly what the daily engine preparation (stage-engine-release.yml, job
 * detect -> signal, "Choose the newest Backup Engine certified main commit")
 * and the window-migrations job would select at 04:00, and why - from the
 * same sources those jobs read, hours before they read them.
 *
 * IT IS A REPORT, NEVER AN ACTION. It performs GET requests only: the live
 * engine's /health, GitHub REST reads (branch tip, first-parent commits,
 * commit statuses, compares, workflow runs) and one SELECT on
 * supabase_migrations.schema_migrations. It never dispatches, cancels, reruns,
 * writes a status, applies a migration, or imports the applier, installer or
 * deploy scripts (tests/the-evening-plan-only-reads.law.test.ts pins that).
 *
 * THE FOUR VERDICTS (CLAUDE.md 10.86: "I could not tell" has its own name):
 *
 *   READY        a Backup-certified main commit newer than the serving engine
 *                exists, it carries engine changes, and every queued window
 *                migration passes the static window rules. 04:00 would offer
 *                that commit and install those files.            exit 0
 *   NOTHING_OWED production already serves the newest engine code on main
 *                (no server/** change between the serving SHA and the tip), or
 *                the newest certified commit is the serving one and nothing
 *                engine-affecting followed it.                   exit 0
 *   NOT_READY    engine commits exist since the serving SHA but no commit
 *                newer than it is certified (04:00 would keep the current
 *                engine), or a queued window migration would be refused by
 *                the static rules before the installer ever waited. exit 1
 *   UNKNOWN      a source could not be read: /health unreadable, GitHub
 *                refused a read (403, rate limit), the served SHA is not in
 *                protected-main history, DATABASE_URL is unset so the queue
 *                cannot be read. An unreadable source is never coerced into
 *                READY or NOTHING_OWED. A definitive blocker (a refused file,
 *                an owed engine with no certificate) is NOT_READY even when
 *                another source is UNKNOWN: it is a known fact.  exit 3
 *
 * WHO READS IT. `node scripts/ops/release-plan.mjs` at any time, from any
 * checkout with a GitHub token in GH_TOKEN or GITHUB_TOKEN (DATABASE_URL and
 * --ssl-root-cert for the queue). evening-release-plan.yml runs it at 20:00
 * America/Chicago on main and fails on NOT_READY or UNKNOWN, so the red-main
 * detector (scripts/ci/check-main-is-green.mjs in
 * production-integrity-audit.yml) is its reader (CLAUDE.md 10.83).
 *
 * Flags: --json (machine-readable to stdout), --summary (append Markdown to
 * $GITHUB_STEP_SUMMARY), --ssl-root-cert <path> (same TLS handling as
 * install-window-migrations.mjs), --walk-cap <n> (first-parent commits to
 * inspect, default 100).
 *
 * Every network reader is injectable (assembleReleasePlan(deps)), so the unit
 * tests run against stubs and never touch GitHub, the engine or a database.
 */
import { readdirSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  declaresMaintenanceWindow,
  validateWindowMigration,
} from '../ci/maintenance-window-migrations.mjs';
import { splitConcurrentPreamble } from '../ci/migration-concurrent-preamble.mjs';
import { supersededBy } from '../ci/check-migrations-are-live.mjs';

export const VERDICTS = Object.freeze({
  READY: 'READY',
  NOTHING_OWED: 'NOTHING_OWED',
  NOT_READY: 'NOT_READY',
  UNKNOWN: 'UNKNOWN',
});
export const EXIT_CODES = Object.freeze({ READY: 0, NOTHING_OWED: 0, NOT_READY: 1, UNKNOWN: 3 });
export const CERTIFIED_CONTEXT = 'backup-engine/certified';
export const DEFAULT_REPO = 'Smarter-Software-PIQ/Smarter-Poker-Club-Arena';
export const DEFAULT_HEALTH_URL = 'https://engine.smarter.poker/health';
export const DEFAULT_WALK_CAP = 100;
export const MIGRATIONS_DIR = 'supabase/migrations';
const SHA = /^[0-9a-f]{40}$/;
const UNKNOWN = 'UNKNOWN';

/** The stage workflow's engine-runtime filter: server/** minus tests, sim, qualification. */
export function isEngineRuntimePath(path) {
  if (!path.startsWith('server/')) return false;
  if (/\.test\.ts$/.test(path)) return false;
  if (path.startsWith('server/sim/') || path.startsWith('server/qualification/')) return false;
  return true;
}
export const isServerPath = (path) => path.startsWith('server/');

function unknown(reason) {
  return { state: UNKNOWN, reason };
}

/** One GitHub REST GET. Never a write: the method is fixed here and nowhere else. */
async function githubGet(deps, path) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'club-arena-release-plan',
  };
  if (deps.token) headers.Authorization = `Bearer ${deps.token}`;
  const url = path.startsWith('http') ? path : `https://api.github.com/${path}`;
  let res;
  try {
    res = await deps.fetch(url, { method: 'GET', headers });
  } catch (e) {
    throw new Error(`GET ${path}: ${e.message}`);
  }
  // 10.86 rule 2: an unreadable answer is never coerced into an empty one.
  if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
  return res.json();
}

async function readProduction(deps) {
  let body;
  try {
    const res = await deps.fetch(deps.healthUrl, {
      method: 'GET',
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
    });
    if (!res.ok) return unknown(`GET ${deps.healthUrl}: HTTP ${res.status}`);
    body = await res.json();
  } catch (e) {
    return unknown(`GET ${deps.healthUrl}: ${e.message}`);
  }
  if (!body || typeof body !== 'object') return unknown('/health is not a JSON object');
  const releaseSha =
    typeof body.releaseSha === 'string' && SHA.test(body.releaseSha) ? body.releaseSha : null;
  const maintenance =
    body.maintenance && typeof body.maintenance === 'object' ? body.maintenance : {};
  return {
    state: 'read',
    releaseSha,
    version: body.version ?? null,
    instanceId: body.instanceId ?? null,
    status: body.status ?? null,
    maintenance: {
      phase: maintenance.phase ?? null,
      schedule: maintenance.schedule ?? null,
      readyForRestart: maintenance.readyForRestart ?? null,
    },
    handsInFlightTotal: body.handsInFlightTotal ?? null,
    humansSeatedTotal: body.humansSeatedTotal ?? null,
    stalledTableCount: body.stalledTableCount ?? null,
    reason: releaseSha ? null : '/health did not report one full lowercase releaseSha',
  };
}

async function readMainTip(deps) {
  try {
    const branch = await githubGet(deps, `repos/${deps.repo}/branches/main`);
    const sha = branch?.commit?.sha;
    if (typeof sha !== 'string' || !SHA.test(sha))
      return unknown('branches/main carried no commit sha');
    return { state: 'read', sha };
  } catch (e) {
    return unknown(e.message);
  }
}

/** Newest backup-engine/certified state for one commit; statuses list newest first. */
async function certifiedState(deps, sha) {
  const statuses = await githubGet(deps, `repos/${deps.repo}/commits/${sha}/statuses?per_page=100`);
  if (!Array.isArray(statuses)) throw new Error(`statuses for ${sha} were not a list`);
  const own = statuses.find((s) => s && s.context === CERTIFIED_CONTEXT);
  return {
    state: own ? String(own.state) : 'missing',
    description: own?.description ?? null,
    targetUrl: own?.target_url ?? null,
    at: own?.updated_at ?? own?.created_at ?? null,
  };
}

/**
 * Walk main's first-parent line from the tip, reading each commit's newest
 * certificate, until the first `success` (the candidate), the serving SHA, or
 * the cap. Every commit walked is reported with its state. The serving commit
 * itself is reported but is never the candidate: a cutover to it is no cutover.
 */
async function walkCertified(deps, tip, servingSha) {
  const walked = [];
  let candidate = null;
  let reachedServing = false;
  const seen = new Map();
  let next = tip;
  try {
    while (walked.length < deps.walkCap && next) {
      if (!seen.has(next)) {
        const list = await githubGet(
          deps,
          `repos/${deps.repo}/commits?sha=${next}&per_page=100&page=1`
        );
        if (!Array.isArray(list) || list.length === 0)
          throw new Error(`commits?sha=${next} returned no commits`);
        for (const c of list) if (c?.sha) seen.set(c.sha, c);
        if (!seen.has(next)) throw new Error(`commits?sha=${next} did not include ${next}`);
      }
      const commit = seen.get(next);
      const cert = await certifiedState(deps, next);
      const isServing = next === servingSha;
      walked.push({
        sha: next,
        subject: String(commit?.commit?.message ?? '').split('\n')[0],
        committedAt: commit?.commit?.committer?.date ?? null,
        certified: cert.state,
        certificate: cert,
        isServing,
      });
      if (isServing) {
        reachedServing = true;
        break;
      }
      if (cert.state === 'success') {
        candidate = next;
        break;
      }
      next = commit?.parents?.[0]?.sha ?? null;
    }
  } catch (e) {
    return { state: UNKNOWN, reason: e.message, walked, candidate: null, reachedServing };
  }
  return {
    state: 'read',
    walked,
    candidate,
    reachedServing,
    capped: !candidate && !reachedServing && walked.length >= deps.walkCap,
  };
}

/** GitHub compare base...head: status, counts, and whether server/** differs. */
async function compareServerTree(deps, base, head) {
  if (base === head)
    return {
      state: 'read',
      status: 'identical',
      aheadBy: 0,
      behindBy: 0,
      commits: [],
      serverFiles: [],
      runtimeFiles: [],
      filesTruncated: false,
    };
  try {
    const cmp = await githubGet(deps, `repos/${deps.repo}/compare/${base}...${head}`);
    const files = Array.isArray(cmp.files) ? cmp.files.map((f) => f.filename) : [];
    const commits = Array.isArray(cmp.commits)
      ? cmp.commits.map((c) => ({
          sha: c.sha,
          subject: String(c?.commit?.message ?? '').split('\n')[0],
        }))
      : [];
    return {
      state: 'read',
      status: cmp.status,
      aheadBy: cmp.ahead_by ?? null,
      behindBy: cmp.behind_by ?? null,
      commits,
      // The compare endpoint lists at most 300 files; past that the list is
      // incomplete and "no server file seen" would be a guess.
      filesTruncated: files.length >= 300,
      serverFiles: files.filter(isServerPath),
      runtimeFiles: files.filter(isEngineRuntimePath),
    };
  } catch (e) {
    return unknown(e.message);
  }
}

/** Which of the commits between serving and tip touched server/** (bounded). */
async function engineCommits(deps, commits) {
  const out = [];
  for (const c of commits.slice(0, deps.walkCap)) {
    try {
      const full = await githubGet(deps, `repos/${deps.repo}/commits/${c.sha}`);
      const files = Array.isArray(full.files) ? full.files.map((f) => f.filename) : [];
      const server = files.filter(isServerPath);
      if (server.length > 0)
        out.push({
          sha: c.sha,
          subject: c.subject,
          serverFiles: server.length,
          runtime: files.some(isEngineRuntimePath),
          filesTruncated: files.length >= 300,
        });
    } catch (e) {
      out.push({ sha: c.sha, subject: c.subject, state: UNKNOWN, reason: e.message });
    }
  }
  return out;
}

async function readBackupLane(deps) {
  try {
    const body = await githubGet(
      deps,
      `repos/${deps.repo}/actions/workflows/backup-engine.yml/runs?per_page=20`
    );
    const runs = body?.workflow_runs;
    if (!Array.isArray(runs)) return unknown('workflow run list unreadable');
    const summary = runs.map((r) => ({
      id: r.id,
      status: r.status,
      conclusion: r.conclusion ?? null,
      event: r.event,
      headSha: r.head_sha,
      title: r.display_title ?? r.name ?? null,
      createdAt: r.created_at,
      updatedAt: r.updated_at ?? null,
      url: r.html_url ?? null,
    }));
    const lastRefresh =
      summary.find((r) => r.event === 'workflow_run' && r.conclusion === 'success') ?? null;
    return {
      state: 'read',
      runs: summary,
      active: summary.filter((r) => r.status !== 'completed'),
      lastSuccessfulPostSealRefresh: lastRefresh,
      // The standby's restore stamp lives in /var/lib/club-arena-standby on the
      // host and in the refresh job's log, neither of which REST exposes; a
      // job summary is not readable through the API either. Say so.
      cloneStamp: { state: UNKNOWN, reason: 'not exposed by the workflow runs API' },
    };
  } catch (e) {
    return unknown(e.message);
  }
}

/** The declared window migrations on this checkout, each statically validated. */
export function declaredWindowMigrations(dir) {
  const dirFiles = readdirSync(dir);
  const out = [];
  for (const f of dirFiles.filter((n) => /^\d{14}_[a-z0-9_]+\.sql$/.test(n)).sort()) {
    const sql = readFileSync(join(dir, f), 'utf8');
    if (!declaresMaintenanceWindow(sql)) continue;
    const by = supersededBy(sql, dirFiles);
    if (by) {
      out.push({ file: f, superseded: by, valid: null, refusal: null });
      continue;
    }
    let refusal = null;
    try {
      const shape = splitConcurrentPreamble(sql);
      if (!shape.ok) throw new Error(`${f}: ${shape.reason}`);
      validateWindowMigration(f, sql, { preamble: shape.indexes });
    } catch (e) {
      refusal = e.message;
    }
    out.push({ file: f, superseded: null, valid: refusal === null, refusal });
  }
  return out;
}

async function readQueue(deps, declared, includeInstalled) {
  const candidates = declared.filter((d) => !d.superseded);
  if (candidates.length === 0 && !includeInstalled)
    return { state: 'read', queued: [], recorded: [], note: 'no migration declares the window' };
  if (!deps.databaseUrl)
    return unknown('DATABASE_URL is not set; the queue cannot be read (not "0 queued")');
  let connectionURL;
  try {
    connectionURL = new URL(deps.databaseUrl);
  } catch {
    return unknown('configured database connection syntax is invalid');
  }
  const ssl = { rejectUnauthorized: true };
  if (deps.sslRootCert && deps.sslRootCert !== 'system') {
    try {
      ssl.ca = readFileSync(deps.sslRootCert, 'utf8');
    } catch {
      return unknown('configured provider CA certificate is unavailable');
    }
  }
  for (const key of ['sslmode', 'ssl', 'sslrootcert']) connectionURL.searchParams.delete(key);
  let client;
  try {
    client = await deps.createPgClient({
      connectionString: connectionURL.toString(),
      ssl,
      application_name: 'release-plan',
      statement_timeout: 5000,
    });
    await client.connect();
    const { rows } = await client.query(
      `SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version, name`
    );
    const versions = new Set(rows.map((r) => r.version));
    const names = new Set(rows.map((r) => r.name));
    const queued = candidates.filter((d) => {
      const slug = d.file.slice(15, -4);
      return (
        !versions.has(d.file.slice(0, 14)) && !names.has(slug) && !names.has(slug.slice(0, 55))
      );
    });
    return {
      state: 'read',
      queued,
      ...(includeInstalled ? { installedRows: rows.map((r) => [r.version, r.name]) } : {}),
      recorded: candidates.filter((d) => !queued.includes(d)).map((d) => d.file),
    };
  } catch (e) {
    return unknown(`could not read schema_migrations: ${e.message}`);
  } finally {
    if (client) await client.end().catch(() => {});
  }
}

/**
 * Decide the verdict from what was read. Definitive blockers win over
 * UNKNOWN; UNKNOWN wins over READY and NOTHING_OWED.
 */
export function decide(plan) {
  const reasons = [];
  const unknowns = [];
  const blockers = [];
  const { production, mainTip, walk, sinceServing, candidateDiff, backupLane, queue } = plan;

  if (production.state === UNKNOWN) unknowns.push(`production: ${production.reason}`);
  else if (!production.releaseSha) unknowns.push(`production: ${production.reason}`);
  if (mainTip.state === UNKNOWN) unknowns.push(`main tip: ${mainTip.reason}`);
  if (backupLane.state === UNKNOWN) unknowns.push(`backup lane: ${backupLane.reason}`);

  // The queue: a statically refused file is a blocker now, not at 04:00.
  for (const d of plan.declared)
    if (d.valid === false)
      blockers.push(`window migration \`${d.file}\` would be refused: ${d.refusal}`);
  if (queue.state === UNKNOWN) unknowns.push(`window migration queue: ${queue.reason}`);
  else if (queue.queued.length === 0) reasons.push(queue.note ?? 'no window migration is queued');
  else
    reasons.push(
      `${queue.queued.length} window migration(s) queued: ${queue.queued.map((q) => `\`${q.file}\``).join(', ')}`
    );

  let engineOwed = null; // true, false, or null when it could not be told
  if (sinceServing) {
    if (sinceServing.state === UNKNOWN)
      unknowns.push(`serving..main compare: ${sinceServing.reason}`);
    else if (sinceServing.status === 'identical') {
      engineOwed = false;
      reasons.push('production serves the main tip');
    } else if (sinceServing.status !== 'ahead') {
      unknowns.push(
        `the serving engine ${production.releaseSha} is not an ancestor of main (compare status ${sinceServing.status}); what is owed cannot be told`
      );
    } else if (sinceServing.serverFiles.length > 0) {
      engineOwed = true;
      reasons.push(
        `${sinceServing.serverFiles.length} server/** file(s) differ between the serving engine and the main tip (${sinceServing.aheadBy} commit(s))`
      );
    } else if (sinceServing.filesTruncated) {
      unknowns.push(
        'the serving..main diff exceeds 300 files; whether server/** changed cannot be told'
      );
    } else {
      engineOwed = false;
      reasons.push(
        `no server/** file differs between the serving engine and the main tip (${sinceServing.aheadBy} commit(s))`
      );
    }
  }

  let candidate = null;
  if (walk) {
    if (walk.state === UNKNOWN) unknowns.push(`certificate walk: ${walk.reason}`);
    else {
      candidate = walk.candidate;
      if (candidate)
        reasons.push(`newest Backup-certified main commit newer than production: ${candidate}`);
      else if (walk.reachedServing)
        reasons.push('no commit newer than the serving engine is Backup-certified');
      else if (walk.capped)
        unknowns.push(
          `no certified commit in the first ${walk.walked.length} commits and the serving SHA was not reached`
        );
    }
  }

  if (candidate && candidateDiff) {
    if (candidateDiff.state === UNKNOWN)
      unknowns.push(`serving..candidate compare: ${candidateDiff.reason}`);
    else if (
      candidateDiff.serverFiles.length === 0 &&
      !candidateDiff.filesTruncated &&
      engineOwed === true
    ) {
      blockers.push(
        `the certified candidate ${candidate} carries no server/** change over the serving engine; the owed engine commits are newer and uncertified`
      );
      candidate = null;
    }
  }

  if (engineOwed === true && !candidate && walk?.state === 'read' && walk.reachedServing)
    blockers.push(
      'engine commits exist since the serving SHA but none newer than it is Backup-certified; 04:00 would keep the current engine'
    );

  const schema = plan.backupReadiness;
  if (candidate && schema && engineOwed !== false) {
    if (schema.state === 'mismatch' || schema.candidateMissingInProduction?.length)
      blockers.push(
        `candidate ${candidate} lacks matching installed migration evidence (Backup run ${schema.certificateRunId ?? UNKNOWN})`
      );
    else if (schema.state === UNKNOWN)
      unknowns.push(`candidate migration evidence: ${schema.reason}`);
  }

  let verdict;
  if (blockers.length > 0) verdict = VERDICTS.NOT_READY;
  else if (unknowns.length > 0) verdict = VERDICTS.UNKNOWN;
  else if (engineOwed === false) verdict = VERDICTS.NOTHING_OWED;
  else if (engineOwed === true && candidate) verdict = VERDICTS.READY;
  else {
    verdict = VERDICTS.UNKNOWN;
    unknowns.push('the sources did not combine into a decision');
  }
  return {
    verdict,
    exitCode: EXIT_CODES[verdict],
    reasons,
    unknowns,
    blockers,
    candidate,
    engineOwed,
  };
}

export async function assembleReleasePlan(options = {}) {
  const deps = {
    fetch: options.fetch ?? globalThis.fetch,
    token: options.token ?? process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? '',
    repo: options.repo ?? process.env.GITHUB_REPOSITORY ?? DEFAULT_REPO,
    healthUrl: options.healthUrl ?? DEFAULT_HEALTH_URL,
    migrationsDir: options.migrationsDir ?? MIGRATIONS_DIR,
    databaseUrl: options.databaseUrl ?? process.env.DATABASE_URL ?? '',
    sslRootCert: options.sslRootCert ?? process.env.PGSSLROOTCERT ?? 'system',
    createPgClient: options.createPgClient ?? defaultPgClient,
    walkCap: options.walkCap ?? DEFAULT_WALK_CAP,
    now: options.now ?? (() => new Date()),
  };
  const generatedAt = deps.now().toISOString();
  const [production, mainTip, backupLane] = await Promise.all([
    readProduction(deps),
    readMainTip(deps),
    readBackupLane(deps),
  ]);
  const declared = declaredWindowMigrations(deps.migrationsDir);
  const queue = await readQueue(deps, declared, options.includeInstalled === true);

  let walk = null;
  let sinceServing = null;
  let candidateDiff = null;
  let engineCommitsSinceServing = [];
  if (mainTip.state === 'read') {
    walk = await walkCertified(deps, mainTip.sha, production.releaseSha ?? null);
    if (production.releaseSha) {
      sinceServing = await compareServerTree(deps, production.releaseSha, mainTip.sha);
      if (sinceServing.state === 'read' && sinceServing.status === 'ahead')
        engineCommitsSinceServing = await engineCommits(deps, sinceServing.commits);
      if (walk.candidate)
        candidateDiff = await compareServerTree(deps, production.releaseSha, walk.candidate);
    }
  }
  const plan = {
    generatedAt,
    repo: deps.repo,
    production,
    mainTip,
    walk,
    sinceServing,
    engineCommitsSinceServing,
    candidateDiff,
    backupLane,
    declared,
    queue,
  };
  plan.decision = decide(plan);
  return plan;
}

async function defaultPgClient(config) {
  const { default: pg } = await import('pg');
  const client = new pg.Client(config);
  client.on('error', () => {});
  return client;
}

const short = (sha) => (typeof sha === 'string' ? sha.slice(0, 10) : String(sha));

export function renderMarkdown(plan) {
  const d = plan.decision;
  const p = plan.production;
  const lines = [];
  lines.push(`### Evening release plan: ${d.verdict}`);
  lines.push('');
  lines.push(
    `Generated ${plan.generatedAt}. What tomorrow's 04:00 America/Chicago preparation would select, read now.`
  );
  lines.push('');
  lines.push('#### Production');
  if (p.state === UNKNOWN) lines.push(`- UNKNOWN: ${p.reason}`);
  else {
    lines.push(
      `- serving \`${p.releaseSha ?? UNKNOWN}\` (version ${p.version ?? 'n/a'}, instance ${p.instanceId ?? 'n/a'}, status ${p.status ?? 'n/a'})`
    );
    lines.push(
      `- maintenance phase ${p.maintenance.phase ?? 'n/a'}, schedule ${JSON.stringify(p.maintenance.schedule)}, readyForRestart ${p.maintenance.readyForRestart}`
    );
    lines.push(
      `- handsInFlightTotal ${p.handsInFlightTotal}, humansSeatedTotal ${p.humansSeatedTotal}, stalledTableCount ${p.stalledTableCount}`
    );
  }
  lines.push('');
  lines.push('#### Owed target');
  lines.push(
    `- main tip: ${plan.mainTip.state === UNKNOWN ? `UNKNOWN (${plan.mainTip.reason})` : `\`${plan.mainTip.sha}\``}`
  );
  if (plan.sinceServing) {
    const s = plan.sinceServing;
    lines.push(
      s.state === UNKNOWN
        ? `- serving..main: UNKNOWN (${s.reason})`
        : `- serving..main: ${s.status}, ${s.aheadBy} commit(s), ${s.serverFiles.length} server/** file(s), ${s.runtimeFiles.length} engine-runtime file(s)${s.filesTruncated ? ', file list truncated at 300' : ''}`
    );
  }
  for (const c of plan.engineCommitsSinceServing)
    lines.push(
      c.state === UNKNOWN
        ? `  - \`${short(c.sha)}\` ${c.subject} (files UNKNOWN: ${c.reason})`
        : `  - \`${short(c.sha)}\` ${c.subject} (${c.serverFiles} server file(s)${c.runtime ? ', engine runtime' : ', not runtime'})`
    );
  lines.push(`- certified candidate: ${d.candidate ? `\`${d.candidate}\`` : 'none'}`);
  if (plan.walk) {
    if (plan.walk.state === UNKNOWN)
      lines.push(`- certificate walk: UNKNOWN (${plan.walk.reason})`);
    lines.push('- first-parent walk from the tip (newest certificate per commit):');
    for (const w of plan.walk.walked)
      lines.push(
        `  - \`${short(w.sha)}\` ${w.certified}${w.isServing ? ' (serving)' : ''}${w.sha === d.candidate ? ' (candidate)' : ''}: ${w.subject}`
      );
  }
  lines.push('');
  const readiness = plan.backupReadiness;
  if (readiness) {
    lines.push('#### Migration readiness for the 03:30 Chicago cutoff');
    lines.push(
      `- Certificate for target \`${readiness.targetSha ?? UNKNOWN}\`: ${readiness.certificateUrl ?? UNKNOWN}; workflow head \`${readiness.workflowHead ?? UNKNOWN}\`.`
    );
    lines.push(
      `- Installed migration comparison: ${readiness.state}${readiness.reason ? ' (' + readiness.reason + ')' : ''}.`
    );
    for (const [key, label] of [
      ['candidateMissingInProduction', 'Required by candidate, missing in production'],
      ['missingInBackup', 'Installed in production, missing in Backup'],
      ['extraInBackup', 'Extra in Backup'],
      ['renamedInBackup', 'Name differs in Backup'],
    ]) {
      for (const row of (readiness[key] ?? []).slice(0, 10))
        lines.push(
          `- ${label}: \`${typeof row === 'string' ? row : row.version + '_' + row.name}\`.`
        );
    }
    const t = readiness.timing;
    if (t) {
      lines.push(
        `- Next cutoff: ${t.cutoffUtc}; executing Backup run: ${t.runUrl ?? UNKNOWN}; actual target: \`${t.targetSha ?? UNKNOWN}\`.`
      );
      lines.push(
        t.state === 'estimated'
          ? `- Estimated Backup completion: ${t.estimatedFinishUtc} (${Math.abs(t.marginMinutes)} min ${t.marginMinutes >= 0 ? 'before' : 'after'} cutoff), from ${t.samples.length} measured physical run(s): ${t.samples.map((s) => s.runId + ' (' + Math.round(s.seconds / 60) + ' min)').join(', ')}.`
          : `- Estimated Backup completion: UNKNOWN (${t.reason}).`
      );
    }
    lines.push('');
  }
  lines.push('#### Backup lane');
  if (plan.backupLane.state === UNKNOWN) lines.push(`- UNKNOWN: ${plan.backupLane.reason}`);
  else {
    const b = plan.backupLane;
    lines.push(
      `- active runs: ${b.active.length}; standby clone stamp: ${b.cloneStamp.state} (${b.cloneStamp.reason})`
    );
    if (b.lastSuccessfulPostSealRefresh)
      lines.push(
        `- last successful post-seal refresh run: ${b.lastSuccessfulPostSealRefresh.createdAt} for \`${short(b.lastSuccessfulPostSealRefresh.headSha)}\``
      );
    for (const r of b.runs.slice(0, 10))
      lines.push(
        `  - ${r.status}${r.conclusion ? `/${r.conclusion}` : ''} ${r.event} \`${short(r.headSha)}\` ${r.createdAt} ${r.title ?? ''}`
      );
  }
  lines.push('');
  lines.push('#### Window migrations');
  if (plan.declared.length === 0)
    lines.push('- no migration declares `-- @install-window: daily-maintenance`');
  for (const m of plan.declared)
    lines.push(
      m.superseded
        ? `- \`${m.file}\`: superseded by ${m.superseded}, never installed`
        : `- \`${m.file}\`: ${m.valid ? 'validates' : `WOULD BE REFUSED: ${m.refusal}`}`
    );
  lines.push(
    plan.queue.state === UNKNOWN
      ? `- queue: UNKNOWN (${plan.queue.reason})`
      : `- queued (declared, not in schema_migrations): ${plan.queue.queued.length}; recorded: ${plan.queue.recorded.length}`
  );
  lines.push('');
  lines.push('#### Verdict');
  lines.push(`- **${d.verdict}** (exit ${d.exitCode})`);
  for (const r of d.reasons) lines.push(`- ${r}`);
  for (const b of d.blockers) lines.push(`- BLOCKER: ${b}`);
  for (const u of d.unknowns) lines.push(`- UNKNOWN: ${u}`);
  lines.push('');
  return lines.join('\n');
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const flag = (n) => {
    const i = argv.indexOf(n);
    return i === -1 ? null : argv[i + 1] || null;
  };
  const snapshot = flag('--snapshot');
  const input = flag('--input');
  const plan = input
    ? JSON.parse(readFileSync(input, 'utf8'))
    : await assembleReleasePlan({
        includeInstalled: Boolean(snapshot),
        sslRootCert: flag('--ssl-root-cert') ?? env.PGSSLROOTCERT ?? 'system',
        walkCap: flag('--walk-cap') ? Number(flag('--walk-cap')) : undefined,
        healthUrl: flag('--health-url') ?? undefined,
      });
  if (snapshot) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(snapshot, JSON.stringify(plan));
    return 0;
  }
  if (input) {
    delete plan.queue.installedRows;
    try {
      plan.backupReadiness = JSON.parse(readFileSync(flag('--readiness'), 'utf8'));
    } catch {
      plan.backupReadiness = unknown('Backup readiness report unavailable');
    }
    plan.decision = decide(plan);
  }
  const markdown = renderMarkdown(plan);
  if (argv.includes('--json')) console.log(JSON.stringify(plan, null, 2));
  else console.log(markdown);
  if (argv.includes('--summary') && env.GITHUB_STEP_SUMMARY)
    appendFileSync(env.GITHUB_STEP_SUMMARY, markdown + '\n');
  const out = flag('--json-out');
  if (out) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(out, JSON.stringify(plan, null, 2));
  }
  return plan.decision.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(`[release-plan] UNKNOWN: ${e.stack || e.message}`);
      process.exit(EXIT_CODES.UNKNOWN);
    }
  );
}
