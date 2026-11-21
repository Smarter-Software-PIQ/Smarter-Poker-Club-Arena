#!/usr/bin/env node
// CODE-AREA OWNERSHIP CHECK ON EVERY PULL REQUEST (Dan, 2026-11-19 17:26 Chicago).
//
// On 2026-11-19 three agents rewrote the same database function
// (fn_ca_alarm_drill) in three open pull requests and each merge overwrote the
// one before it. Nothing told any of them that another lane owned the function
// or that another open pull request was redefining it at the same time.
//
// This check reads ops/ownership.json and, for one pull request:
//   - names the pull request's lane (its 'Lane: <id>' line, else the lane that
//     owns most of the paths it changes);
//   - WARNS when it changes a path or a database function another lane owns;
//   - WARNS when a database function it defines is also defined by another
//     OPEN pull request (with that pull request's number);
//   - FAILS only when it touches a LOCKED area (release controls) without
//     declaring that area's lane.
// It posts one sticky comment (updated in place, never duplicated) when there
// is something to say, writes the findings to the job summary and annotations,
// and exits 1 only for a locked-area finding. Every GitHub read is bounded:
// one REST listing of the pull request's files, at most six GraphQL pages of
// open pull requests and one GraphQL batch for the migration bodies it needs.
//
// Usage (CI): node scripts/ci/ownership-check.mjs
//   env GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER, PR_BODY, PR_HEAD_SHA,
//       OWNERSHIP_COMMENT=1 to post the comment, GITHUB_STEP_SUMMARY optional.
// Local dry run: node scripts/ci/ownership-check.mjs --files a,b --body 'Lane: x'
import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const COMMENT_MARKER = '<!-- ownership-map-check -->';
export const MIGRATION_RE = /^supabase\/migrations\/[^/]+\.sql$/;

export function loadOwnershipMap(path = resolve('ops/ownership.json')) {
  const map = JSON.parse(readFileSync(path, 'utf8'));
  validateOwnershipMap(map);
  return map;
}

export function validateOwnershipMap(map) {
  const problems = [];
  if (!map || typeof map !== 'object') throw new Error('ownership map is not an object');
  if (!map.lanes || typeof map.lanes !== 'object') problems.push('missing lanes');
  if (!Array.isArray(map.areas)) problems.push('missing areas');
  for (const [id, lane] of Object.entries(map.lanes || {})) {
    if (!/^[a-z0-9-]+$/.test(id)) problems.push(`lane id ${id} must be lower-case words joined by hyphens`);
    if (!lane.description) problems.push(`lane ${id} has no description`);
    if (!Array.isArray(lane.sources) || lane.sources.length === 0) problems.push(`lane ${id} names no source document`);
  }
  (map.areas || []).forEach((area, i) => {
    if (!map.lanes?.[area.lane]) problems.push(`area ${i} names unknown lane ${area.lane}`);
    if (!Array.isArray(area.paths) || !Array.isArray(area.functions)) problems.push(`area ${i} needs paths and functions arrays`);
    if (area.locked && !area.why) problems.push(`locked area ${i} must say why`);
  });
  if (problems.length) throw new Error(`invalid ownership map: ${problems.join('; ')}`);
}

function escapeRe(s) {
  return s.replace(/[.+^${}()|[\]\\?]/g, '\\$&');
}

