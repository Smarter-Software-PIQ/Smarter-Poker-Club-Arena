#!/usr/bin/env node
/**
 * A MIGRATION MERGES ONLY INSIDE ITS INSTALL WINDOW (2026-11-26, Antigravity Coordinator).
 *
 * The merge dispatcher holds an ordinary migration merged inside an engine
 * cycle hold or the nightly release schema freeze, and the applier refuses a
 * hand install there (release-freeze-admission.mjs). Holding is not enough:
 * the merge itself puts an uninstalled migration on main, and every Backup
 * candidate built from main after it "lacks an installed migration" until the
 * dispatcher's next window. On 2026-11-25 #12035 merged at 22:54 Chicago, the
 * freeze kept it uninstalled to 04:15, backup-engine.yml refused every later
 * commit and the 01:00 cycle kept serving. Nothing stopped the merge except the
 * merger's memory.
 *
 * The merge is now held to the same windows the applier admits, as the required
 * commit status "Migration merge window" on every open pull request into main:
 *   - no ordinary migration added or changed (a daily-maintenance window file
 *     installs in the 04:00 break by design): success, always;
 *   - an ordinary migration, and releaseFreezeAdmission admits now AND three
 *     minutes from now (a merge in flight still lands inside): success;
 *   - the label "migration-outage-override" plus a body line
 *     "Outage override: <at least 20 characters naming the outage>": success,
 *     the justification is printed in the status;
 *   - anything else: failure, naming when the next window opens.
 * The status flips with the clock. GitHub's schedule is not a clock on this
 * repository (2026-11-26: an hourly audit ran 4 times in 29 hours), so no
 * window depends on it. Every run that finds a window open, or opening within
 * 25 minutes, HOLDS it: it re-sweeps every minute and closes it itself when it
 * ends. Every push to main (merges land many times an hour) holds every pull
 * request when a window is near (pushAction). Any pull request event (push,
 * label, edit) holds its own pull request; `gh workflow run migration-merge-window.yml -f mode=keep`
 * holds it for all of them, and the failure text says so. The :10 keeper and
 * :40 sweep remain as best-effort backstops. A status this cannot compute (a
 * file it cannot read) is failure: it fails closed.
 *
 * One rule: the windows are releaseFreezeAdmission's, never a second copy.
 *
 * A RELEASE-CONTROL CHANGE MERGES IN THE SAME WINDOW (2026-11-26, release
 * custody). A merge that changes one file of the release-control projection
 * (scripts/ci/read-engine-prequalification.py CONTROL_INPUTS, minus its
 * exclusions) makes every existing Backup certificate unselectable, exactly as
 * an installed migration does, and a new certificate takes about an hour. That
 * cost two cycles in two days (O27 merged 22:50 Chicago on 11-25; the O31
 * batch at 12:40 on 11-26), each time against a written rule nothing enforced. A pull request that changes a projected
 * file is now held by this same required status to the same minutes: the
 * window opens after a cycle's break, when the certificate it would strand has
 * just been used or refused, and leaves the rest of the three hours for the
 * new certificate. Which paths are projected is read from the Python
 * constants themselves (release-control-paths.mjs), never from a copy.
 */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  declaredCutoverCadence,
  releaseFreezeAdmission,
  RELEASE_FREEZE_OVERRIDE_MIN_LENGTH,
} from './release-freeze-admission.mjs';
import { windowDeclaration } from './maintenance-window-migrations.mjs';
import { controlLists, releaseControlChanges } from './release-control-paths.mjs';

export const MERGE_WINDOW_CONTEXT = 'Migration merge window';
export const MERGE_WINDOW_OVERRIDE_LABEL = 'migration-outage-override';
export const MERGE_IN_FLIGHT_MARGIN_MINUTES = 3;
export const KEEPER_HORIZON_MINUTES = 25;
export const KEEPER_MAX_MINUTES = 40;
const MIGRATION_PATH = /^supabase\/migrations\/[^/]+\.sql$/;
const OVERRIDE_LINE = /^\s*Outage override:\s*(.+?)\s*$/im;
const MINUTE = 60_000;

const chicago = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  hour: 'numeric',
  minute: '2-digit',
});
export const chicagoTime = (ms) => `${chicago.format(new Date(ms))} CST`;

