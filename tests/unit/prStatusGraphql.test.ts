import { describe, it, expect } from 'vitest';
import {
  DEFAULT_REPO,
  parseArgs,
  buildPrStatusQuery,
  summarizeCheckContexts,
  extractPrStatuses,
  formatStatusText,
  runPrStatus,
} from '../../scripts/ci/pr-status-graphql.mjs';

describe('scripts/ci/pr-status-graphql.mjs', () => {
  describe('parseArgs', () => {
    it('parses one or more PR numbers, strips # prefixes, and deduplicates', () => {
      const parsed = parseArgs(['11420', '#11421', '11420', '--json']);
      expect(parsed).toEqual({
        help: false,
        repo: DEFAULT_REPO,
        owner: 'Smarter-Software-PIQ',
        repoName: 'Smarter-Poker-Club-Arena',
        branch: null,
        prNumbers: [11420, 11421],
        json: true,
      });
    });

    it('parses --branch and --repo flags in both space and equals forms', () => {
      const parsed = parseArgs(['--branch=fix/my-branch', '--repo', 'Smarter-Poker/World-Hub']);
      expect(parsed.branch).toBe('fix/my-branch');
      expect(parsed.owner).toBe('Smarter-Poker');
      expect(parsed.repoName).toBe('World-Hub');
      expect(parsed.prNumbers).toEqual([]);
      expect(parsed.json).toBe(false);
    });

    it('rejects missing targets, conflicting targets, and invalid PR numbers', () => {
      expect(() => parseArgs([])).toThrow(/Provide at least one PR number/);
      expect(() => parseArgs(['11420', '--branch', 'fix/x'])).toThrow(/not both/);
      expect(() => parseArgs(['abc'])).toThrow(/Invalid PR number/);
      expect(() => parseArgs(['0'])).toThrow(/Invalid PR number/);
      expect(() => parseArgs(['11420', '--repo', 'bad-repo-slug'])).toThrow(/Invalid --repo/);
    });
  });

  describe('buildPrStatusQuery', () => {
    it('batches multiple PR numbers into a single GraphQL query with aliases', () => {
      const { query, variables } = buildPrStatusQuery({
        owner: 'Smarter-Software-PIQ',
        repo: 'Smarter-Poker-Club-Arena',
        prNumbers: [11420, 11421],
      });
      expect(variables).toEqual({
        owner: 'Smarter-Software-PIQ',
        repo: 'Smarter-Poker-Club-Arena',
      });
      expect(query).toContain('pr0: pullRequest(number: 11420)');
      expect(query).toContain('pr1: pullRequest(number: 11421)');
      expect(query).toContain('statusCheckRollup');
      expect(query).toContain('autoMergeRequest');
    });

    it('builds a single GraphQL query for --branch lookup', () => {
      const { query, variables } = buildPrStatusQuery({
        owner: 'Smarter-Software-PIQ',
        repo: 'Smarter-Poker-Club-Arena',
        branch: 'fix/guard-merged-branch-graphql-resilience',
      });
      expect(variables).toEqual({
        owner: 'Smarter-Software-PIQ',
        repo: 'Smarter-Poker-Club-Arena',
        branch: 'fix/guard-merged-branch-graphql-resilience',
      });
      expect(query).toContain('pullRequests(');
      expect(query).toContain('headRefName: $branch');
    });
  });

  describe('summarizeCheckContexts', () => {
    it('classifies CheckRun and StatusContext nodes into passed, pending, and failing', () => {
      const summary = summarizeCheckContexts([
        { __typename: 'CheckRun', name: 'typecheck', status: 'COMPLETED', conclusion: 'SUCCESS' },
        { __typename: 'CheckRun', name: 'docs-only', status: 'COMPLETED', conclusion: 'SKIPPED' },
        { __typename: 'CheckRun', name: 'unit-tests', status: 'COMPLETED', conclusion: 'FAILURE' },
        { __typename: 'CheckRun', name: 'e2e', status: 'IN_PROGRESS', conclusion: null },
        { __typename: 'CheckRun', name: 'lint', status: 'QUEUED', conclusion: null },
        { __typename: 'StatusContext', context: 'deploy/preview', state: 'SUCCESS' },
        { __typename: 'StatusContext', context: 'security/scan', state: 'ERROR' },
        { __typename: 'StatusContext', context: 'ci/gate', state: 'PENDING' },
      ]);

      expect(summary).toEqual({
        total: 8,
        passed: 3,
        pending: 3,
        failed: 2,
        failing: [
          { name: 'unit-tests', outcome: 'FAILURE' },
          { name: 'security/scan', outcome: 'ERROR' },
        ],
      });
    });
  });

  describe('extractPrStatuses, formatStatusText, and runPrStatus', () => {
    const sampleOpenPr = {
      number: 11421,
      title: 'fix(guard): graphql first',
      state: 'OPEN',
      isDraft: false,
      mergedAt: null,
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'UNSTABLE',
      headRefName: 'fix/guard-graphql',
      headRefOid: 'abc1234',
      url: 'https://github.com/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/pull/11421',
      autoMergeRequest: { mergeMethod: 'SQUASH', enabledAt: '2026-11-19T18:00:00Z' },
      commits: {
        nodes: [
          {
            commit: {
              oid: 'abc1234',
              statusCheckRollup: {
                state: 'FAILURE',
                contexts: {
                  nodes: [
                    {
                      __typename: 'CheckRun',
                      name: 'build',
                      status: 'COMPLETED',
                      conclusion: 'SUCCESS',
                    },
                    {
                      __typename: 'CheckRun',
                      name: 'unit',
                      status: 'COMPLETED',
                      conclusion: 'FAILURE',
                    },
                    {
                      __typename: 'CheckRun',
                      name: 'e2e',
                      status: 'IN_PROGRESS',
                      conclusion: null,
                    },
                  ],
                },
              },
            },
          },
        ],
      },
    };

    const sampleMergedPr = {
      number: 11420,
      title: 'fix(member-record): add partial Chicago days',
      state: 'MERGED',
      isDraft: false,
      mergedAt: '2026-11-19T17:45:00Z',
      mergeable: 'UNKNOWN',
      mergeStateStatus: 'CLEAN',
      headRefName: 'fix/chicago-days',
      headRefOid: 'def5678',
      url: 'https://github.com/Smarter-Software-PIQ/Smarter-Poker-Club-Arena/pull/11420',
      autoMergeRequest: null,
      commits: {
        nodes: [
          {
            commit: {
              oid: 'def5678',
              statusCheckRollup: {
                state: 'SUCCESS',
                contexts: {
                  nodes: [
                    {
                      __typename: 'CheckRun',
                      name: 'build',
                      status: 'COMPLETED',
                      conclusion: 'SUCCESS',
                    },
                  ],
                },
              },
            },
          },
        ],
      },
    };

    it('formats multi-PR GraphQL responses in concise text and JSON without touching REST', () => {
      let callCount = 0;
      const execGraphql = () => {
        callCount += 1;
        return {
          data: {
            repository: {
              pr0: sampleOpenPr,
              pr1: sampleMergedPr,
              pr2: null,
            },
          },
        };
      };

      const textRun = runPrStatus(['11421', '11420', '999999'], { execGraphql });
      expect(callCount).toBe(1);
      expect(textRun.output).toBe(
        [
          '#11421 OPEN mergeable=MERGEABLE autoMerge=SQUASH checks=1pass/1pend/1fail failing=[unit(FAILURE)] [fix/guard-graphql]',
          '#11420 MERGED mergedAt=2026-11-19T17:45:00Z autoMerge=false checks=1pass/0pend/0fail [fix/chicago-days]',
          '#999999 NOT_FOUND',
        ].join('\n')
      );

      const jsonRun = runPrStatus(['11421', '--json'], {
        execGraphql: () => ({ data: { repository: { pr0: sampleOpenPr } } }),
      });
      const parsed = JSON.parse(jsonRun.output);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]).toMatchObject({
        number: 11421,
        state: 'OPEN',
        mergedAt: null,
        mergeable: 'MERGEABLE',
        autoMerge: 'SQUASH',
        checks: {
          total: 3,
          passed: 1,
          pending: 1,
          failed: 1,
          failing: [{ name: 'unit', outcome: 'FAILURE' }],
        },
      });
    });

    it('formats --branch responses including empty results', () => {
      const found = runPrStatus(['--branch', 'fix/guard-graphql'], {
        execGraphql: () => ({
          data: { repository: { pullRequests: { nodes: [sampleOpenPr] } } },
        }),
      });
      expect(found.statuses).toHaveLength(1);
      expect(found.output).toContain('#11421 OPEN');

      const empty = runPrStatus(['--branch', 'feat/no-pr-yet'], {
        execGraphql: () => ({
          data: { repository: { pullRequests: { nodes: [] } } },
        }),
      });
      expect(empty.statuses).toEqual([]);
      expect(empty.output).toBe('No matching pull requests found.');
    });

    it('throws a clear error when GraphQL returns errors without repository data', () => {
      expect(() =>
        extractPrStatuses(
          { errors: [{ message: 'API rate limit exceeded' }] },
          { prNumbers: [11421] }
        )
      ).toThrow(/API rate limit exceeded/);
    });

    it('handles empty status lists cleanly in formatStatusText', () => {
      expect(formatStatusText([])).toBe('No matching pull requests found.');
    });
  });
});