const pathReCache = new Map();
export function pathPatternToRegExp(pattern) {
  if (!pathReCache.has(pattern)) {
    let out = '';
    for (let i = 0; i < pattern.length; i++) {
      const c = pattern[i];
      if (c === '*' && pattern[i + 1] === '*') {
        // '**/' matches zero or more whole directories; a trailing '**' anything.
        if (pattern[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else if (c === '*') {
        out += '[^/]*';
      } else {
        out += escapeRe(c);
      }
    }
    pathReCache.set(pattern, new RegExp(`^${out}$`));
  }
  return pathReCache.get(pattern);
}

export function functionPatternToRegExp(pattern) {
  return new RegExp(`^${pattern.toLowerCase().split('*').map(escapeRe).join('.*')}$`);
}

export function ownerOfPath(map, path) {
  for (const area of map.areas) {
    for (const pattern of area.paths) {
      if (pathPatternToRegExp(pattern).test(path)) {
        return { lane: area.lane, locked: Boolean(area.locked), pattern, why: area.why };
      }
    }
  }
  return null;
}

export function ownerOfFunction(map, name) {
  const n = name.toLowerCase();
  for (const area of map.areas) {
    for (const pattern of area.functions) {
      if (functionPatternToRegExp(pattern).test(n)) {
        return { lane: area.lane, locked: Boolean(area.locked), pattern, why: area.why };
      }
    }
  }
  return null;
}

// SQL with comments removed (line and block). Dollar-quoted bodies stay, so a
// function created by dynamic SQL inside another body is still seen.
export function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

// Names of database functions a migration creates, replaces or drops, without
// schema or quotes, lower case, sorted and unique.
export function functionsDefinedIn(sql) {
  const names = new Set();
  const re =
    /\b(?:create\s+(?:or\s+replace\s+)?function|drop\s+function(?:\s+if\s+exists)?)\s+((?:"[^"]+"|[A-Za-z_][\w$]*)\s*\.\s*)?("[^"]+"|[A-Za-z_][\w$]*)/gi;
  for (const m of stripSqlComments(sql).matchAll(re)) {
    names.add(m[2].replace(/"/g, '').toLowerCase());
  }
  return [...names].sort();
}

export function declaredLane(body) {
  const m = /^[ \t>*_-]*lane[*_]*\s*:[*_]*\s*[`*_]*([a-z0-9-]+)/im.exec(body || '');
  return m ? m[1].toLowerCase() : null;
}

// The decision, from facts only (no network): testable in isolation.
//   files: [{ path }]  functions: [name]  otherPrs: [{ number, title, functions: [name] }]
export function evaluate({ map, files, functions, body, otherPrs = [] }) {
  const findings = [];
  const declared = declaredLane(body);
  if (declared && !map.lanes[declared]) {
    findings.push({ level: 'warn', kind: 'unknown-lane', message: `This pull request declares lane \`${declared}\`, which ops/ownership.json does not define. Known lanes: ${Object.keys(map.lanes).join(', ')}.` });
  }
  const owned = files.map((f) => ({ path: f.path, owner: ownerOfPath(map, f.path) }));
  const counts = new Map();
  for (const o of owned) if (o.owner) counts.set(o.owner.lane, (counts.get(o.owner.lane) || 0) + 1);
  let inferred = null;
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length && (ranked.length === 1 || ranked[0][1] > ranked[1][1])) inferred = ranked[0][0];
  const lane = declared && map.lanes[declared] ? declared : inferred;

  const byLane = new Map();
  for (const o of owned) {
    if (!o.owner) continue;
    if (o.owner.locked && declared !== o.owner.lane) {
      findings.push({ level: 'locked', kind: 'locked-path', lane: o.owner.lane, message: `\`${o.path}\` is in a LOCKED \`${o.owner.lane}\` area (${o.owner.why}) and this pull request does not declare \`Lane: ${o.owner.lane}\`.` });
      continue;
    }
    if (lane && o.owner.lane !== lane) {
      if (!byLane.has(o.owner.lane)) byLane.set(o.owner.lane, []);
      byLane.get(o.owner.lane).push(o.path);
    }
  }
  for (const [other, paths] of byLane) {
    const shown = paths.slice(0, 8).map((p) => `\`${p}\``).join(', ');
    findings.push({ level: 'warn', kind: 'foreign-path', lane: other, message: `Changes ${paths.length} path(s) owned by lane \`${other}\` (this pull request's lane: \`${lane}\`): ${shown}${paths.length > 8 ? ', ...' : ''}. Coordinate with that lane before merging.` });
  }

  for (const fn of functions) {
    const owner = ownerOfFunction(map, fn);
    if (owner?.locked && declared !== owner.lane) {
      findings.push({ level: 'locked', kind: 'locked-function', lane: owner.lane, message: `Database function \`${fn}\` is in a LOCKED \`${owner.lane}\` area (${owner.why}) and this pull request does not declare \`Lane: ${owner.lane}\`.` });
    } else if (owner && lane && owner.lane !== lane) {
      findings.push({ level: 'warn', kind: 'foreign-function', lane: owner.lane, message: `Redefines database function \`${fn}\`, owned by lane \`${owner.lane}\` (this pull request's lane: \`${lane}\`).` });
    }
    const rivals = otherPrs.filter((p) => p.functions.includes(fn));
    if (rivals.length) {
      const list = rivals.map((p) => `#${p.number}${p.title ? ` (${p.title})` : ''}`).join(', ');
      findings.push({ level: 'warn', kind: 'open-pr-function', message: `Database function \`${fn}\` is also defined by open pull request ${list}. Whichever merges second replaces the other's body: rebase onto the first and carry its change, or agree which one owns the function.` });
    }
  }
  return { declared, inferred, lane, findings, locked: findings.some((f) => f.level === 'locked') };
}

export function renderComment({ result, headSha }) {
  const lines = [COMMENT_MARKER, '### Code-area ownership check', ''];
  const laneLine = result.declared
    ? `Lane declared: \`${result.declared}\`.`
    : result.inferred
      ? `No \`Lane:\` line in the description; inferred lane \`${result.inferred}\` from the paths changed.`
      : 'No `Lane:` line in the description and no owned path changed.';
  lines.push(laneLine, '');
  if (!result.findings.length) {
    lines.push(`No ownership findings at ${headSha ? `\`${headSha.slice(0, 12)}\`` : 'this revision'}.`);
  } else {
    for (const f of result.findings) lines.push(`- ${f.level === 'locked' ? '**LOCKED**' : 'Warning'}: ${f.message}`);
    lines.push('');
    lines.push(result.locked
      ? 'A locked area changes only under its own lane. If this change is that lane\'s work, add `Lane: <lane>` to the description; the check re-runs when the description is edited.'
      : 'Warnings do not block the merge. They say who else to coordinate with.');
  }
  lines.push('', `Map: \`ops/ownership.json\`. Revision: \`${(headSha || '').slice(0, 12)}\`.`);
  return lines.join('\n');
}

// ---------------------------------------------------------------- GitHub I/O
async function gh(token, path, init = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'ownership-map-check',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub ${init.method || 'GET'} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function graphql(token, query, variables) {
  const out = await gh(token, '/graphql', { method: 'POST', body: JSON.stringify({ query, variables }) });
  if (out.errors?.length) throw new Error(`GraphQL: ${JSON.stringify(out.errors).slice(0, 500)}`);
  return out.data;
}

async function prFiles(token, repo, number) {
  const files = [];
  for (let page = 1; page <= 30; page++) {
    const batch = await gh(token, `/repos/${repo}/pulls/${number}/files?per_page=100&page=${page}`);
    files.push(...batch.map((f) => ({ path: f.filename, status: f.status })));
    if (batch.length < 100) break;
  }
  return files;
}

// Open pull requests (other than this one) updated in the last ACTIVE_DAYS,
// most recently updated first, with the migrations they add or change. A pull
// request nobody has touched for two weeks is not racing anyone. Six pages of
// 100 at most; a pull request with more than 100 files is read for its first 100.
export const ACTIVE_DAYS = 14;
export async function openPrMigrations(token, repo, self, now = Date.now()) {
  const [owner, name] = repo.split('/');
  const prs = [];
  let after = null;
  const since = now - ACTIVE_DAYS * 86_400_000;
  for (let page = 0; page < 6; page++) {
    const data = await graphql(
      token,
      `query($owner:String!,$name:String!,$after:String){repository(owner:$owner,name:$name){pullRequests(states:OPEN,first:100,after:$after,orderBy:{field:UPDATED_AT,direction:DESC}){pageInfo{hasNextPage endCursor}nodes{number title headRefOid updatedAt files(first:100){nodes{path changeType}}}}}}`,
      { owner, name, after }
    );
    const conn = data.repository.pullRequests;
    let stale = false;
    for (const n of conn.nodes) {
      if (Date.parse(n.updatedAt) < since) {
        stale = true;
        break;
      }
      if (n.number === self) continue;
      const migrations = (n.files?.nodes || [])
        .filter((f) => MIGRATION_RE.test(f.path) && f.changeType !== 'DELETED')
        .map((f) => f.path);
      if (migrations.length) prs.push({ number: n.number, title: n.title, sha: n.headRefOid, migrations });
    }
    if (stale || !conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return prs;
}

// Bodies of those migrations in GraphQL batches of 50 (aliases), at most 200 files.
export async function attachFunctions(token, repo, prs) {
  const [owner, name] = repo.split('/');
  const wanted = [];
  for (const pr of prs) for (const path of pr.migrations) wanted.push({ pr, path });
  const limited = wanted.slice(0, 200);
  for (const pr of prs) pr.functions = [];
  for (let i = 0; i < limited.length; i += 50) {
    const chunk = limited.slice(i, i + 50);
    const fields = chunk
      .map((w, j) => `f${j}: object(expression: ${JSON.stringify(`${w.pr.sha}:${w.path}`)}) { ... on Blob { text } }`)
      .join(' ');
    const data = await graphql(token, `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){${fields}}}`, { owner, name });
    chunk.forEach((w, j) => {
      const text = data.repository[`f${j}`]?.text;
      if (text) w.pr.functions.push(...functionsDefinedIn(text));
    });
  }
  for (const pr of prs) pr.functions = [...new Set(pr.functions)];
  return { prs, truncated: wanted.length > limited.length };
}

async function upsertComment(token, repo, number, body, hasFindings) {
  const comments = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await gh(token, `/repos/${repo}/issues/${number}/comments?per_page=100&page=${page}`);
    comments.push(...batch);
    if (batch.length < 100) break;
  }
  const mine = comments.find((c) => typeof c.body === 'string' && c.body.startsWith(COMMENT_MARKER));
  if (mine) {
    if (mine.body !== body) await gh(token, `/repos/${repo}/issues/comments/${mine.id}`, { method: 'PATCH', body: JSON.stringify({ body }) });
  } else if (hasFindings) {
    await gh(token, `/repos/${repo}/issues/${number}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
  }
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

/**
 * THE DECLARED LANE IS READ FROM THE DESCRIPTION AS IT IS NOW (2026-11-21).
 *
 * Booking #11640 was opened without its `Lane: release-custody` line and the
 * line was added a minute later. The `edited` run was cancelled, and a re-run
 * replays the ORIGINAL event payload, so every re-run read the old description
 * and failed: the owner window's booking sat unmergeable for 40 minutes. The
 * description is read live from the pull request; the event payload is only
 * the fallback when that read fails, and the fallback is said out loud.
 */
export async function currentDescription({ explicit, payload, read, log = () => {} }) {
  if (explicit !== undefined) return explicit;
  if (read) {
    try {
      const pr = await read();
      if (pr && typeof pr.body === 'string') return pr.body;
      if (pr && pr.body === null) return '';
    } catch (e) {
      log(`::warning title=Ownership map::could not read the live description (${String(e.message).slice(0, 200)}); using the event payload.`);
    }
  }
  return payload ?? '';
}

async function main() {
  const map = loadOwnershipMap();
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const number = Number(process.env.PR_NUMBER || 0);
  const body = await currentDescription({
    explicit: arg('--body'),
    payload: process.env.PR_BODY,
    read: token && repo && number ? () => gh(token, `/repos/${repo}/pulls/${number}`) : null,
    log: (line) => console.log(line),
  });
  const headSha = process.env.PR_HEAD_SHA || '';
  let files;
  if (arg('--files') !== undefined) files = arg('--files').split(',').filter(Boolean).map((path) => ({ path, status: 'modified' }));
  else files = await prFiles(token, repo, number);

  // This pull request's own migrations are read from the checked-out merge ref.
  const functions = [];
  for (const f of files) {
    if (!MIGRATION_RE.test(f.path) || f.status === 'removed' || !existsSync(f.path)) continue;
    functions.push(...functionsDefinedIn(readFileSync(f.path, 'utf8')));
  }
  const ownFunctions = [...new Set(functions)].sort();

  let otherPrs = [];
  let note = '';
  if (ownFunctions.length && token && repo && number) {
    try {
      const listed = await openPrMigrations(token, repo, number);
      const { prs, truncated } = await attachFunctions(token, repo, listed);
      otherPrs = prs;
      if (truncated) note = 'More than 200 migration files are open across recently updated pull requests; the 200 most recently updated were compared.';
    } catch (e) {
      // A read that fails is said, never treated as "no overlap".
      note = `Could not read the other open pull requests (${e.message.slice(0, 200)}); the open-pull-request function comparison did not run.`;
    }
  }

  const result = evaluate({ map, files, functions: ownFunctions, body, otherPrs });
  if (note) result.findings.push({ level: 'warn', kind: 'incomplete', message: note });
  const comment = renderComment({ result, headSha });

  for (const f of result.findings) {
    console.log(`::${f.level === 'locked' ? 'error' : 'warning'} title=Ownership map::${f.message.replace(/`/g, '')}`);
  }
  console.log(comment);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${comment}\n`);
  if (process.env.OWNERSHIP_COMMENT === '1' && token && repo && number) {
    try {
      await upsertComment(token, repo, number, comment, result.findings.length > 0);
    } catch (e) {
      console.log(`::warning title=Ownership map::could not post the comment: ${e.message.slice(0, 200)}`);
    }
  }
  process.exitCode = result.locked ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((e) => {
    console.error(`ownership check failed to run: ${e.stack || e.message}`);
    process.exitCode = 1;
  });
}