/** True when an ordinary migration may merge at nowMs (the applier admits now and through the in-flight margin). */
export function mergeWindowOpen(nowMs, cadence) {
  const admits = (ms) => releaseFreezeAdmission({ nowMs: ms, cadence }).admit === true;
  return admits(nowMs) && admits(nowMs + MERGE_IN_FLIGHT_MARGIN_MINUTES * MINUTE);
}

/** The first whole minute at or after nowMs when the merge window is open, within a day; null if none. */
export function nextMergeWindow(nowMs, cadence) {
  const start = Math.ceil(nowMs / MINUTE) * MINUTE;
  for (let t = start; t <= start + 24 * 60 * MINUTE; t += MINUTE) {
    if (mergeWindowOpen(t, cadence)) return t;
  }
  return null;
}

/** The last minute of the window open at nowMs (the status must be failure from the minute after). */
export function mergeWindowCloses(nowMs, cadence) {
  let t = Math.floor(nowMs / MINUTE) * MINUTE;
  while (mergeWindowOpen(t + MINUTE, cadence)) t += MINUTE;
  return t + MINUTE;
}

export const RECENT_CLOSE_MINUTES = 15;

/**
 * What a push to main does (2026-11-26). Merges land many times an hour, so a
 * push is the one event that reliably arrives near every window: 'keep' when a
 * window is open or opens within the keeper horizon; 'sweep' when one closed in
 * the last RECENT_CLOSE_MINUTES (a newer push may have cancelled the keeper
 * that was about to close it); otherwise 'none', and the run ends in seconds.
 */
export function pushAction(nowMs, cadence) {
  const next = nextMergeWindow(nowMs, cadence);
  if (next !== null && next - nowMs <= KEEPER_HORIZON_MINUTES * MINUTE) return 'keep';
  const start = Math.floor(nowMs / MINUTE) * MINUTE;
  for (let t = start - RECENT_CLOSE_MINUTES * MINUTE; t < start; t += MINUTE) {
    if (mergeWindowOpen(t, cadence)) return 'sweep';
  }
  return 'none';
}

/** The written outage justification, when the label and a long enough body line are both present. */
export function outageOverride(labels, body) {
  if (!Array.isArray(labels) || !labels.includes(MERGE_WINDOW_OVERRIDE_LABEL)) return null;
  const why = String(body ?? '').match(OVERRIDE_LINE)?.[1]?.trim() ?? '';
  return why.length >= RELEASE_FREEZE_OVERRIDE_MIN_LENGTH ? why : null;
}

/**
 * The ordinary migrations among a pull request's files. `files` are
 * { path, changeType, sql } where sql is the head's text (undefined when it
 * could not be read). A file that cannot be read or classified counts as
 * ordinary: unknown is held.
 */
export function ordinaryMigrations(files) {
  return (files ?? [])
    .filter((f) => MIGRATION_PATH.test(f.path) && f.changeType !== 'DELETED')
    .filter((f) => {
      if (typeof f.sql !== 'string') return true;
      try {
        return windowDeclaration(f.sql) !== 'daily-maintenance';
      } catch {
        return true;
      }
    })
    .map((f) => f.path);
}

/** The status for one pull request at nowMs: { state: 'success'|'failure', description } (description <= 140 chars). */
export function mergeWindowVerdict({ nowMs, cadence, baseRef, files, labels, body, lists = controlLists() }) {
  if (!Number.isFinite(nowMs)) throw new Error('nowMs must be a finite epoch millisecond');
  const cut = (s) => (s.length <= 140 ? s : `${s.slice(0, 137)}...`);
  if (baseRef !== 'main') return { state: 'success', description: 'Not a pull request into main' };
  const ordinary = ordinaryMigrations(files);
  const controls = releaseControlChanges(files, lists);
  if (ordinary.length === 0 && controls.length === 0) {
    return { state: 'success', description: 'No ordinary migration in this pull request' };
  }
  if (mergeWindowOpen(nowMs, cadence)) {
    const closes = mergeWindowCloses(nowMs, cadence);
    return { state: 'success', description: cut(`Install window open: merge before ${chicagoTime(closes)}`) };
  }
  const why = outageOverride(labels, body);
  if (why) return { state: 'success', description: cut(`Outage override: ${why}`) };
  const next = nextMergeWindow(nowMs, cadence);
  // A control-only pull request says so; with a migration the migration text
  // stands (merge-window-watch.mjs reads these openings).
  const held = ordinary.length === 0 ? 'Release controls merge' : 'Migrations merge';
  return {
    state: 'failure',
    description: cut(
      `${held} 10-27 min after a cycle or 4:15-4:27 AM` +
        (next === null ? '' : `; next ${chicagoTime(next)}`) +
        `. Open: gh workflow run migration-merge-window.yml -f mode=keep`
    ),
  };
}

