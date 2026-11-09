#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE ESTATE DIGEST - one page, every morning, before the surprise does
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY (2026-09-01). Dan learned about a $1,100 Actions bill from the invoice,
 * a repo-wide cron stall from an agent's aside, and 426 unrecorded migrations
 * from a session footnote. Every one of those was knowable from existing
 * signals; nothing aggregated them for the one person who needed the picture.
 *
 * WHAT. Gathers, once a day: publish truth (is production serving main),
 * merge volume, Actions volume (the cost proxy), cron liveness, the incident
 * board, and migration-record drift. Delivers it two ways:
 *   - upserts the single 'estate-digest'-labeled GitHub issue (the archive -
 *     one issue whose body is always the latest, history in the edits), and
 *   - notifies every active platform-scope recipient in-app, exactly the way
 *     fn_ca_daily_attestation already does, so it lands where Dan already is.
 *
 * It NEVER fails the run: a digest that can only say "three sections were
 * unreadable" is still a digest, and a red daily job becomes wallpaper.
 */
import { execFileSync } from 'node:child_process';
import { supabaseServerHeaders } from '../../scripts/ci/supabase-auth-headers.mjs';
import { assertClubArenaRepository } from '../../scripts/ci/repository-identity.mjs';
import { digestRecipients } from './estate-digest-recipients.mjs';

const REPO = process.env.REPO || 'Smarter-Poker/Smarter-Poker-Club-Arena';
const WH_REPO = process.env.WH_REPO || 'Smarter-Poker/Smarter-Poker-World-Hub';
// Reads (including World Hub, a different private repo) ride the App token or
// PAT; issue writes ride GITHUB_TOKEN, whose issues:write the workflow
// declares - the same split the read-only estate audits use.
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
const TOKEN_ISSUES = process.env.GH_TOKEN_ISSUES || TOKEN;
const SB_URL = process.env.SUPABASE_URL || '';
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const DAY_MS = 24 * 3600_000;
const lines = [];
const problems = [];

const ghWith =
  (token) =>
  async (path, init = {}) => {
    const res = await fetch(`https://api.github.com${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
    });
    if (!res.ok) throw new Error(`${path} -> ${res.status}`);
    return res.json();
  };
// Existing personal reads remain on their installation; only this transferred
// repository uses the separately scoped organization token.
const gh = async (path, init = {}) => {
  const transferred = REPO === 'Smarter-Software-PIQ/Smarter-Poker-Club-Arena';
  const currentRepository = path === `/repos/${REPO}` || path.startsWith(`/repos/${REPO}/`);
  if (transferred && currentRepository) {
    assertClubArenaRepository(REPO, process.env.GITHUB_REPOSITORY_ID);
    if (!process.env.GH_TOKEN_CA) throw Error('Transferred repository read token unavailable');
    return ghWith(process.env.GH_TOKEN_CA)(path, init);
  }
  return ghWith(TOKEN)(path, init);
};
const ghIssues = ghWith(TOKEN_ISSUES);

const sb = async (pathAndQuery, init = {}) => {
  const res = await fetch(`${SB_URL}${pathAndQuery}`, {
    ...init,
    headers: supabaseServerHeaders(SB_KEY, {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      prefer: 'count=exact',
      ...init.headers,
    }),
  });
  return res;
};

const section = (title) => lines.push('', `### ${title}`, '');
const item = (s) => lines.push(`- ${s}`);
const tryStep = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    problems.push(`${name}: ${String(e.message || e).slice(0, 120)}`);
    item(`(${name} unreadable today)`);
  }
};

// ── 1. Publish truth ────────────────────────────────────────────────────────
section('Publish truth');
await tryStep('publish', async () => {
  const main = await gh(`/repos/${REPO}/commits/main`);
  const info = await (
    await fetch('https://smarter.poker/hub/club-arena/build-info.json', { cache: 'no-store' })
  ).json();
  const live = String(info.ca_sha || '').slice(0, 9);
  const tip = main.sha.slice(0, 9);
  if (info.ca_sha === main.sha) {
    item(`Production serves main exactly (${tip}).`);
  } else {
    const cmp = await gh(`/repos/${REPO}/compare/${info.ca_sha}...${main.sha}`).catch(() => null);
    const behind = cmp?.ahead_by;
    item(
      behind != null
        ? `Production serves ${live}, ${behind} commit(s) behind main ${tip} (built ${info.built_at}). Normal when merges are flowing; a growing gap is the publish outage signature.`
        : `Production serves ${live}; main is ${tip}; ancestry unreadable - if this persists, check production-integrity audit issues.`
    );
  }
});

