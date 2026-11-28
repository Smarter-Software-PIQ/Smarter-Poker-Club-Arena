#!/usr/bin/env node
/**
 * A MISSED MIGRATION MERGE WINDOW IS PAGED (2026-11-26, Antigravity Coordinator).
 *
 * The required status "Migration merge window" is opened before each install
 * window by an OpenClaw cron on the Mac Studio (ops/openclaw/
 * ca-migration-merge-window-open.json), backed by pushes to main and pull
 * request events. If the Mac is asleep or offline, its gh sign-in expires, or
 * Actions is down, windows silently stop opening and every migration pull
 * request stays unmergeable with nobody told. This watch reads, after a window
 * has closed, whether any database-change pull request whose head existed
 * before the window turned green during it. A window nobody held fires
 * MigrationMergeWindowNotOpened to the production-alerts fleet (addressed by
 * target_task_id); the next held window resolves it. It rides pushes to main
 * and the backstop schedule (never the OpenClaw host it watches) and adds no
 * timer (CLAUDE.md 10.85). A question it cannot answer is said as COULD NOT
 * TELL and never reported as held (CLAUDE.md 10.86).
 *
 * Run:  node scripts/ci/merge-window-watch.mjs verdict   (GitHub reads only; writes needs_db to $GITHUB_OUTPUT)
 *       DATABASE_URL=... node scripts/ci/merge-window-watch.mjs record
 */
import { appendFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { declaredCutoverCadence } from './release-freeze-admission.mjs';
import { MERGE_WINDOW_CONTEXT, chicagoTime, mergeWindowOpen } from './migration-merge-window.mjs';

export const FLEET_TASK_ID = '01a09b86-5ba8-7290-8657-1041f13dd3ca';
export const SOURCE = 'club-arena.migration-merge-window';
export const ALERT_NAME = 'MigrationMergeWindowNotOpened';
export const SETTLE_MINUTES = 3;
export const LOOKBACK_HOURS = 6;
export const CANDIDATES = 3;
export const UNKNOWN = 3;
export const CLOSED = ['verified_fixed', 'historical'];
export const OPENER_JOB = 'OpenClaw cron ca-migration-merge-window-open (openclaw cron runs --id 471acb81-41ba-43cf-ab5c-5008874e1633)';
const MINUTE = 60_000;
const OPEN_TEXT = /^Install window open/;
const MIGRATION_STATUS = /^(Install window open|Migrations merge|Release controls merge|Outage override)/;

/** The most recent window that closed at least SETTLE_MINUTES before nowMs, within LOOKBACK_HOURS: { open, close } or null. */
export function lastClosedWindow(nowMs, cadence) {
  const settled = nowMs - SETTLE_MINUTES * MINUTE;
  let t = Math.floor(settled / MINUTE) * MINUTE;
  const floor = t - LOOKBACK_HOURS * 60 * MINUTE;
  while (t > floor) {
    if (mergeWindowOpen(t, cadence)) {
      let open = t;
      while (mergeWindowOpen(open - MINUTE, cadence)) open -= MINUTE;
      let close = t + MINUTE;
      while (mergeWindowOpen(close, cadence)) close += MINUTE;
      if (close <= settled) return { open, close };
      t = open - MINUTE;
      continue;
    }
    t -= MINUTE;
  }
  return null;
}

/**
 * Held when a candidate head that existed before the window opened carried a
 * success "Install window open" status created inside it. candidates: [{ number,
 * statuses: [{ state, description, created_at }] }] (this context only).
 */
export function windowVerdict(window, candidates) {
  // A DRAFT IS NOT A WITNESS (2026-11-27). The keeper never opens a draft
  // (GitHub will not merge one), so a draft that stays failure through a
  // window says nothing about whether the window was held. Its usual text
  // (DRAFT_HELD) is not a MIGRATION_STATUS and is never sampled; this also
  // drops a draft still carrying an older "Migrations merge" text.
  const list = (Array.isArray(candidates) ? candidates : []).filter((c) => !c.isDraft);
  if (list.length === 0) return 'not-needed';
  const eligible = list.filter((c) => c.statuses.some((s) => Date.parse(s.created_at) < window.open));
  if (eligible.length === 0) return 'could-not-tell';
  const held = eligible.some((c) =>
    c.statuses.some((s) => {
      const at = Date.parse(s.created_at);
      return s.state === 'success' && OPEN_TEXT.test(s.description || '') && at >= window.open && at < window.close;
    })
  );
  return held ? 'held' : 'missed';
}

/** Fire for a missed window (one episode while it stays open), resolve an open episode on a held one. */
export function decide(verdict, window, previous) {
  const reusable = Boolean(previous && previous.status === 'firing' && !CLOSED.includes(previous.investigation_status));
  const span = window ? `${chicagoTime(window.open)} to ${chicagoTime(window.close)}` : null;
  if (verdict === 'missed') {
    return {
      action: 'fire',
      eventKey: reusable ? previous.event_key : `missed:${new Date(window.open).toISOString()}`,
      payload: {
        target_task_id: FLEET_TASK_ID,
        window_opened_at: new Date(window.open).toISOString(),
        window_closed_at: new Date(window.close).toISOString(),
        window_chicago: span,
        effect: 'no migration pull request could merge in this install window',
        check_first: `${OPENER_JOB}; the Mac Studio is awake and online; gh auth status on the Mac; GitHub Actions status`,
        reopen_next: 'gh workflow run migration-merge-window.yml -f mode=keep (up to 25 minutes before a window)',
      },
    };
  }
  if (verdict === 'held' && reusable) {
    return {
      action: 'resolve',
      eventKey: `${previous.event_key}:resolved`,
      payload: { target_task_id: FLEET_TASK_ID, resolves: previous.event_key, held_window_chicago: span },
    };
  }
  return { action: 'none' };
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

const CANDIDATE_QUERY = `query($owner:String!,$name:String!){
  repository(owner:$owner,name:$name){
    pullRequests(states:OPEN,first:60,baseRefName:"main",orderBy:{field:UPDATED_AT,direction:ASC}){
      nodes{ number isDraft commits(last:1){nodes{commit{oid status{context(name:"${MERGE_WINDOW_CONTEXT}"){description}}}}} }
    }
  }
}`;

/** Up to CANDIDATES database-change pull requests (least recently updated first) with this context's status history. */
export function readCandidates(repo) {
  const [owner, name] = repo.split('/');
  const nodes = JSON.parse(gh(['api', 'graphql', '-f', `query=${CANDIDATE_QUERY}`, '-F', `owner=${owner}`, '-F', `name=${name}`]))
    .data.repository.pullRequests.nodes;
  const picks = nodes
    .map((n) => ({ number: n.number, isDraft: Boolean(n.isDraft), commit: n.commits.nodes[0]?.commit }))
    .filter((n) => !n.isDraft && n.commit && MIGRATION_STATUS.test(n.commit.status?.context?.description || ''))
    .slice(0, CANDIDATES);
  return picks.map((p) => {
    const rows = JSON.parse(gh(['api', '--paginate', '--slurp', `repos/${repo}/commits/${p.commit.oid}/statuses?per_page=100`])).flat();
    return {
      number: p.number,
      statuses: rows
        .filter((s) => s.context === MERGE_WINDOW_CONTEXT)
        .map((s) => ({ state: s.state, description: s.description, created_at: s.created_at })),
    };
  });
}

function currentVerdict(repo) {
  const window = lastClosedWindow(Date.now(), declaredCutoverCadence());
  if (!window) return { window: null, verdict: 'none' };
  return { window, verdict: windowVerdict(window, readCandidates(repo)) };
}

async function record(repo) {
  const { window, verdict } = currentVerdict(repo);
  if (verdict !== 'missed' && verdict !== 'held') {
    console.log(`ok    nothing to record (${verdict})`);
    return;
  }
  if (!process.env.DATABASE_URL) {
    console.error('COULD NOT TELL  DATABASE_URL is missing; an unavailable answer is not a pass');
    process.exit(UNKNOWN);
  }
  let Client;
  try {
    ({ Client } = createRequire(process.cwd() + '/')('pg'));
  } catch {
    ({ Client } = createRequire(import.meta.url)('pg'));
  }
  const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  try {
    await db.query("SET statement_timeout = '20s'");
    const { rows: [previous] } = await db.query(
      `SELECT event_key, status, investigation_status FROM public.operational_alert_events
        WHERE source = $1 AND alertname = $2
        ORDER BY last_received_at DESC, id DESC LIMIT 1`, [SOURCE, ALERT_NAME]);
    const outcome = decide(verdict, window, previous);
    if (outcome.action === 'none') {
      console.log(`ok    window ${chicagoTime(window.open)} to ${chicagoTime(window.close)} was held; no open episode`);
      return;
    }
    const status = outcome.action === 'fire' ? 'firing' : 'resolved';
    const severity = outcome.action === 'fire' ? 'warning' : 'info';
    const { rows: [receipt] } = await db.query(
      'SELECT public.fn_record_operational_alert($1,$2,$3,$4,$5,$6::jsonb) AS id',
      [SOURCE, outcome.eventKey, ALERT_NAME, status, severity, JSON.stringify(outcome.payload)]);
    if (!receipt || !(Number(receipt.id) > 0)) throw new Error('operational inbox returned no receipt');
    console.log(`${status}: operational alert ${receipt.id} (${SOURCE}/${ALERT_NAME}) for ${outcome.payload.window_chicago || outcome.payload.held_window_chicago}`);
  } finally {
    await db.end();
  }
}

async function main(mode) {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error('GITHUB_REPOSITORY is required');
  if (mode === 'verdict') {
    const { window, verdict } = currentVerdict(repo);
    const span = window ? `${chicagoTime(window.open)} to ${chicagoTime(window.close)}` : 'none in the lookback';
    console.log(`last closed window: ${span}; verdict: ${verdict}`);
    if (verdict === 'could-not-tell') console.log('COULD NOT TELL  no database-change pull request head predates that window');
    const needsDb = verdict === 'missed' || verdict === 'held';
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `needs_db=${needsDb}\nverdict=${verdict}\n`);
    return;
  }
  if (mode === 'record') return record(repo);
  throw new Error('usage: merge-window-watch.mjs verdict | record');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv[2]).catch((error) => {
    console.error(`COULD NOT TELL  ${error?.message ?? error}`);
    process.exit(UNKNOWN);
  });
}
