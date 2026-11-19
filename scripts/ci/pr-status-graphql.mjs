#!/usr/bin/env node
/**
 * Lightweight GraphQL PR status helper.
 *
 * Fetches concise pull request status (state, mergedAt, mergeable, autoMerge,
 * failing checks, pending count) in a SINGLE `gh api graphql` call so agents
 * never burn GitHub REST core quota polling CI.
 *
 * Usage:
 *   node scripts/ci/pr-status-graphql.mjs <pr-number> [<pr-number> ...] [--repo owner/name] [--json]
 *   node scripts/ci/pr-status-graphql.mjs --branch <ref> [--repo owner/name] [--json]
 */

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const DEFAULT_REPO = 'Smarter-Software-PIQ/Smarter-Poker-Club-Arena';

const PR_FIELDS = `
  number
  title
  state
  isDraft
  mergedAt
  mergeable
  mergeStateStatus
  headRefName
  headRefOid
  url
  autoMergeRequest {
    mergeMethod
    enabledAt
  }
  commits(last: 1) {
    nodes {
      commit {
        oid
        statusCheckRollup {
          state
          contexts(first: 100) {
            nodes {
              __typename
              ... on CheckRun {
                name
                status
                conclusion
              }
              ... on StatusContext {
                context
                state
              }
            }
          }
        }
      }
    }
  }
`;

const FAILING_CHECK_CONCLUSIONS = new Set([
  'FAILURE',
  'TIMED_OUT',
  'CANCELLED',
  'ACTION_REQUIRED',
  'STALE',
  'STARTUP_FAILURE',
]);

const PASSING_CHECK_CONCLUSIONS = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);

const FAILING_STATUS_STATES = new Set(['FAILURE', 'ERROR']);

export const USAGE = [
  'Usage:',
  '  node scripts/ci/pr-status-graphql.mjs <pr-number> [<pr-number> ...] [--repo owner/name] [--json]',
  '  node scripts/ci/pr-status-graphql.mjs --branch <ref> [--repo owner/name] [--json]',
].join('\n');

export function parseRepoSlug(slug) {
  if (typeof slug !== 'string' || !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(slug)) {
    throw new Error(`Invalid --repo value "${slug}": expected owner/name.`);
  }
  const [owner, repo] = slug.split('/');
  return { owner, repo };
}

export function parseArgs(argv) {
  let repo = process.env.REPO || DEFAULT_REPO;
  let branch = null;
  let json = false;
  let help = false;
  const prNumbers = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--repo') {
      const value = argv[++i];
      if (!value) throw new Error('Missing value for --repo.');
      repo = value;
    } else if (arg.startsWith('--repo=')) {
      repo = arg.slice('--repo='.length);
    } else if (arg === '--branch') {
      const value = argv[++i];
      if (!value) throw new Error('Missing value for --branch.');
      branch = value;
    } else if (arg.startsWith('--branch=')) {
      branch = arg.slice('--branch='.length);
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      const cleaned = arg.startsWith('#') ? arg.slice(1) : arg;
      if (!/^[1-9]\d*$/.test(cleaned)) {
        throw new Error(`Invalid PR number: "${arg}"`);
      }
      const num = Number.parseInt(cleaned, 10);
      if (!prNumbers.includes(num)) prNumbers.push(num);
    }
  }

  if (help) {
    return { help: true, repo, owner: '', repoName: '', branch, prNumbers, json };
  }

  if (branch && prNumbers.length > 0) {
    throw new Error('Specify either PR number(s) or --branch <ref>, not both.');
  }
  if (!branch && prNumbers.length === 0) {
    throw new Error('Provide at least one PR number or --branch <ref>.');
  }

  const { owner, repo: repoName } = parseRepoSlug(repo);
  return { help: false, repo, owner, repoName, branch, prNumbers, json };
}

export function buildPrStatusQuery({ owner, repo, prNumbers = [], branch = null }) {
  if (branch) {
    const query = `query($owner: String!, $repo: String!, $branch: String!) {
  repository(owner: $owner, name: $repo) {
    pullRequests(
      headRefName: $branch
      states: [OPEN, CLOSED, MERGED]
      first: 10
      orderBy: { field: CREATED_AT, direction: DESC }
    ) {
      nodes {${PR_FIELDS}
      }
    }
  }
}`;
    return { query, variables: { owner, repo, branch } };
  }

  if (!Array.isArray(prNumbers) || prNumbers.length === 0) {
    throw new Error('buildPrStatusQuery requires either branch or non-empty prNumbers.');
  }

  const selections = prNumbers
    .map((num, idx) => {
      if (!Number.isInteger(num) || num <= 0) {
        throw new Error(`Invalid PR number: ${num}`);
      }
      return `    pr${idx}: pullRequest(number: ${num}) {${PR_FIELDS}
    }`;
    })
    .join('\n');

  const query = `query($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
${selections}
  }
}`;
  return { query, variables: { owner, repo } };
}