// ── 2. Merge + Actions volume (the cost proxy) ─────────────────────────────
section('Volume (last 24h)');
for (const [label, repo] of [
  ['Club Arena', REPO],
  ['World Hub', WH_REPO],
]) {
  await tryStep(`volume ${label}`, async () => {
    const since = new Date(Date.now() - DAY_MS).toISOString();
    const commits = await gh(`/repos/${repo}/commits?since=${since}&per_page=100`);
    const runs = await gh(`/repos/${repo}/actions/runs?created=%3E${since}&per_page=1`);
    item(
      `${label}: ${commits.length}${commits.length === 100 ? '+' : ''} commits to main, ${runs.total_count} workflow runs. (August ran ~740 runs/day at the 1,100 USD bill; ~150/day is the post-audit norm.)`
    );
  });
}

// ── 3. Cron liveness ────────────────────────────────────────────────────────
section('Cron liveness');
await tryStep('cron', async () => {
  const runs = await gh(`/repos/${REPO}/actions/runs?event=schedule&per_page=1`);
  const last = runs.workflow_runs?.[0];
  const ageMin = last ? Math.round((Date.now() - Date.parse(last.created_at)) / 60000) : null;
  item(
    ageMin === null
      ? 'No scheduled run found at all - the wedge, if the repo has schedules.'
      : `Last scheduled tick ${ageMin} min ago (${last.name}). Over ~90 min is a schedule-delivery failure; inspect the owning workflow without cycling or redispatching it.`
  );
  const wedges = await gh(`/repos/${REPO}/issues?state=open&labels=cron-wedge&per_page=1`);
  if (wedges.length > 0)
    item(
      `OPEN cron-wedge issue: #${wedges[0].number} - inspect the owning scheduled workflow and its latest delivery evidence.`
    );
});

// ── 4. The money board ──────────────────────────────────────────────────────
section('Incident board');
await tryStep('incidents', async () => {
  const open = await sb(`/rest/v1/ca_drift_incidents?status=neq.resolved&select=severity`, {
    method: 'HEAD',
  });
  const crit = await sb(
    `/rest/v1/ca_drift_incidents?status=neq.resolved&severity=eq.critical&select=id`,
    { method: 'HEAD' }
  );
  const resolved = await sb(
    `/rest/v1/ca_drift_incidents?status=eq.resolved&resolved_at=gte.${new Date(Date.now() - DAY_MS).toISOString()}&select=id`,
    { method: 'HEAD' }
  );
  const n = (r) => Number((r.headers.get('content-range') || '/0').split('/')[1] || 0);
  item(
    `Open: ${n(open)} (${n(crit)} critical). Resolved in 24h: ${n(resolved)} - every one now carries a root cause and a correction reference by database law.`
  );
});

// ── 5. Migration record drift ───────────────────────────────────────────────
section('Migration record drift');
await tryStep('drift', async () => {
  let out = '';
  try {
    out = execFileSync('node', ['scripts/ci/check-applied-migrations-are-recorded.mjs'], {
      encoding: 'utf8',
      timeout: 120_000,
      env: { ...process.env },
    });
  } catch (e) {
    out = String(e.stdout || '') + String(e.stderr || '');
  }
  // Real output shape: "[applied-migrations-recorded] 378 of 1000 migration(s)
  // applied since <floor> have NO FILE in this repo:"
  const m =
    out.match(/(\d+)\s+of\s+\d+\s+migration\(s\)[^:]*NO FILE/i) || out.match(/(\d+)\s+unrecorded/i);
  const missing = m
    ? Number(m[1])
    : /every applied migration has a file|0 unrecorded/i.test(out)
      ? 0
      : null;
  item(
    missing === 0
      ? 'Every applied migration has a repo file.'
      : missing === null
        ? 'Audit output unparsed - see the twice-daily Applied Migrations workflow for the real number.'
        : `${missing} applied migration(s) still have no repo file; the owning audit files a migration-drift issue while any remain.`
  );
});