// -- GitHub runner ------------------------------------------------------------
function gh(args, input) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    input,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

// A head's files never change, so a keeper reads them once per head (2026-11-26):
// its first pass uses the full query, every later minute the slim one (no
// files), and only a head it has not seen costs a file read. 369 open pull
// requests made each minute of a window cost ten file-heavy pages.
const filesByHead = new Map();
const PR_FIELDS_SLIM = `number state headRefOid baseRefName body
  labels(first:30){nodes{name}}
  commits(last:1){nodes{commit{status{contexts{context state description}}}}}`;

const PR_QUERY = `query($owner:String!,$name:String!,$after:String,$number:Int!,$one:Boolean!){
  repository(owner:$owner,name:$name){
    single: pullRequest(number:$number) @include(if:$one){ ...pr }
    pullRequests(states:OPEN,first:40,after:$after) @skip(if:$one){
      pageInfo{hasNextPage endCursor}
      nodes{ ...pr }
    }
  }
}
fragment pr on PullRequest{
  number state headRefOid baseRefName body
  labels(first:30){nodes{name}}
  files(first:100){totalCount nodes{path changeType}}
  commits(last:1){nodes{commit{status{contexts{context state description}}}}}
}`;

function readPullRequests(repo, number, slim = false) {
  const [owner, name] = repo.split('/');
  const out = [];
  let after = null;
  const query = slim
    ? PR_QUERY.replace('first:40', 'first:100').replace(/fragment pr on PullRequest\{[\s\S]*\}$/, `fragment pr on PullRequest{\n  ${PR_FIELDS_SLIM}\n}`)
    : PR_QUERY;
  for (;;) {
    const args = ['api', 'graphql', '-f', `query=${query}`, '-F', `owner=${owner}`, '-F', `name=${name}`];
    args.push('-F', `number=${number ?? 0}`, '-F', `one=${number ? 'true' : 'false'}`);
    if (after) args.push('-F', `after=${after}`);
    const data = JSON.parse(gh(args)).data.repository;
    if (number) {
      if (data.single && data.single.state === 'OPEN') out.push(data.single);
      return out;
    }
    out.push(...data.pullRequests.nodes);
    if (!data.pullRequests.pageInfo.hasNextPage) return out;
    after = data.pullRequests.pageInfo.endCursor;
  }
}