export function summarizeCheckContexts(nodes) {
  const list = Array.isArray(nodes) ? nodes : [];
  let passed = 0;
  let pending = 0;
  let failed = 0;
  const failing = [];

  for (const node of list) {
    if (!node || typeof node !== 'object') continue;
    const isStatusContext =
      node.__typename === 'StatusContext' ||
      (node.__typename !== 'CheckRun' && typeof node.context === 'string');

    if (isStatusContext) {
      const name = node.context || 'unnamed-status';
      const state = String(node.state || '').toUpperCase();
      if (state === 'SUCCESS') {
        passed += 1;
      } else if (FAILING_STATUS_STATES.has(state)) {
        failed += 1;
        failing.push({ name, outcome: state });
      } else {
        pending += 1;
      }
      continue;
    }

    const name = node.name || 'unnamed-check';
    const status = String(node.status || '').toUpperCase();
    const conclusion = node.conclusion ? String(node.conclusion).toUpperCase() : null;

    if (status !== 'COMPLETED' || !conclusion) {
      pending += 1;
    } else if (PASSING_CHECK_CONCLUSIONS.has(conclusion)) {
      passed += 1;
    } else if (FAILING_CHECK_CONCLUSIONS.has(conclusion)) {
      failed += 1;
      failing.push({ name, outcome: conclusion });
    } else {
      pending += 1;
    }
  }

  return {
    total: passed + pending + failed,
    passed,
    pending,
    failed,
    failing,
  };
}

export function formatPrNode(pr) {
  const commit = pr.commits?.nodes?.[0]?.commit ?? null;
  const rollup = commit?.statusCheckRollup ?? null;
  const checks = summarizeCheckContexts(rollup?.contexts?.nodes);

  return {
    number: pr.number,
    title: pr.title ?? '',
    branch: pr.headRefName ?? null,
    headSha: pr.headRefOid ?? commit?.oid ?? null,
    state: pr.state ?? 'UNKNOWN',
    isDraft: Boolean(pr.isDraft),
    mergedAt: pr.mergedAt ?? null,
    mergeable: pr.mergeable ?? 'UNKNOWN',
    mergeStateStatus: pr.mergeStateStatus ?? null,
    autoMerge: pr.autoMergeRequest ? pr.autoMergeRequest.mergeMethod || true : false,
    rollupState: rollup?.state ?? null,
    checks,
    url: pr.url ?? null,
  };
}

export function extractPrStatuses(graphqlResponse, { prNumbers = [], branch = null }) {
  if (!graphqlResponse || typeof graphqlResponse !== 'object') {
    throw new Error('GitHub GraphQL returned an empty or invalid response.');
  }
  const repository = graphqlResponse.data?.repository;
  if (!repository || typeof repository !== 'object') {
    const errMsg = Array.isArray(graphqlResponse.errors) && graphqlResponse.errors.length > 0
      ? graphqlResponse.errors.map((e) => e.message).filter(Boolean).join('; ')
      : 'repository not found or inaccessible';
    throw new Error(`GitHub GraphQL query failed: ${errMsg}`);
  }

  if (branch) {
    const nodes = Array.isArray(repository.pullRequests?.nodes)
      ? repository.pullRequests.nodes.filter(Boolean)
      : [];
    return nodes.map(formatPrNode);
  }

  return prNumbers.map((num, idx) => {
    const node = repository[`pr${idx}`];
    if (!node) {
      return {
        number: num,
        title: '',
        branch: null,
        headSha: null,
        state: 'NOT_FOUND',
        isDraft: false,
        mergedAt: null,
        mergeable: 'UNKNOWN',
        mergeStateStatus: null,
        autoMerge: false,
        rollupState: null,
        checks: { total: 0, passed: 0, pending: 0, failed: 0, failing: [] },
        url: null,
      };
    }
    return formatPrNode(node);
  });
}

export function formatStatusText(statuses) {
  if (!Array.isArray(statuses) || statuses.length === 0) {
    return 'No matching pull requests found.';
  }
  return statuses
    .map((s) => {
      if (s.state === 'NOT_FOUND') {
        return `#${s.number} NOT_FOUND`;
      }
      const parts = [`#${s.number}`, s.isDraft ? `${s.state}(DRAFT)` : s.state];
      if (s.mergedAt) {
        parts.push(`mergedAt=${s.mergedAt}`);
      } else {
        parts.push(`mergeable=${s.mergeable}`);
      }
      parts.push(`autoMerge=${s.autoMerge}`);
      parts.push(`checks=${s.checks.passed}pass/${s.checks.pending}pend/${s.checks.failed}fail`);
      if (s.checks.failing.length > 0) {
        const names = s.checks.failing.map((f) => `${f.name}(${f.outcome})`).join(', ');
        parts.push(`failing=[${names}]`);
      }
      if (s.branch) {
        parts.push(`[${s.branch}]`);
      }
      return parts.join(' ');
    })
    .join('\n');
}

export function execGraphqlViaGh({ query, variables }) {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [key, value] of Object.entries(variables)) {
    args.push('-f', `${key}=${value}`);
  }
  const stdout = execFileSync('gh', args, {
    encoding: 'utf8',
    env: { ...process.env, GH_PAGER: 'cat' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(stdout);
}

export function runPrStatus(argv, { execGraphql = execGraphqlViaGh } = {}) {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    return { output: USAGE, statuses: [] };
  }
  const request = buildPrStatusQuery({
    owner: parsed.owner,
    repo: parsed.repoName,
    prNumbers: parsed.prNumbers,
    branch: parsed.branch,
  });
  const response = execGraphql(request);
  const statuses = extractPrStatuses(response, {
    prNumbers: parsed.prNumbers,
    branch: parsed.branch,
  });
  const output = parsed.json
    ? JSON.stringify(statuses, null, 2)
    : formatStatusText(statuses);
  return { output, statuses };
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  }
}

if (isMainModule()) {
  try {
    const { output } = runPrStatus(process.argv.slice(2));
    console.log(output);
  } catch (error) {
    console.error(`[pr-status] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