// ── 6. Seat-first board starts against the under-300 target ────────────────
//
// Dan, 2026-11-08: "CUT SPINS AND SIT N GOS DOWN TO LIKE UNDER 300 PER DAY
// COMBINED", and on acceptance: report total, human-triggered and horse-only
// starts with satellite feeders counted separately.
//
// Read-only, one bounded call for ONE closed Chicago day. This digest runs at
// 06:07 Chicago, so the previous Chicago day has ended; the function defaults
// to that day. It reports a number, it never changes one - no release, no
// registration, no seating, no refund is initiated or retried from here.
//
// The target counts Spins plus REGULAR heads-up. Satellite feeders are printed
// on their own line and deliberately excluded from the comparison: a feeder
// fills one named event rather than being a price point on the open board.
const SEAT_FIRST_DAILY_TARGET = 300;
section('Seat-first board starts (Spins and Sit and Gos)');
await tryStep('seat-first starts', async () => {
  const res = await sb(`/rest/v1/rpc/fn_ca_seat_first_daily_starts`, {
    method: 'POST',
    body: JSON.stringify({ p_day: null }),
  });
  // 10.86 rule 2: an unreadable answer is never coerced into an empty one.
  // 10.86 rule 4: and the status alone is not enough. The first real run of
  // this section printed "starts rpc 500" and nothing else, so the next reader
  // had to go to the edge and postgres logs to learn that the call had hit
  // service_role's ~8s statement timeout. Carry PostgREST's own message, which
  // names the cause in the line the digest already prints.
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw Error(`starts rpc ${res.status}${detail ? ` ${detail.slice(0, 200)}` : ''}`);
  }
  const rows = await res.json();
  if (!Array.isArray(rows)) throw Error('starts rpc returned no rows array');
  if (rows.length === 0) {
    item(
      'No seat-first board started yesterday (Chicago). That is below the target, and unusual enough to look at.'
    );
    return;
  }
  const day = rows[0].stat_day;
  const counted = rows.filter((r) => r.kind === 'Spin' || r.kind === 'regular heads-up');
  const feeders = rows.filter((r) => r.kind === 'satellite feeder');
  const other = rows.filter((r) => !counted.includes(r) && !feeders.includes(r));
  const sum = (list, key) => list.reduce((n, r) => n + Number(r[key] || 0), 0);
  const total = sum(counted, 'starts');
  const human = sum(counted, 'human_triggered');
  const horse = sum(counted, 'horse_only');
  item(
    `${day} (Chicago): ${total} combined Spin and regular Sit and Go starts against a target of under ${SEAT_FIRST_DAILY_TARGET}` +
      ` - ${total < SEAT_FIRST_DAILY_TARGET ? 'WITHIN target' : 'OVER target'}.`
  );
  item(`${human} human-triggered, ${horse} horse-only.`);
  for (const r of counted) {
    item(
      `  ${r.kind}: ${r.starts} starts (${r.human_triggered} human-triggered, ${r.horse_only} horse-only).`
    );
  }
  item(
    feeders.length
      ? `Satellite feeders, counted separately and outside the target: ${sum(feeders, 'starts')} starts (${sum(feeders, 'human_triggered')} human-triggered).`
      : 'Satellite feeders, counted separately and outside the target: 0 starts.'
  );
  // Every format the function buckets is printed, so a format nobody expected
  // cannot hide inside the total (10.86: no silent zero).
  for (const r of other) {
    item(
      `  ${r.kind}: ${r.starts} starts - outside both the target and the feeder line; check whether it belongs in one.`
    );
  }
});

if (problems.length) {
  section('Digest self-report');
  for (const p of problems) item(p);
}

const today = new Date().toISOString().slice(0, 10);
const body = [
  `One page, generated ${new Date().toISOString()} by estate-digest.yml.`,
  ...lines,
].join('\n');
console.log(body);

// ── Deliver: the single self-updating issue ────────────────────────────────
if (TOKEN) {
  try {
    await ghIssues(`/repos/${REPO}/labels`, {
      method: 'POST',
      body: JSON.stringify({ name: 'estate-digest', color: '0E8A16' }),
    }).catch(() => {});
    const existing = await ghIssues(
      `/repos/${REPO}/issues?state=open&labels=estate-digest&per_page=1`
    );
    if (existing.length > 0) {
      await ghIssues(`/repos/${REPO}/issues/${existing[0].number}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: `Estate Digest (${today})`, body }),
      });
      console.log(`[digest] updated issue #${existing[0].number}`);
    } else {
      const created = await ghIssues(`/repos/${REPO}/issues`, {
        method: 'POST',
        body: JSON.stringify({
          title: `Estate Digest (${today})`,
          body,
          labels: ['estate-digest'],
        }),
      });
      console.log(`[digest] created issue #${created.number}`);
    }
  } catch (e) {
    console.log(`[digest] issue delivery failed: ${e.message}`);
  }
}

// ── Deliver: in-app, to the same recipients the attestation reaches ────────
if (SB_URL && SB_KEY) {
  try {
    const res = await sb(
      `/rest/v1/ca_incident_recipients?scope=eq.platform&active=eq.true&select=user_id`
    );
    const recips = res.ok ? await res.json() : [];
    let sent = 0;
    // A report, not an alert: never addressed to the owner account, whose
    // notices become alert-board rows (estate-digest-recipients.mjs).
    for (const r of digestRecipients(recips.map((x) => x.user_id))) {
      const ok = await sb(`/rest/v1/rpc/fn_raise_notification`, {
        method: 'POST',
        body: JSON.stringify({
          p_user_id: r,
          p_type: 'estate_digest',
          p_title: `Estate Digest ${today}`,
          p_message: lines
            .filter((l) => l.startsWith('- '))
            .map((l) => l.slice(2))
            .join(' | ')
            .slice(0, 900),
          p_link: '/hub/club-arena/financial-incidents',
          p_data: { source: 'estate-digest.yml', date: today },
        }),
      });
      if (ok.ok) sent++;
    }
    console.log(`[digest] in-app notifications: ${sent}/${recips.length}`);
  } catch (e) {
    console.log(`[digest] in-app delivery failed: ${e.message}`);
  }
}

process.exit(0);