function allFiles(repo, pr) {
  const known = filesByHead.get(pr.headRefOid);
  if (known) return known;
  let files;
  if (pr.files && pr.files.totalCount <= pr.files.nodes.length) {
    files = pr.files.nodes;
  } else {
    const rows = JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${repo}/pulls/${pr.number}/files?per_page=100`]));
    const map = { added: 'ADDED', removed: 'DELETED', modified: 'MODIFIED', renamed: 'RENAMED', copied: 'COPIED', changed: 'CHANGED' };
    files = rows.flat().map((f) => ({
      path: f.filename,
      changeType: map[f.status] ?? 'CHANGED',
      ...(f.previous_filename ? { previousPath: f.previous_filename } : {}),
    }));
  }
  filesByHead.set(pr.headRefOid, files);
  return files;
}

/** True once a pass has read every open pull request in full, so later passes may use the slim query. */
export const sweepState = { fullPassDone: false };

const textCache = new Map();
function headText(repo, sha, path) {
  const key = `${sha}:${path}`;
  if (!textCache.has(key)) {
    let text;
    try {
      text = gh(['api', '-H', 'Accept: application/vnd.github.raw', `repos/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}?ref=${sha}`]);
    } catch {
      text = undefined; // unreadable counts as ordinary: held
    }
    textCache.set(key, text);
  }
  return textCache.get(key);
}

function currentStatus(pr) {
  const contexts = pr.commits?.nodes?.[0]?.commit?.status?.contexts ?? [];
  return contexts.find((c) => c.context === MERGE_WINDOW_CONTEXT) ?? null;
}

/** Sweeps every open pull request (or one); writes a status only where it changed. Returns the verdicts. */
export function sweep({ repo, number = null, nowMs = Date.now(), cadence = declaredCutoverCadence(), targetUrl, log = console.log }) {
  const results = [];
  const slim = number === null && sweepState.fullPassDone;
  for (const pr of readPullRequests(repo, number, slim)) {
    let verdict;
    try {
      const files = allFiles(repo, pr).map((f) =>
        MIGRATION_PATH.test(f.path) && f.changeType !== 'DELETED'
          ? { ...f, sql: headText(repo, pr.headRefOid, f.path) }
          : f
      );
      verdict = mergeWindowVerdict({
        nowMs,
        cadence,
        baseRef: pr.baseRefName,
        files,
        labels: pr.labels.nodes.map((l) => l.name),
        body: pr.body,
      });
    } catch (error) {
      verdict = { state: 'failure', description: `Merge window could not be computed: ${String(error?.message ?? error).slice(0, 90)}` };
    }
    const now = currentStatus(pr);
    const changed = !now || now.state.toLowerCase() !== verdict.state || now.description !== verdict.description;
    if (changed) {
      const args = ['api', '-X', 'POST', `repos/${repo}/statuses/${pr.headRefOid}`, '-f', `state=${verdict.state}`, '-f', `context=${MERGE_WINDOW_CONTEXT}`, '-f', `description=${verdict.description}`];
      if (targetUrl) args.push('-f', `target_url=${targetUrl}`);
      gh(args);
    }
    log(`#${pr.number} ${pr.headRefOid.slice(0, 12)} ${verdict.state}${changed ? '' : ' (unchanged)'}: ${verdict.description}`);
    results.push({ number: pr.number, ...verdict, changed });
  }
  if (number === null) sweepState.fullPassDone = true;
  return results;
}

/** Keeper: sweeps every minute while a window is open or opens within the horizon, then a closing sweep. */
export async function keep({ repo, number = null, cadence = declaredCutoverCadence(), targetUrl, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = console.log }) {
  const started = now();
  const next = nextMergeWindow(started, cadence);
  if (next === null || next - started > KEEPER_HORIZON_MINUTES * MINUTE) {
    log(`No merge window opens within ${KEEPER_HORIZON_MINUTES} minutes; one sweep.`);
    return sweep({ repo, number, nowMs: started, cadence, targetUrl, log });
  }
  const closes = mergeWindowCloses(Math.max(next, started), cadence);
  log(`Merge window ${chicagoTime(next)} to ${chicagoTime(closes)}; keeping it.`);
  for (;;) {
    const t = now();
    sweep({ repo, number, nowMs: t, cadence, targetUrl, log });
    if (t >= closes || t - started > KEEPER_MAX_MINUTES * MINUTE) break;
    const wait = Math.min(MINUTE - (t % MINUTE) + 2_000, Math.max(closes - t, 1_000));
    await sleep(wait);
  }
  log('Window closed; closing sweep done.');
  return true;
}

async function main(argv) {
  const [mode, ...rest] = argv;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error('GITHUB_REPOSITORY is required');
  const targetUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : undefined;
  if (mode === 'sweep') {
    const i = rest.indexOf('--pr');
    const number = i >= 0 ? Number(rest[i + 1]) : null;
    if (i >= 0 && !Number.isInteger(number)) throw new Error('--pr needs a pull request number');
    sweep({ repo, number, targetUrl });
    return;
  }
  if (mode === 'on-push') {
    const action = pushAction(Date.now(), declaredCutoverCadence());
    console.log(`push: ${action}`);
    if (action === 'keep') await keep({ repo, targetUrl });
    if (action === 'sweep') sweep({ repo, targetUrl });
    return;
  }
  if (mode === 'keep') {
    const i = rest.indexOf('--pr');
    const number = i >= 0 ? Number(rest[i + 1]) : null;
    if (i >= 0 && !Number.isInteger(number)) throw new Error('--pr needs a pull request number');
    await keep({ repo, number, targetUrl });
    return;
  }
  throw new Error('usage: migration-merge-window.mjs sweep [--pr N] | keep [--pr N] | on-push');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`[migration-merge-window] ${error?.stack ?? error}`);
    process.exit(1);
  });
}
